//! Phone play: a phone on the same network opens a page served by OpenRetro,
//! watches the game, hears it and plays it. The page reaches the server only
//! with the pairing token from the QR code. Video is the main window as JPEG
//! frames, audio is the PC's output as PCM, and each phone's buttons go to
//! the runtime's loopback remote gamepad for the player it picked.
use crate::database::{error, Result};
use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod frames;
mod api;
mod input;
mod server;
mod video;

/// The runtime listens for player N on this port + N - 1, on loopback only.
pub const REMOTE_PAD_BASE_PORT: u16 = 55400;
pub const SERVER_PORT: u16 = 47820;

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
}

fn status_of(running: Option<&server::Running>) -> RemotePlayStatus {
    let Some(running) = running else {
        return RemotePlayStatus { running: false, url: None, qr: None, devices: 0, players: vec![] };
    };
    let qr = qrcode::QrCode::new(running.url.as_bytes()).ok().map(|code| {
        code.render::<qrcode::render::svg::Color>()
            .min_dimensions(220, 220)
            .quiet_zone(true)
            .build()
    });
    RemotePlayStatus {
        running: true,
        url: Some(running.url.clone()),
        qr,
        devices: running.devices(),
        players: running.players(),
    }
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
    }
    remote_play_status(app)
}

#[tauri::command]
pub fn remote_play_stop(app: tauri::AppHandle) -> Result<()> {
    let running = app.state::<RemotePlay>().0.lock().map_err(error)?.take();
    if let Some(running) = running {
        running.stop();
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
