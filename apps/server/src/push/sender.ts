import webpush from 'web-push';
import type { PushPayload } from '@dialer/shared';
import type { PushSub } from '../db/push';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` чи `https:` адреса власника сервера: push-сервіс пише на неї, якщо щось не так. */
  subject: string;
}

export interface PushOptions {
  /** Скільки секунд push-сервіс тримає повідомлення, якщо пристрій недоступний. */
  ttl: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

/** `gone`: підписка недійсна (404/410), її видаляють; `error`: тимчасова помилка. */
export type PushResult = 'ok' | 'gone' | 'error';

/** Відправник push; у тестах підміняється. */
export interface PushSender {
  send(sub: PushSub, payload: PushPayload, opts: PushOptions): Promise<PushResult>;
}

export function createPushSender(vapid: VapidConfig): PushSender {
  return {
    async send(sub, payload, opts) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { vapidDetails: vapid, TTL: opts.ttl, urgency: opts.urgency ?? 'normal', timeout: 10_000 },
        );
        return 'ok';
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'error';
      }
    },
  };
}
