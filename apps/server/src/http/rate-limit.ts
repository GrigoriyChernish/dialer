import type { Clock } from '../calls/types';

/** Фіксоване вікно: не більше `limit` подій на ключ за `windowMs`. Повертає мс до наступної спроби або 0. */
export function createRateLimit(limit: number, windowMs: number, clock: Clock) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): number => {
    const now = clock.now();
    if (hits.size > 10_000) for (const [k, h] of hits) if (h.resetAt <= now) hits.delete(k);
    const h = hits.get(key);
    if (!h || h.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return 0;
    }
    if (h.count >= limit) return h.resetAt - now;
    h.count++;
    return 0;
  };
}
