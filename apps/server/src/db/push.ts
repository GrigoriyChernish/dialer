import type { Db } from './index';

export interface PushSub {
  endpoint: string;
  siteId: string;
  userId: string;
  deviceId: string;
  p256dh: string;
  auth: string;
}

interface Raw {
  endpoint: string;
  site_id: string;
  user_id: string;
  device_id: string;
  p256dh: string;
  auth: string;
}

const toSub = (r: Raw): PushSub => ({
  endpoint: r.endpoint,
  siteId: r.site_id,
  userId: r.user_id,
  deviceId: r.device_id,
  p256dh: r.p256dh,
  auth: r.auth,
});

export function createPushSubs(db: Db) {
  // той самий endpoint на іншому користувачі чи пристрої: підписку перепривʼязано (на пристрої увійшов інший користувач)
  const upsert = db.prepare(
    `INSERT INTO push_subscriptions (endpoint, site_id, user_id, device_id, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       site_id = excluded.site_id, user_id = excluded.user_id, device_id = excluded.device_id,
       p256dh = excluded.p256dh, auth = excluded.auth`,
  );
  const removeDevice = db.prepare('DELETE FROM push_subscriptions WHERE site_id = ? AND user_id = ? AND device_id = ?');
  const removeEndpoint = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const selectUser = db.prepare('SELECT * FROM push_subscriptions WHERE site_id = ? AND user_id = ?');

  return {
    save(sub: PushSub, now: number): void {
      upsert.run(sub.endpoint, sub.siteId, sub.userId, sub.deviceId, sub.p256dh, sub.auth, now);
    },
    /** Знімає підписки пристрою користувача. */
    removeDevice(siteId: string, userId: string, deviceId: string): void {
      removeDevice.run(siteId, userId, deviceId);
    },
    removeEndpoint(endpoint: string): void {
      removeEndpoint.run(endpoint);
    },
    forUser(siteId: string, userId: string): PushSub[] {
      return (selectUser.all(siteId, userId) as Raw[]).map(toSub);
    },
  };
}

export type PushSubs = ReturnType<typeof createPushSubs>;
