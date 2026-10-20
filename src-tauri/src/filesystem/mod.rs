use std::{fs::File, io::Read, path::{Component, Path, PathBuf}};
use sha2::{Digest, Sha256};
use crate::{database::{error, Result}, models::ImportCandidate};
pub fn canonical_file(path: &str) -> Result<PathBuf> {
 if path.contains('\0') || Path::new(path).components().any(|p| matches!(p, Component::ParentDir)) { return Err("Choose a file with an absolute path without parent-directory traversal.".into()); }
 if !Path::new(path).is_absolute() { return Err("An absolute local file path is required.".into()); }
 let p = std::fs::canonicalize(path).map_err(|_| "This file could not be found. Locate it again, and check that you have permission to read it.".to_string())?;
 if !p.is_file() { return Err("Select a file, not a directory.".into()); } Ok(p)
}
pub fn hash(path: &Path) -> Result<String> {
 let mut file = File::open(path).map_err(error)?; let mut hasher = Sha256::new(); let mut buffer = [0u8; 65536];
 loop { let count = file.read(&mut buffer).map_err(error)?; if count == 0 { break; } hasher.update(&buffer[..count]); }
 Ok(format!("{:x}", hasher.finalize()))
}
pub fn inspect(path: &str) -> Result<ImportCandidate> {
 let path = canonical_file(path)?; let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
 let platforms: serde_json::Value = serde_json::from_str(include_str!("../../../src/db/platforms.json")).map_err(error)?;
 let ids = platforms.as_array().ok_or("Invalid platform catalog")?.iter().filter(|p| p["extensions"].as_array().is_some_and(|extensions| extensions.iter().any(|e| e.as_str() == Some(&extension)))).filter_map(|p| p["id"].as_str().map(String::from)).collect::<Vec<_>>();
 if ids.is_empty() { return Err(format!("The .{extension} format is not recognized. Choose a supported game file; archives are not automatically extracted.")); }
 Ok(ImportCandidate { sha256:hash(&path)?, filename:path.file_name().unwrap_or_default().to_string_lossy().into_owned(), path:path.to_string_lossy().into_owned(), platform_ids:ids })
}
pub fn executable(path: &str) -> Result<PathBuf> {
 let p = canonical_file(path)?;
 #[cfg(target_os = "windows")]
 if !p.extension().is_some_and(|s| s.eq_ignore_ascii_case("exe")) { return Err("Choose an emulator .exe, not a script or shortcut.".into()); }
 #[cfg(unix)]
 { use std::os::unix::fs::PermissionsExt; if std::fs::metadata(&p).map_err(error)?.permissions().mode() & 0o111 == 0 { return Err("The selected emulator does not have executable permission.".into()); } }
 Ok(p)
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn rejects_relative_and_traversal() { assert!(canonical_file("../game.nes").is_err()); assert!(canonical_file("game.nes").is_err()); }
 #[test] fn sha256_known_vector() { let p = std::env::temp_dir().join(format!("openretro-{}.nes", uuid::Uuid::new_v4())); std::fs::write(&p,b"abc").unwrap(); assert_eq!(hash(&p).unwrap(),"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"); std::fs::remove_file(p).unwrap(); }
}
