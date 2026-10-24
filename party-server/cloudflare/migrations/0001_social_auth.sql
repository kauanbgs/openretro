-- Auth records are independent of Party: anonymous rooms never depend on D1.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 3 AND 24),
  friend_code TEXT NOT NULL UNIQUE,
  show_playing INTEGER NOT NULL DEFAULT 1 CHECK (show_playing IN (0, 1)),
  appear_offline INTEGER NOT NULL DEFAULT 0 CHECK (appear_offline IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE TABLE login_codes (
  email_hash TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  claim_id TEXT
);
CREATE INDEX login_codes_expiry ON login_codes(expires_at);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE friend_requests (
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sender_id, receiver_id),
  CHECK (sender_id <> receiver_id)
);
CREATE INDEX friend_requests_receiver ON friend_requests(receiver_id);
CREATE TABLE friendships (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
CREATE INDEX friendships_friend ON friendships(friend_id);
CREATE TABLE blocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id),
  CHECK (user_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON blocks(blocked_id);
-- Keys are HMACs of scoped subjects; raw IPs and emails never enter quota rows.
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_limits_expiry ON auth_rate_limits(expires_at);
