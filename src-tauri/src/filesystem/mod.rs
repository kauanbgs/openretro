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
/// A Switch dump is an NSP (a "PFS0" archive from the first byte) or an XCI
/// (a "HEAD" header at 0x100), whatever its file is called. Dumps named after
/// their title ID often end in .bin, which would pass for a Mega Drive game.
fn is_switch_game(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    // Cartridge-sized ROMs of other consoles are skipped without opening them.
    if !["bin", "nsp", "xci", "nsz", "xcz", ""].contains(&extension.as_str()) {
        return false;
    }
    let magic_at = |offset: u64| {
        let mut magic = [0u8; 4];
        File::open(path)
            .and_then(|mut file| {
                file.seek(SeekFrom::Start(offset))?;
                file.read_exact(&mut magic)
            })
            .is_ok()
            .then_some(magic)
    };
    magic_at(0) == Some(*b"PFS0") || magic_at(0x100) == Some(*b"HEAD")
}
/// A game installed inside a yuzu-style emulator's own storage: its program
/// NCA under `nand/user/Contents/registered`. Smaller NCAs there are
/// updates' and DLC's pieces, and the emulator launches from this path.
fn is_installed_switch_game(path: &Path) -> bool {
    const MIN_SIZE: u64 = 256 * 1024 * 1024;
    let names: Vec<String> = path
        .components()
        .map(|part| part.as_os_str().to_string_lossy().to_lowercase())
        .collect();
    names.last().is_some_and(|name| name.ends_with(".nca"))
        && names
            .windows(4)
            .any(|part| part == ["nand", "user", "contents", "registered"])
        && std::fs::metadata(path).is_ok_and(|meta| meta.len() >= MIN_SIZE)
}
/// The name yuzu cached for the game installed in the same storage
/// (`user/cache/game_list/<title id>.appname.txt`). With several games cached
/// there is no telling which one an NCA is without the console's keys.
fn installed_title(path: &Path) -> Option<String> {
    if !is_installed_switch_game(path) {
        return None;
    }
    let list = path.ancestors().find_map(|dir| {
        ["user/cache/game_list", "cache/game_list"]
            .iter()
            .map(|sub| dir.join(sub))
            .find(|list| list.is_dir())
    })?;
    let mut names = std::fs::read_dir(list)
        .ok()?
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".appname.txt"))
        .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty());
    let (first, second) = (names.next()?, names.next());
    second.is_none().then_some(first)
}
pub fn platform_ids_for_file(path: &Path) -> Vec<String> {
    if is_installed_switch_game(path) {
        return vec!["switch".into()];
    }
    if is_ps3_game(path) {
        return vec!["ps3".into()];
    }
    if is_switch_game(path) {
        return vec!["switch".into()];
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
        title_hint: installed_title(&path),
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
            // Emulators keep shader and game-list caches in files named after
            // the games; they are never games.
            if kind.is_dir()
                && ["shader", "shaders", "glcache", "cache"]
                    .contains(&entry.file_name().to_string_lossy().to_lowercase().as_str())
            {
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
            let supported =
                platform_extensions().contains_key(&extension) || is_installed_switch_game(&entry_path);
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
    fn switch_dumps_are_known_by_their_content_not_their_extension() {
        let root = std::env::temp_dir().join(format!("openretro-switch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let nsp = root.join("0100152000022000.bin");
        std::fs::write(&nsp, b"PFS0\0\0\0\0").unwrap();
        let mut xci = vec![0u8; 0x200];
        xci[0x100..0x104].copy_from_slice(b"HEAD");
        let xci_path = root.join("game.xci");
        std::fs::write(&xci_path, xci).unwrap();
        let rom = root.join("sonic.bin");
        std::fs::write(&rom, vec![0u8; 0x400]).unwrap();
        assert_eq!(platform_ids_for_file(&nsp), vec!["switch"]);
        assert_eq!(platform_ids_for_file(&xci_path), vec!["switch"]);
        assert!(!platform_ids_for_file(&rom).contains(&"switch".to_string()));
        // A game installed in the emulator's storage is its big program NCA.
        let registered = root.join("user/nand/user/Contents/registered");
        std::fs::create_dir_all(&registered).unwrap();
        let program = registered.join("450a70dabf2a93d9486661a0ed383da9.nca");
        std::fs::File::create(&program).unwrap().set_len(300 * 1024 * 1024).unwrap();
        let piece = registered.join("0c9ea0f5670f8e18377cf3c0e964f934.nca");
        std::fs::write(&piece, vec![0u8; 1024]).unwrap();
        assert_eq!(platform_ids_for_file(&program), vec!["switch"]);
        let list = root.join("user/cache/game_list");
        std::fs::create_dir_all(&list).unwrap();
        std::fs::write(list.join("0100152000022000.appname.txt"), "Mario Kart 8 Deluxe
").unwrap();
        assert_eq!(installed_title(&program).as_deref(), Some("Mario Kart 8 Deluxe"));
        std::fs::write(list.join("01007EF00011E000.appname.txt"), "Zelda").unwrap();
        assert_eq!(installed_title(&program), None);
        std::fs::remove_file(list.join("01007EF00011E000.appname.txt")).unwrap();
        assert!(platform_ids_for_file(&piece).is_empty());
        let shaders = root.join("user/shader/opengl/transferable");
        std::fs::create_dir_all(&shaders).unwrap();
        std::fs::write(shaders.join("0100152000022000.bin"), vec![0u8; 64]).unwrap();
        let found = inspect_folder(&root.to_string_lossy()).unwrap();
        let names: Vec<_> = found.iter().map(|c| c.filename.as_str()).collect();
        assert!(names.contains(&"450a70dabf2a93d9486661a0ed383da9.nca"), "found {names:?}");
        assert!(!found.iter().any(|c| c.path.to_lowercase().contains("shader")));
        std::fs::remove_dir_all(&root).ok();
    }
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
