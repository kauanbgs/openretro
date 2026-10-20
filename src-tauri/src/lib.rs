mod commands;
mod database;
mod downloads;
mod filesystem;
mod launcher;
mod models;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
 tauri::Builder::default()
  .plugin(tauri_plugin_dialog::init())
  .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
  .setup(|app| {
   let dir=app.path().app_data_dir()?; std::fs::create_dir_all(&dir)?;
   let db=database::initialize(&dir.join("openretro.sqlite")).map_err(std::io::Error::other)?; app.manage(db);
   log::info!("OpenRetro initialized; network downloads: {}",downloads::NETWORK_DOWNLOADS_ENABLED); Ok(())
  })
  .invoke_handler(tauri::generate_handler![commands::list_library,commands::list_emulators,commands::inspect_game,commands::file_exists,commands::add_game,commands::remove_game,commands::set_favorite,commands::configure_game,commands::relocate_game,commands::verify_game,commands::save_emulator,commands::remove_emulator,commands::test_emulator,commands::detect_emulators,commands::get_settings,commands::save_settings,commands::app_paths,launcher::launch_game])
  .run(tauri::generate_context!()).expect("OpenRetro failed to start");
}
