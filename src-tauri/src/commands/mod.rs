use crate::{
    database::{self, error, Database, Result},
    filesystem,
    models::*,
};
use rusqlite::params;
use serde::Deserialize;
use std::{fs::File, io::copy, process::Command};
use tauri::{Manager, State};

const MGBA_RELEASES_API: &str = "https://api.github.com/repos/mgba-emu/mgba/releases/latest";

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}
#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[tauri::command]
pub fn list_library(db: State<Database>) -> Result<Vec<LibraryGame>> {
    let conn = db.0.lock().map_err(error)?;
    database::library(&conn)
}
#[tauri::command]
pub fn list_emulators(db: State<Database>) -> Result<Vec<Emulator>> {
    let conn = db.0.lock().map_err(error)?;
    database::emulators(&conn)
}
#[tauri::command]
pub fn emulator_install_options() -> Vec<EmulatorInstall> {
    vec![EmulatorInstall {
        id: "mgba".into(),
        name: "mGBA".into(),
        description: "Game Boy, Game Boy Color and Game Boy Advance".into(),
        supported_platforms: vec!["gb".into(), "gbc".into(), "gba".into()],
        source_name: "mGBA official GitHub release".into(),
        source_url: "https://github.com/mgba-emu/mgba/releases".into(),
    }]
}
#[tauri::command]
pub async fn install_emulator(id: String, app: tauri::AppHandle) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || install_emulator_blocking(&id, &app))
        .await
        .map_err(error)?
}
fn install_emulator_blocking(id: &str, app: &tauri::AppHandle) -> Result<String> {
    if id != "mgba" {
        return Err("This emulator installer is not supported.".into());
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    return Err(
        "The built-in mGBA installer is currently available on 64-bit Windows only.".into(),
    );
    #[cfg(all(windows, target_arch = "x86_64"))]
    {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(90))
            .user_agent("OpenRetro/0.1")
            .build()
            .map_err(error)?;
        let release: GithubRelease = client
            .get(MGBA_RELEASES_API)
            .send()
            .map_err(error)?
            .error_for_status()
            .map_err(error)?
            .json()
            .map_err(error)?;
        let asset = release
            .assets
            .iter()
            .find(|asset| asset.name.ends_with("-win64-installer.exe"))
            .ok_or("The latest official mGBA release has no 64-bit Windows installer.")?;
        if asset.size == 0 || asset.size > 100 * 1024 * 1024 {
            return Err("The official installer has an unexpected size.".into());
        }
        let parsed = url::Url::parse(&asset.browser_download_url).map_err(error)?;
        if parsed.scheme() != "https" || parsed.host_str() != Some("github.com") {
            return Err("The release asset is not hosted by GitHub.".into());
        }
        let installers = app
            .path()
            .app_cache_dir()
            .map_err(error)?
            .join("installers");
        std::fs::create_dir_all(&installers).map_err(error)?;
        let installer = installers.join(format!("mGBA-{}-win64-installer.exe", release.tag_name));
        if !installer.is_file() {
            let mut response = client
                .get(&asset.browser_download_url)
                .send()
                .map_err(error)?
                .error_for_status()
                .map_err(error)?;
            let final_url = response.url();
            if final_url.scheme() != "https"
                || !final_url.host_str().is_some_and(|host| {
                    host == "github.com" || host.ends_with(".githubusercontent.com")
                })
            {
                return Err("The installer download was redirected outside GitHub.".into());
            }
            let temporary = installer.with_extension("partial");
            let mut output = File::create(&temporary).map_err(error)?;
            let written = copy(&mut response, &mut output).map_err(error)?;
            drop(output);
            if written != asset.size {
                let _ = std::fs::remove_file(&temporary);
                return Err("The official installer download was incomplete.".into());
            }
            std::fs::rename(temporary, &installer).map_err(error)?;
        }
        Command::new(&installer).spawn().map_err(error)?;
        Ok("The official mGBA installer is open. Finish its Windows steps, then choose Detect installed in OpenRetro.".into())
    }
}
#[tauri::command]
pub async fn inspect_game(path: String) -> Result<ImportCandidate> {
    tauri::async_runtime::spawn_blocking(move || filesystem::inspect(&path))
        .await
        .map_err(error)?
}
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    filesystem::canonical_file(&path).is_ok()
}
#[tauri::command]
pub async fn add_game(
    app: tauri::AppHandle,
    game: GameMetadata,
    candidate: ImportCandidate,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
 let inspected = filesystem::inspect(&candidate.path)?;
 if inspected.sha256 != candidate.sha256 { return Err("The file changed during import. Select it again.".into()); }
 if !inspected.platform_ids.contains(&game.platform_id) { return Err("The selected platform does not match this file extension.".into()); }
 if game.title.trim().is_empty() { return Err("Give this game a title before importing it.".into()); }
 let db = app.state::<Database>(); let mut conn = db.0.lock().map_err(error)?; let tx = conn.transaction().map_err(error)?;
 let duplicate: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM library_items WHERE sha256=?1)", [&inspected.sha256], |r| r.get(0)).map_err(error)?;
 if duplicate { return Err("This file is already in your library.".into()); }
 tx.execute("INSERT INTO games(id,metadata) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata",params![game.id,serde_json::to_string(&game).map_err(error)?]).map_err(error)?;
 tx.execute("INSERT INTO library_items(id,game_id,platform_id,source_provider,source_path,added_at,sha256) VALUES(?1,?2,?3,'local',?4,?5,?6)",params![uuid::Uuid::new_v4().to_string(),game.id,game.platform_id,inspected.path,chrono::Utc::now().to_rfc3339(),inspected.sha256]).map_err(error)?;
 tx.commit().map_err(error)?; log::info!("Imported game {}",game.id); Ok(())
 }).await.map_err(error)?
}
#[tauri::command]
pub fn remove_game(id: String, db: State<Database>) -> Result<()> {
    let conn = db.0.lock().map_err(error)?;
    let active: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM play_sessions WHERE library_item_id=?1 AND finished_at IS NULL)", [&id], |r| r.get(0)).map_err(error)?;
    if active {
        return Err("Close the running game before removing it from your library.".into());
    }
    conn.execute("DELETE FROM library_items WHERE id=?1", [id])
        .map_err(error)?;
    Ok(())
}
#[tauri::command]
pub fn set_favorite(id: String, favorite: bool, db: State<Database>) -> Result<()> {
    db.0.lock()
        .map_err(error)?
        .execute(
            "UPDATE library_items SET favorite=?1 WHERE id=?2",
            params![favorite, id],
        )
        .map_err(error)?;
    Ok(())
}
#[tauri::command]
pub fn configure_game(
    id: String,
    emulator_id: Option<String>,
    bios_path: Option<String>,
    runtime_args: Vec<String>,
    db: State<Database>,
) -> Result<()> {
    if let Some(path) = &bios_path {
        filesystem::canonical_file(path)?;
    }
    if runtime_args.len() > 64
        || runtime_args
            .iter()
            .any(|a| a.contains('\0') || a.len() > 4096)
    {
        return Err("Launch arguments exceed the allowed size.".into());
    }
    db.0.lock()
        .map_err(error)?
        .execute(
            "UPDATE library_items SET emulator_id=?1,bios_path=?2,runtime_args=?3 WHERE id=?4",
            params![
                emulator_id,
                bios_path,
                serde_json::to_string(&runtime_args).map_err(error)?,
                id
            ],
        )
        .map_err(error)?;
    Ok(())
}
#[tauri::command]
pub async fn relocate_game(
    app: tauri::AppHandle,
    id: String,
    candidate: ImportCandidate,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let inspected = filesystem::inspect(&candidate.path)?;
        let db = app.state::<Database>();
        let conn = db.0.lock().map_err(error)?;
        let platform: String = conn
            .query_row(
                "SELECT platform_id FROM library_items WHERE id=?1",
                [&id],
                |r| r.get(0),
            )
            .map_err(error)?;
        if !inspected.platform_ids.contains(&platform) {
            return Err("Choose a file compatible with this game's platform.".into());
        }
        conn.execute(
            "UPDATE library_items SET source_path=?1,sha256=?2 WHERE id=?3",
            params![inspected.path, inspected.sha256, id],
        )
        .map_err(error)?;
        Ok(())
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub async fn verify_game(app: tauri::AppHandle, id: String) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<Database>();
        let (path, expected): (String, String) =
            db.0.lock()
                .map_err(error)?
                .query_row(
                    "SELECT source_path,sha256 FROM library_items WHERE id=?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(error)?;
        Ok(filesystem::hash(&filesystem::canonical_file(&path)?)? == expected)
    })
    .await
    .map_err(error)?
}
#[tauri::command]
pub fn save_emulator(mut emulator: Emulator, db: State<Database>) -> Result<()> {
    emulator.executable_path = filesystem::executable(&emulator.executable_path)?
        .to_string_lossy()
        .into_owned();
    if emulator.name.trim().is_empty() || emulator.supported_platforms.is_empty() {
        return Err("Name the emulator and select at least one supported platform.".into());
    }
    if emulator
        .default_platforms
        .iter()
        .any(|p| !emulator.supported_platforms.contains(p))
    {
        return Err("Defaults must be supported platforms.".into());
    }
    let mut conn = db.0.lock().map_err(error)?;
    let tx = conn.transaction().map_err(error)?;
    for mut other in database::emulators(&tx)? {
        if other.id == emulator.id {
            continue;
        }
        other
            .default_platforms
            .retain(|p| !emulator.default_platforms.contains(p));
        tx.execute(
            "UPDATE emulators SET data=?1 WHERE id=?2",
            params![serde_json::to_string(&other).map_err(error)?, other.id],
        )
        .map_err(error)?;
    }
    tx.execute("INSERT INTO emulators(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![emulator.id,serde_json::to_string(&emulator).map_err(error)?]).map_err(error)?;
    tx.commit().map_err(error)?;
    Ok(())
}
#[tauri::command]
pub fn remove_emulator(id: String, db: State<Database>) -> Result<()> {
    db.0.lock()
        .map_err(error)?
        .execute("DELETE FROM emulators WHERE id=?1", [id])
        .map_err(error)?;
    Ok(())
}
#[tauri::command]
pub fn test_emulator(id: String, db: State<Database>) -> Result<String> {
    let list = database::emulators(&*db.0.lock().map_err(error)?)?;
    let emulator = list
        .iter()
        .find(|e| e.id == id)
        .ok_or("This emulator is no longer configured.")?;
    filesystem::executable(&emulator.executable_path)?;
    Ok("Executable found and permissions validated. Launch a game to verify platform compatibility.".into())
}
#[tauri::command]
pub fn detect_emulators() -> Vec<Emulator> {
    let specs = [
        ("mgba", "mGBA", vec!["gb", "gbc", "gba"]),
        ("duckstation-qt", "DuckStation", vec!["psx"]),
        ("ppsspp", "PPSSPP", vec!["psp"]),
        ("snes9x", "Snes9x", vec!["snes"]),
        ("fceux", "FCEUX", vec!["nes"]),
        ("melonDS", "melonDS", vec!["nds"]),
    ];
    let paths = std::env::var_os("PATH").unwrap_or_default();
    specs
        .iter()
        .filter_map(|(bin, name, platforms)| {
            let path = std::env::split_paths(&paths)
                .map(|dir| dir.join(format!("{bin}{}", std::env::consts::EXE_SUFFIX)))
                .find(|p| p.is_file())?;
            Some(Emulator {
                id: format!("detected-{bin}"),
                name: name.to_string(),
                executable_path: path.to_string_lossy().into_owned(),
                supported_platforms: platforms.iter().map(|s| s.to_string()).collect(),
                version: None,
                default_platforms: vec![],
            })
        })
        .collect()
}
#[tauri::command]
pub fn get_settings(db: State<Database>) -> Result<serde_json::Value> {
    let conn = db.0.lock().map_err(error)?;
    let raw: std::result::Result<String, _> =
        conn.query_row("SELECT value FROM settings WHERE key='app'", [], |r| {
            r.get(0)
        });
    match raw {
        Ok(s) => serde_json::from_str(&s).map_err(error),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(
            serde_json::json!({"theme":"dark","density":"comfortable","animations":true,"language":"en","downloadDirectory":"","concurrentDownloads":2,"bandwidthLimit":0,"developerMode":false}),
        ),
        Err(e) => Err(error(e)),
    }
}
#[tauri::command]
pub fn save_settings(settings: serde_json::Value, db: State<Database>) -> Result<()> {
    db.0.lock().map_err(error)?.execute("INSERT INTO settings(key,value) VALUES('app',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[settings.to_string()]).map_err(error)?;
    Ok(())
}
#[tauri::command]
pub fn app_paths(app: tauri::AppHandle) -> Result<serde_json::Value> {
    Ok(
        serde_json::json!({"database":app.path().app_data_dir().map_err(error)?.join("openretro.sqlite"),"cache":app.path().app_cache_dir().map_err(error)?,"logs":app.path().app_log_dir().map_err(error)?}),
    )
}
