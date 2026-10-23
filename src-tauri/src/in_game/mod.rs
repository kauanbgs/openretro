use crate::database::{error, Result};
use serde::Serialize;
use std::{io::Write, process::ChildStdin, sync::Mutex};
use tauri::{Emitter, Manager};
#[cfg(target_os = "windows")]
mod controller;
#[cfg(target_os = "windows")]
mod host;
mod screen_view;
#[cfg(target_os = "windows")]
pub(crate) mod sdl;
use screen_view::ScreenView;

#[derive(Default)]
pub struct InGameService(Mutex<Option<Session>>, std::sync::atomic::AtomicBool);
struct Session {
    info: SessionInfo,
    stdin: Option<ChildStdin>,
    pid: u32,
    sdl_library: Option<std::path::PathBuf>,
    embedded_window: Option<isize>,
    /// Launcher views hidden so they cannot paint over the embedded game.
    covered_views: Vec<isize>,
    main_was_fullscreen: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    id: String,
    title: String,
    open: bool,
    slot: i32,
    screen_view: ScreenView,
    view_available: bool,
}
impl SessionInfo {
    pub fn remote_available(&self) -> bool {
        self.view_available
    }
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn title(&self) -> &str {
        &self.title
    }
}

pub struct SessionGuard {
    app: tauri::AppHandle,
    id: String,
}
impl SessionGuard {
    pub fn window_closed(&self) -> bool {
        #[cfg(windows)]
        {
            let service = self.app.state::<InGameService>();
            return service
                .0
                .lock()
                .ok()
                .and_then(|guard| {
                    guard
                        .as_ref()
                        .filter(|session| session.info.id == self.id)
                        .and_then(|session| session.embedded_window)
                })
                .is_some_and(|window| !host::is_open(window));
        }
        #[cfg(not(windows))]
        false
    }
    pub fn attach(&self, stdin: ChildStdin, pid: u32, executable: &std::path::Path) -> Result<()> {
        let service = self.app.state::<InGameService>();
        let mut guard = service.0.lock().map_err(error)?;
        let session = guard
            .as_mut()
            .filter(|session| session.info.id == self.id)
            .ok_or("A sessão do jogo foi encerrada.")?;
        session.stdin = Some(stdin);
        session.pid = pid;
        session.sdl_library = executable.parent().map(|path| path.join("SDL2.dll"));
        if service.1.load(std::sync::atomic::Ordering::Acquire) {
            write_command(session, "OPENRETRO_PARTY 1")?;
        }
        drop(guard);
        self.host(pid)
    }
    /// Shows the process's game window inside OpenRetro's main window. RPCS3
    /// takes no commands, so its session only gets this: no command channel
    /// and no OpenRetro menu; its own PS button menu exits the game.
    #[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
    pub fn host(&self, pid: u32) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            let service = self.app.state::<InGameService>();
            let embedded = host::embed(&self.app, pid)?;
            let mut guard = service.0.lock().map_err(error)?;
            let Some(session) = guard.as_mut().filter(|session| session.info.id == self.id) else {
                host::reveal(&embedded.covered);
                return Err("A sessão do jogo foi encerrada.".into());
            };
            session.embedded_window = Some(embedded.window);
            session.covered_views = embedded.covered;
            session.info.view_available = session.stdin.is_some();
        }
        Ok(())
    }
}
impl Drop for SessionGuard {
    fn drop(&mut self) {
        let service = self.app.state::<InGameService>();
        let mut was_fullscreen = None;
        if let Ok(mut guard) = service.0.lock() {
            if guard
                .as_ref()
                .is_some_and(|session| session.info.id == self.id)
            {
                if let Some(session) = guard.take() {
                    was_fullscreen = Some(session.main_was_fullscreen);
                    #[cfg(target_os = "windows")]
                    host::reveal(&session.covered_views);
                }
            }
        }
        if let Some(window) = self.app.get_webview_window("game-menu") {
            let _ = window.hide();
        }
        if let (Some(fullscreen), Some(window)) =
            (was_fullscreen, self.app.get_webview_window("main"))
        {
            let _ = window.set_fullscreen(fullscreen);
            let _ = window.set_focus();
        }
        let _ = self.app.emit("in-game-state", Option::<SessionInfo>::None);
    }
}
pub fn reserve(app: &tauri::AppHandle, id: &str, title: &str, slot: i32) -> Result<SessionGuard> {
    let service = app.state::<InGameService>();
    let mut guard = service.0.lock().map_err(error)?;
    if guard.is_some() {
        return Err("Um jogo já está em execução. Encerre-o antes de iniciar outro.".into());
    }
    let main_was_fullscreen = app
        .get_webview_window("main")
        .and_then(|window| window.is_fullscreen().ok())
        .unwrap_or(false);
    *guard = Some(Session {
        info: SessionInfo {
            id: id.into(),
            title: title.into(),
            open: false,
            slot,
            screen_view: ScreenView::default(),
            view_available: false,
        },
        stdin: None,
        pid: 0,
        sdl_library: None,
        embedded_window: None,
        covered_views: Vec::new(),
        main_was_fullscreen,
    });
    Ok(SessionGuard {
        app: app.clone(),
        id: id.into(),
    })
}

pub(crate) fn set_party_input(app: &tauri::AppHandle, enabled: bool) -> Result<()> {
    let service = app.state::<InGameService>();
    let mut guard = service.0.lock().map_err(error)?;
    service
        .1
        .store(enabled, std::sync::atomic::Ordering::Release);
    if let Some(session) = guard.as_mut().filter(|session| session.stdin.is_some()) {
        write_command(
            session,
            if enabled {
                "OPENRETRO_PARTY 1"
            } else {
                "OPENRETRO_PARTY 0"
            },
        )?;
    }
    Ok(())
}

fn write_command(session: &mut Session, command: &str) -> Result<()> {
    let stdin = session
        .stdin
        .as_mut()
        .ok_or("O emulador ainda está sendo iniciado.")?;
    writeln!(stdin, "{command}")
        .map_err(|_| "O emulador não está mais conectado ao OpenRetro.".to_string())?;
    stdin.flush().map_err(error)
}
fn command_for(action: &str, slot: i32) -> Result<&'static str> {
    match action {
        "save" => Ok("SAVE_STATE"),
        "load" => Ok("LOAD_STATE"),
        "screenshot" => Ok("SCREENSHOT"),
        "reset" => Ok("RESET"),
        "quit" => Ok("QUIT"),
        "undo_load" => Ok("UNDO_LOAD_STATE"),
        "slot_next" if slot < 99 => Ok("STATE_SLOT_PLUS"),
        "slot_previous" if slot > 0 => Ok("STATE_SLOT_MINUS"),
        _ => Err("Ação de jogo inválida.".into()),
    }
}
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
pub fn toggle(app: &tauri::AppHandle) -> Result<()> {
    let service = app.state::<InGameService>();
    let (info, pid, embedded_window) = {
        let mut guard = service.0.lock().map_err(error)?;
        let session = guard.as_mut().ok_or("Nenhum jogo em execução.")?;
        write_command(session, "PAUSE_TOGGLE")?;
        session.info.open = !session.info.open;
        (session.info.clone(), session.pid, session.embedded_window)
    };
    let window = app
        .get_webview_window("game-menu")
        .ok_or("A janela do menu não está disponível.")?;
    if info.open {
        window.set_always_on_top(true).map_err(error)?;
        window.show().map_err(error)?;
        window.set_focus().map_err(error)?;
    } else {
        window.hide().map_err(error)?;
        #[cfg(target_os = "windows")]
        if !embedded_window.is_some_and(host::focus) {
            controller::focus_process(pid);
        }
    }
    app.emit("in-game-state", Some(info)).map_err(error)
}

#[tauri::command]
pub fn in_game_status(app: tauri::AppHandle) -> Result<Option<SessionInfo>> {
    current_session(&app)
}

pub(crate) fn current_session(app: &tauri::AppHandle) -> Result<Option<SessionInfo>> {
    Ok(app
        .state::<InGameService>()
        .0
        .lock()
        .map_err(error)?
        .as_ref()
        .map(|session| session.info.clone()))
}
#[tauri::command]
pub fn in_game_action(app: tauri::AppHandle, action: String) -> Result<SessionInfo> {
    if action == "resume" {
        let open = in_game_status(app.clone())?.is_some_and(|session| session.open);
        if open {
            toggle(&app)?;
        }
        return in_game_status(app)?.ok_or("O jogo já foi encerrado.".into());
    }
    let service = app.state::<InGameService>();
    let info = {
        let mut guard = service.0.lock().map_err(error)?;
        let session = guard.as_mut().ok_or("Nenhum jogo em execução.")?;
        if !session.info.open {
            return Err("Abra o menu do jogo antes de usar esta ação.".into());
        }
        if action.starts_with("view_") {
            let mut view = session.info.screen_view;
            if !view.change(&action) {
                return Err("Ação de tela inválida.".into());
            }
            if !session.info.view_available {
                return Err("O recorte está disponível no runtime integrado do Windows.".into());
            }
            #[cfg(windows)]
            host::apply_view(
                session
                    .embedded_window
                    .ok_or("A janela do jogo não está disponível.")?,
                view,
            )?;
            session.info.screen_view = view;
        } else {
            let command = command_for(&action, session.info.slot)?;
            write_command(session, command)?;
            if action == "slot_next" {
                session.info.slot += 1;
            }
            if action == "slot_previous" {
                session.info.slot -= 1;
            }
        }
        session.info.clone()
    };
    app.emit("in-game-state", Some(info.clone()))
        .map_err(error)?;
    Ok(info)
}

/// Keep the local crop aligned after a resolution or window-size change.
pub fn resize_view(app: &tauri::AppHandle) {
    #[cfg(windows)]
    if let Ok(guard) = app.state::<InGameService>().0.lock() {
        if let Some(session) = guard.as_ref() {
            if let Some(window) = session.embedded_window {
                if let Err(message) = host::apply_view(window, session.info.screen_view) {
                    log::warn!("Could not resize the game view: {message}");
                }
            }
        }
    }
    #[cfg(not(windows))]
    let _ = app;
}

/// The running runtime's process id, once it has started.
pub fn runtime_pid(app: &tauri::AppHandle) -> Option<u32> {
    let pid = app.state::<InGameService>().0.lock().ok()?.as_ref()?.pid;
    (pid != 0).then_some(pid)
}

/// The runtime's game window inside OpenRetro's main window, while one is shown.
pub fn embedded_window(app: &tauri::AppHandle) -> Option<isize> {
    app.state::<InGameService>()
        .0
        .lock()
        .ok()?
        .as_ref()?
        .embedded_window
}

/// Save, load, reset or quit without the PC's in-game menu, for a player on
/// another device. The PC overlay stays as it is.
pub fn remote_action(app: &tauri::AppHandle, action: &str) -> Result<()> {
    if !matches!(action, "save" | "load" | "reset" | "quit") {
        return Err("Ação de jogo inválida.".into());
    }
    let service = app.state::<InGameService>();
    let mut guard = service.0.lock().map_err(error)?;
    let session = guard.as_mut().ok_or("Nenhum jogo em execução.")?;
    let command = command_for(action, session.info.slot)?;
    write_command(session, command)
}

#[tauri::command]
pub fn open_steam_controller_settings(app: tauri::AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("game-menu") {
        window.set_always_on_top(false).map_err(error)?;
    }
    #[cfg(not(target_os = "windows"))]
    return Err(
        "Abra Steam → Configurações → Controle e desligue ‘Botão Guia coloca a Steam em foco’."
            .into(),
    );
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer.exe")
            .arg("steam://settings/controller")
            .spawn()
            .map_err(error)?;
        Ok(())
    }
}

pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = tauri::WebviewWindowBuilder::new(
        app,
        "game-menu",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("OpenRetro · Menu do jogo")
    .initialization_script("window.__OPENRETRO_GAME_MENU__ = true;")
    .visible(false)
    .focused(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .fullscreen(true)
    .resizable(false)
    .build()?;
    let target = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if in_game_status(target.clone())
                .ok()
                .flatten()
                .is_some_and(|session| session.open)
            {
                let _ = toggle(&target);
            }
        }
    });
    #[cfg(target_os = "windows")]
    controller::start(app.clone());
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_arbitrary_commands_and_slot_overflow() {
        assert!(super::command_for("SAVE_STATE\nQUIT", 0).is_err());
        assert!(super::command_for("slot_previous", 0).is_err());
        assert!(super::command_for("slot_next", 99).is_err());
        assert_eq!(
            super::command_for("slot_previous", 1).unwrap(),
            "STATE_SLOT_MINUS"
        );
        assert_eq!(
            super::command_for("slot_next", 98).unwrap(),
            "STATE_SLOT_PLUS"
        );
    }
    #[test]
    fn cannot_control_a_session_before_the_process_is_attached() {
        let mut session = super::Session {
            info: super::SessionInfo {
                id: "test".into(),
                title: "Test".into(),
                open: false,
                slot: 0,
                screen_view: super::ScreenView::default(),
                view_available: false,
            },
            stdin: None,
            pid: 0,
            sdl_library: None,
            embedded_window: None,
            covered_views: Vec::new(),
            main_was_fullscreen: false,
        };
        assert!(super::write_command(&mut session, "SAVE_STATE").is_err());
    }
}
