use crate::database::{self, error, Database, Result};
use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Thumbnails larger than this are skipped rather than sent over IPC.
const MAX_THUMBNAIL_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveState {
    /// -1 is the automatic resume state.
    slot: i32,
    modified_at: String,
    size: u64,
    thumbnail: Option<String>,
}

struct StateFile {
    slot: i32,
    path: PathBuf,
}

/// The runtime writes `<stem>.state`, `<stem>.state<N>` and `<stem>.state.auto`,
/// each with an optional `.png` thumbnail beside it.
fn parse_slot(name: &str, stem: &str) -> Option<i32> {
    let rest = name.strip_prefix(stem)?.strip_prefix(".state")?;
    match rest {
        "" => Some(0),
        ".auto" => Some(-1),
        digits
            if !digits.is_empty()
                && digits.len() <= 3
                && digits.bytes().all(|b| b.is_ascii_digit()) =>
        {
            digits.parse().ok()
        }
        _ => None,
    }
}

/// The runtime's own state directory (portable `:\states` unless
/// retroarch.cfg overrides it). Each candidate's direct subfolders are
/// included for sort-by-core layouts.
fn directories(runtime: &Path, game: &Path) -> Vec<PathBuf> {
    let configured = std::fs::read_to_string(runtime.join("retroarch.cfg"))
        .ok()
        .and_then(|config| {
            config.lines().find_map(|line| {
                let (key, value) = line.split_once('=')?;
                (key.trim() == "savestate_directory")
                    .then(|| value.trim().trim_matches('"').to_string())
            })
        });
    let base = match configured.as_deref() {
        None | Some("default") => runtime.join("states"),
        Some("") => game.parent().map(Path::to_path_buf).unwrap_or_default(),
        Some(value) if value.starts_with(':') => runtime.join(
            value
                .trim_start_matches(':')
                .trim_start_matches(['/', '\\']),
        ),
        Some(value) => PathBuf::from(value),
    };
    with_subfolders(base)
}
fn with_subfolders(base: PathBuf) -> Vec<PathBuf> {
    let mut result = vec![base.clone()];
    if let Ok(entries) = std::fs::read_dir(&base) {
        result.extend(
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir()),
        );
    }
    result
}

fn state_files(dirs: &[PathBuf], stem: &str) -> Vec<StateFile> {
    let mut files: Vec<StateFile> = Vec::new();
    for dir in dirs {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(slot) = path
                .file_name()
                .and_then(|name| name.to_str())
                .and_then(|name| parse_slot(name, stem))
            else {
                continue;
            };
            if !path.is_file() {
                continue;
            }
            // With several candidate folders, the newest file for a slot wins.
            let modified = |p: &Path| p.metadata().and_then(|m| m.modified()).ok();
            match files.iter_mut().find(|file| file.slot == slot) {
                Some(existing) if modified(&path) > modified(&existing.path) => {
                    existing.path = path
                }
                Some(_) => {}
                None => files.push(StateFile { slot, path }),
            }
        }
    }
    files
}

fn thumbnail_path(state: &Path) -> PathBuf {
    let mut name = state.as_os_str().to_owned();
    name.push(".png");
    PathBuf::from(name)
}

fn locate(app: &tauri::AppHandle, id: &str) -> Result<Vec<StateFile>> {
    let db = app.state::<Database>();
    let (entry, emulator) = {
        let conn = db.0.lock().map_err(error)?;
        let entry = database::library(&conn)?
            .into_iter()
            .find(|g| g.item.id == id)
            .ok_or("This game is no longer in your library.")?;
        let emulator = super::select_emulator(&conn, &entry)?;
        (entry, emulator)
    };
    if !super::is_managed_runtime(&emulator, &entry) {
        return Ok(Vec::new());
    }
    let runtime = PathBuf::from(&emulator.executable_path);
    let runtime = runtime.parent().ok_or("Invalid RetroArch directory.")?;
    let game = PathBuf::from(&entry.item.source_path);
    let stem = game
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or("The game file name is invalid.")?;
    let data = app.path().app_data_dir().map_err(error)?;
    // A modified version keeps its own states (see `mods::variant_saves`).
    if let Some(variant) = &entry.item.active_variant {
        let saves = crate::mods::variant_saves(&data, variant)?;
        return Ok(state_files(&with_subfolders(saves.states), stem));
    }
    Ok(state_files(
        &directories(runtime, &game),
        stem,
    ))
}

#[tauri::command]
pub async fn list_save_states(app: tauri::AppHandle, id: String) -> Result<Vec<SaveState>> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut states = locate(&app, &id)?
            .into_iter()
            .filter_map(|file| {
                let metadata = file.path.metadata().ok()?;
                let modified: chrono::DateTime<chrono::Utc> = metadata.modified().ok()?.into();
                let png = thumbnail_path(&file.path);
                let thumbnail = png
                    .metadata()
                    .ok()
                    .filter(|m| m.len() <= MAX_THUMBNAIL_BYTES)
                    .and_then(|_| std::fs::read(&png).ok())
                    .map(|bytes| {
                        format!(
                            "data:image/png;base64,{}",
                            base64::engine::general_purpose::STANDARD.encode(bytes)
                        )
                    });
                Some(SaveState {
                    slot: file.slot,
                    modified_at: modified.to_rfc3339(),
                    size: metadata.len(),
                    thumbnail,
                })
            })
            .collect::<Vec<_>>();
        states.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(states)
    })
    .await
    .map_err(error)?
}

#[tauri::command(async)]
pub fn delete_save_state(app: tauri::AppHandle, id: String, slot: i32) -> Result<()> {
    if crate::in_game::in_game_status(app.clone())?.is_some_and(|session| session.id() == id) {
        return Err("Encerre o jogo antes de apagar um estado salvo.".into());
    }
    let file = locate(&app, &id)?
        .into_iter()
        .find(|file| file.slot == slot)
        .ok_or("Este estado salvo não existe mais.")?;
    std::fs::remove_file(&file.path).map_err(error)?;
    let png = thumbnail_path(&file.path);
    if png.is_file() {
        std::fs::remove_file(png).map_err(error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_only_this_games_state_files() {
        assert_eq!(parse_slot("Mario.state", "Mario"), Some(0));
        assert_eq!(parse_slot("Mario.state7", "Mario"), Some(7));
        assert_eq!(parse_slot("Mario.state.auto", "Mario"), Some(-1));
        assert_eq!(parse_slot("Mario.state7.png", "Mario"), None);
        assert_eq!(parse_slot("Mario.state1.entry", "Mario"), None);
        assert_eq!(parse_slot("Mario Kart.state", "Mario"), None);
        assert_eq!(parse_slot("Mario.state1234", "Mario"), None);
    }
    #[test]
    fn finds_states_in_core_subfolders() {
        let root = std::env::temp_dir().join(format!("openretro-states-{}", uuid::Uuid::new_v4()));
        let core = root.join("runtime").join("states").join("Snes9x");
        std::fs::create_dir_all(&core).unwrap();
        std::fs::write(core.join("Zelda.state2"), b"x").unwrap();
        std::fs::write(core.join("Zelda.state2.png"), b"x").unwrap();
        std::fs::write(core.join("Other.state"), b"x").unwrap();
        let dirs = directories(&root.join("runtime"), &root.join("Zelda.sfc"));
        let files = state_files(&dirs, "Zelda");
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].slot, 2);
        assert!(thumbnail_path(&files[0].path).is_file());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn states_follow_the_runtime_state_directory() {
        let root = std::env::temp_dir().join(format!("openretro-states-{}", uuid::Uuid::new_v4()));
        let runtime = root.join("runtime");
        std::fs::create_dir_all(&runtime).unwrap();
        let game = root.join("roms").join("Zelda.sfc");
        assert_eq!(
            directories(&runtime, &game)[0],
            runtime.join("states")
        );
        std::fs::write(
            runtime.join("retroarch.cfg"),
            "savestate_directory = \":\\custom\"\n",
        )
        .unwrap();
        assert_eq!(
            directories(&runtime, &game)[0],
            runtime.join("custom")
        );
        std::fs::write(
            runtime.join("retroarch.cfg"),
            "savestate_directory = \"\"\n",
        )
        .unwrap();
        assert_eq!(
            directories(&runtime, &game)[0],
            root.join("roms")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
