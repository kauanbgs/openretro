use crate::{
    database::{self, error, Database, Result},
    filesystem,
    models::*,
};
use rusqlite::params;
use std::process::Command;
use tauri::{Manager, State};

struct InstallerSpec {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    platforms: &'static [&'static str],
    is_base: bool,
    winget_id: &'static str,
    source_url: &'static str,
}
const INSTALLERS: &[InstallerSpec] = &[
    InstallerSpec {
        id: "retroarch",
        name: "RetroArch",
        description: "Base for classic consoles. Install cores in RetroArch after setup.",
        platforms: &[
            "nes", "snes", "n64", "gb", "gbc", "gba", "nds", "sms", "genesis", "gg", "psx", "psp",
            "arcade", "dos",
        ],
        is_base: true,
        winget_id: "Libretro.RetroArch",
        source_url: "https://www.retroarch.com/?page=platforms",
    },
    InstallerSpec {
        id: "pcsx2",
        name: "PCSX2",
        description: "PlayStation 2",
        platforms: &["ps2"],
        is_base: false,
        winget_id: "PCSX2Team.PCSX2",
        source_url: "https://pcsx2.net/downloads/",
    },
    InstallerSpec {
        id: "mgba",
        name: "mGBA",
        description: "Game Boy, Game Boy Color and Game Boy Advance",
        platforms: &["gb", "gbc", "gba"],
        is_base: false,
        winget_id: "JeffreyPfau.mGBA",
        source_url: "https://mgba.io/downloads.html",
    },
    InstallerSpec {
        id: "ppsspp",
        name: "PPSSPP",
        description: "PlayStation Portable",
        platforms: &["psp"],
        is_base: false,
        winget_id: "PPSSPPTeam.PPSSPP",
        source_url: "https://www.ppsspp.org/download/",
    },
    InstallerSpec {
        id: "duckstation",
        name: "DuckStation",
        description: "PlayStation",
        platforms: &["psx"],
        is_base: false,
        winget_id: "Stenzek.DuckStation",
        source_url: "https://www.duckstation.org/",
    },
];

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
    INSTALLERS
        .iter()
        .map(|installer| EmulatorInstall {
            id: installer.id.into(),
            name: installer.name.into(),
            description: installer.description.into(),
            supported_platforms: installer
                .platforms
                .iter()
                .map(|platform| (*platform).into())
                .collect(),
            source_name: "Official project download".into(),
            source_url: installer.source_url.into(),
            is_base: installer.is_base,
        })
        .collect()
}
#[tauri::command]
pub async fn install_emulator(id: String, app: tauri::AppHandle) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || install_emulator_blocking(&id, &app))
        .await
        .map_err(error)?
}
fn install_emulator_blocking(id: &str, app: &tauri::AppHandle) -> Result<String> {
    let installer = INSTALLERS
        .iter()
        .find(|installer| installer.id == id)
        .ok_or("This emulator installer is not supported.")?;
    #[cfg(not(windows))]
    return Err("The built-in emulator installer is currently available on Windows only.".into());
    #[cfg(windows)]
    {
        let result = Command::new("winget")
            .args([
                "install", "--exact", "--id", installer.winget_id,
                "--accept-package-agreements", "--accept-source-agreements",
                "--disable-interactivity",
            ])
            .status()
            .map_err(|_| "Windows App Installer (winget) is required to install emulators. Install it from Microsoft Store, then try again.")?;
        if !result.success() {
            return Err(format!(
                "{} could not be installed. Check the Windows installer prompt and try again.",
                installer.name
            ));
        }
        if installer.id == "retroarch" {
            let executable = managed_retroarch_path().ok_or(
                "RetroArch installed, but OpenRetro could not find retroarch.exe. Use Detect installed to select it.",
            )?;
            register_retroarch(app, executable)?;
            return Ok("RetroArch was installed and set as OpenRetro's default runtime. Install cores from RetroArch's Online Updater before playing each console.".into());
        }
        Ok(format!(
            "{} was installed. Choose Detect installed to add it to OpenRetro.",
            installer.name
        ))
    }
}
#[cfg(windows)]
fn managed_retroarch_path() -> Option<std::path::PathBuf> {
    let mut roots = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        roots.push(std::path::PathBuf::from(program_files));
    }
    if let Some(program_files) = std::env::var_os("ProgramW6432") {
        roots.push(std::path::PathBuf::from(program_files));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        roots.push(std::path::PathBuf::from(local_app_data).join("Programs"));
    }
    roots
        .into_iter()
        .map(|root| root.join("RetroArch").join("retroarch.exe"))
        .find(|path| path.is_file())
}
#[cfg(windows)]
fn register_retroarch(app: &tauri::AppHandle, executable: std::path::PathBuf) -> Result<()> {
    let emulator = Emulator {
        id: "openretro-retroarch".into(),
        name: "RetroArch".into(),
        executable_path: filesystem::executable(&executable.to_string_lossy())?
            .to_string_lossy()
            .into_owned(),
        supported_platforms: INSTALLERS[0]
            .platforms
            .iter()
            .map(|platform| (*platform).into())
            .collect(),
        version: None,
        default_platforms: INSTALLERS[0]
            .platforms
            .iter()
            .map(|platform| (*platform).into())
            .collect(),
    };
    let database = app.state::<Database>();
    let mut conn = database.0.lock().map_err(error)?;
    let transaction = conn.transaction().map_err(error)?;
    for mut other in database::emulators(&transaction)? {
        if other.id != emulator.id {
            other
                .default_platforms
                .retain(|platform| !emulator.default_platforms.contains(platform));
            transaction
                .execute(
                    "UPDATE emulators SET data=?1 WHERE id=?2",
                    params![serde_json::to_string(&other).map_err(error)?, other.id],
                )
                .map_err(error)?;
        }
    }
    transaction.execute("INSERT INTO emulators(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![emulator.id, serde_json::to_string(&emulator).map_err(error)?]).map_err(error)?;
    transaction.commit().map_err(error)
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
        (
            "retroarch",
            "RetroArch",
            vec![
                "nes", "snes", "n64", "gb", "gbc", "gba", "nds", "sms", "genesis", "gg", "psx",
                "psp", "arcade", "dos",
            ],
        ),
        ("pcsx2-qt", "PCSX2", vec!["ps2"]),
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
