-- Steam keys given to streamers who send feedback. A key belongs to the invite
-- that claimed it, and an invite can claim only one.
CREATE TABLE playtest_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steam_key TEXT NOT NULL UNIQUE,
  slug TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX playtest_keys_slug ON playtest_keys(slug) WHERE slug IS NOT NULL;
