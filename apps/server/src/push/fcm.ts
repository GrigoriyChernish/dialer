import { createSign } from 'node:crypto';
import type { PushPayload } from '@dialer/shared';
import type { PushSub } from '../db/push';
import type { PushOptions, PushResult, PushSender } from './sender';

/** Підписка Android зберігається в `push_subscriptions.endpoint` як `fcm:<токен>`: окремої таблиці й міграції не треба. */
export const FCM_PREFIX = 'fcm:';
export const isFcmEndpoint = (endpoint: string) => endpoint.startsWith(FCM_PREFIX);

/** Токен FCM з `push.subscribe`; `null`: порожній чи задовгий. */
export function parseFcmToken(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 4096 && /^[\w:\-.]+$/.test(raw) ? raw : null;
}

/** Ключ сервісного акаунта Firebase (JSON, який віддає Firebase Console). */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64 = (v: object | Buffer) => Buffer.from(v instanceof Buffer ? v : JSON.stringify(v)).toString('base64url');

/** Підписаний JWT для обміну на токен доступу OAuth2 (`urn:ietf:params:oauth:grant-type:jwt-bearer`). */
function assertion(sa: FcmServiceAccount, nowSec: number): string {
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key);
  return `${head}.${body}.${b64(sig)}`;
}

/** `data` в FCM лише рядки: payload сплющуємо (`from` → `fromUserId`, `fromName`). */
export function fcmData(payload: PushPayload): Record<string, string> {
  const data: Record<string, string> = { type: payload.type, callId: payload.callId };
  if (payload.type === 'call.incoming') {
    data.fromUserId = payload.from.userId;
    data.fromName = payload.from.name;
    data.expiresAt = String(payload.expiresAt);
    data.rejectToken = payload.rejectToken;
  } else if (payload.missed) {
    data.missed = '1';
    if (payload.from) {
      data.fromUserId = payload.from.userId;
      data.fromName = payload.from.name;
    }
  }
  return data;
}

/** Відправник FCM HTTP v1: токен доступу береться з сервісного акаунта й кешується до завершення. */
export function createFcmSender(
  sa: FcmServiceAccount,
  deps: { fetch?: typeof fetch; now?: () => number } = {},
): PushSender {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  let access: { token: string; until: number } | null = null;

  async function accessToken(): Promise<string> {
    if (access && access.until > now()) return access.token;
    const res = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: assertion(sa, Math.floor(now() / 1000)),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`oauth ${res.status}`);
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    // оновлюємо за хвилину до кінця
    access = { token: access_token, until: now() + (expires_in - 60) * 1000 };
    return access.token;
  }

  return {
    async send(sub: PushSub, payload: PushPayload, opts: PushOptions): Promise<PushResult> {
      try {
        const res = await doFetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: sub.endpoint.slice(FCM_PREFIX.length),
              data: fcmData(payload),
              android: { priority: opts.urgency === 'high' ? 'HIGH' : 'NORMAL', ttl: `${opts.ttl}s` },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return 'ok';
        // токен недійсний (застосунок видалено): UNREGISTERED (404) чи INVALID_ARGUMENT (400)
        return res.status === 404 || res.status === 400 ? 'gone' : 'error';
      } catch {
        return 'error';
      }
    },
  };
}
