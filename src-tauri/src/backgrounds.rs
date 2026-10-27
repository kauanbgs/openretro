//! Pictures a player chooses as the Big Picture background. Each one is copied
//! into the app's data folder, which the asset protocol serves, so the
//! background keeps working after the original is moved or deleted.
use crate::database::{error, Result};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_BYTES: u64 = 40 << 20;
const MAX_PICTURES: usize = 60;

fn directory(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir().map_err(error)?.join("backgrounds"))
}

/// The extension a picture's own bytes call for, so a renamed file of
/// another kind is never served as an image.
fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else {
        None
    }
}

fn pictures(directory: &Path) -> Vec<PathBuf> {
    let mut list: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_file())
        .filter_map(|entry| {
            let modified = entry.metadata().and_then(|m| m.modified()).ok()?;
            Some((modified, entry.path()))
        })
        .collect();
    list.sort();
    list.into_iter().map(|(_, path)| path).collect()
}

#[tauri::command]
pub fn list_console_backgrounds(app: tauri::AppHandle) -> Result<Vec<String>> {
    Ok(pictures(&directory(&app)?)
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub async fn add_console_background(app: tauri::AppHandle, path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(&path);
        let size = std::fs::metadata(&source).map_err(error)?.len();
        if size > MAX_BYTES {
            return Err("A imagem é grande demais. Escolha uma com até 40 MB.".into());
        }
        let bytes = std::fs::read(&source).map_err(error)?;
        let extension = image_extension(&bytes)
            .ok_or("Escolha uma imagem PNG, JPG, WEBP ou GIF.")?;
        let directory = directory(&app)?;
        std::fs::create_dir_all(&directory).map_err(error)?;
        let name = format!("{:x}.{extension}", Sha256::digest(&bytes));
        let target = directory.join(&name);
        if !target.exists() {
            if pictures(&directory).len() >= MAX_PICTURES {
                return Err("Você já tem imagens demais. Remova alguma antes.".into());
            }
            std::fs::write(&target, &bytes).map_err(error)?;
        }
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub fn remove_console_background(app: tauri::AppHandle, path: String) -> Result<()> {
    let directory = directory(&app)?.canonicalize().map_err(error)?;
    let file = PathBuf::from(path).canonicalize().map_err(error)?;
    if file.parent() != Some(directory.as_path()) {
        return Err("Essa imagem não é um fundo do OpenRetro.".into());
    }
    std::fs::remove_file(file).map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_real_images_are_accepted() {
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\n...."), Some("png"));
        assert_eq!(image_extension(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(image_extension(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_extension(b"GIF89a.."), Some("gif"));
        assert_eq!(image_extension(b"MZ\x90\0 not an image"), None);
        assert_eq!(image_extension(b"<svg></svg>"), None);
    }
}
