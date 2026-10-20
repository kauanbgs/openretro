use crate::models::*;
use rusqlite::{params, Connection};
use std::{path::Path, sync::Mutex};
pub struct Database(pub Mutex<Connection>);
pub type Result<T> = std::result::Result<T, String>;
pub fn error(e: impl std::fmt::Display) -> String {
    log::error!("{e}");
    e.to_string()
}
pub fn initialize(path: &Path) -> Result<Database> {
    let mut db = Connection::open(path).map_err(error)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(error)?;
    let tx = db.transaction().map_err(error)?;
    tx.execute_batch(include_str!("001_initial.sql"))
        .map_err(error)?;
    tx.execute_batch(include_str!("002_metadata_cache.sql"))
        .map_err(error)?;
    tx.execute_batch(include_str!("003_download_sources.sql"))
        .map_err(error)?;
    // Restart requires explicit resume, which rechecks the partial files.
    tx.execute("UPDATE download_jobs SET data=json_set(data,'$.state','PAUSED') WHERE json_extract(data,'$.state') IN ('RESOLVING','DOWNLOADING','VERIFYING','QUEUED')", []).map_err(error)?;
    let platforms: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/db/platforms.json")).map_err(error)?;
    for p in platforms.as_array().ok_or("Invalid platform catalog")? {
        tx.execute(
            "INSERT OR REPLACE INTO platforms(id,metadata) VALUES(?1,?2)",
            params![p["id"].as_str(), p.to_string()],
        )
        .map_err(error)?;
    }
    // Interrupted sessions are closed at their last known timestamp, never counted as offline playtime.
    tx.execute(
        "UPDATE play_sessions SET finished_at=started_at WHERE finished_at IS NULL",
        [],
    )
    .map_err(error)?;
    tx.commit().map_err(error)?;
    Ok(Database(Mutex::new(db)))
}
pub fn library(db: &Connection) -> Result<Vec<LibraryGame>> {
    let mut stmt = db.prepare("SELECT g.metadata,l.id,l.game_id,l.platform_id,l.source_provider,l.source_path,l.emulator_id,l.installed,l.favorite,l.added_at,l.last_played_at,l.playtime,l.sha256,l.bios_path,l.runtime_args FROM library_items l JOIN games g ON l.game_id=g.id ORDER BY l.added_at DESC").map_err(error)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                LibraryItem {
                    id: r.get(1)?,
                    game_id: r.get(2)?,
                    platform_id: r.get(3)?,
                    source_provider: r.get(4)?,
                    source_path: r.get(5)?,
                    emulator_id: r.get(6)?,
                    installed: r.get(7)?,
                    favorite: r.get(8)?,
                    added_at: r.get(9)?,
                    last_played_at: r.get(10)?,
                    playtime: r.get(11)?,
                    sha256: r.get(12)?,
                    bios_path: r.get(13)?,
                    runtime_args: serde_json::from_str(&r.get::<_, String>(14)?)
                        .unwrap_or_default(),
                },
            ))
        })
        .map_err(error)?;
    rows.map(|row| {
        let (metadata, item) = row.map_err(error)?;
        Ok(LibraryGame {
            game: serde_json::from_str(&metadata).map_err(error)?,
            item,
        })
    })
    .collect()
}
pub fn emulators(db: &Connection) -> Result<Vec<Emulator>> {
    let mut stmt = db
        .prepare("SELECT data FROM emulators ORDER BY id")
        .map_err(error)?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(error)?;
    rows.map(|r| serde_json::from_str(&r.map_err(error)?).map_err(error))
        .collect()
}
