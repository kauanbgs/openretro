mod commands;
mod database;
mod downloads;
mod file_browser;
mod filesystem;
mod in_game;
mod launcher;
mod metadata;
mod models;
mod mods;
mod profiles;
mod remote_play;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Resized(_)) {
                in_game::resize_view(window.app_handle());
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = database::initialize(&dir.join("openretro.sqlite"))
                .map_err(std::io::Error::other)?;
            commands::sync_runtime_platforms(&db).map_err(std::io::Error::other)?;
            #[cfg(windows)]
            commands::register_rpcs3(&db, &dir).map_err(std::io::Error::other)?;
            app.manage(db);
            app.manage(metadata::LaunchboxCatalog::default());
            metadata::start(app.handle());
            app.manage(downloads::DownloadService::default());
            app.manage(downloads::sources::SourceIndex::default());
            app.manage(in_game::InGameService::default());
            app.manage(remote_play::RemotePlay::default());
            app.manage(mods::ModService::default());
            mods::recover(app.handle());
            in_game::setup(app.handle())?;
            #[cfg(windows)]
            {
                // Copying the runtime takes a moment; the window opens meanwhile.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Err(message) = commands::ensure_runtime(&handle) {
                        log::error!("OpenRetro Runtime could not be prepared: {message}");
                    }
                });
            }
            downloads::finish_interrupted(app.handle());
            log::info!(
                "OpenRetro initialized; network downloads: {}",
                downloads::NETWORK_DOWNLOADS_ENABLED
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_browser::browse_files,
            file_browser::read_source_json,
            profiles::list_profiles,
            profiles::create_profile,
            profiles::select_profile,
            profiles::update_profile,
            metadata::catalog_status,
            metadata::catalog_refresh,
            metadata::catalog_genres,
            metadata::catalog_browse,
            metadata::catalog_game,
            metadata::catalog_match,
            metadata::catalog_players,
            metadata::catalog_thumbnail,
            downloads::sources::list_download_sources,
            downloads::sources::save_download_source,
            downloads::sources::set_download_source,
            downloads::sources::remove_download_source,
            downloads::sources::search_download_sources,
            downloads::sources::available_download_titles,
            downloads::start_source_download,
            downloads::list_download_jobs,
            downloads::control_download,
            downloads::remove_download,
            downloads::download_files,
            downloads::add_download_to_library,
            commands::list_library,
            commands::list_emulators,
            commands::emulator_install_options,
            commands::install_emulator,
            commands::inspect_game,
            commands::inspect_game_folder,
            commands::file_exists,
            commands::add_game,
            commands::remove_game,
            commands::set_favorite,
            commands::configure_game,
            commands::relocate_game,
            commands::verify_game,
            commands::save_emulator,
            commands::remove_emulator,
            commands::test_emulator,
            commands::detect_emulators,
            commands::get_settings,
            commands::save_settings,
            commands::app_paths,
            launcher::launch_game,
            launcher::netplay::netplay_local_address,
            remote_play::remote_play_status,
            remote_play::party_configuration,
            remote_play::remote_play_start,
            remote_play::remote_play_stop,
            launcher::runtime_menu::open_game_screenshots,
            launcher::runtime_menu::list_game_screenshots,
            launcher::save_states::list_save_states,
            launcher::bios::runtime_bios_status,
            launcher::bios::install_runtime_bios,
            launcher::save_states::delete_save_state,
            in_game::in_game_status,
            in_game::in_game_action,
            in_game::open_steam_controller_settings,
            mods::mods_overview,
            mods::mods_search_plaza,
            mods::mods_set_plaza_key,
            mods::mods_inspect_patch,
            mods::mods_install,
            mods::mods_jobs,
            mods::mods_cancel,
            mods::mods_dismiss,
            mods::mods_select_variant,
            mods::mods_remove_variant,
            mods::mods_sources,
            mods::mods_add_source,
            mods::mods_set_source,
            mods::mods_remove_source
        ])
        .run(tauri::generate_context!())
        .expect("OpenRetro failed to start");
}
