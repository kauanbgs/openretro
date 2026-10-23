use crate::{
    database::{error, Result},
    models::ImportCandidate,
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::SystemTime,
};
type PlatformExtensions = HashMap<String, Vec<String>>;
fn platform_extensions() -> &'static PlatformExtensions {
    static EXTENSIONS: OnceLock<PlatformExtensions> = OnceLock::new();
    EXTENSIONS.get_or_init(|| {
        let platforms: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/db/platforms.json"))
                .expect("bundled platform catalog");
        let mut extensions = HashMap::<String, Vec<String>>::new();
        for platform in platforms.as_array().expect("platform array") {
            for ext in platform["extensions"]
                .as_array()
                .expect("platform extensions")
            {
                extensions
                    .entry(ext.as_str().unwrap().into())
                    .or_default()
                    .push(platform["id"].as_str().unwrap().into());
            }
        }
        extensions
    })
}
/// Whether `id` names one of OpenRetro's consoles.
pub fn is_platform_id(id: &str) -> bool {
    platform_extensions().values().flatten().any(|platform| platform == id) || id == "ps3"
}
pub fn platform_ids_for_extension(extension: &str) -> Vec<String> {
    platform_extensions()
        .get(extension)
        .cloned()
        .unwrap_or_default()
}
/// The child of `dir` called `name`, whatever its letter case.
fn child(dir: &Path, name: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .find(|entry| entry.file_name().to_string_lossy().eq_ignore_ascii_case(name))
        .map(|entry| entry.path())
}
/// What a PS3 disc folder boots: `PS3_GAME/USRDIR/EBOOT.BIN`, given `PS3_GAME`.
pub fn ps3_boot_file(ps3_game: &Path) -> Option<PathBuf> {
    child(&child(ps3_game, "USRDIR")?, "EBOOT.BIN").filter(|path| path.is_file())
}
/// A PS3 game is a disc folder, imported through the EBOOT.BIN it boots, or a
/// disc image whose second sector starts with "PlayStation3".
fn is_ps3_game(path: &Path) -> bool {
    let name = |path: Option<&Path>| {
        path.and_then(Path::file_name)
            .map(|name| name.to_string_lossy().to_lowercase())
    };
    match name(Some(path)).as_deref() {
        Some("eboot.bin") => {
            let usrdir = path.parent();
            name(usrdir).as_deref() == Some("usrdir")
                && name(usrdir.and_then(Path::parent)).as_deref() == Some("ps3_game")
        }
        Some(file) if file.ends_with(".iso") => {
            let mut header = [0u8; 12];
            File::open(path)
                .and_then(|mut file| {
                    file.seek(SeekFrom::Start(0x800))?;
                    file.read_exact(&mut header)
                })
                .is_ok()
                && &header == b"PlayStation3"
        }
        _ => false,
    }
}
pub fn platform_ids_for_file(path: &Path) -> Vec<String> {
    if is_ps3_game(path) {
        return vec!["ps3".into()];
    }
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    platform_ids_for_extension(&extension)
}
#[derive(Clone)]
struct InspectedFile {
    candidate: ImportCandidate,
    size: u64,
    modified: SystemTime,
}
fn inspected_files() -> &'static Mutex<HashMap<String, InspectedFile>> {
    static FILES: OnceLock<Mutex<HashMap<String, InspectedFile>>> = OnceLock::new();
    FILES.get_or_init(Mutex::default)
}
/// Only reuse fingerprints computed by this process while size and modification time match.
/// Client-supplied fingerprints and platforms are never trusted.
pub fn reuse_inspected(candidate: &ImportCandidate) -> Result<ImportCandidate> {
    let path = canonical_file(&candidate.path)?;
    let metadata = std::fs::metadata(&path).map_err(error)?;
    if let Some(cached) = inspected_files()
        .lock()
        .map_err(error)?
        .get(&path.to_string_lossy().into_owned())
    {
        if cached.candidate.sha256 == candidate.sha256
            && cached.size == metadata.len()
            && metadata.modified().ok() == Some(cached.modified)
        {
            return Ok(cached.candidate.clone());
        }
    }
    let inspected = inspect(&candidate.path)?;
    if inspected.sha256 != candidate.sha256 {
        return Err("O arquivo mudou durante a importação. Selecione-o novamente.".into());
    }
    Ok(inspected)
}
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
    hash_with_progress(path, |_, _| {})
}
/// Large reads keep multi-gigabyte games fast; progress is (bytes read, total).
pub fn hash_with_progress(path: &Path, mut progress: impl FnMut(u64, u64)) -> Result<String> {
    let mut file = File::open(path).map_err(error)?;
    let total = file.metadata().map_err(error)?.len();
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut done = 0u64;
    loop {
        let count = file.read(&mut buffer).map_err(error)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        done += count as u64;
        progress(done, total);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
pub fn inspect(path: &str) -> Result<ImportCandidate> {
    inspect_with_progress(path, |_, _| {})
}
pub fn inspect_with_progress(
    path: &str,
    progress: impl FnMut(u64, u64),
) -> Result<ImportCandidate> {
    inspect_hashed(path, |path| hash_with_progress(path, progress))
}
/// Inspects a file whose hash was taken while it was written, such as a game
/// just extracted from a download.
pub fn inspect_with_hash(path: &str, sha256: String) -> Result<ImportCandidate> {
    inspect_hashed(path, |_| Ok(sha256))
}
fn inspect_hashed(
    path: &str,
    digest: impl FnOnce(&Path) -> Result<String>,
) -> Result<ImportCandidate> {
    let path = canonical_file(path)?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let ids = platform_ids_for_file(&path);
    if ids.is_empty() {
        return Err(format!("The .{extension} format is not recognized. Choose a supported game file; archives are not automatically extracted."));
    }
    let before = std::fs::metadata(&path).map_err(error)?;
    let candidate = ImportCandidate {
        sha256: digest(&path)?,
        filename: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        platform_ids: ids,
    };
    let after = std::fs::metadata(&path).map_err(error)?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("O arquivo mudou durante a leitura. Selecione-o novamente.".into());
    }
    if let Ok(modified) = after.modified() {
        let mut cache = inspected_files().lock().map_err(error)?;
        if cache.len() >= 1000 {
            cache.clear();
        }
        cache.insert(
            candidate.path.clone(),
            InspectedFile {
                candidate: candidate.clone(),
                size: after.len(),
                modified,
            },
        );
    }
    Ok(candidate)
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
            // PS3 disc folders hold data files with console extensions; only
            // the EBOOT.BIN they boot is a game.
            if kind.is_dir() && entry.file_name().to_string_lossy().to_lowercase().starts_with("ps3_") {
                if entry.file_name().eq_ignore_ascii_case("ps3_game") {
                    found.extend(ps3_boot_file(&entry_path));
                }
                continue;
            }
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
            let supported = platform_extensions().contains_key(&extension);
            if !supported {
                continue;
            }
            found.push(entry_path);
            if found.len() >= 500 {
                return Err("This folder has more than 500 supported games. Import smaller folders to keep the library responsive.".into());
            }
        }
    }
    if found.is_empty() {
        return Err("No supported game files were found in this folder.".into());
    }
    // Bound disk contention and memory: at most four 1 MiB hash buffers at once.
    let workers = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(4);
    let next = std::sync::atomic::AtomicUsize::new(0);
    let results = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|_| {
                scope.spawn(|| {
                    let mut results = Vec::new();
                    loop {
                        let index = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(path) = found.get(index) else { break };
                        results.push(inspect(&path.to_string_lossy()));
                    }
                    results
                })
            })
            .collect();
        let mut results = Vec::new();
        for handle in handles {
            results.extend(
                handle
                    .join()
                    .map_err(|_| "Não foi possível ler a pasta.".to_string())?,
            );
        }
        Ok::<_, String>(results)
    })?;
    let mut found = results.into_iter().collect::<Result<Vec<_>>>()?;
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
    fn folder_fingerprints_are_reused_and_modified_or_forged_files_are_rechecked() {
        let root = std::env::temp_dir().join(format!("openretro-folder-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("nested")).unwrap();
        let path = root.join("A.nes");
        std::fs::write(&path, b"abc").unwrap();
        std::fs::write(root.join("nested/B.gba"), b"def").unwrap();
        std::fs::write(root.join("ignore.txt"), b"ignored").unwrap();
        let candidates = inspect_folder(&root.to_string_lossy()).unwrap();
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].filename, "A.nes");
        assert_eq!(candidates[1].platform_ids, vec!["gba"]);
        let mut forged = candidates[0].clone();
        forged.platform_ids = vec!["ps2".into()];
        assert_eq!(reuse_inspected(&forged).unwrap().platform_ids, vec!["nes"]);
        forged.sha256 = "0".repeat(64);
        assert!(reuse_inspected(&forged).is_err());
        std::fs::write(&path, b"modified content").unwrap();
        assert!(reuse_inspected(&candidates[0]).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn progress_hash_matches_and_reaches_the_file_size() {
        let path = std::env::temp_dir().join(format!("openretro-hash-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, vec![42u8; 2_500_000]).unwrap();
        let mut last = (0, 0);
        let hashed = hash_with_progress(&path, |done, total| last = (done, total)).unwrap();
        assert_eq!(hashed, hash(&path).unwrap());
        assert_eq!(last, (2_500_000, 2_500_000));
        std::fs::remove_file(path).unwrap();
    }
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
