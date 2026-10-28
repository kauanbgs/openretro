-- What the admin panel charts over time. Both are filled by the hourly cron.
-- A row says that an account was active on a UTC day (no times, no places);
-- rows go with the account.
CREATE TABLE daily_active (
  day INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX daily_active_user ON daily_active(user_id, day DESC);
-- How many accounts were online at the top of each hour. No account is named.
CREATE TABLE online_samples (
  at INTEGER PRIMARY KEY,
  online INTEGER NOT NULL
);
