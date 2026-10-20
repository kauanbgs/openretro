PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS platforms (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL);
INSERT OR IGNORE INTO sources VALUES ('local', 'User-provided files', 'local');
INSERT OR IGNORE INTO sources VALUES ('mock-freeware', 'Development fixtures', 'mock');
CREATE TABLE IF NOT EXISTS emulators (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS library_items (
 id TEXT PRIMARY KEY, game_id TEXT NOT NULL REFERENCES games(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
 source_provider TEXT NOT NULL REFERENCES sources(id), source_path TEXT NOT NULL, emulator_id TEXT REFERENCES emulators(id) ON DELETE SET NULL,
 installed INTEGER NOT NULL DEFAULT 1, favorite INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, last_played_at TEXT,
 playtime INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL UNIQUE, bios_path TEXT, runtime_args TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS play_sessions (
 id TEXT PRIMARY KEY, library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
 started_at TEXT NOT NULL, finished_at TEXT, duration INTEGER NOT NULL DEFAULT 0, exit_code INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_game ON play_sessions(library_item_id) WHERE finished_at IS NULL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES (1, datetime('now'));
