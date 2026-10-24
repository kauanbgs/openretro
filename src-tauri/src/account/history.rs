//! Two best-effort writes per local game; no heartbeat or frontend credentials.
use super::*;
use std::time::Instant;

pub(super) struct Recording {
    token: String,
    game: Value,
    started: Instant,
}
impl Recording {
    pub(super) fn start(game: &Value) -> Option<Self> {
        let service = service().ok()?;
        let token = service.token().ok()?;
        let recording = Self {
            token,
            game: game.clone(),
            started: Instant::now(),
        };
        recording.write(0);
        Some(recording)
    }
    pub(super) fn finish(self) {
        self.write(self.started.elapsed().as_secs().min(31 * 86400));
    }
    fn write(&self, seconds: u64) {
        let token = self.token.clone();
        let body = json!({"game":self.game,"playSeconds":seconds});
        // Capture the launch account: logging into another account mid-game must
        // never attribute the previous player's session to the new account.
        tauri::async_runtime::spawn(async move {
            if let Ok(service) = service() {
                let _ = service
                    .request(
                        Method::POST,
                        "/api/friends/history",
                        Some(body),
                        Some(&token),
                    )
                    .await;
            }
        });
    }
}
