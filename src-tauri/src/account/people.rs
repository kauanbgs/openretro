//! Minimal authenticated discovery profiles; account credentials never cross IPC.
use super::*;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    id: String,
    display_name: Option<String>,
    friend_code: String,
    avatar: u8,
    relationship: String,
}
impl Person {
    fn valid(&self) -> bool {
        uuid::Uuid::parse_str(&self.id).is_ok()
            && self.display_name.as_ref().is_none_or(|name| {
                name.chars().count() <= 24 && !name.chars().any(char::is_control)
            })
            && super::social::valid_action("request", &self.friend_code)
            && self.avatar < AVATARS
            && ["none", "friend", "incoming", "outgoing"].contains(&self.relationship.as_str())
    }
    #[cfg(test)]
    fn parse(value: Value) -> AccountResult<Self> {
        let row: Self = serde_json::from_value(value).map_err(|_| AccountError::invalid())?;
        if !row.valid() {
            return Err(AccountError::invalid());
        }
        Ok(row)
    }
}
#[derive(Deserialize, Serialize)]
pub struct PeoplePage {
    people: Vec<Person>,
    next: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentGame {
    title: String,
    console: String,
    cover: Option<String>,
    last_played_at: i64,
    play_seconds: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    #[serde(flatten)]
    person: Person,
    is_self: bool,
    created_at: i64,
    history_visible: bool,
    recent_games: Vec<RecentGame>,
    presence: super::social::PresenceView,
}
impl Profile {
    fn parse(value: Value) -> AccountResult<Self> {
        let profile: Self = serde_json::from_value(value).map_err(|_| AccountError::invalid())?;
        let now = chrono::Utc::now().timestamp_millis();
        let mut games = std::collections::HashSet::new();
        if !profile.person.valid()
            || profile.created_at < 0
            || profile.created_at > now + 60000
            || !profile.presence.valid()
            || profile.recent_games.len() > 10
            || (!profile.history_visible && !profile.recent_games.is_empty())
            || profile.recent_games.iter().any(|g| {
                g.title.is_empty()
                    || g.title.chars().count() > 128
                    || g.title.chars().any(char::is_control)
                    || g.console.is_empty()
                    || g.console.chars().count() > 80
                    || g.console.chars().any(char::is_control)
                    || g.last_played_at < 0
                    || g.last_played_at > now + 60000
                    || g.play_seconds > 31 * 86400
                    || g.cover
                        .as_ref()
                        .is_some_and(|c| !super::social::safe_cover(c))
                    || !games.insert((&g.title, &g.console))
            })
        {
            return Err(AccountError::invalid());
        }
        Ok(profile)
    }
}
impl PeoplePage {
    fn parse(value: Value) -> AccountResult<Self> {
        let page: Self = serde_json::from_value(value).map_err(|_| AccountError::invalid())?;
        let mut ids = std::collections::HashSet::new();
        if page.people.len() > 24
            || page
                .people
                .iter()
                .any(|p| !p.valid() || !ids.insert(p.id.clone()))
            || page.next.as_ref().is_some_and(|id| {
                uuid::Uuid::parse_str(id).is_err()
                    || page.people.len() != 24
                    || page.people.last().is_none_or(|p| &p.id != id)
            })
        {
            return Err(AccountError::invalid());
        }
        Ok(page)
    }
}
fn people_path(after: Option<&str>) -> AccountResult<String> {
    match after {
        None => Ok("/api/friends/people".into()),
        Some(id) if uuid::Uuid::parse_str(id).is_ok() => {
            Ok(format!("/api/friends/people?after={id}"))
        }
        _ => Err(AccountError::invalid()),
    }
}
#[tauri::command]
pub async fn social_people(
    after: Option<String>,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<PeoplePage> {
    let path = people_path(after.as_deref())?;
    let _guard = gate.0.lock().await;
    PeoplePage::parse(service()?.authenticated(Method::GET, &path, None).await?)
}
#[tauri::command]
pub async fn social_person(
    user_id: String,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<Profile> {
    if uuid::Uuid::parse_str(&user_id).is_err() {
        return Err(AccountError::invalid());
    }
    let _guard = gate.0.lock().await;
    let profile = Profile::parse(
        service()?
            .authenticated(Method::GET, &format!("/api/friends/people/{user_id}"), None)
            .await?,
    )?;
    if profile.person.id != user_id {
        return Err(AccountError::invalid());
    }
    Ok(profile)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn row() -> Value {
        json!({"id":"11111111-1111-4111-8111-111111111111","displayName":"Marina","friendCode":"marina#ab12","avatar":3,"relationship":"none","email":"private@example.test","token":"never-expose","presence":{"playing":"private"}})
    }
    #[test]
    fn profile_history_is_bounded_validated_and_never_serializes_credentials() {
        let mut value = row();
        value["presence"] = json!({"status":"offline","playing":null,"party":null});
        value["isSelf"] = json!(false);
        value["createdAt"] = json!(0);
        value["historyVisible"] = json!(true);
        let game = json!({"title":"Mario","console":"SNES","cover":null,"lastPlayedAt":1,"playSeconds":20});
        value["recentGames"] = json!([game]);
        let serialized = serde_json::to_value(Profile::parse(value.clone()).unwrap()).unwrap();
        assert!(serialized.get("email").is_none());
        assert!(serialized.get("token").is_none());
        value["historyVisible"] = json!(false);
        assert!(Profile::parse(value.clone()).is_err());
        value["historyVisible"] = json!(true);
        value["recentGames"] = json!([game, game]);
        assert!(Profile::parse(value.clone()).is_err());
        value["recentGames"] = json!([{"title":"Mario","console":"SNES","cover":"file:///private","lastPlayedAt":1,"playSeconds":20}]);
        assert!(Profile::parse(value).is_err());
    }
    #[test]
    fn only_public_fields_are_serialized() {
        let serialized = serde_json::to_value(Person::parse(row()).unwrap()).unwrap();
        assert_eq!(serialized.as_object().unwrap().len(), 5);
        assert!(serialized.get("email").is_none());
        assert!(serialized.get("token").is_none());
        assert!(serialized.get("presence").is_none());
        let mut patch: ProfilePatch =
            serde_json::from_value(json!({"discoverable":false})).unwrap();
        patch.validate().unwrap();
        assert!(serde_json::from_value::<ProfilePatch>(json!({"discoverable":"false"})).is_err());
    }
    #[test]
    fn validates_network_profiles_pages_and_frontend_cursors() {
        for (field, value) in [
            ("id", json!("../x")),
            ("avatar", json!(15)),
            ("relationship", json!("blocked")),
            ("friendCode", json!("invalid")),
            ("displayName", json!("x\n")),
        ] {
            let mut invalid = row();
            invalid[field] = value;
            assert!(Person::parse(invalid).is_err());
        }
        assert!(PeoplePage::parse(json!({"people":[row()],"next":null})).is_ok());
        assert!(PeoplePage::parse(json!({"people":[row(),row()],"next":null})).is_err());
        assert!(PeoplePage::parse(json!({"people":[],"next":"bad"})).is_err());
        assert!(people_path(Some("../x?token=secret")).is_err());
        assert_eq!(people_path(None).unwrap(), "/api/friends/people");
    }
}
