//! Reads the region, language and dump tags that No-Intro, Redump and
//! GoodTools put in ROM names, so downloads offer only English or Portuguese
//! releases and skip known bad dumps. Names without tags stay available.

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Fit {
    /// Portuguese, or a Brazilian release.
    Portuguese,
    /// English, or a North American or worldwide release.
    English,
    /// A European release without a language list, usually English.
    Europe,
    /// No region or language tag.
    Unknown,
    /// Only other languages or regions, or a bad dump.
    Rejected,
}

#[derive(Default)]
struct Tags {
    languages: Vec<Fit>,
    translation: Option<Fit>,
    regions: Vec<Fit>,
    bad_dump: bool,
}

fn language(code: &str) -> Option<Fit> {
    let code = code.split(['-', '_']).next().unwrap_or(code);
    Some(match code {
        "en" | "eng" | "english" => Fit::English,
        "pt" | "por" | "ptbr" | "portuguese" | "portugues" | "brazilian" => Fit::Portuguese,
        "ja" | "jp" | "jpn" | "fr" | "fre" | "de" | "ger" | "es" | "spa" | "it" | "ita" | "nl"
        | "sv" | "no" | "da" | "fi" | "zh" | "chi" | "ko" | "kor" | "pl" | "ru" | "rus"
        | "el" | "ca" | "hu" | "cs" | "tr" | "ar" => Fit::Rejected,
        _ => return None,
    })
}

fn region(name: &str) -> Option<Fit> {
    Some(match name {
        "brazil" | "brasil" | "br" | "portugal" => Fit::Portuguese,
        "usa" | "us" | "world" | "uk" | "united kingdom" | "canada" | "australia"
        | "new zealand" | "ntsc-u" | "ntsc-us" | "ntsc-uc" => Fit::English,
        "europe" | "eu" | "pal" | "pal-e" => Fit::Europe,
        "japan" | "jpn" | "ntsc-j" | "ntsc-jp" | "korea" | "china" | "taiwan" | "hong kong"
        | "asia" | "france" | "germany" | "spain" | "italy" | "netherlands" | "sweden"
        | "russia" | "poland" | "scandinavia" | "latin america" | "mexico" => Fit::Rejected,
        _ => return None,
    })
}

/// GoodTools abbreviates regions to letters, as in "(U)", "(J)" or "(JU)".
fn good_tools(token: &str) -> Option<Vec<Fit>> {
    if token.is_empty() || token.len() > 3 || !token.bytes().all(|b| b.is_ascii_uppercase()) {
        return None;
    }
    token
        .chars()
        .map(|c| match c {
            'B' => Some(Fit::Portuguese),
            'U' | 'W' | 'A' => Some(Fit::English),
            'E' => Some(Fit::Europe),
            'J' | 'K' | 'C' | 'F' | 'G' | 'S' | 'I' => Some(Fit::Rejected),
            _ => None,
        })
        .collect()
}

fn tags(title: &str) -> Tags {
    let mut tags = Tags::default();
    let mut rest = title;
    while let Some(start) = rest.find(['(', '[']) {
        let close = if rest.as_bytes()[start] == b'(' { ')' } else { ']' };
        let Some(length) = rest[start + 1..].find(close) else {
            break;
        };
        let group = &rest[start + 1..start + 1 + length];
        rest = &rest[start + 2 + length..];
        let lower = group.trim().to_lowercase();
        // "[b]", "[b1]" and "[b2 bad]" mark known bad dumps.
        if lower == "b" || (lower.starts_with('b') && lower[1..].starts_with(|c: char| c.is_ascii_digit())) {
            tags.bad_dump = true;
            continue;
        }
        // Fan translations: "[T-En by X]", "[T+Eng]", "(Traducido Pt)", "[T+Por_BR]".
        let translated = lower
            .strip_prefix("t+")
            .or_else(|| lower.strip_prefix("t-"))
            .or_else(|| lower.strip_prefix("traducido "))
            .or_else(|| lower.strip_prefix("traduzido "))
            .or_else(|| lower.strip_prefix("translated "));
        if let Some(translated) = translated {
            let code = translated.split_whitespace().next().unwrap_or("");
            let code = code.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.');
            if let Some(fit) = language(&code.replace('_', "-")) {
                tags.translation = Some(fit);
            }
            continue;
        }
        if region(&lower).is_none() {
            if let Some(found) = good_tools(group.trim()) {
                tags.regions.extend(found);
                continue;
            }
        }
        let parts: Vec<&str> = lower.split([',', '+']).map(str::trim).collect();
        let found: Vec<Fit> = parts.iter().filter_map(|p| language(p)).collect();
        // A group counts as a language list only when every part is a language.
        if !found.is_empty() && found.len() == parts.len() && parts.iter().all(|p| p.len() <= 5) {
            tags.languages.extend(found);
            continue;
        }
        tags.regions.extend(parts.iter().filter_map(|p| region(p)));
    }
    tags
}

/// How well a download name fits a Portuguese or English player.
pub fn fit(title: &str) -> Fit {
    let tags = tags(title);
    if tags.bad_dump {
        return Fit::Rejected;
    }
    // A translation patch, then an explicit language list, decide over the region.
    if let Some(translation) = tags.translation {
        return translation;
    }
    let best = |found: &[Fit]| found.iter().copied().filter(|f| *f != Fit::Rejected).min();
    if !tags.languages.is_empty() {
        return best(&tags.languages).unwrap_or(Fit::Rejected);
    }
    if !tags.regions.is_empty() {
        return best(&tags.regions).unwrap_or(Fit::Rejected);
    }
    Fit::Unknown
}

pub fn accepted(title: &str) -> bool {
    fit(title) != Fit::Rejected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_english_and_portuguese_releases() {
        for (title, expected) in [
            ("Super Metroid (Japan, USA) (En,Ja)", Fit::English),
            ("Pokemon - Emerald Version (USA, Europe)", Fit::English),
            ("Sonic the Hedgehog (Brazil)", Fit::Portuguese),
            ("FIFA 2005 (Europe) (En,Fr,De,Pt)", Fit::Portuguese),
            ("Mother 3 (Japan) [T-En by Tomato]", Fit::English),
            ("Tales of Phantasia (Japan) [T+Por_BR]", Fit::Portuguese),
            ("Street Fighter II (U) [!]", Fit::English),
            ("Gran Turismo 4 (Europe)", Fit::Europe),
            ("Final Fantasy VII (Disc 1) [NTSC-U]", Fit::English),
            ("Doom", Fit::Unknown),
            ("Tetris (Rev 1)", Fit::Unknown),
        ] {
            assert_eq!(fit(title), expected, "{title}");
        }
    }

    #[test]
    fn rejects_japanese_other_languages_and_bad_dumps() {
        for title in [
            "Super Mario Bros. (Japan)",
            "Rockman X (J)",
            "Dragon Quest V (Japan) (Ja)",
            "Asterix (Europe) (Fr,De)",
            "Gran Turismo (NTSC-J)",
            "Super Mario World (U) [b1]",
            "Pokemon Gold (Korea)",
        ] {
            assert!(!accepted(title), "{title}");
        }
    }

    #[test]
    fn ranks_portuguese_then_english_then_europe_then_untagged() {
        let mut titles = ["Game (Europe)", "Game", "Game (USA)", "Game (Brazil)"];
        titles.sort_by_key(|t| fit(t));
        assert_eq!(titles, ["Game (Brazil)", "Game (USA)", "Game (Europe)", "Game"]);
    }
}
