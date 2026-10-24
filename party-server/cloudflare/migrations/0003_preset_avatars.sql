-- Each account shows one of 15 preset icons, chosen by the player or drawn
-- at random. Existing accounts get a random one instead of all sharing #0.
ALTER TABLE users ADD COLUMN avatar INTEGER NOT NULL DEFAULT 0 CHECK (avatar BETWEEN 0 AND 14);
UPDATE users SET avatar = abs(random()) % 15;
