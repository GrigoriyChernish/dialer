import type { Clock } from '../src/calls/types';

/** Годинник для тестів: час стоїть, доки його не зсунути `advance`. */
export function createFakeClock(start = 1_000_000) {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  /** `clear` імітує загибель процесу: усі таймери зникають. */
  const clock: Clock & { advance(ms: number): void; clear(): void } = {
    now: () => now,
    clear: () => timers.clear(),
    after(ms, fn) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return () => void timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = target;
    },
  };
  return clock;
}
