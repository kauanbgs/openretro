//! Translations and ROM hacks as variants of a game in the library.
//!
//! A variant is a patched copy that OpenRetro writes to its own data folder;
//! the original file is only ever read. Variants belong to their library item,
//! so the library shows one game with versions to choose from, and Play starts
//! whichever version is selected. A copy is registered only after it was
//! written completely and verified, so a failed or cancelled install never
//! leaves a half-written game to be played.
pub mod archive;
pub mod catalog;
pub mod formats;
pub mod romhackplaza;

use crate::{
    database::{error, Database, Result},
    models::ActiveVariant,
};
use catalog::{Compatibility, Entry, Fingerprint, Hashes, Listing, Status};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::SystemTime,
};
use tauri::{Emitter, Manager};
use tokio_util::sync::CancellationToken;

pub const BUNDLED_SOURCE: &str = "openretro";
/// Larger downloads are not patches; the bundled catalog's largest is 4 MB.
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
const PLAZA_KEY: &str = "romhackplaza_api_key";

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub id: String,
    pub library_item_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    /// "translation", "romhack" or "local" for a patch imported by hand.
    pub kind: String,
    pub entry_id: Option<String>,
    pub source_id: String,
    pub source_name: String,
    pub version: Option<String>,
    pub language: Option<String>,
    pub authors: Vec<String>,
    pub credits: Vec<String>,
    pub source_url: Option<String>,
    pub license: Option<String>,
    pub format: String,
    /// "shared" or "separate".
    pub saves: String,
    /// How compatibility stood when it was installed.
    pub compatibility: Status,
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub created_at: String,
}

/// Built from the library query; malformed rows simply have no variant.
pub fn active_from_row(
    id: Option<String>,
    path: Option<String>,
    sha256: Option<String>,
    data: Option<String>,
) -> Option<ActiveVariant> {
    let variant: Variant = serde_json::from_str(&data?).ok()?;
    Some(ActiveVariant {
        id: id?,
        name: variant.name,
        path: path?,
        sha256: sha256?,
        saves_shared: variant.saves == "shared",
    })
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRequest {
    pub library_item_id: String,
    #[serde(default)]
    pub parent_variant_id: Option<String>,
    /// "catalog", "romhackplaza" or "local".
    pub origin: String,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub entry_id: Option<String>,
    #[serde(default)]
    pub local_path: Option<String>,
    /// The patch inside a ZIP or 7z, when the package has several.
    #[serde(default)]
    pub archive_path: Option<String>,
    /// The Romhack Plaza file, when the entry offers several.
    #[serde(default)]
    pub download_file: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    /// The player accepted installing without a confirmed original.
    #[serde(default)]
    pub confirm_unknown: bool,
    /// The player accepted patching a version that is already modified.
    #[serde(default)]
    pub confirm_stack: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModJob {
    pub id: String,
    pub library_item_id: String,
    pub name: String,
    /// QUEUED, DOWNLOADING, PATCHING, VERIFYING, COMPLETED, FAILED, CANCELLED or NEEDS_CHOICE.
    pub state: String,
    pub progress: f64,
    pub stage: String,
    pub error: Option<String>,
    /// "archive" or "file" with the options, for NEEDS_CHOICE.
    pub choice_kind: Option<String>,
    pub choices: Vec<String>,
    pub variant_id: Option<String>,
    #[serde(skip)]
    request: InstallRequest,
}

struct Running {
    cancel: CancellationToken,
    stop: Arc<AtomicBool>,
}
pub struct ModService {
    jobs: Mutex<HashMap<String, ModJob>>,
    running: Mutex<HashMap<String, Running>>,
    fingerprints: Mutex<HashMap<PathBuf, (u64, Option<SystemTime>, Fingerprint)>>,
    plaza: romhackplaza::Client,
    slots: Arc<tokio::sync::Semaphore>,
}
impl Default for ModService {
    fn default() -> Self {
        Self {
            jobs: Mutex::default(),
            running: Mutex::default(),
            fingerprints: Mutex::default(),
            plaza: romhackplaza::Client::default(),
            slots: Arc::new(tokio::sync::Semaphore::new(8)),
        }
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir().map_err(error)?.join("mods"))
}
fn variant_dir(data: &Path, id: &str) -> PathBuf {
    data.join("variants").join(id)
}

/// Why a library file cannot receive a patch, if it cannot.
fn unpatchable(path: &Path, platform: &str, size: u64) -> Option<String> {
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(platform, "ps3" | "arcade" | "dos") {
        return Some("Patches de arquivo não se aplicam a jogos deste console.".into());
    }
    if matches!(extension.as_str(), "cue" | "m3u" | "gdi" | "ccd") {
        return Some("O jogo está dividido em vários arquivos; só jogos em um único arquivo podem receber patches.".into());
    }
    if matches!(extension.as_str(), "chd" | "cso" | "pbp" | "zip" | "7z") {
        return Some("O jogo está num formato compactado; patches precisam do arquivo original sem compressão.".into());
    }
    if size > formats::MAX_OUTPUT_BYTES {
        return Some("O jogo é grande demais para receber patches no OpenRetro.".into());
    }
    None
}

#[derive(Default)]
struct Hasher {
    sha256: Sha256,
    sha1: sha1::Sha1,
    md5: md5::Md5,
    crc32: crc32fast::Hasher,
    size: u64,
}
impl Hasher {
    fn update(&mut self, bytes: &[u8]) {
        self.sha256.update(bytes);
        self.sha1.update(bytes);
        self.md5.update(bytes);
        self.crc32.update(bytes);
        self.size += bytes.len() as u64;
    }
    fn finish(self) -> Hashes {
        Hashes {
            size: Some(self.size),
            sha256: Some(format!("{:x}", self.sha256.finalize())),
            sha1: Some(format!("{:x}", self.sha1.finalize())),
            md5: Some(format!("{:x}", self.md5.finalize())),
            crc32: Some(format!("{:08x}", self.crc32.finalize())),
        }
    }
}
pub fn hash_bytes(bytes: &[u8]) -> Hashes {
    let mut hasher = Hasher::default();
    hasher.update(bytes);
    hasher.finish()
}
/// SNES dumps sometimes carry a 512-byte copier header that patches never expect.
fn has_copier_header(platform: &str, size: u64) -> bool {
    platform == "snes" && size % 1024 == 512
}

/// Hashes a file in one pass with every algorithm catalogs use.
pub fn fingerprint_file(path: &Path, platform: &str) -> Result<Fingerprint> {
    let metadata =
        std::fs::metadata(path).map_err(|_| "O arquivo do jogo não foi encontrado.".to_string())?;
    if let Some(reason) = unpatchable(path, platform, metadata.len()) {
        return Ok(Fingerprint {
            platform_id: platform.into(),
            unpatchable: Some(reason),
            ..Default::default()
        });
    }
    let mut file = std::fs::File::open(path).map_err(error)?;
    let header = has_copier_header(platform, metadata.len());
    let (mut full, mut headerless) = (Hasher::default(), header.then(Hasher::default));
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut position = 0u64;
    loop {
        let count = file.read(&mut buffer).map_err(error)?;
        if count == 0 {
            break;
        }
        full.update(&buffer[..count]);
        if let Some(headerless) = &mut headerless {
            let skip = 512u64.saturating_sub(position).min(count as u64) as usize;
            headerless.update(&buffer[skip..count]);
        }
        position += count as u64;
    }
    Ok(Fingerprint {
        platform_id: platform.into(),
        unpatchable: None,
        full: full.finish(),
        headerless: headerless.map(Hasher::finish),
    })
}
fn fingerprint(app: &tauri::AppHandle, path: &Path, platform: &str) -> Result<Fingerprint> {
    let service = app.state::<ModService>();
    let metadata = std::fs::metadata(path).map_err(|_| {
        "O arquivo do jogo não foi encontrado. Localize-o na página do jogo.".to_string()
    })?;
    let key = (metadata.len(), metadata.modified().ok());
    if let Some((size, modified, print)) = service.fingerprints.lock().map_err(error)?.get(path) {
        if (*size, *modified) == key && print.platform_id == platform {
            return Ok(print.clone());
        }
    }
    let print = fingerprint_file(path, platform)?;
    let mut cache = service.fingerprints.lock().map_err(error)?;
    if cache.len() > 200 {
        cache.clear();
    }
    cache.insert(path.to_path_buf(), (key.0, key.1, print.clone()));
    Ok(print)
}

struct Item {
    id: String,
    title: String,
    platform_id: String,
    path: String,
    sha256: String,
}
fn library_item(app: &tauri::AppHandle, id: &str) -> Result<Item> {
    let db = app.state::<Database>();
    let conn = db.0.lock().map_err(error)?;
    conn.query_row(
        "SELECT l.id,json_extract(g.metadata,'$.title'),l.platform_id,l.source_path,l.sha256 FROM library_items l JOIN games g ON g.id=l.game_id WHERE l.id=?1",
        [id],
        |r| Ok(Item { id: r.get(0)?, title: r.get::<_, Option<String>>(1)?.unwrap_or_default(), platform_id: r.get(2)?, path: r.get(3)?, sha256: r.get(4)? }),
    )
    .map_err(|_| "Este jogo não está mais na sua biblioteca.".to_string())
}
pub fn variants(conn: &rusqlite::Connection, library_item_id: &str) -> Result<Vec<Variant>> {
    let mut statement = conn
        .prepare("SELECT data FROM game_variants WHERE library_item_id=?1 ORDER BY created_at")
        .map_err(error)?;
    let rows = statement
        .query_map([library_item_id], |r| r.get::<_, String>(0))
        .map_err(error)?;
    Ok(rows
        .flatten()
        .filter_map(|data| serde_json::from_str(&data).ok())
        .collect())
}
fn variant(conn: &rusqlite::Connection, id: &str) -> Result<Variant> {
    let data: String = conn
        .query_row("SELECT data FROM game_variants WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|_| "Esta versão modificada não existe mais.".to_string())?;
    serde_json::from_str(&data).map_err(error)
}
fn active_session(conn: &rusqlite::Connection, library_item_id: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM play_sessions WHERE library_item_id=?1 AND finished_at IS NULL)",
        [library_item_id],
        |r| r.get(0),
    )
    .map_err(error)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub enabled: bool,
    pub entries: usize,
    pub updated_at: Option<String>,
}
fn catalogs(conn: &rusqlite::Connection) -> Result<Vec<(SourceSummary, catalog::Catalog)>> {
    let bundled = catalog::bundled();
    let mut all = vec![(
        SourceSummary {
            id: BUNDLED_SOURCE.into(),
            name: bundled.name.clone(),
            url: None,
            enabled: true,
            entries: bundled.entries.len(),
            updated_at: None,
        },
        bundled,
    )];
    let mut statement = conn
        .prepare("SELECT id,name,url,enabled,updated_at,document FROM mod_sources ORDER BY name")
        .map_err(error)?;
    let rows = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(error)?;
    for (id, name, url, enabled, updated_at, document) in rows.flatten() {
        // Stored documents were validated when added; recheck in case the format tightened.
        let Ok(catalog) = catalog::parse(&document) else {
            continue;
        };
        all.push((
            SourceSummary {
                id,
                name,
                url: Some(url),
                enabled,
                entries: catalog.entries.len(),
                updated_at: Some(updated_at),
            },
            catalog,
        ));
    }
    Ok(all)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub listings: Vec<ListingView>,
    pub variants: Vec<Variant>,
    pub active_variant_id: Option<String>,
    pub sources: Vec<SourceSummary>,
    pub plaza_configured: bool,
    /// Why this game cannot receive patches at all, if it cannot.
    pub unpatchable: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingView {
    #[serde(flatten)]
    pub listing: Listing,
    /// Installed versions this patch is confirmed to apply on top of.
    pub variant_targets: Vec<String>,
    pub installed_variant_id: Option<String>,
}

fn variant_prints(
    app: &tauri::AppHandle,
    item: &Item,
    variants: &[Variant],
) -> Vec<(String, Fingerprint)> {
    variants
        .iter()
        .filter_map(|v| {
            Some((
                v.id.clone(),
                fingerprint(app, Path::new(&v.path), &item.platform_id).ok()?,
            ))
        })
        .collect()
}
fn view(
    listing: Listing,
    bases: &[Hashes],
    variants: &[Variant],
    prints: &[(String, Fingerprint)],
) -> ListingView {
    let entry = &listing.entry;
    let variant_targets = prints
        .iter()
        .filter(|(_, print)| {
            bases.iter().any(|base| {
                catalog::compatibility(&entry.game, base, print).status == Status::Confirmed
            })
        })
        .map(|(id, _)| id.clone())
        .collect();
    let installed_variant_id = variants
        .iter()
        .find(|v| v.entry_id.as_deref() == Some(&entry.id) && v.source_id == listing.source_id)
        .map(|v| v.id.clone());
    ListingView {
        listing,
        variant_targets,
        installed_variant_id,
    }
}
/// The best compatibility across every original file the patch accepts.
fn best(game: &catalog::GameMatch, bases: &[Hashes], print: &Fingerprint) -> Compatibility {
    let empty = [Hashes::default()];
    let bases = if bases.is_empty() { &empty[..] } else { bases };
    let rank = |c: &Compatibility| match c.status {
        Status::Confirmed => 0,
        Status::Unknown => 1,
        Status::Incompatible => 2,
    };
    bases
        .iter()
        .map(|base| catalog::compatibility(game, base, print))
        .min_by_key(rank)
        .expect("at least one base")
}

fn overview_blocking(
    app: &tauri::AppHandle,
    library_item_id: Option<String>,
    title: String,
    platform_id: String,
) -> Result<Overview> {
    let item = library_item_id
        .as_deref()
        .map(|id| library_item(app, id))
        .transpose()?;
    let (sources, variants, active, plaza) = {
        let db = app.state::<Database>();
        let conn = db.0.lock().map_err(error)?;
        let variants = match &item {
            Some(item) => variants(&conn, &item.id)?,
            None => Vec::new(),
        };
        let active: Option<String> = match &item {
            Some(item) => conn
                .query_row(
                    "SELECT variant_id FROM game_variant_selection WHERE library_item_id=?1",
                    [&item.id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(error)?,
            None => None,
        };
        (
            catalogs(&conn)?,
            variants,
            active,
            plaza_key(&conn)?.is_some(),
        )
    };
    let print = item
        .as_ref()
        .map(|item| fingerprint(app, Path::new(&item.path), &item.platform_id))
        .transpose()?;
    let prints = item
        .as_ref()
        .map(|item| variant_prints(app, item, &variants))
        .unwrap_or_default();
    let title = item
        .as_ref()
        .map(|i| i.title.clone())
        .filter(|t| !t.is_empty())
        .unwrap_or(title);
    let platform_id = item
        .as_ref()
        .map(|i| i.platform_id.clone())
        .unwrap_or(platform_id);
    let mut listings = Vec::new();
    for (summary, catalog) in sources.iter().filter(|(s, _)| s.enabled) {
        for entry in &catalog.entries {
            if entry.game.platform_id != platform_id {
                continue;
            }
            let bases = [entry.base.clone()];
            let compatibility = print.as_ref().map(|print| best(&entry.game, &bases, print));
            let by_hash = compatibility
                .as_ref()
                .is_some_and(|c| c.status == Status::Confirmed);
            let on_variant = prints.iter().any(|(_, p)| {
                catalog::compatibility(&entry.game, &entry.base, p).status == Status::Confirmed
            });
            if !(by_hash || on_variant || catalog::title_matches(&entry.game, &title)) {
                continue;
            }
            let listing = Listing {
                source_id: summary.id.clone(),
                source_name: summary.name.clone(),
                entry: entry.clone(),
                compatibility,
            };
            listings.push(view(listing, &bases, &variants, &prints));
        }
    }
    let rank = |l: &ListingView| match l.listing.compatibility.as_ref().map(|c| c.status) {
        Some(Status::Confirmed) => 0,
        Some(Status::Unknown) | None => 1,
        Some(Status::Incompatible) => 2,
    };
    listings.sort_by_key(|l| (rank(l), l.listing.entry.title.clone()));
    Ok(Overview {
        listings,
        variants,
        active_variant_id: active,
        sources: sources.into_iter().map(|(s, _)| s).collect(),
        plaza_configured: plaza,
        unpatchable: print.and_then(|p| p.unpatchable),
    })
}

#[tauri::command]
pub async fn mods_overview(
    app: tauri::AppHandle,
    library_item_id: Option<String>,
    title: String,
    platform_id: String,
) -> Result<Overview> {
    tauri::async_runtime::spawn_blocking(move || {
        overview_blocking(&app, library_item_id, title, platform_id)
    })
    .await
    .map_err(error)?
}

fn plaza_key(conn: &rusqlite::Connection) -> Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        [PLAZA_KEY],
        |r| r.get(0),
    )
    .optional()
    .map_err(error)
}
/// The key is kept in the local database and never sent back to the interface.
#[tauri::command(async)]
pub fn mods_set_plaza_key(app: tauri::AppHandle, key: Option<String>) -> Result<()> {
    let db = app.state::<Database>();
    let conn = db.0.lock().map_err(error)?;
    match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(key) if key.len() > 512 || !key.bytes().all(|b| b.is_ascii_graphic()) => Err("Chave de API inválida.".into()),
        Some(key) => conn
            .execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![PLAZA_KEY, key])
            .map(drop)
            .map_err(error),
        None => conn.execute("DELETE FROM settings WHERE key=?1", [PLAZA_KEY]).map(drop).map_err(error),
    }
}

#[tauri::command]
pub async fn mods_search_plaza(
    app: tauri::AppHandle,
    library_item_id: Option<String>,
    title: String,
    platform_id: String,
) -> Result<Vec<ListingView>> {
    tauri::async_runtime::spawn_blocking(move || {
        let item = library_item_id
            .as_deref()
            .map(|id| library_item(&app, id))
            .transpose()?;
        let (key, variants) = {
            let db = app.state::<Database>();
            let conn = db.0.lock().map_err(error)?;
            let key = plaza_key(&conn)?
                .ok_or("Adicione sua chave de API do Romhack Plaza para buscar lá.")?;
            (
                key,
                match &item {
                    Some(item) => variants(&conn, &item.id)?,
                    None => Vec::new(),
                },
            )
        };
        // The player's own search words; the game does not need to be installed.
        let query = title;
        let platform_id = item
            .as_ref()
            .map(|i| i.platform_id.clone())
            .unwrap_or(platform_id);
        let print = item
            .as_ref()
            .map(|item| fingerprint(&app, Path::new(&item.path), &item.platform_id))
            .transpose()?;
        let prints = item
            .as_ref()
            .map(|item| variant_prints(&app, item, &variants))
            .unwrap_or_default();
        let found = app.state::<ModService>().plaza.search(&key, &query)?;
        Ok(found
            .into_iter()
            // A console Romhack Plaza names differently stays listed; one it
            // names as another OpenRetro console does not.
            .filter(|f| {
                f.entry.game.platform_id == platform_id
                    || romhackplaza::platform_id(&f.entry.game.platform_id).is_none()
                        && !is_platform(&f.entry.game.platform_id)
            })
            .map(|f| {
                let mut game = f.entry.game.clone();
                game.platform_id = platform_id.clone();
                let mut compatibility = print.as_ref().map(|print| best(&game, &f.bases, print));
                if f.entry.game.platform_id != platform_id {
                    if let Some(c) = &mut compatibility {
                        if c.status == Status::Incompatible {
                            c.reason = format!(
                                "Console informado: {}. {}",
                                f.entry.game.platform_id, c.reason
                            );
                        }
                    }
                }
                let listing = Listing {
                    source_id: romhackplaza::SOURCE_ID.into(),
                    source_name: romhackplaza::SOURCE_NAME.into(),
                    entry: f.entry,
                    compatibility,
                };
                view(listing, &f.bases, &variants, &prints)
            })
            .collect())
    })
    .await
    .map_err(error)?
}
fn is_platform(id: &str) -> bool {
    crate::filesystem::is_platform_id(id)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPatch {
    pub name: Option<String>,
    pub info: Option<formats::PatchInfo>,
    pub compatibility: Option<Compatibility>,
    pub choices: Vec<String>,
}
/// Compatibility of a patch file the player chose, from what the patch itself says.
fn local_compatibility(info: &formats::PatchInfo, print: &Fingerprint) -> Compatibility {
    let unknown = |reason: &str| Compatibility {
        status: Status::Unknown,
        reason: reason.into(),
        strip_header: false,
    };
    if let Some(reason) = &print.unpatchable {
        return Compatibility {
            status: Status::Incompatible,
            reason: reason.clone(),
            strip_header: false,
        };
    }
    let (Some(size), Some(crc)) = (info.source_size, info.source_crc32.clone()) else {
        return unknown(match info.format {
            Some(formats::Format::Xdelta) => "O xdelta confere o resultado durante a aplicação, mas não informa o original antes. A instalação falha se não for a versão certa.",
            _ => "Patches IPS não dizem para qual versão foram feitos. Confira os requisitos com o autor.",
        });
    };
    let base = Hashes {
        size: Some(size),
        crc32: Some(crc),
        ..Default::default()
    };
    let game = catalog::GameMatch {
        platform_id: print.platform_id.clone(),
        ..Default::default()
    };
    let mut result = catalog::compatibility(&game, &base, print);
    if result.status == Status::Confirmed && !result.strip_header {
        result.reason = "O próprio patch confere o tamanho e o CRC32 do seu arquivo.".into();
    }
    result
}

#[tauri::command]
pub async fn mods_inspect_patch(
    app: tauri::AppHandle,
    library_item_id: String,
    parent_variant_id: Option<String>,
    path: String,
    archive_path: Option<String>,
) -> Result<LocalPatch> {
    tauri::async_runtime::spawn_blocking(move || {
        let item = library_item(&app, &library_item_id)?;
        let path = crate::filesystem::canonical_file(&path)?;
        let base_path = match &parent_variant_id {
            Some(id) => {
                let db = app.state::<Database>();
                let conn = db.0.lock().map_err(error)?;
                PathBuf::from(variant(&conn, id)?.path)
            }
            None => PathBuf::from(&item.path),
        };
        let print = fingerprint(&app, &base_path, &item.platform_id)?;
        match archive::load(&path, archive_path.as_deref())? {
            archive::Loaded::Choose(choices) => Ok(LocalPatch {
                name: None,
                info: None,
                compatibility: None,
                choices,
            }),
            archive::Loaded::Patch { name, bytes } => {
                let info = formats::inspect(&bytes)?;
                let compatibility = local_compatibility(&info, &print);
                Ok(LocalPatch {
                    name: Some(name),
                    info: Some(info),
                    compatibility: Some(compatibility),
                    choices: Vec::new(),
                })
            }
        }
    })
    .await
    .map_err(error)?
}

fn emit(app: &tauri::AppHandle, job: &ModJob) {
    if let Ok(mut jobs) = app.state::<ModService>().jobs.lock() {
        jobs.insert(job.id.clone(), job.clone());
    }
    let _ = app.emit("mods-job", job);
}
fn update(app: &tauri::AppHandle, job: &mut ModJob, state: &str, stage: &str, progress: f64) {
    job.state = state.into();
    job.stage = stage.into();
    job.progress = progress.clamp(0.0, 100.0);
    emit(app, job);
}

#[tauri::command(async)]
pub fn mods_jobs(app: tauri::AppHandle) -> Result<Vec<ModJob>> {
    Ok(app
        .state::<ModService>()
        .jobs
        .lock()
        .map_err(error)?
        .values()
        .cloned()
        .collect())
}
#[tauri::command(async)]
pub fn mods_cancel(app: tauri::AppHandle, id: String) -> Result<()> {
    if let Some(running) = app
        .state::<ModService>()
        .running
        .lock()
        .map_err(error)?
        .get(&id)
    {
        running.stop.store(true, Ordering::Relaxed);
        running.cancel.cancel();
    }
    Ok(())
}
#[tauri::command(async)]
pub fn mods_dismiss(app: tauri::AppHandle, id: String) -> Result<()> {
    let service = app.state::<ModService>();
    if service.running.lock().map_err(error)?.contains_key(&id) {
        return Err("Cancele a instalação antes de removê-la da lista.".into());
    }
    service.jobs.lock().map_err(error)?.remove(&id);
    let _ = std::fs::remove_dir_all(data_dir(&app)?.join("downloads").join(&id));
    Ok(())
}

#[tauri::command(async)]
pub fn mods_install(
    app: tauri::AppHandle,
    request: InstallRequest,
    retry_of: Option<String>,
) -> Result<String> {
    let item = library_item(&app, &request.library_item_id)?;
    let service = app.state::<ModService>();
    {
        let jobs = service.jobs.lock().map_err(error)?;
        let running = service.running.lock().map_err(error)?;
        if jobs
            .values()
            .any(|j| j.library_item_id == item.id && running.contains_key(&j.id))
        {
            return Err("Já há uma instalação em andamento para este jogo.".into());
        }
    }
    if !matches!(
        request.origin.as_str(),
        "catalog" | "romhackplaza" | "local"
    ) {
        return Err("Origem de modificação desconhecida.".into());
    }
    // A retry keeps its download folder, so a package is not fetched twice.
    let id = match retry_of {
        Some(previous) if uuid::Uuid::parse_str(&previous).is_ok() => {
            service.jobs.lock().map_err(error)?.remove(&previous);
            previous
        }
        _ => uuid::Uuid::new_v4().to_string(),
    };
    let name = request.name.clone().unwrap_or_else(|| "Modificação".into());
    let mut job = ModJob {
        id: id.clone(),
        library_item_id: item.id.clone(),
        name,
        state: "QUEUED".into(),
        progress: 0.0,
        stage: "Na fila".into(),
        error: None,
        choice_kind: None,
        choices: Vec::new(),
        variant_id: None,
        request,
    };
    emit(&app, &job);
    let cancel = CancellationToken::new();
    let stop = Arc::new(AtomicBool::new(false));
    service.running.lock().map_err(error)?.insert(
        id.clone(),
        Running {
            cancel: cancel.clone(),
            stop: stop.clone(),
        },
    );
    let worker = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = install(&worker, &mut job, &cancel, &stop).await;
        match outcome {
            Ok(Some(())) => {}
            Ok(None) => {}
            Err(message) if stop.load(Ordering::Relaxed) || message == formats::CANCELLED => {
                job.error = None;
                update(
                    &worker,
                    &mut job,
                    "CANCELLED",
                    "Cancelada; nada foi alterado",
                    0.0,
                );
            }
            Err(message) => {
                job.error = Some(message);
                update(
                    &worker,
                    &mut job,
                    "FAILED",
                    "Falhou; nada foi alterado",
                    0.0,
                );
            }
        }
        if stop.load(Ordering::Relaxed) && job.state != "CANCELLED" && job.state != "COMPLETED" {
            job.error = None;
            update(
                &worker,
                &mut job,
                "CANCELLED",
                "Cancelada; nada foi alterado",
                0.0,
            );
        }
        if job.state != "NEEDS_CHOICE" {
            if let Ok(data) = data_dir(&worker) {
                let _ = std::fs::remove_dir_all(data.join("downloads").join(&job.id));
            }
        }
        if let Ok(mut running) = worker.state::<ModService>().running.lock() {
            running.remove(&job.id);
        }
    });
    Ok(id)
}

/// What gets patched, resolved before anything is downloaded.
pub struct Plan {
    item: Item,
    parent: Option<Variant>,
    base_path: PathBuf,
    base_sha256: String,
    entry: Option<Entry>,
    source_name: String,
    compatibility: Compatibility,
}

fn plan(app: &tauri::AppHandle, request: &InstallRequest) -> Result<Plan> {
    let item = library_item(app, &request.library_item_id)?;
    let (parent, sources, key) = {
        let db = app.state::<Database>();
        let conn = db.0.lock().map_err(error)?;
        let parent = request
            .parent_variant_id
            .as_deref()
            .map(|id| variant(&conn, id))
            .transpose()?;
        if parent
            .as_ref()
            .is_some_and(|p| p.library_item_id != item.id)
        {
            return Err("Essa versão pertence a outro jogo.".into());
        }
        (parent, catalogs(&conn)?, plaza_key(&conn)?)
    };
    let (base_path, base_sha256) = match &parent {
        Some(parent) => (PathBuf::from(&parent.path), parent.sha256.clone()),
        None => (PathBuf::from(&item.path), item.sha256.clone()),
    };
    let base_path = crate::filesystem::canonical_file(&base_path.to_string_lossy())?;
    let print = fingerprint(app, &base_path, &item.platform_id)?;
    if let Some(reason) = &print.unpatchable {
        return Err(reason.clone());
    }
    let (entry, bases, source_name) = match request.origin.as_str() {
        "catalog" => {
            let source = request.source_id.as_deref().unwrap_or(BUNDLED_SOURCE);
            let (summary, catalog) = sources
                .iter()
                .find(|(s, _)| s.id == source && s.enabled)
                .ok_or("Essa fonte de mods não está mais disponível.")?;
            let entry = catalog
                .entries
                .iter()
                .find(|e| Some(&e.id) == request.entry_id.as_ref())
                .ok_or("Esse item não está mais no catálogo.")?;
            (
                Some(entry.clone()),
                vec![entry.base.clone()],
                summary.name.clone(),
            )
        }
        "romhackplaza" => {
            let key = key.ok_or("Adicione sua chave de API do Romhack Plaza para baixar de lá.")?;
            let id = request
                .entry_id
                .as_deref()
                .and_then(|id| id.strip_prefix("romhackplaza."))
                .and_then(|id| id.parse().ok())
                .ok_or("Item do Romhack Plaza inválido.")?;
            let found = app.state::<ModService>().plaza.details(&key, id)?;
            (
                Some(found.entry),
                found.bases,
                romhackplaza::SOURCE_NAME.into(),
            )
        }
        _ => (None, Vec::new(), "Patch local".into()),
    };
    let compatibility = match &entry {
        Some(entry) => best(&entry.game, &bases, &print),
        // Local patches are checked once read, from what the patch declares.
        None => Compatibility {
            status: Status::Unknown,
            reason: String::new(),
            strip_header: false,
        },
    };
    if let Some(entry) = &entry {
        if entry.game.platform_id != item.platform_id && request.origin == "catalog" {
            return Err("Esta modificação é para outro console.".into());
        }
        if compatibility.status == Status::Incompatible {
            return Err(compatibility.reason.clone());
        }
    }
    Ok(Plan {
        item,
        parent,
        base_path,
        base_sha256,
        entry,
        source_name,
        compatibility,
    })
}

fn sha256_file(path: &Path) -> Result<String> {
    crate::filesystem::hash(path)
}
fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

async fn download(
    app: &tauri::AppHandle,
    job: &mut ModJob,
    url: &reqwest::Url,
    client: &reqwest::Client,
    cancel: &CancellationToken,
) -> Result<Option<PathBuf>> {
    let directory = data_dir(app)?.join("downloads").join(&job.id);
    tokio::fs::create_dir_all(&directory).await.map_err(error)?;
    // A retry finds the package already complete.
    if let Ok(mut entries) = std::fs::read_dir(&directory) {
        if let Some(done) = entries.find_map(|e| {
            e.ok().map(|e| e.path()).filter(|p| {
                p.is_file()
                    && !p.to_string_lossy().ends_with(".part")
                    && !p.to_string_lossy().ends_with(".json")
            })
        }) {
            return Ok(Some(done));
        }
    }
    update(app, job, "DOWNLOADING", "Baixando o patch", 0.0);
    let slots = app.state::<ModService>().slots.clone();
    let reporter = app.clone();
    let mut progress_job = job.clone();
    let path = crate::downloads::direct::download(
        client,
        url,
        &directory,
        slots,
        cancel,
        move |done, total| {
            if total > MAX_DOWNLOAD_BYTES || done > MAX_DOWNLOAD_BYTES {
                return Err("O arquivo publicado é grande demais para ser um patch.".into());
            }
            let percent = if total > 0 {
                done as f64 / total as f64 * 70.0
            } else {
                0.0
            };
            progress_job.progress = percent;
            emit(&reporter, &progress_job);
            Ok(())
        },
    )
    .await?;
    Ok(path)
}

fn needs_choice<T>(
    app: &tauri::AppHandle,
    job: &mut ModJob,
    kind: &str,
    choices: Vec<String>,
) -> Option<T> {
    job.choice_kind = Some(kind.into());
    job.choices = choices;
    job.error = None;
    update(
        app,
        job,
        "NEEDS_CHOICE",
        if kind == "file" {
            "Escolha qual arquivo baixar"
        } else {
            "Escolha qual patch do pacote instalar"
        },
        0.0,
    );
    None
}

/// Ok(None) when the job stopped to ask the player something.
async fn install(
    app: &tauri::AppHandle,
    job: &mut ModJob,
    cancel: &CancellationToken,
    stop: &Arc<AtomicBool>,
) -> Result<Option<()>> {
    update(app, job, "QUEUED", "Conferindo o jogo original", 0.0);
    let request = job.request.clone();
    let planner = app.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || plan(&planner, &request))
        .await
        .map_err(error)??;
    if let Some(entry) = &plan.entry {
        job.name = format!("{} {}", entry.title, entry.version)
            .trim()
            .to_string();
        emit(app, job);
    }
    if plan.compatibility.status == Status::Unknown
        && plan.entry.is_some()
        && !job.request.confirm_unknown
    {
        return Err("A compatibilidade com o seu arquivo é desconhecida. Confirme para instalar assim mesmo.".into());
    }
    if plan.parent.is_some()
        && plan.compatibility.status != Status::Confirmed
        && !job.request.confirm_stack
    {
        return Err("Combinar modificações só é feito quando o catálogo confirma que funcionam juntas, ou quando você confirma.".into());
    }
    let package: PathBuf = match job.request.origin.as_str() {
        "local" => crate::filesystem::canonical_file(
            job.request
                .local_path
                .as_deref()
                .ok_or("Escolha o arquivo do patch.")?,
        )?,
        "catalog" => {
            let entry = plan.entry.as_ref().expect("catalog entry");
            let Some(url) = entry.patch.url.as_deref() else {
                return Err("O autor só permite baixar este patch na página dele. Baixe por lá e use \"Importar patch local\".".into());
            };
            let url = crate::downloads::sources::direct_url(url)?;
            let client = crate::downloads::direct::client()?;
            let Some(path) = download(app, job, &url, &client, cancel).await? else {
                return Err(formats::CANCELLED.into());
            };
            if let Some(expected) = &entry.patch.sha256 {
                let check = path.clone();
                let actual = tauri::async_runtime::spawn_blocking(move || sha256_file(&check))
                    .await
                    .map_err(error)??;
                if !actual.eq_ignore_ascii_case(expected) {
                    let _ = std::fs::remove_file(&path);
                    return Err("O arquivo baixado é diferente do que o autor publicou para esta versão. Nada foi instalado.".into());
                }
            }
            path
        }
        _ => {
            let entry = plan.entry.as_ref().expect("plaza entry");
            let id: u64 = entry
                .id
                .trim_start_matches("romhackplaza.")
                .parse()
                .map_err(error)?;
            let key = {
                let db = app.state::<Database>();
                let conn = db.0.lock().map_err(error)?;
                plaza_key(&conn)?.ok_or("Chave de API do Romhack Plaza ausente.")?
            };
            let lister = app.clone();
            let files = tauri::async_runtime::spawn_blocking(move || {
                lister
                    .state::<ModService>()
                    .plaza
                    .files(&key.clone(), id)
                    .map(|f| (f, key))
            })
            .await
            .map_err(error)??;
            let (files, key) = files;
            let file = match &job.request.download_file {
                Some(name) => files
                    .iter()
                    .find(|f| &f.filename == name)
                    .ok_or("O arquivo escolhido não está mais disponível.")?,
                None if files.len() == 1 => &files[0],
                None if files.is_empty() => {
                    return Err("Este item do Romhack Plaza não tem arquivos para baixar.".into())
                }
                None => {
                    return Ok(needs_choice(
                        app,
                        job,
                        "file",
                        files.iter().map(|f| f.filename.clone()).collect(),
                    ))
                }
            };
            if file.filesize.is_some_and(|size| size > MAX_DOWNLOAD_BYTES) {
                return Err("O arquivo publicado é grande demais para ser um patch.".into());
            }
            let url = crate::downloads::sources::direct_url(&file.download)?;
            // The key only goes to Romhack Plaza itself.
            if !url
                .host_str()
                .is_some_and(|h| h == "romhackplaza.org" || h.ends_with(".romhackplaza.org"))
            {
                return Err("O Romhack Plaza devolveu um link de download de outro site; ele não foi usado.".into());
            }
            let mut headers = reqwest::header::HeaderMap::new();
            let value =
                reqwest::header::HeaderValue::from_str(&format!("Bearer {key}")).map_err(error)?;
            headers.insert(reqwest::header::AUTHORIZATION, value);
            let client = crate::downloads::direct::client_with_headers(headers)?;
            let Some(path) = download(app, job, &url, &client, cancel).await? else {
                return Err(formats::CANCELLED.into());
            };
            path
        }
    };
    if stop.load(Ordering::Relaxed) {
        return Err(formats::CANCELLED.into());
    }
    update(app, job, "PATCHING", "Lendo o patch", 72.0);
    let worker = app.clone();
    let stop_flag = stop.clone();
    let mut blocking_job = job.clone();
    let (finished, outcome) = tauri::async_runtime::spawn_blocking(move || {
        let outcome = apply_and_store(&worker, &mut blocking_job, &plan, &package, &stop_flag);
        (blocking_job, outcome)
    })
    .await
    .map_err(error)?;
    *job = finished;
    match outcome? {
        Some(variant) => {
            job.variant_id = Some(variant.id.clone());
            job.name = variant.name.clone();
            update(app, job, "COMPLETED", "Instalada", 100.0);
            let _ = app.emit("library-changed", &variant.library_item_id);
            Ok(Some(()))
        }
        None => Ok(None),
    }
}

/// Runs `store_variant` for a job, showing its steps on the job.
fn apply_and_store(
    app: &tauri::AppHandle,
    job: &mut ModJob,
    plan: &Plan,
    package: &Path,
    stop: &AtomicBool,
) -> Result<Option<Variant>> {
    let data = data_dir(app)?;
    let request = job.request.clone();
    let db = app.state::<Database>();
    let mut progress =
        |state: &str, stage: &str, percent: f64| update(app, job, state, stage, percent);
    match store_variant(&db, &data, &request, plan, package, stop, &mut progress)? {
        Stored::Variant(variant) => Ok(Some(variant)),
        Stored::Choose(choices) => Ok(needs_choice(app, job, "archive", choices)),
    }
}
pub enum Stored {
    Variant(Variant),
    Choose(Vec<String>),
}

/// Reads, patches, verifies and writes the copy. Everything happens in memory
/// or under a `.partial` name until the final rename and database insert.
pub fn store_variant(
    db: &Database,
    data: &Path,
    request: &InstallRequest,
    plan: &Plan,
    package: &Path,
    stop: &AtomicBool,
    progress: &mut dyn FnMut(&str, &str, f64),
) -> Result<Stored> {
    let (patch_name, patch) = match archive::load(
        package,
        request
            .archive_path
            .as_deref()
            .or(plan.entry.as_ref().and_then(|e| e.patch.path.as_deref())),
    )? {
        archive::Loaded::Patch { name, bytes } => (name, bytes),
        archive::Loaded::Choose(choices) => return Ok(Stored::Choose(choices)),
    };
    if let Some(expected) = plan
        .entry
        .as_ref()
        .and_then(|e| e.patch.file_sha256.as_ref())
    {
        if !sha256_hex(&patch).eq_ignore_ascii_case(expected) {
            return Err("O patch dentro do pacote é diferente do publicado para esta versão. Nada foi instalado.".into());
        }
    }
    let format = formats::detect(&patch)
        .ok_or("Este arquivo não é um patch IPS, BPS, UPS ou xdelta reconhecido.")?;
    if let Some(declared) = plan
        .entry
        .as_ref()
        .and_then(|e| formats::Format::parse(&e.patch.format))
    {
        if declared != format {
            return Err(format!(
                "O catálogo diz {} mas o arquivo é {}. Nada foi instalado.",
                declared.name(),
                format.name()
            ));
        }
    }
    progress("PATCHING", "Conferindo o jogo original", 76.0);
    let mut original = std::fs::read(&plan.base_path).map_err(error)?;
    // Integrity before: the copy is made from exactly the file the library knows.
    if sha256_hex(&original) != plan.base_sha256 {
        return Err("O arquivo do jogo mudou desde que foi adicionado à biblioteca. Use \"Verificar arquivo\" na página do jogo antes de instalar.".into());
    }
    let mut compatibility = plan.compatibility.clone();
    if plan.entry.is_none() {
        let print = fingerprint_file(&plan.base_path, &plan.item.platform_id)?;
        compatibility = local_compatibility(&formats::inspect(&patch)?, &print);
        if compatibility.status == Status::Incompatible {
            return Err(compatibility.reason);
        }
        if compatibility.status == Status::Unknown && !request.confirm_unknown {
            return Err("A compatibilidade com o seu arquivo é desconhecida. Confirme para instalar assim mesmo.".into());
        }
        if plan.parent.is_some() && !request.confirm_stack {
            return Err("Combinar modificações só é feito quando você confirma.".into());
        }
    }
    if compatibility.strip_header {
        original.drain(..512);
    }
    if stop.load(Ordering::Relaxed) {
        return Err(formats::CANCELLED.into());
    }
    progress(
        "PATCHING",
        &format!("Aplicando o patch {}", format.name()),
        82.0,
    );
    let output = formats::apply(&patch, &original, stop)?;
    drop(original);
    progress("VERIFYING", "Conferindo o resultado", 92.0);
    let hashes = hash_bytes(&output);
    if let Some(expected) = plan.entry.as_ref().and_then(|e| e.result.as_ref()) {
        if !expected.is_empty() && !expected.matches(&hashes) {
            return Err("O jogo modificado não confere com o resultado publicado pelo autor. Nada foi instalado.".into());
        }
    }
    let sha256 = hashes.sha256.clone().unwrap_or_default();
    if sha256 == plan.item.sha256 {
        return Err("Este patch não mudou nada no jogo.".into());
    }
    if stop.load(Ordering::Relaxed) {
        return Err(formats::CANCELLED.into());
    }
    let variant_id = uuid::Uuid::new_v4().to_string();
    let directory = variant_dir(data, &variant_id);
    let stored = (|| -> Result<Variant> {
        std::fs::create_dir_all(&directory).map_err(error)?;
        // Same file name as the original: the runtime names saves after it.
        let file_name = Path::new(&plan.item.path)
            .file_name()
            .ok_or("Nome de arquivo inválido.")?
            .to_owned();
        let target = directory.join(&file_name);
        let partial = directory.join(format!("{}.partial", file_name.to_string_lossy()));
        let mut file = std::fs::File::create(&partial).map_err(error)?;
        file.write_all(&output).map_err(error)?;
        file.sync_all().map_err(error)?;
        drop(file);
        if sha256_file(&partial)? != sha256 {
            return Err(
                "A cópia gravada no disco não confere. Verifique o espaço livre e tente de novo."
                    .into(),
            );
        }
        if stop.load(Ordering::Relaxed) {
            return Err(formats::CANCELLED.into());
        }
        std::fs::rename(&partial, &target).map_err(error)?;
        let entry = plan.entry.as_ref();
        let local_name = request
            .name
            .clone()
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| {
                Path::new(&patch_name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "Patch local".into())
            });
        let variant = Variant {
            id: variant_id.clone(),
            library_item_id: plan.item.id.clone(),
            parent_id: plan.parent.as_ref().map(|p| p.id.clone()),
            name: entry
                .map(|e| e.title.clone())
                .unwrap_or(local_name)
                .chars()
                .take(120)
                .collect(),
            kind: entry
                .map(|e| e.kind.clone())
                .unwrap_or_else(|| "local".into()),
            entry_id: entry.map(|e| e.id.clone()),
            source_id: match request.origin.as_str() {
                "catalog" => request
                    .source_id
                    .clone()
                    .unwrap_or_else(|| BUNDLED_SOURCE.into()),
                "romhackplaza" => romhackplaza::SOURCE_ID.into(),
                _ => "local".into(),
            },
            source_name: plan.source_name.clone(),
            version: entry.map(|e| e.version.clone()),
            language: entry.map(|e| e.language.clone()),
            authors: entry.map(|e| e.authors.clone()).unwrap_or_default(),
            credits: entry.map(|e| e.credits.clone()).unwrap_or_default(),
            source_url: entry.map(|e| e.source_url.clone()),
            license: entry.and_then(|e| e.license.clone()),
            format: format.name().into(),
            // Only a confirmed original can share saves the author vouched for.
            saves: if entry.is_some_and(|e| e.saves_shared())
                && compatibility.status == Status::Confirmed
                && plan.parent.is_none()
            {
                "shared"
            } else {
                "separate"
            }
            .into(),
            compatibility: compatibility.status,
            path: target.to_string_lossy().into_owned(),
            sha256: sha256.clone(),
            size: output.len() as u64,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        let mut conn = db.0.lock().map_err(error)?;
        let tx = conn.transaction().map_err(error)?;
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM library_items WHERE id=?1)",
                [&plan.item.id],
                |r| r.get(0),
            )
            .map_err(error)?;
        if !exists {
            return Err("O jogo foi removido da biblioteca durante a instalação.".into());
        }
        tx.execute(
            "INSERT INTO game_variants(id,library_item_id,parent_id,path,sha256,created_at,data) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![variant.id, variant.library_item_id, variant.parent_id, variant.path, variant.sha256, variant.created_at, serde_json::to_string(&variant).map_err(error)?],
        )
        .map_err(|e| if e.to_string().contains("UNIQUE") { "Esta versão modificada já está instalada.".to_string() } else { error(e) })?;
        tx.commit().map_err(error)?;
        Ok(variant)
    })();
    match stored {
        Ok(variant) => Ok(Stored::Variant(variant)),
        Err(message) => {
            let _ = std::fs::remove_dir_all(&directory);
            Err(message)
        }
    }
}

#[tauri::command(async)]
pub fn mods_select_variant(
    app: tauri::AppHandle,
    library_item_id: String,
    variant_id: Option<String>,
) -> Result<()> {
    let db = app.state::<Database>();
    let conn = db.0.lock().map_err(error)?;
    if active_session(&conn, &library_item_id)? {
        return Err("Feche o jogo antes de trocar de versão.".into());
    }
    match variant_id {
        Some(id) => {
            let chosen = variant(&conn, &id)?;
            if chosen.library_item_id != library_item_id {
                return Err("Essa versão pertence a outro jogo.".into());
            }
            if !Path::new(&chosen.path).is_file() {
                return Err("O arquivo desta versão sumiu. Remova-a e instale de novo.".into());
            }
            conn.execute(
                "INSERT INTO game_variant_selection(library_item_id,variant_id) VALUES(?1,?2) ON CONFLICT(library_item_id) DO UPDATE SET variant_id=excluded.variant_id",
                params![library_item_id, id],
            )
            .map_err(error)?;
        }
        None => {
            conn.execute(
                "DELETE FROM game_variant_selection WHERE library_item_id=?1",
                [&library_item_id],
            )
            .map_err(error)?;
        }
    }
    drop(conn);
    let _ = app.emit("library-changed", &library_item_id);
    Ok(())
}

/// Every variant built on `id`, which goes with it.
fn descendants(all: &[Variant], id: &str) -> Vec<String> {
    let mut found = vec![id.to_string()];
    let mut index = 0;
    while index < found.len() {
        let current = found[index].clone();
        found.extend(
            all.iter()
                .filter(|v| v.parent_id.as_deref() == Some(&current))
                .map(|v| v.id.clone()),
        );
        index += 1;
    }
    found
}

/// Removes a modified version and its saves folder. The original game file
/// and its saves are never touched.
#[tauri::command(async)]
pub fn mods_remove_variant(app: tauri::AppHandle, variant_id: String) -> Result<Vec<String>> {
    let data = data_dir(&app)?;
    let removed = {
        let db = app.state::<Database>();
        let mut conn = db.0.lock().map_err(error)?;
        let chosen = variant(&conn, &variant_id)?;
        if active_session(&conn, &chosen.library_item_id)? {
            return Err("Feche o jogo antes de remover uma versão.".into());
        }
        let removed = descendants(&variants(&conn, &chosen.library_item_id)?, &variant_id);
        let tx = conn.transaction().map_err(error)?;
        // Cascades to versions built on it and to the selection.
        tx.execute("DELETE FROM game_variants WHERE id=?1", [&variant_id])
            .map_err(error)?;
        tx.commit().map_err(error)?;
        let _ = app.emit("library-changed", &chosen.library_item_id);
        removed
    };
    for id in &removed {
        remove_variant_files(&data, id);
    }
    Ok(removed)
}
fn remove_variant_files(data: &Path, id: &str) {
    if uuid::Uuid::parse_str(id).is_err() {
        return;
    }
    let _ = std::fs::remove_dir_all(variant_dir(data, id));
    let _ = std::fs::remove_dir_all(data.join("saves").join(id));
}
/// Called before a library item is deleted.
pub fn forget_library_item(app: &tauri::AppHandle, library_item_id: &str) -> Result<()> {
    let data = data_dir(app)?;
    let ids: Vec<String> = {
        let db = app.state::<Database>();
        let conn = db.0.lock().map_err(error)?;
        variants(&conn, library_item_id)?
            .into_iter()
            .map(|v| v.id)
            .collect()
    };
    for id in ids {
        remove_variant_files(&data, &id);
    }
    Ok(())
}

/// Deletes what an interrupted install left: folders without a registered
/// variant, leftover `.partial` files and unfinished downloads.
pub fn recover(app: &tauri::AppHandle) {
    let Ok(data) = data_dir(app) else { return };
    let _ = std::fs::remove_dir_all(data.join("downloads"));
    let known: std::collections::HashSet<String> = {
        let db = app.state::<Database>();
        let Ok(conn) = db.0.lock() else { return };
        let Ok(mut statement) = conn.prepare("SELECT id FROM game_variants") else {
            return;
        };
        let Ok(rows) = statement.query_map([], |r| r.get::<_, String>(0)) else {
            return;
        };
        rows.flatten().collect()
    };
    recover_folder(&data, &known);
}
fn recover_folder(data: &Path, known: &std::collections::HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(data.join("variants")) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !known.contains(&name) {
            log::info!("Removing unfinished mod install {name}");
            let _ = std::fs::remove_dir_all(entry.path());
            continue;
        }
        for file in std::fs::read_dir(entry.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            if file.file_name().to_string_lossy().ends_with(".partial") {
                let _ = std::fs::remove_file(file.path());
            }
        }
    }
}

/// Where a variant keeps saves the original must not see.
pub struct VariantSaves {
    /// None when the author confirmed the original's saves work.
    pub saves: Option<PathBuf>,
    pub states: PathBuf,
}
pub fn variant_saves(
    data_root: &Path,
    player: &str,
    variant: &ActiveVariant,
) -> Result<VariantSaves> {
    if uuid::Uuid::parse_str(&variant.id).is_err() {
        return Err("Versão modificada inválida.".into());
    }
    let root = data_root
        .join("mods")
        .join("saves")
        .join(&variant.id)
        .join(player);
    Ok(VariantSaves {
        saves: (!variant.saves_shared).then(|| root.join("saves")),
        states: root.join("states"),
    })
}

#[tauri::command(async)]
pub fn mods_sources(app: tauri::AppHandle) -> Result<Vec<SourceSummary>> {
    let db = app.state::<Database>();
    let conn = db.0.lock().map_err(error)?;
    Ok(catalogs(&conn)?.into_iter().map(|(s, _)| s).collect())
}
#[tauri::command]
pub async fn mods_add_source(app: tauri::AppHandle, url: String) -> Result<SourceSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = catalog::fetch(url.trim())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let document = serde_json::to_string(&catalog).map_err(error)?;
        let db = app.state::<Database>();
        let conn = db.0.lock().map_err(error)?;
        conn.execute(
            "INSERT INTO mod_sources(id,name,url,enabled,updated_at,document) VALUES(?1,?2,?3,1,?4,?5) ON CONFLICT(url) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at,document=excluded.document",
            params![id, catalog.name, url.trim(), now, document],
        )
        .map_err(error)?;
        let (id, enabled): (String, bool) = conn.query_row("SELECT id,enabled FROM mod_sources WHERE url=?1", [url.trim()], |r| Ok((r.get(0)?, r.get(1)?))).map_err(error)?;
        Ok(SourceSummary { id, name: catalog.name, url: Some(url.trim().into()), enabled, entries: catalog.entries.len(), updated_at: Some(now) })
    })
    .await
    .map_err(error)?
}
#[tauri::command(async)]
pub fn mods_set_source(app: tauri::AppHandle, id: String, enabled: bool) -> Result<()> {
    let db = app.state::<Database>();
    let conn = db.0.lock().map_err(error)?;
    conn.execute(
        "UPDATE mod_sources SET enabled=?1 WHERE id=?2",
        params![enabled, id],
    )
    .map_err(error)?;
    Ok(())
}
#[tauri::command(async)]
pub fn mods_remove_source(app: tauri::AppHandle, id: String) -> Result<()> {
    let db = app.state::<Database>();
    let conn = db.0.lock().map_err(error)?;
    conn.execute("DELETE FROM mod_sources WHERE id=?1", [id])
        .map_err(error)?;
    Ok(())
}

#[cfg(test)]
mod tests;
