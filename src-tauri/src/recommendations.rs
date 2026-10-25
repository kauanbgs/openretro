//! Recommendations computed on the PC from the player's own activity. The
//! library (what was downloaded, favorited and played, and for how long),
//! time spent on game pages and games removed become a taste profile of
//! genres, consoles, developers and franchises. The catalog supplies the
//! candidates, and a final pass keeps every row varied, saves room for
//! something new and lets ignored suggestions fade. Nothing leaves the PC.
use crate::database::{error, Database, Result};
use crate::metadata::normalize;
use crate::models::GameMetadata;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use tauri::{Manager, State};

const UNKNOWN_DEVELOPER: &str = "Desenvolvedor não informado";
const UNKNOWN_GENRE: &str = "Sem categoria";
/// Size of the main row; every fifth place goes to a genre the player has not tried.
const FOR_YOU: usize = 18;
const EXPLORE_EVERY: usize = 5;
const ROW: usize = 12;
/// Rows on the catalog page before its plain listing begins.
const MAX_ROWS: usize = 22;

/// One game's pull on the profile; negative when the player turned it down.
#[derive(Debug, Clone)]
struct Signal {
    id: String,
    title: String,
    platform: String,
    genres: Vec<String>,
    developer: Option<String>,
    /// Release year, when known.
    year: i32,
    weight: f64,
    at: DateTime<Utc>,
    /// How the player met it, for row titles: "played", "downloaded" or "viewed".
    source: &'static str,
    owned: bool,
    removed: bool,
}

fn decay(at: DateTime<Utc>, now: DateTime<Utc>, half_life_days: f64) -> f64 {
    let days = (now - at).num_seconds().max(0) as f64 / 86_400.0;
    0.5f64.powf(days / half_life_days)
}

fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value?)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

fn clean_genres(list: Option<&Vec<String>>, joined: &str) -> Vec<String> {
    let genres: Vec<String> = match list {
        Some(list) if !list.is_empty() => list.clone(),
        _ => joined.split(" · ").map(String::from).collect(),
    };
    genres
        .into_iter()
        .map(|g| g.trim().to_string())
        .filter(|g| !g.is_empty() && g != UNKNOWN_GENRE && g.len() <= 80)
        .take(12)
        .collect()
}

fn clean_developer(developer: &str) -> Option<String> {
    let developer = developer.trim();
    (!developer.is_empty() && developer != UNKNOWN_DEVELOPER && developer.len() <= 200)
        .then(|| developer.to_string())
}

/// Library games: owning one says a little, playing it says more, with
/// diminishing returns so one long game cannot drown out the rest.
fn library_signals(conn: &Connection, now: DateTime<Utc>) -> Result<Vec<Signal>> {
    Ok(crate::database::library(conn)?
        .into_iter()
        .map(|entry| {
            let hours = entry.item.playtime.max(0) as f64 / 3600.0;
            let added = parse_time(Some(&entry.item.added_at)).unwrap_or(now);
            let at =
                parse_time(entry.item.last_played_at.as_deref()).map_or(added, |p| p.max(added));
            let fresh = (now - added).num_days() < 14;
            let base = if hours > 0.0 || fresh { 2.0 } else { 1.0 };
            let favorite = if entry.item.favorite { 3.0 } else { 0.0 };
            let weight =
                (base + (hours.sqrt() * 1.5).min(6.0) + favorite) * decay(at, now, 60.0).max(0.25);
            Signal {
                genres: clean_genres(entry.game.genres.as_ref(), &entry.game.genre),
                developer: clean_developer(&entry.game.developer),
                year: entry.game.year,
                id: entry.game.id,
                title: entry.game.title,
                platform: entry.game.platform_id,
                weight,
                at,
                source: if hours >= 10.0 / 60.0 {
                    "played"
                } else {
                    "downloaded"
                },
                owned: true,
                removed: false,
            }
        })
        .collect())
}

/// Page views and removals, the signals the library itself forgets.
fn event_signals(conn: &Connection, profile: &str, now: DateTime<Utc>) -> Result<Vec<Signal>> {
    let mut stmt = conn
        .prepare(
            "SELECT game_id,title,platform,genres,developer,kind,amount,at FROM interest_events \
             WHERE profile_id=?1 ORDER BY at",
        )
        .map_err(error)?;
    let rows = stmt
        .query_map([profile], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, f64>(6)?,
                r.get::<_, String>(7)?,
            ))
        })
        .map_err(error)?;
    let mut signals = vec![];
    for row in rows {
        let (id, title, platform, genres, developer, kind, amount, at) = row.map_err(error)?;
        let Some(at) = parse_time(Some(&at)) else {
            continue;
        };
        let (weight, source, removed) = match kind.as_str() {
            // A minute on the page counts a bit; the fifth minute adds little.
            "view" => (
                (amount.min(300.0) / 60.0).sqrt() * 0.8 * decay(at, now, 21.0),
                "viewed",
                false,
            ),
            // Dropped within a quarter hour: not for them. Played longer: still liked.
            "removed" => {
                let weight = if amount < 900.0 {
                    -2.5
                } else {
                    0.5 * (amount / 3600.0).sqrt().min(3.0)
                };
                (weight * decay(at, now, 90.0), "downloaded", true)
            }
            _ => continue,
        };
        signals.push(Signal {
            id,
            title,
            platform,
            genres: clean_genres(serde_json::from_str(&genres).ok().as_ref(), ""),
            developer,
            year: 0,
            weight,
            at,
            source,
            owned: false,
            removed,
        });
    }
    Ok(signals)
}

/// One signal per game: views add up to a cap, and the strongest way the
/// player met the game names it.
fn merge(signals: Vec<Signal>) -> Vec<Signal> {
    let rank = |source: &str| match source {
        "played" => 2,
        "downloaded" => 1,
        _ => 0,
    };
    let mut views: HashMap<String, f64> = HashMap::new();
    let mut games: HashMap<String, Signal> = HashMap::new();
    for signal in signals {
        let view = signal.source == "viewed" && !signal.removed;
        let weight = if view {
            let total = views.entry(signal.id.clone()).or_default();
            let capped = (*total + signal.weight).min(2.5) - *total;
            *total += capped;
            capped
        } else {
            signal.weight
        };
        match games.get_mut(&signal.id) {
            Some(game) => {
                game.weight += weight;
                game.owned |= signal.owned;
                game.removed |= signal.removed;
                game.at = game.at.max(signal.at);
                if rank(signal.source) > rank(game.source) {
                    game.source = signal.source;
                }
                if game.genres.is_empty() {
                    game.genres = signal.genres;
                }
            }
            None => {
                games.insert(signal.id.clone(), Signal { weight, ..signal });
            }
        }
    }
    games.into_values().collect()
}

/// Shares of the player's taste: each genre, console and developer as a
/// fraction of all positive interest, negative where it was turned down.
#[derive(Default, Debug)]
struct Profile {
    genres: HashMap<String, f64>,
    platforms: HashMap<String, f64>,
    developers: HashMap<String, f64>,
}

fn to_shares(map: &mut HashMap<String, f64>) {
    let positive: f64 = map.values().map(|w| w.max(0.0)).sum();
    let total = if positive > 0.0 {
        positive
    } else {
        map.values().map(|w| w.abs()).sum()
    };
    if total > 0.0 {
        map.values_mut().for_each(|w| *w /= total);
    }
}

impl Profile {
    fn from(signals: &[Signal]) -> Self {
        let mut profile = Profile::default();
        for signal in signals {
            // A game split across many genres speaks for each a little less.
            let share = signal.weight / signal.genres.len().max(1) as f64;
            for genre in &signal.genres {
                *profile.genres.entry(genre.clone()).or_default() += share;
            }
            *profile
                .platforms
                .entry(signal.platform.clone())
                .or_default() += signal.weight;
            if let Some(developer) = &signal.developer {
                *profile.developers.entry(developer.clone()).or_default() += signal.weight;
            }
        }
        to_shares(&mut profile.genres);
        to_shares(&mut profile.platforms);
        to_shares(&mut profile.developers);
        profile
    }
}

fn top(map: &HashMap<String, f64>, count: usize) -> Vec<(String, f64)> {
    let mut entries: Vec<_> = map
        .iter()
        .filter(|(_, w)| **w > 0.0)
        .map(|(k, w)| (k.clone(), *w))
        .collect();
    entries.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    entries.truncate(count);
    entries
}

const STOPWORDS: &[&str] = &[
    "a", "an", "and", "the", "of", "for", "to", "in", "on", "vs", "de", "da", "do", "no", "e",
];
const SEQUEL_WORDS: &[&str] = &[
    "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "deluxe", "dx",
    "plus", "returns", "advance", "remix", "special", "edition", "hd",
];

/// The words a series shares: the title before any subtitle, without
/// trailing sequel numbers. "Gran Turismo 2" and "Gran Turismo 3: A-Spec"
/// both give "gran turismo".
fn title_head(title: &str) -> Vec<String> {
    let cut = [":", " - ", " – ", " — "]
        .iter()
        .filter_map(|separator| title.find(separator))
        .min()
        .unwrap_or(title.len());
    let mut words: Vec<String> = normalize(&title[..cut])
        .split(' ')
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect();
    while words.len() > 1
        && words.last().is_some_and(|w| {
            w.chars().all(|c| c.is_ascii_digit()) || SEQUEL_WORDS.contains(&w.as_str())
        })
    {
        words.pop();
    }
    words
}

/// A short label for spreading a row across series, without the catalog.
fn series_label(title: &str) -> String {
    title_head(title)
        .into_iter()
        .take(2)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Ordinary words that start many unrelated titles, so alone they never name
/// a franchise: Super Street Fighter II is Street Fighter, not "street".
const COMMON_WORDS: &[&str] = &[
    "action",
    "adventure",
    "adventures",
    "alien",
    "american",
    "ball",
    "battle",
    "big",
    "black",
    "blood",
    "blue",
    "championship",
    "city",
    "classic",
    "combat",
    "dark",
    "dead",
    "death",
    "dragon",
    "dream",
    "fantasy",
    "fighter",
    "fighting",
    "final",
    "fire",
    "football",
    "game",
    "games",
    "golden",
    "grand",
    "great",
    "hero",
    "heroes",
    "house",
    "hunter",
    "island",
    "king",
    "kingdom",
    "knight",
    "land",
    "legend",
    "legends",
    "little",
    "lord",
    "magic",
    "master",
    "mega",
    "metal",
    "monster",
    "night",
    "ninja",
    "party",
    "pinball",
    "power",
    "princess",
    "puzzle",
    "quest",
    "race",
    "racing",
    "real",
    "road",
    "robot",
    "shadow",
    "soccer",
    "space",
    "sports",
    "star",
    "story",
    "street",
    "super",
    "tales",
    "time",
    "tennis",
    "total",
    "ultimate",
    "ultra",
    "world",
    "world's",
    "wrestling",
    "young",
];

/// Words some series put before their name: "Super Mario Kart" and "New
/// Super Mario Bros." belong with "Mario Party" as Mario games.
const SERIES_PREFIXES: &[&str] = &["new super", "super", "new"];

/// The key with each series prefix in front, which titles may also start with.
fn key_variants(key: &str) -> Vec<String> {
    std::iter::once(key.to_string())
        .chain(SERIES_PREFIXES.iter().map(|p| format!("{p} {key}")))
        .collect()
}

fn starts_with_key(norm: &str, key: &str) -> bool {
    norm == key
        || norm
            .strip_prefix(key)
            .is_some_and(|rest| rest.starts_with(' '))
}

fn matches_key(norm: &str, key: &str) -> bool {
    key_variants(key)
        .iter()
        .any(|key| starts_with_key(norm, key))
}

/// One catalog game as recommendations see it.
struct Entry {
    id: i64,
    title: String,
    norm: String,
    platform: String,
    genres: Vec<String>,
    developer: Option<String>,
    year: i32,
    players: i32,
    /// Community rating from 0 to 100, when anyone rated it.
    rating: Option<f64>,
    count: i64,
    /// A commercial release with box art. Unlicensed entries are mostly
    /// bootlegs, like Tekken 2 for the NES.
    suggestable: bool,
}

/// The catalog in memory, small enough to read once per catalog version so
/// a page of rows is computed without touching the disk. Fan hacks, DLC and
/// homebrew are left out: they would make every famous series look generic.
pub struct Snapshot {
    version: String,
    /// Best known first, so every index list below is in that order too.
    games: Vec<Entry>,
    by_id: HashMap<i64, u32>,
    by_genre: HashMap<String, Vec<u32>>,
    by_platform: HashMap<String, Vec<u32>>,
    /// Normalized titles in order, to find every title starting with a key.
    names: Vec<(String, u32)>,
}

static SNAPSHOT: std::sync::Mutex<Option<std::sync::Arc<Snapshot>>> = std::sync::Mutex::new(None);

impl Snapshot {
    fn load(conn: &Connection, version: String) -> Result<Self> {
        let mut stmt = conn
            .prepare(
                "SELECT g.id, g.name, g.platform, g.year, g.developer, g.genres, g.players, g.rating, \
                 g.rating_count, IFNULL(g.release_type,'') NOT IN ('Unreleased','Unlicensed') \
                 AND g.id IN (SELECT id FROM images WHERE type='Box - Front') \
                 FROM games g WHERE IFNULL(g.release_type,'') NOT IN ('ROM Hack','DLC','Homebrew') \
                 ORDER BY g.rating_count DESC, g.rating DESC",
            )
            .map_err(error)?;
        let games: Vec<Entry> = stmt
            .query_map([], |r| {
                let title: String = r.get(1)?;
                let genres: Option<String> = r.get(5)?;
                let count: i64 = r.get(8)?;
                Ok(Entry {
                    id: r.get(0)?,
                    norm: normalize(&title),
                    title,
                    platform: r.get(2)?,
                    year: r.get::<_, Option<i32>>(3)?.unwrap_or(0),
                    developer: r
                        .get::<_, Option<String>>(4)?
                        .as_deref()
                        .and_then(clean_developer),
                    genres: genres
                        .unwrap_or_default()
                        .split(';')
                        .map(str::trim)
                        .filter(|g| !g.is_empty())
                        .map(String::from)
                        .collect(),
                    players: r.get::<_, Option<i32>>(6)?.unwrap_or(0),
                    rating: r
                        .get::<_, Option<f64>>(7)?
                        .filter(|_| count > 0)
                        .map(|r| (r * 20.0).round()),
                    count,
                    suggestable: r.get(9)?,
                })
            })
            .map_err(error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(error)?;
        let mut snapshot = Snapshot {
            version,
            by_id: HashMap::with_capacity(games.len()),
            by_genre: HashMap::new(),
            by_platform: HashMap::new(),
            names: Vec::with_capacity(games.len()),
            games,
        };
        for (index, game) in snapshot.games.iter().enumerate() {
            let index = index as u32;
            snapshot.by_id.insert(game.id, index);
            snapshot.names.push((game.norm.clone(), index));
            if !game.suggestable {
                continue;
            }
            for genre in &game.genres {
                snapshot
                    .by_genre
                    .entry(genre.clone())
                    .or_default()
                    .push(index);
            }
            snapshot
                .by_platform
                .entry(game.platform.clone())
                .or_default()
                .push(index);
        }
        snapshot.names.sort();
        Ok(snapshot)
    }

    /// The snapshot for the catalog `conn` holds, loaded again only after the
    /// catalog is rebuilt.
    fn current(conn: &Connection) -> Result<std::sync::Arc<Snapshot>> {
        let version: String = conn
            .query_row("SELECT value FROM meta WHERE key='built_at'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(error)?
            .unwrap_or_default();
        let mut slot = SNAPSHOT.lock().map_err(error)?;
        if let Some(snapshot) = slot.as_ref().filter(|s| s.version == version) {
            return Ok(snapshot.clone());
        }
        let snapshot = std::sync::Arc::new(Snapshot::load(conn, version)?);
        *slot = Some(snapshot.clone());
        Ok(snapshot)
    }

    /// Reads the catalog at `path` into memory in the background, so the
    /// first page with recommendations does not wait for it.
    pub fn warm_up(path: std::path::PathBuf) {
        std::thread::spawn(move || {
            let loaded =
                Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(error)
                    .and_then(|conn| Snapshot::current(&conn).map(|_| ()));
            if let Err(e) = loaded {
                log::warn!("Could not prepare recommendations: {e}");
            }
        });
    }

    fn genre(&self, genre: &str) -> &[u32] {
        self.by_genre.get(genre).map_or(&[], Vec::as_slice)
    }

    fn platform(&self, platform: &str) -> &[u32] {
        self.by_platform.get(platform).map_or(&[], Vec::as_slice)
    }

    fn all(&self) -> impl Iterator<Item = u32> {
        0..self.games.len() as u32
    }

    /// Titles equal to `key` or continuing it with another word. Normalized
    /// titles hold only letters, digits and spaces, and a space sorts first,
    /// so they sit together right after the key itself.
    fn starting_with<'a>(&'a self, key: &'a str) -> impl Iterator<Item = &'a (String, u32)> + 'a {
        let start = self.names.partition_point(|(norm, _)| norm.as_str() < key);
        self.names[start..]
            .iter()
            .take_while(move |(norm, _)| starts_with_key(norm, key))
    }

    /// The franchise's games, best known first.
    fn franchise(&self, key: &str) -> Vec<u32> {
        let mut games: Vec<u32> = key_variants(key)
            .iter()
            .flat_map(|key| self.starting_with(key).map(|(_, i)| *i).collect::<Vec<_>>())
            .collect();
        games.sort_unstable();
        games.dedup();
        games
    }

    fn titles_with_key(&self, key: &str) -> usize {
        let variants = key_variants(key);
        let titles: HashSet<&str> = variants
            .iter()
            .flat_map(|key| {
                self.starting_with(key)
                    .map(|(norm, _)| norm.as_str())
                    .collect::<Vec<_>>()
            })
            .collect();
        titles.len()
    }
}

/// The franchise a title belongs to, as the shortest start of its name that
/// several catalog titles share without becoming generic: "mario" for Super
/// Mario Kart and Super Mario World, "pokemon" for Pokemon Red Version,
/// "legend of zelda" for A Link to the Past, never "super".
fn franchise_key(snapshot: &Snapshot, title: &str) -> Option<String> {
    let mut words = title_head(title);
    let prefix = SERIES_PREFIXES.iter().find_map(|prefix| {
        let prefix: Vec<&str> = prefix.split(' ').collect();
        (words.len() > prefix.len() && words[..prefix.len()] == prefix[..]).then_some(prefix.len())
    });
    if let Some(length) = prefix {
        words.drain(..length);
    }
    let specific = |key: &str| (2..=150).contains(&snapshot.titles_with_key(key));
    let single = |word: &String| {
        (word.len() >= 4
            && !STOPWORDS.contains(&word.as_str())
            && !COMMON_WORDS.contains(&word.as_str())
            && specific(word))
        .then(|| word.clone())
    };
    // After a prefix the next word names the series: Super Mario Kart is Mario.
    if prefix.is_some() {
        if let Some(key) = words.first().and_then(single) {
            return Some(key);
        }
    }
    for n in 2..=words.len() {
        if STOPWORDS.contains(&words[n - 1].as_str()) {
            continue;
        }
        let key = words[..n].join(" ");
        if specific(&key) {
            return Some(key);
        }
    }
    match prefix {
        None => words.first().and_then(single),
        Some(_) => None,
    }
}

/// Words that mark demos, betas and promotional discs rather than games.
const NOT_GAMES: &[&str] = &[
    "demo",
    "trial",
    "beta",
    "kiosk",
    "sampler",
    "prototype",
    "preview",
    "previews",
    "promo",
    "promotional",
    "dealership",
    "taikenban",
];

#[derive(Debug, Clone)]
struct Candidate {
    id: String,
    /// The LaunchBox id, to look up the full game for the page.
    external: i64,
    norm: String,
    genres: Vec<String>,
    platform: String,
    developer: Option<String>,
    series: String,
    /// Community rating from 0 to 1, when anyone rated it.
    rating: Option<f64>,
    /// How well known and well rated the game is, from 0 to 1.
    quality: f64,
    /// Below 1 once a suggestion was shown again and again without being opened.
    fatigue: f64,
    affinity: f64,
    score: f64,
    primary: String,
    /// No pull either way from the profile: room for discovery.
    explore: bool,
    reason: Value,
}

impl Candidate {
    fn new(game: &Entry, fatigue: &HashMap<String, f64>) -> Option<Self> {
        if game.norm.split(' ').any(|w| NOT_GAMES.contains(&w)) {
            return None;
        }
        let id = format!("lb-{}", game.id);
        let rating = game.rating.map(|r| (r / 100.0).clamp(0.0, 1.0));
        Some(Candidate {
            fatigue: fatigue.get(&id).copied().unwrap_or(1.0),
            id,
            external: game.id,
            norm: game.norm.clone(),
            series: series_label(&game.title),
            platform: game.platform.clone(),
            developer: game.developer.clone(),
            primary: game.genres.first().cloned().unwrap_or_default(),
            genres: game.genres.clone(),
            quality: 0.6 * ((1.0 + game.count.max(0) as f64).ln() / 1001f64.ln()).min(1.0)
                + 0.4 * rating.unwrap_or(0.5),
            rating,
            affinity: 0.0,
            score: 0.0,
            explore: false,
            reason: Value::Null,
        })
    }
}

/// Picks `size` games best first while keeping the row balanced. Each genre
/// gets places in proportion to the player's taste (`quota`); past them, the
/// next game of that genre counts much less, and repeated consoles and series
/// count a little less too. So a player of racing games sees mostly racing,
/// some of their other genres and, every `explore_every` places, a well-liked
/// game from a genre they have not tried.
fn rerank(
    mut pool: Vec<Candidate>,
    size: usize,
    explore_every: Option<usize>,
    quota: impl Fn(&str) -> f64,
) -> Vec<Candidate> {
    let mut picked = vec![];
    let mut genres: HashMap<String, i32> = HashMap::new();
    let mut platforms: HashMap<String, i32> = HashMap::new();
    let mut series: HashMap<String, i32> = HashMap::new();
    while picked.len() < size && !pool.is_empty() {
        let explore_slot = explore_every.is_some_and(|n| picked.len() % n == n - 1);
        let value = |c: &Candidate, explore_only: bool| {
            let repeats = series.get(&c.series).copied().unwrap_or(0);
            if repeats >= 2 || explore_only != c.explore {
                return f64::NEG_INFINITY;
            }
            let used = genres.get(&c.primary).copied().unwrap_or(0);
            let places = quota(&c.primary);
            let genre = if (used as f64) < places {
                0.93f64.powi(used)
            } else {
                0.45f64.powf(used as f64 - places + 1.0)
            };
            let base = if explore_only { c.quality } else { c.score };
            base.max(0.001)
                * c.fatigue
                * genre
                * 0.85f64.powi(platforms.get(&c.platform).copied().unwrap_or(0))
                * 0.5f64.powi(repeats)
        };
        let best = |explore_only: bool| {
            pool.iter()
                .enumerate()
                .map(|(i, c)| (i, value(c, explore_only)))
                .filter(|(_, v)| v.is_finite())
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(i, _)| i)
        };
        let choice = best(explore_slot).or_else(|| best(!explore_slot));
        let Some(index) = choice else { break };
        let chosen = pool.swap_remove(index);
        *genres.entry(chosen.primary.clone()).or_default() += 1;
        *platforms.entry(chosen.platform.clone()).or_default() += 1;
        *series.entry(chosen.series.clone()).or_default() += 1;
        picked.push(chosen);
    }
    picked
}

fn jaccard(a: &[String], b: &[String]) -> f64 {
    let a: HashSet<_> = a.iter().collect();
    let b: HashSet<_> = b.iter().collect();
    let union = a.union(&b).count();
    if union == 0 {
        0.0
    } else {
        a.intersection(&b).count() as f64 / union as f64
    }
}

struct Franchise {
    key: String,
    name: String,
}

/// The franchise as the anchor title writes it, without a series prefix the
/// key leaves out: "Mario" for Super Mario Kart, "The Legend of Zelda" for
/// The Legend of Zelda: A Link to the Past.
fn franchise_name(title: &str, key: &str) -> String {
    let needed = key.split(' ').count();
    let first = key.split(' ').next().unwrap_or_default();
    let mut found = 0;
    let mut words = vec![];
    for token in title.split_whitespace() {
        if found >= needed {
            break;
        }
        let norm = normalize(token);
        if found == 0 && norm != first && SERIES_PREFIXES.contains(&norm.as_str()) {
            continue;
        }
        found += norm.split(' ').filter(|w| !w.is_empty()).count();
        words.push(token);
    }
    words
        .join(" ")
        .trim_end_matches([':', ',', '-', ' '])
        .to_string()
}

fn share(map: &HashMap<String, f64>, key: &str) -> f64 {
    map.get(key).copied().unwrap_or(0.0)
}

/// Each title once, keeping the console the player uses most.
fn distinct(mut games: Vec<Candidate>, profile: &Profile) -> Vec<Candidate> {
    games.sort_by(|a, b| {
        share(&profile.platforms, &b.platform)
            .total_cmp(&share(&profile.platforms, &a.platform))
            .then(b.quality.total_cmp(&a.quality))
    });
    let mut titles = HashSet::new();
    games.retain(|c| titles.insert(c.norm.clone()));
    games
}

/// The best `size` games by `rank`, leaving out genres the player turned
/// down and spreading consoles, series and, past a third of the row, genres.
fn pick(pool: Vec<Candidate>, size: usize, rank: impl Fn(&Candidate) -> f64) -> Vec<Candidate> {
    let pool = pool
        .into_iter()
        .filter(|c| c.affinity > -0.05)
        .map(|mut c| {
            c.score = rank(&c);
            c
        })
        .collect();
    rerank(pool, size, None, |_| (size / 3) as f64)
}

/// Builds the page of rows. Every row draws on the same profile and leaves
/// out what the player has and what an earlier row already showed, so no
/// game appears twice.
struct Rows<'a> {
    catalog: &'a Snapshot,
    profile: Profile,
    fatigue: &'a HashMap<String, f64>,
    liked: Vec<Signal>,
    franchises: Vec<Franchise>,
    viewed: HashSet<String>,
    excluded_ids: HashSet<String>,
    excluded_titles: HashSet<String>,
    rows: Vec<(Value, Vec<Candidate>, bool)>,
}

impl Rows<'_> {
    /// Scores a catalog game for this player and says, briefly, why.
    fn judge(&self, c: &mut Candidate) {
        let profile = &self.profile;
        c.affinity = c
            .genres
            .iter()
            .map(|g| share(&profile.genres, g))
            .sum::<f64>()
            .clamp(-1.0, 1.0);
        let franchise = self
            .franchises
            .iter()
            .find(|f| matches_key(&c.norm, &f.key));
        let viewed = self.viewed.contains(&c.id);
        c.score = 0.6 * c.affinity
            + 0.15 * share(&profile.platforms, &c.platform)
            + 0.1
                * c.developer
                    .as_deref()
                    .map_or(0.0, |d| share(&profile.developers, d))
            + 0.3 * c.quality
            + if franchise.is_some() { 0.4 } else { 0.0 }
            + if viewed { 0.2 } else { 0.0 };
        c.explore = c.affinity > -0.02 && c.affinity < 0.05 && !viewed && franchise.is_none();
        if let Some(primary) = c
            .genres
            .iter()
            .max_by(|a, b| share(&profile.genres, a).total_cmp(&share(&profile.genres, b)))
        {
            c.primary = primary.clone();
        }
        c.reason = if let Some(franchise) = franchise {
            json!({"kind": "franchise", "name": franchise.name})
        } else if viewed {
            json!({"kind": "viewed"})
        } else if c.explore {
            json!({"kind": "explore"})
        } else if let Some(anchor) = self.liked.iter().find(|s| s.genres.contains(&c.primary)) {
            json!({"kind": "similar", "title": anchor.title})
        } else {
            json!({"kind": "genre", "genre": c.primary})
        };
    }

    /// Up to `limit` suggestable games from `source` that pass `keep`, in
    /// the source's order, which the player has not got and no earlier row
    /// showed, scored.
    fn fetch(
        &self,
        source: impl IntoIterator<Item = u32>,
        keep: impl Fn(&Entry) -> bool,
        limit: usize,
    ) -> Vec<Candidate> {
        let mut games = vec![];
        for index in source {
            let game = &self.catalog.games[index as usize];
            if !game.suggestable || self.excluded_titles.contains(&game.norm) || !keep(game) {
                continue;
            }
            let Some(mut c) = Candidate::new(game, self.fatigue) else {
                continue;
            };
            if self.excluded_ids.contains(&c.id) {
                continue;
            }
            self.judge(&mut c);
            games.push(c);
            if games.len() == limit {
                break;
            }
        }
        games
    }

    fn genre(&self, genre: &str) -> impl Iterator<Item = u32> + '_ {
        self.catalog.genre(genre).iter().copied()
    }

    /// Keeps a row of at least four games; `reasons` adds why each is there.
    fn push(&mut self, row: Value, games: Vec<Candidate>, reasons: bool) {
        if games.len() < 4 || self.rows.len() >= MAX_ROWS {
            return;
        }
        for c in &games {
            self.excluded_ids.insert(c.id.clone());
            self.excluded_titles.insert(c.norm.clone());
        }
        self.rows.push((row, games, reasons));
    }

    /// The main row: a mix of everything the player likes, every fifth place
    /// for something new.
    fn for_you(&mut self) {
        let mut pool = vec![];
        let top_platform = top(&self.profile.platforms, 1).into_iter().next();
        for (index, (genre, _)) in top(&self.profile.genres, 4).iter().enumerate() {
            pool.extend(self.fetch(self.genre(genre), |_| true, 60));
            if let (0, Some((platform, _))) = (index, &top_platform) {
                pool.extend(self.fetch(self.genre(genre), |g| &g.platform == platform, 40));
            }
        }
        if let Some((developer, share)) = top(&self.profile.developers, 1).into_iter().next() {
            if share >= 0.15 {
                pool.extend(self.fetch(
                    self.catalog.all(),
                    |g| g.developer.as_ref() == Some(&developer),
                    20,
                ));
            }
        }
        pool.extend(self.viewed_games());
        pool.extend(self.fetch(self.catalog.all(), |_| true, 150));
        let games = {
            // Places per genre follow the square root of its share, so the
            // favourite genre leads without crowding out the player's other tastes.
            let flattened: HashMap<&str, f64> = self
                .profile
                .genres
                .iter()
                .filter(|(_, w)| **w > 0.0)
                .map(|(g, w)| (g.as_str(), w.sqrt()))
                .collect();
            let total: f64 = flattened.values().sum();
            let places = (FOR_YOU - FOR_YOU / EXPLORE_EVERY) as f64;
            let quota = |genre: &str| {
                flattened
                    .get(genre)
                    .map_or(1.0, |w| (w / total * places).max(1.0))
            };
            rerank(
                distinct(pool, &self.profile),
                FOR_YOU,
                Some(EXPLORE_EVERY),
                quota,
            )
        };
        self.push(json!({"kind": "forYou"}), games, true);
    }

    /// Games like one the player recently enjoyed: same genres, then the same
    /// console and developer.
    fn because(&mut self, anchor: &Signal) {
        let mut pool = vec![];
        for genre in anchor.genres.iter().take(3) {
            pool.extend(self.fetch(self.genre(genre), |g| g.platform == anchor.platform, 30));
            pool.extend(self.fetch(self.genre(genre), |_| true, 50));
        }
        let pool: Vec<Candidate> = distinct(pool, &self.profile)
            .into_iter()
            .filter_map(|c| {
                let overlap = jaccard(&c.genres, &anchor.genres);
                (overlap > 0.0 && c.affinity > -0.02).then(|| Candidate {
                    score: 0.65 * overlap
                        + if c.platform == anchor.platform {
                            0.15
                        } else {
                            0.0
                        }
                        + if c.developer.is_some() && c.developer == anchor.developer {
                            0.1
                        } else {
                            0.0
                        }
                        + 0.2 * c.quality,
                    ..c
                })
            })
            .collect();
        let games = rerank(pool, ROW, None, |_| ROW as f64);
        self.push(
            json!({"kind": "because", "title": anchor.title, "source": anchor.source}),
            games,
            false,
        );
    }

    fn franchise(&mut self, index: usize) {
        let Some(franchise) = self.franchises.get(index) else {
            return;
        };
        let name = franchise.name.clone();
        let pool = self.fetch(self.catalog.franchise(&franchise.key), |_| true, 60);
        let platforms = &self.profile.platforms;
        let pool = distinct(pool, &self.profile)
            .into_iter()
            .map(|mut c| {
                // The row is the series, so only fame, freshness and console matter.
                c.score = c.quality + 0.2 * share(platforms, &c.platform);
                c.series = c.norm.clone();
                c
            })
            .collect();
        let games = rerank(pool, ROW, None, |_| ROW as f64);
        self.push(json!({"kind": "franchise", "name": name}), games, false);
    }

    fn best_of_genre(&mut self, genre: &str, platform: Option<&str>) {
        let pool = self.fetch(
            self.genre(genre),
            |g| platform.is_none_or(|p| g.platform == p),
            80,
        );
        let platforms = &self.profile.platforms;
        let games = pick(distinct(pool, &self.profile), ROW, |c| {
            0.7 * c.quality + 0.2 * share(platforms, &c.platform) + 0.1 * c.affinity
        });
        let row = match platform {
            Some(platform) => {
                json!({"kind": "genrePlatform", "genre": genre, "platform": platform})
            }
            None => json!({"kind": "genre", "genre": genre}),
        };
        self.push(row, games, false);
    }

    /// Well-rated games fewer people know, in a genre the player likes.
    fn hidden_gems(&mut self, genre: &str) {
        let pool = self.fetch(
            self.genre(genre),
            |g| (20..=120).contains(&g.count) && g.rating.is_some_and(|r| r >= 80.0),
            400,
        );
        let games = pick(distinct(pool, &self.profile), ROW, |c| {
            c.rating.unwrap_or(0.0) + 0.2 * c.affinity
        });
        self.push(json!({"kind": "hidden", "genre": genre}), games, false);
    }

    /// A row from any slice of the catalog, ranked by taste and fame together.
    fn slice(&mut self, row: Value, source: Vec<u32>, keep: impl Fn(&Entry) -> bool) {
        let pool = self.fetch(source, keep, 120);
        let games = pick(distinct(pool, &self.profile), ROW, |c| {
            0.5 * c.affinity.max(0.0) + 0.5 * c.quality
        });
        self.push(row, games, false);
    }

    /// Classics of a console the player uses, leaning to their genres.
    fn console(&mut self, platform: &str) {
        let source = self.catalog.platform(platform).to_vec();
        self.slice(
            json!({"kind": "platform", "platform": platform}),
            source,
            |_| true,
        );
    }

    fn developer(&mut self, developer: &str) {
        let pool = self.fetch(
            self.catalog.all(),
            |g| g.developer.as_deref() == Some(developer),
            40,
        );
        let games = pick(distinct(pool, &self.profile), ROW, |c| {
            c.quality + 0.3 * c.affinity
        });
        self.push(
            json!({"kind": "developer", "developer": developer}),
            games,
            false,
        );
    }

    /// Multiplayer games in the genres the player likes most.
    fn together(&mut self) {
        let genres: Vec<String> = top(&self.profile.genres, 3)
            .into_iter()
            .map(|(g, _)| g)
            .collect();
        if genres.is_empty() {
            return;
        }
        let source = self.catalog.all().collect();
        self.slice(json!({"kind": "together"}), source, |g| {
            g.players > 1 && g.genres.iter().any(|genre| genres.contains(genre))
        });
    }

    /// Games the player looked at for a while but never downloaded.
    fn viewed_games(&self) -> Vec<Candidate> {
        let source: Vec<u32> = self
            .viewed
            .iter()
            .filter_map(|id| id.strip_prefix("lb-")?.parse::<i64>().ok())
            .filter_map(|id| self.catalog.by_id.get(&id).copied())
            .collect();
        self.fetch(source, |_| true, 40)
    }

    fn viewed_row(&mut self) {
        let pool = self.viewed_games();
        let games = pick(distinct(pool, &self.profile), ROW, |c| c.score);
        self.push(json!({"kind": "viewed"}), games, false);
    }

    /// Well-liked games from genres the player has not tried.
    fn explore(&mut self) {
        let pool: Vec<Candidate> = self
            .fetch(self.catalog.all(), |_| true, 300)
            .into_iter()
            .filter(|c| c.explore)
            .map(|mut c| {
                c.score = c.quality;
                c
            })
            .collect();
        let games = rerank(distinct(pool, &self.profile), ROW, None, |_| 2.0);
        self.push(json!({"kind": "explore"}), games, false);
    }
}

/// Up to `count` recent games the player clearly engaged with, with different
/// genres, to anchor "because you played…" rows.
fn anchors(signals: &[Signal], count: usize) -> Vec<Signal> {
    let mut recent: Vec<&Signal> = signals
        .iter()
        .filter(|s| s.weight >= 1.5 && !s.removed && !s.genres.is_empty())
        .collect();
    recent.sort_by(|a, b| b.at.cmp(&a.at));
    let mut chosen: Vec<Signal> = vec![];
    for signal in recent {
        if chosen.len() == count {
            break;
        }
        if chosen
            .iter()
            .all(|c| jaccard(&c.genres, &signal.genres) < 1.0)
        {
            chosen.push(signal.clone());
        }
    }
    chosen
}

/// The decade of the games the player likes most, like 1990.
fn favourite_decade(signals: &[Signal]) -> Option<i32> {
    let mut decades: HashMap<i32, f64> = HashMap::new();
    for signal in signals.iter().filter(|s| s.weight > 0.0 && s.year > 1970) {
        *decades.entry(signal.year / 10 * 10).or_default() += signal.weight;
    }
    decades
        .into_iter()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(decade, _)| decade)
}

/// All recommendation rows for the profile: the main row, then rows by
/// recent games, franchises, genres, consoles, developers, multiplayer,
/// hidden gems, a decade, games looked at and something new, interleaved so
/// the page keeps changing as it scrolls. Each row's games, as `Candidate`s.
fn plan(
    catalog: &Snapshot,
    signals: &[Signal],
    fatigue: &HashMap<String, f64>,
) -> Vec<(Value, Vec<Candidate>, bool)> {
    let profile = Profile::from(signals);
    let mut liked: Vec<Signal> = signals
        .iter()
        .filter(|s| s.weight > 0.0 && !s.removed)
        .cloned()
        .collect();
    liked.sort_by(|a, b| b.weight.total_cmp(&a.weight));
    let mut franchises: Vec<Franchise> = vec![];
    for signal in liked.iter().take(10) {
        if franchises.len() == 3 {
            break;
        }
        if let Some(key) = franchise_key(catalog, &signal.title) {
            if !franchises.iter().any(|f| f.key == key) {
                franchises.push(Franchise {
                    name: franchise_name(&signal.title, &key),
                    key,
                });
            }
        }
    }
    let mut rows = Rows {
        catalog,
        fatigue,
        franchises,
        viewed: signals
            .iter()
            .filter(|s| s.source == "viewed" && !s.owned && !s.removed && s.weight > 0.0)
            .map(|s| s.id.clone())
            .collect(),
        excluded_ids: signals
            .iter()
            .filter(|s| s.owned || s.removed)
            .map(|s| s.id.clone())
            .collect(),
        excluded_titles: signals
            .iter()
            .filter(|s| s.owned || s.removed)
            .map(|s| normalize(&s.title))
            .collect(),
        liked,
        rows: vec![],
        profile,
    };
    let anchors = anchors(signals, 3);
    let genres: Vec<String> = top(&rows.profile.genres, 4)
        .into_iter()
        .map(|(g, _)| g)
        .collect();
    let platforms: Vec<String> = top(&rows.profile.platforms, 2)
        .into_iter()
        .map(|(p, _)| p)
        .collect();
    let developers: Vec<String> = top(&rows.profile.developers, 2)
        .into_iter()
        .filter(|(_, share)| *share >= 0.1)
        .map(|(d, _)| d)
        .collect();
    let genre = |i: usize| genres.get(i).map(String::as_str);

    rows.for_you();
    if let Some(anchor) = anchors.first() {
        rows.because(anchor);
    }
    rows.franchise(0);
    if let Some(genre) = genre(0) {
        rows.best_of_genre(genre, None);
    }
    if let Some(anchor) = anchors.get(1) {
        rows.because(anchor);
    }
    rows.franchise(1);
    if let (Some(genre), Some(platform)) = (genre(0), platforms.first()) {
        rows.best_of_genre(genre, Some(platform));
    }
    if let Some(developer) = developers.first() {
        rows.developer(developer);
    }
    if let Some(genre) = genre(1) {
        rows.best_of_genre(genre, None);
    }
    rows.together();
    if let Some(genre) = genre(0) {
        rows.hidden_gems(genre);
    }
    if let Some(anchor) = anchors.get(2) {
        rows.because(anchor);
    }
    if let Some(platform) = platforms.first() {
        rows.console(platform);
    }
    rows.franchise(2);
    if let Some(genre) = genre(2) {
        rows.best_of_genre(genre, None);
    }
    if let Some(decade) = favourite_decade(signals) {
        let source = catalog.all().collect();
        rows.slice(json!({"kind": "decade", "decade": decade}), source, |g| {
            (decade..decade + 10).contains(&g.year)
        });
    }
    rows.viewed_row();
    if let Some(genre) = genre(1) {
        rows.hidden_gems(genre);
    }
    if let Some(platform) = platforms.get(1) {
        rows.console(platform);
    }
    if let Some(developer) = developers.get(1) {
        rows.developer(developer);
    }
    if let Some(genre) = genre(3) {
        rows.best_of_genre(genre, None);
    }
    rows.explore();
    rows.rows
}

/// The rows as the page shows them, with each game's full catalog entry
/// fetched in one query for only the games kept.
fn build(conn: &Connection, signals: &[Signal], fatigue: &HashMap<String, f64>) -> Result<Value> {
    let catalog = Snapshot::current(conn)?;
    let rows = plan(&catalog, signals, fatigue);
    let ids: Vec<i64> = rows
        .iter()
        .flat_map(|(_, games, _)| games.iter().map(|c| c.external))
        .collect();
    let mut details = crate::metadata::games_by_ids(conn, &ids)?;
    let rows: Vec<Value> = rows
        .into_iter()
        .map(|(mut row, games, reasons)| {
            row["games"] = games
                .into_iter()
                .filter_map(|c| {
                    let game = details.remove(&c.external)?;
                    Some(match reasons {
                        true => json!({"game": game, "reason": c.reason}),
                        false => json!({"game": game}),
                    })
                })
                .collect();
            row
        })
        .collect();
    Ok(json!({"rows": rows}))
}

/// Suggestions shown often and never opened lose up to three quarters of
/// their weight; a month without being shown restores them.
fn fatigue(conn: &Connection, profile: &str, now: DateTime<Utc>) -> Result<HashMap<String, f64>> {
    let mut stmt = conn
        .prepare("SELECT game_id,shown,opened,last_shown FROM recommendation_impressions WHERE profile_id=?1")
        .map_err(error)?;
    let rows = stmt
        .query_map([profile], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(error)?;
    let mut map = HashMap::new();
    for row in rows {
        let (id, shown, opened, last) = row.map_err(error)?;
        let stale = parse_time(Some(&last)).map_or(true, |at| (now - at).num_days() >= 30);
        let ignored = (shown - 2 * opened).clamp(0, 9) as i32;
        map.insert(id, if stale { 1.0 } else { 0.86f64.powi(ignored) });
    }
    Ok(map)
}

#[tauri::command]
pub async fn recommendations(app: tauri::AppHandle) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let now = Utc::now();
        let (signals, fatigue) = {
            let db = app.state::<Database>();
            let conn = db.read()?;
            let profile = crate::profiles::PLAYER;
            let mut signals = library_signals(&conn, now)?;
            signals.extend(event_signals(&conn, &profile, now)?);
            (merge(signals), fatigue(&conn, &profile, now)?)
        };
        if !signals.iter().any(|s| s.weight > 0.0) {
            return Ok(json!({"rows": []}));
        }
        crate::metadata::with_index(&app, |conn| build(conn, &signals, &fatigue))
    })
    .await
    .map_err(error)?
}

fn insert_event(
    conn: &Connection,
    profile: &str,
    game: &GameMetadata,
    kind: &str,
    amount: f64,
) -> Result<()> {
    let genres = clean_genres(game.genres.as_ref(), &game.genre);
    conn.execute(
        "INSERT INTO interest_events(profile_id,game_id,title,platform,genres,developer,kind,amount,at) \
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            profile,
            game.id,
            game.title,
            game.platform_id,
            serde_json::to_string(&genres).map_err(error)?,
            clean_developer(&game.developer),
            kind,
            amount,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(error)?;
    Ok(())
}

/// Time the player spent on a game's page, sent when they leave it.
#[tauri::command(async)]
pub fn interest_view(game: GameMetadata, seconds: f64, db: State<Database>) -> Result<()> {
    if !(3.0..=3600.0).contains(&seconds)
        || game.id.is_empty()
        || game.id.len() > 200
        || game.title.trim().is_empty()
        || game.title.len() > 300
    {
        return Ok(());
    }
    let conn = db.0.lock().map_err(error)?;
    let profile = crate::profiles::PLAYER;
    insert_event(&conn, &profile, &game, "view", seconds)
}

/// Notes a game leaving the library with how long it was played, before it goes.
pub fn record_removal(conn: &Connection, library_item_id: &str) -> Result<()> {
    let profile = crate::profiles::PLAYER;
    let row: Option<(String, i64)> = conn
        .query_row(
            "SELECT g.metadata, l.playtime FROM library_items l JOIN games g ON g.id=l.game_id \
             WHERE l.id=?1",
            [library_item_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(error)?;
    let Some((metadata, playtime)) = row else {
        return Ok(());
    };
    let game: GameMetadata = serde_json::from_str(&metadata).map_err(error)?;
    insert_event(conn, &profile, &game, "removed", playtime as f64)
}

/// Counts the suggestions on screen, at most once every six hours each, so
/// coming back to the page often does not wear them out.
#[tauri::command(async)]
pub fn recommendations_seen(ids: Vec<String>, db: State<Database>) -> Result<()> {
    if ids.len() > 200 {
        return Err("Recomendações demais de uma vez.".into());
    }
    let mut conn = db.0.lock().map_err(error)?;
    let profile = crate::profiles::PLAYER;
    let now = Utc::now();
    let recent = (now - chrono::Duration::hours(6)).to_rfc3339();
    let tx = conn.transaction().map_err(error)?;
    for id in ids.iter().filter(|id| !id.is_empty() && id.len() <= 200) {
        tx.execute(
            "INSERT INTO recommendation_impressions(profile_id,game_id,shown,last_shown) VALUES(?1,?2,1,?3) \
             ON CONFLICT(profile_id,game_id) DO UPDATE SET shown=shown+1,last_shown=excluded.last_shown \
             WHERE recommendation_impressions.last_shown < ?4",
            params![profile, id, now.to_rfc3339(), recent],
        )
        .map_err(error)?;
    }
    tx.commit().map_err(error)
}

/// A suggestion the player opened keeps its place.
#[tauri::command(async)]
pub fn recommendation_opened(id: String, db: State<Database>) -> Result<()> {
    let conn = db.0.lock().map_err(error)?;
    let profile = crate::profiles::PLAYER;
    conn.execute(
        "UPDATE recommendation_impressions SET opened=opened+1 WHERE profile_id=?1 AND game_id=?2",
        params![profile, id],
    )
    .map_err(error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signal(id: &str, genres: &[&str], weight: f64) -> Signal {
        Signal {
            id: id.into(),
            title: id.into(),
            platform: "snes".into(),
            genres: genres.iter().map(|g| g.to_string()).collect(),
            developer: None,
            year: 0,
            weight,
            at: Utc::now(),
            source: "downloaded",
            owned: true,
            removed: false,
        }
    }

    fn entry(title: &str, genre: &str, platform: &str) -> Entry {
        Entry {
            id: 1,
            title: title.into(),
            norm: normalize(title),
            platform: platform.into(),
            genres: vec![genre.into()],
            developer: None,
            year: 1995,
            players: 1,
            rating: None,
            count: 100,
            suggestable: true,
        }
    }

    fn candidate(title: &str, genre: &str, platform: &str, score: f64, explore: bool) -> Candidate {
        let mut c = Candidate::new(&entry(title, genre, platform), &HashMap::new()).unwrap();
        c.score = score;
        c.explore = explore;
        c
    }

    #[test]
    fn title_heads_drop_subtitles_and_sequel_numbers() {
        assert_eq!(title_head("Gran Turismo 2"), ["gran", "turismo"]);
        assert_eq!(title_head("Gran Turismo 3: A-Spec"), ["gran", "turismo"]);
        assert_eq!(title_head("Mega Man X"), ["mega", "man"]);
        assert_eq!(
            title_head("Legend of Zelda, The - A Link to the Past"),
            ["legend", "of", "zelda"]
        );
        assert_eq!(
            title_head("Street Fighter II Turbo"),
            ["street", "fighter", "ii", "turbo"]
        );
        assert!(matches_key("gran turismo 4", "gran turismo"));
        assert_eq!(
            franchise_name("The Legend of Zelda: A Link to the Past", "legend of zelda"),
            "The Legend of Zelda"
        );
        assert_eq!(franchise_name("Kirby's Adventure", "kirby s"), "Kirby's");
        assert_eq!(franchise_name("Super Mario Kart", "mario"), "Mario");
        assert_eq!(
            franchise_name("Super Mario Kart", "super mario"),
            "Super Mario"
        );
        assert!(matches_key("super mario world", "mario"));
        assert!(matches_key("new super mario bros", "mario"));
        assert!(!matches_key("super metroid", "mario"));
        assert!(COMMON_WORDS.contains(&"street") && !COMMON_WORDS.contains(&"mario"));
        assert_eq!(franchise_name("Pokémon Red Version", "pokemon"), "Pokémon");
        assert!(!matches_key("gran turismos", "gran turismo"));
    }

    #[test]
    fn removed_games_count_against_their_genres() {
        let profile = Profile::from(&[
            signal("a", &["Racing"], 4.0),
            signal("b", &["Racing", "Sports"], 2.0),
            signal("c", &["Horror"], -2.5),
        ]);
        assert!(profile.genres["Racing"] > profile.genres["Sports"]);
        assert!(profile.genres["Horror"] < 0.0);
        let positive: f64 = profile.genres.values().filter(|w| **w > 0.0).sum();
        assert!((positive - 1.0).abs() < 1e-9);
    }

    #[test]
    fn views_add_up_to_a_cap() {
        let mut views = vec![];
        for _ in 0..10 {
            let mut view = signal("lb-1", &["Racing"], 1.0);
            view.source = "viewed";
            view.owned = false;
            views.push(view);
        }
        let merged = merge(views);
        assert_eq!(merged.len(), 1);
        assert!((merged[0].weight - 2.5).abs() < 1e-9);
    }

    #[test]
    fn rerank_spreads_genres_and_saves_room_to_explore() {
        let names = [
            "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
        ];
        let mut pool: Vec<Candidate> = names
            .iter()
            .enumerate()
            .map(|(i, n)| {
                candidate(
                    &format!("Racer {n}"),
                    "Racing",
                    "psx",
                    1.0 - i as f64 * 0.01,
                    false,
                )
            })
            .collect();
        pool.extend(
            names[..4]
                .iter()
                .map(|n| candidate(&format!("Fighter {n}"), "Fighting", "psx", 0.5, false)),
        );
        pool.push(candidate("Puzzle", "Puzzle", "snes", 0.05, true));
        let row = rerank(pool, 10, Some(5), |_| 2.0);
        let racing = row.iter().filter(|c| c.primary == "Racing").count();
        assert!(racing >= 4 && racing <= 7, "{racing} racing games");
        assert!(row.iter().any(|c| c.primary == "Fighting"));
        assert_eq!(row[4].primary, "Puzzle");
        assert_eq!(row[0].norm, "racer alpha");
    }

    #[test]
    fn franchises_gather_series_prefixes_from_the_catalog() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE meta(key TEXT, value TEXT); INSERT INTO meta VALUES('built_at','1');
             CREATE TABLE games(id INTEGER, platform TEXT, name TEXT, year INTEGER, developer TEXT,
               genres TEXT, players INTEGER, rating REAL, rating_count INTEGER, release_type TEXT);
             CREATE TABLE images(id INTEGER, type TEXT);",
        )
        .unwrap();
        let titles = [
            "Super Mario Kart",
            "Super Mario World",
            "Mario Party",
            "New Super Mario Bros.",
            "Mario Lemieux Hockey Hack",
            "Super Metroid",
            "Metroid Fusion",
            "Street Fighter II",
            "Street Racer",
        ];
        for (i, title) in titles.iter().enumerate() {
            let kind = if title.ends_with("Hack") {
                "ROM Hack"
            } else {
                "Released"
            };
            conn.execute(
                "INSERT INTO games VALUES(?1,'snes',?2,1993,'Nintendo','Platform',1,4.0,?3,?4)",
                params![i as i64, title, 100 - i as i64, kind],
            )
            .unwrap();
            conn.execute("INSERT INTO images VALUES(?1,'Box - Front')", [i as i64])
                .unwrap();
        }
        let catalog = Snapshot::load(&conn, "1".into()).unwrap();
        assert_eq!(catalog.games.len(), titles.len() - 1, "hacks are left out");
        assert_eq!(
            franchise_key(&catalog, "Super Mario Kart").as_deref(),
            Some("mario")
        );
        let mario: Vec<&str> = catalog
            .franchise("mario")
            .iter()
            .map(|i| catalog.games[*i as usize].title.as_str())
            .collect();
        assert_eq!(
            mario,
            [
                "Super Mario Kart",
                "Super Mario World",
                "Mario Party",
                "New Super Mario Bros."
            ]
        );
        assert_eq!(
            franchise_key(&catalog, "Metroid Fusion").as_deref(),
            Some("metroid")
        );
        assert_eq!(franchise_key(&catalog, "Super Street Fighter II"), None);
    }

    #[test]
    fn demos_are_not_suggested() {
        let demo = entry("Gran Turismo 4: Prius Trial Version", "Racing", "ps2");
        assert!(Candidate::new(&demo, &HashMap::new()).is_none());
    }

    #[test]
    fn rerank_keeps_at_most_two_of_a_series() {
        let pool = (0..6)
            .map(|i| candidate(&format!("Gran Turismo {i}"), "Racing", "psx", 1.0, false))
            .collect();
        assert_eq!(rerank(pool, 6, None, |_| 6.0).len(), 2);
    }
}
