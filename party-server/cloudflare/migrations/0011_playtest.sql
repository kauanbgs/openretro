-- Playtest invites for streamers. Counts and feedback are not tied to any
-- account or visitor: no IP, no cookie, only the invite's slug.
CREATE TABLE playtest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX playtest_events_slug ON playtest_events(slug, kind);
CREATE INDEX playtest_events_time ON playtest_events(created_at);
CREATE TABLE playtest_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX playtest_feedback_slug ON playtest_feedback(slug, created_at DESC);
