-- What each player looked at and removed, for recommendations. The library
-- already holds downloads, favorites and playtime; these are the signals it
-- loses: time spent on a game's page, and games removed with their playtime.
CREATE TABLE IF NOT EXISTS interest_events (
 id INTEGER PRIMARY KEY,
 profile_id TEXT NOT NULL,
 game_id TEXT NOT NULL,
 title TEXT NOT NULL,
 platform TEXT NOT NULL,
 genres TEXT NOT NULL DEFAULT '[]',
 developer TEXT,
 kind TEXT NOT NULL,
 amount REAL NOT NULL DEFAULT 0,
 at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS interest_events_profile ON interest_events(profile_id, at);
-- How often a recommendation was shown and opened, so ignored ones fade.
CREATE TABLE IF NOT EXISTS recommendation_impressions (
 profile_id TEXT NOT NULL,
 game_id TEXT NOT NULL,
 shown INTEGER NOT NULL DEFAULT 0,
 opened INTEGER NOT NULL DEFAULT 0,
 last_shown TEXT NOT NULL,
 PRIMARY KEY (profile_id, game_id)
);
INSERT OR IGNORE INTO schema_migrations VALUES (8, datetime('now'));
