//! OpenRetro's xinput1_3.dll for RPCS3, which loads it from its own folder
//! before Windows' copy. Every call goes to the system's XInput, except while
//! OpenRetro hosts a Party: then pads 2 to 4 are the guests' controllers,
//! which OpenRetro writes into the shared memory named by
//! `OPENRETRO_PARTY_PADS`. Pad 1 stays the PC's own controller.
#![allow(non_snake_case)]
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};

const MAGIC: u32 = 0x3150_524f;
const SIZE: usize = 64;
const GUESTS: u32 = 3;
const ERROR_SUCCESS: u32 = 0;
const ERROR_DEVICE_NOT_CONNECTED: u32 = 1167;
const FILE_MAP_READ: u32 = 4;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Gamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    lx: i16,
    ly: i16,
    rx: i16,
    ry: i16,
}
#[repr(C)]
pub struct State {
    packet: u32,
    gamepad: Gamepad,
}
#[repr(C)]
pub struct Capabilities {
    kind: u8,
    subtype: u8,
    flags: u16,
    gamepad: Gamepad,
    vibration: [u16; 2],
}
#[repr(C)]
pub struct Battery {
    kind: u8,
    level: u8,
}

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryW(path: *const u16) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
    fn GetSystemDirectoryW(buffer: *mut u16, size: u32) -> u32;
    fn OpenFileMappingW(access: u32, inherit: i32, name: *const u16) -> *mut c_void;
    fn MapViewOfFile(
        mapping: *mut c_void,
        access: u32,
        high: u32,
        low: u32,
        size: usize,
    ) -> *mut c_void;
}

type GetState = unsafe extern "system" fn(u32, *mut State) -> u32;
type SetState = unsafe extern "system" fn(u32, *mut c_void) -> u32;
type GetCapabilities = unsafe extern "system" fn(u32, u32, *mut Capabilities) -> u32;
type Enable = unsafe extern "system" fn(i32);
type GetGuids = unsafe extern "system" fn(u32, *mut c_void, *mut c_void) -> u32;
type GetBattery = unsafe extern "system" fn(u32, u8, *mut Battery) -> u32;
type GetKeystroke = unsafe extern "system" fn(u32, u32, *mut c_void) -> u32;

#[derive(Default)]
struct System {
    get_state: Option<GetState>,
    get_state_ex: Option<GetState>,
    set_state: Option<SetState>,
    get_capabilities: Option<GetCapabilities>,
    enable: Option<Enable>,
    get_guids: Option<GetGuids>,
    get_battery: Option<GetBattery>,
    get_keystroke: Option<GetKeystroke>,
}
unsafe impl Send for System {}
unsafe impl Sync for System {}

/// Windows' own XInput, by full path so this DLL never finds itself.
fn system() -> &'static System {
    static SYSTEM: OnceLock<System> = OnceLock::new();
    SYSTEM.get_or_init(|| unsafe {
        let mut directory = [0u16; 260];
        let length = GetSystemDirectoryW(directory.as_mut_ptr(), directory.len() as u32) as usize;
        if length == 0 || length >= directory.len() {
            return System::default();
        }
        for name in ["\\xinput1_4.dll", "\\xinput1_3.dll"] {
            let path: Vec<u16> = directory[..length]
                .iter()
                .copied()
                .chain(name.encode_utf16())
                .chain(Some(0))
                .collect();
            let module = LoadLibraryW(path.as_ptr());
            if module.is_null() {
                continue;
            }
            let find = |name: &[u8]| {
                let address = GetProcAddress(module, name.as_ptr());
                (!address.is_null()).then_some(address)
            };
            macro_rules! symbol {
                ($name:literal) => {
                    find(concat!($name, "\0").as_bytes()).map(|f| std::mem::transmute(f))
                };
            }
            return System {
                get_state: symbol!("XInputGetState"),
                get_state_ex: (!GetProcAddress(module, 100 as *const u8).is_null())
                    .then(|| std::mem::transmute(GetProcAddress(module, 100 as *const u8))),
                set_state: symbol!("XInputSetState"),
                get_capabilities: symbol!("XInputGetCapabilities"),
                enable: symbol!("XInputEnable"),
                get_guids: symbol!("XInputGetDSoundAudioDeviceGuids"),
                get_battery: symbol!("XInputGetBatteryInformation"),
                get_keystroke: symbol!("XInputGetKeystroke"),
            };
        }
        System::default()
    })
}

struct Guests(*const AtomicU64);
unsafe impl Send for Guests {}
unsafe impl Sync for Guests {}

/// The guests' pads, when OpenRetro started RPCS3 for a Party.
fn guests() -> Option<&'static Guests> {
    static GUESTS_VIEW: OnceLock<Option<Guests>> = OnceLock::new();
    GUESTS_VIEW
        .get_or_init(|| unsafe {
            let name = std::env::var_os("OPENRETRO_PARTY_PADS")?;
            let name: Vec<u16> = std::os::windows::ffi::OsStrExt::encode_wide(name.as_os_str())
                .chain(Some(0))
                .collect();
            let handle = OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr());
            if handle.is_null() {
                return None;
            }
            // The mapping stays open for the life of RPCS3.
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, SIZE) as *const AtomicU64;
            if view.is_null() || std::ptr::read_volatile(view as *const u32) != MAGIC {
                return None;
            }
            Some(Guests(view))
        })
        .as_ref()
}

/// A guest's pad: buttons, triggers and left stick, then the right stick,
/// a write sequence (odd while OpenRetro writes) and whether it is connected.
fn guest(view: &Guests, slot: u32) -> Option<State> {
    let words = unsafe { view.0.add(1 + slot as usize * 2) };
    for _ in 0..8 {
        let (state, extra) = unsafe { (&*words, &*words.add(1)) };
        let before = extra.load(Ordering::Acquire);
        let main = state.load(Ordering::Acquire);
        let after = extra.load(Ordering::Acquire);
        let sequence = (before >> 32) as u32 & 0x7fff_ffff;
        if before != after || sequence % 2 != 0 {
            continue;
        }
        if before >> 63 == 0 {
            return None;
        }
        return Some(State {
            packet: sequence / 2,
            gamepad: Gamepad {
                buttons: main as u16,
                left_trigger: (main >> 16) as u8,
                right_trigger: (main >> 24) as u8,
                lx: (main >> 32) as i16,
                ly: (main >> 48) as i16,
                rx: before as i16,
                ry: (before >> 16) as i16,
            },
        });
    }
    None
}

/// Which guest slot a pad index is during a Party: pads 2 to 4.
fn slot(index: u32) -> Option<&'static Guests> {
    guests().filter(|_| (1..=GUESTS).contains(&index))
}

unsafe fn read(index: u32, state: *mut State, call: Option<GetState>) -> u32 {
    if let Some(view) = slot(index) {
        return match guest(view, index - 1) {
            Some(guest) if !state.is_null() => {
                state.write(guest);
                ERROR_SUCCESS
            }
            _ => ERROR_DEVICE_NOT_CONNECTED,
        };
    }
    match call {
        Some(call) => call(index, state),
        None => ERROR_DEVICE_NOT_CONNECTED,
    }
}

#[no_mangle]
pub unsafe extern "system" fn XInputGetState(index: u32, state: *mut State) -> u32 {
    read(index, state, system().get_state)
}

#[no_mangle]
pub unsafe extern "system" fn XInputGetStateEx(index: u32, state: *mut State) -> u32 {
    read(index, state, system().get_state_ex.or(system().get_state))
}

#[no_mangle]
pub unsafe extern "system" fn XInputSetState(index: u32, vibration: *mut c_void) -> u32 {
    if let Some(view) = slot(index) {
        // Guests' rumble stays on their own device, if any.
        return if guest(view, index - 1).is_some() {
            ERROR_SUCCESS
        } else {
            ERROR_DEVICE_NOT_CONNECTED
        };
    }
    match system().set_state {
        Some(call) => call(index, vibration),
        None => ERROR_DEVICE_NOT_CONNECTED,
    }
}

#[no_mangle]
pub unsafe extern "system" fn XInputGetCapabilities(
    index: u32,
    flags: u32,
    capabilities: *mut Capabilities,
) -> u32 {
    if let Some(view) = slot(index) {
        if guest(view, index - 1).is_none() || capabilities.is_null() {
            return ERROR_DEVICE_NOT_CONNECTED;
        }
        capabilities.write(Capabilities {
            kind: 1,    // XINPUT_DEVTYPE_GAMEPAD
            subtype: 1, // XINPUT_DEVSUBTYPE_GAMEPAD
            flags: 0,
            gamepad: Gamepad {
                buttons: 0xf3ff,
                left_trigger: 255,
                right_trigger: 255,
                lx: -64,
                ly: -64,
                rx: -64,
                ry: -64,
            },
            vibration: [0; 2],
        });
        return ERROR_SUCCESS;
    }
    match system().get_capabilities {
        Some(call) => call(index, flags, capabilities),
        None => ERROR_DEVICE_NOT_CONNECTED,
    }
}

#[no_mangle]
pub unsafe extern "system" fn XInputEnable(enable: i32) {
    if let Some(call) = system().enable {
        call(enable);
    }
}

#[no_mangle]
pub unsafe extern "system" fn XInputGetDSoundAudioDeviceGuids(
    index: u32,
    render: *mut c_void,
    capture: *mut c_void,
) -> u32 {
    if slot(index).is_some() {
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    match system().get_guids {
        Some(call) => call(index, render, capture),
        None => ERROR_DEVICE_NOT_CONNECTED,
    }
}

#[no_mangle]
pub unsafe extern "system" fn XInputGetBatteryInformation(
    index: u32,
    device: u8,
    battery: *mut Battery,
) -> u32 {
    if let Some(view) = slot(index) {
        if guest(view, index - 1).is_none() || battery.is_null() {
            return ERROR_DEVICE_NOT_CONNECTED;
        }
        // BATTERY_TYPE_WIRED, BATTERY_LEVEL_FULL: nothing to warn about.
        battery.write(Battery { kind: 1, level: 3 });
        return ERROR_SUCCESS;
    }
    match system().get_battery {
        Some(call) => call(index, device, battery),
        None => ERROR_DEVICE_NOT_CONNECTED,
    }
}

#[no_mangle]
pub unsafe extern "system" fn XInputGetKeystroke(
    index: u32,
    reserved: u32,
    keystroke: *mut c_void,
) -> u32 {
    // XUSER_INDEX_ANY (255) reads the PC's pads only.
    if slot(index).is_some() {
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    match system().get_keystroke {
        Some(call) => call(index, reserved, keystroke),
        None => ERROR_DEVICE_NOT_CONNECTED,
    }
}
