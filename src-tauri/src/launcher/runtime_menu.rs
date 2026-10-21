use crate::database::{error, Result};
use std::path::{Path, PathBuf};
use tauri::Manager;

#[tauri::command]
pub fn open_game_screenshots(app: tauri::AppHandle, id: String) -> Result<()> {
    let database = app.state::<crate::database::Database>();
    let game = {
        let connection = database.0.lock().map_err(error)?;
        crate::database::library(&connection)?
            .into_iter()
            .find(|entry| entry.item.id == id)
            .ok_or("This game is no longer in your library.")?
    };
    let directory = screenshots_directory(
        &app.path().app_data_dir().map_err(error)?,
        &game.item.sha256,
    )?;
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    if let Some(window) = app.get_webview_window("game-menu") {
        window.set_always_on_top(false).map_err(error)?;
    }
    command.arg(directory).spawn().map_err(error)?;
    Ok(())
}

fn screenshots_directory(data: &Path, hash: &str) -> Result<PathBuf> {
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("The game fingerprint is invalid. Import the game again.".into());
    }
    let directory = data.join("screenshots").join(hash);
    std::fs::create_dir_all(&directory).map_err(error)?;
    Ok(directory)
}

/// Generated append-configs are private to OpenRetro; the user's RetroArch config
/// and existing cartridge saves remain untouched.
pub fn prepare(data: &Path, executable: &Path, hash: &str) -> Result<PathBuf> {
    let screenshots = screenshots_directory(data, hash)?;
    let runtime = executable.parent().ok_or("Invalid RetroArch directory.")?;
    let directory = data.join("runtime-config");
    std::fs::create_dir_all(&directory).map_err(error)?;
    let profiles = directory.join("autoconfig").join("sdl2");
    std::fs::create_dir_all(&profiles).map_err(error)?;
    // SDL's standardized controller layout: Guide/PS = 5, Share = 4,
    // Options = 6. Do not apply a DirectInput index to an SDL controller.
    for (name, product) in [
        ("PS4 Controller", 1476),
        ("PS4 Controller", 2508),
        ("Wireless Controller", 1476),
        ("Wireless Controller", 2508),
    ] {
        let profile = format!("input_driver = \"sdl2\"\ninput_device = \"{name}\"\ninput_vendor_id = \"1356\"\ninput_product_id = \"{product}\"\n{}", controller_bindings());
        std::fs::write(
            profiles.join(format!("openretro-{name}-{product}.cfg")),
            profile,
        )
        .map_err(error)?;
    }
    let config = directory.join(format!("{hash}.cfg"));
    std::fs::write(
        &config,
        render(
            runtime,
            &screenshots,
            profiles.parent().ok_or("Invalid controller directory.")?,
        ),
    )
    .map_err(error)?;
    Ok(config)
}

pub fn prepare_player(
    data: &Path,
    executable: &Path,
    hash: &str,
    player: &str,
    auto_resume: bool,
) -> Result<PathBuf> {
    if player != "default" && uuid::Uuid::parse_str(player).is_err() {
        return Err("Perfil de jogador inválido.".into());
    }
    let base = prepare(data, executable, hash)?;
    let mut config = std::fs::read_to_string(base).map_err(error)?;
    config.push_str(&format!("savestate_auto_save = \"{auto_resume}\"\nsavestate_auto_load = \"{auto_resume}\"\ninput_max_users = \"4\"\n"));
    for port in 1..=4 {
        config.push_str(&format!(
            "input_player{port}_joypad_index = \"{}\"\n",
            port - 1
        ));
    }
    // Existing saves and custom paths remain with the original player. New
    // players get isolated paths, including per-game separation for same names.
    if player != "default" {
        let root = data.join("players").join(player).join(hash);
        for (key, folder) in [
            ("savefile_directory", "saves"),
            ("savestate_directory", "states"),
        ] {
            let path = root.join(folder);
            std::fs::create_dir_all(&path).map_err(error)?;
            config.push_str(&format!("{key} = \"{}\"\n", quoted_path(&path)));
        }
    }
    let path = data
        .join("runtime-config")
        .join(format!("{player}-{hash}.cfg"));
    std::fs::write(&path, config).map_err(error)?;
    Ok(path)
}

fn quoted_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .replace(['\n', '\r', '"'], "")
}

fn controller_bindings() -> &'static str {
    "input_b_btn = \"0\"\ninput_a_btn = \"1\"\ninput_y_btn = \"2\"\ninput_x_btn = \"3\"\ninput_select_btn = \"4\"\ninput_start_btn = \"6\"\ninput_l3_btn = \"7\"\ninput_r3_btn = \"8\"\ninput_l_btn = \"9\"\ninput_r_btn = \"10\"\ninput_up_btn = \"11\"\ninput_down_btn = \"12\"\ninput_left_btn = \"13\"\ninput_right_btn = \"14\"\ninput_l_x_plus_axis = \"+0\"\ninput_l_x_minus_axis = \"-0\"\ninput_l_y_plus_axis = \"+1\"\ninput_l_y_minus_axis = \"-1\"\ninput_r_x_plus_axis = \"+2\"\ninput_r_x_minus_axis = \"-2\"\ninput_r_y_plus_axis = \"+3\"\ninput_r_y_minus_axis = \"-3\"\ninput_l2_axis = \"+4\"\ninput_r2_axis = \"+5\"\ninput_menu_toggle_btn = \"5\"\ninput_menu_toggle_btn_label = \"PS\"\n"
}

fn render(runtime: &Path, screenshots: &Path, profiles: &Path) -> String {
    let mut config = String::from(
        r#"# OpenRetro in-game controls. Regenerated on launch.
config_save_on_exit = "false"
video_fullscreen = "false"
video_windowed_fullscreen = "false"
video_window_show_decorations = "false"
input_joypad_driver = "sdl2"
input_autodetect_enable = "true"
input_menu_toggle = "nul"
input_menu_toggle_btn = "999"
input_enable_hotkey = "nul"
input_enable_hotkey_btn = "nul"
input_menu_toggle_gamepad_combo = "0"
input_quit_gamepad_combo = "0"
all_users_control_menu = "true"
menu_pause_libretro = "true"
pause_nonactive = "false"
stdin_cmd_enable = "true"
network_cmd_enable = "false"
state_slot = "0"
input_pause_toggle = "nul"
menu_savestate_resume = "false"
menu_mouse_enable = "true"
menu_show_advanced_settings = "false"
menu_show_online_updater = "false"
menu_show_load_core = "false"
menu_show_load_content = "false"
menu_show_load_disc = "false"
menu_show_configurations = "false"
menu_show_quit_retroarch = "true"
quick_menu_show_resume_content = "true"
quick_menu_show_restart_content = "true"
quick_menu_show_close_content = "true"
quick_menu_show_savestate_submenu = "false"
quick_menu_show_save_load_state = "true"
quick_menu_show_undo_save_load_state = "true"
quick_menu_show_take_screenshot = "true"
quick_menu_show_options = "false"
quick_menu_show_controls = "true"
quick_menu_show_cheats = "false"
quick_menu_show_shaders = "false"
quick_menu_show_add_to_favorites = "false"
quick_menu_show_add_to_playlist = "false"
quick_menu_show_start_recording = "false"
quick_menu_show_start_streaming = "false"
quick_menu_show_replay = "false"
quick_menu_show_save_core_overrides = "false"
quick_menu_show_save_content_dir_overrides = "false"
quick_menu_show_save_game_overrides = "false"
quick_menu_show_information = "false"
quick_menu_show_download_thumbnails = "false"
quit_on_close_content = "1"
quit_press_twice = "true"
user_language = "7"
autosave_interval = "10"
savestate_thumbnail_enable = "true"
input_save_state = "f2"
input_load_state = "f4"
input_screenshot = "f8"
input_state_slot_increase = "f7"
input_state_slot_decrease = "f6"
"#,
    );
    // Preserve the runtime's normal autoconfig library (Xbox, 8BitDo, etc.)
    // when supplied. The bundled SDL profiles are a fallback for small runtimes.
    let supplied = runtime.join("autoconfig");
    let autoconfig = if supplied
        .join("sdl2")
        .read_dir()
        .is_ok_and(|mut entries| entries.next().is_some())
    {
        supplied
    } else {
        profiles.to_path_buf()
    };
    config.push_str(&format!(
        "joypad_autoconfig_dir = \"{}\"\nscreenshot_directory = \"{}\"\n",
        quoted_path(&autoconfig),
        quoted_path(screenshots)
    ));
    let assets = runtime.join("assets");
    if assets.join("ozone").join("regular.ttf").is_file() {
        config.push_str(&format!(
            "menu_driver = \"ozone\"\nozone_menu_color_theme = \"1\"\nassets_directory = \"{}\"\n",
            quoted_path(&assets)
        ));
    } else {
        // The built-in menu works even if no optional font/assets pack exists.
        config.push_str("menu_driver = \"rgui\"\n");
    }
    config
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn player_saves_are_isolated_and_resume_can_be_disabled() {
        let root = std::env::temp_dir().join(format!("openretro-player-{}", uuid::Uuid::new_v4()));
        let hash = "a".repeat(64);
        let player = uuid::Uuid::new_v4().to_string();
        let path =
            prepare_player(&root, &root.join("retroarch.exe"), &hash, &player, true).unwrap();
        let text = std::fs::read_to_string(path).unwrap();
        assert!(text.contains("savestate_auto_save = \"true\""));
        assert!(text.contains("savestate_auto_load = \"true\""));
        assert!(text.contains(&format!("players/{player}/{hash}/saves")));
        assert!(text.contains(&format!("players/{player}/{hash}/states")));
        assert!(text.contains("input_player4_joypad_index = \"3\""));
        let default =
            prepare_player(&root, &root.join("retroarch.exe"), &hash, "default", false).unwrap();
        let text = std::fs::read_to_string(default).unwrap();
        assert!(text.contains("savestate_auto_load = \"false\""));
        assert!(!text.contains("savefile_directory"));
        assert!(!text.contains("savestate_directory"));
        assert!(prepare_player(
            &root,
            &root.join("retroarch.exe"),
            &hash,
            "../outside",
            true
        )
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn prepares_private_config_without_changing_existing_saves() {
        let root = std::env::temp_dir().join(format!("openretro-menu-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("runtime")).unwrap();
        let original = root.join("runtime/retroarch.cfg");
        std::fs::write(&original, "savefile_directory = \"custom\"\n").unwrap();
        let hash = "a".repeat(64);
        let config = prepare(
            &root.join("data"),
            &root.join("runtime/retroarch.exe"),
            &hash,
        )
        .unwrap();
        let text = std::fs::read_to_string(config).unwrap();
        assert!(text.contains("video_fullscreen = \"false\""));
        assert!(text.contains("input_menu_toggle_gamepad_combo = \"0\""));
        assert!(text.contains("stdin_cmd_enable = \"true\""));
        assert!(text.contains("network_cmd_enable = \"false\""));
        assert!(text.contains("menu_pause_libretro = \"true\""));
        assert!(text.contains("menu_driver = \"rgui\""));
        assert!(!text.contains("savefile_directory"));
        assert!(!text.contains("savestate_directory"));
        assert_eq!(
            std::fs::read_to_string(original).unwrap(),
            "savefile_directory = \"custom\"\n"
        );
        assert!(root.join("data/screenshots").join(hash).is_dir());
        let second_hash = "b".repeat(64);
        let second = prepare(
            &root.join("data"),
            &root.join("runtime/retroarch.exe"),
            &second_hash,
        )
        .unwrap();
        assert!(std::fs::read_to_string(second)
            .unwrap()
            .contains(&second_hash));
        assert!(!text.contains(&second_hash));
        assert!(prepare(
            &root.join("data"),
            &root.join("runtime/retroarch.exe"),
            "../outside"
        )
        .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
