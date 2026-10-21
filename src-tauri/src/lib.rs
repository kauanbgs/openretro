mod commands;
mod database;
mod downloads;
mod filesystem;
mod launcher;
mod metadata;
mod models;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            app.manage(db);
            app.manage(metadata::CatalogService::default());
            app.manage(downloads::DownloadService::default());
            log::info!(
                "OpenRetro initialized; network downloads: {}",
                downloads::NETWORK_DOWNLOADS_ENABLED
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            metadata::igdb_status,
            metadata::igdb_query,
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
            launcher::launch_game
        ])
        .run(tauri::generate_context!())
        .expect("OpenRetro failed to start");
}
