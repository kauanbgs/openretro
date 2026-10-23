//! Romhack Plaza through its public API (https://romhackplaza.org/api/v1).
//! The API needs each player's own key and allows 30 requests a minute, and 5
//! downloads a minute for occasional use; scraping the site is not allowed.
//! OpenRetro therefore only calls the API with the player's key, paces its
//! requests below those limits and never mirrors files.
use super::catalog::{Entry, GameMatch, Hashes, PatchFile};
use crate::database::{error, Result};
use serde::Deserialize;
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};

pub const SOURCE_ID: &str = "romhackplaza";
pub const SOURCE_NAME: &str = "Romhack Plaza";
const API: &str = "https://romhackplaza.org/api/v1";
const SITE: &str = "https://romhackplaza.org";
const REQUESTS_PER_MINUTE: usize = 25;
const DOWNLOADS_PER_MINUTE: usize = 4;
const DETAILS_PER_SEARCH: usize = 8;
const CACHE_FOR: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub struct Client {
    requests: Mutex<VecDeque<Instant>>,
    downloads: Mutex<VecDeque<Instant>>,
    cache: Mutex<HashMap<String, (Instant, serde_json::Value)>>,
}

#[derive(Deserialize)]
struct Envelope<T> {
    #[serde(default)]
    ok: Option<bool>,
    data: T,
}
#[derive(Deserialize)]
struct SearchItem {
    id: u64,
    #[serde(rename = "type")]
    kind: String,
}
#[derive(Default, Deserialize)]
struct Named {
    #[serde(default)]
    name: String,
}
#[derive(Deserialize)]
struct Gallery {
    image: String,
}
#[derive(Deserialize)]
struct HashItem {
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    hash_crc32: Option<String>,
    #[serde(default)]
    hash_sha1: Option<String>,
}
#[derive(Deserialize)]
struct Credit {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
}
#[derive(Deserialize)]
pub struct Details {
    id: u64,
    #[serde(rename = "type")]
    kind: String,
    title: String,
    #[serde(default)]
    complete_title: Option<String>,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    main_image: Option<String>,
    #[serde(default)]
    game: Option<Named>,
    #[serde(default)]
    platform: Option<Named>,
    #[serde(default)]
    authors: Vec<Named>,
    #[serde(default)]
    galleries: Option<Vec<Gallery>>,
    #[serde(default)]
    hashes: Option<Vec<HashItem>>,
    #[serde(default)]
    languages: Option<Vec<Named>>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    staff_credits: Option<Vec<Credit>>,
    #[serde(default)]
    relevant_link: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct EntryFile {
    pub filename: String,
    #[serde(default)]
    pub filesize: Option<u64>,
    pub download: String,
}

/// An entry with every original file it accepts; Romhack Plaza lists one
/// hash per supported file, and any of them makes the patch applicable.
pub struct Found {
    pub entry: Entry,
    pub bases: Vec<Hashes>,
}

/// Romhack Plaza names consoles in words; only names that clearly mean one
/// OpenRetro platform are mapped, the rest stay unknown.
pub fn platform_id(name: &str) -> Option<&'static str> {
    let name = super::catalog::normalize_title(name);
    Some(match name.as_str() {
        "nes" | "nintendo entertainment system" | "famicom" | "nintendo famicom" => "nes",
        "snes" | "super nintendo" | "super nintendo entertainment system" | "super famicom" => {
            "snes"
        }
        "nintendo 64" | "n64" => "n64",
        "game boy" | "gameboy" => "gb",
        "game boy color" | "gameboy color" => "gbc",
        "game boy advance" | "gameboy advance" | "gba" => "gba",
        "nintendo ds" | "nds" => "nds",
        "master system" | "sega master system" => "sms",
        "mega drive"
        | "genesis"
        | "sega genesis"
        | "sega mega drive"
        | "mega drive genesis"
        | "sega genesis mega drive" => "genesis",
        "game gear" | "sega game gear" => "gg",
        "playstation" | "sony playstation" | "playstation 1" | "ps1" | "psx" => "psx",
        "playstation portable" | "psp" | "sony playstation portable" => "psp",
        "playstation 2" | "ps2" | "sony playstation 2" => "ps2",
        _ => return None,
    })
}

fn strip_markup(text: &str) -> String {
    let mut plain = String::with_capacity(text.len());
    let mut depth = 0u32;
    for c in text.chars() {
        match c {
            '<' | '[' => depth += 1,
            '>' | ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => plain.push(c),
            _ => {}
        }
    }
    let plain = plain
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    let words: Vec<&str> = plain.split_whitespace().collect();
    let mut joined = words.join(" ");
    if joined.chars().count() > 1500 {
        joined = joined.chars().take(1500).collect::<String>() + "…";
    }
    joined
}
fn image_url(value: &str) -> Option<String> {
    if value.starts_with("https://") {
        Some(value.into())
    } else if value.starts_with('/') && !value.starts_with("//") {
        Some(format!("{SITE}{value}"))
    } else {
        None
    }
}
fn hex(value: &Option<String>, length: usize) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| v.len() == length && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(str::to_ascii_lowercase)
}

impl Details {
    pub fn into_found(self) -> Option<Found> {
        let kind = match self.kind.as_str() {
            "translations" | "translation" => "translation",
            "romhacks" | "romhack" => "romhack",
            _ => return None,
        };
        let mut requirements: Vec<String> = Vec::new();
        for (index, item) in self.hashes.iter().flatten().enumerate() {
            if let Some(name) = &item.filename {
                requirements.push(format!("Arquivo original {}: {name}", index + 1));
            }
        }
        requirements.push("Baixado com a sua chave de API do Romhack Plaza".into());
        let bases: Vec<Hashes> = self
            .hashes
            .unwrap_or_default()
            .iter()
            .map(|h| Hashes {
                sha1: hex(&h.hash_sha1, 40),
                crc32: hex(&h.hash_crc32, 8),
                ..Default::default()
            })
            .filter(|h| !h.is_empty())
            .collect();
        let platform = self.platform.map(|p| p.name).unwrap_or_default();
        let mut images: Vec<String> = self
            .main_image
            .as_deref()
            .and_then(image_url)
            .into_iter()
            .collect();
        images.extend(
            self.galleries
                .unwrap_or_default()
                .iter()
                .filter_map(|g| image_url(&g.image)),
        );
        images.dedup();
        images.truncate(8);
        let mut authors: Vec<String> = self
            .authors
            .into_iter()
            .map(|a| a.name.trim().to_string())
            .filter(|n| !n.is_empty())
            .collect();
        if authors.is_empty() {
            authors.push("Autor não informado no Romhack Plaza".into());
        }
        let credits = self
            .staff_credits
            .unwrap_or_default()
            .into_iter()
            .filter(|c| !c.name.trim().is_empty())
            .map(|c| {
                if c.description.trim().is_empty() {
                    c.name
                } else {
                    format!("{}: {}", c.name, c.description)
                }
            })
            .collect();
        let languages: Vec<String> = self
            .languages
            .unwrap_or_default()
            .into_iter()
            .map(|l| l.name)
            .filter(|l| !l.is_empty())
            .collect();
        let slug = self.slug.clone().unwrap_or_default();
        let section = if kind == "translation" {
            "translations"
        } else {
            "romhacks"
        };
        let source_url =
            if slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') && !slug.is_empty() {
                format!("{SITE}/{section}/{slug}")
            } else {
                self.relevant_link
                    .clone()
                    .filter(|l| l.starts_with("https://"))
                    .unwrap_or_else(|| SITE.into())
            };
        let entry = Entry {
            id: format!("{SOURCE_ID}.{}", self.id),
            kind: kind.into(),
            title: self
                .complete_title
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or(self.title.clone()),
            description: strip_markup(self.description.as_deref().unwrap_or("")),
            authors,
            version: self
                .version
                .clone()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "não informada".into()),
            language: if languages.is_empty() {
                "não informado".into()
            } else {
                languages.join(", ")
            },
            images,
            source_url,
            license: None,
            credits,
            requirements,
            game: GameMatch {
                title: self.game.map(|g| g.name).unwrap_or_default(),
                aliases: Vec::new(),
                platform_id: platform_id(&platform).map(String::from).unwrap_or(platform),
                region: None,
                revision: None,
            },
            base: bases.first().cloned().unwrap_or_default(),
            result: None,
            // The format is read from the file at install time.
            patch: PatchFile::default(),
            distribution: "direct".into(),
            saves: None,
            stacks_on: Vec::new(),
        };
        Some(Found { entry, bases })
    }
}

fn pace(window: &Mutex<VecDeque<Instant>>, limit: usize) -> Result<()> {
    let mut window = window.lock().map_err(error)?;
    let now = Instant::now();
    while window
        .front()
        .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60))
    {
        window.pop_front();
    }
    if window.len() >= limit {
        return Err("O Romhack Plaza limita quantas consultas podem ser feitas por minuto. Tente de novo em alguns segundos.".into());
    }
    window.push_back(now);
    Ok(())
}

impl Client {
    fn get(&self, key: &str, path: &str) -> Result<serde_json::Value> {
        if let Some((at, value)) = self.cache.lock().map_err(error)?.get(path) {
            if at.elapsed() < CACHE_FOR {
                return Ok(value.clone());
            }
        }
        pace(&self.requests, REQUESTS_PER_MINUTE)?;
        let client = reqwest::blocking::Client::builder()
            .user_agent(concat!("OpenRetro/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(error)?;
        let response = client
            .get(format!("{API}{path}"))
            .bearer_auth(key)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .map_err(|_| {
                "Não foi possível falar com o Romhack Plaza. Verifique sua conexão.".to_string()
            })?;
        match response.status().as_u16() {
            401 | 403 => return Err("O Romhack Plaza recusou a chave de API. Confira a chave e se ela tem os escopos entries:read e entries:download.".into()),
            404 => return Err("O item não existe mais no Romhack Plaza.".into()),
            429 => return Err("O Romhack Plaza pediu para esperar antes de novas consultas.".into()),
            status if status >= 400 => return Err(format!("O Romhack Plaza respondeu com erro {status}.")),
            _ => {}
        }
        let mut text = String::new();
        use std::io::Read;
        response
            .take(4 * 1024 * 1024)
            .read_to_string(&mut text)
            .map_err(error)?;
        let value: serde_json::Value = serde_json::from_str(&text)
            .map_err(|_| "O Romhack Plaza respondeu algo inesperado.".to_string())?;
        self.cache
            .lock()
            .map_err(error)?
            .insert(path.into(), (Instant::now(), value.clone()));
        Ok(value)
    }
    fn data<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T> {
        let envelope: Envelope<T> = serde_json::from_value(value).map_err(|_| {
            "O Romhack Plaza respondeu num formato que o OpenRetro não conhece.".to_string()
        })?;
        if envelope.ok == Some(false) {
            return Err("O Romhack Plaza recusou a consulta.".into());
        }
        Ok(envelope.data)
    }

    /// Translations and hacks whose title mentions the game. Romhack Plaza
    /// search is by text; compatibility still comes from the file hashes.
    pub fn search(&self, key: &str, title: &str) -> Result<Vec<Found>> {
        let query: String = url_encode(title.trim());
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let path = format!("/entries/search?search={query}&types[]=translations&types[]=romhacks&per_page=20&sort=total_downloads");
        let items: Vec<SearchItem> = Self::data(self.get(key, &path)?)?;
        let mut found = Vec::new();
        for item in items
            .into_iter()
            .filter(|i| matches!(i.kind.as_str(), "translations" | "romhacks"))
            .take(DETAILS_PER_SEARCH)
        {
            let details: Details = Self::data(self.get(key, &format!("/entries/{}", item.id))?)?;
            found.extend(details.into_found());
        }
        Ok(found)
    }
    pub fn details(&self, key: &str, id: u64) -> Result<Found> {
        let details: Details = Self::data(self.get(key, &format!("/entries/{id}"))?)?;
        details
            .into_found()
            .ok_or_else(|| "Este item do Romhack Plaza não é uma tradução nem um romhack.".into())
    }
    /// Signed links valid for an hour; never cached.
    pub fn files(&self, key: &str, id: u64) -> Result<Vec<EntryFile>> {
        pace(&self.downloads, DOWNLOADS_PER_MINUTE)?;
        self.cache
            .lock()
            .map_err(error)?
            .remove(&format!("/entries/{id}/download"));
        let files: Vec<EntryFile> = Self::data(self.get(key, &format!("/entries/{id}/download"))?)?;
        self.cache
            .lock()
            .map_err(error)?
            .remove(&format!("/entries/{id}/download"));
        Ok(files)
    }
}
fn url_encode(text: &str) -> String {
    text.bytes()
        .take(200)
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shaped like the getEntry documentation on the Romhack Plaza forum.
    fn sample() -> serde_json::Value {
        serde_json::json!({
            "ok": true,
            "data": {
                "id": 42, "type": "translations", "title": "Jogo", "complete_title": "Jogo em Português",
                "slug": "jogo-portuguese-translation-snes", "description": "<p>Tradução <b>completa</b> &amp; revisada</p>",
                "main_image": "/storage/entries/main-images/a.png", "game": {"id": 1, "name": "Jogo"},
                "platform": {"id": 3, "name": "Super Nintendo"}, "status": null, "level": null,
                "authors": [{"id": 9, "name": "Tradutora"}], "categories": null,
                "galleries": [{"image": "https://romhackplaza.org/storage/g/1.png", "order": 1}, {"image": "javascript:alert(1)", "order": 2}],
                "hashes": [{"filename": "Jogo (USA).sfc", "hash_crc32": "ABCDEF01", "hash_sha1": "0123456789abcdef0123456789abcdef01234567", "verified": "1"}],
                "languages": [{"id": 2, "name": "Portuguese"}], "modifications": null, "systems": null,
                "version": "1.2", "release_date": "2026-01-01", "staff_credits": [{"name": "Revisor", "description": "revisão"}],
                "relevant_link": null, "youtube_link": null, "user_id": 1, "created_at": "", "updated_at": ""
            }
        })
    }

    #[test]
    fn maps_documented_entries_with_credits_hashes_and_safe_images() {
        let details: Details = Client::data(sample()).unwrap();
        let found = details.into_found().unwrap();
        let entry = found.entry;
        assert_eq!(entry.id, "romhackplaza.42");
        assert_eq!(entry.kind, "translation");
        assert_eq!(entry.title, "Jogo em Português");
        assert_eq!(entry.description, "Tradução completa & revisada");
        assert_eq!(entry.authors, ["Tradutora"]);
        assert_eq!(entry.credits, ["Revisor: revisão"]);
        assert_eq!(entry.game.platform_id, "snes");
        assert_eq!(
            entry.source_url,
            "https://romhackplaza.org/translations/jogo-portuguese-translation-snes"
        );
        assert_eq!(
            entry.images,
            [
                "https://romhackplaza.org/storage/entries/main-images/a.png",
                "https://romhackplaza.org/storage/g/1.png"
            ]
        );
        assert_eq!(found.bases[0].crc32.as_deref(), Some("abcdef01"));
        assert!(entry.requirements[0].contains("Jogo (USA).sfc"));
    }

    #[test]
    fn other_entry_types_and_unknown_consoles_are_not_guessed() {
        let mut value = sample();
        value["data"]["type"] = "utilities".into();
        let details: Details = Client::data(value).unwrap();
        assert!(details.into_found().is_none());
        assert_eq!(platform_id("Virtual Boy"), None);
        assert_eq!(platform_id("Sega Genesis/Mega Drive"), Some("genesis"));
        assert_eq!(url_encode("Zelda: Link's"), "Zelda%3A+Link%27s");
    }

    #[test]
    fn requests_are_paced_under_the_api_limit() {
        let window = Mutex::new(VecDeque::new());
        for _ in 0..DOWNLOADS_PER_MINUTE {
            pace(&window, DOWNLOADS_PER_MINUTE).unwrap();
        }
        assert!(pace(&window, DOWNLOADS_PER_MINUTE).is_err());
    }
}
