-- Games run only in OpenRetro's own runtime and RPCS3, which register
-- themselves. Emulators added by hand go away (games that chose one fall back
-- to the managed emulator for their console), and so do the BIOS paths and
-- launch arguments that were set for them.
DELETE FROM emulators WHERE id NOT IN ('openretro-retroarch', 'openretro-rpcs3');
UPDATE library_items SET bios_path = NULL, runtime_args = '[]'
WHERE bios_path IS NOT NULL OR runtime_args <> '[]';
INSERT OR IGNORE INTO schema_migrations VALUES (10, datetime('now'));
