//! Phone play: a phone on the same network opens a page served by OpenRetro,
//! watches the game, hears it and plays it. The page reaches the server only
//! with the pairing token from the QR code. Video is H.264 over WebRTC, encoded
//! by the PC's webview, or JPEG frames where WebRTC cannot connect; audio is
//! the game runtime output as PCM (RPCS3's own process audio for PS3), and
//! each phone's buttons go to the runtime's loopback remote gamepad for the
//! player it picked, or to RPCS3's Party pads (`xinput`).
use crate::database::{error, Result};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod frames;
#[cfg(windows)]
mod process_audio;
#[cfg(windows)]
pub mod xinput;
mod api;
mod input;
mod network;
mod server;
mod video;

/// The runtime listens for player N on this port + N - 1, on loopback only.
pub const REMOTE_PAD_BASE_PORT: u16 = 55400;
pub const SERVER_PORT: u16 = 47820;

/// Deployment configuration belongs to the app, never to the Party screen.
#[tauri::command]
pub fn party_configuration() -> serde_json::Value {
    let url = std::env::var("OPENRETRO_PARTY_URL")
        .unwrap_or_else(|_| option_env!("OPENRETRO_PARTY_URL")
            .unwrap_or(include_str!("party-url.txt").trim()).to_string());
    serde_json::json!({ "url": url })
}

#[derive(Default)]
pub struct RemotePlay(Mutex<Option<server::Running>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePlayStatus {
    running: bool,
    url: Option<String>,
    /// The URL as an SVG QR code.
    qr: Option<String>,
    devices: usize,
    /// The player each connected phone chose, one entry per phone.
    players: Vec<u8>,
    /// The network phones connect on, once checked; Windows blocks a public one.
    network: Option<network::NetworkProfile>,
}

fn qr_svg(text: &str) -> Option<String> {
    qrcode::QrCode::new(text.as_bytes()).ok().map(|code| {
        code.render::<qrcode::render::svg::Color>()
            .min_dimensions(220, 220)
            .quiet_zone(true)
            .build()
    })
}

/// A QR code for a Party invite, so a friend in the room scans it instead of
/// typing the link. Only web links are encoded.
#[tauri::command]
pub fn invite_qr(url: String) -> Result<String> {
    if !url.starts_with("https://") || url.len() > 512 {
        return Err("Invalid invite link.".into());
    }
    qr_svg(&url).ok_or_else(|| "Could not draw the QR code.".into())
}

fn status_of(running: Option<&server::Running>) -> RemotePlayStatus {
    let Some(running) = running else {
        return RemotePlayStatus { running: false, url: None, qr: None, devices: 0, players: vec![], network: None };
    };
    let qr = qr_svg(&running.url);
    RemotePlayStatus {
        running: true,
        url: Some(running.url.clone()),
        qr,
        devices: running.devices(),
        players: running.players(),
        network: running.network.current(),
    }
}

/// Opens the Windows page where the phone play network's profile is chosen.
#[tauri::command]
pub fn remote_play_network_settings(app: tauri::AppHandle) -> Result<()> {
    let page = app
        .state::<RemotePlay>()
        .0
        .lock()
        .map_err(error)?
        .as_ref()
        .and_then(|running| running.network.current())
        .map_or("ms-settings:network-status", |network| network.settings);
    #[cfg(windows)]
    std::process::Command::new("explorer.exe")
        .arg(page)
        .spawn()
        .map_err(error)?;
    #[cfg(not(windows))]
    let _ = page;
    Ok(())
}

/// Whether phone play is serving, so a PS3 game seats phones at launch.
pub fn running(app: &tauri::AppHandle) -> bool {
    app.state::<RemotePlay>()
        .0
        .lock()
        .is_ok_and(|running| running.is_some())
}

#[tauri::command]
pub fn remote_play_status(app: tauri::AppHandle) -> Result<RemotePlayStatus> {
    let state = app.state::<RemotePlay>();
    let guard = state.0.lock().map_err(error)?;
    Ok(status_of(guard.as_ref()))
}

#[tauri::command]
pub async fn remote_play_start(app: tauri::AppHandle) -> Result<RemotePlayStatus> {
    if app.state::<RemotePlay>().0.lock().map_err(error)?.is_none() {
        let address = crate::launcher::netplay::netplay_local_address()
            .ok_or("Conecte o computador a uma rede para jogar no celular.")?;
        let running = server::start(app.clone(), &address).await?;
        *app.state::<RemotePlay>().0.lock().map_err(error)? = Some(running);
        // The webview's phone video encoder connects while phone play runs.
        let _ = app.emit("remote-play-changed", true);
    }
    remote_play_status(app)
}

#[tauri::command]
pub fn remote_play_stop(app: tauri::AppHandle) -> Result<()> {
    let running = app.state::<RemotePlay>().0.lock().map_err(error)?.take();
    if let Some(running) = running {
        running.stop();
        let _ = app.emit("remote-play-changed", false);
    }
    Ok(())
}

/// A pairing token: 128 random bits, hex encoded.
fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Constant-time comparison, so response timing reveals nothing about the token.
fn token_matches(expected: &str, given: &str) -> bool {
    expected.len() == given.len()
        && expected
            .bytes()
            .zip(given.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_random_and_compared_exactly() {
        let token = new_token();
        assert_eq!(token.len(), 32);
        assert_ne!(token, new_token());
        assert!(token_matches(&token, &token.clone()));
        assert!(!token_matches(&token, &token[..31]));
        assert!(!token_matches(&token, &"0".repeat(32)));
    }
}
