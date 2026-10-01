import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../calls/types';
import type { Db } from '../db';

/** Сесія входу: 7 днів від входу, без подовження. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Refresh-токени сесій. Клієнт тримає токен, у базі лише його хеш. */
export function createSessions(db: Db, clock: Clock) {
  const insert = db.prepare(
    'INSERT INTO sessions (id, site_id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  );
  const select = db.prepare('SELECT site_id, user_id, expires_at FROM sessions WHERE id = ?');
  const remove = db.prepare('DELETE FROM sessions WHERE id = ?');
  const purge = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    create(siteId: string, userId: string) {
      const now = clock.now();
      purge.run(now);
      const refreshToken = randomBytes(32).toString('base64url');
      const expiresAt = now + SESSION_TTL_MS;
      insert.run(hash(refreshToken), siteId, userId, now, expiresAt);
      return { refreshToken, expiresAt };
    },
    /** Чинна сесія за токеном або `null`. */
    get(refreshToken: string): { siteId: string; userId: string; expiresAt: number } | null {
      const row = select.get(hash(refreshToken)) as
        { site_id: string; user_id: string; expires_at: number } | undefined;
      if (!row || row.expires_at <= clock.now()) return null;
      return { siteId: row.site_id, userId: row.user_id, expiresAt: row.expires_at };
    },
    revoke(refreshToken: string): void {
      remove.run(hash(refreshToken));
    },
  };
}

export type Sessions = ReturnType<typeof createSessions>;
