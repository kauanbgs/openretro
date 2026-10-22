//! PlayStation 3 games run on RPCS3. Nobody installs it by hand: the first PS3
//! game downloads a tested build into OpenRetro's data folder, along with
//! Sony's system software and Redump's disc keys, and every game then starts
//! it from the command line without its own interface, its game window shown
//! inside OpenRetro's like the runtime's.
use crate::database::{error, Result};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
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
    if !has_disc_keys(&directory) {
        // Disc folders play without keys; only disc images need them.
        if let Err(message) = install_disc_keys(app, &directory) {
            log::warn!("PS3 disc keys unavailable: {message}");
        }
    }
    Ok(executable(&directory))
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

fn keys_directory(directory: &Path) -> PathBuf {
    directory.join("redump")
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
    if game.with_extension("dkey").is_file() || known(&directory) {
        return Ok(());
    }
    install_disc_keys(app, &directory)?;
    if !known(&directory) {
        log::warn!("No Redump disc key is named after {stem}; RPCS3 will try every key");
    }
    Ok(())
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
