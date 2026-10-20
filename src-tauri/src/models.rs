use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadata { pub id: String, pub title: String, pub platform_id: String, pub year: i32, pub developer: String, pub description: String, pub genre: String, pub artwork: String, pub color: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem { pub id: String, pub game_id: String, pub platform_id: String, pub source_provider: String, pub source_path: String, pub emulator_id: Option<String>, pub installed: bool, pub favorite: bool, pub added_at: String, pub last_played_at: Option<String>, pub playtime: i64, pub sha256: String, pub bios_path: Option<String>, pub runtime_args: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryGame { pub game: GameMetadata, pub item: LibraryItem }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Emulator { pub id: String, pub name: String, pub executable_path: String, pub supported_platforms: Vec<String>, pub version: Option<String>, pub default_platforms: Vec<String> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate { pub path: String, pub filename: String, pub sha256: String, pub platform_ids: Vec<String> }
