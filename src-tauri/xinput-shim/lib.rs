//! OpenRetro's xinput1_3.dll for RPCS3, which loads it from its own folder
//! before Windows' copy. Every call goes to the system's XInput, except while
//! OpenRetro hosts a Party or phone play: then pads 2 to 4 are the remote
//! players' controllers, which OpenRetro writes into the shared memory named
//! by `OPENRETRO_PARTY_PADS`. Pad 1 is the PC's own controller, unless a
//! phone is playing as player 1; it gets the pad while it is connected.
#![allow(non_snake_case)]
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};

const MAGIC: u32 = 0x3150_524f;
const SIZE: usize = 128;
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

static MODULE: AtomicU64 = AtomicU64::new(0);
static NOTED: AtomicU64 = AtomicU64::new(0);

/// Appends a line to openretro-xinput.log next to this DLL.
fn note(line: &str) {
    let mut name = [0u16; 520];
    let module = MODULE.load(Ordering::Relaxed) as *mut c_void;
    let length =
        unsafe { GetModuleFileNameW(module, name.as_mut_ptr(), name.len() as u32) } as usize;
    if length == 0 || length >= name.len() {
        return;
    }
    let path = String::from_utf16_lossy(&name[..length]);
    let log = std::path::Path::new(&path).with_file_name("openretro-xinput.log");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .and_then(|mut file| {
            std::io::Write::write_all(
                &mut file,
                format!(
                    "{line}
"
                )
                .as_bytes(),
            )
        });
}

/// Says once per pad and outcome what the game asked of it.
fn noted(index: u32, what: &str) {
    let bit = (index.min(7) * 2 + u32::from(what == "remote")) as u64;
    if NOTED.fetch_or(1 << bit, Ordering::Relaxed) & (1 << bit) == 0 {
        note(&format!("pad {index}: {what}"));
    }
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleFileNameW(module: *mut c_void, name: *mut u16, size: u32) -> u32;
}

/// Leaves a line next to this DLL each time a process loads it, so a Party
/// that does not reach the game can be told from one RPCS3 never loaded.
#[no_mangle]
pub unsafe extern "system" fn DllMain(module: *mut c_void, reason: u32, _: *mut c_void) -> i32 {
    if reason == 1 {
        MODULE.store(module as u64, Ordering::Relaxed);
        note(&format!(
            "loaded by {}, pads {}",
            std::env::current_exe().map_or_else(|_| "?".into(), |e| e.display().to_string()),
            if std::env::var_os("OPENRETRO_PARTY_PADS").is_some() {
                "remote"
            } else {
                "none"
            },
        ));
    }
    1
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

/// A remote pad: buttons, triggers and left stick, then the right stick,
/// a write sequence (odd while OpenRetro writes) and whether it is connected.
/// Pads 2 to 4 are words 1 to 6; pad 1 follows them.
fn guest(view: &Guests, index: u32) -> Option<State> {
    let first = if index == 0 {
        7
    } else {
        1 + (index as usize - 1) * 2
    };
    let words = unsafe { view.0.add(first) };
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

/// The remote pads' memory when this pad index is theirs: pads 2 to 4 always
/// are, pad 1 only while a phone holds it.
fn slot(index: u32) -> Option<&'static Guests> {
    guests()
        .filter(|view| (1..=GUESTS).contains(&index) || (index == 0 && guest(view, 0).is_some()))
}

unsafe fn read(index: u32, state: *mut State, call: Option<GetState>) -> u32 {
    if let Some(view) = slot(index) {
        return match guest(view, index) {
            Some(guest) if !state.is_null() => {
                noted(index, "remote");
                state.write(guest);
                ERROR_SUCCESS
            }
            _ => {
                noted(index, "remote, nobody connected");
                ERROR_DEVICE_NOT_CONNECTED
            }
        };
    }
    if index < 4 {
        noted(
            index,
            if guests().is_some() {
                "the PC's"
            } else {
                "the PC's, no remote pads"
            },
        );
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
        return if guest(view, index).is_some() {
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
        if guest(view, index).is_none() || capabilities.is_null() {
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
        if guest(view, index).is_none() || battery.is_null() {
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
