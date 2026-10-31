//! Phone and Party players as virtual Xbox 360 pads, for emulators that read
//! SDL (yuzu and its forks). SDL only lists devices Windows knows about, so
//! the XInput shim that serves RPCS3 never reaches them; the ViGEmBus driver
//! makes real ones. A pad is plugged in when its player first sends input
//! and unplugged when that player leaves, so an emulator sees them come and
//! go as it would real controllers.
use super::{input::PadState, xinput};
use std::sync::{Arc, Mutex};
use vigem_client::{Client, TargetId, XButtons, XGamepad, Xbox360Wired};

struct Pads {
    client: Arc<Client>,
    pads: [Option<Xbox360Wired<Arc<Client>>>; 4],
}
/// The targets hold Windows handles that are only ever used under the lock.
struct Held(Pads);
unsafe impl Send for Held {}

static ACTIVE: Mutex<Option<Held>> = Mutex::new(None);

/// Virtual pads for one game; they go away when this drops.
pub struct Session;

/// Installs the ViGEmBus driver from the official winget package. Windows asks
/// for permission once, as it does for any driver.
fn install_driver() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    log::info!("Installing the ViGEmBus driver with winget");
    let status = std::process::Command::new("winget")
        .args([
            "install",
            "--exact",
            "--id",
            "ViGEm.ViGEmBus",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .status()
        .map_err(|_| {
            "O OpenRetro usa o Windows App Installer (winget) para instalar o driver dos controles, e ele não foi encontrado. Instale-o pela Microsoft Store e tente de novo."
                .to_string()
        })?;
    // winget also reports "already installed" with a non-zero code.
    if status.success() || Client::connect().is_ok() {
        Ok(())
    } else {
        Err("Não foi possível instalar o driver dos controles (ViGEmBus). Aceite o pedido de permissão do Windows e tente de novo.".into())
    }
}

impl Session {
    /// Fails when the ViGEmBus driver is not installed.
    pub fn start() -> Result<Self, String> {
        let client = Client::connect().map_err(|_| {
            "Para controlar o Switch pelo celular, instale o driver ViGEmBus (github.com/nefarius/ViGEmBus/releases) e reinicie o jogo."
                .to_string()
        })?;
        *ACTIVE.lock().map_err(|e| e.to_string())? = Some(Held(Pads {
            client: Arc::new(client),
            pads: Default::default(),
        }));
        Ok(Self)
    }
}

impl Session {
    /// Like `start`, installing the driver first when it is missing.
    pub fn start_installing() -> Result<Self, String> {
        match Self::start() {
            Ok(session) => Ok(session),
            Err(_) => {
                install_driver()?;
                Self::start()
            }
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            *active = None;
        }
    }
}

/// Player 1 to 4's pad; `None` unplugs it.
pub fn set(player: u8, state: Option<PadState>) {
    if !(1..=4).contains(&player) {
        return;
    }
    let Ok(mut active) = ACTIVE.lock() else { return };
    let Some(Held(Pads { client, pads })) = active.as_mut() else {
        return;
    };
    let slot = &mut pads[usize::from(player) - 1];
    let Some(state) = state else {
        // Dropping the target unplugs it.
        *slot = None;
        return;
    };
    if slot.is_none() {
        let mut target = Xbox360Wired::new(client.clone(), TargetId::XBOX360_WIRED);
        if let Err(message) = target.plugin().and_then(|_| target.wait_ready()) {
            log::warn!("Could not plug in a virtual pad for player {player}: {message:?}");
            return;
        }
        log::info!("Switch pad: player {player} is a virtual Xbox 360 pad");
        *slot = Some(target);
    }
    let fields = xinput::fields(state);
    if let Some(target) = slot {
        let _ = target.update(&XGamepad {
            buttons: XButtons { raw: fields.buttons },
            left_trigger: fields.left_trigger,
            right_trigger: fields.right_trigger,
            thumb_lx: fields.lx,
            thumb_ly: fields.ly,
            thumb_rx: fields.rx,
            thumb_ry: fields.ry,
        });
    }
}
