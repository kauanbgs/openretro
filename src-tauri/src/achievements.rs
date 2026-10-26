//! RetroAchievements: signing in, the achievement list on the game page, and
//! the settings the runtime needs to award achievements while a game runs.
//! Only the account token is kept, in the Windows credential vault; the
//! password is sent once to sign in and never stored.
use crate::database::{error, Database, Result};
use md5::{Digest, Md5};
use serde::Serialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{Emitter, Manager};

const SERVER: &str = "https://retroachievements.org/dorequest.php";
const MEDIA: &str = "https://media.retroachievements.org";
/// rcheevos hashes at most this much of a file; larger files are truncated.
const MAX_HASHED: u64 = 64 * 1024 * 1024;
/// RetroAchievements' "core" set; 5 marks unofficial achievements.
const CORE_SET: u64 = 3;
const SIGNED_OUT: &str = "Sua sessão do RetroAchievements expirou. Entre de novo em Configurações.";

#[derive(serde::Deserialize, Serialize)]
struct Credentials {
    username: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    username: String,
    avatar_url: String,
    score: u64,
    softcore_score: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum GameAchievements {
    SignedOut,
    /// The game runs outside OpenRetro's runtime (PS3), which has no achievements.
    Unsupported,
    /// Not identified yet: the runtime names the set the first time it plays.
    Unknown,
    NoSet,
    Ready(AchievementSet),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementSet {
    game_id: u64,
    title: String,
    icon_url: String,
    hardcore: bool,
    achievements: Vec<Achievement>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    id: u64,
    title: String,
    description: String,
    points: u64,
    badge_url: String,
    locked_badge_url: String,
    /// Percent of players who unlocked it.
    rarity: f64,
    rarity_hardcore: f64,
    /// "progression", "win_condition", "missable" or empty.
    kind: String,
    unlocked: bool,
    unlocked_hardcore: bool,
}

#[derive(Debug, PartialEq)]
enum Failure {
    /// The token expired or the password changed.
    SignedOut,
    Message(String),
}
impl From<Failure> for String {
    fn from(failure: Failure) -> Self {
        match failure {
            Failure::SignedOut => SIGNED_OUT.into(),
            Failure::Message(message) => message,
        }
    }
}

fn request(params: &[(&str, &str)]) -> std::result::Result<serde_json::Value, Failure> {
    let unreachable = || {
        Failure::Message(
            "Não foi possível falar com o RetroAchievements. Confira sua conexão.".into(),
        )
    };
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("OpenRetro/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| unreachable())?
        .post(SERVER)
        .form(params)
        .send()
        .map_err(|_| unreachable())?;
    let body: serde_json::Value = response.json().map_err(|_| unreachable())?;
    if body["Success"].as_bool() == Some(true) {
        return Ok(body);
    }
    if matches!(
        body["Code"].as_str(),
        Some("invalid_credentials" | "expired_token")
    ) {
        return Err(Failure::SignedOut);
    }
    Err(Failure::Message(
        body["Error"]
            .as_str()
            .filter(|message| !message.is_empty())
            .unwrap_or("O RetroAchievements recusou o pedido. Tente de novo mais tarde.")
            .into(),
    ))
}

/// Usernames and tokens are letters and digits; anything else never reaches
/// the runtime's config file, where a quote could add settings of its own.
fn plain(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn credentials() -> Option<Credentials> {
    let saved: Credentials = serde_json::from_str(&vault::read()?).ok()?;
    (plain(&saved.username) && plain(&saved.token)).then_some(saved)
}

fn account(body: &serde_json::Value) -> Account {
    let username = body["User"].as_str().unwrap_or_default().to_string();
    Account {
        avatar_url: body["AvatarUrl"]
            .as_str()
            .map(String::from)
            .unwrap_or_else(|| format!("{MEDIA}/UserPic/{username}.png")),
        score: body["Score"].as_u64().unwrap_or(0),
        softcore_score: body["SoftcoreScore"].as_u64().unwrap_or(0),
        username,
    }
}

fn sign_in(params: &[(&str, &str)]) -> std::result::Result<Account, Failure> {
    let body = request(params)?;
    let token = body["Token"].as_str().unwrap_or_default();
    let account = account(&body);
    if !plain(&account.username) || !plain(token) {
        return Err(Failure::Message(
            "O RetroAchievements respondeu sem uma sessão válida.".into(),
        ));
    }
    let saved = serde_json::to_string(&Credentials {
        username: account.username.clone(),
        token: token.into(),
    })
    .map_err(|e| Failure::Message(error(e)))?;
    vault::write(&saved).map_err(Failure::Message)?;
    Ok(account)
}

/// The signed-in account with its current points, or None while signed out.
#[tauri::command]
pub async fn achievements_account() -> Result<Option<Account>> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(saved) = credentials() else {
            return Ok(None);
        };
        match sign_in(&[("r", "login2"), ("u", &saved.username), ("t", &saved.token)]) {
            Ok(account) => Ok(Some(account)),
            Err(Failure::SignedOut) => {
                vault::clear();
                Ok(None)
            }
            Err(failure) => Err(failure.into()),
        }
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub async fn achievements_sign_in(username: String, password: String) -> Result<Account> {
    let username = username.trim().to_string();
    if !plain(&username) || password.is_empty() {
        return Err("Digite seu usuário e sua senha do RetroAchievements.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        sign_in(&[("r", "login2"), ("u", &username), ("p", &password)]).map_err(|failure| {
            match failure {
                Failure::SignedOut => "Usuário ou senha incorretos.".to_string(),
                Failure::Message(message) => message,
            }
        })
    })
    .await
    .map_err(error)?
}

#[tauri::command]
pub fn achievements_sign_out() {
    vault::clear();
}

/// Hardcore is the player's choice in Settings; it is off until turned on.
pub fn hardcore_enabled(conn: &rusqlite::Connection) -> bool {
    conn.query_row("SELECT value FROM settings WHERE key='app'", [], |r| {
        r.get::<_, String>(0)
    })
    .ok()
    .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
    .is_some_and(|settings| settings["achievementsHardcore"] == true)
}

#[tauri::command]
pub async fn game_achievements(app: tauri::AppHandle, id: String) -> Result<GameAchievements> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(saved) = credentials() else {
            return Ok(GameAchievements::SignedOut);
        };
        let db = app.state::<Database>();
        let (platform, path, known, hardcore) = {
            let conn = db.read()?;
            let (platform, path): (String, String) = conn
                .query_row(
                    "SELECT platform_id,source_path FROM library_items WHERE id=?1",
                    [&id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|_| "Este jogo não está mais na sua biblioteca.".to_string())?;
            let known: Option<u64> = conn
                .query_row(
                    "SELECT game_id FROM achievement_games WHERE library_item_id=?1",
                    [&id],
                    |r| r.get(0),
                )
                .ok();
            (platform, path, known, hardcore_enabled(&conn))
        };
        if crate::launcher::core_name(&platform).is_none() {
            return Ok(GameAchievements::Unsupported);
        }
        let game = match known {
            Some(game) => game,
            None => {
                let Some(hash) = hash(&platform, Path::new(&path)) else {
                    return Ok(GameAchievements::Unknown);
                };
                let game = request(&[("r", "gameid"), ("m", &hash)]).map_err(String::from)?
                    ["GameID"]
                    .as_u64()
                    .unwrap_or(0);
                remember(&db, &id, game)?;
                game
            }
        };
        if game == 0 {
            return Ok(GameAchievements::NoSet);
        }
        let result = (|| {
            let game_id = game.to_string();
            let signed = |api: &'static str, extra: Option<(&'static str, &'static str)>| {
                let mut params = vec![
                    ("r", api),
                    ("u", saved.username.as_str()),
                    ("t", saved.token.as_str()),
                    ("g", game_id.as_str()),
                ];
                params.extend(extra);
                request(&params)
            };
            let patch = signed("patch", None)?;
            let softcore = signed("unlocks", Some(("h", "0")))?;
            let unlocked_hardcore = signed("unlocks", Some(("h", "1")))?;
            Ok(set(game, hardcore, &patch, &softcore, &unlocked_hardcore))
        })();
        match result {
            Ok(set) if set.achievements.is_empty() => Ok(GameAchievements::NoSet),
            Ok(set) => Ok(GameAchievements::Ready(set)),
            Err(Failure::SignedOut) => {
                vault::clear();
                Ok(GameAchievements::SignedOut)
            }
            Err(failure) => Err(failure.into()),
        }
    })
    .await
    .map_err(error)?
}

fn ids(body: &serde_json::Value) -> std::collections::HashSet<u64> {
    body["UserUnlocks"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|id| id.as_u64())
        .collect()
}

fn set(
    game_id: u64,
    hardcore: bool,
    patch: &serde_json::Value,
    softcore: &serde_json::Value,
    unlocked_hardcore: &serde_json::Value,
) -> AchievementSet {
    let data = &patch["PatchData"];
    let unlocked_hardcore = ids(unlocked_hardcore);
    // A hardcore unlock counts in softcore too.
    let unlocked: std::collections::HashSet<u64> =
        ids(softcore).union(&unlocked_hardcore).copied().collect();
    let text = |value: &serde_json::Value| value.as_str().unwrap_or_default().to_string();
    let achievements = data["Achievements"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["Flags"].as_u64() == Some(CORE_SET))
        .filter_map(|a| {
            let id = a["ID"].as_u64()?;
            let badge = text(&a["BadgeName"]);
            let url = |field: &str, suffix: &str| {
                a[field]
                    .as_str()
                    .filter(|url| url.starts_with("https://"))
                    .map(String::from)
                    .unwrap_or_else(|| format!("{MEDIA}/Badge/{badge}{suffix}.png"))
            };
            Some(Achievement {
                id,
                title: text(&a["Title"]),
                description: text(&a["Description"]),
                points: a["Points"].as_u64().unwrap_or(0),
                badge_url: url("BadgeURL", ""),
                locked_badge_url: url("BadgeLockedURL", "_lock"),
                rarity: a["Rarity"].as_f64().unwrap_or(100.0),
                rarity_hardcore: a["RarityHardcore"].as_f64().unwrap_or(100.0),
                kind: text(&a["Type"]),
                unlocked: unlocked.contains(&id),
                unlocked_hardcore: unlocked_hardcore.contains(&id),
            })
        })
        .collect();
    AchievementSet {
        game_id,
        title: text(&data["Title"]),
        icon_url: data["ImageIconURL"]
            .as_str()
            .filter(|url| url.starts_with("https://"))
            .map(String::from)
            .unwrap_or_else(|| format!("{MEDIA}{}", text(&data["ImageIcon"]))),
        hardcore,
        achievements,
    }
}

fn remember(db: &Database, id: &str, game: u64) -> Result<()> {
    db.0.lock()
        .map_err(error)?
        .execute(
            "INSERT INTO achievement_games(library_item_id,game_id,checked_at) VALUES(?1,?2,?3) ON CONFLICT(library_item_id) DO UPDATE SET game_id=excluded.game_id,checked_at=excluded.checked_at",
            rusqlite::params![id, game, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(error)?;
    Ok(())
}

/// RetroAchievements' hash for consoles whose files hash directly, so the
/// game page lists achievements before the first session. Disc-based
/// consoles and the DS are identified by the runtime when they first play.
fn hash(platform: &str, path: &Path) -> Option<String> {
    if platform == "arcade" {
        // Arcade sets are identified by their file name, not their contents.
        let name = path.file_stem()?.to_str()?;
        return Some(format!("{:x}", Md5::digest(name.as_bytes())));
    }
    if !matches!(
        platform,
        "nes" | "snes" | "n64" | "gb" | "gbc" | "gba" | "sms" | "gg" | "genesis"
    ) {
        return None;
    }
    let mut data = contents(path)?;
    match platform {
        "nes" if data.starts_with(b"NES\x1a") || data.starts_with(b"FDS\x1a") => {
            data.drain(..16);
        }
        "snes" if data.len() % 0x2000 == 512 => {
            data.drain(..512);
        }
        "n64" => match data.first()? {
            0x80 | 0xE8 | 0x22 => {}
            // v64: every pair of bytes swapped.
            0x37 => data.chunks_exact_mut(2).for_each(|pair| pair.swap(0, 1)),
            // n64: every 4 bytes reversed.
            0x40 => data.chunks_exact_mut(4).for_each(|word| word.reverse()),
            _ => return None,
        },
        _ => {}
    }
    Some(format!("{:x}", Md5::digest(&data)))
}

/// The file's bytes, or the first file inside a ZIP, as the runtime loads it.
fn contents(path: &Path) -> Option<Vec<u8>> {
    let mut data = Vec::new();
    let is_zip = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"));
    if is_zip {
        let mut archive = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
        let index = (0..archive.len()).find(|&i| archive.by_index(i).is_ok_and(|f| f.is_file()))?;
        archive
            .by_index(index)
            .ok()?
            .take(MAX_HASHED)
            .read_to_end(&mut data)
            .ok()?;
    } else {
        std::fs::File::open(path)
            .ok()?
            .take(MAX_HASHED)
            .read_to_end(&mut data)
            .ok()?;
    }
    Some(data)
}

/// The runtime's settings for one session, in a file of their own so the
/// token is deleted as soon as the runtime has read it.
pub struct RuntimeConfig(PathBuf);
impl RuntimeConfig {
    pub fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for RuntimeConfig {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// None while signed out: the runtime then runs without achievements.
pub fn runtime_config(data: &Path, hardcore: bool) -> Result<Option<RuntimeConfig>> {
    let Some(saved) = credentials() else {
        return Ok(None);
    };
    let directory = data.join("runtime-config");
    std::fs::create_dir_all(&directory).map_err(error)?;
    let path = directory.join(format!("achievements-{}.cfg", uuid::Uuid::new_v4()));
    std::fs::write(&path, settings(&saved, hardcore)).map_err(error)?;
    Ok(Some(RuntimeConfig(path)))
}

fn settings(saved: &Credentials, hardcore: bool) -> String {
    format!(
        "cheevos_enable = \"true\"\n\
         cheevos_username = \"{}\"\n\
         cheevos_token = \"{}\"\n\
         cheevos_password = \"\"\n\
         cheevos_hardcore_mode_enable = \"{hardcore}\"\n\
         cheevos_test_unofficial = \"false\"\n\
         cheevos_richpresence_enable = \"true\"\n\
         cheevos_badges_enable = \"false\"\n\
         cheevos_auto_screenshot = \"false\"\n\
         cheevos_visibility_account = \"false\"\n\
         cheevos_visibility_unlock = \"true\"\n",
        saved.username, saved.token
    )
}

#[derive(Debug, Default, PartialEq)]
struct Report {
    /// Some(0) when the runtime found no set for the file.
    game: Option<u64>,
    unlocked: usize,
    points: u64,
    signed_out: bool,
}

/// What the runtime wrote about achievements during a session.
fn report(log: &str) -> Report {
    let mut report = Report::default();
    for line in log.lines() {
        if let Some(rest) = line.split("[OpenRetro] Achievements game: ").nth(1) {
            report.game = rest
                .split_whitespace()
                .next()
                .and_then(|id| id.parse().ok());
        } else if let Some(rest) = line.split("[OpenRetro] Achievement unlocked: ").nth(1) {
            report.unlocked += 1;
            report.points += rest
                .split_whitespace()
                .nth(1)
                .and_then(|points| points.parse::<u64>().ok())
                .unwrap_or(0);
        } else if let Some(rest) = line.split("[OpenRetro] Achievements login failed: ").nth(1) {
            // rcheevos: RC_INVALID_CREDENTIALS and RC_EXPIRED_TOKEN.
            report.signed_out |= matches!(rest.trim(), "-34" | "-35");
        }
    }
    report
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Unlocked {
    library_item_id: String,
    title: String,
    count: usize,
    points: u64,
}

/// After a session: remembers which set the game loaded and tells the
/// interface what was unlocked. A modified version can match another set,
/// so only the original file updates the library entry.
pub fn finish_session(app: &tauri::AppHandle, id: &str, title: &str, original: bool, log: &Path) {
    let Ok(log) = std::fs::read(log) else { return };
    let report = report(&String::from_utf8_lossy(&log));
    if report.signed_out {
        vault::clear();
        let _ = app.emit("achievements-signed-out", ());
    }
    if let (Some(game), true) = (report.game, original) {
        if let Err(message) = remember(&app.state::<Database>(), id, game) {
            log::warn!("Could not remember the achievement set: {message}");
        }
    }
    if report.unlocked > 0 {
        let _ = app.emit(
            "achievements-unlocked",
            Unlocked {
                library_item_id: id.into(),
                title: title.into(),
                count: report.unlocked,
                points: report.points,
            },
        );
    }
}

#[cfg(windows)]
mod vault {
    use crate::database::Result;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::{
            CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
            CRED_TYPE_GENERIC,
        },
    };
    const TARGET: &str = "OpenRetro/RetroAchievements/v1";
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    pub fn read() -> Option<String> {
        let target = wide(TARGET);
        let mut credential = std::ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            return None;
        }
        let value = unsafe { &*credential };
        let saved = (!value.CredentialBlob.is_null()).then(|| {
            let bytes = unsafe {
                std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize)
            };
            String::from_utf8(bytes.to_vec()).ok()
        });
        unsafe { CredFree(credential.cast()) };
        saved.flatten()
    }
    pub fn write(value: &str) -> Result<()> {
        let mut target = wide(TARGET);
        let mut username = wide("OpenRetro");
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: value.len() as u32,
            CredentialBlob: value.as_ptr() as *mut u8,
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: username.as_mut_ptr(),
            ..Default::default()
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err(
                "Não foi possível guardar a sessão do RetroAchievements no Windows.".into(),
            );
        }
        Ok(())
    }
    pub fn clear() {
        let target = wide(TARGET);
        if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            log::warn!("Could not remove the RetroAchievements session from the vault");
        }
    }
}
#[cfg(not(windows))]
mod vault {
    pub fn read() -> Option<String> {
        None
    }
    pub fn write(_: &str) -> crate::database::Result<()> {
        Err("O RetroAchievements só funciona no Windows por enquanto.".into())
    }
    pub fn clear() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openretro-ra-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }
    fn md5(bytes: &[u8]) -> String {
        format!("{:x}", Md5::digest(bytes))
    }

    #[test]
    fn hashes_skip_copier_headers_like_rcheevos() {
        let rom: Vec<u8> = (0..0x4000u32).map(|i| i as u8).collect();
        let mut nes = b"NES\x1a".to_vec();
        nes.extend([0; 12]);
        nes.extend(&rom);
        assert_eq!(hash("nes", &file("game.nes", &nes)), Some(md5(&rom)));
        let mut snes = vec![0; 512];
        snes.extend(&rom);
        assert_eq!(hash("snes", &file("game.sfc", &snes)), Some(md5(&rom)));
        assert_eq!(hash("snes", &file("game.sfc", &rom)), Some(md5(&rom)));
        assert_eq!(hash("gba", &file("game.gba", &rom)), Some(md5(&rom)));
    }

    #[test]
    fn n64_hashes_in_big_endian_order() {
        let z64 = [0x80, 0x37, 0x12, 0x40, 1, 2, 3, 4];
        let v64 = [0x37, 0x80, 0x40, 0x12, 2, 1, 4, 3];
        let n64 = [0x40, 0x12, 0x37, 0x80, 4, 3, 2, 1];
        let expected = Some(md5(&z64));
        assert_eq!(hash("n64", &file("a.z64", &z64)), expected);
        assert_eq!(hash("n64", &file("a.v64", &v64)), expected);
        assert_eq!(hash("n64", &file("a.n64", &n64)), expected);
        assert_eq!(hash("n64", &file("a.n64", &[1, 2, 3, 4])), None);
    }

    #[test]
    fn arcade_hashes_the_set_name_and_zips_hash_their_rom() {
        assert_eq!(
            hash("arcade", Path::new("C:/games/sf2.zip")),
            Some(md5(b"sf2"))
        );
        let path = file("game.zip", b"");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        zip.start_file::<_, ()>("Game.gb", Default::default())
            .unwrap();
        std::io::Write::write_all(&mut zip, b"cartridge").unwrap();
        zip.finish().unwrap();
        assert_eq!(hash("gb", &path), Some(md5(b"cartridge")));
        assert_eq!(hash("psx", &path), None);
    }

    #[test]
    fn session_log_reports_the_set_unlocks_and_expired_sign_in() {
        let log = "[INFO] [OpenRetro] Achievements game: 1446 0\n\
                   [INFO] [OpenRetro] Achievement unlocked: 9 10 0\n\
                   [INFO] noise\n\
                   [INFO] [OpenRetro] Achievement unlocked: 12 25 0\n";
        assert_eq!(
            report(log),
            Report {
                game: Some(1446),
                unlocked: 2,
                points: 35,
                signed_out: false
            }
        );
        let log = "[INFO] [OpenRetro] Achievements login failed: -35\n";
        assert!(report(log).signed_out);
        let log = "[INFO] [OpenRetro] Achievements login failed: -1\n\
                   [INFO] [OpenRetro] Achievements game: 0\n";
        assert_eq!(
            report(log),
            Report {
                game: Some(0),
                ..Default::default()
            }
        );
    }

    #[test]
    fn only_plain_names_reach_the_runtime_config() {
        assert!(plain("Kauan_13"));
        assert!(!plain("a\"\ncheevos_enable"));
        assert!(!plain(""));
        let config = settings(
            &Credentials {
                username: "player".into(),
                token: "abc123".into(),
            },
            true,
        );
        assert!(config.contains("cheevos_token = \"abc123\""));
        assert!(config.contains("cheevos_hardcore_mode_enable = \"true\""));
    }

    #[test]
    fn set_keeps_core_achievements_and_merges_unlocks() {
        let patch = serde_json::json!({"PatchData": {"Title": "Game", "ImageIcon": "/Images/1.png",
        "Achievements": [
            {"ID": 1, "Title": "A", "Flags": 3, "Points": 5, "BadgeName": "100"},
            {"ID": 2, "Title": "B", "Flags": 3, "Points": 10, "BadgeName": "200"},
            {"ID": 3, "Title": "Unofficial", "Flags": 5}
        ]}});
        let set = set(
            7,
            false,
            &patch,
            &serde_json::json!({"UserUnlocks": [1]}),
            &serde_json::json!({"UserUnlocks": [2]}),
        );
        assert_eq!(set.achievements.len(), 2);
        assert!(set.achievements[0].unlocked && !set.achievements[0].unlocked_hardcore);
        assert!(set.achievements[1].unlocked && set.achievements[1].unlocked_hardcore);
        assert_eq!(
            set.achievements[0].locked_badge_url,
            format!("{MEDIA}/Badge/100_lock.png")
        );
        assert_eq!(set.icon_url, format!("{MEDIA}/Images/1.png"));
    }
}
