import type { PushPayload } from '@dialer/shared';
import type { PushSubs } from '../db/push';
import type { Logger } from '../logger';
import { isAllowedPushEndpoint } from './endpoint';
import type { PushOptions, PushSender } from './sender';

export interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Розбирає `subscription` з `push.subscribe` (`PushSubscription.toJSON()`); `null`: поля некоректні або endpoint не з білого списку. */
export function parseSubscription(raw: unknown): Subscription | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { endpoint, keys } = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isAllowedPushEndpoint(endpoint)) return null;
  const { p256dh, auth } = keys ?? {};
  if (
    typeof p256dh !== 'string' ||
    typeof auth !== 'string' ||
    !p256dh ||
    !auth ||
    p256dh.length > 256 ||
    auth.length > 64
  )
    return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Підписки пристроїв і відправка push. Без ключів VAPID (`sender === null`) push вимкнено. */
export function createPush(deps: {
  subs: PushSubs;
  sender: PushSender | null;
  vapidPublicKey: string | null;
  logger: Logger;
  now(): number;
}) {
  const { subs, sender, logger } = deps;
  return {
    /** Публічний ключ для `pushManager.subscribe`; `null`: push вимкнено. */
    vapidPublicKey: deps.vapidPublicKey,
    enabled: sender !== null,
    subscribe(siteId: string, userId: string, deviceId: string, sub: Subscription): void {
      // на пристрої одна підписка: стара (інший endpoint) замінюється
      subs.removeDevice(siteId, userId, deviceId);
      subs.save({ endpoint: sub.endpoint, siteId, userId, deviceId, ...sub.keys }, deps.now());
    },
    unsubscribe(siteId: string, userId: string, deviceId: string): void {
      subs.removeDevice(siteId, userId, deviceId);
    },
    hasSubscriptions(siteId: string, userId: string): boolean {
      return sender !== null && subs.forUser(siteId, userId).length > 0;
    },
    /** Надсилає push на підписки користувача (окрім `exceptDevices`); недійсні підписки видаляє. */
    async notify(
      siteId: string,
      userId: string,
      payload: PushPayload,
      opts: PushOptions,
      exceptDevices: ReadonlySet<string> = new Set(),
    ): Promise<void> {
      if (!sender) return;
      await Promise.all(
        subs
          .forUser(siteId, userId)
          .filter(s => !exceptDevices.has(s.deviceId))
          .map(async s => {
            const result = await sender.send(s, payload, opts);
            if (result === 'gone') subs.removeEndpoint(s.endpoint);
            else if (result === 'error') logger.warn({ userId, deviceId: s.deviceId }, 'не вдалося надіслати push');
          }),
      );
    },
  };
}

export type Push = ReturnType<typeof createPush>;
