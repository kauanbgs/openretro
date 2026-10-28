-- What happened and when, for the admin panel. Rows follow the accounts they
-- name, so deleting an account erases its events. Never holds message text.
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX activity_log_time ON activity_log(created_at DESC);
CREATE INDEX activity_log_kind ON activity_log(kind, created_at DESC);
CREATE INDEX activity_log_actor ON activity_log(actor_id, created_at DESC);
CREATE INDEX activity_log_target ON activity_log(target_id, created_at DESC);
