//! OpenRetro's installer: a small window that downloads the signed Windows
//! setup the app's own updater uses, checks its signature, and runs it silently.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

const MANIFEST_URL: &str =
    "https://github.com/kauanbgs/openretro/releases/latest/download/latest.json";
/// Must match `plugins.updater.pubkey` in src-tauri/tauri.conf.json (tested below).
const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDgzQjQ2NThEODIxOTJERUIKUldUckxSbUNqV1cwZy9YWEIyQjFFY2R1dGVSZGVLYXVxYzdBZDdoVS9ZYmZkUmEvNGhoN0ZOTk8K";

#[derive(Deserialize)]
struct Manifest {
    version: String,
    platforms: HashMap<String, Platform>,
}

#[derive(Deserialize)]
struct Platform {
    url: String,
    signature: String,
}

#[derive(Serialize, Clone)]
struct Progress {
    stage: &'static str,
    version: String,
    done: u64,
    total: u64,
}

fn emit(app: &AppHandle, stage: &'static str, version: &str, done: u64, total: u64) {
    let _ = app.emit(
        "progress",
        Progress {
            stage,
            version: version.to_owned(),
            done,
            total,
        },
    );
}

/// Checks the downloaded setup against the key the app's updater trusts.
fn verify(bytes: &[u8], signature_b64: &str) -> Result<(), &'static str> {
    let decode = |text: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(text.trim())
            .ok()
            .and_then(|raw| String::from_utf8(raw).ok())
    };
    let key = decode(UPDATER_PUBKEY).ok_or("signature")?;
    let sig = decode(signature_b64).ok_or("signature")?;
    let key = minisign_verify::PublicKey::decode(&key).map_err(|_| "signature")?;
    let sig = minisign_verify::Signature::decode(&sig).map_err(|_| "signature")?;
    key.verify(bytes, &sig, false).map_err(|_| "signature")
}

async fn run(app: &AppHandle) -> Result<(), &'static str> {
    emit(app, "prepare", "", 0, 0);
    let client = reqwest::Client::builder()
        .user_agent("OpenRetro-Installer")
        .timeout(Duration::from_secs(60 * 30))
        .build()
        .map_err(|_| "network")?;
    let manifest: Manifest = client
        .get(MANIFEST_URL)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "network")?
        .json()
        .await
        .map_err(|_| "network")?;
    let platform = manifest
        .platforms
        .get("windows-x86_64-nsis")
        .or_else(|| manifest.platforms.get("windows-x86_64"))
        .ok_or("unsupported")?;
    if !platform.url.starts_with("https://") {
        return Err("network");
    }
    let version = manifest.version.trim_start_matches('v').to_owned();

    let response = client
        .get(&platform.url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "network")?;
    let total = response.content_length().unwrap_or(0);
    let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);
    let mut stream = response.bytes_stream();
    let mut last = Instant::now() - Duration::from_secs(1);
    while let Some(chunk) = stream.next().await {
        bytes.extend_from_slice(&chunk.map_err(|_| "network")?);
        if last.elapsed() >= Duration::from_millis(80) {
            last = Instant::now();
            emit(app, "download", &version, bytes.len() as u64, total);
        }
    }
    emit(app, "download", &version, bytes.len() as u64, total);

    emit(app, "verify", &version, 0, 0);
    verify(&bytes, &platform.signature)?;

    let setup = std::env::temp_dir().join(format!("OpenRetro-Setup-{version}.exe"));
    std::fs::write(&setup, &bytes).map_err(|_| "setup_failed")?;
    drop(bytes);

    emit(app, "install", &version, 0, 0);
    let status = tauri::async_runtime::spawn_blocking({
        let setup = setup.clone();
        move || std::process::Command::new(&setup).arg("/S").status()
    })
    .await;
    let _ = std::fs::remove_file(&setup);
    match status {
        Ok(Ok(status)) if status.success() => {}
        _ => return Err("setup_failed"),
    }
    if installed_exe().is_none() {
        return Err("setup_failed");
    }
    emit(app, "done", &version, 0, 0);
    Ok(())
}

/// The per-user install folder the app's setup uses.
fn installed_exe() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("OpenRetro");
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("openretro.exe"))
        })
}

#[tauri::command]
async fn install(app: AppHandle) -> Result<(), String> {
    run(&app).await.map_err(str::to_owned)
}

#[tauri::command]
fn launch(app: AppHandle) -> Result<(), String> {
    let exe = installed_exe().ok_or("setup_failed")?;
    let mut command = std::process::Command::new(&exe);
    if let Some(dir) = exe.parent() {
        command.current_dir(dir);
    }
    command.spawn().map_err(|_| "setup_failed".to_owned())?;
    app.exit(0);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![install, launch])
        .run(tauri::generate_context!())
        .expect("the installer could not start");
}

#[cfg(test)]
mod tests {
    #[test]
    fn trusts_the_same_key_as_the_app_updater() {
        let conf = include_str!("../../src-tauri/tauri.conf.json");
        assert!(conf.contains(super::UPDATER_PUBKEY));
    }

    #[test]
    fn rejects_a_setup_that_was_not_signed_with_that_key() {
        assert!(super::verify(b"not the real setup", "bm90IGEgc2lnbmF0dXJl").is_err());
    }
}
