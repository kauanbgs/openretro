use crate::database::{error, Database, Result};
use reqwest::blocking::Client;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

const FIELDS:&str="id,name,slug,summary,first_release_date,genres.id,genres.name,platforms.id,platforms.name,cover.image_id,total_rating,total_rating_count,artworks.image_id,screenshots.image_id";
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogRequest {
    kind: String,
    query: Option<String>,
    ids: Option<Vec<u64>>,
    page: Option<u32>,
    genre_id: Option<u64>,
    sort: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogReply {
    data: Value,
    has_next: bool,
    page: u32,
    remaining_allowance: Option<u64>,
}
struct Token {
    value: String,
    expires: Instant,
    fingerprint: String,
}
#[derive(Default)]
pub struct CatalogService(Mutex<CatalogState>);
#[derive(Default)]
struct CatalogState {
    last: Option<Instant>,
    token: Option<Token>,
}

fn credential(app: &tauri::AppHandle, name: &str) -> Option<String> {
    if let Ok(value) = std::env::var(name) {
        if !value.trim().is_empty() {
            return Some(value.trim().into());
        }
    }
    let mut paths = vec![];
    #[cfg(debug_assertions)]
    paths.push(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env.local"));
    if let Ok(dir) = app.path().app_data_dir() {
        paths.push(dir.join("providers.env"));
    }
    for path in paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            let values = dotenvy::from_read_iter(content.trim_start_matches('\u{feff}').as_bytes());
            for (key, value) in values.flatten() {
                if key == name && !value.trim().is_empty() {
                    return Some(value.trim().into());
                }
            }
        }
    }
    None
}
fn build_query(request: &CatalogRequest) -> Result<(&'static str, String)> {
    let page = request.page.unwrap_or(1);
    if page == 0 || page > 1000 {
        return Err("Invalid catalog page.".into());
    }
    let ids = request.ids.clone().unwrap_or_default();
    if ids.len() > 100 || ids.iter().any(|id| *id == 0 || *id > 9_007_199_254_740_991) {
        return Err("Invalid catalog identifiers.".into());
    }
    if request
        .genre_id
        .is_some_and(|id| id == 0 || id > 9_007_199_254_740_991)
    {
        return Err("Invalid genre.".into());
    }
    let sort = request.sort.as_deref().unwrap_or("popular");
    let order = match sort {
        "popular" => "total_rating_count desc",
        "rating" => "total_rating desc",
        "title" => "name asc",
        "newest" => "first_release_date desc",
        "oldest" => "first_release_date asc",
        _ => return Err("Invalid catalog sort order.".into()),
    };
    match request.kind.as_str() {
        "platforms" => {
            return Ok((
                "platforms",
                "fields id,name,slug,abbreviation; sort id asc; limit 500;".into(),
            ))
        }
        "genres" => return Ok(("genres", "fields id,name; sort name asc; limit 500;".into())),
        "game" => {
            if ids.len() != 1 {
                return Err("Choose one game.".into());
            }
            return Ok(("games",format!("fields {FIELDS},storyline,involved_companies.developer,involved_companies.company.name; where id = {}; limit 1;",ids[0])));
        }
        "games" => {}
        _ => return Err("Unsupported catalog operation.".into()),
    }
    if ids.is_empty() {
        return Err("Choose at least one supported console.".into());
    }
    let query = request.query.as_deref().unwrap_or("").trim();
    if query.chars().count() > 120 {
        return Err("Search must be 120 characters or fewer.".into());
    }
    let mut conditions = vec![format!(
        "platforms = ({})",
        ids.iter().map(u64::to_string).collect::<Vec<_>>().join(",")
    )];
    if let Some(genre) = request.genre_id {
        conditions.push(format!("genres = ({genre})"));
    }
    if query.is_empty() && sort == "rating" {
        conditions.push("total_rating_count >= 5".into());
    }
    let ordering = if query.is_empty() {
        format!("sort {order};")
    } else {
        format!("search {};", serde_json::to_string(query).map_err(error)?)
    };
    Ok((
        "games",
        format!(
            "fields {FIELDS}; {ordering} where {}; limit 25; offset {};",
            conditions.join(" & "),
            (page - 1) * 24
        ),
    ))
}
fn sanitize(body: Value, request: &CatalogRequest) -> Result<CatalogReply> {
    let array = body
        .as_array()
        .ok_or("IGDB returned an invalid response.")?;
    let browsing = request.kind == "games";
    let next = browsing && array.len() > 24;
    let data = if browsing {
        Value::Array(array.iter().take(24).cloned().collect())
    } else {
        body
    };
    let name = if request.kind == "game" {
        "games"
    } else {
        &request.kind
    };
    Ok(CatalogReply {
        data: json!({name:data}),
        has_next: next,
        page: request.page.unwrap_or(1),
        remaining_allowance: None,
    })
}
#[tauri::command]
pub fn igdb_status(app: tauri::AppHandle) -> Value {
    json!({"configured":credential(&app,"IGDB_CLIENT_ID").is_some()&&credential(&app,"IGDB_CLIENT_SECRET").is_some(),"provider":"igdb"})
}
#[tauri::command]
pub async fn igdb_query(app: tauri::AppHandle, request: CatalogRequest) -> Result<CatalogReply> {
    tauri::async_runtime::spawn_blocking(move||{
 let client_id=credential(&app,"IGDB_CLIENT_ID").ok_or("IGDB_NOT_CONFIGURED: Add IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to .env.local.")?;
 let secret=credential(&app,"IGDB_CLIENT_SECRET").ok_or("IGDB_NOT_CONFIGURED: Add IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to .env.local.")?;
 let (endpoint,query)=build_query(&request)?;let cache_key=format!("igdb:{:x}",Sha256::digest(format!("{endpoint}:{query}").as_bytes()));
 let service=app.state::<CatalogService>();let mut state=service.0.lock().map_err(error)?;let database=app.state::<Database>();let now=chrono::Utc::now().timestamp();
 {let conn=database.0.lock().map_err(error)?;let cached:Option<String>=conn.query_row("SELECT payload FROM metadata_cache WHERE cache_key=?1 AND expires_at>?2",params![cache_key,now],|r|r.get(0)).optional().map_err(error)?;if let Some(payload)=cached{if let Ok(reply)=serde_json::from_str(&payload){return Ok(reply);}}}
 let client=Client::builder().timeout(Duration::from_secs(20)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"The catalog network service could not be initialized.".to_string())?;
 let fingerprint=format!("{:x}",Sha256::digest(format!("{client_id}:{secret}").as_bytes()));
 for attempt in 0..2{
  let refresh=state.token.as_ref().is_none_or(|token|token.expires<=Instant::now()||token.fingerprint!=fingerprint);
  if refresh{
   // Credentials are sent in a POST body, never placed in a URL or log message.
   let response=client.post("https://id.twitch.tv/oauth2/token").form(&[("client_id",client_id.as_str()),("client_secret",secret.as_str()),("grant_type","client_credentials")]).send().map_err(|_|"Twitch authentication could not be reached. Check your connection.".to_string())?;
   if !response.status().is_success(){return Err("Twitch rejected the application credentials. Check Client ID and Client Secret, and use a Confidential application.".into());}
   let value:Value=response.json().map_err(|_|"Twitch returned an invalid authentication response.".to_string())?;
   let access=value.get("access_token").and_then(Value::as_str).ok_or("Twitch did not return an access token.")?;let expiry=value.get("expires_in").and_then(Value::as_u64).ok_or("Twitch did not return token expiry.")?;
   state.token=Some(Token{value:access.into(),expires:Instant::now()+Duration::from_secs(expiry.saturating_sub(60).min(31_536_000)),fingerprint:fingerprint.clone()});
  }
  if let Some(last)=state.last{let elapsed=last.elapsed();if elapsed<Duration::from_millis(300){std::thread::sleep(Duration::from_millis(300)-elapsed);}}state.last=Some(Instant::now());
  let access=&state.token.as_ref().ok_or("Authentication is unavailable.")?.value;
  let response=client.post(format!("https://api.igdb.com/v4/{endpoint}")).header("Client-ID",&client_id).bearer_auth(access).header("Content-Type","text/plain").body(query.clone()).send().map_err(|_|"IGDB could not be reached. Check your connection and try again.".to_string())?;
  if response.status().as_u16()==401&&attempt==0{state.token=None;continue;}
  match response.status().as_u16(){401|403=>return Err("IGDB rejected the credentials. Check your Twitch application settings.".into()),429=>return Err("IGDB rate limit reached. Wait a moment and try again.".into()),code if !(200..300).contains(&code)=>return Err(format!("IGDB could not complete this query (HTTP {code}). Try again later.")),_=>{}}
  let mut bytes=vec![];response.take(8_388_609).read_to_end(&mut bytes).map_err(|_|"IGDB response could not be read.".to_string())?;if bytes.len()>8_388_608{return Err("IGDB response exceeded the safe size limit.".into());}
  let body:Value=serde_json::from_slice(&bytes).map_err(|_|"IGDB returned an invalid response.".to_string())?;let reply=sanitize(body,&request)?;let ttl=if matches!(request.kind.as_str(),"platforms"|"genres"){604800}else{86400};
  {let conn=database.0.lock().map_err(error)?;conn.execute("DELETE FROM metadata_cache WHERE expires_at<=?1",[now]).map_err(error)?;conn.execute("INSERT INTO metadata_cache(cache_key,payload,expires_at) VALUES(?1,?2,?3) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at",params![cache_key,serde_json::to_string(&reply).map_err(error)?,now+ttl]).map_err(error)?;}
  return Ok(reply);
 }
 Err("IGDB authentication expired. Try again.".into())
 }).await.map_err(error)?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> CatalogRequest {
        CatalogRequest {
            kind: "games".into(),
            query: None,
            ids: Some(vec![18]),
            page: Some(1),
            genre_id: None,
            sort: None,
        }
    }
    #[test]
    fn validates_boundaries() {
        let mut r = request();
        assert!(build_query(&r).is_ok());
        r.page = Some(0);
        assert!(build_query(&r).is_err());
        r.page = Some(1);
        r.kind = "../../shell".into();
        assert!(build_query(&r).is_err());
    }
    #[test]
    fn escapes_search() {
        let mut r = request();
        r.query = Some("Sonic \"; where id > 0;".into());
        let (_, body) = build_query(&r).unwrap();
        assert!(body.contains("search \"Sonic \\\"; where id > 0;\";"));
    }
    #[test]
    fn filters_genres_on_the_server() {
        let mut r = request();
        r.genre_id = Some(8);
        r.page = Some(2);
        let (_, body) = build_query(&r).unwrap();
        assert!(body.contains("genres = (8)"));
        assert!(body.contains("offset 24;"));
    }
    #[test]
    fn bounds_pagination() {
        let value = sanitize(
            json!((1..=25).map(|id| json!({"id":id})).collect::<Vec<_>>()),
            &request(),
        )
        .unwrap();
        assert!(value.has_next);
        assert_eq!(value.data["games"].as_array().unwrap().len(), 24);
    }
}
