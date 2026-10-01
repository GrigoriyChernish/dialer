import type { Effect } from '../calls/types';
import type { PresenceStore } from '../store/presence';

/** Доставляє повідомлення користувачам через їхні підключені пристрої. */
export function createDeliver(presence: PresenceStore) {
  return (effects: Effect[]): void => {
    for (const e of effects) {
      for (const conn of presence.connections(e.siteId, e.userId)) {
        if (e.deviceId !== undefined && conn.deviceId !== e.deviceId) continue;
        if (e.exceptDeviceId !== undefined && conn.deviceId === e.exceptDeviceId) continue;
        conn.send(e.msg);
      }
    }
  };
}
