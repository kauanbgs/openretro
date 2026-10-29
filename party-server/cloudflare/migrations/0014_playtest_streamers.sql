-- The invites now live in the database, so the admin panel can add and remove
-- them without a deploy. These are the ones that were in PLAYTEST_STREAMERS.
CREATE TABLE playtest_streamers (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO playtest_streamers (slug, name, created_at) VALUES
  ('kauan-powe', 'Kauan', 0),
  ('dougao-were', 'Dougao', 0),
  ('vakeiro-2111', 'Vakeiro', 0),
  ('allan-pocj', 'Allan', 0),
  ('siegod-26sp', 'SieGod', 0);
