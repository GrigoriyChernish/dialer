-- Web Push підписки пристроїв (docs/pwa-and-push.md). Ключ endpoint: його видає push-сервіс і він унікальний для підписки.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (site_id, user_id) REFERENCES users(site_id, id) ON DELETE CASCADE
);
CREATE INDEX push_subscriptions_user ON push_subscriptions (site_id, user_id);
