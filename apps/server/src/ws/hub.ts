import { PROTOCOL_VERSION, type Contact, type ServerMessage } from '@dialer/shared';
import type { UserRow, Users } from '../db/users';
import type { Connection, PresenceStore } from '../store/presence';

/** Розсилка подій і зведення присутності з контактами. */
export function createHub(presence: PresenceStore, users: Users) {
  const toContact = (u: UserRow): Contact => ({
    userId: u.id,
    name: u.name,
    // боти завжди «в мережі»
    online: u.isBot || presence.isOnline(u.siteId, u.id),
  });

  /** Надсилає подію всім пристроям сайту, крім пристроїв користувача `exceptUserId`. */
  const broadcast = (siteId: string, msg: ServerMessage, exceptUserId?: string) => {
    for (const conn of presence.siteConnections(siteId)) {
      if (conn.userId !== exceptUserId) conn.send(msg);
    }
  };

  return {
    contactsFor: (siteId: string, userId: string): Contact[] => users.listOthers(siteId, userId).map(toContact),

    connect(conn: Connection) {
      if (presence.add(conn)) {
        broadcast(
          conn.siteId,
          { v: PROTOCOL_VERSION, type: 'presence', userId: conn.userId, online: true },
          conn.userId,
        );
      }
    },

    disconnect(conn: Connection) {
      if (presence.remove(conn)) {
        broadcast(
          conn.siteId,
          { v: PROTOCOL_VERSION, type: 'presence', userId: conn.userId, online: false },
          conn.userId,
        );
      }
    },

    /** Хтось увійшов чи змінив ім'я: решта бачить це в контактах. */
    announceUser(user: UserRow) {
      broadcast(
        user.siteId,
        { v: PROTOCOL_VERSION, type: 'contacts.update', upsert: [toContact(user)], remove: [] },
        user.id,
      );
    },
  };
}

export type Hub = ReturnType<typeof createHub>;
