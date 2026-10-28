//! Optional accounts. Bearer tokens are held by Rust and the OS vault only.
pub mod messages;
pub mod people;
mod history;
pub mod social;
mod vault;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri_plugin_dialog::DialogExt;
use vault::{NativeVault, Vault};

type AccountResult<T> = Result<T, AccountError>;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountError {
    message: String,
    kind: &'static str,
    retry_after: u64,
}
impl AccountError {
    fn new(kind: &'static str, message: &str) -> Self {
        Self {
            message: message.into(),
            kind,
            retry_after: 0,
        }
    }
    fn offline() -> Self {
        Self::new(
            "offline",
            "Não foi possível conectar à sua conta. Seus jogos continuam disponíveis.",
        )
    }
    fn invalid() -> Self {
        Self::new(
            "invalid",
            "O serviço de conta respondeu com dados inválidos.",
        )
    }
    fn vault() -> Self {
        Self::new(
            "vault",
            "Não foi possível acessar o Gerenciador de Credenciais do Windows. Tente novamente.",
        )
    }
    fn unsupported() -> Self {
        Self::new(
            "unsupported",
            "O login está disponível no aplicativo para Windows.",
        )
    }
    fn unauthorized() -> Self {
        Self::new("unauthorized", "Sua sessão expirou. Entre novamente.")
    }
}
#[derive(Default)]
pub struct AccountGate(tokio::sync::Mutex<()>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    id: String,
    email: String,
    display_name: Option<String>,
    friend_code: String,
    /// One of the app's preset icons; servers before icons send none.
    #[serde(default)]
    avatar: u8,
    show_playing: bool,
    appear_offline: bool,
    #[serde(default = "default_discoverable")]
    discoverable: bool,
    #[serde(default = "default_discoverable")]
    share_history: bool,
    /// Servers before email alerts send none; they never sent any either.
    #[serde(default = "default_discoverable")]
    email_alerts: bool,
    created_at: i64,
}
/// The preset icons the app draws, numbered from 0.
pub const AVATARS: u8 = 15;
fn default_discoverable() -> bool {
    true
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    supported: bool,
    has_session: bool,
    online: bool,
    user: Option<User>,
    expires_at: Option<i64>,
}
impl SessionView {
    fn empty() -> Self {
        Self {
            supported: cfg!(windows),
            has_session: false,
            online: false,
            user: None,
            expires_at: None,
        }
    }
    fn from_response(value: Value) -> AccountResult<Self> {
        let user: User = serde_json::from_value(
            value
                .get("user")
                .cloned()
                .ok_or_else(AccountError::invalid)?,
        )
        .map_err(|_| AccountError::invalid())?;
        if uuid::Uuid::parse_str(&user.id).is_err()
            || user.email.len() > 254
            || user.friend_code.len() > 64
            || user.avatar >= AVATARS
            || user
                .display_name
                .as_ref()
                .is_some_and(|v| v.chars().count() > 24)
        {
            return Err(AccountError::invalid());
        }
        let expires = value
            .get("expiresAt")
            .and_then(Value::as_i64)
            .filter(|v| *v > 0)
            .ok_or_else(AccountError::invalid)?;
        Ok(Self {
            supported: true,
            has_session: true,
            online: true,
            user: Some(user),
            expires_at: Some(expires),
        })
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfilePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    friend_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_playing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    appear_offline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avatar: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    discoverable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    share_history: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    email_alerts: Option<bool>,
}
impl ProfilePatch {
    fn validate(&mut self) -> AccountResult<()> {
        if let Some(tag) = self.friend_tag.as_mut() {
            *tag = tag.trim().to_ascii_lowercase();
            if tag.len() != 4
                || !tag
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            {
                return Err(AccountError::new(
                    "invalid",
                    "Escolha exatamente 4 letras ou números para depois do #.",
                ));
            }
        }
        if let Some(name) = self.display_name.as_mut() {
            *name = name.trim().into();
            if !(3..=24).contains(&name.chars().count()) || name.chars().any(char::is_control) {
                return Err(AccountError::new(
                    "invalid",
                    "Use um nome com 3 a 24 caracteres, sem caracteres de controle.",
                ));
            }
        }
        if self.avatar.is_some_and(|avatar| avatar >= AVATARS) {
            return Err(AccountError::new(
                "invalid",
                "Escolha um dos ícones do OpenRetro.",
            ));
        }
        if self.display_name.is_none()
            && self.friend_tag.is_none()
            && self.show_playing.is_none()
            && self.appear_offline.is_none()
            && self.avatar.is_none()
            && self.discoverable.is_none()
            && self.share_history.is_none()
            && self.email_alerts.is_none()
        {
            return Err(AccountError::new("invalid", "Dados do perfil inválidos."));
        }
        Ok(())
    }
}
fn normalized_email(value: &str) -> AccountResult<String> {
    let email = value.trim().to_ascii_lowercase();
    let parts: Vec<_> = email.split('@').collect();
    if email.len() > 254
        || !email.is_ascii()
        || email.chars().any(|v| v.is_control() || v.is_whitespace())
        || parts.len() != 2
        || parts[0].is_empty()
        || parts[0].len() > 64
        || !parts[1].contains('.')
        || parts[1].starts_with('.')
        || parts[1].ends_with('.')
    {
        return Err(AccountError::new("invalid", "Digite um e-mail válido."));
    }
    Ok(email)
}
fn valid_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn parse_origin(value: &str) -> AccountResult<Url> {
    let url = Url::parse(value).map_err(|_| AccountError::invalid())?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.host_str().is_none()
        || !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AccountError::new(
            "invalid",
            "O endereço do serviço de conta é inválido.",
        ));
    }
    Ok(url)
}
fn configured_origin() -> AccountResult<Url> {
    let value = std::env::var("OPENRETRO_SOCIAL_URL")
        .or_else(|_| std::env::var("OPENRETRO_PARTY_URL"))
        .unwrap_or_else(|_| {
            option_env!("OPENRETRO_PARTY_URL")
                .unwrap_or(include_str!("../remote_play/party-url.txt").trim())
                .into()
        });
    parse_origin(&value)
}
struct Service<V> {
    origin: Url,
    client: Client,
    vault: V,
}
impl<V: Vault> Service<V> {
    fn new(origin: Url, vault: V) -> AccountResult<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AccountError::offline())?;
        Ok(Self {
            origin,
            client,
            vault,
        })
    }
    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> AccountResult<Value> {
        let mut request = self
            .client
            .request(
                method,
                self.origin
                    .join(path)
                    .map_err(|_| AccountError::invalid())?,
            )
            .header("Accept", "application/json");
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(|_| AccountError::offline())?;
        let status = response.status();
        let retry = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0)
            .min(3600);
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AccountError::offline())?
        {
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(AccountError::invalid());
            }
            bytes.extend_from_slice(&chunk);
        }
        if status == reqwest::StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if !status.is_success() {
            let message = value
                .get("error")
                .and_then(Value::as_str)
                .filter(|v| v.len() < 500)
                .unwrap_or("Não foi possível acessar sua conta. Tente novamente.");
            return Err(AccountError {
                kind: if status == reqwest::StatusCode::UNAUTHORIZED {
                    "unauthorized"
                } else if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    "limit"
                } else {
                    "server"
                },
                message: message.into(),
                retry_after: retry,
            });
        }
        if value.is_null() {
            return Err(AccountError::invalid());
        }
        Ok(value)
    }
    fn token(&self) -> AccountResult<String> {
        self.vault.read()?.ok_or_else(AccountError::unauthorized)
    }
    async fn authenticated(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> AccountResult<Value> {
        let token = self.token()?;
        let result = self.request(method, path, body, Some(&token)).await;
        if result.as_ref().is_err_and(|e| e.kind == "unauthorized") {
            self.vault.clear()?;
        }
        result
    }
    async fn status(&self) -> AccountResult<SessionView> {
        if self.vault.read()?.is_none() {
            return Ok(SessionView::empty());
        }
        match self
            .authenticated(Method::GET, "/api/auth/session", None)
            .await
        {
            Ok(value) => SessionView::from_response(value).or_else(|_| {
                Ok(SessionView {
                    has_session: true,
                    ..SessionView::empty()
                })
            }),
            Err(error) if error.kind == "unauthorized" => Ok(SessionView::empty()),
            Err(error) if error.kind == "offline" || error.kind == "server" => Ok(SessionView {
                has_session: true,
                ..SessionView::empty()
            }),
            Err(error) => Err(error),
        }
    }
    async fn verify(&self, email: String, code: String) -> AccountResult<SessionView> {
        let email = normalized_email(&email)?;
        if code.len() != 6 || !code.bytes().all(|v| v.is_ascii_digit()) {
            return Err(AccountError::new(
                "invalid",
                "Digite o código de seis dígitos.",
            ));
        }
        if self.vault.read()?.is_some() {
            return Err(AccountError::new(
                "invalid",
                "Saia da conta atual antes de entrar em outra.",
            ));
        }
        let value = self
            .request(
                Method::POST,
                "/api/auth/verify",
                Some(json!({ "email": email, "code": code })),
                None,
            )
            .await
            .map_err(|mut error| {
                if error.kind == "unauthorized" {
                    error.kind = "code";
                }
                error
            })?;
        let token = value
            .get("token")
            .and_then(Value::as_str)
            .filter(|v| valid_token(v))
            .ok_or_else(AccountError::invalid)?;
        let view = match SessionView::from_response(value.clone()) {
            Ok(view) => view,
            Err(error) => {
                let _ = self
                    .request(Method::POST, "/api/auth/logout", None, Some(token))
                    .await;
                return Err(error);
            }
        };
        if let Err(error) = self.vault.write(token) {
            // Never fall back to JS/SQLite if secure storage fails; revoke the orphan.
            let _ = self
                .request(Method::POST, "/api/auth/logout", None, Some(token))
                .await;
            return Err(error);
        }
        Ok(view)
    }
}
fn service() -> AccountResult<Service<NativeVault>> {
    if !cfg!(windows) {
        return Err(AccountError::unsupported());
    }
    let origin = configured_origin()?;
    let vault = NativeVault::for_origin(origin.as_str());
    Service::new(origin, vault)
}

#[tauri::command]
pub async fn account_session(gate: tauri::State<'_, AccountGate>) -> AccountResult<SessionView> {
    if !cfg!(windows) {
        return Ok(SessionView::empty());
    }
    let _guard = gate.0.lock().await;
    service()?.status().await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginChallenge {
    resend_after: u64,
}
#[tauri::command]
pub async fn account_start(
    email: String,
    locale: Option<String>,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<LoginChallenge> {
    let email = normalized_email(&email)?;
    let _guard = gate.0.lock().await;
    let value = service()?
        .request(
            Method::POST,
            "/api/auth/start",
            Some(json!({ "email": email, "locale": locale })),
            None,
        )
        .await?;
    let resend_after = value
        .get("resendAfter")
        .and_then(Value::as_u64)
        .filter(|v| (1..=3600).contains(v))
        .ok_or_else(AccountError::invalid)?;
    Ok(LoginChallenge { resend_after })
}
#[tauri::command]
pub async fn account_verify(
    email: String,
    code: String,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<SessionView> {
    let _guard = gate.0.lock().await;
    service()?.verify(email, code).await
}
#[tauri::command]
pub async fn account_profile(
    mut patch: ProfilePatch,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<SessionView> {
    patch.validate()?;
    let _guard = gate.0.lock().await;
    SessionView::from_response(
        service()?
            .authenticated(
                Method::PATCH,
                "/api/account/profile",
                Some(serde_json::to_value(patch).map_err(|_| AccountError::invalid())?),
            )
            .await?,
    )
}
#[tauri::command]
pub async fn account_logout(
    all: bool,
    app: tauri::AppHandle,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<()> {
    let _guard = gate.0.lock().await;
    let service = service()?;
    // A failed remote revocation leaves the credential available for a retry.
    // Never claim other devices were signed out while offline.
    let result = service
        .authenticated(
            Method::POST,
            if all {
                "/api/auth/logout-all"
            } else {
                "/api/auth/logout"
            },
            None,
        )
        .await;
    if let Err(error) = result {
        if error.kind != "unauthorized" {
            return Err(error);
        }
    }
    service.vault.clear()?;
    social::stop(&app);
    Ok(())
}
#[tauri::command]
pub async fn account_forget(
    app: tauri::AppHandle,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<()> {
    let _guard = gate.0.lock().await;
    service()?.vault.clear()?;
    social::stop(&app);
    Ok(())
}
#[tauri::command]
pub async fn account_delete(
    confirmation: String,
    app: tauri::AppHandle,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<()> {
    if confirmation != "EXCLUIR" {
        return Err(AccountError::new(
            "invalid",
            "Digite EXCLUIR para confirmar a exclusão.",
        ));
    }
    let _guard = gate.0.lock().await;
    let service = service()?;
    service
        .authenticated(Method::DELETE, "/api/account", None)
        .await?;
    service.vault.clear()?;
    social::stop(&app);
    Ok(())
}
#[tauri::command]
pub async fn account_export(
    app: tauri::AppHandle,
    gate: tauri::State<'_, AccountGate>,
) -> AccountResult<bool> {
    let _guard = gate.0.lock().await;
    let value = service()?
        .authenticated(Method::GET, "/api/account/export", None)
        .await?;
    let bytes = serde_json::to_vec_pretty(&value).map_err(|_| AccountError::invalid())?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("JSON", &["json"])
        .set_file_name("openretro-conta.json")
        .save_file(move |path| {
            let _ = send.send(path);
        });
    let Some(path) = receive
        .await
        .map_err(|_| AccountError::new("invalid", "Não foi possível exportar sua conta."))?
    else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|_| AccountError::new("invalid", "Não foi possível exportar sua conta."))?;
    tokio::fs::write(path, bytes)
        .await
        .map_err(|_| AccountError::new("invalid", "Não foi possível exportar sua conta."))?;
    Ok(true)
}
#[tauri::command]
pub fn account_privacy() -> AccountResult<String> {
    Ok(configured_origin()?
        .join("/privacidade")
        .map_err(|_| AccountError::invalid())?
        .to_string())
}
#[tauri::command]
pub fn account_open_privacy() -> AccountResult<()> {
    let url = account_privacy()?;
    open_external(&url)
}
fn open_external(url: &str) -> AccountResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", url])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| {
                AccountError::new("invalid", "Não foi possível abrir a página no navegador.")
            })?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err(AccountError::unsupported())
    }
}
#[cfg(test)]
mod tests;
