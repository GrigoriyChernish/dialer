-- Сесії входу за номером: refresh-токен живе 7 днів, у базі лише його sha256.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (site_id, user_id) REFERENCES users(site_id, id) ON DELETE CASCADE
);
CREATE INDEX sessions_user ON sessions (site_id, user_id);
