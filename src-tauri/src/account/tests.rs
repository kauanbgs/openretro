use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
};
#[derive(Clone, Default)]
struct MemoryVault {
    value: Arc<Mutex<Option<String>>>,
    fail_write: bool,
}
impl Vault for MemoryVault {
    fn read(&self) -> AccountResult<Option<String>> {
        Ok(self.value.lock().unwrap().clone())
    }
    fn write(&self, token: &str) -> AccountResult<()> {
        if self.fail_write {
            return Err(AccountError::vault());
        }
        *self.value.lock().unwrap() = Some(token.into());
        Ok(())
    }
    fn clear(&self) -> AccountResult<()> {
        *self.value.lock().unwrap() = None;
        Ok(())
    }
}
fn payload() -> Value {
    json!({ "token": "a".repeat(64), "expiresAt": 9999999999999i64, "user": {
        "id": "123e4567-e89b-42d3-a456-426614174000", "email": "test@example.test", "displayName": null,
        "friendCode": "jogador#123456789abc", "showPlaying": true, "appearOffline": false, "createdAt": 1,
    }})
}
fn http_fixture(
    replies: Vec<(u16, Value, &'static str)>,
    vault: MemoryVault,
) -> (Service<MemoryVault>, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
    let thread = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, reply, extra) in replies {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut part = [0; 2048];
                let n = stream.read(&mut part).unwrap();
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&part[..n]);
                if let Some(at) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..at]);
                    let length = header
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= at + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            let body = if status == 204 {
                String::new()
            } else {
                reply.to_string()
            };
            write!(stream, "HTTP/1.1 {status} Reply\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}", body.len()).unwrap();
        }
        requests
    });
    (Service::new(origin, vault).unwrap(), thread)
}
#[test]
fn service_origins_reject_credentials_paths_and_public_http() {
    for value in [
        "https://example.test",
        "http://127.0.0.1:8787",
        "http://localhost:8787",
    ] {
        assert!(parse_origin(value).is_ok());
    }
    for value in [
        "http://example.test",
        "https://user:pass@example.test",
        "https://example.test/path",
        "https://example.test/?token=x",
        "https://example.test/#x",
        "file:///tmp/x",
        "http://localhost.evil.test",
    ] {
        assert!(parse_origin(value).is_err());
    }
    assert!(
        NativeVault::for_origin("https://a.example/").0
            != NativeVault::for_origin("https://b.example/").0
    );
}
#[test]
fn validates_codes_profiles_and_email_without_accepting_settings_fields() {
    let mut tag: ProfilePatch = serde_json::from_value(json!({"friendTag":" AB12 "})).unwrap();
    tag.validate().unwrap();
    assert_eq!(tag.friend_tag.as_deref(), Some("ab12"));
    for value in ["abc", "abcde", "ab#1", "é123", "１２３４"] {
        let mut patch: ProfilePatch = serde_json::from_value(json!({"friendTag":value})).unwrap();
        assert!(patch.validate().is_err());
    }
    assert_eq!(
        normalized_email(" TEST@EXAMPLE.TEST ").unwrap(),
        "test@example.test"
    );
    for email in ["", "not-email", "x@localhost", "x\n@example.test"] {
        assert!(normalized_email(email).is_err());
    }
    for name in ["ab", "name\u{0}bad", "xxxxxxxxxxxxxxxxxxxxxxxxx"] {
        let mut patch: ProfilePatch = serde_json::from_value(json!({"displayName": name})).unwrap();
        assert!(patch.validate().is_err());
    }
    let mut patch: ProfilePatch =
        serde_json::from_value(json!({"displayName": " Jogador 🎮 "})).unwrap();
    patch.validate().unwrap();
    assert_eq!(patch.display_name.as_deref(), Some("Jogador 🎮"));
    assert!(serde_json::from_value::<ProfilePatch>(json!({"token": "never-accepted"})).is_err());
    let mut icon: ProfilePatch = serde_json::from_value(json!({"avatar": 14})).unwrap();
    icon.validate().unwrap();
    let mut icon: ProfilePatch = serde_json::from_value(json!({"avatar": 15})).unwrap();
    assert!(icon.validate().is_err());
    assert!(serde_json::from_value::<ProfilePatch>(json!({"avatar": -1})).is_err());
    assert!(valid_token(&"a".repeat(64)));
    assert!(!valid_token(&"g".repeat(64)));
}
#[tokio::test]
async fn token_is_saved_only_in_vault_and_never_serialized_to_frontend() {
    let vault = MemoryVault::default();
    let (service, server) = http_fixture(vec![(200, payload(), "")], vault.clone());
    let view = service
        .verify("TEST@example.test".into(), "123456".into())
        .await
        .unwrap();
    assert!(vault.read().unwrap().is_some());
    let json = serde_json::to_value(view).unwrap();
    assert!(json.get("token").is_none());
    assert!(!json.to_string().contains(&"a".repeat(64)));
    let requests = server.join().unwrap();
    assert!(requests[0].contains("/api/auth/verify"));
}
#[tokio::test]
async fn offline_state_keeps_credential_and_unauthorized_clears_it() {
    let vault = MemoryVault::default();
    vault.write(&"a".repeat(64)).unwrap();
    let (service, server) = http_fixture(
        vec![(
            401,
            json!({"error":"Sua sessão expirou. Entre novamente."}),
            "",
        )],
        vault.clone(),
    );
    assert!(!service.status().await.unwrap().has_session);
    server.join().unwrap();
    assert!(vault.read().unwrap().is_none());
    vault.write(&"a".repeat(64)).unwrap();
    // The listener is closed: a real failed TCP connection represents being offline.
    let state = service.status().await.unwrap();
    assert!(state.has_session);
    assert!(!state.online);
    assert!(vault.read().unwrap().is_some());
}
#[tokio::test]
async fn failed_secure_storage_revokes_new_session_instead_of_falling_back() {
    let vault = MemoryVault {
        fail_write: true,
        ..Default::default()
    };
    let (service, server) = http_fixture(
        vec![(200, payload(), ""), (204, Value::Null, "")],
        vault.clone(),
    );
    let error = service
        .verify("test@example.test".into(), "123456".into())
        .await
        .err()
        .unwrap();
    assert_eq!(error.kind, "vault");
    assert!(vault.read().unwrap().is_none());
    let requests = server.join().unwrap();
    assert!(requests[1].starts_with("POST /api/auth/logout "));
    assert!(requests[1]
        .to_ascii_lowercase()
        .contains("authorization: bearer "));
}
#[tokio::test]
async fn rate_limits_are_safe_and_redirects_never_forward_credentials() {
    let vault = MemoryVault::default();
    vault.write(&"a".repeat(64)).unwrap();
    let (service, server) = http_fixture(
        vec![
            (
                429,
                json!({"error":"Aguarde um minuto antes de pedir outro código."}),
                "Retry-After: 60\r\n",
            ),
            (302, json!({}), "Location: http://127.0.0.1:9/other\r\n"),
        ],
        vault,
    );
    let error = service
        .request(
            Method::POST,
            "/api/auth/start",
            Some(json!({"email":"test@example.test"})),
            None,
        )
        .await
        .err()
        .unwrap();
    assert_eq!(error.retry_after, 60);
    assert_eq!(error.kind, "limit");
    assert!(service
        .authenticated(Method::GET, "/api/auth/session", None)
        .await
        .is_err());
    assert_eq!(server.join().unwrap().len(), 2);
}

#[tokio::test]
async fn a_wrong_login_code_keeps_the_code_step_without_expiring_a_session() {
    let vault = MemoryVault::default();
    let (service, server) = http_fixture(
        vec![(
            401,
            json!({"error":"Código inválido ou expirado. Confira o e-mail ou peça outro código."}),
            "",
        )],
        vault.clone(),
    );
    let error = service
        .verify("test@example.test".into(), "000000".into())
        .await
        .err()
        .unwrap();
    assert_eq!(error.kind, "code");
    assert!(vault.read().unwrap().is_none());
    assert_eq!(server.join().unwrap().len(), 1);
}
