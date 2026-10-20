CREATE TABLE IF NOT EXISTS metadata_cache (
 cache_key TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS metadata_cache_expiry ON metadata_cache(expires_at);
INSERT OR IGNORE INTO schema_migrations VALUES (2, datetime('now'));
