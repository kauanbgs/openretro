//! Discord Rich Presence, for players who turn it on in Settings: their
//! friends see the game being played, its console and cover. OpenRetro talks
//! to the Discord app on this PC through its local pipe; nothing goes through
//! a server, and without Discord running nothing happens.
//!
//! Discord shows its application's name ("OpenRetro") as the activity name.
//! `status_display_type` makes the short status read "Playing <game>" instead.
use crate::database::{error, Database, Result};
use serde_json::{json, Value};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::Manager;

/// The "OpenRetro" application in Discord's developer portal. Not a secret.
const CLIENT_ID: &str = "1563323471554023494";

/// The activity of the running game, sent while the setting is on.
#[derive(Default)]
pub struct Presence(Mutex<State>);

#[derive(Default)]
struct State {
    current: Option<Value>,
    worker: Option<mpsc::Sender<Option<Value>>>,
}

fn console(platform: &str) -> &str {
    match platform {
        "nes" => "Nintendo Entertainment System",
        "snes" => "Super Nintendo",
        "n64" => "Nintendo 64",
        "gb" => "Game Boy",
        "gbc" => "Game Boy Color",
        "gba" => "Game Boy Advance",
        "nds" => "Nintendo DS",
        "sms" => "Master System",
        "genesis" => "Mega Drive / Genesis",
        "gg" => "Game Gear",
        "psx" => "PlayStation",
        "psp" => "PlayStation Portable",
        "ps2" => "PlayStation 2",
        "ps3" => "PlayStation 3",
        "arcade" => "Arcade",
        "dos" => "DOS",
        other => other,
    }
}

/// Discord takes 2 to 128 characters per line; a one-letter title is padded.
fn line(text: &str) -> String {
    let text: String = text.trim().chars().take(128).collect();
    if text.chars().count() < 2 {
        format!("{text:<2}")
    } else {
        text
    }
}

pub fn activity(title: &str, platform: &str, cover: Option<&str>, started: i64) -> Value {
    let mut assets = json!({ "large_text": line(title) });
    // Discord fetches only public https images; local thumbnails are skipped.
    if let Some(cover) = cover.filter(|url| url.starts_with("https://")) {
        assets["large_image"] = json!(cover);
    }
    json!({
        "type": 0,
        // 2: the short status shows `details`, the game, not "OpenRetro".
        "status_display_type": 2,
        "details": line(title),
        "state": line(console(platform)),
        "timestamps": { "start": started },
        "assets": assets,
    })
}

fn enabled(app: &tauri::AppHandle) -> bool {
    crate::commands::get_settings(app.state::<Database>())
        .is_ok_and(|settings| settings["discordPresence"].as_bool() == Some(true))
}

/// Sends the current activity, or clears it, by the setting.
fn apply(app: &tauri::AppHandle, state: &mut State) {
    let wanted = state.current.clone().filter(|_| enabled(app));
    if wanted.is_none() && state.worker.is_none() {
        return;
    }
    let worker = state.worker.get_or_insert_with(|| {
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || run(receive));
        send
    });
    let _ = worker.send(wanted);
}

pub fn game_started(app: &tauri::AppHandle, activity: Value) {
    crate::account::social::game(app, Some(&activity));
    if let Ok(mut state) = app.state::<Presence>().0.lock() {
        state.current = Some(activity);
        apply(app, &mut state);
    }
}

pub fn game_finished(app: &tauri::AppHandle) {
    crate::account::social::game(app, None);
    if let Ok(mut state) = app.state::<Presence>().0.lock() {
        state.current = None;
        apply(app, &mut state);
    }
}

/// Applies the setting at once, during a game too.
#[tauri::command]
pub fn discord_presence_sync(app: tauri::AppHandle) -> Result<()> {
    let presence = app.state::<Presence>();
    let mut state = presence.0.lock().map_err(error)?;
    apply(&app, &mut state);
    Ok(())
}

/// Keeps one connection while there is something to show. Closing it clears
/// the activity, and a restarted Discord is reconnected within 15 seconds.
fn run(receive: mpsc::Receiver<Option<Value>>) {
    let mut wanted: Option<Value> = None;
    let mut pipe = None;
    loop {
        match receive.recv_timeout(Duration::from_secs(15)) {
            Ok(next) => wanted = next,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        let Some(activity) = wanted.as_ref() else {
            pipe = None;
            continue;
        };
        if pipe.is_none() {
            pipe = ipc::connect(CLIENT_ID).ok();
        }
        if let Some(connection) = pipe.as_mut() {
            match ipc::set_activity(connection, activity) {
                Ok(Some(problem)) => log::warn!("Discord refused the activity: {problem}"),
                Ok(None) => {}
                Err(_) => pipe = None,
            }
        }
    }
}

mod ipc {
    //! Discord's local RPC: frames of a little-endian opcode and length, then
    //! JSON. Each command gets exactly one reply, read before the next
    //! write, so one synchronous pipe handle never reads and writes at once.
    use serde_json::{json, Value};
    use std::io::{Read, Write};

    const HANDSHAKE: u32 = 0;
    const FRAME: u32 = 1;

    pub struct Connection(Box<dyn ReadWrite>);
    pub(super) trait ReadWrite: Read + Write + Send {}
    impl<T: Read + Write + Send> ReadWrite for T {}

    fn write(stream: &mut dyn ReadWrite, op: u32, body: &Value) -> std::io::Result<()> {
        let body = body.to_string();
        let mut frame = Vec::with_capacity(8 + body.len());
        frame.extend_from_slice(&op.to_le_bytes());
        frame.extend_from_slice(&(body.len() as u32).to_le_bytes());
        frame.extend_from_slice(body.as_bytes());
        stream.write_all(&frame)?;
        stream.flush()
    }

    fn read(stream: &mut dyn ReadWrite) -> std::io::Result<(u32, Value)> {
        let mut header = [0u8; 8];
        stream.read_exact(&mut header)?;
        let op = u32::from_le_bytes(header[..4].try_into().unwrap());
        let length = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
        if length > 64 * 1024 {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        let mut body = vec![0u8; length];
        stream.read_exact(&mut body)?;
        let value = serde_json::from_slice(&body).map_err(|_| std::io::ErrorKind::InvalidData)?;
        Ok((op, value))
    }

    fn handshake(mut stream: Box<dyn ReadWrite>, client: &str) -> std::io::Result<Connection> {
        write(
            stream.as_mut(),
            HANDSHAKE,
            &json!({ "v": 1, "client_id": client }),
        )?;
        match read(stream.as_mut())? {
            (FRAME, ready) if ready["evt"] == "READY" => Ok(Connection(stream)),
            _ => Err(std::io::ErrorKind::ConnectionRefused.into()),
        }
    }

    #[cfg(windows)]
    pub fn connect(client: &str) -> std::io::Result<Connection> {
        // Discord listens on the first free pipe of ten.
        for index in 0..10 {
            let path = format!(r"\\.\pipe\discord-ipc-{index}");
            if let Ok(pipe) = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
            {
                if let Ok(connection) = handshake(Box::new(pipe), client) {
                    return Ok(connection);
                }
            }
        }
        Err(std::io::ErrorKind::NotFound.into())
    }

    #[cfg(not(windows))]
    pub fn connect(_client: &str) -> std::io::Result<Connection> {
        Err(std::io::ErrorKind::Unsupported.into())
    }

    /// Discord's error message when it refuses the activity.
    pub fn set_activity(
        connection: &mut Connection,
        activity: &Value,
    ) -> std::io::Result<Option<String>> {
        let command = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": uuid::Uuid::new_v4().to_string(),
        });
        write(connection.0.as_mut(), FRAME, &command)?;
        let (_, reply) = read(connection.0.as_mut())?;
        Ok((reply["evt"] == "ERROR").then(|| reply["data"]["message"].to_string()))
    }

    #[cfg(test)]
    pub fn over(stream: Box<dyn ReadWrite>, client: &str) -> std::io::Result<Connection> {
        handshake(stream, client)
    }

    #[cfg(test)]
    pub(super) fn frame(op: u32, body: &Value) -> Vec<u8> {
        let mut buffer = std::io::Cursor::new(Vec::new());
        write(&mut buffer, op, body).unwrap();
        buffer.into_inner()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Write};
    use std::sync::{Arc, Mutex};

    #[test]
    fn shows_the_game_its_console_and_a_public_cover() {
        let value = activity(
            "Super Mario World",
            "snes",
            Some("https://images.igdb.com/igdb/image/upload/t_cover_big/co8lo8.jpg"),
            1_700_000_000,
        );
        assert_eq!(value["details"], "Super Mario World");
        assert_eq!(value["state"], "Super Nintendo");
        assert_eq!(value["status_display_type"], 2);
        assert_eq!(value["timestamps"]["start"], 1_700_000_000);
        assert!(value["assets"]["large_image"]
            .as_str()
            .unwrap()
            .starts_with("https://"));
        let local = activity("Q", "custom", Some("C:\\covers\\q.png"), 0);
        assert!(local["assets"].get("large_image").is_none());
        assert_eq!(local["details"].as_str().unwrap().chars().count(), 2);
        assert_eq!(local["state"], "custom");
        let long = activity(&"x".repeat(300), "nes", None, 0);
        assert_eq!(long["details"].as_str().unwrap().len(), 128);
    }

    /// Replies queued in advance; everything written is kept.
    struct Fake {
        replies: Cursor<Vec<u8>>,
        written: Arc<Mutex<Vec<u8>>>,
    }
    impl Read for Fake {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.replies.read(buffer)
        }
    }
    impl Write for Fake {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.written.lock().unwrap().extend_from_slice(buffer);
            Ok(buffer.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn speaks_discords_frames_and_reports_refusals() {
        let mut replies = ipc::frame(1, &json!({ "evt": "READY", "cmd": "DISPATCH" }));
        replies.extend(ipc::frame(
            1,
            &json!({ "evt": null, "cmd": "SET_ACTIVITY" }),
        ));
        replies.extend(ipc::frame(
            1,
            &json!({ "evt": "ERROR", "data": { "message": "child \"activity\" fails" } }),
        ));
        let written = Arc::new(Mutex::new(Vec::new()));
        let fake = Fake {
            replies: Cursor::new(replies),
            written: written.clone(),
        };
        let mut connection = ipc::over(Box::new(fake), CLIENT_ID).unwrap();
        let game = activity("Super Metroid", "snes", None, 1);
        assert_eq!(ipc::set_activity(&mut connection, &game).unwrap(), None);
        assert!(ipc::set_activity(&mut connection, &game)
            .unwrap()
            .unwrap()
            .contains("activity"));
        let written = written.lock().unwrap();
        assert_eq!(u32::from_le_bytes(written[..4].try_into().unwrap()), 0);
        let length = u32::from_le_bytes(written[4..8].try_into().unwrap()) as usize;
        let hello: Value = serde_json::from_slice(&written[8..8 + length]).unwrap();
        assert_eq!(hello, json!({ "v": 1, "client_id": CLIENT_ID }));
        let first_length =
            u32::from_le_bytes(written[8 + length + 4..8 + length + 8].try_into().unwrap())
                as usize;
        let first: Value =
            serde_json::from_slice(&written[8 + length + 8..8 + length + 8 + first_length])
                .unwrap();
        assert_eq!(first["cmd"], "SET_ACTIVITY");
        assert_eq!(first["args"]["activity"]["details"], "Super Metroid");
    }

    #[test]
    #[ignore = "shows an activity on this PC's Discord for 30 seconds"]
    fn shows_on_this_pcs_discord() {
        let mut connection = ipc::connect(CLIENT_ID).expect("Discord is not running");
        let game = activity(
            "Super Mario World",
            "snes",
            Some("https://images.igdb.com/igdb/image/upload/t_cover_big/co8lo8.jpg"),
            chrono::Utc::now().timestamp(),
        );
        println!("Discord: {:?}", ipc::set_activity(&mut connection, &game));
        std::thread::sleep(Duration::from_secs(30));
        // Closing the connection clears the activity.
    }

    #[test]
    fn a_handshake_without_ready_is_refused() {
        let fake = Fake {
            replies: Cursor::new(ipc::frame(2, &json!({ "code": 4000 }))),
            written: Arc::default(),
        };
        assert!(ipc::over(Box::new(fake), CLIENT_ID).is_err());
    }
}
