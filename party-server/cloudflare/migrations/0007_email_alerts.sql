-- Email alerts for friend requests and messages, on unless the player turns them off.
ALTER TABLE users ADD COLUMN email_alerts INTEGER NOT NULL DEFAULT 1 CHECK (email_alerts IN (0,1));
-- One row per alert sent; it caps alerts per sender and per receiver each day.
CREATE TABLE email_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('request','message')),
  created_at INTEGER NOT NULL
);
CREATE INDEX email_alerts_sender ON email_alerts(sender_id, created_at);
CREATE INDEX email_alerts_receiver ON email_alerts(receiver_id, created_at);
