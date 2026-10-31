-- Extra files a game can start from (a Switch game's base dump, updates and
-- DLC): the player picks one when pressing Play. The library entry's own
-- file is always offered too.
CREATE TABLE IF NOT EXISTS launch_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  UNIQUE(library_item_id, path)
);
INSERT OR IGNORE INTO schema_migrations VALUES (12, datetime('now'));
