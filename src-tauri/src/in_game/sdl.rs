//! Reuse the managed runtime's SDL2; no second controller library is downloaded.
//! SDL's background HID support exposes the DS4 Guide button that WinMM can omit.
use std::{ffi::c_void, os::windows::ffi::OsStrExt, path::Path};

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryExW(path: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
    fn FreeLibrary(module: *mut c_void) -> i32;
}
struct Library(*mut c_void);
impl Drop for Library {
    fn drop(&mut self) {
        unsafe {
            FreeLibrary(self.0);
        }
    }
}
pub struct Sdl {
    _library: Library,
    quit: unsafe extern "C" fn(u32),
    update: unsafe extern "C" fn(),
    count: unsafe extern "C" fn() -> i32,
    is_controller: unsafe extern "C" fn(i32) -> i32,
    open: unsafe extern "C" fn(i32) -> *mut c_void,
    close: unsafe extern "C" fn(*mut c_void),
    attached: unsafe extern "C" fn(*mut c_void) -> i32,
    button: unsafe extern "C" fn(*mut c_void, i32) -> u8,
    axis: unsafe extern "C" fn(*mut c_void, i32) -> i16,
    controllers: Vec<*mut c_void>,
}
impl Sdl {
    pub fn load(path: &Path) -> Option<Self> {
        if !path.is_absolute() || !path.is_file() {
            return None;
        }
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            // Resolve only this absolute runtime DLL and its directory/system dependencies.
            let module = LoadLibraryExW(path.as_ptr(), std::ptr::null_mut(), 0x1100);
            if module.is_null() {
                return None;
            }
            let library = Library(module);
            macro_rules! symbol {
                ($name:literal, $ty:ty) => {{
                    let address = GetProcAddress(module, concat!($name, "\0").as_ptr());
                    if address.is_null() {
                        return None;
                    }
                    std::mem::transmute::<*mut c_void, $ty>(address)
                }};
            }
            let hint = symbol!(
                "SDL_SetHint",
                unsafe extern "C" fn(*const u8, *const u8) -> i32
            );
            hint(
                b"SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS\0".as_ptr(),
                b"1\0".as_ptr(),
            );
            hint(b"SDL_JOYSTICK_HIDAPI_PS4\0".as_ptr(), b"1\0".as_ptr());
            let init = symbol!("SDL_InitSubSystem", unsafe extern "C" fn(u32) -> i32);
            let mut driver = Self {
                _library: library,
                quit: symbol!("SDL_QuitSubSystem", unsafe extern "C" fn(u32)),
                update: symbol!("SDL_GameControllerUpdate", unsafe extern "C" fn()),
                count: symbol!("SDL_NumJoysticks", unsafe extern "C" fn() -> i32),
                is_controller: symbol!("SDL_IsGameController", unsafe extern "C" fn(i32) -> i32),
                open: symbol!(
                    "SDL_GameControllerOpen",
                    unsafe extern "C" fn(i32) -> *mut c_void
                ),
                close: symbol!("SDL_GameControllerClose", unsafe extern "C" fn(*mut c_void)),
                attached: symbol!(
                    "SDL_GameControllerGetAttached",
                    unsafe extern "C" fn(*mut c_void) -> i32
                ),
                button: symbol!(
                    "SDL_GameControllerGetButton",
                    unsafe extern "C" fn(*mut c_void, i32) -> u8
                ),
                axis: symbol!(
                    "SDL_GameControllerGetAxis",
                    unsafe extern "C" fn(*mut c_void, i32) -> i16
                ),
                controllers: Vec::new(),
            };
            if init(0x2000) != 0 {
                return None;
            }
            // We pump manually and never accumulate an unconsumed SDL event queue.
            symbol!(
                "SDL_GameControllerEventState",
                unsafe extern "C" fn(i32) -> i32
            )(0);
            symbol!("SDL_JoystickEventState", unsafe extern "C" fn(i32) -> i32)(0);
            driver.rescan();
            Some(driver)
        }
    }
    pub fn rescan(&mut self) {
        unsafe {
            for controller in self.controllers.drain(..) {
                (self.close)(controller);
            }
            (self.update)();
            for index in 0..(self.count)().clamp(0, 16) {
                if (self.is_controller)(index) == 0 {
                    continue;
                }
                let controller = (self.open)(index);
                if !controller.is_null() {
                    self.controllers.push(controller);
                }
            }
        }
        log::debug!(
            "OpenRetro SDL background controllers: {}",
            self.controllers.len()
        );
    }
    /// The type (`SDL_GameControllerType`) and name of each connected
    /// controller, in SDL's order.
    pub fn controller_types(&self) -> Vec<(i32, String)> {
        unsafe {
            let kind = GetProcAddress(self._library.0, c"SDL_GameControllerTypeForIndex".as_ptr().cast());
            let name = GetProcAddress(self._library.0, c"SDL_GameControllerNameForIndex".as_ptr().cast());
            if kind.is_null() || name.is_null() {
                return Vec::new();
            }
            let kind = std::mem::transmute::<*mut c_void, unsafe extern "C" fn(i32) -> i32>(kind);
            let name = std::mem::transmute::<*mut c_void, unsafe extern "C" fn(i32) -> *const std::ffi::c_char>(name);
            (self.update)();
            (0..(self.count)().clamp(0, 16))
                .filter(|&index| (self.is_controller)(index) != 0)
                .map(|index| {
                    let label = name(index);
                    let label = if label.is_null() {
                        String::new()
                    } else {
                        std::ffi::CStr::from_ptr(label).to_string_lossy().into_owned()
                    };
                    (kind(index), label)
                })
                .collect()
        }
    }
    pub fn sample(&self) -> (bool, u32) {
        let mut guide = false;
        let mut menu = 0;
        unsafe {
            (self.update)();
            for &controller in &self.controllers {
                if (self.attached)(controller) == 0 {
                    continue;
                }
                let pressed = |id| (self.button)(controller, id) != 0;
                guide |= pressed(5) || (pressed(4) && pressed(6));
                for (id, bit) in [(0, 1), (1, 2), (11, 4), (12, 8), (13, 16), (14, 32)] {
                    if pressed(id) {
                        menu |= bit;
                    }
                }
                let x = (self.axis)(controller, 0);
                let y = (self.axis)(controller, 1);
                if x < -16000 {
                    menu |= 16;
                }
                if x > 16000 {
                    menu |= 32;
                }
                if y < -16000 {
                    menu |= 4;
                }
                if y > 16000 {
                    menu |= 8;
                }
            }
        }
        (guide, menu)
    }
}
impl Drop for Sdl {
    fn drop(&mut self) {
        unsafe {
            for controller in self.controllers.drain(..) {
                (self.close)(controller);
            }
            (self.quit)(0x2000);
        }
    }
}
