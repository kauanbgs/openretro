//! Ryujinx's own controls. Ryujinx only listens to the devices its Config.json
//! lists. Before it starts, the controllers connected now take the players that
//! are still on the keyboard, and phones and Party players (virtual Xbox 360
//! pads) get the remaining players 2 to 4. Mappings on a controller are never
//! touched. Its update check and exit confirmation are turned off too: the
//! update server is gone, and a dialog over an embedded window cannot be answered.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// SDL's guid for the virtual Xbox 360 pad (vendor 045e, product 028e), as
/// Ryujinx writes it.
const VIRTUAL_PAD: &str = "00000003-045e-0000-8e02-000000007801";

/// Where Ryujinx keeps its settings and games: a `portable` folder next to it,
/// or the `data` folder beside the emulator's that a package points it to.
pub fn data_folder(executable: &Path) -> Option<PathBuf> {
    let directory = executable.parent()?;
    let portable = directory.join("portable");
    if portable.is_dir() {
        return Some(portable);
    }
    std::fs::read_dir(directory.parent()?)
        .ok()?
        .flatten()
        .find(|entry| entry.file_name().to_string_lossy().eq_ignore_ascii_case("data") && entry.path().join("Config.json").is_file())
        .map(|entry| entry.path())
}

fn config_file(executable: &Path) -> Option<PathBuf> {
    let file = match data_folder(executable) {
        Some(folder) => folder.join("Config.json"),
        None => PathBuf::from(std::env::var_os("APPDATA")?).join("Ryujinx/Config.json"),
    };
    file.is_file().then_some(file)
}

/// A Pro Controller on the SDL gamepad `id`, with the Switch's buttons where they sit on it.
fn pad(player: u8, id: &str) -> Value {
    json!({
        "left_joycon_stick": {"joystick": "Left", "invert_stick_x": false, "invert_stick_y": false, "rotate90_cw": false, "stick_button": "LeftStick"},
        "right_joycon_stick": {"joystick": "Right", "invert_stick_x": false, "invert_stick_y": false, "rotate90_cw": false, "stick_button": "RightStick"},
        "deadzone_left": 0.1,
        "deadzone_right": 0.1,
        "range_left": 1.0,
        "range_right": 1.0,
        "trigger_threshold": 0.5,
        "motion": {"motion_backend": "GamepadDriver", "sensitivity": 100, "gyro_deadzone": 1.0, "enable_motion": false},
        "rumble": {"strong_rumble": 1.0, "weak_rumble": 1.0, "enable_rumble": false},
        "left_joycon": {"button_minus": "Back", "button_l": "LeftShoulder", "button_zl": "LeftTrigger", "button_sl": "Unbound", "button_sr": "Unbound", "dpad_up": "DpadUp", "dpad_down": "DpadDown", "dpad_left": "DpadLeft", "dpad_right": "DpadRight"},
        "right_joycon": {"button_plus": "Start", "button_r": "RightShoulder", "button_zr": "RightTrigger", "button_sl": "Unbound", "button_sr": "Unbound", "button_x": "Y", "button_b": "A", "button_y": "X", "button_a": "B"},
        "version": 1,
        "backend": "GamepadSDL2",
        "id": id,
        "controller_type": "ProController",
        "player_index": format!("Player{player}")
    })
}

/// An SDL GUID as Ryujinx writes it: a .NET Guid, whose first three fields are little-endian.
#[cfg_attr(not(windows), allow(dead_code))]
fn guid_text(bytes: [u8; 16]) -> String {
    let [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p] = bytes;
    format!("{d:02x}{c:02x}{b:02x}{a:02x}-{f:02x}{e:02x}-{h:02x}{g:02x}-{i:02x}{j:02x}-{k:02x}{l:02x}{m:02x}{n:02x}{o:02x}{p:02x}")
}

/// Ryujinx's ids for the connected controllers: the GUID, led by how many
/// controllers of the same kind came before.
fn controller_ids(guids: &[String]) -> Vec<String> {
    let mut seen: Vec<&String> = Vec::new();
    guids
        .iter()
        .map(|guid| {
            let before = seen.iter().filter(|other| **other == guid).count();
            seen.push(guid);
            format!("{before}-{guid}")
        })
        .collect()
}

/// `text` with the controllers set up and the dialogs off; `None` when nothing
/// changes. Controllers connected now (`guids`) take the players 1 to 4 that
/// are on the keyboard or on a virtual pad; the other players 2 to 4 get a
/// virtual pad. A player already on a real controller is left as it is.
/// Returns the config and how many changes it made.
fn configure_players(text: &str, guids: &[String], stretch: bool) -> Option<(String, usize)> {
    let mut config: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    config.get_mut("input_config")?.as_array()?;
    let mut changes = 0;
    for key in ["check_updates_on_start", "show_confirm_exit"] {
        if config[key] == true {
            config[key] = false.into();
            changes += 1;
        }
    }
    // The picture fills the window, as it does in the other emulators.
    if stretch && config["aspect_ratio"] != "Stretched" {
        config["aspect_ratio"] = "Stretched".into();
        changes += 1;
    }
    let connected = controller_ids(guids);
    let virtual_base = guids.iter().filter(|guid| *guid == VIRTUAL_PAD).count();
    let inputs = config.get_mut("input_config")?.as_array_mut()?;
    // Ours to change: the keyboard, and virtual pads past the real Xbox 360 pads.
    let ours = |input: &Value| {
        let virtual_slot = input["id"]
            .as_str()
            .and_then(|id| id.split_once('-'))
            .filter(|(_, guid)| *guid == VIRTUAL_PAD)
            .and_then(|(index, _)| index.parse::<usize>().ok())
            .is_some_and(|index| index >= virtual_base);
        input["backend"] == "WindowKeyboard" || virtual_slot
    };
    let mut free: Vec<String> = connected
        .into_iter()
        .filter(|id| !inputs.iter().any(|input| !ours(input) && input["id"] == id.as_str()))
        .collect();
    free.reverse();
    for player in 1..=4u8 {
        let name = format!("Player{player}");
        let position = inputs.iter().position(|input| input["player_index"] == name.as_str());
        if position.is_some_and(|at| !ours(&inputs[at])) {
            continue;
        }
        let wanted = if let Some(id) = free.pop() {
            pad(player, &id)
        } else if player >= 2 {
            pad(player, &format!("{}-{VIRTUAL_PAD}", virtual_base + usize::from(player) - 2))
        } else {
            continue;
        };
        match position {
            Some(at) if inputs[at]["id"] == wanted["id"] && inputs[at]["backend"] == wanted["backend"] => {}
            Some(at) => {
                inputs[at] = wanted;
                changes += 1;
            }
            None => {
                inputs.push(wanted);
                changes += 1;
            }
        }
    }
    (changes > 0).then(|| (serde_json::to_string_pretty(&config).unwrap_or_default(), changes))
}

/// The GUID of each controller connected now, read with the SDL2 that Ryujinx
/// itself ships, so the ids match what it will see.
#[cfg(windows)]
fn connected_controllers(executable: &Path) -> Vec<String> {
    executable
        .parent()
        .map(|directory| directory.join("SDL2.dll"))
        .and_then(|library| crate::in_game::sdl::Sdl::load(&library))
        .map(|sdl| sdl.controller_guids().into_iter().map(guid_text).collect())
        .unwrap_or_default()
}
#[cfg(not(windows))]
fn connected_controllers(_executable: &Path) -> Vec<String> {
    Vec::new()
}

/// Sets up Ryujinx's controls, once per start. Returns how many changes it
/// made. The original is kept next to it the first time.
pub fn connect_players(executable: &Path, stretch: bool) -> Result<usize, String> {
    let Some(file) = config_file(executable) else {
        return Ok(0);
    };
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let Some((fixed, changes)) = configure_players(&text, &connected_controllers(executable), stretch) else {
        return Ok(0);
    };
    let backup = file.with_file_name("Config.json.openretro-backup");
    if !backup.exists() {
        std::fs::copy(&file, &backup).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, fixed).map_err(|e| e.to_string())?;
    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = "{\"version\":32,\"aspect_ratio\":\"Fixed16x9\",\"check_updates_on_start\":true,\"show_confirm_exit\":false,\"input_config\":[{\"backend\":\"WindowKeyboard\",\"id\":\"0\",\"player_index\":\"Player1\"},{\"backend\":\"GamepadSDL2\",\"id\":\"0-x\",\"player_index\":\"Player3\"}]}";
    const DUALSENSE: &str = "00000003-054c-0000-e60c-000000007801";

    fn players(text: &str) -> Vec<(String, String)> {
        let config: Value = serde_json::from_str(text).unwrap();
        config["input_config"]
            .as_array()
            .unwrap()
            .iter()
            .map(|i| (i["player_index"].as_str().unwrap().to_string(), i["id"].as_str().unwrap().to_string()))
            .collect()
    }

    #[test]
    fn guids_are_written_the_way_ryujinx_reads_them() {
        let virtual_pad = [0x03, 0, 0, 0, 0x5e, 0x04, 0, 0, 0x8e, 0x02, 0, 0, 0, 0, 0x78, 0x01];
        assert_eq!(guid_text(virtual_pad), VIRTUAL_PAD);
    }

    #[test]
    fn a_connected_controller_takes_player_one_and_the_rest_get_virtual_pads() {
        let (fixed, changes) = configure_players(CONFIG, &[DUALSENSE.into()], false).unwrap();
        // The update check, Player1, Player2 and Player4 (the exit confirmation is already off).
        assert_eq!(changes, 4);
        let players = players(&fixed);
        assert!(players.contains(&("Player1".into(), format!("0-{DUALSENSE}"))));
        assert!(players.contains(&("Player2".into(), format!("0-{VIRTUAL_PAD}"))));
        // A player on a controller of their own stays as it was.
        assert!(players.contains(&("Player3".into(), "0-x".into())));
        assert_eq!(configure_players(&fixed, &[DUALSENSE.into()], false), None);
    }

    #[test]
    fn stretching_fills_the_window_once() {
        let (fixed, _) = configure_players(CONFIG, &[], true).unwrap();
        assert!(fixed.contains("\"aspect_ratio\": \"Stretched\""));
        assert_eq!(configure_players(&fixed, &[], true), None);
    }

    #[test]
    fn without_a_controller_player_one_keeps_the_keyboard() {
        let (fixed, _) = configure_players(CONFIG, &[], false).unwrap();
        let players = players(&fixed);
        assert!(players.contains(&("Player1".into(), "0".into())));
        assert!(players.contains(&("Player2".into(), format!("0-{VIRTUAL_PAD}"))));
    }

    #[test]
    fn virtual_pads_number_after_a_real_xbox_360_pad() {
        let (fixed, _) = configure_players(CONFIG, &[VIRTUAL_PAD.into()], false).unwrap();
        let players = players(&fixed);
        assert!(players.contains(&("Player1".into(), format!("0-{VIRTUAL_PAD}"))));
        assert!(players.contains(&("Player2".into(), format!("1-{VIRTUAL_PAD}"))));
        // The real pad on player 1 is found again on the next start.
        assert_eq!(configure_players(&fixed, &[VIRTUAL_PAD.into()], false), None);
    }

    #[test]
    fn a_packaged_config_is_fixed_in_place_and_backed_up_once() {
        let root = std::env::temp_dir().join(format!("openretro-ryu-cfg-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("emu")).unwrap();
        std::fs::create_dir_all(root.join("Data")).unwrap();
        std::fs::write(root.join("Data/Config.json"), format!("\u{feff}{CONFIG}")).unwrap();
        let exe = root.join("emu/Ryujinx.exe");
        // Windows has no controller here to read: only the update check and players 2 and 4 change.
        assert_eq!(connect_players(&exe, false), Ok(3));
        assert!(root.join("Data/Config.json.openretro-backup").is_file());
        assert_eq!(connect_players(&exe, false), Ok(0));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
