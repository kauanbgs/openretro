//! Opening OpenRetro when the player signs in to Windows. It is a value in the
//! per-user Run key, so it needs no administrator rights and the player (or
//! Windows' own Startup apps page) can remove it at any time. Off until chosen.
#[cfg(windows)]
use crate::database::error;
use crate::database::Result;

#[cfg(windows)]
const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const NAME: &str = "OpenRetro";

#[cfg(windows)]
fn reg(args: &[&str]) -> std::io::Result<std::process::Output> {
    use std::os::windows::process::CommandExt;
    std::process::Command::new("reg.exe")
        .args(args)
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
}

#[tauri::command]
pub fn autostart_enabled() -> bool {
    #[cfg(windows)]
    {
        reg(&["query", KEY, "/v", NAME])
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    false
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<()> {
    #[cfg(windows)]
    {
        let output = if enabled {
            let exe = std::env::current_exe().map_err(error)?;
            let command = format!("\"{}\"", exe.display());
            reg(&["add", KEY, "/v", NAME, "/t", "REG_SZ", "/d", &command, "/f"])
        } else if autostart_enabled() {
            reg(&["delete", KEY, "/v", NAME, "/f"])
        } else {
            return Ok(());
        }
        .map_err(error)?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("Iniciar com o sistema só está disponível no Windows.".into())
    }
}
