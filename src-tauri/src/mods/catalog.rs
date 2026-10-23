//! The catalog of translations and ROM hacks. OpenRetro ships its own list
//! (`src/db/mods-catalog.json`) and accepts more lists from HTTPS URLs in the
//! same format. An entry describes a patch, never a game: where the author
//! publishes it, what it needs, and how to recognize the exact original file.
use super::formats::Format;
use crate::database::{error, Result};
use serde::{Deserialize, Serialize};

pub const SCHEMA: &str = "openretro-mods/1";
pub const MAX_CATALOG_BYTES: usize = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 5000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema: String,
    pub name: String,
    #[serde(default)]
    pub url: Option<String>,
    pub entries: Vec<Entry>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    /// "translation" or "romhack".
    pub kind: String,
    pub title: String,
    pub description: String,
    pub authors: Vec<String>,
    pub version: String,
    /// BCP 47 language of the text in the game after patching.
    pub language: String,
    #[serde(default)]
    pub images: Vec<String>,
    /// The author's own page for this patch.
    pub source_url: String,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub credits: Vec<String>,
    #[serde(default)]
    pub requirements: Vec<String>,
    pub game: GameMatch,
    pub base: Hashes,
    #[serde(default)]
    pub result: Option<Hashes>,
    pub patch: PatchFile,
    /// "direct" when the author allows downloading the file from `patch.url`;
    /// "link" when the player must download it from the author's page.
    pub distribution: String,
    /// "shared" only when the author confirms saves carry over; anything
    /// else keeps the variant's saves apart from the original's.
    #[serde(default)]
    pub saves: Option<String>,
    /// Entries this patch is confirmed to apply on top of. Empty: only the
    /// original game.
    #[serde(default)]
    pub stacks_on: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameMatch {
    pub title: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub platform_id: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub revision: Option<String>,
}

/// Any of these identify a file. Values are lowercase hexadecimal.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hashes {
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub md5: Option<String>,
    #[serde(default)]
    pub crc32: Option<String>,
}
impl Hashes {
    pub fn is_empty(&self) -> bool {
        self.sha256.is_none() && self.sha1.is_none() && self.md5.is_none() && self.crc32.is_none()
    }
    /// True when every hash both sides know agrees, and at least one does.
    pub fn matches(&self, file: &Hashes) -> bool {
        let pairs = [
            (&self.sha256, &file.sha256),
            (&self.sha1, &file.sha1),
            (&self.md5, &file.md5),
            (&self.crc32, &file.crc32),
        ];
        let mut compared = false;
        for (expected, actual) in pairs {
            if let (Some(expected), Some(actual)) = (expected, actual) {
                if !expected.eq_ignore_ascii_case(actual) {
                    return false;
                }
                compared = true;
            }
        }
        compared && self.size.is_none_or(|size| file.size == Some(size))
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PatchFile {
    pub format: String,
    #[serde(default)]
    pub url: Option<String>,
    /// Of the downloaded file, which may be an archive.
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    /// The patch inside a ZIP or 7z download.
    #[serde(default)]
    pub path: Option<String>,
    /// Of the patch itself once extracted.
    #[serde(default)]
    pub file_sha256: Option<String>,
}

fn hex(value: &Option<String>, length: usize, field: &str) -> Result<()> {
    match value {
        Some(value) if value.len() != length || !value.bytes().all(|b| b.is_ascii_hexdigit()) => {
            Err(format!("{field} inválido no catálogo."))
        }
        _ => Ok(()),
    }
}
fn https(value: &str, field: &str) -> Result<()> {
    crate::downloads::sources::direct_url(value)
        .map(drop)
        .map_err(|_| format!("{field} precisa ser um endereço HTTPS."))
}
fn validate_hashes(hashes: &Hashes, field: &str) -> Result<()> {
    hex(&hashes.sha256, 64, &format!("{field}.sha256"))?;
    hex(&hashes.sha1, 40, &format!("{field}.sha1"))?;
    hex(&hashes.md5, 32, &format!("{field}.md5"))?;
    hex(&hashes.crc32, 8, &format!("{field}.crc32"))
}
fn short(text: &str, limit: usize) -> bool {
    !text.trim().is_empty() && text.len() <= limit
}

impl Entry {
    pub fn validate(&mut self) -> Result<()> {
        let id_ok = short(&self.id, 128)
            && self
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
        if !id_ok {
            return Err(format!("Identificador inválido no catálogo: {}", self.id));
        }
        let context = |message: &str| format!("{} ({})", message, self.id);
        if !matches!(self.kind.as_str(), "translation" | "romhack") {
            return Err(context("Tipo de modificação desconhecido"));
        }
        if !short(&self.title, 200) || self.description.len() > 4000 || !short(&self.version, 64) {
            return Err(context("Título, descrição ou versão inválidos"));
        }
        if self.authors.is_empty() || self.authors.iter().any(|a| !short(a, 120)) {
            return Err(context("Toda modificação precisa creditar seus autores"));
        }
        if !short(&self.language, 35) {
            return Err(context("Idioma inválido"));
        }
        https(&self.source_url, "sourceUrl")?;
        for image in &self.images {
            https(image, "images")?;
        }
        self.images.truncate(8);
        if !short(&self.game.title, 200) || !short(&self.game.platform_id, 32) {
            return Err(context("Jogo de origem inválido"));
        }
        validate_hashes(&self.base, "base")?;
        if let Some(result) = &self.result {
            validate_hashes(result, "result")?;
        }
        if Format::parse(&self.patch.format).is_none() {
            return Err(context(
                "Formato de patch não suportado. Use IPS, BPS, UPS ou xdelta",
            ));
        }
        hex(&self.patch.sha256, 64, "patch.sha256")?;
        hex(&self.patch.file_sha256, 64, "patch.fileSha256")?;
        match self.distribution.as_str() {
            "direct" => https(self.patch.url.as_deref().unwrap_or(""), "patch.url")?,
            "link" => self.patch.url = None,
            _ => return Err(context("Distribuição deve ser \"direct\" ou \"link\"")),
        }
        if self
            .patch
            .path
            .as_deref()
            .is_some_and(|p| !short(p, 512) || p.contains(".."))
        {
            return Err(context("Caminho do patch inválido"));
        }
        // Without a way to recognize the original, a patch can only be imported
        // by hand, where the player sees the compatibility is unknown.
        if self.base.is_empty() && self.distribution == "direct" {
            return Err(context(
                "Patches para download direto precisam dos hashes do jogo original",
            ));
        }
        if self
            .saves
            .as_deref()
            .is_some_and(|s| s != "shared" && s != "separate")
        {
            return Err(context("Política de saves inválida"));
        }
        Ok(())
    }
    pub fn saves_shared(&self) -> bool {
        self.saves.as_deref() == Some("shared")
    }
}

pub fn parse(text: &str) -> Result<Catalog> {
    if text.len() > MAX_CATALOG_BYTES {
        return Err("O catálogo de mods excede 4 MB.".into());
    }
    let mut catalog: Catalog = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("Catálogo de mods inválido: {e}"))?;
    if catalog.schema != SCHEMA {
        return Err(format!(
            "Este catálogo usa o formato \"{}\"; o OpenRetro lê \"{SCHEMA}\".",
            catalog.schema
        ));
    }
    if !short(&catalog.name, 120) || catalog.entries.len() > MAX_ENTRIES {
        return Err("O catálogo precisa de um nome e de no máximo 5000 itens.".into());
    }
    let mut seen = std::collections::HashSet::new();
    for entry in &mut catalog.entries {
        entry.validate()?;
        if !seen.insert(entry.id.clone()) {
            return Err(format!("Item repetido no catálogo: {}", entry.id));
        }
    }
    Ok(catalog)
}
pub fn bundled() -> Catalog {
    parse(include_str!("../../../src/db/mods-catalog.json")).expect("bundled mods catalog")
}

/// Titles compare without case, punctuation or a leading article.
pub fn normalize_title(title: &str) -> String {
    let lower: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = lower.split_whitespace().collect();
    let words = match words.first() {
        Some(&"the") => &words[1..],
        _ => &words[..],
    };
    words.join(" ")
}
pub fn title_matches(entry: &GameMatch, title: &str) -> bool {
    let wanted = normalize_title(title);
    !wanted.is_empty()
        && std::iter::once(&entry.title)
            .chain(&entry.aliases)
            .any(|candidate| normalize_title(candidate) == wanted)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Confirmed,
    #[default]
    Unknown,
    Incompatible,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Compatibility {
    pub status: Status,
    pub reason: String,
    /// The original matches once its 512-byte copier header is removed.
    pub strip_header: bool,
}
/// The file the player has, hashed with and without a copier header.
#[derive(Clone, Debug, Default)]
pub struct Fingerprint {
    pub platform_id: String,
    /// Why this file cannot receive a patch at all, if it cannot.
    pub unpatchable: Option<String>,
    pub full: Hashes,
    pub headerless: Option<Hashes>,
}

/// Compatibility by platform and file hashes; the game's name never confirms it.
pub fn compatibility(game: &GameMatch, base: &Hashes, file: &Fingerprint) -> Compatibility {
    let result = |status, reason: &str, strip_header| Compatibility {
        status,
        reason: reason.into(),
        strip_header,
    };
    if game.platform_id != file.platform_id {
        return result(Status::Incompatible, "Feito para outro console.", false);
    }
    if let Some(reason) = &file.unpatchable {
        return result(Status::Incompatible, reason, false);
    }
    let edition = [game.region.as_deref(), game.revision.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(", ");
    if base.is_empty() {
        return result(
            Status::Unknown,
            "O autor não informou o hash do jogo original; não há como confirmar a versão.",
            false,
        );
    }
    if base.matches(&file.full) {
        return result(
            Status::Confirmed,
            "O hash do seu arquivo confere com o original exigido.",
            false,
        );
    }
    if file
        .headerless
        .as_ref()
        .is_some_and(|headerless| base.matches(headerless))
    {
        return result(
            Status::Confirmed,
            "Confere depois de remover o cabeçalho de 512 bytes do arquivo (feito na cópia).",
            true,
        );
    }
    let message = if edition.is_empty() {
        "Seu arquivo é outra versão do jogo: o hash não confere com o original exigido.".to_string()
    } else {
        format!("Seu arquivo é outra versão do jogo: o patch exige {edition} e o hash não confere.")
    };
    result(Status::Incompatible, &message, false)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub source_id: String,
    pub source_name: String,
    pub entry: Entry,
    pub compatibility: Option<Compatibility>,
}

pub fn fetch(url: &str) -> Result<Catalog> {
    let url = crate::downloads::sources::direct_url(url)?;
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("OpenRetro/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(error)?;
    let response = client
        .get(url)
        .send()
        .map_err(|_| "Não foi possível baixar o catálogo de mods.".to_string())?
        .error_for_status()
        .map_err(|e| format!("O catálogo respondeu com erro: {e}"))?;
    let mut text = String::new();
    use std::io::Read;
    response
        .take(MAX_CATALOG_BYTES as u64 + 1)
        .read_to_string(&mut text)
        .map_err(|_| "O catálogo de mods não é um texto UTF-8 válido.".to_string())?;
    parse(&text)
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn entry() -> Entry {
        Entry {
            id: "author.test-hack.1.0".into(),
            kind: "romhack".into(),
            title: "Test Hack".into(),
            description: "Uma modificação de teste.".into(),
            authors: vec!["Autor".into()],
            version: "1.0".into(),
            language: "pt-BR".into(),
            source_url: "https://example.com/hack".into(),
            game: GameMatch {
                title: "The Test Game".into(),
                aliases: vec!["Test Game: Deluxe".into()],
                platform_id: "snes".into(),
                region: Some("USA".into()),
                revision: None,
            },
            base: Hashes {
                sha256: Some("a".repeat(64)),
                ..Default::default()
            },
            patch: PatchFile {
                format: "bps".into(),
                url: Some("https://example.com/hack.bps".into()),
                ..Default::default()
            },
            distribution: "direct".into(),
            ..Default::default()
        }
    }
    fn fingerprint(sha256: &str) -> Fingerprint {
        Fingerprint {
            platform_id: "snes".into(),
            unpatchable: None,
            full: Hashes {
                sha256: Some(sha256.into()),
                crc32: Some("01234567".into()),
                ..Default::default()
            },
            headerless: None,
        }
    }

    #[test]
    fn the_bundled_catalog_is_valid_and_credits_every_author() {
        let catalog = bundled();
        assert!(catalog.entries.len() >= 5);
        for entry in &catalog.entries {
            assert!(!entry.authors.is_empty());
            assert!(!entry.base.is_empty(), "{}", entry.id);
            assert!(entry.source_url.starts_with("https://"));
            if entry.distribution == "direct" {
                assert!(
                    entry.patch.sha256.is_some(),
                    "{} needs a pinned download",
                    entry.id
                );
            }
        }
    }

    #[test]
    fn compatibility_needs_the_hash_not_the_name() {
        let entry = entry();
        let same = compatibility(&entry.game, &entry.base, &fingerprint(&"a".repeat(64)));
        assert_eq!(same.status, Status::Confirmed);
        let other = compatibility(&entry.game, &entry.base, &fingerprint(&"b".repeat(64)));
        assert_eq!(other.status, Status::Incompatible);
        assert!(other.reason.contains("USA"));
        let mut console = fingerprint(&"a".repeat(64));
        console.platform_id = "nes".into();
        assert_eq!(
            compatibility(&entry.game, &entry.base, &console).status,
            Status::Incompatible
        );
        let mut split = fingerprint(&"a".repeat(64));
        split.unpatchable = Some("vários arquivos".into());
        assert_eq!(
            compatibility(&entry.game, &entry.base, &split).status,
            Status::Incompatible
        );
        let unknown = compatibility(
            &entry.game,
            &Hashes::default(),
            &fingerprint(&"a".repeat(64)),
        );
        assert_eq!(unknown.status, Status::Unknown);
    }

    #[test]
    fn all_known_hashes_must_agree_and_headers_are_recognized() {
        let base = Hashes {
            sha1: Some("1".repeat(40)),
            crc32: Some("89abcdef".into()),
            ..Default::default()
        };
        let file = Hashes {
            sha1: Some("1".repeat(40)),
            crc32: Some("76543210".into()),
            ..Default::default()
        };
        assert!(!base.matches(&file));
        assert!(!Hashes::default().matches(&file));
        let mut print = fingerprint(&"c".repeat(64));
        print.headerless = Some(Hashes {
            crc32: Some("89abcdef".into()),
            sha1: Some("1".repeat(40)),
            ..Default::default()
        });
        let found = compatibility(&entry().game, &base, &print);
        assert_eq!(found.status, Status::Confirmed);
        assert!(found.strip_header);
    }

    #[test]
    fn titles_match_aliases_without_articles_or_punctuation() {
        let game = entry().game;
        assert!(title_matches(&game, "Test Game"));
        assert!(title_matches(&game, "test game - deluxe"));
        assert!(!title_matches(&game, "Test Game 2"));
        assert!(!title_matches(&game, ""));
    }

    #[test]
    fn invalid_entries_are_rejected() {
        let mut no_author = entry();
        no_author.authors.clear();
        assert!(no_author.validate().is_err());
        let mut plain_http = entry();
        plain_http.patch.url = Some("http://example.com/x.ips".into());
        assert!(plain_http.validate().is_err());
        let mut no_hash = entry();
        no_hash.base = Hashes::default();
        assert!(no_hash.validate().is_err());
        no_hash.distribution = "link".into();
        assert!(no_hash.validate().is_ok());
        assert_eq!(no_hash.patch.url, None);
        let mut exe = entry();
        exe.patch.format = "exe".into();
        assert!(exe.validate().is_err());
        let mut traversal = entry();
        traversal.patch.path = Some("../../x.ips".into());
        assert!(traversal.validate().is_err());
        let text = serde_json::json!({"schema": "other/1", "name": "x", "entries": []}).to_string();
        assert!(parse(&text).unwrap_err().contains("formato"));
        let duplicate =
            serde_json::json!({"schema": SCHEMA, "name": "x", "entries": [entry(), entry()]})
                .to_string();
        assert!(parse(&duplicate).unwrap_err().contains("repetido"));
    }
}
