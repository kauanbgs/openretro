//! Hosts the managed RetroArch window inside OpenRetro's main HWND.
//! The emulator stays a separate process for crash isolation, but Windows treats
//! its render surface as a child of the launcher instead of another application.
use crate::database::{error, Result};
use std::{
    ffi::c_void,
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

#[repr(C)]
#[derive(Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

struct Search {
    pid: u32,
    window: *mut c_void,
    area: i64,
}

#[link(name = "user32")]
extern "system" {
    fn EnumWindows(
        callback: unsafe extern "system" fn(*mut c_void, isize) -> i32,
        data: isize,
    ) -> i32;
    fn GetWindowThreadProcessId(window: *mut c_void, pid: *mut u32) -> u32;
    fn IsWindowVisible(window: *mut c_void) -> i32;
    fn IsWindow(window: *mut c_void) -> i32;
    fn GetWindow(window: *mut c_void, command: u32) -> *mut c_void;
    fn GetWindowRect(window: *mut c_void, rect: *mut Rect) -> i32;
    fn GetClientRect(window: *mut c_void, rect: *mut Rect) -> i32;
    fn GetWindowLongPtrW(window: *mut c_void, index: i32) -> isize;
    fn SetWindowLongPtrW(window: *mut c_void, index: i32, value: isize) -> isize;
    fn SetParent(child: *mut c_void, parent: *mut c_void) -> *mut c_void;
    fn SetWindowPos(
        window: *mut c_void,
        after: *mut c_void,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> i32;
    fn ShowWindow(window: *mut c_void, command: i32) -> i32;
    fn SetForegroundWindow(window: *mut c_void) -> i32;
    fn SetFocus(window: *mut c_void) -> *mut c_void;
    fn BringWindowToTop(window: *mut c_void) -> i32;
}

const GW_OWNER: u32 = 4;
const GWL_STYLE: i32 = -16;
const GWL_EXSTYLE: i32 = -20;
const WS_CHILD: isize = 0x40000000;
const WS_POPUP: isize = 0x80000000u32 as isize;
const WS_CAPTION: isize = 0x00c00000;
const WS_THICKFRAME: isize = 0x00040000;
const WS_EX_APPWINDOW: isize = 0x00040000;
const WS_EX_TOOLWINDOW: isize = 0x00000080;
const SW_RESTORE: i32 = 9;
const SWP_FRAMECHANGED: u32 = 0x0020;
const SWP_SHOWWINDOW: u32 = 0x0040;

unsafe extern "system" fn find_window(window: *mut c_void, data: isize) -> i32 {
    let search = &mut *(data as *mut Search);
    let mut pid = 0;
    GetWindowThreadProcessId(window, &mut pid);
    if pid != search.pid || IsWindowVisible(window) == 0 || !GetWindow(window, GW_OWNER).is_null() {
        return 1;
    }
    let mut rect = Rect::default();
    if GetWindowRect(window, &mut rect) == 0 {
        return 1;
    }
    let area =
        i64::from((rect.right - rect.left).max(0)) * i64::from((rect.bottom - rect.top).max(0));
    if area > search.area {
        search.window = window;
        search.area = area;
    }
    1
}

fn process_window(pid: u32) -> Option<*mut c_void> {
    let mut search = Search {
        pid,
        window: std::ptr::null_mut(),
        area: 0,
    };
    unsafe {
        EnumWindows(find_window, &mut search as *mut Search as isize);
    }
    (!search.window.is_null()).then_some(search.window)
}

fn child_style(style: isize) -> isize {
    (style | WS_CHILD) & !(WS_POPUP | WS_CAPTION | WS_THICKFRAME)
}

pub fn embed(app: &tauri::AppHandle, pid: u32) -> Result<isize> {
    let main = app
        .get_webview_window("main")
        .ok_or("A janela principal do OpenRetro não está disponível.")?;
    main.set_fullscreen(true).map_err(error)?;
    main.show().map_err(error)?;
    let parent = main.hwnd().map_err(error)?.0;
    let deadline = Instant::now() + Duration::from_secs(12);
    let child = loop {
        if let Some(window) = process_window(pid) {
            break window;
        }
        if Instant::now() >= deadline {
            return Err("O OpenRetro não encontrou a janela de vídeo do runtime.".into());
        }
        thread::sleep(Duration::from_millis(40));
    };
    unsafe {
        let style = GetWindowLongPtrW(child, GWL_STYLE);
        let extended = GetWindowLongPtrW(child, GWL_EXSTYLE);
        SetWindowLongPtrW(child, GWL_STYLE, child_style(style));
        SetWindowLongPtrW(
            child,
            GWL_EXSTYLE,
            (extended & !WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW,
        );
        SetParent(child, parent);
        let mut bounds = Rect::default();
        if GetClientRect(parent, &mut bounds) == 0 {
            return Err("O OpenRetro não conseguiu medir a área do jogo.".into());
        }
        SetWindowPos(
            child,
            std::ptr::null_mut(),
            0,
            0,
            bounds.right.max(1),
            bounds.bottom.max(1),
            SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        );
        ShowWindow(child, SW_RESTORE);
        BringWindowToTop(child);
        SetForegroundWindow(parent);
        SetFocus(child);
    }
    Ok(child as isize)
}

pub fn focus(window: isize) -> bool {
    let window = window as *mut c_void;
    if window.is_null() || unsafe { IsWindow(window) } == 0 {
        return false;
    }
    unsafe {
        ShowWindow(window, SW_RESTORE);
        BringWindowToTop(window);
        SetFocus(window);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedded_style_is_child_without_top_level_chrome() {
        let style = child_style(WS_POPUP | WS_CAPTION | WS_THICKFRAME);
        assert_ne!(style & WS_CHILD, 0);
        assert_eq!(style & (WS_POPUP | WS_CAPTION | WS_THICKFRAME), 0);
    }
}
