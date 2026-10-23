//! The phone's server. `/` is OpenRetro's own interface, `/play` the game
//! screen; `/api/invoke` runs the allowed commands, `/events` forwards app
//! events and `/ws` streams the game. Opening the QR code's URL stores the
//! pairing token in a cookie that every later request must carry. Capture
//! runs only while a game screen is open.
//!
//! Video starts as JPEG over `/ws`. Where the phone's browser can, it then
//! moves to WebRTC: the PC's webview connects to `/phone-encoder` from
//! loopback, receives raw frames, and encodes one H.264 track per view. This
//! server only relays the offer, answer and candidates between the two, and
//! stops a phone's JPEG while its WebRTC picture plays.
use super::{
    input, token_matches,
    video::{self, Layout, View},
    SERVER_PORT,
};
use crate::database::{Database, Result};
use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket},
        ConnectInfo, Query, State, WebSocketUpgrade,
    },
    http::{header, HeaderMap, StatusCode, Uri},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicU64, AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::{Listener, Manager};
use tokio::sync::{broadcast, mpsc, oneshot};

const PLAY_PAGE: &str = include_str!("phone.html");
const COOKIE: &str = "openretro";
/// App events a phone's interface reacts to.
const EVENTS: &[&str] = &["download-imported", "game-started", "game-finished"];

struct Shared {
    app: tauri::AppHandle,
    token: String,
    video: video::Video,
    audio: broadcast::Sender<Bytes>,
    events: broadcast::Sender<String>,
    devices: Arc<AtomicUsize>,
    /// The player each connected phone controls, by connection.
    players: Arc<Mutex<HashMap<u64, u8>>>,
    next_connection: AtomicU64,
    party_devices: Mutex<usize>,
    /// The phone video encoder in the PC's webview, by connection, if any.
    encoder: Mutex<Option<(u64, mpsc::UnboundedSender<String>)>>,
    /// Phones that asked for WebRTC video, by connection.
    rtc_phones: Mutex<HashMap<u64, RtcPhone>>,
    #[cfg(windows)]
    media: Mutex<Option<Media>>,
}

struct RtcPhone {
    to_phone: mpsc::UnboundedSender<String>,
    view: View,
}

fn view_json(view: View) -> Value {
    json!({ "layout": view.layout, "region": view.region })
}

/// Only these WebRTC messages cross the relay, in either direction.
fn relayable(signal: &Value, allowed: &[&str]) -> bool {
    signal["type"]
        .as_str()
        .is_some_and(|kind| allowed.contains(&kind))
        && signal.to_string().len() <= 16 * 1024
}

impl Shared {
    fn to_encoder(&self, message: Value) {
        if let Ok(encoder) = self.encoder.lock() {
            if let Some((_, encoder)) = encoder.as_ref() {
                let _ = encoder.send(message.to_string());
            }
        }
    }

    /// Players other phones already control, so a phone can pick a free one.
    fn taken_by_others(&self, connection: u64) -> Vec<u8> {
        let mut taken: Vec<u8> = self
            .players
            .lock()
            .map(|players| {
                players
                    .iter()
                    .filter(|(id, _)| **id != connection)
                    .map(|(_, player)| *player)
                    .collect()
            })
            .unwrap_or_default();
        taken.sort_unstable();
        taken.dedup();
        taken
    }
}

#[cfg(windows)]
#[allow(dead_code)] // Held for their Drop, which stops each capture.
struct Media {
    shared: super::frames::SharedFrames,
    screen: Option<super::capture::VideoCapture>,
    sound: super::audio::AudioCapture,
}

pub struct Running {
    pub url: String,
    /// The network phones reach this server on, for the public-network warning.
    pub network: super::network::Watch,
    devices: Arc<AtomicUsize>,
    players: Arc<Mutex<HashMap<u64, u8>>>,
    shutdown: oneshot::Sender<()>,
    app: tauri::AppHandle,
    listeners: Vec<tauri::EventId>,
}

impl Running {
    pub fn devices(&self) -> usize {
        self.devices.load(Ordering::Acquire)
    }
    /// The players phones control, in order, one entry per phone.
    pub fn players(&self) -> Vec<u8> {
        let mut players: Vec<u8> = self
            .players
            .lock()
            .map(|players| players.values().copied().collect())
            .unwrap_or_default();
        players.sort_unstable();
        players
    }
    pub fn stop(self) {
        for id in self.listeners {
            self.app.unlisten(id);
        }
        let _ = self.shutdown.send(());
    }
}

#[derive(Deserialize)]
struct Pairing {
    t: Option<String>,
}

pub async fn start(app: tauri::AppHandle, address: &str) -> Result<Running> {
    let token = super::new_token();
    let devices = Arc::new(AtomicUsize::new(0));
    let players = Arc::new(Mutex::new(HashMap::new()));
    let events = broadcast::channel(64).0;
    let listeners = EVENTS
        .iter()
        .map(|name| {
            let events: broadcast::Sender<String> = events.clone();
            app.listen_any(*name, move |event| {
                let payload = serde_json::from_str::<Value>(event.payload()).unwrap_or(Value::Null);
                let _ = events.send(json!({ "name": name, "payload": payload }).to_string());
            })
        })
        .collect();
    let shared = Arc::new(Shared {
        app: app.clone(),
        token: token.clone(),
        // Two frames at most: a slow phone drops old frames instead of lagging.
        video: video::Video::default(),
        audio: broadcast::channel(64).0,
        events,
        devices: devices.clone(),
        players: players.clone(),
        next_connection: AtomicU64::new(0),
        party_devices: Mutex::new(0),
        encoder: Mutex::new(None),
        rtc_phones: Mutex::new(HashMap::new()),
        #[cfg(windows)]
        media: Mutex::new(None),
    });
    let router = Router::new()
        .route("/", get(interface))
        .route("/play", get(play))
        .route("/ws", get(socket))
        .route("/party-stream", get(party_socket))
        .route("/phone-encoder", get(encoder_socket))
        .route("/events", get(event_socket))
        .route("/api/invoke", post(api))
        .route("/file", get(file))
        .fallback(get(asset))
        .with_state(shared);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", SERVER_PORT))
        .await
        .map_err(|_| format!("A porta {SERVER_PORT} já está em uso por outro programa."))?;
    let (shutdown, stopped) = oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let served = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async {
            let _ = stopped.await;
        })
        .await;
        if let Err(e) = served {
            log::warn!("Phone play server stopped: {e}");
        }
    });
    Ok(Running {
        url: format!("http://{address}:{SERVER_PORT}/?t={token}"),
        network: super::network::Watch::new(address),
        devices,
        players,
        shutdown,
        app,
        listeners,
    })
}

fn cookie_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .find_map(|pair| pair.trim().strip_prefix(&format!("{COOKIE}=")[..]))
}

fn paired(shared: &Shared, pairing: &Pairing, headers: &HeaderMap) -> bool {
    pairing
        .t
        .as_deref()
        .filter(|given| !given.is_empty())
        .or_else(|| cookie_token(headers))
        .is_some_and(|given| token_matches(&shared.token, given))
}

fn forbidden() -> Response {
    (
        StatusCode::FORBIDDEN,
        Html("<meta name=viewport content='width=device-width'><body style='font-family:system-ui;background:#151515;color:#c0c1c7;padding:24px'>Abra pelo QR code mostrado no OpenRetro.</body>"),
    )
        .into_response()
}

/// The QR code's URL: store the token in a cookie, then drop it from the address.
fn pair_then(shared: &Shared, pairing: &Pairing, to: &str) -> Option<Response> {
    let given = pairing.t.as_deref()?;
    if !token_matches(&shared.token, given) {
        return Some(forbidden());
    }
    // QR scanners can open this as a cross-site navigation. Lax lets the
    // cookie accompany the top-level GET redirect on a phone's first visit.
    let cookie = format!("{COOKIE}={given}; Path=/; HttpOnly; SameSite=Lax");
    Some(([(header::SET_COOKIE, cookie)], Redirect::to(to)).into_response())
}

/// OpenRetro's interface, marked so it talks to this server instead of Tauri.
async fn interface(
    State(shared): State<Arc<Shared>>,
    Query(pairing): Query<Pairing>,
    headers: HeaderMap,
) -> Response {
    if let Some(response) = pair_then(&shared, &pairing, "/") {
        return response;
    }
    if !paired(&shared, &pairing, &headers) {
        return forbidden();
    }
    let Some(page) = shared.app.asset_resolver().get("index.html".into()) else {
        return (StatusCode::NOT_FOUND, "Interface indisponível.").into_response();
    };
    let html = String::from_utf8_lossy(&page.bytes)
        .replacen(
            "<head>",
            "<head><script>window.__OPENRETRO_REMOTE__=true</script>",
            1,
        )
        .replacen(
            "initial-scale=1.0\"",
            "initial-scale=1.0, maximum-scale=1, viewport-fit=cover\"",
            1,
        );
    ([(header::CACHE_CONTROL, "no-store")], Html(html)).into_response()
}

async fn play(
    State(shared): State<Arc<Shared>>,
    Query(pairing): Query<Pairing>,
    headers: HeaderMap,
) -> Response {
    if let Some(response) = pair_then(&shared, &pairing, "/play") {
        return response;
    }
    if !paired(&shared, &pairing, &headers) {
        return forbidden();
    }
    Html(play_page(&shared.app)).into_response()
}

/// The phone page in the interface language chosen on the PC. Left unset, the
/// page follows the phone's own language.
fn play_page(app: &tauri::AppHandle) -> String {
    let language = crate::commands::get_settings(app.state::<Database>())
        .ok()
        .and_then(|settings| settings["interfaceLanguage"].as_str().map(String::from))
        .filter(|language| language == "en" || language == "pt-BR")
        .unwrap_or_default();
    PLAY_PAGE.replace("__OPENRETRO_LANGUAGE__", &language)
}

/// The interface's scripts, styles and fonts.
async fn asset(State(shared): State<Arc<Shared>>, headers: HeaderMap, uri: Uri) -> Response {
    if !paired(&shared, &Pairing { t: None }, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match shared.app.asset_resolver().get(uri.path().to_string()) {
        Some(asset) => ([(header::CONTENT_TYPE, asset.mime_type)], asset.bytes).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

#[derive(Deserialize)]
struct Invoke {
    cmd: String,
    #[serde(default)]
    args: Value,
}

async fn api(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Json(request): Json<Invoke>,
) -> Response {
    if !paired(&shared, &Pairing { t: None }, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match super::api::invoke(&shared.app, &request.cmd, request.args).await {
        Ok(result) => Json(json!({ "result": result })).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))).into_response(),
    }
}

#[derive(Deserialize)]
struct FileRequest {
    p: String,
}

/// Local images the interface shows: catalog thumbnails and screenshots,
/// the same folders the desktop app's asset protocol allows.
async fn file(
    State(shared): State<Arc<Shared>>,
    headers: HeaderMap,
    Query(request): Query<FileRequest>,
) -> Response {
    if !paired(&shared, &Pairing { t: None }, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let paths = shared.app.path();
    let allowed: Vec<std::path::PathBuf> = [
        paths
            .app_cache_dir()
            .map(|dir| dir.join("launchbox-thumbnails")),
        paths.app_data_dir().map(|dir| dir.join("screenshots")),
    ]
    .into_iter()
    .filter_map(|dir| dir.ok().and_then(|dir| dir.canonicalize().ok()))
    .collect();
    let Ok(path) = std::path::Path::new(&request.p).canonicalize() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !allowed.iter().any(|dir| path.starts_with(dir)) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let kind = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    };
    match tokio::fs::read(&path).await {
        Ok(bytes) => ([(header::CONTENT_TYPE, kind)], bytes).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn event_socket(
    State(shared): State<Arc<Shared>>,
    Query(pairing): Query<Pairing>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !paired(&shared, &pairing, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut events = shared.events.subscribe();
    upgrade.on_upgrade(move |mut socket| async move {
        loop {
            tokio::select! {
                event = events.recv() => match event {
                    Ok(text) => if socket.send(Message::Text(text.into())).await.is_err() { break },
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(_) => break,
                },
                incoming = socket.recv() => if matches!(incoming, None | Some(Err(_)) | Some(Ok(Message::Close(_)))) { break },
            }
        }
    })
}

async fn socket(
    State(shared): State<Arc<Shared>>,
    Query(pairing): Query<Pairing>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !paired(&shared, &pairing, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    upgrade.on_upgrade(move |socket| session(shared, socket, false))
}

// Party's local bridge never sends the launcher's fallback screen to guests.
async fn party_socket(
    State(shared): State<Arc<Shared>>,
    Query(pairing): Query<Pairing>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !paired(&shared, &pairing, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    upgrade.on_upgrade(move |socket| session(shared, socket, true))
}

/// The next packet of an optional feed; without one, never.
async fn next(
    feed: &mut Option<broadcast::Receiver<Bytes>>,
) -> std::result::Result<Bytes, broadcast::error::RecvError> {
    match feed.as_mut() {
        Some(feed) => feed.recv().await,
        None => std::future::pending().await,
    }
}

/// The PC's own webview, never a phone: it decides what each phone receives.
async fn encoder_socket(
    State(shared): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(pairing): Query<Pairing>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !peer.ip().is_loopback() || !paired(&shared, &pairing, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    upgrade.on_upgrade(move |socket| encoder_session(shared, socket))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum FromEncoder {
    Signal {
        id: u64,
        signal: Value,
    },
    /// The phone smoothness setting, 30 or 60.
    Rate {
        fps: u64,
    },
}

async fn encoder_session(shared: Arc<Shared>, mut socket: WebSocket) {
    let id = shared.next_connection.fetch_add(1, Ordering::Relaxed);
    let (to_encoder, mut outgoing) = mpsc::unbounded_channel();
    if let (Ok(mut encoder), Ok(phones)) = (shared.encoder.lock(), shared.rtc_phones.lock()) {
        // Phones that asked before the encoder was ready join now.
        for (phone, rtc) in phones.iter() {
            let _ = to_encoder.send(
                json!({ "type": "join", "id": phone, "view": view_json(rtc.view) }).to_string(),
            );
        }
        *encoder = Some((id, to_encoder));
    }
    // Frames flow only while a phone wants WebRTC video.
    let mut frames: Option<broadcast::Receiver<Bytes>> = None;
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(250));
    loop {
        let message = tokio::select! {
            message = outgoing.recv() => match message {
                Some(text) => Message::Text(text.into()),
                None => break,
            },
            frame = next(&mut frames) => match frame {
                Ok(frame) => Message::Binary(frame),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => {
                    frames = None;
                    continue;
                }
            },
            _ = tick.tick() => {
                let wanted = shared.rtc_phones.lock().is_ok_and(|phones| !phones.is_empty());
                if wanted != frames.is_some() {
                    frames = wanted.then(|| shared.video.subscribe_rtc());
                }
                continue;
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    match serde_json::from_str::<FromEncoder>(&text) {
                        Ok(FromEncoder::Signal { id, signal })
                            if relayable(&signal, &["offer", "candidate"]) =>
                        {
                            if let Ok(phones) = shared.rtc_phones.lock() {
                                if let Some(phone) = phones.get(&id) {
                                    let _ = phone.to_phone.send(
                                        json!({ "type": "rtc", "signal": signal }).to_string(),
                                    );
                                }
                            }
                        }
                        Ok(FromEncoder::Rate { fps }) => shared.video.set_rtc_frame_rate(fps),
                        _ => {}
                    }
                    continue;
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => continue,
            },
        };
        if socket.send(message).await.is_err() {
            break;
        }
    }
    let current = shared.encoder.lock().is_ok_and(|mut encoder| {
        let current = encoder.as_ref().is_some_and(|(owner, _)| *owner == id);
        if current {
            *encoder = None;
        }
        current
    });
    if current {
        // Back to JPEG until an encoder offers again.
        if let Ok(phones) = shared.rtc_phones.lock() {
            for phone in phones.values() {
                let _ = phone
                    .to_phone
                    .send(json!({ "type": "rtc", "signal": { "type": "stop" } }).to_string());
            }
        }
    }
}

/// Starts capture for the first phone and stops it after the last one leaves.
#[cfg_attr(not(windows), allow(unused_variables))]
fn connected(shared: &Shared, joined: bool) {
    let before = if joined {
        shared.devices.fetch_add(1, Ordering::AcqRel)
    } else {
        shared.devices.fetch_sub(1, Ordering::AcqRel)
    };
    #[cfg(windows)]
    {
        let Ok(mut media) = shared.media.lock() else {
            return;
        };
        if joined && before == 0 {
            let hwnd = shared
                .app
                .get_webview_window("main")
                .and_then(|window| window.hwnd().ok())
                .map(|hwnd| hwnd.0 as isize);
            // The runtime's own frames come first; screen capture shows the
            // launcher. Sound comes only from the running game.
            let last_shared = Arc::new(std::sync::atomic::AtomicU64::new(0));
            let screen = match hwnd.map(|hwnd| {
                super::capture::VideoCapture::start(
                    shared.app.clone(),
                    hwnd,
                    shared.video.clone(),
                    last_shared.clone(),
                )
            }) {
                Some(Ok(screen)) => Some(screen),
                Some(Err(e)) => {
                    log::warn!("Phone play screen capture unavailable: {e}");
                    None
                }
                None => None,
            };
            *media = Some(Media {
                shared: super::frames::SharedFrames::start(
                    shared.app.clone(),
                    shared.video.clone(),
                    last_shared,
                ),
                screen,
                sound: super::audio::AudioCapture::start(shared.app.clone(), shared.audio.clone()),
            });
        } else if !joined && before == 1 {
            *media = None;
        }
    }
}

fn status(app: &tauri::AppHandle) -> Value {
    let session = crate::in_game::current_session(app).ok().flatten();
    let game = session.as_ref().map(|session| session.title().to_string());
    let game_id = session.as_ref().map(|session| session.id());
    let layout = current_layout(app);
    let library: Vec<Value> = app
        .state::<Database>()
        .0
        .lock()
        .ok()
        .and_then(|conn| crate::database::library(&conn).ok())
        .unwrap_or_default()
        .into_iter()
        .map(|entry| {
            json!({
                "id": entry.item.id,
                "title": entry.game.title,
                "platform": entry.game.platform_id,
                "cover": entry.game.cover_url,
                "netplay": crate::launcher::netplay::supported(&entry.game.platform_id),
            })
        })
        .collect();
    let party_available = cfg!(windows)
        && session
            .as_ref()
            .is_some_and(|session| session.remote_available());
    json!({ "type": "status", "game": game, "gameId": game_id, "layout": layout, "library": library, "partyAvailable": party_available })
}

fn current_layout(app: &tauri::AppHandle) -> Layout {
    let Some(session) = crate::in_game::current_session(app).ok().flatten() else {
        return Layout::Full;
    };
    app.state::<Database>()
        .0
        .lock()
        .ok()
        .map(|conn| video::load_layout(&conn, session.id()))
        .unwrap_or_default()
}

#[derive(Default)]
struct ScreenChoice {
    player: u8,
    full: bool,
    region: Option<u8>,
}

impl ScreenChoice {
    fn view(&self, layout: Layout) -> View {
        if self.full {
            View::default()
        } else {
            View::new(layout, self.region.unwrap_or(self.player.clamp(1, 4)))
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Incoming {
    Pad {
        player: u8,
        buttons: u16,
        axes: [i16; 4],
    },
    Launch {
        id: String,
    },
    Action {
        action: String,
    },
    /// Shared layout saved for the running game; all phones receive it in status.
    Layout {
        layout: Layout,
        #[serde(rename = "gameId")]
        game_id: String,
    },
    /// Per-phone override. No region means follow this phone's controller port.
    View {
        full: bool,
        region: Option<u8>,
    },
    /// WebRTC video: `hello`, `answer` and `candidate` reach the encoder;
    /// `active` says whether the WebRTC picture is playing on this phone.
    Rtc {
        signal: Value,
    },
}

/// A phone's video: its JPEG feed unless WebRTC plays, and the encoder's view.
struct PhoneVideo {
    connection: u64,
    selected: View,
    jpeg: Option<broadcast::Receiver<Bytes>>,
}

impl PhoneVideo {
    fn select(&mut self, shared: &Shared, view: View) {
        if view == self.selected {
            return;
        }
        self.selected = view;
        if self.jpeg.is_some() {
            self.jpeg = Some(shared.video.subscribe(view));
        }
        let asked = shared.rtc_phones.lock().is_ok_and(|mut phones| {
            phones
                .get_mut(&self.connection)
                .map(|phone| phone.view = view)
                .is_some()
        });
        if asked {
            shared.to_encoder(
                json!({ "type": "view", "id": self.connection, "view": view_json(view) }),
            );
        }
    }

    fn signal(&mut self, shared: &Shared, to_phone: &mpsc::UnboundedSender<String>, signal: Value) {
        match signal["type"].as_str() {
            Some("hello") => {
                if let Ok(mut phones) = shared.rtc_phones.lock() {
                    phones.insert(
                        self.connection,
                        RtcPhone {
                            to_phone: to_phone.clone(),
                            view: self.selected,
                        },
                    );
                }
                shared.to_encoder(json!({
                    "type": "join",
                    "id": self.connection,
                    "view": view_json(self.selected),
                }));
            }
            Some("active") => {
                // A playing WebRTC picture makes this phone's JPEG redundant.
                // Sound stays PCM: phones play WebRTC audio at call volume.
                let playing = signal["on"].as_bool().unwrap_or(false);
                if playing == self.jpeg.is_some() {
                    self.jpeg = (!playing).then(|| shared.video.subscribe(self.selected));
                }
            }
            _ if relayable(&signal, &["answer", "candidate"]) => shared.to_encoder(json!({
                "type": "signal",
                "id": self.connection,
                "signal": signal,
            })),
            _ => {}
        }
    }

    fn leave(&self, shared: &Shared) {
        let asked = shared
            .rtc_phones
            .lock()
            .is_ok_and(|mut phones| phones.remove(&self.connection).is_some());
        if asked {
            shared.to_encoder(json!({ "type": "leave", "id": self.connection }));
        }
    }
}

// Serialize joins and leaves with the runtime command so a reconnect cannot
// restore local inputs after the replacement Party connection has joined.
fn party_connected(shared: &Shared, joined: bool) {
    let Ok(mut count) = shared.party_devices.lock() else {
        return;
    };
    let previous = *count;
    *count = if joined {
        previous + 1
    } else {
        previous.saturating_sub(1)
    };
    if (previous == 0) != (*count == 0) {
        if let Err(error) = crate::in_game::set_party_input(&shared.app, *count > 0) {
            log::warn!("Could not update Party controller ownership: {error}");
        }
    }
}

async fn session(shared: Arc<Shared>, mut socket: WebSocket, party: bool) {
    if party {
        party_connected(&shared, true);
    }
    connected(&shared, true);
    let connection = shared.next_connection.fetch_add(1, Ordering::Relaxed);
    let mut choice = ScreenChoice::default();
    let mut active_layout = Layout::Full;
    let mut phone = PhoneVideo {
        connection,
        selected: View::default(),
        jpeg: Some(if party {
            shared.video.subscribe_party()
        } else {
            shared.video.subscribe(View::default())
        }),
    };
    let (to_phone, mut from_encoder) = mpsc::unbounded_channel::<String>();
    let mut audio = shared.audio.subscribe();
    let mut relay = match input::Relay::new() {
        Ok(relay) => Some(relay),
        Err(error) => {
            // Input must be local-only. Keep video and the rest of the phone
            // interface available, but leave evidence when the loopback relay
            // cannot be created instead of making the controls fail silently.
            log::warn!("Phone play input relay unavailable: {error}");
            None
        }
    };
    let mut last_status = Value::Null;
    let mut last_pad = std::time::Instant::now();
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(1000));
    loop {
        let outgoing = tokio::select! {
            frame = next(&mut phone.jpeg) => match frame {
                Ok(frame) => Some(Message::Binary(frame)),
                Err(broadcast::error::RecvError::Lagged(_)) => None,
                Err(_) => break,
            },
            signal = from_encoder.recv() => signal.map(|text| Message::Text(text.into())),
            sound = audio.recv() => match sound {
                Ok(sound) => Some(Message::Binary(sound)),
                Err(broadcast::error::RecvError::Lagged(_)) => None,
                Err(_) => break,
            },
            _ = tick.tick() => {
                if last_pad.elapsed() > std::time::Duration::from_millis(750) {
                    if let Some(relay) = relay.as_mut() { relay.release(); }
                }
                let mut now = status(&shared.app);
                now["taken"] = json!(shared.taken_by_others(connection));
                active_layout = serde_json::from_value(now["layout"].clone()).unwrap_or_default();
                if !party {
                    phone.select(&shared, choice.view(active_layout));
                }
                (now != last_status).then(|| {
                    last_status = now.clone();
                    Message::Text(now.to_string().into())
                })
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if let Ok(message) = serde_json::from_str::<Incoming>(&text) {
                        if let Incoming::Rtc { signal } = message {
                            if !party {
                                phone.signal(&shared, &to_phone, signal);
                            }
                            continue;
                        }
                        if matches!(message, Incoming::Pad { .. }) { last_pad = std::time::Instant::now(); }
                        let layout_changed = matches!(message, Incoming::Layout { .. });
                        if let Incoming::Pad { player, .. } = message {
                            if let Ok(mut players) = shared.players.lock() {
                                players.insert(connection, player.clamp(1, 4));
                            }
                        }
                        if let Err(error) = handle(&shared, relay.as_mut(), &mut choice, message) {
                            if socket.send(Message::Text(json!({"type":"error","message":error}).to_string().into())).await.is_err() { break; }
                        }
                        if layout_changed { active_layout = current_layout(&shared.app); }
                        if !party {
                            phone.select(&shared, choice.view(active_layout));
                        }
                    }
                    None
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => None,
            },
        };
        if let Some(message) = outgoing {
            if party
                && matches!(message, Message::Binary(_))
                && !crate::in_game::current_session(&shared.app)
                    .ok()
                    .flatten()
                    .is_some_and(|session| session.remote_available())
            {
                continue;
            }
            if socket.send(message).await.is_err() {
                break;
            }
        }
    }
    // Dropping the relay releases every button this phone held.
    drop(relay);
    phone.leave(&shared);
    if let Ok(mut players) = shared.players.lock() {
        players.remove(&connection);
    }
    if party {
        party_connected(&shared, false);
    }
    connected(&shared, false);
}

fn handle(
    shared: &Shared,
    relay: Option<&mut input::Relay>,
    choice: &mut ScreenChoice,
    message: Incoming,
) -> Result<()> {
    match message {
        Incoming::Pad {
            player,
            buttons,
            axes,
        } => {
            choice.player = player.clamp(1, 4);
            if let Some(relay) = relay {
                relay.set_player(player);
                relay.update(input::PadState { buttons, axes });
            }
        }
        Incoming::Launch { id } => {
            let app = shared.app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::launcher::launch_game(app, id, None, None).await {
                    log::warn!("Phone play launch: {e}");
                }
            });
        }
        Incoming::Action { action } => {
            if let Err(e) = crate::in_game::remote_action(&shared.app, &action) {
                log::warn!("Phone play action: {e}");
            }
        }
        Incoming::Layout { layout, game_id } => {
            let session = crate::in_game::current_session(&shared.app)?
                .ok_or("Abra um jogo para configurar a tela dividida.")?;
            if session.id() != game_id {
                return Err("O jogo mudou. Escolha o layout novamente.".into());
            }
            let database = shared.app.state::<Database>();
            let conn = database.0.lock().map_err(crate::database::error)?;
            video::save_layout(&conn, session.id(), layout)?;
        }
        // Handled by the session, which owns the phone's video.
        Incoming::Rtc { .. } => {}
        Incoming::View { full, region } => {
            if region.is_some_and(|region| !(1..=4).contains(&region)) {
                return Err("Escolha uma região entre 1 e 4.".into());
            }
            choice.full = full;
            choice.region = region;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_follows_player_without_changing_controller_for_manual_views() {
        let mut choice = ScreenChoice {
            player: 4,
            ..ScreenChoice::default()
        };
        assert_eq!(choice.view(Layout::Grid), View::new(Layout::Grid, 4));
        assert_eq!(choice.view(Layout::Stacked), View::default());
        choice.region = Some(2);
        assert_eq!(choice.view(Layout::Stacked), View::new(Layout::Stacked, 2));
        assert_eq!(choice.player, 4);
        choice.full = true;
        assert_eq!(choice.view(Layout::Grid), View::default());
        choice.full = false;
        choice.region = None;
        assert_eq!(choice.view(Layout::Grid), View::new(Layout::Grid, 4));
    }

    #[test]
    fn only_webrtc_negotiation_crosses_the_relay() {
        let answer = json!({"type":"answer","sdp":{"type":"answer","sdp":"v=0"}});
        assert!(relayable(&answer, &["answer", "candidate"]));
        assert!(!relayable(&answer, &["offer", "candidate"]));
        assert!(!relayable(
            &json!({"type":"launch"}),
            &["answer", "candidate"]
        ));
        assert!(!relayable(&json!({"sdp":"v=0"}), &["answer"]));
        let huge = json!({"type":"candidate","candidate":"x".repeat(20_000)});
        assert!(!relayable(&huge, &["candidate"]));
        assert!(serde_json::from_value::<Incoming>(
            json!({"type":"rtc","signal":{"type":"hello"}})
        )
        .is_ok());
        assert_eq!(
            view_json(View::new(Layout::SideBySide, 2)),
            json!({"layout":"sideBySide","region":2})
        );
    }

    #[test]
    fn layout_messages_require_a_known_layout_and_game_identity() {
        assert!(serde_json::from_value::<Incoming>(
            json!({"type":"layout","layout":"grid","gameId":"game"})
        )
        .is_ok());
        assert!(serde_json::from_value::<Incoming>(
            json!({"type":"layout","layout":"arbitrary","gameId":"game"})
        )
        .is_err());
        assert!(
            serde_json::from_value::<Incoming>(json!({"type":"layout","layout":"grid"})).is_err()
        );
    }
}
