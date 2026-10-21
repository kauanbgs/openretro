use crate::{
    database::{self, error, Database, Result},
    filesystem,
};
use rusqlite::params;
use std::{
    io::{Cursor, Read, Write},
    process::Command,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
pub mod runtime_menu;

fn core_name(platform: &str) -> Option<&'static str> {
    Some(match platform {
        "nes" => "mesen_libretro.dll",
        "snes" => "snes9x_libretro.dll",
        "n64" => "mupen64plus_next_libretro.dll",
        "gb" | "gbc" => "sameboy_libretro.dll",
        "gba" => "mgba_libretro.dll",
        "nds" => "melonds_libretro.dll",
        "sms" | "genesis" | "gg" => "genesis_plus_gx_libretro.dll",
        "psx" => "pcsx_rearmed_libretro.dll",
        "psp" => "ppsspp_libretro.dll",
        "arcade" => "fbneo_libretro.dll",
        "dos" => "dosbox_pure_libretro.dll",
        _ => return None,
    })
}
fn retroarch_core(
    app: &tauri::AppHandle,
    executable: &std::path::Path,
    platform: &str,
) -> Result<std::path::PathBuf> {
    let name = core_name(platform)
        .ok_or("This console is not supported by OpenRetro's managed RetroArch runtime.")?;
    let managed = app
        .path()
        .app_data_dir()
        .map_err(error)?
        .join("retroarch")
        .join("cores")
        .join(name);
    if managed.is_file() {
        return Ok(managed);
    }
    let bundled = executable
        .parent()
        .ok_or("Invalid RetroArch path.")?
        .join("cores")
        .join(name);
    if bundled.is_file() {
        return Ok(bundled);
    }
    let url = format!("https://buildbot.libretro.com/nightly/windows/x86_64/latest/{name}.zip");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(error)?;
    let response = client
        .get(&url)
        .send()
        .map_err(|_| {
            "Could not download the RetroArch core. Check your connection and try Play again."
                .to_string()
        })?
        .error_for_status()
        .map_err(|_| {
            "The RetroArch core download is unavailable. Try Play again later.".to_string()
        })?;
    if response
        .content_length()
        .is_some_and(|size| size > 100 * 1024 * 1024)
    {
        return Err("The RetroArch core download is unexpectedly large.".into());
    }
    let mut bytes = Vec::new();
    response
        .take(100 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() > 100 * 1024 * 1024 {
        return Err("The RetroArch core download is unexpectedly large.".into());
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "RetroArch returned an invalid core package.".to_string())?;
    let mut core = archive
        .by_name(name)
        .map_err(|_| "The RetroArch core package is missing its executable.".to_string())?;
    if core.size() > 200 * 1024 * 1024 {
        return Err("The RetroArch core is unexpectedly large.".into());
    }
    let directory = managed.parent().ok_or("Invalid managed core path.")?;
    std::fs::create_dir_all(directory).map_err(error)?;
    let temporary = managed.with_extension("partial");
    let mut output = std::fs::File::create(&temporary).map_err(error)?;
    std::io::copy(&mut core, &mut output).map_err(error)?;
    output.flush().map_err(error)?;
    drop(output);
    std::fs::rename(temporary, &managed).map_err(error)?;
    Ok(managed)
}

#[tauri::command]
pub async fn launch_game(app: tauri::AppHandle, id: String) -> Result<i64> {
    tauri::async_runtime::spawn_blocking(move || {
 let db=app.state::<Database>();
 let (entry,emulator) = {
  let conn=db.0.lock().map_err(error)?;
  let entry = database::library(&conn)?.into_iter().find(|g| g.item.id == id).ok_or("This game is no longer in your library.")?;
  let compatible: Vec<_> = database::emulators(&conn)?.into_iter().filter(|e|e.supported_platforms.contains(&entry.item.platform_id)).collect();
  let emulator=if let Some(preferred)=&entry.item.emulator_id { compatible.iter().find(|e| &e.id==preferred) } else { compatible.iter().find(|e|e.default_platforms.contains(&entry.item.platform_id)).or_else(||compatible.first()) }.cloned().ok_or("Configure a compatible emulator before playing this game.")?;
  (entry,emulator)
 };
 let game_path=filesystem::canonical_file(&entry.item.source_path)?;
 let executable=filesystem::executable(&emulator.executable_path)?;
 let bios=entry.item.bios_path.as_ref().map(|p|filesystem::canonical_file(p)).transpose()?;
 let managed_retroarch=emulator.name.eq_ignore_ascii_case("RetroArch") && entry.item.runtime_args.is_empty();
 if entry.item.platform_id == "psx" && !managed_retroarch && (bios.is_none() || !entry.item.runtime_args.iter().any(|a|a.contains("{bios}"))) { return Err("Configure your BIOS path and the emulator's BIOS argument before playing.".into()); }
 let mut args:Vec<String>=if managed_retroarch {
    let config=runtime_menu::prepare(&app.path().app_data_dir().map_err(error)?, &executable, &entry.item.sha256)?;
    vec!["--fullscreen".into(),"--appendconfig".into(),config.to_string_lossy().into_owned(),"-L".into(),retroarch_core(&app,&executable,&entry.item.platform_id)?.to_string_lossy().into_owned(),game_path.to_string_lossy().into_owned()]
 } else { entry.item.runtime_args.iter().map(|a|a.replace("{game}",&game_path.to_string_lossy()).replace("{bios}",&bios.as_ref().map(|p|p.to_string_lossy().into_owned()).unwrap_or_default())).collect() };
 if !managed_retroarch && !entry.item.runtime_args.iter().any(|a|a.contains("{game}")) { args.push(game_path.to_string_lossy().into_owned()); }
 let session=uuid::Uuid::new_v4().to_string(); let started=chrono::Utc::now().to_rfc3339();
 {
 let mut conn=db.0.lock().map_err(error)?; let tx=conn.transaction().map_err(error)?;
 tx.execute("INSERT INTO play_sessions(id,library_item_id,started_at) VALUES(?1,?2,?3)",params![session,id,started]).map_err(|_|"This game already has an active session. Close it before launching again.".to_string())?;
 tx.commit().map_err(error)?;
 }
 let timer=Instant::now();
 // Command passes each argument directly to the executable. No shell interprets paths or arguments.
 let child=Command::new(&executable).args(&args).current_dir(executable.parent().ok_or("Invalid emulator directory")?).spawn();
 let mut child=match child { Ok(c)=>c,Err(e)=>{ db.0.lock().map_err(error)?.execute("DELETE FROM play_sessions WHERE id=?1",[&session]).map_err(error)?; return Err(format!("The emulator could not be started: {e}. Check its permissions and configuration.")); } };
 db.0.lock().map_err(error)?.execute("UPDATE library_items SET last_played_at=?1 WHERE id=?2",params![started,id]).map_err(error)?;
 let _=app.emit("game-started",&id); log::info!("Started game session {session}");
 let status=child.wait(); let elapsed=timer.elapsed().as_secs() as i64;
 let mut conn=db.0.lock().map_err(error)?; let tx=conn.transaction().map_err(error)?;
 tx.execute("UPDATE play_sessions SET finished_at=?1,duration=?2,exit_code=?3 WHERE id=?4",params![chrono::Utc::now().to_rfc3339(),elapsed,status.as_ref().ok().and_then(|s|s.code()),session]).map_err(error)?;
 tx.execute("UPDATE library_items SET playtime=playtime+?1 WHERE id=?2",params![elapsed,id]).map_err(error)?;
 tx.commit().map_err(error)?; let _=app.emit("game-finished",&id);
 let status=status.map_err(error)?;
 if !status.success() { return Err(format!("The emulator exited with code {}. Your session was saved. Check that the game format, core, and any required BIOS are supported.",status.code().map(|code| code.to_string()).unwrap_or_else(|| "an unknown status".into()))); }
 Ok(elapsed)
 }).await.map_err(error)?
}
