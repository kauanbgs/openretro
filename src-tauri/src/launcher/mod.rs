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
pub mod bios;
pub mod netplay;
#[cfg(windows)]
pub mod rpcs3;
pub mod runtime_menu;
pub mod save_states;

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
        "ps2" => "pcsx2_libretro.dll",
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

pub fn select_emulator(
    conn: &rusqlite::Connection,
    entry: &crate::models::LibraryGame,
) -> Result<crate::models::Emulator> {
    let compatible: Vec<_> = database::emulators(conn)?
        .into_iter()
        .filter(|e| e.supported_platforms.contains(&entry.item.platform_id))
        .collect();
    if let Some(preferred) = &entry.item.emulator_id {
        compatible.iter().find(|e| &e.id == preferred)
    } else {
        compatible
            .iter()
            .find(|e| e.default_platforms.contains(&entry.item.platform_id))
            .or_else(|| compatible.first())
    }
    .cloned()
    .ok_or_else(|| "Configure a compatible emulator before playing this game.".into())
}
/// Consoles whose core cannot load a save state while booting.
pub fn boots_without_states(platform: &str) -> bool {
    platform == "ps2"
}
pub fn is_managed_runtime(
    emulator: &crate::models::Emulator,
    entry: &crate::models::LibraryGame,
) -> bool {
    (emulator.id == "openretro-retroarch"
        || emulator.name.eq_ignore_ascii_case("RetroArch")
        || emulator.name.eq_ignore_ascii_case("OpenRetro Runtime"))
        && entry.item.runtime_args.is_empty()
}

/// `slot` starts from a saved state: -1 is the automatic resume state, 0-99 a manual slot.
/// `netplay` hosts or joins an online session instead of playing locally.
#[tauri::command]
pub async fn launch_game(
    app: tauri::AppHandle,
    id: String,
    slot: Option<i32>,
    netplay: Option<netplay::Netplay>,
) -> Result<i64> {
    if slot.is_some_and(|slot| !(-1..=99).contains(&slot)) {
        return Err("Slot de estado inválido.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
 let db=app.state::<Database>();
 let (entry,emulator,player,auto_resume,ps2_resolution,sdl_library) = {
  let conn=db.0.lock().map_err(error)?;
  let entry = database::library(&conn)?.into_iter().find(|g| g.item.id == id).ok_or("This game is no longer in your library.")?;
  let emulator=select_emulator(&conn,&entry)?;
  let player=crate::profiles::active(&conn)?;
  let settings: String=conn.query_row("SELECT value FROM settings WHERE key='app'",[],|r|r.get(0)).unwrap_or_default();
  let settings=serde_json::from_str::<serde_json::Value>(&settings).ok();
  let auto_resume=settings.as_ref().and_then(|v|v["autoResume"].as_bool()).unwrap_or(true);
  let ps2_resolution=settings.as_ref().and_then(|v|v["ps2Resolution"].as_str().map(String::from));
  // The runtime's SDL2 tells which controllers are connected.
  let sdl_library=database::emulators(&conn)?.into_iter().find(|e|e.id=="openretro-retroarch").and_then(|e|std::path::Path::new(&e.executable_path).parent().map(|dir|dir.join("SDL2.dll")));
  (entry,emulator,player,auto_resume,ps2_resolution,sdl_library)
 };
 let game_path=filesystem::canonical_file(&entry.item.source_path)?;
 // PS3 games install their emulator, system software and disc keys on first use.
 let ps3=emulator.id=="openretro-rpcs3";
 #[cfg(windows)]
 if ps3 {
    let ready=rpcs3::prepare(&app).and_then(|_|rpcs3::ensure_disc_key(&app,&game_path));
    // An empty message closes the setup screen, whatever happened.
    let _=app.emit("ps3-setup","");
    ready?;
 }
 #[cfg(not(windows))]
 if ps3 { return Err("Jogos de PS3 só rodam no Windows por enquanto.".into()); }
 let executable=filesystem::executable(&emulator.executable_path)?;
 let bios=entry.item.bios_path.as_ref().map(|p|filesystem::canonical_file(p)).transpose()?;
 let managed_retroarch=is_managed_runtime(&emulator,&entry);
 if slot.is_some() && !managed_retroarch { return Err("Estados salvos só podem ser abertos pelo OpenRetro Runtime.".into()); }
 if let Some(netplay)=&netplay {
    if !managed_retroarch { return Err("O jogo online só funciona no OpenRetro Runtime.".into()); }
    netplay.validate(&entry.item.platform_id)?;
    netplay.check_host()?;
    // Players who join receive the host's state, so they never load or save their own.
    if !netplay.hosting() && slot.is_some() { return Err("Quem entra na partida joga a partir do estado de quem hospeda.".into()); }
 }
 let joining=netplay.as_ref().is_some_and(|n| !n.hosting());
 // The PS2 core renders black when a state loads during boot, and saving on
 // exit would then store that black state; its states load from the game menu.
 let boot_states=!boots_without_states(&entry.item.platform_id);
 if slot.is_some() && !boot_states { return Err("No PS2, carregue o estado pelo menu do jogo depois que ele abrir.".into()); }
 if managed_retroarch && bios::required(&entry.item.platform_id) && !bios::installed(&bios::system_dir(&app.path().app_data_dir().map_err(error)?), &entry.item.platform_id) { return Err("Este console precisa da BIOS. Selecione o arquivo da BIOS na página do jogo ou em Emuladores.".into()); }
 let runtime_session=if managed_retroarch || ps3 { Some(crate::in_game::reserve(&app, &id, &entry.game.title, slot.unwrap_or(0).max(0))?) } else { None };
 // An app update can ship a newer runtime; copy it before launching so the in-game menu matches it.
 #[cfg(windows)]
 if emulator.id=="openretro-retroarch" { if let Err(message)=crate::commands::install_bundled_retroarch(&app) { log::warn!("Keeping the installed runtime: {message}"); } }
 if entry.item.platform_id == "psx" && !managed_retroarch && (bios.is_none() || !entry.item.runtime_args.iter().any(|a|a.contains("{bios}"))) { return Err("Configure your BIOS path and the emulator's BIOS argument before playing.".into()); }
 if managed_retroarch && entry.item.platform_id=="ps2" {
    runtime_menu::set_core_options(executable.parent().ok_or("Invalid RetroArch directory.")?, "LRPS2", &runtime_menu::ps2_options(ps2_resolution.as_deref(), num_cpus::get_physical()))?;
 }
 let mut args:Vec<String>=if managed_retroarch {
    let config=runtime_menu::prepare_player(&app.path().app_data_dir().map_err(error)?, &executable, &entry.item.sha256, &player, auto_resume && boot_states && !joining, (auto_resume || slot==Some(-1)) && boot_states && !joining)?;
    let mut args:Vec<String>=vec!["--appendconfig".into(),config.to_string_lossy().into_owned()];
    if let Some(netplay)=&netplay {
      let mut file=std::fs::OpenOptions::new().append(true).open(&config).map_err(error)?;
      file.write_all(netplay.config().as_bytes()).map_err(error)?;
      args.extend(netplay.args()?);
    }
    // An entry slot makes the runtime skip its automatic state and adopt that slot.
    if let Some(slot)=slot.filter(|slot| *slot>=0) { args.extend(["--entryslot".into(),slot.to_string()]); }
    args.extend(["-L".into(),retroarch_core(&app,&executable,&entry.item.platform_id)?.to_string_lossy().into_owned(),game_path.to_string_lossy().into_owned()]);
    args
 } else if ps3 {
    #[cfg(windows)]
    { rpcs3::launch_args(executable.parent().ok_or("Invalid RPCS3 directory.")?, sdl_library.as_deref(), &game_path)? }
    #[cfg(not(windows))]
    { let _=&sdl_library; unreachable!() }
 } else { entry.item.runtime_args.iter().map(|a|a.replace("{game}",&game_path.to_string_lossy()).replace("{bios}",&bios.as_ref().map(|p|p.to_string_lossy().into_owned()).unwrap_or_default())).collect() };
 if !managed_retroarch && !ps3 && !entry.item.runtime_args.iter().any(|a|a.contains("{game}")) { args.push(game_path.to_string_lossy().into_owned()); }
 let session=uuid::Uuid::new_v4().to_string(); let started=chrono::Utc::now().to_rfc3339();
 {
 let mut conn=db.0.lock().map_err(error)?; let tx=conn.transaction().map_err(error)?;
 tx.execute("INSERT INTO play_sessions(id,library_item_id,started_at) VALUES(?1,?2,?3)",params![session,id,started]).map_err(|_|"This game already has an active session. Close it before launching again.".to_string())?;
 tx.commit().map_err(error)?;
 }
 let timer=Instant::now();
 // Command passes each argument directly to the executable. No shell interprets paths or arguments.
 let child=Command::new(&executable).args(&args).stdin(if managed_retroarch { std::process::Stdio::piped() } else { std::process::Stdio::inherit() }).current_dir(executable.parent().ok_or("Invalid emulator directory")?).spawn();
 let mut child=match child { Ok(c)=>c,Err(e)=>{ db.0.lock().map_err(error)?.execute("DELETE FROM play_sessions WHERE id=?1",[&session]).map_err(error)?; return Err(format!("The emulator could not be started: {e}. Check its permissions and configuration.")); } };
 if let Some(runtime_session)=&runtime_session {
    // Both play inside OpenRetro's window; only the runtime takes commands.
    let hosted=if ps3 { runtime_session.host(child.id()) } else if let Some(stdin)=child.stdin.take() { runtime_session.attach(stdin,child.id(),&executable) } else { Ok(()) };
    if let Err(message)=hosted {
      let _=child.kill();
      let _=child.wait();
      db.0.lock().map_err(error)?.execute("DELETE FROM play_sessions WHERE id=?1",[&session]).map_err(error)?;
      return Err(message);
    }
 }
 {
 let conn=db.0.lock().map_err(error)?;
 if player=="default" { conn.execute("UPDATE library_items SET last_played_at=?1 WHERE id=?2",params![started,id]).map_err(error)?; }
 else { conn.execute("INSERT INTO player_progress(profile_id,library_item_id,last_played_at) VALUES(?1,?2,?3) ON CONFLICT(profile_id,library_item_id) DO UPDATE SET last_played_at=excluded.last_played_at",params![player,id,started]).map_err(error)?; }
 }
 let _=app.emit("game-started",&id); log::info!("Started game session {session}");
 let status=child.wait(); let elapsed=timer.elapsed().as_secs() as i64;
 let mut conn=db.0.lock().map_err(error)?; let tx=conn.transaction().map_err(error)?;
 tx.execute("UPDATE play_sessions SET finished_at=?1,duration=?2,exit_code=?3 WHERE id=?4",params![chrono::Utc::now().to_rfc3339(),elapsed,status.as_ref().ok().and_then(|s|s.code()),session]).map_err(error)?;
 if player=="default" { tx.execute("UPDATE library_items SET playtime=playtime+?1 WHERE id=?2",params![elapsed,id]).map_err(error)?; }
 else { tx.execute("UPDATE player_progress SET playtime=playtime+?1 WHERE profile_id=?2 AND library_item_id=?3",params![elapsed,player,id]).map_err(error)?; }
 tx.commit().map_err(error)?; let _=app.emit("game-finished",&id);
 let status=status.map_err(error)?;
 // RPCS3 can report an error code while shutting down after a normal exit.
 if !status.success() && !ps3 { return Err(format!("The emulator exited with code {}. Your session was saved. Check that the game format, core, and any required BIOS are supported.",status.code().map(|code| code.to_string()).unwrap_or_else(|| "an unknown status".into()))); }
 Ok(elapsed)
 }).await.map_err(error)?
}
