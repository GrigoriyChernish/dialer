import { PROTOCOL_VERSION, type Contact, type PresenceStatus, type ServerMessage } from '@dialer/shared';
import { botScenario } from '../bots/scenarios';
import type { UserRow, Users } from '../db/users';
import type { Connection, PresenceStore } from '../store/presence';

/** Що ще, крім з'єднань, впливає на статус: дзвінки й підписки Web Push (передаються функціями, бо створюються пізніше). */
export interface StatusSources {
  inCall(siteId: string, userId: string): boolean;
  hasPush(siteId: string, userId: string): boolean;
}

/** Розсилка подій і статус контактів (docs/signaling.md#статус-контакта). */
export function createHub(presence: PresenceStore, users: Users, sources: StatusSources) {
  const key = (siteId: string, userId: string) => `${siteId}\u0000${userId}`;
  /** Останній розісланий статус: подія `presence` йде лише при зміні. */
  const sent = new Map<string, PresenceStatus>();

  /** Порядок: недосяжний → у дзвінку → «Не турбувати» → на екрані чи ні. */
  const statusOf = (u: UserRow): PresenceStatus => {
    // боти завжди в мережі; Support відповідає «зайнято»
    if (u.isBot) return botScenario(u.id).kind === 'busy' ? 'busy' : 'free';
    const conns = presence.connections(u.siteId, u.id);
    if (conns.length === 0 && !sources.hasPush(u.siteId, u.id)) return 'offline';
    if (sources.inCall(u.siteId, u.id)) return 'busy';
    if (u.settings.dnd) return 'dnd';
    return conns.some(c => !c.hidden) ? 'free' : 'away';
  };
  const toContact = (u: UserRow): Contact => ({ userId: u.id, name: u.name, status: statusOf(u) });

  /** Надсилає подію всім пристроям сайту, крім пристроїв користувача `exceptUserId`. */
  const broadcast = (siteId: string, msg: ServerMessage, exceptUserId?: string) => {
    for (const conn of presence.siteConnections(siteId)) {
      if (conn.userId !== exceptUserId) conn.send(msg);
    }
  };

  /** Перераховує статус користувача і, якщо він змінився, розсилає `presence` решті сайту. */
  function refresh(siteId: string, userId: string) {
    const user = users.get(siteId, userId);
    if (!user || user.isBot) return;
    const status = statusOf(user);
    const k = key(siteId, userId);
    if (sent.get(k) === status) return;
    sent.set(k, status);
    broadcast(siteId, { v: PROTOCOL_VERSION, type: 'presence', userId, status }, userId);
  }

  return {
    contactsFor: (siteId: string, userId: string): Contact[] => users.listOthers(siteId, userId).map(toContact),
    refresh,

    connect(conn: Connection) {
      presence.add(conn);
      refresh(conn.siteId, conn.userId);
    },

    /** Повертає `true`, якщо це був останній пристрій користувача. */
    disconnect(conn: Connection): boolean {
      const last = presence.remove(conn);
      refresh(conn.siteId, conn.userId);
      return last;
    },

    /** Хтось увійшов чи змінив ім'я: решта бачить це в контактах. */
    announceUser(user: UserRow) {
      sent.set(key(user.siteId, user.id), statusOf(user));
      broadcast(
        user.siteId,
        { v: PROTOCOL_VERSION, type: 'contacts.update', upsert: [toContact(user)], remove: [] },
        user.id,
      );
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
