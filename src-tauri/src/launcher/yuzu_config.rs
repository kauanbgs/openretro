//! yuzu's own controls. A player mapped to OpenRetro's virtual Xbox 360 pad but
//! left unconnected sees nothing, and that checkbox sits where it is easy to
//! miss. Before yuzu starts, every player already mapped to the virtual pad is
//! marked connected. Mappings that point at other devices are never touched.
use std::path::{Path, PathBuf};

/// SDL's id for the virtual Xbox 360 pad (vendor 045e, product 028e).
const VIRTUAL_PAD: &str = "guid:030000005e0400008e02";

/// yuzu's config: next to a portable install, or in the user's profile.
fn config_file(directory: &Path) -> Option<PathBuf> {
    let portable = directory.join("user/config/qt-config.ini");
    if portable.is_file() {
        return Some(portable);
    }
    let profile = std::env::var_os("APPDATA")?;
    ["yuzu", "eden", "citron", "suyu", "sudachi", "torzu"]
        .iter()
        .map(|name| PathBuf::from(&profile).join(name).join("config/qt-config.ini"))
        .find(|path| path.is_file())
}

/// The players (0-based, as yuzu numbers them) mapped to the virtual pad.
fn mapped_players(text: &str) -> Vec<u32> {
    let mut players = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("player_") else {
            continue;
        };
        let Some((number, setting)) = rest.split_once('_') else {
            continue;
        };
        let Ok(number) = number.parse::<u32>() else {
            continue;
        };
        if setting.starts_with("button_") || setting.contains("stick") {
            if line.contains(VIRTUAL_PAD) && !players.contains(&number) {
                players.push(number);
            }
        }
    }
    players
}

/// `text` with those players marked connected; `None` when nothing changes.
fn connect_players(text: &str, players: &[u32]) -> Option<String> {
    let mut changed = false;
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            for player in players {
                if line == format!("player_{player}_connected=false") {
                    changed = true;
                    return format!("player_{player}_connected=true");
                }
                if line == format!("player_{player}_connected\\default=true") {
                    // A value that is not the default is written out and read back.
                    changed = true;
                    return format!("player_{player}_connected\\default=false");
                }
            }
            line.to_string()
        })
        .collect();
    changed.then(|| {
        let ending = if text.contains("\r\n") { "\r\n" } else { "\n" };
        lines.join(ending) + ending
    })
}

/// Marks the players mapped to the virtual pad as connected, once per start.
/// Returns how many it fixed. The original is kept next to it the first time.
pub fn connect_virtual_players(directory: &Path) -> Result<usize, String> {
    let Some(file) = config_file(directory) else {
        return Ok(0);
    };
    let text = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let players = mapped_players(&text);
    let Some(fixed) = connect_players(&text, &players) else {
        return Ok(0);
    };
    let backup = file.with_file_name("qt-config.ini.openretro-backup");
    if !backup.exists() {
        std::fs::copy(&file, &backup).map_err(|e| e.to_string())?;
    }
    std::fs::write(&file, fixed).map_err(|e| e.to_string())?;
    Ok(players.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = "[Controls]
player_0_connected\\default=true
player_0_connected=true
player_0_button_a=\"engine:sdl,port:0,guid:030000004c050000cc09000000016800,button:1\"
player_1_connected\\default=true
player_1_connected=false
player_1_button_a=\"engine:sdl,port:0,guid:030000005e0400008e02000000007801,button:1\"
player_1_lstick=\"axis_x:0,engine:sdl,port:0,guid:030000005e0400008e02000000007801,axis_y:1\"
player_2_connected=false
player_2_button_a=\"engine:keyboard,code:65\"
";

    #[test]
    fn only_players_on_the_virtual_pad_are_connected() {
        assert_eq!(mapped_players(CONFIG), vec![1]);
        let fixed = connect_players(CONFIG, &[1]).unwrap();
        assert!(fixed.contains("player_1_connected=true"));
        assert!(fixed.contains("player_1_connected\\default=false"));
        // The PlayStation pad's player and the keyboard's player stay as they were.
        assert!(fixed.contains("player_2_connected=false"));
        assert!(fixed.contains("player_0_connected\\default=true"));
        assert_eq!(connect_players(&fixed, &[1]), None);
    }

    #[test]
    fn a_portable_config_is_fixed_in_place_and_backed_up_once() {
        let root = std::env::temp_dir().join(format!("openretro-yuzu-cfg-{}", uuid::Uuid::new_v4()));
        let config = root.join("user/config");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(config.join("qt-config.ini"), CONFIG.replace('\n', "\r\n")).unwrap();
        assert_eq!(connect_virtual_players(&root), Ok(1));
        let fixed = std::fs::read_to_string(config.join("qt-config.ini")).unwrap();
        assert!(fixed.contains("player_1_connected=true\r\n"));
        let backup = std::fs::read_to_string(config.join("qt-config.ini.openretro-backup")).unwrap();
        assert!(backup.contains("player_1_connected=false"));
        assert_eq!(connect_virtual_players(&root), Ok(0));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
