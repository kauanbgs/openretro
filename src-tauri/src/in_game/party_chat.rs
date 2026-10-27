//! The Party chat over a running game: a transparent window that shows new
//! lines without taking focus, and takes it while the host types (T).
use super::InGameService;
use crate::database::{error, Result};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

pub const LABEL: &str = "party-chat";
/// A Party room is open, so T opens the chat during a game.
static ACTIVE: AtomicBool = AtomicBool::new(false);
/// The host is typing: the window holds the keyboard.
static COMPOSING: AtomicBool = AtomicBool::new(false);

pub fn active() -> bool {
    ACTIVE.load(Ordering::Relaxed) && !COMPOSING.load(Ordering::Relaxed)
}

fn window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow> {
    app.get_webview_window(LABEL)
        .ok_or_else(|| "A janela do chat não está disponível.".into())
}
fn game_running(app: &tauri::AppHandle) -> bool {
    app.state::<InGameService>()
        .0
        .lock()
        .is_ok_and(|guard| guard.as_ref().is_some_and(|s| s.stdin.is_some()))
}

/// Shows or hides the window without activating it, so the game keeps the keyboard.
fn set_shown(window: &tauri::WebviewWindow, shown: bool) -> Result<()> {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn ShowWindow(window: *mut std::ffi::c_void, command: i32) -> i32;
        }
        let hwnd = window.hwnd().map_err(error)?;
        // SW_SHOWNOACTIVATE and SW_HIDE.
        unsafe { ShowWindow(hwnd.0 as _, if shown { 4 } else { 0 }) };
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if shown { window.show() } else { window.hide() }.map_err(error)
    }
}

/// Opens the chat box over the game for the host to type.
pub fn compose(app: &tauri::AppHandle) -> Result<()> {
    if !active() || !game_running(app) {
        return Ok(());
    }
    let window = window(app)?;
    COMPOSING.store(true, Ordering::Relaxed);
    window.set_ignore_cursor_events(false).map_err(error)?;
    window.set_focusable(true).map_err(error)?;
    set_shown(&window, true)?;
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn SetForegroundWindow(window: *mut std::ffi::c_void) -> i32;
        }
        let hwnd = window.hwnd().map_err(error)?;
        unsafe { SetForegroundWindow(hwnd.0 as _) };
    }
    window.set_focus().map_err(error)?;
    window.emit("party-chat-compose", ()).map_err(error)
}

/// The main window's Party: whether a room is open.
#[tauri::command]
pub fn party_chat_state(app: tauri::AppHandle, active: bool) -> Result<()> {
    ACTIVE.store(active, Ordering::Relaxed);
    if !active {
        party_chat_release(app.clone())?;
        set_shown(&window(&app)?, false)?;
    }
    Ok(())
}

/// A new line arrived: show it over the game, if one is running.
#[tauri::command]
pub fn party_chat_show(app: tauri::AppHandle) -> Result<()> {
    if ACTIVE.load(Ordering::Relaxed) && game_running(&app) {
        set_shown(&window(&app)?, true)?;
    }
    Ok(())
}

/// Nothing left to show over the game.
#[tauri::command]
pub fn party_chat_hide(app: tauri::AppHandle) -> Result<()> {
    if !COMPOSING.load(Ordering::Relaxed) {
        set_shown(&window(&app)?, false)?;
    }
    Ok(())
}

/// The host sent or dismissed a line: the game gets the keyboard back.
#[tauri::command]
pub fn party_chat_release(app: tauri::AppHandle) -> Result<()> {
    if !COMPOSING.swap(false, Ordering::Relaxed) {
        return Ok(());
    }
    let window = window(&app)?;
    window.set_focusable(false).map_err(error)?;
    window.set_ignore_cursor_events(true).map_err(error)?;
    #[cfg(windows)]
    if !super::embedded_window(&app).is_some_and(super::host::focus) {
        if let Some(pid) = super::runtime_pid(&app) {
            super::controller::focus_process(pid);
        }
    }
    Ok(())
}

pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = super::overlay_builder(
        app,
        LABEL,
        "OpenRetro · Chat da Party",
        "window.__OPENRETRO_PARTY_CHAT__ = true;",
    )
    .focusable(false)
    .build()?;
    window.set_ignore_cursor_events(true)?;
    window.on_window_event(|event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
    Ok(())
}
