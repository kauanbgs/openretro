//! Party guests' and phones' controllers for PS3 games. RPCS3 takes no remote
//! gamepad, so OpenRetro puts its own xinput1_3.dll (`xinput-shim`) next to
//! it: while a Party or phone play hosts the game, RPCS3's XInput pads 2 to 4
//! are players J2 to J4, read from the shared memory written here. Pad 1 stays
//! the PC's own, unless a phone plays as J1: it holds the pad while connected.
use super::input::PadState;
#[cfg(test)]
use std::os::windows::ffi::OsStrExt;
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

/// The shim, built by build.rs. Written next to rpcs3.exe before each game.
pub const DLL: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/xinput1_3.dll"));
/// RPCS3 inherits the mapping's name; without it the shim only passes through.
pub const ENV: &str = "OPENRETRO_PARTY_PADS";
const MAGIC: u32 = 0x3150_524f;
const SIZE: usize = 128;
const PAGE_READWRITE: u32 = 4;
const FILE_MAP_ALL_ACCESS: u32 = 0xf001f;

#[link(name = "kernel32")]
extern "system" {
    fn CreateFileMappingW(
        file: *mut c_void,
        attributes: *const c_void,
        protection: u32,
        high: u32,
        low: u32,
        name: *const u16,
    ) -> *mut c_void;
    fn MapViewOfFile(
        mapping: *mut c_void,
        access: u32,
        high: u32,
        low: u32,
        size: usize,
    ) -> *mut c_void;
    fn UnmapViewOfFile(view: *const c_void) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
}

struct Mapping {
    handle: *mut c_void,
    view: *const AtomicU64,
}
unsafe impl Send for Mapping {}
impl Drop for Mapping {
    fn drop(&mut self) {
        unsafe {
            UnmapViewOfFile(self.view as *const c_void);
            CloseHandle(self.handle);
        }
    }
}

static ACTIVE: Mutex<Option<Mapping>> = Mutex::new(None);
static LOGGED: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
/// The PC's own controller (or keyboard) plays player 1, so phones cannot.
static PC_FIRST: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_pc_first(value: bool) {
    PC_FIRST.store(value, Ordering::Relaxed);
}

/// Players a phone cannot take in the running PS3 game.
pub fn locked() -> Vec<u8> {
    let active = ACTIVE.lock().is_ok_and(|active| active.is_some());
    if active && PC_FIRST.load(Ordering::Relaxed) {
        vec![1]
    } else {
        Vec::new()
    }
}

/// Guests' pads for one PS3 game; they stop reaching it when this drops.
pub struct PartyPads {
    pub name: String,
}

impl PartyPads {
    pub fn create() -> Result<Self, String> {
        let name = format!("Local\\OpenRetroPartyPads-{}", uuid::Uuid::new_v4());
        let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let mapping = unsafe {
            let handle = CreateFileMappingW(
                -1isize as *mut c_void,
                std::ptr::null(),
                PAGE_READWRITE,
                0,
                SIZE as u32,
                wide.as_ptr(),
            );
            if handle.is_null() {
                return Err("Não foi possível preparar os controles do Party.".into());
            }
            let view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, SIZE) as *const AtomicU64;
            if view.is_null() {
                CloseHandle(handle);
                return Err("Não foi possível preparar os controles do Party.".into());
            }
            // A new mapping is zeroed: every guest starts disconnected.
            (*view).store(u64::from(MAGIC), Ordering::Release);
            Mapping { handle, view }
        };
        LOGGED.store(0, Ordering::Relaxed);
        *ACTIVE.lock().map_err(|e| e.to_string())? = Some(mapping);
        Ok(Self { name })
    }
}

impl Drop for PartyPads {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            *active = None;
        }
    }
}

/// libretro's RetroPad bits (B, Y, Select, Start, Up, Down, Left, Right, A,
/// X, L, R, L2, R2, L3, R3) as XInput buttons, by position: RetroPad B is
/// the bottom button, Cross on a PS3 pad and A on XInput.
const BUTTONS: [u16; 16] = [
    0x1000, 0x4000, 0x0020, 0x0010, 0x0001, 0x0002, 0x0004, 0x0008, 0x2000, 0x8000, 0x0100, 0x0200,
    0, 0, 0x0040, 0x0080,
];

/// The two words the shim reads for a connected pad. libretro's sticks point
/// down for positive Y; XInput's point up.
fn words(state: PadState, sequence: u32) -> (u64, u64) {
    let buttons = BUTTONS
        .iter()
        .enumerate()
        .filter(|(bit, _)| state.buttons & (1 << bit) != 0)
        .fold(0u16, |all, (_, button)| all | button);
    let trigger = |bit: u16| {
        if state.buttons & (1 << bit) != 0 {
            255u64
        } else {
            0
        }
    };
    let up = |value: i16| value.saturating_neg().max(-32767) as u16 as u64;
    let [lx, ly, rx, ry] = state.axes;
    let main = u64::from(buttons)
        | trigger(12) << 16
        | trigger(13) << 24
        | (lx as u16 as u64) << 32
        | up(ly) << 48;
    let extra =
        (rx as u16 as u64) | up(ry) << 16 | u64::from(sequence & 0x7fff_ffff) << 32 | 1 << 63;
    (main, extra)
}

/// A remote pad for player 1 to 4; `None` unplugs it. Player 1 is the PC's
/// again once unplugged.
pub fn set(player: u8, state: Option<PadState>) {
    if !(1..=4).contains(&player) {
        return;
    }
    let Ok(active) = ACTIVE.lock() else { return };
    let Some(mapping) = active.as_ref() else {
        return;
    };
    // Once per player and game: proof in the log that a pad reached its slot.
    let bit = 1u8 << (player - 1);
    if state.is_some() && LOGGED.fetch_or(bit, Ordering::Relaxed) & bit == 0 {
        log::info!("PS3 pad: player {player} is connected");
    }
    // And that a press arrived, not only the idle repeats a guest sends.
    let pressed = bit << 4;
    if let Some(held) = state.filter(|held| *held != PadState::default()) {
        if LOGGED.fetch_or(pressed, Ordering::Relaxed) & pressed == 0 {
            log::info!(
                "PS3 pad: player {player} pressed buttons {:#06x}",
                held.buttons
            );
        }
    }
    let (main, extra) = unsafe {
        let first = if player == 1 {
            7
        } else {
            1 + (usize::from(player) - 2) * 2
        };
        let slot = mapping.view.add(first);
        (&*slot, &*slot.add(1))
    };
    let sequence = (extra.load(Ordering::Relaxed) >> 32) as u32 & 0x7fff_ffff;
    // Odd while writing, so the shim never mixes two states.
    let writing = sequence.wrapping_add(1) & 0x7fff_ffff;
    let done = writing.wrapping_add(1) & 0x7fff_ffff;
    extra.store(u64::from(writing) << 32, Ordering::Release);
    match state {
        Some(state) => {
            let (now, rest) = words(state, done);
            main.store(now, Ordering::Release);
            extra.store(rest, Ordering::Release);
        }
        None => {
            main.store(0, Ordering::Release);
            extra.store(u64::from(done) << 32, Ordering::Release);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retropad_positions_become_xinput_buttons_and_sticks() {
        let state = PadState {
            // B, Start, A, L2, R3
            buttons: 1 | 1 << 3 | 1 << 8 | 1 << 12 | 1 << 15,
            axes: [-32768, 32767, 100, -32768],
        };
        let (main, extra) = words(state, 4);
        assert_eq!(main as u16, 0x1000 | 0x0010 | 0x2000 | 0x0080);
        assert_eq!((main >> 16) as u8, 255);
        assert_eq!((main >> 24) as u8, 0);
        assert_eq!((main >> 32) as i16, -32768);
        assert_eq!((main >> 48) as i16, -32767);
        assert_eq!(extra as i16, 100);
        assert_eq!((extra >> 16) as i16, 32767);
        assert_eq!((extra >> 32) as u32 & 0x7fff_ffff, 4);
        assert_eq!(extra >> 63, 1);
    }

    /// The only test that creates a mapping: the active one is process-wide.
    #[test]
    fn rpcs3_reads_guests_through_the_shim_and_pad_1_stays_the_pc() {
        #[link(name = "kernel32")]
        extern "system" {
            fn LoadLibraryW(path: *const u16) -> *mut c_void;
            fn GetProcAddress(module: *mut c_void, name: *const u8) -> *mut c_void;
        }
        type GetState = unsafe extern "system" fn(u32, *mut [u16; 8]) -> u32;
        let pads = PartyPads::create().unwrap();
        let held = PadState {
            buttons: 1 | 1 << 13,
            axes: [10, 20, 30, 40],
        };
        set(3, Some(held));
        let directory =
            std::env::temp_dir().join(format!("openretro-xinput-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let dll = directory.join("xinput1_3.dll");
        std::fs::write(&dll, DLL).unwrap();
        std::env::set_var(ENV, &pads.name);
        let path: Vec<u16> = dll.as_os_str().encode_wide().chain(Some(0)).collect();
        let (by_name, by_ordinal): (GetState, GetState) = unsafe {
            let module = LoadLibraryW(path.as_ptr());
            assert!(!module.is_null());
            let named = GetProcAddress(module, b"XInputGetState\0".as_ptr());
            let ordinal = GetProcAddress(module, 100 as *const u8);
            assert!(!named.is_null() && !ordinal.is_null());
            (std::mem::transmute(named), std::mem::transmute(ordinal))
        };
        let read = |call: GetState, index| {
            let mut state = [0u16; 8];
            (unsafe { call(index, &mut state) }, state)
        };
        // XInput pad 3 is J3: XInput A, right trigger, sticks with Y up.
        let (result, state) = read(by_ordinal, 2);
        assert_eq!(result, 0);
        assert_eq!(state[2], 0x1000);
        assert_eq!(state[3], 255 << 8);
        assert_eq!(&state[4..8], &[10, (-20i16) as u16, 30, (-40i16) as u16]);
        assert_eq!(read(by_name, 2).1, state);
        // J2 has no guest; pad 1 is whatever Windows has, until a phone takes it.
        assert_eq!(read(by_name, 1).0, 1167);
        assert_ne!(read(by_name, 0).1[2], 0x1000);
        set(1, Some(held));
        assert_eq!(read(by_name, 0), (0, read(by_name, 2).1));
        set(1, None);
        assert_ne!(read(by_name, 0).1[2], 0x1000);
        set(3, None);
        assert_eq!(read(by_name, 2).0, 1167);
        drop(pads);
        set(3, Some(held));
        assert!(ACTIVE.lock().unwrap().is_none());
    }
}
