//! PlayStation 3 games run on RPCS3. Nobody installs it by hand: the first PS3
//! game downloads a tested build into OpenRetro's data folder, along with
//! Sony's system software and Redump's disc keys, and every game then starts
//! it from the command line without its own interface, its game window shown
//! inside OpenRetro's like the runtime's. Before a game starts, its official
//! updates are installed and RPCS3's recommended settings for it are on disk.
use crate::database::{error, Result};
use quick_xml::{events::Event, Reader};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime},
};
use tauri::{Emitter, Manager};

pub const EMULATOR_ID: &str = "openretro-rpcs3";
/// A tested build. Moving to a newer one is a reviewed change, like the runtime.
const BUILD: &str = "0.0.43-20375-0dec46b1";
const BUILD_URL: &str = "https://github.com/RPCS3/rpcs3-binaries-win/releases/download/build-0dec46b12e856756ba04271207a99a1de2208720/rpcs3-v0.0.43-20375-0dec46b1_win64_msvc.7z";
const BUILD_SHA256: &str = "9cb45e282a968e17e490d92b649e556cab7ae89a9feb648ab7e134aac173f5eb";
/// Sony's list names the current system software on its own update server.
const FIRMWARE_LIST: &str =
    "http://fus01.ps3.update.playstation.net/update/ps3/list/us/ps3-updatelist.txt";
const FIRMWARE_HOST: &str = "http://dus01.ps3.update.playstation.net/";
/// Redump's keys for the encrypted disc images its PS3 dumps are.
const DISC_KEYS: &str = "http://redump.org/dkeys/ps3/";
const INPUT_CONFIG: &str = "OpenRetro";
/// Sony's update list for each title. The server presents a certificate from
/// Sony's own authority, which RPCS3's updater also accepts unverified; the
/// packages it names must come from Sony's package server.
const UPDATE_LIST: &str = "https://a0.ww.np.dl.playstation.net/tpl/np/";
const UPDATE_HOST: &str = "http://b0.ww.np.dl.playstation.net/tppkg/np/";
const UPDATE_CHECK_AGE: Duration = Duration::from_secs(24 * 60 * 60);
/// RPCS3's recommended settings per game, as its own interface downloads them.
const CONFIG_DATABASE: &str = "https://api.rpcs3.net/config/?api=v1";
const CONFIG_DATABASE_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir().map_err(error)?.join("rpcs3"))
}

pub fn executable(directory: &Path) -> PathBuf {
    directory.join("rpcs3.exe")
}

fn firmware_installed(directory: &Path) -> bool {
    directory.join("dev_flash/sys/external/liblv2.sprx").is_file()
}

fn report(app: &tauri::AppHandle, message: &str) {
    let _ = app.emit("ps3-setup", message);
}

fn client() -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(30 * 60))
        .user_agent("OpenRetro (+https://github.com/kauanbgs/openretro)")
        .build()
        .map_err(error)
}

/// Streams `url` into `target`, reporting whole percentages, and returns its SHA-256.
fn download(
    app: &tauri::AppHandle,
    url: &str,
    target: &Path,
    limit: u64,
    label: &str,
) -> Result<String> {
    let mut response = client()?
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|_| format!("Não foi possível baixar {label}. Confira sua conexão e tente de novo."))?;
    let total = response.content_length().filter(|size| *size > 0);
    if total.is_some_and(|size| size > limit) {
        return Err(format!("O download de {label} é maior que o esperado."));
    }
    let partial = target.with_extension("partial");
    let mut file = std::fs::File::create(&partial).map_err(error)?;
    let (mut hasher, mut buffer, mut done, mut shown) = (Sha256::new(), vec![0u8; 1 << 20], 0u64, 101);
    loop {
        let count = response.read(&mut buffer).map_err(|_| {
            format!("O download de {label} foi interrompido. Tente de novo.")
        })?;
        if count == 0 {
            break;
        }
        done += count as u64;
        if done > limit {
            drop(file);
            let _ = std::fs::remove_file(&partial);
            return Err(format!("O download de {label} é maior que o esperado."));
        }
        hasher.update(&buffer[..count]);
        file.write_all(&buffer[..count]).map_err(error)?;
        if let Some(total) = total {
            let percent = done * 100 / total;
            if percent != shown {
                shown = percent;
                report(app, &format!("Preparando o PS3: baixando {label} ({percent}%)"));
            }
        }
    }
    file.flush().map_err(error)?;
    drop(file);
    std::fs::rename(&partial, target).map_err(error)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Installs or updates RPCS3, the system software and the disc keys as
/// needed, and returns the executable. Saves in `dev_hdd0` survive updates.
pub fn prepare(app: &tauri::AppHandle) -> Result<PathBuf> {
    let directory = directory(app)?;
    std::fs::create_dir_all(&directory).map_err(error)?;
    let marker = directory.join("openretro-build.txt");
    if std::fs::read_to_string(&marker).ok().as_deref() != Some(BUILD)
        || !executable(&directory).is_file()
    {
        let archive = directory.join("rpcs3.7z");
        let hash = download(app, BUILD_URL, &archive, 200 << 20, "o emulador")?;
        if hash != BUILD_SHA256 {
            let _ = std::fs::remove_file(&archive);
            return Err("O emulador de PS3 baixado veio corrompido. Tente de novo.".into());
        }
        report(app, "Preparando o PS3: instalando o emulador");
        let extracted = sevenz_rust2::decompress_file(&archive, &directory);
        let _ = std::fs::remove_file(&archive);
        extracted.map_err(|e| format!("Não foi possível instalar o emulador de PS3: {e}"))?;
        std::fs::write(&marker, BUILD).map_err(error)?;
    }
    if !firmware_installed(&directory) {
        install_firmware(app, &directory)?;
    }
    move_old_keys(&directory);
    if !has_disc_keys(&directory) {
        // Disc folders play without keys; only disc images need them.
        if let Err(message) = install_disc_keys(app, &directory) {
            log::warn!("PS3 disc keys unavailable: {message}");
        }
    }
    if let Err(message) = refresh_config_database(&directory) {
        log::warn!("RPCS3 config database unavailable: {message}");
    }
    Ok(executable(&directory))
}

fn recent(path: &Path, age: Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|elapsed| elapsed < age)
}

/// RPCS3 applies the database's settings for a game that has none of its own.
/// Without its interface it reads only the copy on disk, so OpenRetro keeps
/// that copy current.
fn refresh_config_database(directory: &Path) -> Result<()> {
    let target = directory.join("GuiConfigs/config_database.dat");
    if recent(&target, CONFIG_DATABASE_AGE) {
        return Ok(());
    }
    let bytes = client()?
        .get(CONFIG_DATABASE)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.bytes())
        .map_err(error)?;
    if bytes.len() > 32 << 20 {
        return Err("The config database is unexpectedly large.".into());
    }
    let database: serde_json::Value = serde_json::from_slice(&bytes).map_err(error)?;
    if database["return_code"].as_i64() != Some(0) || !database["games"].is_object() {
        return Err("The config database answered with an error.".into());
    }
    std::fs::create_dir_all(directory.join("GuiConfigs")).map_err(error)?;
    let partial = target.with_extension("partial");
    std::fs::write(&partial, &bytes).map_err(error)?;
    std::fs::rename(&partial, &target).map_err(error)
}

/// A text value of a PARAM.SFO, such as TITLE_ID or APP_VER.
fn sfo_string(sfo: &[u8], key: &str) -> Option<String> {
    let u16_at = |at: usize| sfo.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize);
    let u32_at = |at: usize| {
        sfo.get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    if sfo.get(..4)? != b"\0PSF" {
        return None;
    }
    let (keys, data, count) = (u32_at(8)?, u32_at(12)?, u32_at(16)?);
    for index in 0..count.min(256) {
        let entry = 20 + index * 16;
        let name = sfo.get(keys + u16_at(entry)?..)?.split(|b| *b == 0).next()?;
        if name == key.as_bytes() {
            let start = data + u32_at(entry + 12)?;
            let value = sfo.get(start..start + u32_at(entry + 4)?)?;
            return Some(String::from_utf8_lossy(value).trim_end_matches('\0').to_string());
        }
    }
    None
}

/// The game's serial, as in BLUS30464: from a disc image's header, or from
/// the PARAM.SFO of the disc folder whose PS3_GAME/USRDIR holds `game`.
pub fn serial(game: &Path) -> Option<String> {
    let raw = if game
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("iso"))
    {
        let mut header = [0u8; 0x81a];
        std::fs::File::open(game).ok()?.read_exact(&mut header).ok()?;
        String::from_utf8_lossy(&header[0x810..]).into_owned()
    } else {
        let sfo = std::fs::read(game.parent()?.parent()?.join("PARAM.SFO")).ok()?;
        sfo_string(&sfo, "TITLE_ID")?
    };
    let serial: String = raw.chars().filter(char::is_ascii_alphanumeric).collect();
    (serial.len() == 9).then_some(serial)
}

/// The version of the game RPCS3 has installed to its hard drive, if any.
fn installed_version(directory: &Path, serial: &str) -> Option<String> {
    let sfo = std::fs::read(directory.join("dev_hdd0/game").join(serial).join("PARAM.SFO")).ok()?;
    sfo_string(&sfo, "APP_VER")
}

#[derive(Debug, PartialEq)]
struct Package {
    version: String,
    sha1: String,
    url: String,
}

/// The packages of Sony's update list, oldest first.
fn update_packages(xml: &str) -> Vec<Package> {
    let mut reader = Reader::from_str(xml);
    let mut packages = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(tag) | Event::Empty(tag)) if tag.name().as_ref() == b"package" => {
                let attribute = |name: &[u8]| {
                    tag.attributes()
                        .flatten()
                        .find(|attribute| attribute.key.as_ref() == name)
                        .and_then(|attribute| attribute.unescape_value().ok())
                        .map(|value| value.into_owned())
                };
                if let (Some(version), Some(sha1), Some(url)) =
                    (attribute(b"version"), attribute(b"sha1sum"), attribute(b"url"))
                {
                    packages.push(Package { version, sha1, url });
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    packages.sort_by(|a, b| a.version.cmp(&b.version));
    packages
}

/// "01.05" as players read it: 1.05.
fn version_label(version: &str) -> &str {
    version.strip_prefix('0').unwrap_or(version)
}

/// Installs the game's official updates newer than the installed version,
/// checking Sony at most once a day per game.
pub fn install_updates(app: &tauri::AppHandle, game: &Path) -> Result<()> {
    let Some(serial) = serial(game) else {
        return Ok(());
    };
    let directory = directory(app)?;
    let checked = directory.join("openretro-updates").join(format!("{serial}.checked"));
    if recent(&checked, UPDATE_CHECK_AGE) {
        return Ok(());
    }
    report(app, "Preparando o PS3: procurando atualizações do jogo");
    let response = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(error)?
        .get(format!("{UPDATE_LIST}{serial}/{serial}-ver.xml"))
        .send()
        .map_err(error)?;
    // Games without updates are simply not on the list.
    let xml = match response.status() {
        reqwest::StatusCode::NOT_FOUND => String::new(),
        _ => response.error_for_status().and_then(|r| r.text()).map_err(error)?,
    };
    let installed = installed_version(&directory, &serial).unwrap_or_default();
    for package in update_packages(&xml)
        .into_iter()
        .filter(|package| package.version > installed)
    {
        if !package.url.starts_with(UPDATE_HOST) {
            return Err(format!("Unexpected update host: {}", package.url));
        }
        let version = version_label(&package.version);
        let file = directory.join("update.pkg");
        download(app, &package.url, &file, 16 << 30, &format!("a atualização {version} do jogo"))?;
        // Sony's digest covers all but the package's last 32 bytes, which
        // hold that same digest.
        let package_file = std::fs::File::open(&file).map_err(error)?;
        let length = package_file.metadata().map_err(error)?.len();
        let mut hasher = sha1::Sha1::new();
        std::io::copy(&mut package_file.take(length.saturating_sub(32)), &mut hasher)
            .map_err(error)?;
        if format!("{:x}", hasher.finalize()) != package.sha1.to_ascii_lowercase() {
            let _ = std::fs::remove_file(&file);
            return Err(format!("Update {version} of {serial} arrived damaged."));
        }
        report(app, &format!("Preparando o PS3: instalando a atualização {version} do jogo"));
        let status = Command::new(executable(&directory))
            .args(["--headless", "--installpkg"])
            .arg(&file)
            .current_dir(&directory)
            .status();
        let _ = std::fs::remove_file(&file);
        log::info!("PS3 update {version} of {serial} install finished: {status:?}");
        if installed_version(&directory, &serial).as_deref() != Some(package.version.as_str()) {
            return Err(format!("Update {version} of {serial} did not install."));
        }
    }
    std::fs::create_dir_all(checked.parent().ok_or("Invalid update folder.")?).map_err(error)?;
    std::fs::write(&checked, b"").map_err(error)
}

fn install_firmware(app: &tauri::AppHandle, directory: &Path) -> Result<()> {
    report(app, "Preparando o PS3: procurando o sistema do console");
    let list = client()?
        .get(FIRMWARE_LIST)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.text())
        .map_err(|_| "Não foi possível falar com o servidor da Sony. Confira sua conexão e tente de novo.".to_string())?;
    let url = list
        .split(';')
        .filter_map(|field| field.trim().strip_prefix("CDN="))
        .find(|url| url.starts_with(FIRMWARE_HOST) && url.ends_with("/PS3UPDAT.PUP"))
        .ok_or("A Sony não informou onde baixar o sistema do PS3. Tente mais tarde.")?;
    let package = directory.join("PS3UPDAT.PUP");
    download(app, url, &package, 400 << 20, "o sistema do console")?;
    let mut magic = [0u8; 5];
    let valid = std::fs::File::open(&package)
        .and_then(|mut file| file.read_exact(&mut magic))
        .is_ok()
        && &magic == b"SCEUF";
    if valid {
        report(app, "Preparando o PS3: instalando o sistema do console");
        // RPCS3 verifies the package itself. It can exit with an error while
        // tearing down after a successful install, so the files decide.
        let status = Command::new(executable(directory))
            .args(["--headless", "--installfw"])
            .arg(&package)
            .current_dir(directory)
            .status();
        log::info!("PS3 system software install finished: {status:?}");
    }
    let _ = std::fs::remove_file(&package);
    if !firmware_installed(directory) {
        return Err("Não foi possível instalar o sistema do PS3. Tente de novo.".into());
    }
    Ok(())
}

/// Where RPCS3 looks for disc keys: its data folder's `redump`.
fn keys_directory(directory: &Path) -> PathBuf {
    directory.join("data/redump")
}

/// Earlier versions kept the keys where RPCS3 never looked.
fn move_old_keys(directory: &Path) {
    let old = directory.join("redump");
    let keys = keys_directory(directory);
    if old.is_dir() && !keys.exists() {
        let moved = std::fs::create_dir_all(directory.join("data"))
            .and_then(|_| std::fs::rename(&old, &keys));
        if let Err(e) = moved {
            log::warn!("Could not move the PS3 disc keys: {e}");
        }
    }
}

fn has_disc_keys(directory: &Path) -> bool {
    std::fs::read_dir(keys_directory(directory)).is_ok_and(|mut entries| entries.next().is_some())
}

fn install_disc_keys(app: &tauri::AppHandle, directory: &Path) -> Result<()> {
    report(app, "Preparando o PS3: baixando as chaves dos discos");
    let bytes = client()?
        .get(DISC_KEYS)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.bytes())
        .map_err(error)?;
    if bytes.len() > 32 << 20 {
        return Err("The disc key pack is unexpectedly large.".into());
    }
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(error)?;
    let keys = keys_directory(directory);
    std::fs::create_dir_all(&keys).map_err(error)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error)?;
        let name = entry.name().to_string();
        // Flat names only: a key never lands outside the keys folder.
        if !name.ends_with(".dkey")
            || name.contains(['/', '\\', ':'])
            || name.starts_with('.')
            || entry.size() > 64
        {
            continue;
        }
        let mut key = Vec::new();
        entry.read_to_end(&mut key).map_err(error)?;
        std::fs::write(keys.join(name), key).map_err(error)?;
    }
    Ok(())
}

/// A disc image needs its key; a newer pack may have it when ours does not.
pub fn ensure_disc_key(app: &tauri::AppHandle, game: &Path) -> Result<()> {
    if !game
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("iso"))
    {
        return Ok(());
    }
    complete_iso(game)?;
    let directory = directory(app)?;
    let stem = game.file_stem().unwrap_or_default().to_string_lossy();
    let known = |directory: &Path| keys_directory(directory).join(format!("{stem}.dkey")).is_file();
    if game.with_extension("dkey").is_file() || known(&directory) || adopt_key(&directory, &stem) {
        return Ok(());
    }
    // A newer pack may have the key ours lacks.
    install_disc_keys(app, &directory)?;
    if known(&directory) || adopt_key(&directory, &stem) {
        return Ok(());
    }
    Err("A chave deste disco de PS3 não foi encontrada, então ele não pode ser aberto. \
         Tente outra versão do jogo."
        .into())
}

/// Title and the parenthesized groups of a Redump name, as in
/// "Skate 3 (USA) (En,Fr,Es)": ("skate 3", ["usa", "en,fr,es"]).
fn redump_name(name: &str) -> (String, Vec<String>) {
    let (title, rest) = name.split_once(" (").map_or((name, ""), |(title, rest)| (title, rest));
    let groups = rest
        .split('(')
        .map(|group| group.trim().trim_end_matches(')').trim().to_lowercase())
        .filter(|group| !group.is_empty())
        .collect();
    (title.trim().to_lowercase(), groups)
}

/// The key of the same release under another region name. Dumps are often
/// renamed to one region, as "Skate 3 (USA)" for Redump's
/// "Skate 3 (USA, Asia)", and RPCS3 matches a disc image's key by name only.
fn similar_key(keys: &[String], stem: &str) -> Option<String> {
    let (title, groups) = redump_name(stem);
    let (regions, details) = groups.split_first()?;
    let regions: Vec<&str> = regions.split(", ").collect();
    keys.iter()
        .filter_map(|key| {
            let (key_title, key_groups) = redump_name(key.strip_suffix(".dkey")?);
            let (key_regions, key_details) = key_groups.split_first()?;
            let key_regions: Vec<&str> = key_regions.split(", ").collect();
            let same_release = key_title == title
                && key_details == details
                && (regions.iter().all(|r| key_regions.contains(r))
                    || key_regions.iter().all(|r| regions.contains(r)));
            same_release.then(|| (key_regions.len().abs_diff(regions.len()), key))
        })
        .min()
        .map(|(_, key)| key.clone())
}

/// Copies the key of the same release under the image's own name.
fn adopt_key(directory: &Path, stem: &str) -> bool {
    let keys_folder = keys_directory(directory);
    let keys: Vec<String> = std::fs::read_dir(&keys_folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    let Some(key) = similar_key(&keys, stem) else {
        return false;
    };
    log::info!("Using the disc key {key} for {stem}");
    std::fs::copy(keys_folder.join(&key), keys_folder.join(format!("{stem}.dkey"))).is_ok()
}

/// Rejects an ISO shorter than its own volume size, such as one whose
/// extraction was cut short: RPCS3 would fail with an unexplained read error.
fn complete_iso(game: &Path) -> Result<()> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(game).map_err(error)?;
    let size = file.metadata().map_err(error)?.len();
    // ISO 9660 volume space size, in 2048-byte sectors, little-endian.
    let mut sectors = [0u8; 4];
    file.seek(SeekFrom::Start(0x8050)).map_err(error)?;
    file.read_exact(&mut sectors).map_err(error)?;
    let declared = u64::from(u32::from_le_bytes(sectors)) * 2048;
    if size < declared {
        return Err(format!(
            "O arquivo do jogo está incompleto ({:.1} de {:.1} GB). Remova o jogo e baixe de novo.",
            size as f64 / 1e9,
            declared as f64 / 1e9
        ));
    }
    Ok(())
}

/// RPCS3's own handler for each SDL controller type, as (handler, device prefix).
fn handler(kind: i32) -> Option<(&'static str, &'static str)> {
    match kind {
        1 | 2 => Some(("XInput", "XInput Pad #")),
        4 => Some(("DualShock 4", "DS4 Pad #")),
        7 => Some(("DualSense", "DualSense Pad #")),
        _ => None,
    }
}

/// One player per connected controller, the keyboard when there is none.
/// RPCS3 fills in each handler's default buttons.
pub fn input_config(controllers: &[(i32, String)]) -> String {
    let mut config = String::new();
    let mut counts = std::collections::HashMap::<&str, usize>::new();
    for (player, (kind, name)) in controllers.iter().take(4).enumerate() {
        let (handler, device) = match handler(*kind) {
            Some((handler, prefix)) => {
                let count = counts.entry(handler).or_default();
                *count += 1;
                (handler, format!("{prefix}{count}"))
            }
            None => {
                let count = counts.entry(name.as_str()).or_default();
                *count += 1;
                ("SDL", format!("{name} {count}"))
            }
        };
        config.push_str(&format!(
            "Player {} Input:\n  Handler: {handler}\n  Device: {}\n",
            player + 1,
            serde_json::to_string(&device).unwrap_or_default()
        ));
    }
    if config.is_empty() {
        config.push_str("Player 1 Input:\n  Handler: Keyboard\n  Device: Keyboard\n");
    }
    config
}

/// Sets `key` in `section` of a Qt settings file, keeping everything else.
fn set_ini(text: &str, section: &str, key: &str, value: &str) -> String {
    let header = format!("[{section}]");
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let Some(start) = lines.iter().position(|line| line.trim() == header) else {
        lines.extend([header, format!("{key}={value}")]);
        return lines.join("\n") + "\n";
    };
    let end = lines[start + 1..]
        .iter()
        .position(|line| line.starts_with('['))
        .map_or(lines.len(), |offset| start + 1 + offset);
    let prefix = format!("{key}=");
    match lines[start + 1..end].iter().position(|line| line.starts_with(&prefix)) {
        Some(offset) => lines[start + 1 + offset] = format!("{prefix}{value}"),
        None => lines.insert(end, format!("{prefix}{value}")),
    }
    lines.join("\n") + "\n"
}

/// Arguments that boot `game` with OpenRetro's controller setup and none of
/// RPCS3's own dialogs, which would open outside OpenRetro.
pub fn launch_args(
    directory: &Path,
    sdl_library: Option<&Path>,
    game: &Path,
) -> Result<Vec<String>> {
    let controllers = sdl_library
        .and_then(crate::in_game::sdl::Sdl::load)
        .map(|sdl| sdl.controller_types())
        .unwrap_or_default();
    let inputs = directory.join("config/input_configs/global");
    std::fs::create_dir_all(&inputs).map_err(error)?;
    std::fs::write(inputs.join(format!("{INPUT_CONFIG}.yml")), input_config(&controllers))
        .map_err(error)?;
    let settings = directory.join("GuiConfigs/CurrentSettings.ini");
    let mut text = std::fs::read_to_string(&settings).unwrap_or_default();
    for key in ["infoBoxEnabledWelcome", "confirmationBoxExitGame"] {
        text = set_ini(&text, "main_window", key, "false");
    }
    std::fs::create_dir_all(directory.join("GuiConfigs")).map_err(error)?;
    std::fs::write(&settings, text).map_err(error)?;
    Ok(vec![
        "--no-gui".into(),
        "--input-config".into(),
        INPUT_CONFIG.into(),
        game.to_string_lossy().into_owned(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sony_update_lists_oldest_first() {
        let xml = r#"<?xml version='1.0' encoding='UTF-8'?>
<titlepatch status="alive" titleid="BLUS30464"><tag name="T"><package version="01.05" size="3" sha1sum="AB" url="http://b0.ww.np.dl.playstation.net/tppkg/np/b.pkg" ps3_system_ver="03.0000"><paramsfo><TITLE>x</TITLE></paramsfo></package><package version="01.02" size="2" sha1sum="cd" url="http://b0.ww.np.dl.playstation.net/tppkg/np/a.pkg"/></tag></titlepatch>"#;
        let packages = update_packages(xml);
        assert_eq!(
            packages.iter().map(|p| p.version.as_str()).collect::<Vec<_>>(),
            ["01.02", "01.05"]
        );
        assert_eq!(packages[1].sha1, "AB");
        assert!(update_packages("").is_empty());
        assert_eq!(version_label("01.05"), "1.05");
    }

    #[test]
    fn reads_serials_and_versions_from_param_sfo() {
        // Two entries: TITLE_ID and APP_VER, laid out as Sony's tools do.
        let keys = b"APP_VER\0TITLE_ID\0";
        let (key_table, data_table) = (20 + 2 * 16, 20 + 2 * 16 + 20);
        let mut sfo = Vec::new();
        sfo.extend_from_slice(b"\0PSF\x01\x01\0\0");
        sfo.extend_from_slice(&(key_table as u32).to_le_bytes());
        sfo.extend_from_slice(&(data_table as u32).to_le_bytes());
        sfo.extend_from_slice(&2u32.to_le_bytes());
        for (key_offset, length, data_offset) in [(0u16, 6u32, 0u32), (8, 10, 8)] {
            sfo.extend_from_slice(&key_offset.to_le_bytes());
            sfo.extend_from_slice(&0x0204u16.to_le_bytes());
            sfo.extend_from_slice(&length.to_le_bytes());
            sfo.extend_from_slice(&length.to_le_bytes());
            sfo.extend_from_slice(&data_offset.to_le_bytes());
        }
        sfo.extend_from_slice(keys);
        sfo.resize(data_table, 0);
        sfo.extend_from_slice(b"01.05\0\0\0BLUS30464\0");
        assert_eq!(sfo_string(&sfo, "APP_VER").as_deref(), Some("01.05"));
        assert_eq!(sfo_string(&sfo, "TITLE_ID").as_deref(), Some("BLUS30464"));
        assert_eq!(sfo_string(&sfo, "CATEGORY"), None);

        let game = std::env::temp_dir().join(format!("openretro-ps3-{}", uuid::Uuid::new_v4()));
        let usrdir = game.join("PS3_GAME/USRDIR");
        std::fs::create_dir_all(&usrdir).unwrap();
        std::fs::write(game.join("PS3_GAME/PARAM.SFO"), &sfo).unwrap();
        assert_eq!(serial(&usrdir.join("EBOOT.BIN")).as_deref(), Some("BLUS30464"));
        let iso = game.join("game.iso");
        let mut image = vec![0u8; 0x900];
        image[0x800..0x80b].copy_from_slice(b"PlayStation");
        image[0x810..0x81a].copy_from_slice(b"BLUS-30464");
        std::fs::write(&iso, image).unwrap();
        assert_eq!(serial(&iso).as_deref(), Some("BLUS30464"));
        std::fs::remove_dir_all(game).unwrap();
    }

    #[test]
    fn finds_the_key_of_a_release_renamed_to_one_region() {
        let keys: Vec<String> = [
            "Skate 3 (Europe, Australia) (En,Fr,De,Es,It,Nl).dkey",
            "Skate 3 (Japan).dkey",
            "Skate 3 (USA, Asia) (En,Fr,Es).dkey",
            "Skate 2 (USA) (En,Fr).dkey",
        ]
        .map(String::from)
        .into();
        assert_eq!(
            similar_key(&keys, "Skate 3 (USA) (En,Fr,Es)").as_deref(),
            Some("Skate 3 (USA, Asia) (En,Fr,Es).dkey")
        );
        assert_eq!(
            similar_key(&keys, "Skate 3 (Europe) (En,Fr,De,Es,It,Nl)").as_deref(),
            Some("Skate 3 (Europe, Australia) (En,Fr,De,Es,It,Nl).dkey")
        );
        // Other languages or revisions are other discs, with other keys.
        assert_eq!(similar_key(&keys, "Skate 3 (USA) (En,Fr)"), None);
        assert_eq!(similar_key(&keys, "Skate 3 (USA, Asia) (En,Fr,Es) (Rev 1)"), None);
        assert_eq!(similar_key(&keys, "Skate 3"), None);
    }

    #[test]
    fn truncated_isos_are_refused() {
        let iso = std::env::temp_dir().join(format!("openretro-{}.iso", uuid::Uuid::new_v4()));
        let mut image = vec![0u8; 20 * 2048];
        image[0x8050..0x8054].copy_from_slice(&20u32.to_le_bytes());
        std::fs::write(&iso, &image).unwrap();
        assert!(complete_iso(&iso).is_ok());
        std::fs::write(&iso, &image[..19 * 2048]).unwrap();
        assert!(complete_iso(&iso).unwrap_err().contains("incompleto"));
        std::fs::remove_file(iso).unwrap();
    }

    #[test]
    fn dialogs_are_turned_off_without_touching_other_settings() {
        let text = "[main_window]\ninfoBoxEnabledWelcome=true\n\n[Meta]\nattachCommandLine=false\n";
        let text = set_ini(text, "main_window", "infoBoxEnabledWelcome", "false");
        let text = set_ini(&text, "main_window", "confirmationBoxExitGame", "false");
        assert_eq!(
            text,
            "[main_window]\ninfoBoxEnabledWelcome=false\n\nconfirmationBoxExitGame=false\n[Meta]\nattachCommandLine=false\n"
        );
        assert_eq!(
            set_ini("", "main_window", "infoBoxEnabledWelcome", "false"),
            "[main_window]\ninfoBoxEnabledWelcome=false\n"
        );
    }

    #[test]
    fn controllers_map_to_rpcs3_handlers() {
        let config = input_config(&[
            (4, "PS4 Controller".into()),
            (1, "Xbox 360 Controller".into()),
            (4, "PS4 Controller".into()),
            (5, "Nintendo Switch Pro Controller".into()),
        ]);
        assert_eq!(
            config,
            "Player 1 Input:\n  Handler: DualShock 4\n  Device: \"DS4 Pad #1\"\n\
             Player 2 Input:\n  Handler: XInput\n  Device: \"XInput Pad #1\"\n\
             Player 3 Input:\n  Handler: DualShock 4\n  Device: \"DS4 Pad #2\"\n\
             Player 4 Input:\n  Handler: SDL\n  Device: \"Nintendo Switch Pro Controller 1\"\n"
        );
        assert_eq!(
            input_config(&[]),
            "Player 1 Input:\n  Handler: Keyboard\n  Device: Keyboard\n"
        );
    }
}
