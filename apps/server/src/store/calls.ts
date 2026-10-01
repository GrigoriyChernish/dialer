import type { Call } from '../calls/types';
import type { Db } from '../db';

/** Активні дзвінки. Пам'ять із записом у SQLite, щоб перезапуск не губив дзвінки (docs/backend.md). */
export interface CallStore {
  get(id: string): Call | undefined;
  save(call: Call): void;
  /** Забуває завершений дзвінок (рядок у БД лишається як журнал). */
  remove(id: string): void;
  /** Дзвінки користувача, які ще не завершені. */
  activeFor(siteId: string, userId: string): Call[];
  /** Завантажує незавершені дзвінки з БД у пам'ять (при старті). */
  loadActive(): Call[];
}

interface RawCall {
  id: string;
  site_id: string;
  caller_id: string;
  callee_id: string;
  caller_device: string;
  answered_device: string | null;
  video: number;
  state: Call['state'];
  created_at: number;
  expires_at: number;
  answered_at: number | null;
  hold_caller: number;
  hold_callee: number;
  ended_at: number | null;
  reason: string | null;
}

const fromRow = (r: RawCall): Call => ({
  id: r.id,
  siteId: r.site_id,
  callerId: r.caller_id,
  calleeId: r.callee_id,
  callerDevice: r.caller_device,
  ...(r.answered_device !== null && { answeredDevice: r.answered_device }),
  video: r.video === 1,
  state: r.state,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  ...(r.answered_at !== null && { answeredAt: r.answered_at }),
  holdCaller: r.hold_caller === 1,
  holdCallee: r.hold_callee === 1,
  ...(r.ended_at !== null && { endedAt: r.ended_at }),
  ...(r.reason !== null && { reason: r.reason }),
});

export function createCallStore(db: Db): CallStore {
  const calls = new Map<string, Call>();
  const upsert = db.prepare(
    `INSERT INTO calls (id, site_id, caller_id, callee_id, caller_device, answered_device, video, state,
       created_at, expires_at, answered_at, hold_caller, hold_callee, ended_at, reason)
     VALUES (@id, @siteId, @callerId, @calleeId, @callerDevice, @answeredDevice, @video, @state,
       @createdAt, @expiresAt, @answeredAt, @holdCaller, @holdCallee, @endedAt, @reason)
     ON CONFLICT (id) DO UPDATE SET answered_device = excluded.answered_device, state = excluded.state,
       answered_at = excluded.answered_at, hold_caller = excluded.hold_caller, hold_callee = excluded.hold_callee,
       ended_at = excluded.ended_at, reason = excluded.reason`,
  );
  const selectActive = db.prepare('SELECT * FROM calls WHERE ended_at IS NULL');

  return {
    get: id => calls.get(id),
    save(call) {
      calls.set(call.id, call);
      upsert.run({
        ...call,
        answeredDevice: call.answeredDevice ?? null,
        video: call.video ? 1 : 0,
        answeredAt: call.answeredAt ?? null,
        holdCaller: call.holdCaller ? 1 : 0,
        holdCallee: call.holdCallee ? 1 : 0,
        endedAt: call.endedAt ?? null,
        reason: call.reason ?? null,
      });
    },
    remove: id => void calls.delete(id),
    activeFor: (siteId, userId) =>
      [...calls.values()].filter(
        c => c.siteId === siteId && c.state !== 'ended' && (c.callerId === userId || c.calleeId === userId),
      ),
    loadActive() {
      const rows = (selectActive.all() as RawCall[]).map(fromRow);
      for (const call of rows) calls.set(call.id, call);
      return rows;
    },
  };
}
