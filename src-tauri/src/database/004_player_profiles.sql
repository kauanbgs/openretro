CREATE TABLE IF NOT EXISTS player_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT OR IGNORE INTO player_profiles(id, name) VALUES ('default', 'Jogador 1');
CREATE TABLE IF NOT EXISTS player_progress (
 profile_id TEXT NOT NULL REFERENCES player_profiles(id),
 library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
 favorite INTEGER NOT NULL DEFAULT 0, last_played_at TEXT, playtime INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(profile_id, library_item_id)
);
INSERT OR IGNORE INTO settings VALUES ('active_profile', 'default');
INSERT OR IGNORE INTO schema_migrations VALUES (4, datetime('now'));
