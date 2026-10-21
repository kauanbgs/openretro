use crate::database::{error, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    is_directory: bool,
}
#[derive(Serialize)]
pub struct Listing {
    path: String,
    parent: Option<String>,
    entries: Vec<Entry>,
    truncated: bool,
}
fn entry(path: PathBuf, name: String) -> Entry {
    Entry {
        is_directory: path.is_dir(),
        path: path.to_string_lossy().into_owned(),
        name,
    }
}

#[tauri::command]
pub async fn browse_files(
    path: Option<String>,
    query: Option<String>,
    directories_only: bool,
) -> Result<Listing> {
    tauri::async_runtime::spawn_blocking(move || {
        list(
            path.as_deref(),
            query.as_deref().unwrap_or(""),
            directories_only,
        )
    })
    .await
    .map_err(error)?
}
fn list(path: Option<&str>, query: &str, directories_only: bool) -> Result<Listing> {
    let query = query.to_lowercase();
    let Some(path) = path.filter(|path| !path.is_empty()) else {
        let mut entries = Vec::new();
        if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
            let home = PathBuf::from(home);
            entries.push(entry(home.clone(), "Pasta pessoal".into()));
            for name in ["Downloads", "Desktop", "Documents"] {
                if home.join(name).is_dir() {
                    entries.push(entry(home.join(name), name.into()));
                }
            }
        }
        #[cfg(windows)]
        for drive in b'A'..=b'Z' {
            let path = PathBuf::from(format!("{}:\\", drive as char));
            if path.is_dir() {
                entries.push(entry(path, format!("Disco {}:", drive as char)));
            }
        }
        #[cfg(not(windows))]
        entries.push(entry(PathBuf::from("/"), "Sistema de arquivos".into()));
        return Ok(Listing {
            path: String::new(),
            parent: None,
            entries,
            truncated: false,
        });
    };
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("Escolha uma pasta com caminho absoluto.".into());
    }
    let path = std::fs::canonicalize(path)
        .map_err(|_| "Não foi possível acessar esta pasta.".to_string())?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for item in std::fs::read_dir(&path).map_err(error)? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if !name.to_lowercase().contains(&query) {
            continue;
        }
        let path = item.path();
        if directories_only && !path.is_dir() {
            continue;
        }
        if entries.len() >= 500 {
            truncated = true;
            break;
        }
        entries.push(entry(path, name));
    }
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Listing {
        parent: path.parent().map(|p| p.to_string_lossy().into_owned()),
        path: path.to_string_lossy().into_owned(),
        entries,
        truncated,
    })
}

#[tauri::command]
pub async fn read_source_json(path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;
        let path = crate::filesystem::canonical_file(&path)?;
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        {
            return Err("Escolha um arquivo JSON.".into());
        }
        let file = std::fs::File::open(path).map_err(error)?;
        let mut bytes = Vec::new();
        file.take(16 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(error)?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("A fonte excede o limite de 16 MB.".into());
        }
        String::from_utf8(bytes).map_err(error)
    })
    .await
    .map_err(error)?
}

#[cfg(test)]
mod tests {
    #[test]
    fn filters_directories_and_searches_without_accepting_relative_paths() {
        let root = std::env::temp_dir().join(format!("openretro-browser-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("Games")).unwrap();
        std::fs::write(root.join("example.json"), "{}").unwrap();
        let listing = super::list(root.to_str(), "", true).unwrap();
        assert_eq!(listing.entries.len(), 1);
        assert!(listing.entries[0].is_directory);
        assert_eq!(
            super::list(root.to_str(), "EXAMPLE", false)
                .unwrap()
                .entries[0]
                .name,
            "example.json"
        );
        assert!(super::list(Some("relative/path"), "", false).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
