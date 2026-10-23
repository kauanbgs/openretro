ALTER TABLE player_profiles ADD COLUMN avatar TEXT NOT NULL DEFAULT 'gamepad';
ALTER TABLE player_profiles ADD COLUMN color TEXT NOT NULL DEFAULT '#12ace2';
INSERT OR IGNORE INTO schema_migrations VALUES (5, datetime('now'));
