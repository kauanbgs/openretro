use crate::database::{error, Database, Result};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Read, time::Duration};
use tauri::{Manager, State};

pub const MAX_SOURCE_BYTES: usize = 16 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    pub title: String,
    pub uris: Vec<String>,
    #[serde(default)]
    pub upload_date: String,
    #[serde(default)]
    pub file_size: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct SourceDocument {
    pub name: String,
    pub downloads: Vec<SourceEntry>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSummary {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub enabled: bool,
    pub updated_at: String,
    pub game_count: usize,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMatch {
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    #[serde(flatten)]
    pub entry: SourceEntry,
}
pub fn magnet_hash(uri: &str) -> Result<String> {
    if uri.len() > 16384 {
        return Err("Magnet link is too long.".into());
    }
    let url = reqwest::Url::parse(uri).map_err(|_| "Invalid magnet link.")?;
    if url.scheme() != "magnet" {
        return Err("This download requires a magnet link.".into());
    }
    for (_, value) in url.query_pairs().filter(|(k, _)| k == "xt") {
        if let Some(hash) = value.strip_prefix("urn:btih:") {
            if hash.len() == 40 && hash.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Ok(hash.to_lowercase());
            }
            if hash.len() == 32
                && hash
                    .bytes()
                    .all(|c| c.is_ascii_alphabetic() || (b'2'..=b'7').contains(&c))
            {
                // Normalize base32 and hexadecimal representations to the same infohash.
                let mut bits = 0u32;
                let mut count = 0;
                let mut bytes = Vec::new();
                for c in hash.to_ascii_uppercase().bytes() {
                    let n = if c.is_ascii_uppercase() {
                        c - b'A'
                    } else {
                        c - b'2' + 26
                    };
                    bits = (bits << 5) | n as u32;
                    count += 5;
                    if count >= 8 {
                        count -= 8;
                        bytes.push((bits >> count) as u8);
                    }
                }
                return Ok(bytes.iter().map(|b| format!("{b:02x}")).collect());
            }
        }
    }
    Err("Magnet must include a valid BitTorrent v1 infohash (btih).".into())
}
pub fn entry_id(entry: &SourceEntry) -> String {
    let mut uris = entry.uris.clone();
    uris.sort();
    format!(
        "{:x}",
        Sha256::digest(format!("{}\n{}", entry.title, uris.join("\n")))
    )
}
pub fn parse_document(text: &str) -> Result<SourceDocument> {
    if text.len() > MAX_SOURCE_BYTES {
        return Err("Source exceeds the 16 MB limit.".into());
    }
    let mut doc: SourceDocument = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| {
            "Invalid source JSON. Expected name and a downloads array with title and uris."
        })?;
    doc.name = doc.name.trim().to_string();
    if doc.name.is_empty() || doc.name.len() > 200 || doc.downloads.len() > 100_000 {
        return Err("Invalid source name or too many entries.".into());
    }
    let mut seen = HashSet::new();
    doc.downloads.retain_mut(|e| {
        e.title = e.title.trim().to_string();
        e.uris.retain(|uri| magnet_hash(uri).is_ok());
        e.uris.sort();
        e.uris.dedup();
        !e.title.is_empty()
            && e.title.len() <= 1000
            && e.uris.len() <= 32
            && !e.uris.is_empty()
            && e.upload_date.len() <= 100
            && e.file_size.len() <= 100
            && seen.insert(entry_id(e))
    });
    if doc.downloads.is_empty() {
        return Err("No supported magnet downloads found in this source. Direct links and BitTorrent v2-only magnets are not supported yet.".into());
    }
    Ok(doc)
}
fn fetch_document(url: &str) -> Result<SourceDocument> {
    let url = reqwest::Url::parse(url).map_err(|_| "Enter a valid HTTPS source URL.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Source URL must use HTTPS without embedded credentials.".into());
    }
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || attempt.url().scheme() != "https" {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(error)?;
    let response = client
        .get(url)
        .send()
        .map_err(|_| "Could not fetch source. Check its URL and your connection.")?;
    if !response.status().is_success() {
        return Err(format!(
            "Source returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    let mut text = String::new();
    response
        .take((MAX_SOURCE_BYTES + 1) as u64)
        .read_to_string(&mut text)
        .map_err(|_| "Source must be UTF-8 JSON.")?;
    parse_document(&text)
}
#[tauri::command]
pub fn list_download_sources(db: State<Database>) -> Result<Vec<SourceSummary>> {
    let conn = db.0.lock().map_err(error)?;
    let mut stmt = conn.prepare("SELECT id,name,url,enabled,updated_at,json_array_length(document,'$.downloads') FROM download_sources ORDER BY name").map_err(error)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(SourceSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                url: r.get(2)?,
                enabled: r.get(3)?,
                updated_at: r.get(4)?,
                game_count: r.get(5)?,
            })
        })
        .map_err(error)?;
    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(error)
}
#[tauri::command]
pub async fn save_download_source(
    app: tauri::AppHandle,
    text: Option<String>,
    url: Option<String>,
    id: Option<String>,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let doc = if let Some(text) = text { parse_document(&text)? } else { fetch_document(url.as_deref().ok_or("Provide JSON or an HTTPS URL." )?)? };
        let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let db = app.state::<Database>(); let conn = db.0.lock().map_err(error)?;
        conn.execute("INSERT INTO download_sources(id,name,url,updated_at,document) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,updated_at=excluded.updated_at,document=excluded.document",
            params![id,doc.name,url,chrono::Utc::now().to_rfc3339(),serde_json::to_string(&doc).map_err(error)?]).map_err(|_| "Could not save source. This URL may already be registered.".to_string())?;
        Ok(())
    }).await.map_err(error)?
}
#[tauri::command]
pub fn set_download_source(id: String, enabled: bool, db: State<Database>) -> Result<()> {
    db.0.lock()
        .map_err(error)?
        .execute(
            "UPDATE download_sources SET enabled=?1 WHERE id=?2",
            params![enabled, id],
        )
        .map_err(error)?;
    Ok(())
}
#[tauri::command]
pub fn remove_download_source(id: String, db: State<Database>) -> Result<()> {
    db.0.lock()
        .map_err(error)?
        .execute("DELETE FROM download_sources WHERE id=?1", [id])
        .map_err(error)?;
    Ok(())
}
pub fn all_matches(db: &Database, query: &str) -> Result<Vec<SourceMatch>> {
    let conn = db.0.lock().map_err(error)?;
    let mut stmt = conn
        .prepare("SELECT id,name,document FROM download_sources WHERE enabled=1 ORDER BY name")
        .map_err(error)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(error)?;
    let query = query.trim().to_lowercase();
    let mut matches = Vec::new();
    for row in rows {
        let (source_id, source_name, document) = row.map_err(error)?;
        let doc: SourceDocument = serde_json::from_str(&document).map_err(error)?;
        for entry in doc.downloads {
            if query.is_empty() || entry.title.to_lowercase().contains(&query) {
                matches.push(SourceMatch {
                    id: entry_id(&entry),
                    source_id: source_id.clone(),
                    source_name: source_name.clone(),
                    entry,
                });
            }
        }
    }
    Ok(matches)
}
#[tauri::command]
pub async fn search_download_sources(
    app: tauri::AppHandle,
    query: String,
) -> Result<Vec<SourceMatch>> {
    tauri::async_runtime::spawn_blocking(move || {
        if query.len() > 1000 {
            return Err("Search is too long.".into());
        }
        let mut matches = all_matches(&app.state::<Database>(), &query)?;
        matches.truncate(60);
        Ok(matches)
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    const MAGNET: &str = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789";
    #[test]
    fn parses_hydra_document_and_filters_unsupported() {
        let text = serde_json::json!({"name":"Test", "downloads":[{"title":"Homebrew", "uris":[MAGNET,"https://example.org/file.zip"], "uploadDate":"2026-10-20", "fileSize":"32 KB"}]}).to_string();
        let doc = parse_document(&text).unwrap();
        assert_eq!(doc.downloads[0].uris, vec![MAGNET]);
    }
    #[test]
    fn rejects_invalid_documents_and_magnets() {
        for text in ["{}", "{\"name\":\"x\",\"downloads\":[]}", "<html>"] {
            assert!(parse_document(text).is_err());
        }
        for uri in [
            "magnet:?xt=urn:btih:bad",
            "javascript:alert(1)",
            "https://example.org",
        ] {
            assert!(magnet_hash(uri).is_err());
        }
        assert_eq!(
            magnet_hash("magnet:?xt=urn:btih:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA").unwrap(),
            "0".repeat(40)
        );
    }
    #[test]
    fn deduplicates_entries() {
        let entry = serde_json::json!({"title":"Test","uris":[MAGNET,MAGNET]});
        let doc = parse_document(
            &serde_json::json!({"name":"Test","downloads":[entry,entry]}).to_string(),
        )
        .unwrap();
        assert_eq!(doc.downloads.len(), 1);
        assert_eq!(doc.downloads[0].uris.len(), 1);
    }
}
