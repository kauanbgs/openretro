use super::{toggle, InGameService};
use std::{
    ffi::c_void,
    mem::size_of,
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[repr(C)]
struct JoyCaps {
    manufacturer: u16,
    product: u16,
    name: [u16; 32],
    values: [u32; 19],
    registry: [u16; 32],
    oem: [u16; 260],
}
#[repr(C)]
#[derive(Default)]
struct XGamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    lx: i16,
    ly: i16,
    rx: i16,
    ry: i16,
}
#[repr(C)]
#[derive(Default)]
struct XState {
    packet: u32,
    gamepad: XGamepad,
}
#[link(name = "winmm")]
extern "system" {
    fn joyGetNumDevs() -> u32;
    fn joyGetDevCapsW(id: usize, caps: *mut JoyCaps, size: u32) -> u32;
    fn joyGetPosEx(id: u32, info: *mut u32) -> u32;
}
#[link(name = "xinput")]
extern "system" {
    fn XInputGetState(index: u32, state: *mut XState) -> u32;
}
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(key: i32) -> i16;
    fn GetForegroundWindow() -> *mut c_void;
    fn GetWindowThreadProcessId(window: *mut c_void, pid: *mut u32) -> u32;
    fn EnumWindows(
        callback: unsafe extern "system" fn(*mut c_void, isize) -> i32,
        data: isize,
    ) -> i32;
    fn IsWindowVisible(window: *mut c_void) -> i32;
    fn SetForegroundWindow(window: *mut c_void) -> i32;
    fn ShowWindow(window: *mut c_void, command: i32) -> i32;
}

pub fn focus_process(pid: u32) {
    unsafe extern "system" fn find(window: *mut c_void, target: isize) -> i32 {
        let mut current = 0;
        GetWindowThreadProcessId(window, &mut current);
        if current == target as u32 && IsWindowVisible(window) != 0 {
            ShowWindow(window, 9);
            SetForegroundWindow(window);
            return 0;
        }
        1
    }
    unsafe {
        EnumWindows(find, pid as isize);
    }
}

pub fn start(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut previous = false;
        let mut devices = Vec::new();
        let mut scanned = Instant::now() - Duration::from_secs(10);
        let mut last_toggle = Instant::now() - Duration::from_secs(10);
        let mut previous_menu = 0u32;
        let mut repeats = [Instant::now(); 6];
        loop {
            let session = app
                .state::<InGameService>()
                .0
                .lock()
                .ok()
                .and_then(|guard| {
                    guard
                        .as_ref()
                        .filter(|s| s.stdin.is_some())
                        .map(|s| (s.pid, s.info.open))
                });
            let Some((pid, open)) = session else {
                previous = false;
                thread::sleep(Duration::from_millis(150));
                continue;
            };
            if scanned.elapsed() > Duration::from_secs(3) {
                devices.clear();
                for id in 0..unsafe { joyGetNumDevs() }.min(16) {
                    let mut caps: JoyCaps = unsafe { std::mem::zeroed() };
                    if unsafe {
                        joyGetDevCapsW(id as usize, &mut caps, size_of::<JoyCaps>() as u32)
                    } == 0
                    {
                        let name = String::from_utf16_lossy(&caps.name).to_lowercase();
                        if name.contains("wireless controller")
                            || name.contains("dualshock")
                            || name.contains("dualsense")
                            || name.contains("ps4 controller")
                        {
                            devices.push(id);
                        }
                    }
                }
                scanned = Instant::now();
            }
            let mut pressed = false;
            let mut menu = 0u32;
            for id in &devices {
                let mut info = [0u32; 13];
                info[0] = size_of::<[u32; 13]>() as u32;
                info[1] = 0xc3;
                if unsafe { joyGetPosEx(*id, info.as_mut_ptr()) } == 0 {
                    let buttons = info[8];
                    pressed |= buttons & (1 << 12) != 0
                        || buttons & ((1 << 8) | (1 << 9)) == ((1 << 8) | (1 << 9));
                    if buttons & (1 << 1) != 0 {
                        menu |= 1;
                    }
                    if buttons & (1 << 2) != 0 {
                        menu |= 2;
                    }
                    let pov = info[10];
                    if pov <= 4500 || (pov >= 31500 && pov <= 35999) || info[3] < 16384 {
                        menu |= 4;
                    }
                    if (13500..=22500).contains(&pov) || info[3] > 49152 {
                        menu |= 8;
                    }
                    if (22500..=31500).contains(&pov) || info[2] < 16384 {
                        menu |= 16;
                    }
                    if (4500..=13500).contains(&pov) || info[2] > 49152 {
                        menu |= 32;
                    }
                }
            }
            for index in 0..4 {
                let mut state = XState::default();
                if unsafe { XInputGetState(index, &mut state) } == 0 {
                    let buttons = state.gamepad.buttons;
                    pressed |= buttons & 0x0030 == 0x0030;
                    if buttons & 0x1000 != 0 {
                        menu |= 1;
                    }
                    if buttons & 0x2000 != 0 {
                        menu |= 2;
                    }
                    if buttons & 1 != 0 || state.gamepad.ly > 16000 {
                        menu |= 4;
                    }
                    if buttons & 2 != 0 || state.gamepad.ly < -16000 {
                        menu |= 8;
                    }
                    if buttons & 4 != 0 || state.gamepad.lx < -16000 {
                        menu |= 16;
                    }
                    if buttons & 8 != 0 || state.gamepad.lx > 16000 {
                        menu |= 32;
                    }
                }
            }
            let mut foreground_pid = 0;
            unsafe {
                GetWindowThreadProcessId(GetForegroundWindow(), &mut foreground_pid);
            }
            if foreground_pid == pid || open {
                pressed |= unsafe { GetAsyncKeyState(0x70) } < 0;
            }
            if pressed && !previous && last_toggle.elapsed() > Duration::from_millis(450) {
                let target = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if let Err(error) = toggle(&target) {
                        log::warn!("In-game menu: {error}");
                    }
                });
                last_toggle = Instant::now();
            }
            previous = pressed;
            for (index, key) in ["a", "b", "up", "down", "left", "right"].iter().enumerate() {
                let bit = 1u32 << index;
                if open
                    && menu & bit != 0
                    && (previous_menu & bit == 0
                        || (index >= 2 && repeats[index].elapsed() > Duration::from_millis(220)))
                {
                    let _ = app.emit("in-game-input", *key);
                    repeats[index] = Instant::now();
                }
            }
            previous_menu = menu;
            thread::sleep(Duration::from_millis(16));
        }
    });
}
