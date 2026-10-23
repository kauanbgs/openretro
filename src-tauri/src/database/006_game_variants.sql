CREATE TABLE IF NOT EXISTS game_variants (
 id TEXT PRIMARY KEY,
 library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
 parent_id TEXT REFERENCES game_variants(id) ON DELETE CASCADE,
 path TEXT NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL,
 UNIQUE(library_item_id, sha256)
);
CREATE INDEX IF NOT EXISTS game_variants_item ON game_variants(library_item_id);
CREATE TABLE IF NOT EXISTS game_variant_selection (
 library_item_id TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
 variant_id TEXT NOT NULL REFERENCES game_variants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mod_sources (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL, document TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations VALUES (6, datetime('now'));
