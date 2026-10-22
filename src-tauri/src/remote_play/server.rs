//! The phone page and its socket. Capture runs only while a phone is connected.
use super::{input, token_matches, SERVER_PORT};
use crate::database::{Database, Result};
use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tauri::Manager;
use tokio::sync::{broadcast, oneshot};

const PAGE: &str = include_str!("phone.html");

struct Shared {
    app: tauri::AppHandle,
    token: String,
    video: broadcast::Sender<Bytes>,
    audio: broadcast::Sender<Bytes>,
    devices: Arc<AtomicUsize>,
    #[cfg(windows)]
    media: Mutex<Option<Media>>,
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
    devices: Arc<AtomicUsize>,
    shutdown: oneshot::Sender<()>,
}

impl Running {
    pub fn devices(&self) -> usize {
        self.devices.load(Ordering::Acquire)
    }
    pub fn stop(self) {
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
    let shared = Arc::new(Shared {
        app,
        token: token.clone(),
        // Two frames at most: a slow phone drops old frames instead of lagging.
        video: broadcast::channel(2).0,
        audio: broadcast::channel(64).0,
        devices: devices.clone(),
        #[cfg(windows)]
        media: Mutex::new(None),
    });
    let router = Router::new()
        .route("/", get(page))
        .route("/ws", get(socket))
        .with_state(shared);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", SERVER_PORT))
        .await
        .map_err(|_| format!("A porta {SERVER_PORT} já está em uso por outro programa."))?;
    let (shutdown, stopped) = oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let served = axum::serve(listener, router)
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
        devices,
        shutdown,
    })
}

fn paired(shared: &Shared, pairing: &Pairing) -> bool {
    pairing
        .t
        .as_deref()
        .is_some_and(|given| token_matches(&shared.token, given))
}

async fn page(State(shared): State<Arc<Shared>>, Query(pairing): Query<Pairing>) -> Response {
    if !paired(&shared, &pairing) {
        return (
            StatusCode::FORBIDDEN,
            "Abra pelo QR code mostrado no OpenRetro.",
        )
            .into_response();
    }
    Html(PAGE).into_response()
}

async fn socket(
    State(shared): State<Arc<Shared>>,
    Query(pairing): Query<Pairing>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !paired(&shared, &pairing) {
        return StatusCode::FORBIDDEN.into_response();
    }
    upgrade.on_upgrade(move |socket| session(shared, socket))
}

/// Starts capture for the first phone and stops it after the last one leaves.
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
            // launcher. Sound plays even without a picture.
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
                sound: super::audio::AudioCapture::start(shared.audio.clone()),
            });
        } else if !joined && before == 1 {
            *media = None;
        }
    }
}

fn status(app: &tauri::AppHandle) -> Value {
    let game = crate::in_game::in_game_status(app.clone())
        .ok()
        .flatten()
        .map(|session| session.title().to_string());
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
    json!({ "type": "status", "game": game, "library": library })
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Incoming {
    Pad { player: u8, buttons: u16, axes: [i16; 4] },
    Launch { id: String },
    Action { action: String },
}

async fn session(shared: Arc<Shared>, mut socket: WebSocket) {
    connected(&shared, true);
    let mut video = shared.video.subscribe();
    let mut audio = shared.audio.subscribe();
    let mut relay = input::Relay::new().ok();
    let mut last_status = Value::Null;
    let mut tick = tokio::time::interval(std::time::Duration::from_millis(1000));
    loop {
        let outgoing = tokio::select! {
            frame = video.recv() => match frame {
                Ok(frame) => Some(Message::Binary(frame)),
                Err(broadcast::error::RecvError::Lagged(_)) => None,
                Err(_) => break,
            },
            sound = audio.recv() => match sound {
                Ok(sound) => Some(Message::Binary(sound)),
                Err(broadcast::error::RecvError::Lagged(_)) => None,
                Err(_) => break,
            },
            _ = tick.tick() => {
                let now = status(&shared.app);
                (now != last_status).then(|| {
                    last_status = now.clone();
                    Message::Text(now.to_string().into())
                })
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    handle(&shared, relay.as_mut(), &text);
                    None
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => None,
            },
        };
        if let Some(message) = outgoing {
            if socket.send(message).await.is_err() {
                break;
            }
        }
    }
    // Dropping the relay releases every button this phone held.
    drop(relay);
    connected(&shared, false);
}

fn handle(shared: &Shared, relay: Option<&mut input::Relay>, text: &str) {
    let Ok(message) = serde_json::from_str::<Incoming>(text) else {
        return;
    };
    match message {
        Incoming::Pad { player, buttons, axes } => {
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
    }
}

