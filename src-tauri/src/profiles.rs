//! OpenRetro has one local player; the account is the player's identity
//! online. Earlier versions let several players share a PC: their progress
//! is dropped by migration 009 and their files by `retire_players`.
use std::path::Path;

/// The single player, as tables and folders keyed by player name it.
pub const PLAYER: &str = "default";

/// Deletes what extra players of earlier versions left on disk: their saves,
/// states and PS2 memory cards, their saves of modified versions, and their
/// runtime settings. Jogador 1's files are never touched.
pub fn retire_players(data: &Path) {
    let _ = std::fs::remove_dir_all(data.join("players"));
    for variant in read_dir(&data.join("mods").join("saves")) {
        for player in read_dir(&variant) {
            if player.file_name().is_some_and(|name| name != PLAYER) {
                let _ = std::fs::remove_dir_all(player);
            }
        }
    }
    let prefix = format!("{PLAYER}-");
    for config in read_dir(&data.join("runtime-config")) {
        let name = config.file_name().and_then(|n| n.to_str()).unwrap_or_default();
        // Base settings are "<hash>.cfg"; each player's are "<player>-<hash>.cfg".
        if name.contains('-') && !name.starts_with(&prefix) {
            let _ = std::fs::remove_file(config);
        }
    }
}

fn read_dir(path: &Path) -> Vec<std::path::PathBuf> {
    std::fs::read_dir(path)
        .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn retiring_players_keeps_only_the_first_players_files() {
        let root = std::env::temp_dir().join(format!("openretro-retire-{}", uuid::Uuid::new_v4()));
        let other = uuid::Uuid::new_v4().to_string();
        let hash = "a".repeat(64);
        let variant = root.join("mods").join("saves").join("v1");
        for dir in [
            root.join("players").join(&other).join("states"),
            variant.join(super::PLAYER),
            variant.join(&other),
            root.join("runtime-config"),
        ] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let config = root.join("runtime-config");
        for name in [format!("{hash}.cfg"), format!("default-{hash}.cfg"), format!("{other}-{hash}.cfg")] {
            std::fs::write(config.join(name), "").unwrap();
        }
        super::retire_players(&root);
        assert!(!root.join("players").exists());
        assert!(variant.join(super::PLAYER).exists());
        assert!(!variant.join(&other).exists());
        assert!(config.join(format!("{hash}.cfg")).exists());
        assert!(config.join(format!("default-{hash}.cfg")).exists());
        assert!(!config.join(format!("{other}-{hash}.cfg")).exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
