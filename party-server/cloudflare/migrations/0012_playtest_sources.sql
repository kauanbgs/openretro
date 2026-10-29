-- Settings the admin panel edits for the playtest page, such as the game
-- sources every invited streamer adds to the app.
CREATE TABLE playtest_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
