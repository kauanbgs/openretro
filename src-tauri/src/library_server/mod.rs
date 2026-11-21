//! Library server: this PC's game library, served to other OpenRetro apps.
//! A second PC adds this one as a source, lists the games and downloads the
//! ROMs it wants. The server listens on every interface so it works on the
//! Tailscale, and on the local network when the owner allows it; every
//! request must carry the pairing token, which stays the same until the
//! owner resets it. Requests from anywhere else are refused before the token
//! is looked at. Only files that are in the
//! library can be reached, always by library id, never by path.
use crate::database::{error, Database, Result};
use crate::remote_play::{new_token, qr_svg, token_matches};
use axum::{
    body::Body,
    extract::{ConnectInfo, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::SeekFrom;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::oneshot;
use tokio_util::io::ReaderStream;

pub const LIBRARY_PORT: u16 = 47821;
const SETTINGS_KEY: &str = "library_server";

#[derive(Default)]
pub struct LibraryServer(Mutex<Option<Running>>);

struct Running {
    shutdown: oneshot::Sender<()>,
    shared: Arc<Shared>,
}

struct Shared {
    app: tauri::AppHandle,
    token: String,
    /// Whether devices on the local network may connect, besides Tailscale.
    lan: AtomicBool,
}

#[derive(Deserialize)]
struct Auth {
    t: Option<String>,
}

// ---- configuration: the token and whether the server starts with the app ----

fn read_config(db: &Database) -> Value {
    db.read()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT value FROM settings WHERE key=?1",
                [SETTINGS_KEY],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

fn write_config(db: &Database, config: &Value) -> Result<()> {
    db.0.lock()
        .map_err(error)?
        .execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [SETTINGS_KEY, &config.to_string()],
        )
        .map_err(error)?;
    Ok(())
}

/// The saved token, created the first time it is needed.
fn token_of(db: &Database) -> Result<String> {
    let mut config = read_config(db);
    if let Some(token) = config["token"].as_str().filter(|t| t.len() == 32) {
        return Ok(token.to_string());
    }
    let token = new_token();
    config["token"] = json!(token);
    write_config(db, &config)?;
    Ok(token)
}

/// Off unless the owner turned it on: the local network is not encrypted.
fn lan_enabled(db: &Database) -> bool {
    read_config(db)["lan"].as_bool().unwrap_or(false)
}

fn set_enabled(db: &Database, enabled: bool) -> Result<()> {
    let mut config = read_config(db);
    config["enabled"] = json!(enabled);
    write_config(db, &config)
}

// ---- addresses ----

/// Tailscale gives each device an address in 100.64.0.0/10.
pub(crate) fn is_tailscale(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 100 && (64..128).contains(&b)
}

/// Who may even reach the server: this PC, Tailscale, and, if allowed, the
/// private ranges of a home or office network. Never the internet.
fn peer_allowed(ip: IpAddr, lan: bool) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_loopback() || is_tailscale(ip) || (lan && is_lan(ip)),
        IpAddr::V6(ip) => ip.is_loopback(),
    }
}

/// 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16.
pub(crate) fn is_lan(ip: Ipv4Addr) -> bool {
    ip.is_private()
}

// ---- status and commands ----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryServerStatus {
    running: bool,
    port: u16,
    /// Address and token in one link, the way another OpenRetro pairs.
    url: Option<String>,
    qr: Option<String>,
    token: Option<String>,
    tailscale: Option<String>,
    /// This PC's local-network address, shown only while that is allowed.
    lan: Option<String>,
    lan_enabled: bool,
    /// Pairing link for the local network, when allowed.
    lan_url: Option<String>,
    games: usize,
}

fn pairing_url(address: &str, token: &str) -> String {
    format!("http://{address}:{LIBRARY_PORT}/?t={token}")
}

fn status(app: &tauri::AppHandle) -> Result<LibraryServerStatus> {
    let running = app
        .state::<LibraryServer>()
        .0
        .lock()
        .map_err(error)?
        .is_some();
    let db = app.state::<Database>();
    let mut status = LibraryServerStatus {
        running,
        port: LIBRARY_PORT,
        url: None,
        qr: None,
        token: None,
        tailscale: None,
        lan: None,
        lan_enabled: lan_enabled(&db),
        lan_url: None,
        games: 0,
    };
    if !running {
        return Ok(status);
    }
    let token = token_of(&db)?;
    status.tailscale = crate::tailscale::address();
    if status.lan_enabled {
        status.lan = crate::launcher::netplay::netplay_local_address();
        status.lan_url = status
            .lan
            .as_deref()
            .map(|address| pairing_url(address, &token));
    }
    // Tailscale first: it is the address that also works away from home.
    status.url = status
        .tailscale
        .as_deref()
        .map(|address| pairing_url(address, &token))
        .or_else(|| status.lan_url.clone());
    status.qr = status.url.as_deref().and_then(qr_svg);
    let conn = db.read()?;
    status.games = shareable(&conn)?.len();
    status.token = Some(token);
    Ok(status)
}

#[tauri::command]
pub fn library_server_status(app: tauri::AppHandle) -> Result<LibraryServerStatus> {
    status(&app)
}

#[tauri::command]
pub async fn library_server_start(app: tauri::AppHandle) -> Result<LibraryServerStatus> {
    start(&app).await?;
    set_enabled(&app.state::<Database>(), true)?;
    status(&app)
}

#[tauri::command]
pub fn library_server_stop(app: tauri::AppHandle) -> Result<LibraryServerStatus> {
    stop(&app)?;
    set_enabled(&app.state::<Database>(), false)?;
    status(&app)
}

/// Lets devices on the local network connect too, or stops that, at once.
#[tauri::command]
pub fn library_server_set_lan(app: tauri::AppHandle, enabled: bool) -> Result<LibraryServerStatus> {
    let db = app.state::<Database>();
    let mut config = read_config(&db);
    config["lan"] = json!(enabled);
    write_config(&db, &config)?;
    if let Some(running) = app.state::<LibraryServer>().0.lock().map_err(error)?.as_ref() {
        running.shared.lan.store(enabled, Ordering::Release);
    }
    status(&app)
}

/// A new token, which signs out every device that was paired.
#[tauri::command]
pub async fn library_server_reset_token(app: tauri::AppHandle) -> Result<LibraryServerStatus> {
    let was_running = stop(&app)?;
    let db = app.state::<Database>();
    let mut config = read_config(&db);
    config["token"] = json!(new_token());
    write_config(&db, &config)?;
    if was_running {
        start(&app).await?;
    }
    status(&app)
}

/// Starts the server again when the owner left it on.
pub fn resume(app: &tauri::AppHandle) {
    if read_config(&app.state::<Database>())["enabled"].as_bool() != Some(true) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(message) = start(&app).await {
            log::warn!("Library server did not start: {message}");
        }
    });
}

fn stop(app: &tauri::AppHandle) -> Result<bool> {
    let running = app.state::<LibraryServer>().0.lock().map_err(error)?.take();
    let was_running = running.is_some();
    if let Some(running) = running {
        let _ = running.shutdown.send(());
    }
    Ok(was_running)
}

async fn start(app: &tauri::AppHandle) -> Result<()> {
    if app.state::<LibraryServer>().0.lock().map_err(error)?.is_some() {
        return Ok(());
    }
    let db = app.state::<Database>();
    let shared = Arc::new(Shared {
        app: app.clone(),
        token: token_of(&db)?,
        lan: AtomicBool::new(lan_enabled(&db)),
    });
    let router = Router::new()
        .route("/api/info", get(info))
        .route("/api/library", get(library))
        .route("/api/source", get(source))
        .route("/api/games/{id}/file", get(game_file))
        .route("/api/games/{id}/file/{name}", get(game_file_named))
        .route("/api/games/{id}/cover", get(game_cover))
        .with_state(shared.clone());
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", LIBRARY_PORT))
        .await
        .map_err(|_| format!("A porta {LIBRARY_PORT} já está em uso por outro programa."))?;
    let (shutdown, stopped) = oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let served = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await;
        if let Err(e) = served {
            log::warn!("Library server stopped: {e}");
        }
    });
    *app.state::<LibraryServer>().0.lock().map_err(error)? = Some(Running { shutdown, shared });
    Ok(())
}

// ---- requests ----

/// The token, from `Authorization: Bearer` or, for image tags, `?t=`.
fn authorized(shared: &Shared, headers: &HeaderMap, auth: &Auth, peer: SocketAddr) -> bool {
    peer_allowed(peer.ip(), shared.lan.load(Ordering::Acquire))
        && headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .or(auth.t.as_deref())
        .is_some_and(|given| token_matches(&shared.token, given))
}

/// The library entries another PC can download: installed, and a single file.
fn shareable(conn: &rusqlite::Connection) -> Result<Vec<crate::models::LibraryGame>> {
    Ok(crate::database::library(conn)?
        .into_iter()
        .filter(|entry| {
            entry.item.installed
                && std::path::Path::new(&entry.item.source_path).is_file()
        })
        .collect())
}

fn cover_path(app: &tauri::AppHandle, cover_url: Option<&str>) -> Option<std::path::PathBuf> {
    let url = cover_url?;
    let key = format!("{:x}", Sha256::digest(url.as_bytes()));
    let path = app
        .path()
        .app_cache_dir()
        .ok()?
        .join("launchbox-thumbnails")
        .join(format!("{key}.jpg"));
    path.is_file().then_some(path)
}

async fn info(
    State(shared): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&shared, &headers, &auth, peer) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let games = shared
        .app
        .state::<Database>()
        .read()
        .and_then(|conn| shareable(&conn))
        .map_or(0, |games| games.len());
    Json(json!({
        "name": std::env::var("COMPUTERNAME").unwrap_or_else(|_| "OpenRetro".into()),
        "app": "openretro",
        "version": env!("CARGO_PKG_VERSION"),
        "games": games,
    }))
    .into_response()
}

async fn library(
    State(shared): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&shared, &headers, &auth, peer) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let games = shared
        .app
        .state::<Database>()
        .read()
        .and_then(|conn| shareable(&conn));
    let Ok(games) = games else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let entries: Vec<Value> = games
        .iter()
        .map(|entry| {
            let path = std::path::Path::new(&entry.item.source_path);
            json!({
                "id": entry.item.id,
                "title": entry.game.title,
                "platformId": entry.item.platform_id,
                "year": entry.game.year,
                "developer": entry.game.developer,
                "genre": entry.game.genre,
                "description": entry.game.description,
                "fileName": path.file_name().and_then(|n| n.to_str()),
                "size": path.metadata().map_or(0, |meta| meta.len()),
                "sha256": entry.item.sha256,
                "hasCover": cover_path(&shared.app, entry.game.cover_url.as_deref()).is_some(),
            })
        })
        .collect();
    Json(entries).into_response()
}

/// The library as a download source, the format another OpenRetro already
/// reads: adding this address as a source lists these games as downloads.
/// Links point back at the address the request came to.
async fn source(
    State(shared): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(auth): Query<Auth>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&shared, &headers, &auth, peer) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .filter(|host| host.parse::<std::net::SocketAddr>().is_ok())
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let games = shared
        .app
        .state::<Database>()
        .read()
        .and_then(|conn| shareable(&conn));
    let Ok(games) = games else {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };
    let downloads: Vec<Value> = games
        .iter()
        .map(|entry| {
            let path = std::path::Path::new(&entry.item.source_path);
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("game");
            json!({
                "title": entry.game.title,
                "uris": [format!(
                    "http://{host}/api/games/{}/file/{}?t={}",
                    entry.item.id,
                    percent_encode(name),
                    shared.token
                )],
                "fileSize": human_size(path.metadata().map_or(0, |meta| meta.len())),
                "uploadDate": entry.item.added_at.get(..10).unwrap_or_default(),
            })
        })
        .collect();
    let computer = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "OpenRetro".into());
    Json(json!({ "name": format!("OpenRetro · {computer}"), "downloads": downloads }))
        .into_response()
}

/// Same file under a URL that ends in its real name, which is what the
/// downloader names the saved file after.
async fn game_file_named(
    state: State<Arc<Shared>>,
    peer: ConnectInfo<SocketAddr>,
    Path((id, _name)): Path<(String, String)>,
    auth: Query<Auth>,
    headers: HeaderMap,
) -> Response {
    game_file(state, peer, Path(id), auth, headers).await
}

/// The ROM of a library item, by id, with `Range` so downloads can resume.
async fn game_file(
    State(shared): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Query(auth): Query<Auth>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&shared, &headers, &auth, peer) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let path = shared
        .app
        .state::<Database>()
        .read()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT source_path FROM library_items WHERE id=?1 AND installed=1",
                [&id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        });
    let Some(path) = path else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    serve_file(std::path::Path::new(&path), range).await
}

async fn game_cover(
    State(shared): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
    Query(auth): Query<Auth>,
    headers: HeaderMap,
) -> Response {
    if !authorized(&shared, &headers, &auth, peer) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let metadata = shared
        .app
        .state::<Database>()
        .read()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT g.metadata FROM library_items l JOIN games g ON g.id=l.game_id WHERE l.id=?1",
                [&id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .and_then(|raw| serde_json::from_str::<crate::models::GameMetadata>(&raw).ok());
    let Some(path) = metadata.and_then(|game| cover_path(&shared.app, game.cover_url.as_deref()))
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, "image/jpeg"),
                (header::CACHE_CONTROL, "private, max-age=86400"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ---- file streaming ----

#[derive(Debug, PartialEq)]
enum Span {
    Whole,
    Part(u64, u64),
    Unsatisfiable,
}

/// A `Range: bytes=…` header against a file of `len` bytes. Multiple or
/// malformed ranges fall back to the whole file, as the standard allows.
fn parse_range(header: Option<&str>, len: u64) -> Span {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else {
        return Span::Whole;
    };
    if spec.contains(',') {
        return Span::Whole;
    }
    let Some((first, last)) = spec.split_once('-') else {
        return Span::Whole;
    };
    let (first, last) = (first.trim(), last.trim());
    if first.is_empty() {
        let Ok(count) = last.parse::<u64>() else {
            return Span::Whole;
        };
        if count == 0 || len == 0 {
            return Span::Unsatisfiable;
        }
        return Span::Part(len.saturating_sub(count), len - 1);
    }
    let Ok(start) = first.parse::<u64>() else {
        return Span::Whole;
    };
    if start >= len {
        return Span::Unsatisfiable;
    }
    let end = if last.is_empty() {
        len - 1
    } else {
        match last.parse::<u64>() {
            Ok(end) => end.min(len - 1),
            Err(_) => return Span::Whole,
        }
    };
    if end < start {
        return Span::Whole;
    }
    Span::Part(start, end)
}

fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

/// A header-safe file name: anything outside printable ASCII becomes `_`.
fn ascii_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' })
        .collect()
}

async fn serve_file(path: &std::path::Path, range: Option<&str>) -> Response {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(meta) = file.metadata().await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !meta.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    let len = meta.len();
    let (status, start, count, content_range) = match parse_range(range, len) {
        Span::Whole => (StatusCode::OK, 0, len, None),
        Span::Part(start, end) => (
            StatusCode::PARTIAL_CONTENT,
            start,
            end - start + 1,
            Some(format!("bytes {start}-{end}/{len}")),
        ),
        Span::Unsatisfiable => {
            return (
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{len}"))],
            )
                .into_response();
        }
    };
    if start > 0 && file.seek(SeekFrom::Start(start)).await.is_err() {
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map_or_else(|| "game".to_string(), ascii_name);
    let body = Body::from_stream(ReaderStream::with_capacity(file.take(count), 256 * 1024));
    let mut response = Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, "application/octet-stream".parse().unwrap());
    headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    headers.insert(header::CONTENT_LENGTH, count.to_string().parse().unwrap());
    if let Ok(value) = format!("attachment; filename=\"{name}\"").parse() {
        headers.insert(header::CONTENT_DISPOSITION, value);
    }
    if let Some(range) = content_range {
        headers.insert(header::CONTENT_RANGE, range.parse().unwrap());
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_follow_the_http_rules() {
        assert_eq!(parse_range(None, 100), Span::Whole);
        assert_eq!(parse_range(Some("bytes=0-9"), 100), Span::Part(0, 9));
        assert_eq!(parse_range(Some("bytes=90-"), 100), Span::Part(90, 99));
        assert_eq!(parse_range(Some("bytes=90-500"), 100), Span::Part(90, 99));
        assert_eq!(parse_range(Some("bytes=-10"), 100), Span::Part(90, 99));
        assert_eq!(parse_range(Some("bytes=-500"), 100), Span::Part(0, 99));
        assert_eq!(parse_range(Some("bytes=100-"), 100), Span::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=-0"), 100), Span::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=0-"), 0), Span::Unsatisfiable);
        assert_eq!(parse_range(Some("bytes=0-1,5-6"), 100), Span::Whole);
        assert_eq!(parse_range(Some("bytes=9-3"), 100), Span::Whole);
        assert_eq!(parse_range(Some("items=0-9"), 100), Span::Whole);
        assert_eq!(parse_range(Some("bytes=x-9"), 100), Span::Whole);
    }

    #[test]
    fn only_trusted_networks_may_connect() {
        let ip = |text: &str| -> IpAddr { text.parse().unwrap() };
        // This PC and Tailscale always; the local network only when allowed.
        assert!(peer_allowed(ip("127.0.0.1"), false));
        assert!(peer_allowed(ip("100.101.102.103"), false));
        assert!(!peer_allowed(ip("192.168.0.20"), false));
        assert!(peer_allowed(ip("192.168.0.20"), true));
        assert!(peer_allowed(ip("10.1.2.3"), true));
        assert!(peer_allowed(ip("172.16.0.5"), true));
        assert!(!peer_allowed(ip("172.32.0.5"), true));
        // Never the internet, whatever the setting.
        assert!(!peer_allowed(ip("8.8.8.8"), true));
        assert!(!peer_allowed(ip("100.128.0.1"), true));
        assert!(!peer_allowed(ip("2001:db8::1"), true));
        assert!(peer_allowed(ip("::1"), false));
    }

    #[test]
    fn recognizes_tailscale_addresses() {
        assert!(is_tailscale("100.64.0.1".parse().unwrap()));
        assert!(is_tailscale("100.127.255.254".parse().unwrap()));
        assert!(!is_tailscale("100.128.0.1".parse().unwrap()));
        assert!(!is_tailscale("100.63.0.1".parse().unwrap()));
        assert!(!is_tailscale("192.168.0.10".parse().unwrap()));
    }

    #[test]
    fn source_links_encode_names_and_sizes_read_naturally() {
        assert_eq!(percent_encode("Tekken 5 (USA).iso"), "Tekken%205%20%28USA%29.iso");
        assert_eq!(percent_encode("Pokémon.gba"), "Pok%C3%A9mon.gba");
        assert_eq!(human_size(512), "512 B");
        assert_eq!(human_size(1536), "1.5 KB");
        assert_eq!(human_size(5 * 1024 * 1024 * 1024), "5.0 GB");
    }

    #[test]
    fn file_names_are_header_safe() {
        assert_eq!(ascii_name("Pokémon \"X\".gba"), "Pok_mon _X_.gba");
        assert_eq!(ascii_name("a\r\nb"), "a__b");
    }

    async fn body_of(response: Response) -> Vec<u8> {
        axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec()
    }

    #[test]
    fn serves_whole_files_and_resumed_ranges() {
        let dir = std::env::temp_dir().join(format!("openretro-lib-{}", new_token()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("game.gba");
        let data: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
        std::fs::write(&file, &data).unwrap();
        tauri::async_runtime::block_on(async {
            let whole = serve_file(&file, None).await;
            assert_eq!(whole.status(), StatusCode::OK);
            assert_eq!(whole.headers()[header::CONTENT_LENGTH], "1000");
            assert_eq!(body_of(whole).await, data);

            let part = serve_file(&file, Some("bytes=250-499")).await;
            assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
            assert_eq!(part.headers()[header::CONTENT_RANGE], "bytes 250-499/1000");
            assert_eq!(part.headers()[header::CONTENT_LENGTH], "250");
            assert_eq!(body_of(part).await, data[250..500]);

            let tail = serve_file(&file, Some("bytes=900-")).await;
            assert_eq!(body_of(tail).await, data[900..]);

            let past = serve_file(&file, Some("bytes=1000-")).await;
            assert_eq!(past.status(), StatusCode::RANGE_NOT_SATISFIABLE);
            assert_eq!(past.headers()[header::CONTENT_RANGE], "bytes */1000");

            let missing = serve_file(&dir.join("nope.gba"), None).await;
            assert_eq!(missing.status(), StatusCode::NOT_FOUND);
            let folder = serve_file(&dir, None).await;
            assert_eq!(folder.status(), StatusCode::NOT_FOUND);
        });
        let _ = std::fs::remove_dir_all(&dir);
    }
}
