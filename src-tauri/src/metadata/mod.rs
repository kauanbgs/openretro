//! Game catalog built from the LaunchBox Games Database dump. The dump is a
//! single deflate stream, so it is downloaded whole, streamed once into a
//! compact SQLite index holding only OpenRetro's consoles, then deleted.
//! Artwork stays on LaunchBox's image CDN and loads only when shown.
use crate::database::{error, Result};
use quick_xml::{events::Event, Reader};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;

const DUMP_URL: &str = "https://gamesdb.launchbox-app.com/Metadata.zip";
const IMAGE_BASE: &str = "https://images.launchbox-app.com/";
const DETAILS_BASE: &str = "https://gamesdb.launchbox-app.com/games/details/";
const USER_AGENT: &str = concat!(
    "OpenRetro/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/kauanbgs/openretro)"
);
/// Bump when the index layout changes so existing installs rebuild.
const SCHEMA_VERSION: &str = "1";
const REFRESH_AFTER_SECONDS: i64 = 7 * 86_400;
const INDEX_SCHEMA: &str = "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
         CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE games(id INTEGER PRIMARY KEY, platform TEXT NOT NULL, name TEXT NOT NULL, year INTEGER,
           overview TEXT, developer TEXT, publisher TEXT, genres TEXT, players INTEGER, cooperative INTEGER,
           rating REAL, rating_count INTEGER NOT NULL DEFAULT 0, video TEXT, release_type TEXT);
         CREATE TABLE names(id INTEGER NOT NULL, platform TEXT NOT NULL, norm TEXT NOT NULL, canonical INTEGER NOT NULL);
         CREATE TABLE genres(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
         CREATE TABLE game_genres(game_id INTEGER NOT NULL, genre_id INTEGER NOT NULL);
         CREATE TABLE images(id INTEGER NOT NULL, type TEXT NOT NULL, region TEXT, file TEXT NOT NULL);";
const PAGE_SIZE: i64 = 24;
const MAX_DUMP_BYTES: u64 = 512 * 1024 * 1024;

/// LaunchBox platform names mapped to OpenRetro console ids.
const PLATFORMS: &[(&str, &str)] = &[
    ("Nintendo Entertainment System", "nes"),
    ("Super Nintendo Entertainment System", "snes"),
    ("Nintendo 64", "n64"),
    ("Nintendo Game Boy", "gb"),
    ("Nintendo Game Boy Color", "gbc"),
    ("Nintendo Game Boy Advance", "gba"),
    ("Nintendo DS", "nds"),
    ("Sega Master System", "sms"),
    ("Sega Genesis", "genesis"),
    ("Sega Game Gear", "gg"),
    ("Sony Playstation", "psx"),
    ("Sony PSP", "psp"),
    ("Sony Playstation 2", "ps2"),
    ("Arcade", "arcade"),
    ("MS-DOS", "dos"),
];
const IMAGE_TYPES: &[&str] = &[
    "Box - Front",
    "Screenshot - Gameplay",
    "Fanart - Background",
];
/// Entries the catalog hides; matching still finds them, ranked last.
const HIDDEN_RELEASES: &str = "('ROM Hack', 'DLC')";
/// Box art preference: North American and worldwide covers first.
const REGION_ORDER: &str =
    "CASE WHEN i.region='North America' THEN 0 WHEN i.region='United States' THEN 1 \
     WHEN i.region='World' THEN 2 WHEN i.region IS NULL THEN 3 WHEN i.region='Europe' THEN 4 \
     WHEN i.region='Japan' THEN 6 ELSE 5 END";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatus {
    /// "missing", "building", "ready" or "failed".
    state: String,
    progress: f64,
    games: i64,
    message: Option<String>,
    updated_at: Option<String>,
}
impl Default for CatalogStatus {
    fn default() -> Self {
        Self {
            state: "missing".into(),
            progress: 0.0,
            games: 0,
            message: None,
            updated_at: None,
        }
    }
}

#[derive(Default)]
pub struct LaunchboxCatalog {
    building: AtomicBool,
    status: Mutex<CatalogStatus>,
    conn: Mutex<Option<Connection>>,
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir().map_err(error)?.join("launchbox");
    std::fs::create_dir_all(&dir).map_err(error)?;
    Ok(dir)
}

fn set_status(app: &tauri::AppHandle, update: impl FnOnce(&mut CatalogStatus)) {
    if let Ok(mut status) = app.state::<LaunchboxCatalog>().status.lock() {
        update(&mut status);
    }
}

fn open_index(path: &Path) -> Option<(Connection, i64, Option<String>, i64)> {
    let conn = Connection::open(path).ok()?;
    let meta = |key: &str| -> Option<String> {
        conn.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    };
    if meta("schema").as_deref() != Some(SCHEMA_VERSION) {
        return None;
    }
    let built: i64 = meta("built_at")?.parse().ok()?;
    let updated = meta("updated_at");
    let games: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .ok()?;
    Some((conn, built, updated, games))
}

/// Opens the existing index and refreshes it in the background when it is
/// missing, from an older layout, or a week old. An old index stays usable
/// while the new one builds.
pub fn start(app: &tauri::AppHandle) {
    let dir = match directory(app) {
        Ok(dir) => dir,
        Err(message) => {
            set_status(app, |s| {
                s.state = "failed".into();
                s.message = Some(message);
            });
            return;
        }
    };
    let mut stale = true;
    if let Some((conn, built, updated, games)) = open_index(&dir.join("launchbox.sqlite")) {
        stale = chrono::Utc::now().timestamp() - built > REFRESH_AFTER_SECONDS;
        if let Ok(mut slot) = app.state::<LaunchboxCatalog>().conn.lock() {
            *slot = Some(conn);
        }
        set_status(app, |s| {
            *s = CatalogStatus {
                state: "ready".into(),
                progress: 100.0,
                games,
                message: None,
                updated_at: updated,
            }
        });
    }
    if stale {
        spawn_build(app);
    }
}

fn spawn_build(app: &tauri::AppHandle) {
    if app
        .state::<LaunchboxCatalog>()
        .building
        .swap(true, Ordering::AcqRel)
    {
        return;
    }
    {
        let state = app.state::<LaunchboxCatalog>();
        let Ok(mut status) = state.status.lock() else {
            state.building.store(false, Ordering::Release);
            return;
        };
        let ready = status.state == "ready";
        status.message = None;
        if !ready {
            status.state = "building".into();
            status.progress = 0.0;
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(message) = build(&app) {
            log::warn!("LaunchBox catalog build failed: {message}");
            let ready = app
                .state::<LaunchboxCatalog>()
                .conn
                .lock()
                .is_ok_and(|conn| conn.is_some());
            set_status(&app, |s| {
                s.state = if ready { "ready" } else { "failed" }.into();
                s.message = Some(if ready {
                    format!("Não foi possível atualizar o catálogo: {message}")
                } else {
                    message
                });
            });
        }
        app.state::<LaunchboxCatalog>()
            .building
            .store(false, Ordering::Release);
    });
}

/// Counts bytes read so long steps can report progress.
struct Counting<R> {
    inner: R,
    count: Arc<AtomicU64>,
}
impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let read = self.inner.read(buf)?;
        self.count.fetch_add(read as u64, Ordering::Relaxed);
        Ok(read)
    }
}

struct BuildFiles([PathBuf; 2]);
impl Drop for BuildFiles {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn build(app: &tauri::AppHandle) -> Result<()> {
    let dir = directory(app)?;
    let rebuilding_ready = app
        .state::<LaunchboxCatalog>()
        .conn
        .lock()
        .is_ok_and(|conn| conn.is_some());
    let report = |progress: f64, message: &str| {
        if !rebuilding_ready {
            set_status(app, |s| {
                s.state = "building".into();
                s.progress = progress;
                s.message = Some(message.into());
            });
        }
    };
    report(0.0, "Baixando a base de jogos do LaunchBox…");
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(error)?;
    let mut response = client
        .get(DUMP_URL)
        .send()
        .map_err(|_| "A base de jogos não pôde ser baixada. Verifique sua conexão.".to_string())?
        .error_for_status()
        .map_err(|_| "O LaunchBox recusou o download da base de jogos.".to_string())?;
    let total = response.content_length().unwrap_or(0);
    if total > MAX_DUMP_BYTES {
        return Err("A base de jogos é maior do que o esperado.".into());
    }
    let updated_at = response
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let archive_path = dir.join("Metadata.zip.part");
    let _cleanup = BuildFiles([archive_path.clone(), dir.join("launchbox.sqlite.building")]);
    {
        let mut output =
            std::io::BufWriter::new(std::fs::File::create(&archive_path).map_err(error)?);
        let mut buffer = vec![0u8; 1024 * 1024];
        let mut done = 0u64;
        loop {
            let read = response
                .read(&mut buffer)
                .map_err(|_| "O download da base de jogos foi interrompido.".to_string())?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read]).map_err(error)?;
            done += read as u64;
            if done > MAX_DUMP_BYTES {
                return Err("A base de jogos é maior do que o esperado.".into());
            }
            if total > 0 {
                report(
                    done as f64 / total as f64 * 30.0,
                    "Baixando a base de jogos do LaunchBox…",
                );
            }
        }
        output.flush().map_err(error)?;
    }

    report(30.0, "Organizando o catálogo…");
    let building = dir.join("launchbox.sqlite.building");
    let _ = std::fs::remove_file(&building);
    let mut conn = Connection::open(&building).map_err(error)?;
    conn.execute_batch(INDEX_SCHEMA).map_err(error)?;

    let games = {
        let file = std::fs::File::open(&archive_path).map_err(error)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|_| "A base de jogos baixada está corrompida.".to_string())?;
        let entry = archive
            .by_name("Metadata.xml")
            .map_err(|_| "A base de jogos não contém a lista de jogos.".to_string())?;
        let size = entry.size().max(1);
        let count = Arc::new(AtomicU64::new(0));
        let reader = BufReader::with_capacity(
            1024 * 1024,
            Counting {
                inner: entry,
                count: count.clone(),
            },
        );
        let tx = conn.transaction().map_err(error)?;
        let games = parse(reader, &tx, || {
            report(
                30.0 + count.load(Ordering::Relaxed) as f64 / size as f64 * 65.0,
                "Organizando o catálogo…",
            )
        })?;
        tx.execute_batch(
            "CREATE INDEX names_lookup ON names(platform, norm);
             CREATE INDEX names_norm ON names(norm);
             CREATE INDEX images_game ON images(id);
             CREATE INDEX game_genres_genre ON game_genres(genre_id, game_id);
             CREATE INDEX games_platform ON games(platform, rating_count);",
        )
        .map_err(error)?;
        let now = chrono::Utc::now().timestamp().to_string();
        for (key, value) in [
            ("schema", Some(SCHEMA_VERSION.to_string())),
            ("built_at", Some(now)),
            ("updated_at", updated_at.clone()),
        ] {
            if let Some(value) = value {
                tx.execute(
                    "INSERT INTO meta(key,value) VALUES(?1,?2)",
                    params![key, value],
                )
                .map_err(error)?;
            }
        }
        tx.commit().map_err(error)?;
        games
    };
    drop(conn);
    let _ = std::fs::remove_file(&archive_path);

    // Swap the finished index in; readers wait on the lock for the instant it takes.
    let state = app.state::<LaunchboxCatalog>();
    let mut slot = state.conn.lock().map_err(error)?;
    *slot = None;
    let index = dir.join("launchbox.sqlite");
    // Rust's rename replaces the destination on Windows and Unix. Closing our
    // connection first permits replacement on Windows without a remove/rename gap.
    if let Err(err) = std::fs::rename(&building, &index) {
        *slot = Connection::open(&index).ok();
        return Err(error(err));
    }
    *slot = Some(Connection::open(&index).map_err(error)?);
    drop(slot);
    set_status(app, |s| {
        *s = CatalogStatus {
            state: "ready".into(),
            progress: 100.0,
            games,
            message: None,
            updated_at,
        }
    });
    log::info!("LaunchBox catalog ready with {games} games");
    Ok(())
}

enum Record {
    Game,
    AlternateName,
    Image,
}

/// Streams Metadata.xml. Games precede alternate names and images in the
/// dump, so both can be filtered against the kept games as they arrive.
fn parse(
    xml: impl std::io::BufRead,
    tx: &rusqlite::Transaction,
    mut progress: impl FnMut(),
) -> Result<i64> {
    let platforms: HashMap<&str, &str> = PLATFORMS.iter().copied().collect();
    let mut kept: HashMap<i64, &'static str> = HashMap::new();
    let mut genre_ids: HashMap<String, i64> = HashMap::new();
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buffer = Vec::new();
    let mut record: Option<(Record, HashMap<String, String>)> = None;
    let mut field: Option<String> = None;
    let mut events = 0u64;
    let mut game = tx
        .prepare(
            "INSERT OR REPLACE INTO games VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
        )
        .map_err(error)?;
    let mut name = tx
        .prepare("INSERT INTO names VALUES(?1,?2,?3,?4)")
        .map_err(error)?;
    let mut genre = tx
        .prepare("INSERT INTO genres(id,name) VALUES(?1,?2)")
        .map_err(error)?;
    let mut game_genre = tx
        .prepare("INSERT INTO game_genres VALUES(?1,?2)")
        .map_err(error)?;
    let mut image = tx
        .prepare("INSERT INTO images VALUES(?1,?2,?3,?4)")
        .map_err(error)?;
    loop {
        match reader.read_event_into(&mut buffer).map_err(error)? {
            Event::Start(start) => match (&record, start.name().as_ref()) {
                (None, b"Game") => record = Some((Record::Game, HashMap::new())),
                (None, b"GameAlternateName") => {
                    record = Some((Record::AlternateName, HashMap::new()))
                }
                (None, b"GameImage") => record = Some((Record::Image, HashMap::new())),
                (Some(_), tag) => field = Some(String::from_utf8_lossy(tag).into_owned()),
                _ => {}
            },
            Event::Text(text) => {
                if let (Some((_, values)), Some(key)) = (&mut record, &field) {
                    values
                        .entry(key.clone())
                        .or_default()
                        .push_str(&text.unescape().map_err(error)?);
                }
            }
            Event::CData(text) => {
                if let (Some((_, values)), Some(key)) = (&mut record, &field) {
                    values
                        .entry(key.clone())
                        .or_default()
                        .push_str(&text.decode().map_err(error)?);
                }
            }
            Event::End(end) => {
                let tag = end.name();
                let closes = matches!(tag.as_ref(), b"Game" | b"GameAlternateName" | b"GameImage");
                if closes {
                    if let Some((kind, mut values)) = record.take() {
                        for value in values.values_mut() {
                            *value = value.trim().to_string();
                        }
                        'record: {
                            let id: i64 = values
                                .get("DatabaseID")
                                .and_then(|v| v.parse().ok())
                                .unwrap_or(0);
                            match kind {
                                Record::Game => {
                                    let Some(platform) = values
                                        .get("Platform")
                                        .and_then(|p| platforms.get(p.as_str()).copied())
                                    else {
                                        break 'record;
                                    };
                                    let title = values.get("Name").cloned().unwrap_or_default();
                                    if id == 0 || title.is_empty() {
                                        break 'record;
                                    }
                                    let year = values
                                        .get("ReleaseDate")
                                        .or(values.get("ReleaseYear"))
                                        .and_then(|v| v.get(..4))
                                        .and_then(|v| v.parse::<i64>().ok());
                                    let genres = values.get("Genres").cloned().unwrap_or_default();
                                    game.execute(params![
                                        id,
                                        platform,
                                        title,
                                        year,
                                        values.get("Overview"),
                                        values.get("Developer"),
                                        values.get("Publisher"),
                                        genres,
                                        values
                                            .get("MaxPlayers")
                                            .and_then(|v| v.parse::<i64>().ok()),
                                        values.get("Cooperative").is_some_and(|v| v == "true"),
                                        values
                                            .get("CommunityRating")
                                            .and_then(|v| v.parse::<f64>().ok()),
                                        values
                                            .get("CommunityRatingCount")
                                            .and_then(|v| v.parse::<i64>().ok())
                                            .unwrap_or(0),
                                        values.get("VideoURL"),
                                        values.get("ReleaseType"),
                                    ])
                                    .map_err(error)?;
                                    name.execute(params![id, platform, normalize(&title), true])
                                        .map_err(error)?;
                                    for genre_name in
                                        genres.split(';').map(str::trim).filter(|g| !g.is_empty())
                                    {
                                        let next = genre_ids.len() as i64 + 1;
                                        let genre_id = if let Some(id) = genre_ids.get(genre_name) {
                                            *id
                                        } else {
                                            genre
                                                .execute(params![next, genre_name])
                                                .map_err(error)?;
                                            genre_ids.insert(genre_name.to_string(), next);
                                            next
                                        };
                                        game_genre.execute(params![id, genre_id]).map_err(error)?;
                                    }
                                    kept.insert(id, platform);
                                }
                                Record::AlternateName => {
                                    if let (Some(platform), Some(alternate)) =
                                        (kept.get(&id), values.get("AlternateName"))
                                    {
                                        name.execute(params![
                                            id,
                                            platform,
                                            normalize(alternate),
                                            false
                                        ])
                                        .map_err(error)?;
                                    }
                                }
                                Record::Image => {
                                    let kind = values.get("Type").map(String::as_str).unwrap_or("");
                                    if let (true, true, Some(file)) = (
                                        kept.contains_key(&id),
                                        IMAGE_TYPES.contains(&kind),
                                        values.get("FileName"),
                                    ) {
                                        image
                                            .execute(params![id, kind, values.get("Region"), file])
                                            .map_err(error)?;
                                    }
                                }
                            }
                        }
                    }
                }
                field = None;
            }
            Event::Eof => {
                if record.is_some() {
                    return Err("A base de jogos está incompleta.".into());
                }
                break;
            }
            _ => {}
        }
        buffer.clear();
        events += 1;
        if events % 200_000 == 0 {
            progress();
        }
    }
    Ok(kept.len() as i64)
}

/// No-Intro and Redump names carry region and dump tags; matching ignores
/// them, letter case, accents, a leading or trailing "The", and punctuation.
pub fn normalize(name: &str) -> String {
    let mut plain = String::with_capacity(name.len());
    let mut depth = 0;
    for c in name.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            _ => plain.extend(fold(c).to_lowercase()),
        }
    }
    let words: Vec<String> = plain
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect();
    let mut words = words;
    if words.first().is_some_and(|w| w == "the") {
        words.remove(0);
    }
    // "Legend of Zelda, The - A Link to the Past" puts the article after a comma.
    if let Some(position) = plain.find(", the") {
        let before = plain[..position]
            .split(|c: char| !c.is_ascii_alphanumeric())
            .filter(|w| !w.is_empty())
            .count();
        if words.get(before).is_some_and(|w| w == "the") {
            words.remove(before);
        }
    }
    words.join(" ")
}

fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'a',
        'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => 'i',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'Ù' | 'Ú' | 'Û' | 'Ü' => 'u',
        'ç' | 'Ç' => 'c',
        'ñ' | 'Ñ' => 'n',
        _ => c,
    }
}

fn with_index<T>(app: &tauri::AppHandle, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let state = app.state::<LaunchboxCatalog>();
    let conn = state.conn.lock().map_err(error)?;
    let conn = conn
        .as_ref()
        .ok_or("CATALOG_NOT_READY: O catálogo ainda está sendo preparado.")?;
    f(conn)
}

const GAME_COLUMNS: &str =
    "g.id, g.platform, g.name, g.year, g.overview, g.developer, g.publisher, g.genres, \
     g.players, g.cooperative, g.rating, g.rating_count, g.video";

fn cover_sql() -> String {
    format!(
        "(SELECT i.file FROM images i WHERE i.id=g.id AND i.type='Box - Front' ORDER BY {REGION_ORDER} LIMIT 1)"
    )
}
fn background_sql() -> String {
    "(SELECT i.file FROM images i WHERE i.id=g.id AND i.type IN ('Fanart - Background','Screenshot - Gameplay') \
      ORDER BY i.type='Screenshot - Gameplay' LIMIT 1)"
        .into()
}

fn youtube_id(url: &str) -> Option<String> {
    let id = url
        .split_once("v=")
        .map(|(_, rest)| rest)
        .or_else(|| url.split_once("youtu.be/").map(|(_, rest)| rest))?;
    let id: String = id
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    (6..=20).contains(&id.len()).then_some(id)
}

/// Builds the app's GameMetadata shape from a games row plus cover/background.
fn game_json(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    let id: i64 = row.get(0)?;
    let platform: String = row.get(1)?;
    let title: String = row.get(2)?;
    let year: Option<i64> = row.get(3)?;
    let overview: Option<String> = row.get(4)?;
    let developer: Option<String> = row.get(5)?;
    let publisher: Option<String> = row.get(6)?;
    let genres: Option<String> = row.get(7)?;
    let players: Option<i64> = row.get(8)?;
    let cooperative: bool = row.get(9)?;
    let rating: Option<f64> = row.get(10)?;
    let rating_count: i64 = row.get(11)?;
    let video: Option<String> = row.get(12)?;
    let cover: Option<String> = row.get(13)?;
    let background: Option<String> = row.get(14)?;
    let genres: Vec<String> = genres
        .unwrap_or_default()
        .split(';')
        .map(|g| g.trim().to_string())
        .filter(|g| !g.is_empty())
        .collect();
    let mut modes = vec![];
    if players.is_some_and(|p| p >= 1) {
        modes.push("Um jogador");
    }
    if players.is_some_and(|p| p > 1) {
        modes.push("Multijogador");
    }
    if cooperative {
        modes.push("Cooperativo");
    }
    let url = |file: Option<String>| file.map(|f| format!("{IMAGE_BASE}{f}"));
    Ok(json!({
        "id": format!("lb-{id}"),
        "externalId": id,
        "metadataProvider": "launchbox",
        "title": title,
        "platformId": platform,
        "platformIds": [platform],
        "year": year.unwrap_or(0),
        "developer": developer.filter(|d| !d.is_empty()).unwrap_or_else(|| "Desenvolvedor não informado".into()),
        "publisher": publisher,
        "description": overview.filter(|o| !o.is_empty()).unwrap_or_else(|| "Ainda não há sinopse disponível para este jogo.".into()),
        "genre": if genres.is_empty() { "Sem categoria".to_string() } else { genres.join(" · ") },
        "genres": genres,
        "artwork": "neutral",
        "color": "#cced94",
        "coverUrl": url(cover),
        "backgroundUrl": url(background),
        "sourceUrl": format!("{DETAILS_BASE}{id}"),
        "rating": rating.filter(|_| rating_count > 0).map(|r| (r * 20.0).round()),
        "ratingCount": rating_count,
        "gameModes": modes,
        "trailers": video.as_deref().and_then(youtube_id).map(|v| vec![json!({"id": v, "name": "Trailer"})]),
    }))
}

#[tauri::command]
pub fn catalog_status(app: tauri::AppHandle) -> Result<CatalogStatus> {
    Ok(app
        .state::<LaunchboxCatalog>()
        .status
        .lock()
        .map_err(error)?
        .clone())
}

#[tauri::command]
pub fn catalog_refresh(app: tauri::AppHandle) {
    spawn_build(&app);
}

#[tauri::command]
pub async fn catalog_genres(app: tauri::AppHandle) -> Result<Vec<Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        with_index(&app, |conn| {
            let mut stmt = conn
                .prepare("SELECT id, name FROM genres ORDER BY name")
                .map_err(error)?;
            let rows = stmt
                .query_map([], |r| {
                    Ok(json!({"id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?}))
                })
                .map_err(error)?;
            rows.collect::<std::result::Result<_, _>>().map_err(error)
        })
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub async fn catalog_browse(
    app: tauri::AppHandle,
    query: Option<String>,
    platform: Option<String>,
    page: Option<i64>,
    genre_id: Option<i64>,
    sort: Option<String>,
) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let page = page.unwrap_or(1).clamp(1, 10000);
        let query = normalize(query.as_deref().unwrap_or(""));
        let platform = platform.filter(|p| p != "all");
        if platform.as_ref().is_some_and(|p| !PLATFORMS.iter().any(|(_, id)| id == p)) {
            return Err("Console não suportado.".into());
        }
        let mut conditions = vec![format!("IFNULL(g.release_type,'') NOT IN {HIDDEN_RELEASES}")];
        let mut values: Vec<rusqlite::types::Value> = vec![];
        if let Some(platform) = &platform {
            conditions.push("g.platform=?".into());
            values.push(platform.clone().into());
        }
        if let Some(genre) = genre_id {
            conditions.push("g.id IN (SELECT game_id FROM game_genres WHERE genre_id=?)".into());
            values.push(genre.into());
        }
        let order = if query.is_empty() {
            match sort.as_deref().unwrap_or("popular") {
                "rating" => {
                    conditions.push("g.rating_count >= 5".into());
                    "g.rating DESC, g.rating_count DESC"
                }
                "title" => "g.name COLLATE NOCASE",
                "newest" => "g.year DESC NULLS LAST, g.rating_count DESC",
                "oldest" => "g.year ASC NULLS LAST, g.rating_count DESC",
                "popular" => "g.rating_count DESC, g.rating DESC",
                _ => return Err("Ordenação inválida para o catálogo.".into()),
            }
            .to_string()
        } else {
            if query.chars().count() > 120 {
                return Err("A busca deve ter no máximo 120 caracteres.".into());
            }
            conditions.push("g.id IN (SELECT id FROM names WHERE norm LIKE ?)".into());
            values.push(format!("%{query}%").into());
            // Exact titles first, then titles starting with the search, then the rest.
            values.push(query.clone().into());
            values.push(format!("{query}%").into());
            "(SELECT MIN(CASE WHEN n.norm=? THEN 0 WHEN n.norm LIKE ? THEN 1 ELSE 2 END) FROM names n WHERE n.id=g.id), \
             g.rating_count DESC"
                .to_string()
        };
        values.push((PAGE_SIZE + 1).into());
        values.push(((page - 1) * PAGE_SIZE).into());
        let sql = format!(
            "SELECT {GAME_COLUMNS}, {}, {} FROM games g WHERE {} ORDER BY {order} LIMIT ? OFFSET ?",
            cover_sql(),
            background_sql(),
            conditions.join(" AND ")
        );
        with_index(&app, |conn| {
            let mut stmt = conn.prepare(&sql).map_err(error)?;
            let mut games: Vec<Value> = stmt
                .query_map(params_from_iter(values.iter()), game_json)
                .map_err(error)?
                .collect::<std::result::Result<_, _>>()
                .map_err(error)?;
            let has_next = games.len() as i64 > PAGE_SIZE;
            games.truncate(PAGE_SIZE as usize);
            Ok(json!({"games": games, "hasNext": has_next, "page": page}))
        })
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub async fn catalog_game(app: tauri::AppHandle, id: i64) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        with_index(&app, |conn| {
            let sql = format!(
                "SELECT {GAME_COLUMNS}, {}, {} FROM games g WHERE g.id=?1",
                cover_sql(),
                background_sql()
            );
            let mut game = conn
                .query_row(&sql, [id], game_json)
                .optional()
                .map_err(error)?
                .ok_or("Este jogo não está no catálogo.")?;
            let mut stmt = conn
                .prepare(
                    "SELECT file FROM images WHERE id=?1 AND type='Screenshot - Gameplay' LIMIT 8",
                )
                .map_err(error)?;
            let screenshots: Vec<String> = stmt
                .query_map([id], |r| {
                    Ok(format!("{IMAGE_BASE}{}", r.get::<_, String>(0)?))
                })
                .map_err(error)?
                .collect::<std::result::Result<_, _>>()
                .map_err(error)?;
            game["screenshots"] = json!(screenshots);
            Ok(game)
        })
    })
    .await
    .map_err(error)?
}

/// Best catalog entry for a file or title on a console, preferring the
/// canonical name, real releases over hacks, then the best-known entry.
pub fn best_match(conn: &Connection, platform: &str, name: &str) -> Result<Option<Value>> {
    // Strip a file extension, but keep titles like "Super Mario Bros. 3".
    let stem = match name.rsplit_once('.') {
        Some((base, ext))
            if !crate::filesystem::platform_ids_for_extension(&ext.to_ascii_lowercase())
                .is_empty() =>
        {
            base
        }
        _ => name,
    };
    let norm = normalize(stem);
    if norm.is_empty() {
        return Ok(None);
    }
    let sql = format!(
        "SELECT {GAME_COLUMNS}, {}, {} FROM games g JOIN names n ON n.id=g.id \
         WHERE n.platform=?1 AND n.norm=?2 \
         ORDER BY IFNULL(g.release_type,'') IN ('ROM Hack','Homebrew','DLC'), n.canonical DESC, g.rating_count DESC, g.id \
         LIMIT 1",
        cover_sql(),
        background_sql()
    );
    conn.query_row(&sql, params![platform, norm], game_json)
        .optional()
        .map_err(error)
}

#[tauri::command]
pub async fn catalog_match(
    app: tauri::AppHandle,
    platform: String,
    name: String,
) -> Result<Option<Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        with_index(&app, |conn| best_match(conn, &platform, &name))
    })
    .await
    .map_err(error)?
}

fn decode_thumbnail(bytes: Vec<u8>) -> Result<image::RgbImage> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(error)?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    reader.limits(limits);
    Ok(reader
        .decode()
        .map_err(error)?
        .thumbnail(600, 400)
        .to_rgb8())
}

/// LaunchBox exposes original images. Cache bounded thumbnails locally instead of
/// relying on undocumented CDN transformation URLs or decoding originals in the grid.
#[tauri::command]
pub async fn catalog_thumbnail(app: tauri::AppHandle, url: String) -> Result<String> {
    static SLOTS: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    let _permit = SLOTS
        .get_or_init(|| tokio::sync::Semaphore::new(3))
        .acquire()
        .await
        .map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || {
        use sha2::{Digest, Sha256};
        let file = url
            .strip_prefix(IMAGE_BASE)
            .ok_or("Origem da imagem inválida.")?;
        if file.is_empty()
            || file.len() > 160
            || !file
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        {
            return Err("Nome de arquivo da imagem inválido.".into());
        }
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(error)?
            .join("launchbox-thumbnails");
        std::fs::create_dir_all(&directory).map_err(error)?;
        let key = format!("{:x}", Sha256::digest(url.as_bytes()));
        let path = directory.join(format!("{key}.jpg"));
        if !path.is_file() {
            let client = reqwest::blocking::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(error)?;
            let response = client
                .get(&url)
                .send()
                .map_err(error)?
                .error_for_status()
                .map_err(error)?;
            const LIMIT: u64 = 16 * 1024 * 1024;
            if response.content_length().is_some_and(|size| size > LIMIT) {
                return Err("A imagem é maior do que o permitido.".into());
            }
            let mut bytes = Vec::new();
            response
                .take(LIMIT + 1)
                .read_to_end(&mut bytes)
                .map_err(error)?;
            if bytes.len() as u64 > LIMIT {
                return Err("A imagem é maior do que o permitido.".into());
            }
            let thumbnail = decode_thumbnail(bytes)?;
            let temporary = directory.join(format!("{key}-{}.tmp", uuid::Uuid::new_v4()));
            thumbnail
                .save_with_format(&temporary, image::ImageFormat::Jpeg)
                .map_err(error)?;
            if let Err(err) = std::fs::rename(&temporary, &path) {
                let _ = std::fs::remove_file(&temporary);
                if !path.is_file() {
                    return Err(error(err));
                }
            }
        }
        Ok(path.to_string_lossy().into_owned())
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnails_bound_image_dimensions_and_reject_invalid_data() {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1920, 1080)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let thumbnail = decode_thumbnail(bytes.into_inner()).unwrap();
        assert_eq!(thumbnail.dimensions(), (600, 338));
        assert!(decode_thumbnail(b"not an image".to_vec()).is_err());
    }

    #[test]
    fn rejects_incomplete_xml_records() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(INDEX_SCHEMA).unwrap();
        let tx = conn.transaction().unwrap();
        assert!(parse(
            "<LaunchBox><Game><Name>Broken</Name>".as_bytes(),
            &tx,
            || {}
        )
        .is_err());
    }

    #[test]
    #[ignore = "requires OPENRETRO_TEST_DUMP pointing to the public Metadata.zip"]
    fn indexes_public_dump() {
        let file =
            std::fs::File::open(std::env::var("OPENRETRO_TEST_DUMP").expect("dump path")).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let entry = archive.by_name("Metadata.xml").unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(INDEX_SCHEMA).unwrap();
        let tx = conn.transaction().unwrap();
        let games = parse(BufReader::with_capacity(1024 * 1024, entry), &tx, || {}).unwrap();
        assert!(games > 40000, "supported games: {games}");
        tx.commit().unwrap();
        conn.execute_batch("CREATE INDEX names_lookup ON names(platform,norm); CREATE INDEX images_game ON images(id);").unwrap();
        let game = best_match(&conn, "snes", "Super Metroid (Japan, USA) (En,Ja).sfc")
            .unwrap()
            .unwrap();
        assert_eq!(game["title"], "Super Metroid");
        assert!(game["coverUrl"].as_str().unwrap().starts_with(IMAGE_BASE));
        let nfs = best_match(
            &conn,
            "ps2",
            "Need for Speed Underground [NTSC] [DVD-5].ISO",
        )
        .unwrap()
        .unwrap();
        assert!(nfs["title"].as_str().unwrap().contains("Underground"));
        println!(
            "Indexed {games} games; matched Super Metroid and {}",
            nfs["title"]
        );
    }

    #[test]
    fn normalizes_no_intro_and_redump_names() {
        assert_eq!(
            normalize("Super Metroid (Japan, USA) (En,Ja)"),
            "super metroid"
        );
        assert_eq!(
            normalize("Need for Speed Underground [NTSC] [DVD-5]"),
            "need for speed underground"
        );
        assert_eq!(
            normalize("Need for Speed: Underground"),
            "need for speed underground"
        );
        assert_eq!(
            normalize("Legend of Zelda, The - A Link to the Past (USA)"),
            normalize("The Legend of Zelda: A Link to the Past")
        );
        assert_eq!(
            normalize("Pokémon - Emerald Version (USA, Europe)"),
            "pokemon emerald version"
        );
        assert_eq!(normalize("(Proto)"), "");
    }

    #[test]
    fn parses_games_and_prefers_real_releases_when_matching() {
        let xml = r#"<LaunchBox>
          <Game><Name>Super Metroid</Name><DatabaseID>299</DatabaseID><Platform>Super Nintendo Entertainment System</Platform>
            <ReleaseDate>1994-03-19</ReleaseDate><ReleaseType>Released</ReleaseType><Genres>Adventure; Platform</Genres>
            <CommunityRating>4.7</CommunityRating><CommunityRatingCount>1021</CommunityRatingCount>
            <MaxPlayers>1</MaxPlayers><Cooperative>false</Cooperative><VideoURL>https://www.youtube.com/watch?v=gTFyGshP_DA</VideoURL>
            <Developer><![CDATA[Nintendo & R&D]]></Developer><Overview>Samus &amp; the Space Pirates.</Overview></Game>
          <Game><Name>Super Metroid</Name><DatabaseID>143241</DatabaseID><Platform>Super Nintendo Entertainment System</Platform>
            <ReleaseType>ROM Hack</ReleaseType><Genres>Platform</Genres><CommunityRatingCount>5000</CommunityRatingCount></Game>
          <Game><Name>Halo</Name><DatabaseID>7</DatabaseID><Platform>Microsoft Xbox</Platform><Genres>Shooter</Genres></Game>
          <GameAlternateName><AlternateName>Metroid Bros. 3</AlternateName><DatabaseID>299</DatabaseID></GameAlternateName>
          <GameAlternateName><AlternateName>Metroid 3</AlternateName><DatabaseID>299</DatabaseID></GameAlternateName>
          <GameAlternateName><AlternateName>Halo CE</AlternateName><DatabaseID>7</DatabaseID></GameAlternateName>
          <GameImage><DatabaseID>299</DatabaseID><FileName>a.jpg</FileName><Type>Box - Front</Type><Region>Japan</Region></GameImage>
          <GameImage><DatabaseID>299</DatabaseID><FileName>b.jpg</FileName><Type>Box - Front</Type><Region>North America</Region></GameImage>
          <GameImage><DatabaseID>299</DatabaseID><FileName>c.jpg</FileName><Type>Banner</Type></GameImage>
        </LaunchBox>"#;
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(INDEX_SCHEMA).unwrap();
        let tx = conn.transaction().unwrap();
        assert_eq!(parse(xml.as_bytes(), &tx, || {}).unwrap(), 2);
        tx.commit().unwrap();
        let images: i64 = conn
            .query_row("SELECT COUNT(*) FROM images", [], |r| r.get(0))
            .unwrap();
        assert_eq!(images, 2, "only kept games and wanted image types");
        let found = best_match(&conn, "snes", "Super Metroid (Japan, USA) (En,Ja).sfc")
            .unwrap()
            .unwrap();
        assert_eq!(found["externalId"], 299);
        assert_eq!(found["year"], 1994);
        assert_eq!(found["developer"], "Nintendo & R&D");
        assert!(best_match(&conn, "snes", "Metroid Bros. 3")
            .unwrap()
            .is_some());
        assert_eq!(found["rating"], 94.0);
        assert_eq!(found["description"], "Samus & the Space Pirates.");
        assert_eq!(found["coverUrl"], format!("{IMAGE_BASE}b.jpg"));
        assert_eq!(found["trailers"][0]["id"], "gTFyGshP_DA");
        assert_eq!(found["genres"], json!(["Adventure", "Platform"]));
        let alias = best_match(&conn, "snes", "Metroid 3").unwrap().unwrap();
        assert!(best_match(&conn, "snes", "Super Metroid.sfc")
            .unwrap()
            .is_some());
        assert_eq!(alias["externalId"], 299);
        assert!(best_match(&conn, "nes", "Super Metroid").unwrap().is_none());
    }
}
