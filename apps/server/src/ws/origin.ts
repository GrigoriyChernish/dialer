import type { Config } from '../config';
import type { Db } from '../db';

/**
 * Які `Origin` приймає WebSocket (docs/signaling.md, «Origin»). Браузер завжди надсилає `Origin` у рукостисканні, тож чужа сторінка не може
 * підключитись від імені користувача. Дозволені: `DEMO_ORIGIN`, `allowed_origins` усіх сайтів (таблиця `sites`) і, поза production, будь-який localhost.
 * Без заголовка (не браузер: тести, `curl`, нативні клієнти) приймаємо: доступ однаково дає токен у `hello`.
 */
export function createOriginPolicy(config: Pick<Config, 'demoOrigin' | 'production'>, db: Db) {
  const select = db.prepare('SELECT allowed_origins FROM sites');
  const siteOrigins = (): Set<string> => {
    const out = new Set<string>();
    for (const row of select.all() as { allowed_origins: string }[]) {
      try {
        const list: unknown = JSON.parse(row.allowed_origins);
        if (Array.isArray(list)) for (const o of list) if (typeof o === 'string') out.add(o);
      } catch {
        // зіпсований список сайту просто нічого не дозволяє
      }
    }
    return out;
  };
  return (origin: string | undefined): boolean => {
    if (!origin) return true;
    if (origin === config.demoOrigin) return true;
    if (origin === 'tauri://localhost' || /^https?:\/\/tauri\.localhost$/.test(origin)) return true;
    if (!config.production && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return true;
    return siteOrigins().has(origin);
  };
}

export type OriginPolicy = ReturnType<typeof createOriginPolicy>;
