//! Direct messages between friends. Only validated fields cross IPC.
use super::*;

/// Characters per message, counted as the server counts them.
const MAX_MESSAGE: usize = 400;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    id: String,
    display_name: Option<String>,
    friend_code: String,
    avatar: u8,
}
impl Peer {
    fn valid(&self) -> bool {
        uuid::Uuid::parse_str(&self.id).is_ok()
            && self.display_name.as_ref().is_none_or(|name| {
                name.chars().count() <= 24 && !name.chars().any(char::is_control)
            })
            && super::social::valid_action("request", &self.friend_code)
            && self.avatar < AVATARS
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    id: u64,
    sender_id: String,
    body: String,
    created_at: i64,
}
impl Message {
    fn valid(&self) -> bool {
        let now = chrono::Utc::now().timestamp_millis();
        self.id > 0
            && uuid::Uuid::parse_str(&self.sender_id).is_ok()
            && valid_body(&self.body)
            && self.created_at >= 0
            && self.created_at <= now + 60000
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    peer: Peer,
    can_send: bool,
    unread: u32,
    last: Message,
}
#[derive(Deserialize, Serialize)]
pub struct Conversations {
    conversations: Vec<Conversation>,
}
impl Conversations {
    fn parse(value: Value) -> AccountResult<Self> {
        let data: Self = serde_json::from_value(value).map_err(|_| AccountError::invalid())?;
        let mut peers = std::collections::HashSet::new();
        if data.conversations.len() > 50
            || data.conversations.iter().any(|c| {
                !c.peer.valid()
                    || !c.last.valid()
                    || c.unread > 500
                    || !peers.insert(c.peer.id.clone())
            })
        {
            return Err(AccountError::invalid());
        }
        Ok(data)
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    peer: Peer,
    can_send: bool,
    messages: Vec<Message>,
    more: bool,
}
impl Thread {
    fn parse(value: Value, peer: &str) -> AccountResult<Self> {
        let data: Self = serde_json::from_value(value).map_err(|_| AccountError::invalid())?;
        // Besides the peer, only one account (ours) may appear in the thread.
        let others: std::collections::HashSet<_> = data
            .messages
            .iter()
            .map(|m| m.sender_id.as_str())
            .filter(|id| *id != peer)
            .collect();
        if data.peer.id != peer
            || !data.peer.valid()
            || data.messages.len() > 50
            || others.len() > 1
            || data.messages.iter().any(|m| !m.valid())
            || data.messages.windows(2).any(|w| w[0].id >= w[1].id)
        {
            return Err(AccountError::invalid());
        }
        Ok(data)
    }
}
/// The same rule the server applies, so most mistakes never leave the PC.
fn valid_body(body: &str) -> bool {
    let count = body.chars().count();
    count > 0
        && count <= MAX_MESSAGE
        && body.trim() == body
        && body.lines().count() <= 12
        && !body.chars().any(|c| {
            (c.is_control() && c != '\n')
                || matches!(c, '\u{061C}' | '\u{200E}' | '\u{200F}' | '\u{2028}' | '\u{2029}')
                || ('\u{202A}'..='\u{202E}').contains(&c)
                || ('\u{2066}'..='\u{2069}').contains(&c)
        })
}
fn peer_id(value: &str) -> AccountResult<&str> {
    uuid::Uuid::parse_str(value)
        .map(|_| value)
        .map_err(|_| AccountError::new("invalid", "Jogador inválido."))
}
#[tauri::command]
pub async fn social_conversations(
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<Conversations> {
    let _guard = gate.0.lock().await;
    Conversations::parse(
        service()?
            .authenticated(Method::GET, "/api/friends/messages", None)
            .await?,
    )
}
#[tauri::command]
pub async fn social_messages(
    peer: String,
    before: Option<u64>,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<Thread> {
    let peer = peer_id(&peer)?;
    let path = match before {
        Some(id) if id > 0 => format!("/api/friends/messages/{peer}?before={id}"),
        Some(_) => return Err(AccountError::invalid()),
        None => format!("/api/friends/messages/{peer}"),
    };
    let _guard = gate.0.lock().await;
    Thread::parse(
        service()?.authenticated(Method::GET, &path, None).await?,
        peer,
    )
}
#[tauri::command]
pub async fn social_send(
    peer: String,
    body: String,
    client_id: String,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<Message> {
    let peer = peer_id(&peer)?;
    let body = body.replace("\r\n", "\n").trim().to_string();
    if uuid::Uuid::parse_str(&client_id).is_err() || !valid_body(&body) {
        return Err(AccountError::new("invalid", "Mensagem inválida."));
    }
    let _guard = gate.0.lock().await;
    let value = service()?
        .authenticated(
            Method::POST,
            &format!("/api/friends/messages/{peer}"),
            Some(json!({"body":body,"clientId":client_id.to_ascii_lowercase()})),
        )
        .await?;
    let message: Message = serde_json::from_value(value).map_err(|_| AccountError::invalid())?;
    // Our own message: the sender is never the peer.
    if !message.valid() || message.sender_id == peer {
        return Err(AccountError::invalid());
    }
    Ok(message)
}
#[tauri::command]
pub async fn social_read(
    peer: String,
    last_id: u64,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<()> {
    let peer = peer_id(&peer)?;
    if last_id == 0 || last_id > 9_007_199_254_740_991 {
        return Err(AccountError::invalid());
    }
    let _guard = gate.0.lock().await;
    service()?
        .authenticated(
            Method::POST,
            &format!("/api/friends/messages/{peer}/read"),
            Some(json!({ "lastId": last_id })),
        )
        .await?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    const PEER: &str = "11111111-1111-4111-8111-111111111111";
    const ME: &str = "22222222-2222-4222-8222-222222222222";
    fn message(id: u64, sender: &str) -> Value {
        json!({"id":id,"senderId":sender,"body":"Bora jogar?","createdAt":1})
    }
    fn peer() -> Value {
        json!({"id":PEER,"displayName":"Marina","friendCode":"marina#ab12","avatar":3,"email":"private@example.test"})
    }
    #[test]
    fn message_text_follows_the_server_rules() {
        assert!(valid_body("Oi!\n\nBora? 😀"));
        assert!(valid_body(&"é".repeat(400)));
        for invalid in [
            String::new(),
            " oi".into(),
            "é".repeat(401),
            "a\u{202E}b".into(),
            "a\u{0}b".into(),
            "a\tb".into(),
            "a\n".repeat(13).trim().to_string(),
        ] {
            assert!(!valid_body(&invalid), "{invalid:?}");
        }
    }
    #[test]
    fn threads_are_ordered_bounded_and_belong_to_the_requested_pair() {
        let value = json!({"peer":peer(),"canSend":true,"more":false,
            "messages":[message(1,PEER),message(2,ME)]});
        let thread = Thread::parse(value.clone(), PEER).unwrap();
        let serialized = serde_json::to_value(thread).unwrap();
        assert!(serialized["peer"].get("email").is_none());
        assert!(Thread::parse(value.clone(), ME).is_err());
        let mut unordered = value.clone();
        unordered["messages"] = json!([message(2, PEER), message(1, ME)]);
        assert!(Thread::parse(unordered, PEER).is_err());
        let mut third = value.clone();
        third["messages"] = json!([
            message(1, PEER),
            message(2, ME),
            message(3, "33333333-3333-4333-8333-333333333333")
        ]);
        assert!(Thread::parse(third, PEER).is_err());
        let mut unsafe_text = value;
        unsafe_text["messages"][0]["body"] = json!("a\u{202E}b");
        assert!(Thread::parse(unsafe_text, PEER).is_err());
    }
    #[test]
    fn conversation_lists_reject_duplicates_and_bad_peers() {
        let row = json!({"peer":peer(),"canSend":true,"unread":2,"last":message(9,PEER)});
        assert!(Conversations::parse(json!({"conversations":[row.clone()]})).is_ok());
        assert!(Conversations::parse(json!({"conversations":[row.clone(),row.clone()]})).is_err());
        let mut bad = row;
        bad["peer"]["id"] = json!("../x");
        assert!(Conversations::parse(json!({ "conversations": [bad] })).is_err());
        assert!(peer_id("../people").is_err());
    }
}
