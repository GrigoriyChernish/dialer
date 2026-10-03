import { jwtVerify, SignJWT } from 'jose';

export interface RejectClaims {
  callId: string;
  siteId: string;
  userId: string;
}

/**
 * Токен «Відхилити» з push: сервіс-воркер не має сесії, тому відхиляє дзвінок цим токеном (`POST /push/reject`).
 * Підписаний ключем сервера, прив'язаний до одного дзвінка й адресата, діє до кінця очікування відповіді.
 */
export function createRejectTokens(secret: string) {
  const key = new TextEncoder().encode(secret);
  const audience = 'push-reject';
  return {
    async sign(claims: RejectClaims, expiresAtMs: number): Promise<string> {
      return new SignJWT({ cid: claims.callId, sid: claims.siteId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(claims.userId)
        .setAudience(audience)
        .setExpirationTime(Math.ceil(expiresAtMs / 1000))
        .sign(key);
    },
    /** `null`: токен недійсний, прострочений чи не для відхилення. */
    async verify(token: unknown): Promise<RejectClaims | null> {
      if (typeof token !== 'string') return null;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], audience });
        const { cid, sid, sub } = payload as { cid?: unknown; sid?: unknown; sub?: unknown };
        if (typeof cid !== 'string' || typeof sid !== 'string' || typeof sub !== 'string') return null;
        return { callId: cid, siteId: sid, userId: sub };
      } catch {
        return null;
      }
    },
  };
}

export type RejectTokens = ReturnType<typeof createRejectTokens>;
