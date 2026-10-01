CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  secret TEXT,
  allowed_origins TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE users (
  site_id TEXT NOT NULL REFERENCES sites(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, id)
);

INSERT INTO sites (id, name) VALUES ('demo', 'Demo');
