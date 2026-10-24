-- Accounts are discoverable unless the owner opts out. No activity is public.
ALTER TABLE users ADD COLUMN discoverable INTEGER NOT NULL DEFAULT 1 CHECK (discoverable IN (0, 1));
CREATE INDEX users_discovery ON users(discoverable, id);
