use crate::{
    database::{error, Result},
    models::ImportCandidate,
};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::Read,
    path::{Component, Path, PathBuf},
};
pub fn canonical_file(path: &str) -> Result<PathBuf> {
    if path.contains('\0')
        || Path::new(path)
            .components()
            .any(|p| matches!(p, Component::ParentDir))
    {
        return Err(
            "Choose a file with an absolute path without parent-directory traversal.".into(),
        );
    }
    if !Path::new(path).is_absolute() {
        return Err("An absolute local file path is required.".into());
    }
    let p = std::fs::canonicalize(path).map_err(|_| "This file could not be found. Locate it again, and check that you have permission to read it.".to_string())?;
    if !p.is_file() {
        return Err("Select a file, not a directory.".into());
    }
    Ok(p)
}
pub fn hash(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(error)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(error)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
pub fn inspect(path: &str) -> Result<ImportCandidate> {
    let path = canonical_file(path)?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let platforms: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/db/platforms.json")).map_err(error)?;
    let ids = platforms
        .as_array()
        .ok_or("Invalid platform catalog")?
        .iter()
        .filter(|p| {
            p["extensions"]
                .as_array()
                .is_some_and(|extensions| extensions.iter().any(|e| e.as_str() == Some(&extension)))
        })
        .filter_map(|p| p["id"].as_str().map(String::from))
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Err(format!("The .{extension} format is not recognized. Choose a supported game file; archives are not automatically extracted."));
    }
    Ok(ImportCandidate {
        sha256: hash(&path)?,
        filename: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        platform_ids: ids,
    })
}
pub fn inspect_folder(path: &str) -> Result<Vec<ImportCandidate>> {
    if path.contains('\0') || !Path::new(path).is_absolute() {
        return Err("Choose an absolute local folder.".into());
    }
    let root = std::fs::canonicalize(path)
        .map_err(|_| "This folder could not be found or read.".to_string())?;
    if !root.is_dir() {
        return Err("Choose a folder, not a file.".into());
    }
    let mut found = Vec::new();
    let mut pending = vec![(root, 0usize)];
    while let Some((directory, depth)) = pending.pop() {
        for entry in std::fs::read_dir(directory).map_err(error)? {
            let entry = entry.map_err(error)?;
            let kind = entry.file_type().map_err(error)?;
            if kind.is_symlink() {
                continue;
            }
            let entry_path = entry.path();
            if kind.is_dir() {
                if depth < 8 {
                    pending.push((entry_path, depth + 1));
                }
                continue;
            }
            if !kind.is_file() {
                continue;
            }
            let extension = entry_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_lowercase();
            let platform_catalog: serde_json::Value =
                serde_json::from_str(include_str!("../../../src/db/platforms.json"))
                    .map_err(error)?;
            let supported = platform_catalog.as_array().is_some_and(|platforms| {
                platforms.iter().any(|platform| {
                    platform["extensions"].as_array().is_some_and(|extensions| {
                        extensions
                            .iter()
                            .any(|item| item.as_str() == Some(&extension))
                    })
                })
            });
            if !supported {
                continue;
            }
            found.push(inspect(&entry_path.to_string_lossy())?);
            if found.len() >= 500 {
                return Err("This folder has more than 500 supported games. Import smaller folders to keep the library responsive.".into());
            }
        }
    }
    if found.is_empty() {
        return Err("No supported game files were found in this folder.".into());
    }
    found.sort_by(|left, right| {
        left.filename
            .to_lowercase()
            .cmp(&right.filename.to_lowercase())
    });
    Ok(found)
}
pub fn executable(path: &str) -> Result<PathBuf> {
    let p = canonical_file(path)?;
    #[cfg(target_os = "windows")]
    if !p.extension().is_some_and(|s| s.eq_ignore_ascii_case("exe")) {
        return Err("Choose an emulator .exe, not a script or shortcut.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::metadata(&p).map_err(error)?.permissions().mode() & 0o111 == 0 {
            return Err("The selected emulator does not have executable permission.".into());
        }
    }
    Ok(p)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_relative_and_traversal() {
        assert!(canonical_file("../game.nes").is_err());
        assert!(canonical_file("game.nes").is_err());
    }
    #[test]
    fn sha256_known_vector() {
        let p = std::env::temp_dir().join(format!("openretro-{}.nes", uuid::Uuid::new_v4()));
        std::fs::write(&p, b"abc").unwrap();
        assert_eq!(
            hash(&p).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::remove_file(p).unwrap();
    }
}
