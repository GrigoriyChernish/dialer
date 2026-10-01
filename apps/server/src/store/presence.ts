import type { ServerMessage } from '@dialer/shared';

/** Підключений пристрій користувача. */
export interface Connection {
  id: string;
  siteId: string;
  userId: string;
  deviceId: string;
  send(msg: ServerMessage): void;
  close(code: number, reason?: string): void;
}

/** Присутність: хто підключений. Зараз у пам'яті, інтерфейс дозволяє замінити реалізацію (docs/backend.md). */
export interface PresenceStore {
  /** Повертає `true`, якщо це перше підключення користувача. */
  add(conn: Connection): boolean;
  /** Повертає `true`, якщо це було останнє підключення користувача. */
  remove(conn: Connection): boolean;
  isOnline(siteId: string, userId: string): boolean;
  connections(siteId: string, userId: string): Connection[];
  siteConnections(siteId: string): Connection[];
}

export function createMemoryPresence(): PresenceStore {
  const byUser = new Map<string, Set<Connection>>();
  const key = (siteId: string, userId: string) => `${siteId}\u0000${userId}`;
  return {
    add(conn) {
      const k = key(conn.siteId, conn.userId);
      let set = byUser.get(k);
      const first = !set;
      if (!set) byUser.set(k, (set = new Set()));
      set.add(conn);
      return first;
    },
    remove(conn) {
      const k = key(conn.siteId, conn.userId);
      const set = byUser.get(k);
      if (!set?.delete(conn)) return false;
      if (set.size > 0) return false;
      byUser.delete(k);
      return true;
    },
    isOnline: (siteId, userId) => byUser.has(key(siteId, userId)),
    connections: (siteId, userId) => [...(byUser.get(key(siteId, userId)) ?? [])],
    siteConnections: (siteId) =>
      [...byUser.values()].flatMap((set) => [...set]).filter((c) => c.siteId === siteId),
  };
}
