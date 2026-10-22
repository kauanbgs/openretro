//! The commands a paired phone may run. The phone shows the same interface as
//! the PC, so it sends the same command names, but only these are allowed:
//! browsing, downloading into the PC's configured folder, the library and
//! starting games. Choosing files, configuring emulators and deleting games
//! stay on the PC.
use crate::database::{Database, Result};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tauri::Manager;

fn take<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|_| format!("Pedido inválido: {key}."))
}

fn to_json<T: serde::Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

/// Downloads started from a phone always go to the folder set on the PC.
fn configured_download_directory(app: &tauri::AppHandle) -> Option<String> {
    crate::commands::get_settings(app.state::<Database>())
        .ok()?
        .get("downloadDirectory")?
        .as_str()
        .filter(|directory| !directory.is_empty())
        .map(String::from)
}

pub async fn invoke(app: &tauri::AppHandle, command: &str, args: Value) -> Result<Value> {
    let app = app.clone();
    let db = || app.state::<Database>();
    match command {
        "catalog_status" => to_json(crate::metadata::catalog_status(app.clone())?),
        "catalog_genres" => to_json(crate::metadata::catalog_genres(app.clone()).await?),
        "catalog_browse" => to_json(
            crate::metadata::catalog_browse(
                app.clone(),
                take(&args, "query")?,
                take(&args, "platform")?,
                take(&args, "page")?,
                take(&args, "genreId")?,
                take(&args, "sort")?,
            )
            .await?,
        ),
        "catalog_game" => to_json(crate::metadata::catalog_game(app.clone(), take(&args, "id")?).await?),
        "catalog_thumbnail" => {
            to_json(crate::metadata::catalog_thumbnail(app.clone(), take(&args, "url")?).await?)
        }
        "list_library" => to_json(crate::commands::list_library(db())?),
        "list_emulators" => to_json(crate::commands::list_emulators(db())?),
        "get_settings" => to_json(crate::commands::get_settings(db())?),
        "file_exists" => to_json(crate::commands::file_exists(take(&args, "path")?)),
        "set_favorite" => to_json(crate::commands::set_favorite(
            take(&args, "id")?,
            take(&args, "favorite")?,
            db(),
        )?),
        "list_profiles" => to_json(crate::profiles::list_profiles(db())?),
        "select_profile" => to_json(crate::profiles::select_profile(take(&args, "id")?, db())?),
        "runtime_bios_status" => to_json(crate::launcher::bios::runtime_bios_status(
            app.clone(),
            take(&args, "platform")?,
        )?),
        "list_save_states" => to_json(
            crate::launcher::save_states::list_save_states(app.clone(), take(&args, "id")?).await?,
        ),
        "in_game_status" => to_json(crate::in_game::in_game_status(app.clone())?),
        "search_download_sources" => to_json(
            crate::downloads::sources::search_download_sources(app.clone(), take(&args, "query")?)
                .await?,
        ),
        "available_download_titles" => to_json(
            crate::downloads::sources::available_download_titles(
                app.clone(),
                take(&args, "titles")?,
            )
            .await?,
        ),
        "list_download_sources" => to_json(crate::downloads::sources::list_download_sources(db())?),
        "list_download_jobs" => to_json(crate::downloads::list_download_jobs(db())?),
        "start_source_download" => {
            let directory = configured_download_directory(&app);
            to_json(
                crate::downloads::start_source_download(
                    app.clone(),
                    take(&args, "sourceId")?,
                    take(&args, "entryId")?,
                    take(&args, "uriIndex")?,
                    take(&args, "game")?,
                    directory,
                    take(&args, "autoExtract")?,
                    take(&args, "autoAddToLibrary")?,
                )
                .await?,
            )
        }
        "control_download" => to_json(
            crate::downloads::control_download(app.clone(), take(&args, "id")?, take(&args, "action")?)
                .await?,
        ),
        "remove_download" => {
            to_json(crate::downloads::remove_download(app.clone(), take(&args, "id")?).await?)
        }
        // Only the download's own file; picking another path is a PC task.
        "add_download_to_library" => to_json(crate::downloads::add_download_to_library(
            app.clone(),
            take(&args, "id")?,
            None,
        )?),
        // The game runs on the PC; the phone switches to the game screen
        // right away instead of waiting for the session to end.
        "launch_game" => {
            let (id, slot): (String, Option<i32>) = (take(&args, "id")?, take(&args, "slot")?);
            if crate::in_game::in_game_status(app.clone())?.is_some() {
                return Err("Um jogo já está aberto no computador.".into());
            }
            let launcher = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::launcher::launch_game(launcher, id, slot, None).await {
                    log::warn!("Phone launch: {e}");
                }
            });
            Ok(json!(0))
        }
        _ => Err("Esta ação só está disponível no computador.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_are_read_by_name() {
        let args = json!({ "id": "abc", "page": 2 });
        assert_eq!(take::<String>(&args, "id").unwrap(), "abc");
        assert_eq!(take::<Option<i64>>(&args, "genreId").unwrap(), None);
        assert!(take::<String>(&args, "missing").is_err());
    }
}
