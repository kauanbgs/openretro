-- OpenRetro keeps one local player; the account is the identity online.
-- Progress of the extra players of earlier versions goes with them; their
-- files are removed at startup (profiles::retire_players).
UPDATE settings SET value = 'default' WHERE key = 'active_profile';
DELETE FROM player_progress;
DELETE FROM player_profiles WHERE id <> 'default';
DELETE FROM interest_events WHERE profile_id <> 'default';
DELETE FROM recommendation_impressions WHERE profile_id <> 'default';
INSERT OR IGNORE INTO schema_migrations VALUES (9, datetime('now'));
