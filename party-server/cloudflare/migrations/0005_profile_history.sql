ALTER TABLE users ADD COLUMN share_history INTEGER NOT NULL DEFAULT 1 CHECK (share_history IN (0,1));
CREATE TABLE recent_games (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  console TEXT NOT NULL,
  cover TEXT,
  last_played_at INTEGER NOT NULL,
  play_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, title, console)
);
CREATE INDEX recent_games_user_date ON recent_games(user_id, last_played_at DESC, title, console);
