-- Direct messages between friends. Each pair keeps its newest 500 messages.
-- client_id makes a retried send idempotent for its sender.
CREATE TABLE direct_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 400),
  created_at INTEGER NOT NULL,
  CHECK (sender_id <> receiver_id),
  UNIQUE (sender_id, client_id)
);
CREATE INDEX direct_messages_thread ON direct_messages(sender_id, receiver_id, id);
CREATE INDEX direct_messages_inbox ON direct_messages(receiver_id, sender_id, id);
-- The newest message from peer_id that user_id has seen.
CREATE TABLE message_reads (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, peer_id)
);
