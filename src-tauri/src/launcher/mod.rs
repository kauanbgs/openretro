use std::{process::Command, time::Instant};
use rusqlite::params;
use tauri::{Manager, Emitter};
use crate::{database::{self, error, Database, Result}, filesystem};

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
 if entry.item.platform_id == "psx" && (bios.is_none() || !entry.item.runtime_args.iter().any(|a|a.contains("{bios}"))) { return Err("Configure your BIOS path and the emulator's BIOS argument before playing.".into()); }
 let mut args:Vec<String>=entry.item.runtime_args.iter().map(|a|a.replace("{game}",&game_path.to_string_lossy()).replace("{bios}",&bios.as_ref().map(|p|p.to_string_lossy().into_owned()).unwrap_or_default())).collect();
 if !entry.item.runtime_args.iter().any(|a|a.contains("{game}")) { args.push(game_path.to_string_lossy().into_owned()); }
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
 if !status.success() { return Err(format!("The emulator exited with code {:?}. Your session was saved. Check its game and BIOS configuration.",status.code())); }
 Ok(elapsed)
 }).await.map_err(error)?
}
