//! Authenticated social transport. Session credentials never cross the IPC boundary.
use super::*;
use futures_util::{SinkExt, StreamExt};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::{
    client::IntoClientRequest, protocol::WebSocketConfig, Message,
};

#[derive(Default)]
pub struct Social(Mutex<State>);
#[derive(Default)]
struct State {
    game: Option<Value>,
    history: Option<super::history::Recording>,
    party: Option<Party>,
    party_revision: u64,
    idle: bool,
    sender: Option<watch::Sender<Value>>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}
impl State {
    fn presence(&self) -> Value {
        json!({"type":"presence","presence":{"status":if self.idle && self.game.is_none(){"idle"}else{"online"},"playing":self.game,"party":self.party}})
    }
    fn publish(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.send(self.presence());
        }
    }
    fn stop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        self.sender = None;
    }
}
pub fn game(app: &tauri::AppHandle, activity: Option<&Value>) {
    if let Ok(mut state) = app.state::<Social>().0.lock() {
        if let Some(recording) = state.history.take() {
            recording.finish();
        }
        state.game = activity.map(game_view);
        state.history = state.game.as_ref().and_then(super::history::Recording::start);
        state.publish();
    }
}
fn game_view(activity: &Value) -> Value {
    let cover = activity["assets"]["large_image"]
        .as_str()
        .filter(|s| safe_cover(s));
    json!({"title":activity["details"],"console":activity["state"],"cover":cover,
        "startedAt":activity["timestamps"]["start"].as_i64().unwrap_or(0)*1000})
}
pub(super) fn safe_cover(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| {
        value.len() <= 1024
            && url.scheme() == "https"
            && matches!(
                url.host_str(),
                Some("images.igdb.com" | "images.launchbox-app.com")
            )
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    id: String,
    display_name: Option<String>,
    friend_code: String,
    #[serde(default)]
    avatar: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    presence: Option<PresenceView>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Playing {
    title: String,
    console: String,
    cover: Option<String>,
    started_at: i64,
}
#[derive(Deserialize, Serialize)]
struct Party {
    code: String,
    joinable: bool,
}
#[derive(Deserialize, Serialize)]
pub(super) struct PresenceView {
    status: String,
    playing: Option<Playing>,
    party: Option<Party>,
}
impl PresenceView {
    pub(super) fn valid(&self) -> bool {
        ["online", "idle", "offline"].contains(&self.status.as_str())
            && self.playing.as_ref().is_none_or(|g| {
                !g.title.is_empty()
                    && g.title.chars().count() <= 128
                    && !g.console.is_empty()
                    && g.console.chars().count() <= 80
                    && g.started_at >= 0
                    && g.cover.as_ref().is_none_or(|c| safe_cover(c))
            })
            && self.party.as_ref().is_none_or(|p| {
                p.code.len() == 6
                    && p.code
                        .bytes()
                        .all(|b| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b))
            })
    }
}
#[derive(Deserialize, Serialize)]
pub struct Friends {
    friends: Vec<Friend>,
    incoming: Vec<Friend>,
    outgoing: Vec<Friend>,
    blocked: Vec<Friend>,
}
impl Friends {
    fn parse(value: Value) -> AccountResult<Self> {
        let data: Self = serde_json::from_value(value).map_err(|_| AccountError::invalid())?;
        if [&data.friends, &data.incoming, &data.outgoing, &data.blocked]
            .iter()
            .any(|rows| {
                rows.len() > 1000
                    || rows.iter().any(|f| {
                        uuid::Uuid::parse_str(&f.id).is_err()
                            || f.display_name
                                .as_ref()
                                .is_some_and(|s| s.chars().count() > 24)
                            || f.friend_code.len() > 64
                            || f.avatar >= super::AVATARS
                            || f.presence.as_ref().is_some_and(|p| !p.valid())
                    })
            })
        {
            return Err(AccountError::invalid());
        }
        Ok(data)
    }
}
#[tauri::command]
pub async fn social_friends(gate: tauri::State<'_, AccountGate>) -> AccountResult<Friends> {
    let _guard = gate.0.lock().await;
    Friends::parse(
        service()?
            .authenticated(Method::GET, "/api/friends", None)
            .await?,
    )
}
pub(super) fn valid_action(action: &str, target: &str) -> bool {
    if action == "request" {
        let Some((name, tag)) = target.split_once('#') else {
            return false;
        };
        // The part before the # is the player's simplified name (friend-code.mjs).
        (1..=16).contains(&name.len())
            && name
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            && tag.len() == 4
            && tag
                .bytes()
                .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase())
    } else {
        ["accept", "decline", "cancel", "remove", "block", "unblock"].contains(&action)
            && uuid::Uuid::parse_str(target).is_ok()
    }
}
#[tauri::command]
pub async fn social_action(
    action: String,
    target: String,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<()> {
    let target = target.trim().to_ascii_lowercase();
    if !valid_action(&action, &target) {
        return Err(AccountError::new(
            "invalid",
            "Confira o código de amigo e a ação escolhida.",
        ));
    }
    let _guard = gate.0.lock().await;
    service()?
        .authenticated(
            Method::POST,
            "/api/friends/action",
            Some(json!({"action":action,"target":target})),
        )
        .await?;
    Ok(())
}
#[tauri::command]
pub fn social_stop(state: tauri::State<'_, Social>) {
    if let Ok(mut state) = state.0.lock() {
        state.stop();
    }
}
pub fn stop(app: &tauri::AppHandle) {
    if let Ok(mut state) = app.state::<Social>().0.lock() {
        state.party = None;
        state.party_revision = state.party_revision.wrapping_add(1);
        state.stop();
    }
}
fn valid_room(code: &str) -> bool {
    code.len() == 6
        && code
            .bytes()
            .all(|b| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b))
}
/// Reserves a Party room with the account's session. Party is not anonymous,
/// and the session never reaches JavaScript, so the room is reserved here.
#[tauri::command]
pub async fn social_party_reserve(gate: tauri::State<'_, AccountGate>) -> AccountResult<Value> {
    let _guard = gate.0.lock().await;
    let reservation = service()?
        .authenticated(Method::POST, "/api/rooms", Some(json!({})))
        .await?;
    match (reservation["code"].as_str(), reservation["ticket"].as_str()) {
        (Some(code), Some(ticket)) if valid_room(code) && valid_token(ticket) => {
            Ok(json!({ "code": code, "ticket": ticket }))
        }
        _ => Err(AccountError::invalid()),
    }
}
#[tauri::command]
pub async fn social_party(
    code: String,
    ticket: String,
    joinable: bool,
    gate: tauri::State<'_, AccountGate>,
    state: tauri::State<'_, Social>,
) -> AccountResult<()> {
    if !valid_room(&code) || !valid_token(&ticket) {
        return Err(AccountError::new("invalid", "Dados do Party inválidos."));
    }
    let _guard = gate.0.lock().await;
    let revision = state
        .0
        .lock()
        .map_err(|_| AccountError::invalid())?
        .party_revision;
    service()?
        .authenticated(
            Method::POST,
            "/api/friends/party/host",
            Some(json!({"code":code,"ticket":ticket,"joinable":joinable})),
        )
        .await?;
    let mut state = state.0.lock().map_err(|_| AccountError::invalid())?;
    if state.party_revision != revision {
        return Ok(());
    }
    state.party = joinable.then_some(Party {
        code,
        joinable: true,
    });
    state.publish();
    Ok(())
}
#[tauri::command]
pub fn social_party_clear(state: tauri::State<'_, Social>) {
    if let Ok(mut state) = state.0.lock() {
        state.party_revision = state.party_revision.wrapping_add(1);
        state.party = None;
        state.publish();
    }
}
fn join_url(origin: &Url, code: &str, invite: &str) -> AccountResult<Url> {
    parse_origin(origin.as_str())?;
    let Some((payload, signature)) = invite.split_once('.') else {
        return Err(AccountError::invalid());
    };
    if !valid_room(code)
        || invite.len() > 2048
        || payload.is_empty()
        || !payload
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        || !valid_token(signature)
    {
        return Err(AccountError::invalid());
    }
    let mut url = origin
        .join(&format!("/party/{code}"))
        .map_err(|_| AccountError::invalid())?;
    url.set_fragment(Some(&format!("t={invite}")));
    Ok(url)
}
#[derive(Serialize)]
pub struct GuestRoom {
    code: String,
    invite: String,
    signal: String,
}
impl GuestRoom {
    fn parse(origin: &Url, value: &Value) -> AccountResult<Self> {
        let code = value["code"].as_str().ok_or_else(AccountError::invalid)?;
        let invite = value["invite"].as_str().ok_or_else(AccountError::invalid)?;
        join_url(origin, code, invite)?;
        let mut signal = origin
            .join("/signal")
            .map_err(|_| AccountError::invalid())?;
        signal
            .set_scheme(if origin.scheme() == "https" {
                "wss"
            } else {
                "ws"
            })
            .map_err(|_| AccountError::invalid())?;
        signal.query_pairs_mut().append_pair("room", code);
        // Only this explicit capability crosses IPC, never the authenticated response.
        Ok(Self {
            code: code.into(),
            invite: invite.into(),
            signal: signal.into(),
        })
    }
}
#[tauri::command]
pub fn social_game_busy(app: tauri::AppHandle) -> AccountResult<bool> {
    let social = app.state::<Social>();
    let playing = social
        .0
        .lock()
        .map_err(|_| AccountError::invalid())?
        .game
        .is_some();
    // External emulators publish activity too, but do not reserve an embedded runtime.
    Ok(playing
        || crate::in_game::in_game_status(app.clone())
            .map_err(|_| AccountError::invalid())?
            .is_some())
}
#[tauri::command]
pub async fn social_join_room(
    friend_id: String,
    app: tauri::AppHandle,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<GuestRoom> {
    if uuid::Uuid::parse_str(&friend_id).is_err() {
        return Err(AccountError::new("invalid", "Jogador inválido."));
    }
    if social_game_busy(app)? {
        return Err(AccountError::new(
            "busy",
            "Feche o jogo para entrar no Party.",
        ));
    }
    let _guard = gate.0.lock().await;
    let service = service()?;
    let value = service
        .authenticated(
            Method::POST,
            "/api/friends/party/join",
            Some(json!({"friendId":friend_id})),
        )
        .await?;
    GuestRoom::parse(&service.origin, &value)
}
#[tauri::command]
pub async fn social_join(
    friend_id: String,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<()> {
    if uuid::Uuid::parse_str(&friend_id).is_err() {
        return Err(AccountError::new("invalid", "Jogador inválido."));
    }
    let _guard = gate.0.lock().await;
    let service = service()?;
    let value = service
        .authenticated(
            Method::POST,
            "/api/friends/party/join",
            Some(json!({"friendId":friend_id})),
        )
        .await?;
    let code = value["code"].as_str().ok_or_else(AccountError::invalid)?;
    let invite = value["invite"].as_str().ok_or_else(AccountError::invalid)?;
    let url = join_url(&service.origin, code, invite)?;
    open_external(url.as_str())
}
#[tauri::command]
pub fn social_idle(idle: bool, state: tauri::State<'_, Social>) {
    if let Ok(mut state) = state.0.lock() {
        if state.idle != idle {
            state.idle = idle;
            state.publish();
        }
    }
}
#[tauri::command]
pub fn social_start(app: tauri::AppHandle, state: tauri::State<'_, Social>) -> AccountResult<()> {
    // Validate the fixed service before starting a reconnecting background task.
    service()?.token()?;
    let mut state = state.0.lock().map_err(|_| AccountError::invalid())?;
    state.stop();
    let (sender, receiver) = watch::channel(state.presence());
    state.sender = Some(sender);
    state.task = Some(tauri::async_runtime::spawn(run(app, receiver)));
    Ok(())
}
fn emit(app: &tauri::AppHandle, value: Value) {
    let _ = app.emit("social-event", value);
}
async fn run(app: tauri::AppHandle, mut wanted: watch::Receiver<Value>) {
    let mut delay = 1u64;
    loop {
        let Ok(service) = service() else {
            return;
        };
        let Ok(token) = service.token() else {
            emit(&app, json!({"type":"disconnected"}));
            return;
        };
        let mut url = service.origin.join("/social").unwrap();
        let _ = url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" });
        let Ok(mut request) = url.as_str().into_client_request() else {
            return;
        };
        let Ok(header) = format!("Bearer {token}").parse() else {
            return;
        };
        request.headers_mut().insert("Authorization", header);
        let config = WebSocketConfig::default()
            .max_message_size(Some(65536))
            .max_frame_size(Some(65536));
        let connected = tokio::time::timeout(
            Duration::from_secs(12),
            tokio_tungstenite::connect_async_with_config(request, Some(config), false),
        )
        .await;
        match connected {
            Ok(Ok((mut socket, _))) => {
                delay = 1;
                emit(&app, json!({"type":"connected"}));
                let current = wanted.borrow_and_update().clone().to_string();
                if socket.send(Message::Text(current.into())).await.is_err() {
                    continue;
                }
                let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
                let mut last_response = std::time::Instant::now();
                loop {
                    tokio::select! {
                        changed=wanted.changed()=>{
                            if changed.is_err(){let _=socket.close(None).await;return;}
                            let value=wanted.borrow_and_update().clone().to_string();
                            if socket.send(Message::Text(value.into())).await.is_err(){break;}
                        }
                        _=heartbeat.tick()=>{
                            if last_response.elapsed()>Duration::from_secs(75){break;}
                            if socket.send(Message::Text("{\"type\":\"heartbeat\"}".into())).await.is_err(){break;}
                        }
                        message=socket.next()=>{
                            match message {
                                Some(Ok(Message::Text(text)))=>{
                                    last_response=std::time::Instant::now();
                                    if let Ok(value)=serde_json::from_str::<Value>(&text) {
                                        // Whitelist and deserialize every field before exposing a network event.
                                        match value["type"].as_str() {
                                            Some("expired")=>{
                                                if service.vault.read().ok().flatten().as_ref()==Some(&token){let _=service.vault.clear();}
                                                emit(&app,json!({"type":"expired"}));let _=socket.close(None).await;return;
                                            }
                                            Some("presence")=>{
                                                if let (Some(id),Ok(presence))=(value["id"].as_str(),serde_json::from_value::<PresenceView>(value["presence"].clone())) {
                                                    if uuid::Uuid::parse_str(id).is_ok() && presence.valid(){emit(&app,json!({"type":"presence","id":id,"presence":presence}));}
                                                }
                                            }
                                            Some("message")=>{
                                                if let Some(peer)=value["peer"].as_str().filter(|id|uuid::Uuid::parse_str(id).is_ok()) {emit(&app,json!({"type":"message","peer":peer}));}
                                            }
                                            Some("changed")=>{
                                                let reason=value["reason"].as_str().filter(|v|["request","accepted","changed"].contains(v)).unwrap_or("changed");
                                                emit(&app,json!({"type":"changed","reason":reason}));
                                            }
                                            _=>{}
                                        }
                                    }
                                }
                                Some(Ok(Message::Ping(bytes)))=>{ last_response=std::time::Instant::now();if socket.send(Message::Pong(bytes)).await.is_err(){break;} }
                                Some(Ok(Message::Pong(_)))=>{last_response=std::time::Instant::now();}
                                _=>break,
                            }
                        }
                    }
                }
            }
            Ok(Err(tokio_tungstenite::tungstenite::Error::Http(response)))
                if response.status().as_u16() == 401 =>
            {
                if service.vault.read().ok().flatten().as_ref() == Some(&token) {
                    let _ = service.vault.clear();
                }
                emit(&app, json!({"type":"expired"}));
                return;
            }
            _ => {}
        }
        emit(&app, json!({"type":"disconnected"}));
        // Backoff has bounded jitter so multiple clients do not reconnect in lockstep.
        let jitter = uuid::Uuid::new_v4().as_bytes()[0] as u64 * 4;
        tokio::time::sleep(Duration::from_millis(delay * 1000 + jitter)).await;
        delay = (delay * 2).min(60);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn guest_room_validates_capability_and_serializes_only_the_join_fields() {
        let invite = format!("eyJ2IjoxfQ.{}", "a".repeat(64));
        let value = json!({"code":"ABC234","invite":invite,"token":"never-expose","signal":"wss://evil.test"});
        for (origin, expected) in [
            (
                "https://party.example.test",
                "wss://party.example.test/signal?room=ABC234",
            ),
            (
                "http://127.0.0.1:8787",
                "ws://127.0.0.1:8787/signal?room=ABC234",
            ),
        ] {
            let room = GuestRoom::parse(&Url::parse(origin).unwrap(), &value).unwrap();
            let serialized = serde_json::to_value(room).unwrap();
            assert_eq!(
                serialized,
                json!({"code":"ABC234","invite":invite,"signal":expected})
            );
        }
        for origin in [
            "http://evil.test",
            "https://user:pass@party.test",
            "https://party.test/path",
            "https://party.test/?token=secret",
            "https://party.test/#secret",
        ] {
            assert!(GuestRoom::parse(&Url::parse(origin).unwrap(), &value).is_err());
        }
        let origin = parse_origin("https://party.test").unwrap();
        for invalid in [
            json!({}),
            json!({"code":12,"invite":invite}),
            json!({"code":"ABC23I","invite":invite}),
            json!({"code":"ABC234","invite":"x.a"}),
            json!({"code":"ABC234","invite":format!("{}.{}", "x".repeat(2048), "a".repeat(64))}),
        ] {
            assert!(GuestRoom::parse(&origin, &invalid).is_err());
        }
    }
    #[test]
    fn party_url_keeps_invitation_in_fragment_on_the_configured_origin() {
        let origin = parse_origin("https://party.example.test").unwrap();
        let invite = format!("eyJ2IjoxfQ.{}", "a".repeat(64));
        let url = join_url(&origin, "ABC234", &invite).unwrap();
        assert_eq!(url.origin(), origin.origin());
        assert_eq!(url.path(), "/party/ABC234");
        assert!(url.query().is_none());
        assert_eq!(url.fragment(), Some(format!("t={invite}").as_str()));
        for (code, token) in [
            ("../x", invite.as_str()),
            ("ABC234", "https://evil.test"),
            ("ABC234", "x.a"),
            (
                "ABC234",
                "x/unsafe.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
        ] {
            assert!(join_url(&origin, code, token).is_err());
        }
        let state = State {
            party: Some(Party {
                code: "ABC234".into(),
                joinable: true,
            }),
            ..State::default()
        };
        assert_eq!(state.presence()["presence"]["party"]["code"], "ABC234");
    }
    #[test]
    fn validate_friend_actions_and_presence() {
        assert!(valid_action("request", "jogador#ab12"));
        assert!(valid_action("request", "kauaplaza#ab12"));
        assert!(valid_action("request", "ab#ab12"));
        assert!(!valid_action("request", "x#bad"));
        assert!(!valid_action("request", "kaua plaza#ab12"));
        assert!(!valid_action(
            "request",
            &format!("{}#ab12", "a".repeat(17))
        ));
        assert!(!valid_action(
            "shell",
            "123e4567-e89b-42d3-a456-426614174000"
        ));
        assert!(valid_action(
            "block",
            "123e4567-e89b-42d3-a456-426614174000"
        ));
        assert!(safe_cover(
            "https://images.igdb.com/igdb/image/upload/t_cover_big/test.jpg"
        ));
        assert!(!safe_cover("https://images.igdb.com.evil.test/test.jpg"));
        assert!(!safe_cover("https://user@images.igdb.com/test.jpg"));
        let game = game_view(&crate::discord::activity(
            "Mario",
            "snes",
            Some("http://localhost/private"),
            12,
        ));
        assert_eq!(game["console"], "Super Nintendo");
        assert_eq!(game["startedAt"], 12000);
        assert!(game["cover"].is_null());
        assert!(Friends::parse(json!({"friends":[{"id":"bad","displayName":null,"friendCode":"x"}],"incoming":[],"outgoing":[],"blocked":[]})).is_err());
    }
}
