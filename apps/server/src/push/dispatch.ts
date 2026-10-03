import type { PushPayload } from '@dialer/shared';
import type { Effect } from '../calls/types';
import type { Users } from '../db/users';
import type { Logger } from '../logger';
import type { CallStore } from '../store/calls';
import type { PresenceStore } from '../store/presence';
import type { Push } from './index';
import type { RejectTokens } from './reject-token';

/** Причини завершення, після яких адресат пропустив дзвінок (сповіщення стає «Пропущений дзвінок»). */
const MISSED: ReadonlySet<string> = new Set(['cancelled', 'timeout']);

/**
 * Додає Web Push до доставки: вхідний дзвінок і його завершення, окрім WebSocket, йдуть на підписані пристрої адресата,
 * які зараз без з'єднання. Пристрої з WebSocket отримують лише кадри (сервіс-воркер зобов'язаний показати сповіщення на кожен push).
 * Push не блокує доставку кадрів і не ламає її помилками.
 */
export function createPushDispatch(deps: {
  push: Push;
  presence: PresenceStore;
  store: CallStore;
  users: Users;
  rejectTokens: RejectTokens;
  now(): number;
  logger: Logger;
}) {
  const { push, presence, store, users, rejectTokens } = deps;
  const chains = new Map<string, Promise<unknown>>();

  async function forEffect(e: Effect): Promise<void> {
    const msg = e.msg;
    // `deviceId`: кадр для одного пристрою, який уже в мережі (відповів чи відхилив), push йому не потрібен
    if ((msg.type !== 'call.incoming' && msg.type !== 'call.ended') || e.deviceId !== undefined) return;
    const online = new Set(presence.connections(e.siteId, e.userId).map(c => c.deviceId));
    if (e.exceptDeviceId !== undefined) online.add(e.exceptDeviceId);

    if (msg.type === 'call.incoming') {
      const { call } = msg;
      if (!call.expiresAt) return;
      const payload: PushPayload = {
        type: 'call.incoming',
        callId: call.callId,
        from: call.peer,
        expiresAt: call.expiresAt,
        rejectToken: await rejectTokens.sign(
          { callId: call.callId, siteId: e.siteId, userId: e.userId },
          call.expiresAt,
        ),
      };
      const ttl = Math.max(1, Math.ceil((call.expiresAt - deps.now()) / 1000));
      return push.notify(e.siteId, e.userId, payload, { ttl, urgency: 'high' }, online);
    }

    const call = store.get(msg.callId);
    // push про завершення лише адресату (той, хто дзвонив, не отримував incoming)
    if (!call || call.calleeId !== e.userId) return;
    const callerUser = MISSED.has(msg.reason) ? users.get(call.siteId, call.callerId) : null;
    const caller = callerUser && { userId: callerUser.id, name: callerUser.name };
    const payload: PushPayload = caller
      ? { type: 'call.ended', callId: call.id, missed: true, from: caller }
      : { type: 'call.ended', callId: call.id };
    // сповіщення про завершення живе недовго: пристрій, що був офлайн, не має отримати його через добу
    return push.notify(e.siteId, e.userId, payload, { ttl: caller ? 24 * 3600 : 60 }, online);
  }

  return {
    /** Обгортає `deliver`: спершу кадри, далі push (у фоні). */
    wrap(deliver: (effects: Effect[]) => void) {
      return (effects: Effect[]): void => {
        deliver(effects);
        for (const e of effects) {
          // push одного дзвінка йдуть по черзі: «завершено» не має обігнати «вхідний» (підпис токена асинхронний)
          const key =
            e.msg.type === 'call.incoming' ? e.msg.call.callId : e.msg.type === 'call.ended' ? e.msg.callId : null;
          if (!key) continue;
          const run = (chains.get(key) ?? Promise.resolve())
            .then(() => forEffect(e))
            .catch(err => deps.logger.warn({ err }, 'не вдалося розіслати push про дзвінок'));
          chains.set(key, run);
          void run.then(() => chains.get(key) === run && chains.delete(key));
        }
      };
    },
  };
}
