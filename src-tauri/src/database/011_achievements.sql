-- The RetroAchievements game each library entry matched: 0 when the file has
-- no achievement set. Found by hashing the file, or by the runtime once played.
CREATE TABLE IF NOT EXISTS achievement_games (
  library_item_id TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL,
  checked_at TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations VALUES (11, datetime('now'));
