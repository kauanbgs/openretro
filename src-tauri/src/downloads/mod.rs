pub mod sources;
use crate::{
    database::{error, Database, Result},
    models::GameMetadata,
};
use librqbit::{AddTorrent, AddTorrentOptions, Session, SessionOptions};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, State};
use tokio::sync::OnceCell;
use tokio_util::sync::CancellationToken;

pub const NETWORK_DOWNLOADS_ENABLED: bool = true;
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
}
struct ActiveTask {
    cancel: CancellationToken,
    task: tauri::async_runtime::JoinHandle<()>,
}
#[derive(Default)]
pub struct DownloadService {
    session: OnceCell<Arc<Session>>,
    active: Mutex<HashMap<String, ActiveTask>>,
    operations: tokio::sync::Mutex<()>,
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
            Session::new_with_opts(
                root,
                SessionOptions {
                    disable_dht_persistence: true,
                    enable_upnp_port_forwarding: false,
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
            "COMPLETED"
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
        Duration::from_secs(180),
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
        "No torrent metadata received within 3 minutes. Check peers/trackers, then retry."
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
const MAX_DIRECT_DOWNLOAD_BYTES: u64 = 8 * 1024 * 1024 * 1024;
fn direct_filename(url: &reqwest::Url) -> String {
    let candidate = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|name| !name.is_empty())
        .unwrap_or("download.bin");
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
        name
    } else {
        "download.bin".into()
    }
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
fn extract_playable_zip(archive_path: &Path, directory: &Path) -> Result<()> {
    if archive_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_none_or(|ext| !ext.eq_ignore_ascii_case("zip"))
    {
        return Ok(());
    }
    let mut archive = zip::ZipArchive::new(File::open(archive_path).map_err(error)?)
        .map_err(|_| "Downloaded ZIP is invalid.".to_string())?;
    if archive.len() > 10_000 {
        return Err("Downloaded ZIP has too many entries.".into());
    }
    let output_root = directory.join("extracted");
    let mut total = 0u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error)?;
        let enclosed = entry
            .enclosed_name()
            .ok_or("Downloaded ZIP contains an unsafe path.")?;
        if entry.is_dir() || !playable_extension(&enclosed) {
            continue;
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Downloaded ZIP is too large.")?;
        if total > MAX_DIRECT_DOWNLOAD_BYTES {
            return Err("Downloaded ZIP is too large.".into());
        }
        let destination = output_root.join(enclosed);
        std::fs::create_dir_all(destination.parent().ok_or("Invalid ZIP path.")?).map_err(error)?;
        let mut output = File::create(destination).map_err(error)?;
        std::io::copy(&mut entry, &mut output).map_err(error)?;
    }
    Ok(())
}
fn direct_transfer(
    app: &tauri::AppHandle,
    job: &mut DownloadJob,
    cancel: &CancellationToken,
) -> Result<()> {
    let url = sources::direct_url(&job.magnet)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || sources::direct_url(attempt.url().as_str()).is_err()
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(error)?;
    job.state = "DOWNLOADING".into();
    job.error = None;
    save_job(app, job)?;
    let mut response = client
        .get(url)
        .send()
        .map_err(|_| "Could not start the direct download. Check the link and your connection.")?
        .error_for_status()
        .map_err(|_| "The direct download link is unavailable.")?;
    sources::direct_url(response.url().as_str())?;
    let total = response.content_length().unwrap_or(0);
    if total > MAX_DIRECT_DOWNLOAD_BYTES {
        return Err("The direct download is unexpectedly large.".into());
    }
    let target = PathBuf::from(&job.directory).join(direct_filename(response.url()));
    let temporary = target.with_file_name(format!(
        "{}.part",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("download.bin")
    ));
    let mut output = File::create(&temporary).map_err(error)?;
    let mut buffer = [0u8; 64 * 1024];
    let started = Instant::now();
    let mut saved_at = Instant::now();
    loop {
        if cancel.is_cancelled() {
            return Ok(());
        }
        let read = response
            .read(&mut buffer)
            .map_err(|_| "The direct download stopped unexpectedly.")?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read]).map_err(error)?;
        job.downloaded_bytes = job.downloaded_bytes.saturating_add(read as u64);
        if job.downloaded_bytes > MAX_DIRECT_DOWNLOAD_BYTES {
            return Err("The direct download is unexpectedly large.".into());
        }
        job.total_bytes = total;
        let elapsed = started.elapsed().as_secs_f64().max(0.1);
        job.bytes_per_second = job.downloaded_bytes as f64 / elapsed;
        job.progress = if total == 0 {
            0.0
        } else {
            (job.downloaded_bytes as f64 / total as f64 * 100.0).min(100.0)
        };
        job.remaining_seconds = if total > job.downloaded_bytes && job.bytes_per_second > 0.0 {
            Some(((total - job.downloaded_bytes) as f64 / job.bytes_per_second) as u64)
        } else {
            None
        };
        if saved_at.elapsed() >= Duration::from_millis(750) {
            save_job(app, job)?;
            saved_at = Instant::now();
        }
    }
    output.flush().map_err(error)?;
    drop(output);
    std::fs::rename(&temporary, &target).map_err(error)?;
    if job.auto_extract {
        extract_playable_zip(&target, Path::new(&job.directory))?;
    }
    job.state = "COMPLETED".into();
    job.progress = 100.0;
    job.bytes_per_second = 0.0;
    job.remaining_seconds = None;
    if total == 0 {
        job.total_bytes = job.downloaded_bytes;
    }
    save_job(app, job)
}
fn spawn_direct_transfer(app: &tauri::AppHandle, mut job: DownloadJob) -> Result<()> {
    job.state = "QUEUED".into();
    job.error = None;
    save_job(app, &job)?;
    let cancel = CancellationToken::new();
    let worker_cancel = cancel.clone();
    let completion_cancel = cancel.clone();
    let app_clone = app.clone();
    let failure_app = app.clone();
    let id = job.id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || {
            let result = direct_transfer(&app_clone, &mut job, &worker_cancel);
            (job, result)
        })
        .await;
        if !completion_cancel.is_cancelled() {
            if let Ok((mut failed_job, Err(message))) = result {
                failed_job.state = "FAILED".into();
                failed_job.error = Some(message);
                failed_job.bytes_per_second = 0.0;
                let _ = save_job(&failure_app, &failed_job);
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
) -> Result<String> {
    let service = app.state::<DownloadService>();
    let _guard = service.operations.lock().await;
    let app_clone = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        sources::all_matches(&app_clone.state::<Database>(), "")?
            .into_iter()
            .find(|m| m.source_id == source_id && m.id == entry_id)
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
        if kind.is_dir() {
            collect_files(root, &path, files, visited)?;
        } else if kind.is_file() {
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
                let catalog: serde_json::Value =
                    serde_json::from_str(include_str!("../../../src/db/platforms.json"))
                        .map_err(error)?;
                let ids = catalog
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|p| {
                        p["extensions"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|e| e.as_str() == Some(extension.as_str()))
                    })
                    .filter_map(|p| p["id"].as_str().map(String::from))
                    .collect();
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
        Ok(files)
    })
    .await
    .map_err(error)?
}
