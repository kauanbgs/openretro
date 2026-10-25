//! BIOS files for runtime cores that cannot boot without them. OpenRetro keeps
//! one canonical copy under `<data>/system` and mirrors it into each player's
//! system folder, which also holds that player's PS2 memory cards.
use crate::database::{error, Result};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
use tauri::Manager;

/// A console BIOS image is a few megabytes; anything else is not one.
const MAX_BIOS_FILE: u64 = 32 * 1024 * 1024;
const MIN_BIOS_IMAGE: u64 = 1024 * 1024;
/// PCSX2 reads the image plus optional companion files with the same stem.
const PS2_EXTENSIONS: &[&str] = &["bin", "rom0", "rom1", "rom2", "erom", "nvm", "mec"];

fn relative_dir(platform: &str) -> Option<&'static str> {
    match platform {
        "ps2" => Some("pcsx2/bios"),
        _ => None,
    }
}

pub fn system_dir(data: &Path) -> PathBuf {
    data.join("system")
}

pub fn required(platform: &str) -> bool {
    relative_dir(platform).is_some()
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("bin"))
        && path
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() >= MIN_BIOS_IMAGE)
}

pub fn installed(system: &Path, platform: &str) -> bool {
    relative_dir(platform)
        .and_then(|dir| std::fs::read_dir(system.join(dir)).ok())
        .is_some_and(|mut entries| entries.any(|entry| entry.is_ok_and(|e| is_image(&e.path()))))
}

fn allowed(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| PS2_EXTENSIONS.iter().any(|a| a.eq_ignore_ascii_case(ext)))
}

/// Copies BIOS files from a single image (with its companions) or a ZIP.
/// Returns how many BIOS images are now available.
pub fn install(system: &Path, platform: &str, source: &Path) -> Result<usize> {
    let dir =
        system.join(relative_dir(platform).ok_or("Este console não precisa de BIOS no runtime.")?);
    std::fs::create_dir_all(&dir).map_err(error)?;
    let zip = source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
    if zip {
        let file = std::fs::File::open(source).map_err(error)?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|_| "O arquivo ZIP não pôde ser lido.".to_string())?;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(error)?;
            // Only the file name is used, so archive paths cannot escape the folder.
            let Some(name) = entry
                .enclosed_name()
                .and_then(|path| path.file_name().map(|n| n.to_string_lossy().into_owned()))
            else {
                continue;
            };
            if !entry.is_file() || !allowed(&name) || entry.size() > MAX_BIOS_FILE {
                continue;
            }
            let mut bytes = Vec::new();
            entry
                .by_ref()
                .take(MAX_BIOS_FILE + 1)
                .read_to_end(&mut bytes)
                .map_err(error)?;
            if bytes.len() as u64 <= MAX_BIOS_FILE {
                std::fs::write(dir.join(name), bytes).map_err(error)?;
            }
        }
    } else {
        let name = source.file_name().ok_or("Arquivo de BIOS inválido.")?;
        if !allowed(&name.to_string_lossy())
            || source.metadata().map_err(error)?.len() > MAX_BIOS_FILE
        {
            return Err("Selecione o arquivo .bin da BIOS ou um .zip com ela.".into());
        }
        let stem = source
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase());
        let parent = source.parent().ok_or("Arquivo de BIOS inválido.")?;
        for entry in std::fs::read_dir(parent).map_err(error)?.flatten() {
            let path = entry.path();
            let same_stem = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()) == stem;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if same_stem
                && allowed(&file_name)
                && entry
                    .metadata()
                    .is_ok_and(|m| m.is_file() && m.len() <= MAX_BIOS_FILE)
            {
                std::fs::copy(&path, dir.join(&file_name)).map_err(error)?;
            }
        }
    }
    let images = std::fs::read_dir(&dir)
        .map_err(error)?
        .flatten()
        .filter(|entry| is_image(&entry.path()))
        .count();
    if images == 0 {
        return Err("Nenhuma BIOS de PS2 foi encontrada nesse arquivo.".into());
    }
    Ok(images)
}

/// Copies missing BIOS files from the shared folder into a player's folder.
pub fn mirror(shared: &Path, player: &Path) -> Result<()> {
    for dir in ["pcsx2/bios"] {
        let Ok(entries) = std::fs::read_dir(shared.join(dir)) else {
            continue;
        };
        let target = player.join(dir);
        std::fs::create_dir_all(&target).map_err(error)?;
        for entry in entries.flatten() {
            let destination = target.join(entry.file_name());
            if entry.metadata().is_ok_and(|m| m.is_file()) && !destination.exists() {
                std::fs::copy(entry.path(), destination).map_err(error)?;
            }
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn runtime_bios_status(app: tauri::AppHandle, platform: String) -> Result<bool> {
    Ok(!required(&platform)
        || installed(
            &system_dir(&app.path().app_data_dir().map_err(error)?),
            &platform,
        ))
}

#[tauri::command]
pub async fn install_runtime_bios(
    app: tauri::AppHandle,
    platform: String,
    path: String,
) -> Result<usize> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = crate::filesystem::canonical_file(&path)?;
        install(
            &system_dir(&app.path().app_data_dir().map_err(error)?),
            &platform,
            &source,
        )
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp() -> PathBuf {
        let root = std::env::temp_dir().join(format!("openretro-bios-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn installs_images_and_companions_from_a_zip_without_escaping() {
        let root = temp();
        let archive = root.join("bios.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("folder/scph10000.bin", options).unwrap();
        zip.write_all(&vec![0u8; 4 * 1024 * 1024]).unwrap();
        zip.start_file("scph10000.NVM", options).unwrap();
        zip.write_all(&[0u8; 1024]).unwrap();
        zip.start_file("../evil.bin", options).unwrap();
        zip.write_all(&vec![0u8; 2 * 1024 * 1024]).unwrap();
        zip.start_file("readme.exe", options).unwrap();
        zip.write_all(b"x").unwrap();
        zip.finish().unwrap();
        let system = root.join("system");
        assert!(!installed(&system, "ps2"));
        assert_eq!(install(&system, "ps2", &archive).unwrap(), 1);
        let bios = system.join("pcsx2/bios");
        assert!(bios.join("scph10000.bin").is_file());
        assert!(bios.join("scph10000.NVM").is_file());
        assert!(!bios.join("readme.exe").exists());
        assert!(!root.join("evil.bin").exists() && !system.join("evil.bin").exists());
        assert!(installed(&system, "ps2"));

        let player = root.join("player");
        mirror(&system, &player).unwrap();
        assert!(installed(&player, "ps2"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_files_that_are_not_bios_images() {
        let root = temp();
        let text = root.join("notes.txt");
        std::fs::write(&text, "x").unwrap();
        assert!(install(&root.join("system"), "ps2", &text).is_err());
        let tiny = root.join("tiny.bin");
        std::fs::write(&tiny, [0u8; 16]).unwrap();
        assert!(install(&root.join("system"), "ps2", &tiny).is_err());
        assert!(install(&root.join("system"), "snes", &tiny).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
