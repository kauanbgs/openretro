//! Hosts the managed RetroArch window inside OpenRetro's main HWND.
//! The emulator stays a separate process for crash isolation, but Windows treats
//! its render surface as a child of the launcher instead of another application.
use super::screen_view::ScreenView;
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
    fn EnumChildWindows(
        parent: *mut c_void,
        callback: unsafe extern "system" fn(*mut c_void, isize) -> i32,
        data: isize,
    ) -> i32;
    fn GetParent(window: *mut c_void) -> *mut c_void;
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
    fn SetWindowRgn(window: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
    fn GetWindowTextW(window: *mut c_void, text: *mut u16, max: i32) -> i32;
    fn InvalidateRect(window: *mut c_void, rect: *const Rect, erase: i32) -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
    fn WaitForSingleObject(handle: *mut c_void, millis: u32) -> u32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

fn process_exited(pid: u32) -> bool {
    unsafe {
        let handle = OpenProcess(0x00100000, 0, pid); // SYNCHRONIZE
        if handle.is_null() {
            return std::io::Error::last_os_error().raw_os_error() == Some(87);
        }
        let exited = WaitForSingleObject(handle, 0) == 0;
        CloseHandle(handle);
        exited
    }
}

#[link(name = "gdi32")]
extern "system" {
    fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
    fn DeleteObject(object: *mut c_void) -> i32;
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
const SW_HIDE: i32 = 0;
const SW_SHOWNA: i32 = 8;
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

struct Siblings {
    parent: *mut c_void,
    except: *mut c_void,
    found: Vec<isize>,
}

unsafe extern "system" fn find_sibling(window: *mut c_void, data: isize) -> i32 {
    let search = &mut *(data as *mut Siblings);
    if window != search.except && GetParent(window) == search.parent && IsWindowVisible(window) != 0
    {
        search.found.push(window as isize);
    }
    1
}

/// WebView2 composes its content with DirectComposition above every sibling
/// HWND, so the launcher UI would cover the game even with the game on top of
/// the z-order. Its host windows stay hidden while the game is embedded.
fn hide_siblings(parent: *mut c_void, child: *mut c_void) -> Vec<isize> {
    let mut search = Siblings {
        parent,
        except: child,
        found: Vec::new(),
    };
    unsafe {
        EnumChildWindows(parent, find_sibling, &mut search as *mut Siblings as isize);
        for window in &search.found {
            ShowWindow(*window as *mut c_void, SW_HIDE);
        }
    }
    search.found
}

/// Shows the launcher views again once the game window is gone.
pub fn reveal(windows: &[isize]) {
    for window in windows {
        let window = *window as *mut c_void;
        if unsafe { IsWindow(window) } != 0 {
            unsafe { ShowWindow(window, SW_SHOWNA) };
        }
    }
}

pub struct Embedded {
    pub window: isize,
    pub covered: Vec<isize>,
}

fn child_style(style: isize) -> isize {
    (style | WS_CHILD) & !(WS_POPUP | WS_CAPTION | WS_THICKFRAME)
}

/// The main window, full screen and shown, ready to hold the game.
fn game_parent(app: &tauri::AppHandle) -> Result<*mut c_void> {
    let main = app
        .get_webview_window("main")
        .ok_or("A janela principal do OpenRetro não está disponível.")?;
    main.set_fullscreen(true).map_err(error)?;
    main.show().map_err(error)?;
    Ok(main.hwnd().map_err(error)?.0)
}

/// A window's title and size, for the log.
fn describe(window: *mut c_void) -> String {
    let mut title = [0u16; 128];
    let mut rect = Rect::default();
    unsafe {
        let length = GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32).max(0);
        GetWindowRect(window, &mut rect);
        format!(
            "\"{}\" {}x{}",
            String::from_utf16_lossy(&title[..length as usize]),
            rect.right - rect.left,
            rect.bottom - rect.top
        )
    }
}

pub fn embed(app: &tauri::AppHandle, pid: u32) -> Result<Embedded> {
    let parent = game_parent(app)?;
    // RPCS3 opens its window after loading the system software.
    let deadline = Instant::now() + Duration::from_secs(30);
    let child = loop {
        if process_exited(pid) {
            return Err(
                "O emulador encerrou antes de abrir a janela do jogo. Tente iniciar novamente."
                    .into(),
            );
        }
        if let Some(window) = process_window(pid) {
            break window;
        }
        if Instant::now() >= deadline {
            return Err("O OpenRetro não encontrou a janela de vídeo do runtime.".into());
        }
        thread::sleep(Duration::from_millis(40));
    };
    log::info!("Embedding runtime window {}", describe(child));
    attach(parent, child)
}

/// Makes `child` a borderless child filling OpenRetro's window, with the
/// launcher views hidden behind it.
fn attach(parent: *mut c_void, child: *mut c_void) -> Result<Embedded> {
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
    }
    let covered = hide_siblings(parent, child);
    unsafe {
        let mut bounds = Rect::default();
        if GetClientRect(parent, &mut bounds) == 0 {
            reveal(&covered);
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
    Ok(Embedded {
        window: child as isize,
        covered,
    })
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

/// Asks the game window to close, as its close button would.
pub fn close(window: isize) -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn PostMessageW(window: *mut c_void, message: u32, wparam: usize, lparam: isize) -> i32;
    }
    const WM_CLOSE: u32 = 0x0010;
    is_open(window) && unsafe { PostMessageW(window as *mut c_void, WM_CLOSE, 0, 0) } != 0
}

pub fn is_open(window: isize) -> bool {
    window != 0 && unsafe { IsWindow(window as *mut c_void) } != 0
}

/// Whether the game window still sits inside OpenRetro's main window.
pub fn inside(app: &tauri::AppHandle, window: isize) -> bool {
    let Some(parent) = app
        .get_webview_window("main")
        .and_then(|main| main.hwnd().ok())
    else {
        return false;
    };
    is_open(window) && unsafe { GetParent(window as *mut c_void) } == parent.0
}

/// Puts the runtime's game window back inside OpenRetro when it is out on
/// its own. Embedded windows are children, so the search only finds one that
/// escaped or was created anew; None means there is nothing to bring back.
pub fn reembed(app: &tauri::AppHandle, pid: u32) -> Result<Option<Embedded>> {
    let Some(child) = process_window(pid) else {
        return Ok(None);
    };
    log::warn!(
        "Runtime window {} was outside OpenRetro; embedding it again",
        describe(child)
    );
    attach(game_parent(app)?, child).map(Some)
}

/// Clip the renderer itself, without capturing frames or affecting game input.
pub fn apply_view(window: isize, view: ScreenView) -> Result<()> {
    let child = window as *mut c_void;
    unsafe {
        if IsWindow(child) == 0 {
            return Err("A janela do jogo foi encerrada.".into());
        }
        let parent = GetParent(child);
        let mut bounds = Rect::default();
        if parent.is_null() || GetClientRect(parent, &mut bounds) == 0 {
            return Err("Não foi possível medir a tela do jogo.".into());
        }
        let p = view.placement(bounds.right - bounds.left, bounds.bottom - bounds.top);
        let (left, top, right, bottom) = p.clip;
        let region = CreateRectRgn(left, top, right, bottom);
        if region.is_null() {
            return Err("Não foi possível criar o recorte da tela.".into());
        }
        // Windows owns a region after a successful SetWindowRgn.
        if SetWindowRgn(child, region, 1) == 0 {
            DeleteObject(region);
            return Err("Não foi possível aplicar o recorte da tela.".into());
        }
        if SetWindowPos(
            child,
            std::ptr::null_mut(),
            p.x,
            p.y,
            p.width,
            p.height,
            SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        ) == 0
        {
            return Err("Não foi possível ajustar a imagem do jogo.".into());
        }
        // Erase pixels left behind by the previous position/region.
        InvalidateRect(parent, std::ptr::null(), 1);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[link(name = "user32")]
    extern "system" {
        fn CreateWindowExW(
            ex: u32,
            class: *const u16,
            name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: *mut c_void,
            menu: *mut c_void,
            instance: *mut c_void,
            param: *mut c_void,
        ) -> *mut c_void;
        fn DestroyWindow(window: *mut c_void) -> i32;
        fn GetWindowRgn(window: *mut c_void, region: *mut c_void) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn GetRgnBox(region: *mut c_void, rect: *mut Rect) -> i32;
    }
    struct TestWindow(*mut c_void);
    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe {
                DestroyWindow(self.0);
            }
        }
    }
    fn test_window(parent: *mut c_void, style: isize) -> TestWindow {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let window = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                style as u32,
                0,
                0,
                1920,
                1080,
                parent,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        assert!(!window.is_null());
        TestWindow(window)
    }
    #[test]
    fn native_window_region_hides_other_players_and_restores_full_screen() {
        // The parent stays hidden; this tests the real Windows API without
        // opening a visible application or needing a game/graphics driver.
        let parent = test_window(std::ptr::null_mut(), WS_POPUP);
        let child = test_window(parent.0, WS_CHILD);
        let selected = ScreenView {
            layout: super::super::screen_view::Layout::Grid,
            region: 4,
            full: false,
        };
        for view in [selected, ScreenView::default()] {
            apply_view(child.0 as isize, view).unwrap();
            let expected = view.placement(1920, 1080);
            unsafe {
                let mut rect = Rect::default();
                assert_ne!(GetWindowRect(child.0, &mut rect), 0);
                assert_eq!(rect.right - rect.left, expected.width);
                assert_eq!(rect.bottom - rect.top, expected.height);
                let region = CreateRectRgn(0, 0, 0, 0);
                assert_ne!(GetWindowRgn(child.0, region), 0);
                assert_ne!(GetRgnBox(region, &mut rect), 0);
                DeleteObject(region);
                assert_eq!(
                    (rect.left, rect.top, rect.right, rect.bottom),
                    expected.clip
                );
            }
        }
    }
    #[test]
    fn embedded_style_is_child_without_top_level_chrome() {
        let style = child_style(WS_POPUP | WS_CAPTION | WS_THICKFRAME);
        assert_ne!(style & WS_CHILD, 0);
        assert_eq!(style & (WS_POPUP | WS_CAPTION | WS_THICKFRAME), 0);
    }
}
