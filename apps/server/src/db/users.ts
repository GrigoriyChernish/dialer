import { DEFAULT_SETTINGS, type Settings } from '@dialer/shared';
import type { Db } from './index';

export const DEMO_SITE_ID = 'demo';

export interface UserRow {
  siteId: string;
  id: string;
  name: string;
  disabled: boolean;
  isBot: boolean;
  settings: Settings;
}

interface RawUser {
  site_id: string;
  id: string;
  name: string;
  disabled: number;
  is_bot: number;
  settings: string;
}

const toUser = (r: RawUser): UserRow => ({
  siteId: r.site_id,
  id: r.id,
  name: r.name,
  disabled: r.disabled === 1,
  isBot: r.is_bot === 1,
  settings: { ...DEFAULT_SETTINGS, ...JSON.parse(r.settings) },
});

/** Демо-співрозмовники зі сценаріями з docs/demo.md; поведінку отримають на кроці 3. */
export const DEMO_BOTS = [
  { id: 'bot:olena', name: 'Олена' },
  { id: 'bot:andriy', name: 'Андрій' },
  { id: 'bot:support', name: 'Support' },
];

export function createUsers(db: Db) {
  const upsert = db.prepare(
    `INSERT INTO users (site_id, id, name, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (site_id, id) DO UPDATE SET name = excluded.name`,
  );
  const insertBot = db.prepare(
    `INSERT OR IGNORE INTO users (site_id, id, name, is_bot, created_at) VALUES (?, ?, ?, 1, ?)`,
  );
  const select = db.prepare('SELECT * FROM users WHERE site_id = ? AND id = ?');
  const selectOthers = db.prepare('SELECT * FROM users WHERE site_id = ? AND id != ? AND disabled = 0 ORDER BY is_bot, name');

  const get = (siteId: string, id: string): UserRow | null => {
    const row = select.get(siteId, id) as RawUser | undefined;
    return row ? toUser(row) : null;
  };

  return {
    get,
    /** Той самий номер: той самий користувач, ім'я оновлюється. */
    upsertDemoUser(id: string, name: string): UserRow {
      upsert.run(DEMO_SITE_ID, id, name, Date.now());
      return get(DEMO_SITE_ID, id)!;
    },
    /** Усі користувачі сайту, крім самого (у демо це контакти). */
    listOthers(siteId: string, exceptId: string): UserRow[] {
      return (selectOthers.all(siteId, exceptId) as RawUser[]).map(toUser);
    },
    seedBots(): void {
      for (const bot of DEMO_BOTS) insertBot.run(DEMO_SITE_ID, bot.id, bot.name, Date.now());
    },
  };
}

export type Users = ReturnType<typeof createUsers>;
