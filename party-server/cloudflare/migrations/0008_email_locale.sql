-- The app language the player asked for a code in; emails are written in it.
ALTER TABLE login_codes ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('pt-BR','en'));
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('pt-BR','en'));
