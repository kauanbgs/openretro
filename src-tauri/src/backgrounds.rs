//! Pictures a player chooses as the Big Picture background. Each one is copied
//! into the app's data folder, which the asset protocol serves, so the
//! background keeps working after the original is moved or deleted.
//!
//! The same goes for the pictures and videos behind the whole interface, which
//! live in their own folder so Big Picture never lists a video.
use crate::database::{error, Result};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_BYTES: u64 = 40 << 20;
const MAX_PICTURES: usize = 60;
const MAX_MEDIA_BYTES: u64 = 300 << 20;
const MAX_MEDIA: usize = 30;

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

/// Pictures as above, plus MP4 and WebM videos, from a file's first bytes.
fn media_extension(head: &[u8]) -> Option<&'static str> {
    if let Some(extension) = image_extension(head) {
        Some(extension)
    } else if head.len() >= 12 && &head[4..8] == b"ftyp" {
        Some("mp4")
    } else if head.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        Some("webm")
    } else {
        None
    }
}

fn appearance_directory(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir().map_err(error)?.join("appearance"))
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

fn remove_from(directory: PathBuf, path: String) -> Result<()> {
    let directory = directory.canonicalize().map_err(error)?;
    let file = PathBuf::from(path).canonicalize().map_err(error)?;
    if file.parent() != Some(directory.as_path()) {
        return Err("Esse arquivo não é um fundo do OpenRetro.".into());
    }
    std::fs::remove_file(file).map_err(error)
}

#[tauri::command]
pub fn remove_console_background(app: tauri::AppHandle, path: String) -> Result<()> {
    remove_from(directory(&app)?, path)
}

#[tauri::command]
pub fn list_appearance_media(app: tauri::AppHandle) -> Result<Vec<String>> {
    Ok(pictures(&appearance_directory(&app)?)
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[tauri::command]
pub async fn add_appearance_media(app: tauri::AppHandle, path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = PathBuf::from(&path);
        let size = std::fs::metadata(&source).map_err(error)?.len();
        if size > MAX_MEDIA_BYTES {
            return Err("O arquivo é grande demais. Escolha um com até 300 MB.".into());
        }
        let mut file = std::fs::File::open(&source).map_err(error)?;
        let mut head = [0u8; 16];
        let read = file.read(&mut head).map_err(error)?;
        let extension = media_extension(&head[..read])
            .ok_or("Escolha uma imagem PNG, JPG, WEBP, GIF ou um vídeo MP4 ou WebM.")?;
        // Hash while reading so a long video never sits in memory.
        let mut hasher = Sha256::new();
        hasher.update(&head[..read]);
        let mut buffer = vec![0u8; 1 << 20];
        loop {
            let count = file.read(&mut buffer).map_err(error)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        let directory = appearance_directory(&app)?;
        std::fs::create_dir_all(&directory).map_err(error)?;
        let target = directory.join(format!("{:x}.{extension}", hasher.finalize()));
        if !target.exists() {
            if pictures(&directory).len() >= MAX_MEDIA {
                return Err("Você já tem fundos demais. Remova algum antes.".into());
            }
            std::fs::copy(&source, &target).map_err(error)?;
        }
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub fn remove_appearance_media(app: tauri::AppHandle, path: String) -> Result<()> {
    remove_from(appearance_directory(&app)?, path)
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

    #[test]
    fn videos_are_told_apart_from_other_files() {
        assert_eq!(media_extension(b"\0\0\0\x18ftypmp42\0\0\0\0"), Some("mp4"));
        assert_eq!(media_extension(&[0x1a, 0x45, 0xdf, 0xa3, 0x01]), Some("webm"));
        assert_eq!(media_extension(b"GIF89a.."), Some("gif"));
        assert_eq!(media_extension(b"MZ\x90\0 not media"), None);
    }
}
