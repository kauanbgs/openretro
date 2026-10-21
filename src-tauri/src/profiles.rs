use crate::database::{error, Database, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct PlayerProfile {
    pub id: String,
    pub name: String,
    pub avatar: String,
    pub color: String,
}

/// New players cycle through the same palette the editor offers.
const COLORS: &[&str] = &[
    "#ff8a3d", "#38bdf8", "#4ade80", "#f472b6", "#a78bfa", "#ffd23f", "#f87171", "#2dd4bf",
];

fn validate(name: &str, avatar: &str, color: &str) -> Result<()> {
    if name.is_empty() || name.chars().count() > 32 {
        return Err("Use um nome entre 1 e 32 caracteres.".into());
    }
    if avatar.is_empty()
        || avatar.len() > 24
        || !avatar.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
    {
        return Err("Avatar inválido.".into());
    }
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Cor inválida.".into());
    }
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profiles {
    pub active_id: String,
    pub players: Vec<PlayerProfile>,
}

pub fn active(conn: &Connection) -> Result<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key='active_profile'",
        [],
        |row| row.get(0),
    )
    .map_err(error)
}

#[tauri::command]
pub fn list_profiles(db: State<Database>) -> Result<Profiles> {
    let conn = db.0.lock().map_err(error)?;
    let mut stmt = conn
        .prepare("SELECT id,name,avatar,color FROM player_profiles ORDER BY rowid")
        .map_err(error)?;
    let players = stmt
        .query_map([], |row| {
            Ok(PlayerProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                avatar: row.get(2)?,
                color: row.get(3)?,
            })
        })
        .map_err(error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(error)?;
    Ok(Profiles {
        active_id: active(&conn)?,
        players,
    })
}

#[tauri::command]
pub fn create_profile(name: String, db: State<Database>) -> Result<()> {
    let name = name.trim();
    let conn = db.0.lock().map_err(error)?;
    let count: usize = conn
        .query_row("SELECT COUNT(*) FROM player_profiles", [], |r| r.get(0))
        .map_err(error)?;
    let color = COLORS[count % COLORS.len()];
    validate(name, "gamepad", color)?;
    conn.execute(
        "INSERT INTO player_profiles(id,name,avatar,color) VALUES(?1,?2,'gamepad',?3)",
        params![uuid::Uuid::new_v4().to_string(), name, color],
    )
    .map_err(error)?;
    Ok(())
}

#[tauri::command]
pub fn update_profile(
    id: String,
    name: String,
    avatar: String,
    color: String,
    db: State<Database>,
) -> Result<()> {
    let name = name.trim();
    let color = color.to_ascii_lowercase();
    validate(name, &avatar, &color)?;
    let conn = db.0.lock().map_err(error)?;
    let changed = conn
        .execute(
            "UPDATE player_profiles SET name=?2,avatar=?3,color=?4 WHERE id=?1",
            params![id, name, avatar, color],
        )
        .map_err(error)?;
    if changed == 0 {
        return Err("Jogador não encontrado.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn select_profile(id: String, db: State<Database>) -> Result<()> {
    let conn = db.0.lock().map_err(error)?;
    if conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM play_sessions WHERE finished_at IS NULL)",
            [],
            |r| r.get::<_, bool>(0),
        )
        .map_err(error)?
    {
        return Err("Encerre o jogo antes de trocar de jogador.".into());
    }
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM player_profiles WHERE id=?1)",
            [&id],
            |r| r.get::<_, bool>(0),
        )
        .map_err(error)?;
    if !exists {
        return Err("Jogador não encontrado.".into());
    }
    conn.execute(
        "UPDATE settings SET value=?1 WHERE key='active_profile'",
        [id],
    )
    .map_err(error)?;
    Ok(())
}

pub fn project_library(
    conn: &Connection,
    entries: &mut [crate::models::LibraryGame],
) -> Result<()> {
    let profile = active(conn)?;
    if profile == "default" {
        return Ok(());
    }
    let mut stmt = conn.prepare("SELECT library_item_id,favorite,last_played_at,playtime FROM player_progress WHERE profile_id=?1").map_err(error)?;
    let progress = stmt
        .query_map([profile], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (
                    r.get::<_, bool>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                ),
            ))
        })
        .map_err(error)?
        .collect::<std::result::Result<std::collections::HashMap<_, _>, _>>()
        .map_err(error)?;
    for entry in entries {
        let (favorite, last_played_at, playtime) =
            progress.get(&entry.item.id).cloned().unwrap_or_default();
        entry.item.favorite = favorite;
        entry.item.playtime = playtime;
        entry.item.last_played_at = last_played_at;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn appearance_is_validated() {
        assert!(super::validate("Ana", "ghost", "#a78bfa").is_ok());
        assert!(super::validate("", "ghost", "#a78bfa").is_err());
        assert!(super::validate("Ana", "../x", "#a78bfa").is_err());
        assert!(super::validate("Ana", "ghost", "red").is_err());
        assert!(super::validate("Ana", "ghost", "#zzzzzz").is_err());
        assert!(super::COLORS
            .iter()
            .all(|color| super::validate("Ana", "gamepad", color).is_ok()));
    }
}
