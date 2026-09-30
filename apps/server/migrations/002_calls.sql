CREATE TABLE calls (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  callee_id TEXT NOT NULL,
  caller_device TEXT NOT NULL,
  answered_device TEXT,
  video INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  answered_at INTEGER,
  hold_caller INTEGER NOT NULL DEFAULT 0,
  hold_callee INTEGER NOT NULL DEFAULT 0,
  ended_at INTEGER,
  reason TEXT
);
CREATE INDEX calls_active ON calls (ended_at) WHERE ended_at IS NULL;

CREATE TABLE recents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  result TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  duration INTEGER,
  silent INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX recents_user ON recents (site_id, user_id, id DESC);
