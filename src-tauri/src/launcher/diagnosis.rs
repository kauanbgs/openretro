//! Why a runtime session failed, read from the runtime's own log and exit
//! code, in words a player can act on. Each session writes `logs/runtime.log`
//! in OpenRetro's data folder; the one before is kept as `runtime-previous.log`.
//!
//! OpenGL is the runtime's video driver. A PC whose graphics driver offers no
//! usable OpenGL, like Windows' basic display driver with its software
//! OpenGL 1.1 ("GDI Generic"), switches to Direct3D 11 for good, and the
//! interface launches the game again on its own.
use crate::database::{error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};

/// Starts an error the interface answers by launching the game again.
pub const VIDEO_FALLBACK: &str = "VIDEO_FALLBACK";
const DRIVER_KEY: &str = "runtime_video_driver";
pub const OPENGL: &str = "gl";
pub const DIRECT3D11: &str = "d3d11";

/// The video driver this PC uses for the runtime.
pub fn video_driver(conn: &Connection) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key=?1",
        [DRIVER_KEY],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
    .filter(|driver| driver == DIRECT3D11)
    .unwrap_or_else(|| OPENGL.into())
}

fn set_video_driver(conn: &Connection, driver: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![DRIVER_KEY, driver],
    )
    .map_err(error)?;
    Ok(())
}

/// The log file for a new session, keeping the previous session's beside it.
pub fn session_log(data: &Path) -> Result<PathBuf> {
    let directory = data.join("logs");
    std::fs::create_dir_all(&directory).map_err(error)?;
    let log = directory.join("runtime.log");
    if log.exists() {
        let _ = std::fs::rename(&log, directory.join("runtime-previous.log"));
    }
    Ok(log)
}

#[derive(Debug, PartialEq)]
pub enum Failure {
    /// The video driver could not start or crashed while starting.
    Video,
    Core,
    Content,
    /// Windows could not find a file the runtime or its core needs.
    MissingFile,
    Crash,
    Unknown,
}

/// Windows reports a crash as an NTSTATUS error code, 0xC0000000 and above.
fn crashed(code: Option<i32>) -> bool {
    code.is_some_and(|code| (code as u32) >= 0xC000_0000)
}

const STATUS_DLL_NOT_FOUND: u32 = 0xC000_0135;

pub fn classify(log: &str, code: Option<i32>) -> Failure {
    if log.contains("Cannot open video driver")
        || log.contains("Cannot open threaded video driver")
        || log.contains("Renderer: GDI Generic")
        || log.contains("win32_set_video_mode failed")
    {
        return Failure::Video;
    }
    if log.contains("Failed to open libretro core") {
        return Failure::Core;
    }
    if log.contains("Failed to load content") || log.contains("Could not read content file") {
        return Failure::Content;
    }
    if code.is_some_and(|code| code as u32 == STATUS_DLL_NOT_FOUND) {
        return Failure::MissingFile;
    }
    // A crash right after the video driver's last words happened while it started.
    let last = log
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default();
    if crashed(code)
        && ["[GL]", "[WGL]", "[Video]", "[D3D11]", "[DXGI]"]
            .iter()
            .any(|tag| last.contains(tag))
    {
        return Failure::Video;
    }
    if crashed(code) {
        return Failure::Crash;
    }
    Failure::Unknown
}

fn read_log(log: &Path) -> String {
    std::fs::read(log)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default()
}

/// The message for a failed session. `fallback` is the plain message used
/// when the log shows nothing specific. A video failure on OpenGL switches
/// this PC to Direct3D 11 and asks the interface to try again.
pub fn explain(conn: &Connection, log: &Path, code: Option<i32>, fallback: String) -> String {
    let driver = video_driver(conn);
    let details = log.display();
    match classify(&read_log(log), code) {
        Failure::Video if driver == OPENGL => match set_video_driver(conn, DIRECT3D11) {
            Ok(()) => {
                log::warn!("OpenGL failed in the runtime; switching to Direct3D 11");
                format!("{VIDEO_FALLBACK}: O vídeo deste PC não funcionou com OpenGL. O OpenRetro vai usar Direct3D 11 a partir de agora.")
            }
            Err(_) => fallback,
        },
        Failure::Video => format!(
            "O driver de vídeo deste PC não conseguiu abrir o jogo, nem com OpenGL nem com Direct3D 11. Instale o driver mais recente da sua placa de vídeo pelo site da NVIDIA, AMD ou Intel. Detalhes em {details}"
        ),
        Failure::Core => format!(
            "O núcleo do emulador para este console não pôde ser carregado. Reinstale o emulador em Emuladores. Detalhes em {details}"
        ),
        Failure::Content => format!(
            "O emulador não conseguiu ler este jogo. O arquivo pode estar corrompido ou em um formato não suportado. Detalhes em {details}"
        ),
        Failure::MissingFile => format!(
            "Falta um arquivo do Windows de que o emulador precisa. Atualize o Windows e tente de novo. Detalhes em {details}"
        ),
        Failure::Crash => format!(
            "O emulador travou durante o jogo. Sua sessão foi salva. Detalhes em {details}"
        ),
        Failure::Unknown => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCESS_VIOLATION: i32 = 0xC000_0005u32 as i32;

    #[test]
    fn video_failures_are_recognized() {
        assert_eq!(
            classify("[Video] Cannot open video driver. Exiting...\n", Some(1)),
            Failure::Video
        );
        assert_eq!(
            classify(
                "[GL] Vendor: Microsoft Corporation, Renderer: GDI Generic.\n",
                Some(1)
            ),
            Failure::Video
        );
        // A crash while the driver was still starting.
        assert_eq!(
            classify(
                "[Core] Loading...\n[GL] Version: 1.1.0.\n",
                Some(ACCESS_VIOLATION)
            ),
            Failure::Video
        );
    }

    #[test]
    fn other_failures_keep_their_cause() {
        assert_eq!(
            classify("[Core] Failed to open libretro core\n", Some(1)),
            Failure::Core
        );
        assert_eq!(
            classify("Failed to load content.\n", Some(1)),
            Failure::Content
        );
        assert_eq!(
            classify("", Some(0xC000_0135u32 as i32)),
            Failure::MissingFile
        );
        // A crash long after the video started is the core's, not the driver's.
        assert_eq!(
            classify(
                "[GL] Version: 4.6.\n[Audio] Started.\n",
                Some(ACCESS_VIOLATION)
            ),
            Failure::Crash
        );
        assert_eq!(classify("[GL] Version: 4.6.\n", Some(1)), Failure::Unknown);
    }

    #[test]
    fn opengl_failure_switches_to_direct3d_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .unwrap();
        let dir =
            std::env::temp_dir().join(format!("openretro-diagnosis-{}", uuid::Uuid::new_v4()));
        let log = session_log(&dir).unwrap();
        std::fs::write(&log, "[Video] Cannot open video driver. Exiting...\n").unwrap();
        assert_eq!(video_driver(&conn), OPENGL);
        let first = explain(&conn, &log, Some(1), "falhou".into());
        assert!(first.starts_with(VIDEO_FALLBACK), "{first}");
        assert_eq!(video_driver(&conn), DIRECT3D11);
        // Direct3D 11 failing too ends with advice, not another retry.
        let second = explain(&conn, &log, Some(1), "falhou".into());
        assert!(
            !second.starts_with(VIDEO_FALLBACK) && second.contains("driver"),
            "{second}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
