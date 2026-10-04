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
  /** Коли номер підтверджено кодом; `null`: ще ні (наступний вхід питає код). */
  verifiedAt: number | null;
  /** До якого часу (мс) історію переглянуто: лічильник пропущених рахується від нього. */
  recentsSeenUpTo: number;
}

interface RawUser {
  site_id: string;
  id: string;
  name: string;
  disabled: number;
  is_bot: number;
  settings: string;
  verified_at: number | null;
  recents_seen_up_to: number;
}

const toUser = (r: RawUser): UserRow => ({
  siteId: r.site_id,
  id: r.id,
  name: r.name,
  disabled: r.disabled === 1,
  isBot: r.is_bot === 1,
  settings: { ...DEFAULT_SETTINGS, ...JSON.parse(r.settings) },
  verifiedAt: r.verified_at ?? null,
  recentsSeenUpTo: r.recents_seen_up_to ?? 0,
});

/** Демо-співрозмовники зі сценаріями з docs/demo.md; поведінка в `bots/scenarios.ts`. */
export const DEMO_BOTS = [
  { id: 'bot:olena', name: 'Олена' },
  { id: 'bot:andriy', name: 'Андрій' },
  { id: 'bot:support', name: 'Support' },
  { id: 'bot:video', name: 'Відео-тест' },
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
  const markVerifiedStmt = db.prepare(
    'UPDATE users SET verified_at = ? WHERE site_id = ? AND id = ? AND verified_at IS NULL',
  );
  const updateSettingsStmt = db.prepare('UPDATE users SET settings = ? WHERE site_id = ? AND id = ?');
  const markSeenStmt = db.prepare(
    'UPDATE users SET recents_seen_up_to = MAX(recents_seen_up_to, ?) WHERE site_id = ? AND id = ?',
  );
  const renameStmt = db.prepare('UPDATE users SET name = ? WHERE site_id = ? AND id = ?');
  const selectOthers = db.prepare(
    'SELECT * FROM users WHERE site_id = ? AND id != ? AND disabled = 0 ORDER BY is_bot, name',
  );

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
    /** Номер підтверджено кодом (перший раз). */
    markVerified(siteId: string, id: string, now: number): void {
      markVerifiedStmt.run(now, siteId, id);
    },
    /** Зберігає змінені налаштування; повертає повний набір із типовими значеннями. */
    updateSettings(siteId: string, id: string, patch: Partial<Settings>): Settings {
      const row = select.get(siteId, id) as RawUser;
      const stored = { ...JSON.parse(row.settings), ...patch };
      updateSettingsStmt.run(JSON.stringify(stored), siteId, id);
      return { ...DEFAULT_SETTINGS, ...stored };
    },
    /** Історію переглянуто до `upTo` (мс); час лише зростає. Повертає актуальне значення. */
    markRecentsSeen(siteId: string, id: string, upTo: number): number {
      markSeenStmt.run(Math.floor(upTo), siteId, id);
      return get(siteId, id)!.recentsSeenUpTo;
    },
    /** Нове ім'я (уже перевірене `normalizeName`); повертає оновлений запис. */
    rename(siteId: string, id: string, name: string): UserRow {
      renameStmt.run(name, siteId, id);
      return get(siteId, id)!;
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
