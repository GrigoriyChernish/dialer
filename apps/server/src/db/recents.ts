import type { RecentEntry, RecentResult } from '@dialer/shared';
import type { Db } from './index';

interface RawRecent {
  call_id: string;
  peer_id: string;
  direction: 'out' | 'in';
  result: RecentResult;
  started_at: number;
  duration: number | null;
  silent: number;
}

const toEntry = (r: RawRecent): RecentEntry => ({
  callId: r.call_id,
  peer: r.peer_id,
  direction: r.direction,
  result: r.result,
  startedAt: r.started_at,
  ...(r.duration !== null && { duration: r.duration }),
  ...(r.silent === 1 && { silent: true }),
});

/** Історія дзвінків: один запис на користувача за дзвінок. */
export function createRecents(db: Db) {
  const insert = db.prepare(
    `INSERT INTO recents (site_id, user_id, call_id, peer_id, direction, result, started_at, duration, silent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const select = db.prepare(
    'SELECT * FROM recents WHERE site_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?',
  );
  return {
    add(siteId: string, userId: string, entry: RecentEntry): void {
      insert.run(siteId, userId, entry.callId, entry.peer, entry.direction, entry.result, entry.startedAt, entry.duration ?? null, entry.silent ? 1 : 0);
    },
    /** Новіші першими. */
    list(siteId: string, userId: string, limit = 50): RecentEntry[] {
      return (select.all(siteId, userId, limit) as RawRecent[]).map(toEntry);
    },
  };
}

export type Recents = ReturnType<typeof createRecents>;
