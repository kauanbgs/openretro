CREATE TABLE IF NOT EXISTS download_sources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT UNIQUE, enabled INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL, document TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS download_jobs (
 id TEXT PRIMARY KEY, data TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations VALUES (3, datetime('now'));
