-- The first player's color follows the logo's blue. Runs once, and only
-- while the color is still the old orange default, so a chosen color stays.
UPDATE player_profiles SET color = '#12ace2'
WHERE id = 'default' AND color = '#ff8a3d'
  AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = 7);
INSERT OR IGNORE INTO schema_migrations VALUES (7, datetime('now'));
