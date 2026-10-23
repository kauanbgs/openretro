pub(crate) mod direct;
pub mod region;
pub mod sources;
use crate::{
    database::{error, Database, Result},
    models::GameMetadata,
};
use librqbit::{AddTorrent, AddTorrentOptions, Session, SessionOptions};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tokio::sync::OnceCell;
use tokio_util::sync::CancellationToken;

pub const NETWORK_DOWNLOADS_ENABLED: bool = true;
const METADATA_WAIT_TIMEOUT: Duration = Duration::from_secs(90);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    pub id: String,
    pub name: String,
    pub source_name: String,
    pub magnet: String,
    pub info_hash: String,
    pub state: String,
    pub progress: f64,
    pub bytes_per_second: f64,
    pub remaining_seconds: Option<u64>,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub directory: String,
    pub error: Option<String>,
    pub game: Option<GameMetadata>,
    #[serde(default)]
    pub auto_extract: bool,
    #[serde(default)]
    pub auto_add_to_library: bool,
    /// What the job is doing after the transfer (extracting, verifying, adding).
    #[serde(default)]
    pub stage: Option<String>,
    /// "added" once the game is in the library, "manual" when the player must choose.
    #[serde(default)]
    pub library_status: Option<String>,
    #[serde(default)]
    pub library_message: Option<String>,
}
struct ActiveTask {
    cancel: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}
pub struct DownloadService {
    http: OnceCell<reqwest::Client>,
    http_slots: Arc<tokio::sync::Semaphore>,
    session: OnceCell<Arc<Session>>,
    active: Mutex<HashMap<String, ActiveTask>>,
    operations: tokio::sync::Mutex<()>,
}
impl Default for DownloadService {
    fn default() -> Self {
        Self { session: OnceCell::new(), http: OnceCell::new(), http_slots: Arc::new(tokio::sync::Semaphore::new(32)), active: Mutex::default(), operations: tokio::sync::Mutex::new(()) }
    }
}
fn save_job(app: &tauri::AppHandle, job: &DownloadJob) -> Result<()> {
    app.state::<Database>().0.lock().map_err(error)?.execute(
        "INSERT INTO download_jobs(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        params![job.id,serde_json::to_string(job).map_err(error)?]).map_err(error)?;
    Ok(())
}
fn get_job(app: &tauri::AppHandle, id: &str) -> Result<DownloadJob> {
    let raw: String = app
        .state::<Database>()
        .0
        .lock()
        .map_err(error)?
        .query_row("SELECT data FROM download_jobs WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|_| "Download no longer exists.")?;
    serde_json::from_str(&raw).map_err(error)
}
async fn session(app: &tauri::AppHandle) -> Result<Arc<Session>> {
    let service = app.state::<DownloadService>();
    service
        .session
        .get_or_try_init(|| async {
            let root = app.path().app_data_dir().map_err(error)?.join("downloads");
            std::fs::create_dir_all(&root).map_err(error)?;
            // The DHT routing table survives restarts, so torrents find peers
            // in seconds instead of re-bootstrapping. UPnP stays off: the app
            // never asks the router to open a port.
            let dht_config = librqbit::dht::PersistentDhtConfig {
                dump_interval: Some(Duration::from_secs(30)),
                config_filename: Some(root.join("dht.json")),
            };
            Session::new_with_opts(
                root,
                SessionOptions {
                    disable_dht_persistence: false,
                    dht_config: Some(dht_config),
                    enable_upnp_port_forwarding: false,
                    defer_writes_up_to: Some(32),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| format!("Could not initialize BitTorrent: {e}"))
        })
        .await
        .cloned()
}
async fn transfer(app: &tauri::AppHandle, job: &mut DownloadJob) -> Result<()> {
    let session = session(app).await?;
    let handle = checked_add(&session, &job.magnet, &job.directory, None).await?;
    loop {
        let stats = handle.stats();
        job.total_bytes = stats.total_bytes;
        job.downloaded_bytes = stats.progress_bytes;
        job.progress = if stats.total_bytes == 0 {
            0.0
        } else {
            (stats.progress_bytes as f64 / stats.total_bytes as f64 * 100.0).min(100.0)
        };
        job.bytes_per_second = stats
            .live
            .as_ref()
            .map(|s| s.download_speed.mbps * 1048576.0)
            .unwrap_or(0.0);
        job.remaining_seconds = if job.bytes_per_second > 0.0 {
            Some(
                ((stats.total_bytes.saturating_sub(stats.progress_bytes)) as f64
                    / job.bytes_per_second) as u64,
            )
        } else {
            None
        };
        job.state = if stats.finished {
            "INSTALLING"
        } else if stats.state.to_string() == "initializing" {
            "VERIFYING"
        } else {
            "DOWNLOADING"
        }
        .into();
        if let Some(e) = stats.error {
            return Err(format!("Torrent stopped: {e}"));
        }
        save_job(app, job)?;
        if stats.finished {
            session
                .delete(librqbit::api::TorrentIdOrHash::Id(handle.id()), false)
                .await
                .map_err(error)?;
            // Hashing gigabytes must not block the async runtime.
            let app = app.clone();
            let mut finished = job.clone();
            *job = tauri::async_runtime::spawn_blocking(move || {
                finish_download(&app, &mut finished, None);
                finished
            })
            .await
            .map_err(error)?;
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
fn validate_component(part: &str) -> Result<()> {
    let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
    if part.is_empty()
        || part == "."
        || part == ".."
        || part.ends_with(['.', ' '])
        || part.chars().any(|c| c < ' ' || "/\\:<>\"|?*".contains(c))
        || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        return Err("Torrent contains an unsafe or unsupported filename.".into());
    }
    Ok(())
}
async fn checked_add(
    session: &Arc<Session>,
    magnet: &str,
    directory: &str,
    initial_peers: Option<Vec<std::net::SocketAddr>>,
) -> Result<Arc<librqbit::ManagedTorrent>> {
    // Resolve metadata without writing payload files, then validate paths on every platform.
    let response = tokio::time::timeout(
        METADATA_WAIT_TIMEOUT,
        session.add_torrent(
            AddTorrent::from_url(magnet),
            Some(AddTorrentOptions {
                output_folder: Some(directory.into()),
                list_only: true,
                initial_peers,
                ..Default::default()
            }),
        ),
    )
    .await
    .map_err(|_| {
        "No torrent metadata or peers were found after 90 seconds. This release may be offline; try another release or resume later."
    })?
    .map_err(|e| format!("Could not start torrent: {e}"))?;
    let metadata = match response {
        librqbit::AddTorrentResponse::ListOnly(m) => m,
        _ => return Err("Torrent is already managed by the engine.".into()),
    };
    if metadata.info_hash.as_string() != sources::magnet_hash(magnet)? {
        return Err("Torrent metadata does not match the requested magnet.".into());
    }
    if let Some(name) = metadata.info.name.as_ref() {
        validate_component(std::str::from_utf8(name.as_ref()).map_err(error)?)?;
    }
    let mut count = 0;
    for file in metadata.info.iter_file_details().map_err(error)? {
        count += 1;
        if count > 100_000 || file.symlink_path.is_some() {
            return Err("Torrent contains unsupported file entries.".into());
        }
        let mut depth = 0;
        for part in file.filename.iter_components() {
            depth += 1;
            validate_component(part.map_err(error)?)?;
        }
        if depth > 32 {
            return Err("Torrent paths are nested too deeply.".into());
        }
    }
    let trackers = reqwest::Url::parse(magnet)
        .map_err(error)?
        .query_pairs()
        .filter(|(k, _)| k == "tr")
        .map(|(_, v)| v.into_owned())
        .collect();
    session
        .add_torrent(
            AddTorrent::from_bytes(metadata.torrent_bytes),
            Some(AddTorrentOptions {
                output_folder: Some(directory.into()),
                overwrite: true,
                initial_peers: Some(metadata.seen_peers),
                trackers: Some(trackers),
                ..Default::default()
            }),
        )
        .await
        .map_err(error)?
        .into_handle()
        .ok_or("Torrent metadata is unavailable.".into())
}
fn spawn_transfer(app: &tauri::AppHandle, mut job: DownloadJob) -> Result<()> {
    job.state = "RESOLVING".into();
    job.error = None;
    job.bytes_per_second = 0.0;
    save_job(app, &job)?;
    let cancel = CancellationToken::new();
    let token = cancel.clone();
    let app_clone = app.clone();
    let id = job.id.clone();
    let task = tauri::async_runtime::spawn(async move {
        tokio::select! {
            result = transfer(&app_clone, &mut job) => {
                if let Err(message) = result { job.state="FAILED".into(); job.error=Some(message); job.bytes_per_second=0.0; let _=save_job(&app_clone,&job); }
            },
            _ = token.cancelled() => {}
        }
        if let Some(s) = app_clone.state::<DownloadService>().session.get() {
            if let Ok(hash) = job.info_hash.parse() {
                let _ = s
                    .delete(librqbit::api::TorrentIdOrHash::Hash(hash), false)
                    .await;
            }
        }
    });
    app.state::<DownloadService>()
        .active
        .lock()
        .map_err(error)?
        .insert(id, ActiveTask { cancel, task });
    Ok(())
}
fn safe_download_filename(candidate: &str) -> Option<String> {
    let name: String = candidate
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    if validate_component(&name).is_ok() {
        Some(name)
    } else {
        None
    }
}
fn direct_filename(url: &reqwest::Url) -> String {
    url.path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.is_empty())
        .and_then(safe_download_filename)
        .unwrap_or_else(|| "download.bin".into())
}
fn response_filename(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let header = headers
        .get(reqwest::header::CONTENT_DISPOSITION)?
        .to_str()
        .ok()?;
    header
        .split(';')
        .find_map(|part| part.trim().strip_prefix("filename="))
        .map(|name| name.trim_matches('"'))
        .and_then(safe_download_filename)
}
fn playable_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "gb" | "gbc"
            | "gba"
            | "nes"
            | "sfc"
            | "smc"
            | "z64"
            | "n64"
            | "v64"
            | "nds"
            | "sms"
            | "md"
            | "gen"
            | "gg"
            | "cue"
            | "chd"
            | "pbp"
            | "iso"
            | "cso"
            | "bin"
    )
}
/// SHA-256 and size of each extracted file, by its canonical path.
type ExtractedHashes = HashMap<PathBuf, (u64, String)>;
#[derive(Debug)]
enum ExtractError {
    /// The archive's own data is damaged: downloading it again is the fix.
    Corrupt(String),
    Other(String),
}
impl From<String> for ExtractError {
    fn from(message: String) -> Self {
        Self::Other(message)
    }
}
impl From<&str> for ExtractError {
    fn from(message: &str) -> Self {
        Self::Other(message.into())
    }
}
/// The ZIP checks each file's CRC as it ends, so damaged data surfaces
/// here as invalid data or an early end.
fn read_error(e: std::io::Error) -> ExtractError {
    match e.kind() {
        std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof => {
            ExtractError::Corrupt(e.to_string())
        }
        _ => ExtractError::Other(e.to_string()),
    }
}
/// Extracts the playable files and hashes them while writing, so the import
/// does not read multi-gigabyte games a second time. Each file is written
/// under a `.partial` name and renamed only once complete, so an extraction
/// cut short by closing the app never leaves a half game to be added.
fn extract_playable_zip(
    archive_path: &Path,
    directory: &Path,
    mut progress: impl FnMut(u64, u64),
) -> std::result::Result<ExtractedHashes, ExtractError> {
    let mut hashes = ExtractedHashes::new();
    if archive_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("zip"))
    {
        return Ok(hashes);
    }
    let mut archive = zip::ZipArchive::new(File::open(archive_path).map_err(error)?)
        .map_err(|_| ExtractError::Corrupt("Downloaded ZIP is invalid.".into()))?;
    if archive.len() > 10_000 {
        return Err("Downloaded ZIP has too many entries.".into());
    }
    let output_root = directory.join("extracted");
    // Sizes are known up front, so the bar can show real extraction progress.
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(error)?;
        let enclosed = entry
            .enclosed_name()
            .ok_or("Downloaded ZIP contains an unsafe path.")?;
        if !entry.is_dir() && playable_extension(&enclosed) {
            total = total
                .checked_add(entry.size())
                .ok_or("Downloaded ZIP declares an invalid total size.")?;
        }
    }
    let mut done = 0u64;
    let mut buffer = vec![0u8; 1024 * 1024];
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| ExtractError::Corrupt(e.to_string()))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or("Downloaded ZIP contains an unsafe path.")?;
        if entry.is_dir() || !playable_extension(&enclosed) {
            continue;
        }
        let destination = output_root.join(enclosed);
        std::fs::create_dir_all(destination.parent().ok_or("Invalid ZIP path.")?).map_err(error)?;
        let mut partial = destination.clone().into_os_string();
        partial.push(".partial");
        let partial = PathBuf::from(partial);
        let mut output = std::io::BufWriter::with_capacity(
            1024 * 1024,
            File::create(&partial).map_err(error)?,
        );
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        loop {
            let read = match entry.read(&mut buffer) {
                Ok(read) => read,
                Err(e) => {
                    drop(output);
                    let _ = std::fs::remove_file(&partial);
                    return Err(read_error(e));
                }
            };
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read]).map_err(error)?;
            hasher.update(&buffer[..read]);
            size += read as u64;
            done += read as u64;
            if done > total {
                return Err(ExtractError::Corrupt(
                    "Downloaded ZIP is larger than it declares.".into(),
                ));
            }
            progress(done, total);
        }
        output.flush().map_err(error)?;
        drop(output);
        if size != entry.size() {
            let _ = std::fs::remove_file(&partial);
            return Err(ExtractError::Corrupt(format!(
                "A extração parou em {size} de {} bytes.",
                entry.size()
            )));
        }
        std::fs::rename(&partial, &destination).map_err(error)?;
        let path = destination.canonicalize().map_err(error)?;
        hashes.insert(path, (size, format!("{:x}", hasher.finalize())));
    }
    Ok(hashes)
}
async fn direct_transfer(app: &tauri::AppHandle, job: &mut DownloadJob, cancel: &CancellationToken) -> Result<()> {
    let url = sources::direct_url(&job.magnet)?;
    let service = app.state::<DownloadService>();
    let client = service.http.get_or_try_init(|| async { direct::client() }).await?;
    let directory = PathBuf::from(&job.directory);
    job.state = "DOWNLOADING".into();
    job.error = None;
    job.bytes_per_second = 0.0;
    save_job(app, job)?;
    let mut meter = RateMeter::default();
    let target = direct::download(client, &url, &directory, service.http_slots.clone(), cancel, |done, total| {
        meter.update(job, done, total);
        save_job(app, job)
    }).await?;
    if let Some(target) = target {
        // Extraction and hashing remain outside the async network workers.
        let app = app.clone();
        let mut completed = job.clone();
        *job = tauri::async_runtime::spawn_blocking(move || { finish_download(&app, &mut completed, Some(&target)); completed }).await.map_err(error)?;
    }
    Ok(())
}
/// Saves a post-transfer step at most a few times per second.
struct StageReporter<'a> {
    app: &'a tauri::AppHandle,
    saved_at: Instant,
}
impl StageReporter<'_> {
    fn begin(&mut self, job: &mut DownloadJob, stage: &str) {
        job.state = "INSTALLING".into();
        job.stage = Some(stage.into());
        job.progress = 0.0;
        job.bytes_per_second = 0.0;
        job.remaining_seconds = None;
        let _ = save_job(self.app, job);
        self.saved_at = Instant::now();
    }
    fn report(&mut self, job: &mut DownloadJob, done: u64, total: u64) {
        if self.saved_at.elapsed() >= Duration::from_millis(400) {
            job.progress = if total == 0 {
                0.0
            } else {
                (done as f64 / total as f64 * 100.0).min(100.0)
            };
            let _ = save_job(self.app, job);
            self.saved_at = Instant::now();
        }
    }
}
/// Finishes downloads that were extracting or being added when the app
/// closed: the transfer is complete, so only that step runs again.
pub fn finish_interrupted(app: &tauri::AppHandle) {
    let Ok(jobs) = list_download_jobs(app.state::<Database>()) else {
        return;
    };
    for mut job in jobs.into_iter().filter(|job| job.state == "INSTALLING") {
        let app = app.clone();
        std::thread::spawn(move || {
            let archive = std::fs::read_dir(&job.directory)
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.path())
                .find(|path| {
                    path.is_file()
                        && path
                            .extension()
                            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
                });
            finish_download(&app, &mut job, archive.as_deref());
        });
    }
}
/// Extracts and adds a finished download, showing each step on the job. It
/// ends in COMPLETED, where a failed import keeps the downloaded files, or in
/// FAILED for a damaged archive, which is deleted so retrying downloads it
/// again.
fn finish_download(app: &tauri::AppHandle, job: &mut DownloadJob, archive: Option<&Path>) {
    let mut reporter = StageReporter {
        app,
        saved_at: Instant::now(),
    };
    job.library_status = None;
    job.library_message = None;
    let mut extracted = Ok(ExtractedHashes::new());
    if let Some(archive) = archive.filter(|_| job.auto_extract) {
        if archive
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
        {
            reporter.begin(job, "Extraindo arquivos");
            let directory = PathBuf::from(&job.directory);
            extracted = extract_playable_zip(archive, &directory, |done, total| {
                reporter.report(job, done, total)
            });
        }
    }
    match extracted {
        Err(ExtractError::Corrupt(message)) => {
            log::warn!("Downloaded archive is damaged: {message}");
            if let Some(archive) = archive {
                let _ = std::fs::remove_file(archive);
            }
            job.state = "FAILED".into();
            job.stage = None;
            job.progress = 0.0;
            job.downloaded_bytes = 0;
            job.error = Some(
                "O arquivo baixado veio corrompido e foi apagado. Tente de novo para baixá-lo outra vez."
                    .into(),
            );
            let _ = save_job(app, job);
            return;
        }
        Err(ExtractError::Other(message)) => {
            job.library_status = Some("manual".into());
            job.library_message = Some(format!(
                "Não foi possível extrair o arquivo: {message} O download foi mantido."
            ));
        }
        Ok(hashes) => {
            if let Some(archive) = archive.filter(|_| !hashes.is_empty() && delete_archives(app)) {
                // The game is out of it; the archive only takes space now.
                let _ = std::fs::remove_file(archive);
            }
            if let Some((status, message)) =
                auto_add_completed_game(app, job, &mut reporter, &hashes)
            {
                job.library_status = Some(status.into());
                job.library_message = message;
            }
        }
    }
    job.state = "COMPLETED".into();
    job.stage = None;
    job.progress = 100.0;
    job.bytes_per_second = 0.0;
    job.remaining_seconds = None;
    let _ = save_job(app, job);
}
fn delete_archives(app: &tauri::AppHandle) -> bool {
    crate::commands::get_settings(app.state::<Database>())
        .map(|settings| settings["deleteArchives"] != false)
        .unwrap_or(true)
}
#[derive(Default)]
struct RateMeter {
    previous: Option<(Instant, u64)>,
}
impl RateMeter {
    fn update(&mut self, job: &mut DownloadJob, done: u64, total: u64) {
        let now = Instant::now();
        job.bytes_per_second = self.previous.map(|(at, bytes)| done.saturating_sub(bytes) as f64 / now.duration_since(at).as_secs_f64().max(0.001)).unwrap_or(0.0);
        self.previous = Some((now, done));
        job.downloaded_bytes = done;
        job.total_bytes = total;
        job.progress = if total > 0 { (done as f64 / total as f64 * 100.0).min(100.0) } else { 0.0 };
        job.remaining_seconds = if total > done && job.bytes_per_second > 0.0 { Some(((total - done) as f64 / job.bytes_per_second) as u64) } else { None };
    }
}
/// Adds the single playable file of a download. Returns the library status
/// and a message for the player, or None when automatic adding was not asked.
fn auto_add_completed_game(
    app: &tauri::AppHandle,
    job: &mut DownloadJob,
    reporter: &mut StageReporter,
    hashes: &ExtractedHashes,
) -> Option<(&'static str, Option<String>)> {
    if !job.auto_add_to_library {
        return None;
    }
    add_to_library(app, job, reporter, None, hashes)
}
/// Adds `chosen`, or the download's only playable file, under the job's game.
fn add_to_library(
    app: &tauri::AppHandle,
    job: &mut DownloadJob,
    reporter: &mut StageReporter,
    chosen: Option<&Path>,
    hashes: &ExtractedHashes,
) -> Option<(&'static str, Option<String>)> {
    let game = job.game.clone()?;
    let manual = |message: String| Some(("manual", Some(message)));
    let root = match Path::new(&job.directory).canonicalize() {
        Ok(root) => root,
        Err(error) => return manual(error.to_string()),
    };
    let mut files = Vec::new();
    if let Err(message) = collect_files(&root, &root, &mut files, &mut 0) {
        return manual(message);
    }
    let matches: Vec<_> = files
        .into_iter()
        .filter(|file| file.platform_ids.contains(&game.platform_id))
        .filter(|file| chosen.is_none_or(|chosen| Path::new(&file.path) == chosen))
        .collect();
    let file = match matches.as_slice() {
        [file] => file,
        [] => {
            return manual(unsupported_console(&root).map_or_else(
                || "Nenhum arquivo deste console foi encontrado no download. Use Adicionar à biblioteca para escolher o arquivo.".into(),
                unsupported_message,
            ))
        }
        several => {
            return manual(format!(
                "O download tem {} arquivos deste console. Use Adicionar à biblioteca para escolher qual adicionar.",
                several.len()
            ))
        }
    };
    // A file hashed during extraction keeps that hash while its size holds;
    // anything else is hashed once here, and the import trusts this hash.
    let known = std::fs::canonicalize(&file.path)
        .ok()
        .and_then(|path| Some((hashes.get(&path)?, std::fs::metadata(&path).ok()?.len())))
        .filter(|((size, _), current)| size == current)
        .map(|((_, sha256), _)| sha256.clone());
    let inspected = match known {
        Some(sha256) => crate::filesystem::inspect_with_hash(&file.path, sha256),
        None => {
            reporter.begin(job, "Verificando o jogo");
            crate::filesystem::inspect_with_progress(&file.path, |done, total| {
                reporter.report(job, done, total)
            })
        }
    };
    let candidate = match inspected {
        Ok(candidate) => candidate,
        Err(message) => return manual(message),
    };
    reporter.begin(job, "Adicionando à biblioteca");
    match crate::commands::insert_library_game(app, game.clone(), candidate) {
        Ok(()) => {
            let _ = app.emit(
                "download-imported",
                serde_json::json!({"gameId": game.id, "downloadId": job.id}),
            );
            Some(("added", None))
        }
        Err(message) if message.contains("already in your library") => {
            Some(("added", Some("Este jogo já estava na sua biblioteca.".into())))
        }
        Err(message) => manual(message),
    }
}
/// Adds a finished download to the library in the background. Progress shows
/// on the job like the automatic import; `path` picks one of several files.
#[tauri::command]
pub fn add_download_to_library(
    app: tauri::AppHandle,
    id: String,
    path: Option<String>,
) -> Result<()> {
    let job = get_job(&app, &id)?;
    if job.state != "COMPLETED" {
        return Err("Wait for the download to finish before importing a file.".into());
    }
    if job.game.is_none() {
        return Err("Este download não tem os dados do jogo. Use Adicionar jogo.".into());
    }
    let chosen = match path {
        Some(path) => {
            let root = PathBuf::from(&job.directory).canonicalize().map_err(error)?;
            let file = PathBuf::from(path).canonicalize().map_err(error)?;
            if !file.starts_with(&root) {
                return Err("Escolha um arquivo deste download.".into());
            }
            Some(file)
        }
        None => None,
    };
    // Saved before returning so the page keeps polling from the first refresh.
    let mut job = job;
    job.state = "INSTALLING".into();
    job.stage = Some("Procurando o arquivo do jogo".into());
    job.progress = 0.0;
    save_job(&app, &job)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut reporter = StageReporter {
            app: &app,
            saved_at: Instant::now(),
        };
        let outcome = add_to_library(&app, &mut job, &mut reporter, chosen.as_deref(), &HashMap::new());
        let (status, message) = outcome.unwrap_or(("manual", None));
        job.library_status = Some(status.into());
        job.library_message = message;
        job.state = "COMPLETED".into();
        job.stage = None;
        job.progress = 100.0;
        let _ = save_job(&app, &job);
    });
    Ok(())
}
fn spawn_direct_transfer(app: &tauri::AppHandle, mut job: DownloadJob) -> Result<()> {
    job.state = "QUEUED".into();
    job.error = None;
    save_job(app, &job)?;
    let cancel = CancellationToken::new();
    let worker_cancel = cancel.clone();
    let app_clone = app.clone();
    let id = job.id.clone();
    let task = tauri::async_runtime::spawn(async move {
        if let Err(message) = direct_transfer(&app_clone, &mut job, &worker_cancel).await {
            if !worker_cancel.is_cancelled() {
                job.state = "FAILED".into();
                job.error = Some(message);
                job.bytes_per_second = 0.0;
                job.remaining_seconds = None;
                let _ = save_job(&app_clone, &job);
            }
        }
    });
    app.state::<DownloadService>()
        .active
        .lock()
        .map_err(error)?
        .insert(id, ActiveTask { cancel, task });
    Ok(())
}
#[tauri::command]
pub async fn start_source_download(
    app: tauri::AppHandle,
    source_id: String,
    entry_id: String,
    uri_index: usize,
    game: Option<GameMetadata>,
    download_directory: Option<String>,
    auto_extract: bool,
    auto_add_to_library: bool,
) -> Result<String> {
    let service = app.state::<DownloadService>();
    let _guard = service.operations.lock().await;
    let app_clone = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        sources::find_entry(&app_clone, &source_id, &entry_id)?
            .ok_or("Download entry is unavailable. Enable or refresh its source.".to_string())
    })
    .await
    .map_err(error)??;
    let uri = selected
        .entry
        .uris
        .get(uri_index)
        .ok_or("Select a valid download link.")?
        .clone();
    let is_magnet = sources::magnet_hash(&uri).is_ok();
    let hash = if is_magnet {
        sources::magnet_hash(&uri)?
    } else {
        sources::direct_url(&uri)?;
        sources::download_key(&uri)
    };
    let existing = list_download_jobs(app.state::<Database>())?;
    if existing
        .iter()
        .any(|j| j.info_hash == hash && j.state != "CANCELLED")
    {
        return Err(
            "This download is already in Downloads. Resume or use its existing files.".into(),
        );
    }
    let id = uuid::Uuid::new_v4().to_string();
    let settings = crate::commands::get_settings(app.state::<Database>())?;
    let root = download_directory
        .filter(|directory| !directory.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            settings["downloadDirectory"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or(app.path().app_data_dir().map_err(error)?.join("downloads"));
    if !root.is_absolute() {
        return Err("Choose an absolute download directory in Settings.".into());
    }
    std::fs::create_dir_all(&root).map_err(error)?;
    let directory = root.canonicalize().map_err(error)?.join(&id);
    std::fs::create_dir(&directory).map_err(error)?;
    let job = DownloadJob {
        id: id.clone(),
        name: selected.entry.title,
        source_name: selected.source_name,
        magnet: uri,
        info_hash: hash,
        state: "QUEUED".into(),
        progress: 0.0,
        bytes_per_second: 0.0,
        remaining_seconds: None,
        downloaded_bytes: 0,
        total_bytes: 0,
        directory: directory.to_string_lossy().into_owned(),
        error: None,
        game,
        auto_extract,
        auto_add_to_library,
        stage: None,
        library_status: None,
        library_message: None,
    };
    if is_magnet {
        spawn_transfer(&app, job)?;
    } else {
        spawn_direct_transfer(&app, job)?;
    }
    Ok(id)
}
#[tauri::command]
pub fn list_download_jobs(db: State<Database>) -> Result<Vec<DownloadJob>> {
    let conn = db.0.lock().map_err(error)?;
    let mut stmt = conn
        .prepare("SELECT data FROM download_jobs ORDER BY rowid DESC")
        .map_err(error)?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(error)?;
    rows.map(|r| serde_json::from_str(&r.map_err(error)?).map_err(error))
        .collect()
}
#[tauri::command]
pub async fn control_download(app: tauri::AppHandle, id: String, action: String) -> Result<()> {
    let service = app.state::<DownloadService>();
    let _guard = service.operations.lock().await;
    let mut job = get_job(&app, &id)?;
    if !["pause", "resume", "cancel"].contains(&action.as_str()) {
        return Err("Unknown download action.".into());
    }
    if job.state == "COMPLETED" {
        return Err("This download is already complete.".into());
    }
    let active = service.active.lock().map_err(error)?.remove(&id);
    if let Some(active) = active {
        active.cancel.cancel();
        active.task.await.map_err(error)?;
    }
    job = get_job(&app, &id)?;
    // The worker may have completed between the click and cancellation.
    if job.state == "COMPLETED" {
        return Ok(());
    }
    if action == "resume" {
        if job.state == "COMPLETED"
            || list_download_jobs(app.state::<Database>())?
                .iter()
                .any(|j| j.id != id && j.info_hash == job.info_hash && j.state != "CANCELLED")
        {
            return Err(
                "This torrent is already present in another download or has completed.".into(),
            );
        }
        if sources::magnet_hash(&job.magnet).is_ok() {
            spawn_transfer(&app, job)?;
        } else {
            spawn_direct_transfer(&app, job)?;
        }
    } else {
        job.state = if action == "pause" {
            "PAUSED"
        } else {
            "CANCELLED"
        }
        .into();
        job.bytes_per_second = 0.0;
        job.remaining_seconds = None;
        save_job(&app, &job)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn remove_download(app: tauri::AppHandle, id: String) -> Result<()> {
    let service = app.state::<DownloadService>();
    let _guard = service.operations.lock().await;
    let active = service.active.lock().map_err(error)?.remove(&id);
    if let Some(active) = active {
        active.cancel.cancel();
        active.task.await.map_err(error)?;
    }
    app.state::<Database>()
        .0
        .lock()
        .map_err(error)?
        .execute("DELETE FROM download_jobs WHERE id=?1", [&id])
        .map_err(error)?;
    Ok(())
}
/// Consoles OpenRetro cannot run, recognised by the layout of their dumps in
/// the download or in the folder a torrent wraps it in.
fn unsupported_console(root: &Path) -> Option<&'static str> {
    let names = |dir: &Path| -> Vec<String> {
        std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    };
    let top = names(root);
    let folders = top.iter().map(|name| root.join(name)).filter(|path| path.is_dir());
    std::iter::once(top.clone())
        .chain(folders.map(|folder| names(&folder)))
        .find_map(|names| {
            let names: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
            let has = |name: &str| names.iter().any(|n| n == name);
            if has("default.xex") {
                Some("Xbox 360")
            } else if names.iter().any(|n| {
                [".wbfs", ".rvz", ".wia", ".gcz"].iter().any(|ext| n.ends_with(ext))
            }) {
                Some("Wii ou GameCube")
            } else {
                None
            }
        })
}

fn unsupported_message(console: &str) -> String {
    format!(
        "Este download é de {console}, que o OpenRetro não roda. Remova-o e escolha outra versão nas opções de download, de preferência uma marcada com o console do jogo."
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedFile {
    pub path: String,
    pub filename: String,
    pub platform_ids: Vec<String>,
}
fn collect_files(
    root: &Path,
    dir: &Path,
    files: &mut Vec<DownloadedFile>,
    visited: &mut usize,
) -> Result<()> {
    if dir.strip_prefix(root).map_err(error)?.components().count() > 32 {
        return Err(
            "Download folders are nested too deeply. Use Add game to choose a file.".into(),
        );
    }
    for entry in std::fs::read_dir(dir).map_err(error)? {
        let entry = entry.map_err(error)?;
        *visited += 1;
        if *visited > 10_000 {
            return Err(
                "Too many files to inspect automatically. Use Add game to choose the game file."
                    .into(),
            );
        }
        let kind = entry.file_type().map_err(error)?;
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path().canonicalize().map_err(error)?;
        if !path.starts_with(root) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if kind.is_dir() && name.starts_with("ps3_") {
            // PS3 disc folders hold data files with console extensions; only
            // the EBOOT.BIN they boot is a game.
            if name == "ps3_game" {
                if let Some(eboot) = crate::filesystem::ps3_boot_file(&path) {
                    files.push(DownloadedFile {
                        path: eboot.to_string_lossy().into_owned(),
                        filename: "EBOOT.BIN".into(),
                        platform_ids: vec!["ps3".into()],
                    });
                }
            }
        } else if kind.is_dir() {
            collect_files(root, &path, files, visited)?;
        } else if kind.is_file() && name != "eboot.bin" {
            let extension = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if [
                "gb", "gbc", "gba", "nes", "sfc", "smc", "z64", "n64", "v64", "nds", "sms", "md",
                "gen", "gg", "cue", "chd", "pbp", "iso", "cso", "bin",
            ]
            .contains(&extension.as_str())
            {
                let ids = crate::filesystem::platform_ids_for_file(&path);
                files.push(DownloadedFile {
                    path: path.to_string_lossy().into_owned(),
                    filename: entry.file_name().to_string_lossy().into_owned(),
                    platform_ids: ids,
                });
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ps3_games_are_found_by_what_they_boot() {
        let root = std::env::temp_dir().join(format!("openretro-ps3-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("Game/PS3_GAME/USRDIR/DATA")).unwrap();
        std::fs::write(root.join("Game/PS3_DISC.SFB"), b"").unwrap();
        std::fs::write(root.join("Game/PS3_GAME/USRDIR/EBOOT.BIN"), b"").unwrap();
        // Data files with console extensions are not games.
        std::fs::write(root.join("Game/PS3_GAME/USRDIR/DATA/music.bin"), b"").unwrap();
        let mut disc = vec![0u8; 0x900];
        disc[0x800..0x80c].copy_from_slice(b"PlayStation3");
        std::fs::write(root.join("Other (USA).iso"), &disc).unwrap();
        std::fs::write(root.join("PS2 Game (USA).iso"), vec![0u8; 0x900]).unwrap();
        let root = root.canonicalize().unwrap();
        let mut files = Vec::new();
        collect_files(&root, &root, &mut files, &mut 0).unwrap();
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let found: Vec<_> = files
            .iter()
            .map(|file| (file.filename.as_str(), file.platform_ids.clone()))
            .collect();
        assert_eq!(
            found,
            [
                ("EBOOT.BIN", vec!["ps3".to_string()]),
                ("Other (USA).iso", vec!["ps3".to_string()]),
                ("PS2 Game (USA).iso", vec!["psp".to_string(), "ps2".to_string()]),
            ]
        );
        assert_eq!(unsupported_console(&root), None);
        std::fs::write(root.join("default.xex"), b"").unwrap();
        assert_eq!(unsupported_console(&root), Some("Xbox 360"));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn extraction_reports_progress_and_keeps_only_playable_files() {
        let root = std::env::temp_dir().join(format!("openretro-extract-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("game.zip");
        let game: Vec<u8> = (0..3_000_000u32).map(|i| (i % 7) as u8).collect();
        {
            let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("Game (USA).sfc", options).unwrap();
            zip.write_all(&game).unwrap();
            zip.start_file("readme.txt", options).unwrap();
            zip.write_all(b"notes").unwrap();
            zip.finish().unwrap();
        }
        let mut reports = Vec::new();
        let hashes =
            extract_playable_zip(&archive, &root, |done, total| reports.push((done, total))).unwrap();
        let extracted = root.join("extracted/Game (USA).sfc");
        assert_eq!(std::fs::read(&extracted).unwrap(), game);
        let path = extracted.canonicalize().unwrap();
        assert_eq!(
            hashes[&path],
            (game.len() as u64, crate::filesystem::hash(&path).unwrap())
        );
        assert_eq!(hashes.len(), 1);
        assert!(!root.join("extracted/readme.txt").exists());
        assert!(reports.len() > 1);
        assert_eq!(*reports.last().unwrap(), (game.len() as u64, game.len() as u64));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn damaged_archives_leave_no_game_behind() {
        let root = std::env::temp_dir().join(format!("openretro-damaged-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("game.zip");
        let game: Vec<u8> = (0..500_000u32).map(|i| (i * 7 % 251) as u8).collect();
        {
            let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("Game (USA).sfc", options).unwrap();
            zip.write_all(&game).unwrap();
            zip.finish().unwrap();
        }
        // Flip one byte of the stored data: only the CRC can notice.
        let mut bytes = std::fs::read(&archive).unwrap();
        bytes[1000] ^= 0xff;
        std::fs::write(&archive, bytes).unwrap();
        let result = extract_playable_zip(&archive, &root, |_, _| {});
        assert!(matches!(result, Err(ExtractError::Corrupt(_))), "{result:?}");
        let extracted: Vec<_> = std::fs::read_dir(root.join("extracted")).unwrap().collect();
        assert!(extracted.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn downloads_magnet_from_local_seed_and_verifies_contents() {
        use librqbit::{create_torrent, CreateTorrentOptions};
        let root =
            std::env::temp_dir().join(format!("openretro-torrent-test-{}", uuid::Uuid::new_v4()));
        let seed_dir = root.join("seed");
        let output = root.join("download");
        std::fs::create_dir_all(&seed_dir).unwrap();
        std::fs::create_dir_all(&output).unwrap();
        // An original test payload, deliberately not a playable game.
        let payload = vec![42u8; 256 * 1024];
        let file = seed_dir.join("fixture.gb");
        std::fs::write(&file, &payload).unwrap();
        let torrent = create_torrent(&file, CreateTorrentOptions::default())
            .await
            .unwrap();
        let opts = || SessionOptions {
            defer_writes_up_to: Some(32),
            disable_dht: true,
            disable_dht_persistence: true,
            enable_upnp_port_forwarding: false,
            listen_port_range: Some(24000..25000),
            ..Default::default()
        };
        let seed = Session::new_with_opts(seed_dir.clone(), opts())
            .await
            .unwrap();
        let seeding = seed
            .add_torrent(
                AddTorrent::from_bytes(torrent.as_bytes().unwrap()),
                Some(AddTorrentOptions {
                    overwrite: true,
                    disable_trackers: true,
                    ..Default::default()
                }),
            )
            .await
            .unwrap()
            .into_handle()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(20), seeding.wait_until_completed())
            .await
            .unwrap()
            .unwrap();
        let downloader = Session::new_with_opts(output.clone(), opts())
            .await
            .unwrap();
        let magnet = format!("magnet:?xt=urn:btih:{}", seeding.info_hash().as_string());
        let peer = std::net::SocketAddr::from(([127, 0, 0, 1], seed.tcp_listen_port().unwrap()));
        let downloaded = tokio::time::timeout(
            Duration::from_secs(30),
            checked_add(
                &downloader,
                &magnet,
                output.to_str().unwrap(),
                Some(vec![peer]),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        tokio::time::timeout(Duration::from_secs(30), downloaded.wait_until_completed())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(std::fs::read(output.join("fixture.gb")).unwrap(), payload);
        assert!(downloaded.stats().finished);
        downloader.pause(&downloaded).await.unwrap();
        downloader.unpause(&downloaded).await.unwrap();
        downloader
            .delete(librqbit::api::TorrentIdOrHash::Id(downloaded.id()), false)
            .await
            .unwrap();
        assert!(output.join("fixture.gb").is_file());
        // Resume rechecks existing pieces rather than trusting the old percentage.
        std::fs::write(output.join("fixture.gb"), vec![0u8; payload.len()]).unwrap();
        let resumed = checked_add(
            &downloader,
            &magnet,
            output.to_str().unwrap(),
            Some(vec![peer]),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(30), resumed.wait_until_completed())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(std::fs::read(output.join("fixture.gb")).unwrap(), payload);
        downloader
            .delete(librqbit::api::TorrentIdOrHash::Id(resumed.id()), false)
            .await
            .unwrap();
        drop(resumed);
        let mut files = Vec::new();
        let canonical_output = output.canonicalize().unwrap();
        collect_files(&canonical_output, &canonical_output, &mut files, &mut 0).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].platform_ids, vec!["gb"]);
        downloader.stop().await;
        seed.stop().await;
        drop(downloaded);
        drop(seeding);
        drop(downloader);
        drop(seed);
        // Test paths are fixed beneath a unique temporary directory created above.
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_platform_path_tricks() {
        for name in [
            "..",
            "../escape.gb",
            "C:escape.gb",
            "/escape.gb",
            "a\\b.gb",
            "CON",
            "NUL.gb",
            "a.gb:stream",
            "a.\0gb",
        ] {
            assert!(validate_component(name).is_err(), "{name}");
        }
        assert!(validate_component("A normal game (USA).gb").is_ok());
    }
}
#[tauri::command]
pub async fn download_files(app: tauri::AppHandle, id: String) -> Result<Vec<DownloadedFile>> {
    tauri::async_runtime::spawn_blocking(move || {
        let job = get_job(&app, &id)?;
        if job.state != "COMPLETED" {
            return Err("Wait for the download to finish before importing a file.".into());
        }
        let root = PathBuf::from(job.directory).canonicalize().map_err(error)?;
        let mut files = Vec::new();
        collect_files(&root, &root, &mut files, &mut 0)?;
        if files.is_empty() {
            if let Some(console) = unsupported_console(&root) {
                return Err(unsupported_message(console));
            }
        }
        Ok(files)
    })
    .await
    .map_err(error)?
}
