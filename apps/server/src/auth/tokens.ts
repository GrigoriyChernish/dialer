import { errors, jwtVerify, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';

/** Термін життя токена користувача, с. */
export const TOKEN_TTL_S = 30 * 60;

export interface TokenClaims {
  /** userId */
  sub: string;
  /** siteId; для демо `demo` */
  sid: string;
  name: string;
  /** Кінець дії, мс. */
  expiresAt: number;
}

export class TokenError extends Error {
  constructor(readonly code: 'token_invalid' | 'token_expired') {
    super(code);
  }
}

/** JWT HS256; `kid` у заголовку дозволяє міняти ключ. */
export function createTokens(secret: string, kid = '1') {
  const key = new TextEncoder().encode(secret);
  return {
    async sign(claims: Omit<TokenClaims, 'expiresAt'>, nowMs = Date.now()) {
      const exp = Math.floor(nowMs / 1000) + TOKEN_TTL_S;
      const token = await new SignJWT({ sid: claims.sid, name: claims.name })
        .setProtectedHeader({ alg: 'HS256', kid })
        .setSubject(claims.sub)
        .setJti(randomUUID())
        .setIssuedAt(Math.floor(nowMs / 1000))
        .setExpirationTime(exp)
        .sign(key);
      return { token, expiresAt: exp * 1000 };
    },
    async verify(token: string): Promise<TokenClaims> {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        const { sub, sid, name, exp } = payload;
        if (typeof sub !== 'string' || typeof sid !== 'string' || typeof name !== 'string' || typeof exp !== 'number') {
          throw new TokenError('token_invalid');
        }
        return { sub, sid, name, expiresAt: exp * 1000 };
      } catch (e) {
        if (e instanceof TokenError) throw e;
        throw new TokenError(e instanceof errors.JWTExpired ? 'token_expired' : 'token_invalid');
      }
    },
  };
}

export type Tokens = ReturnType<typeof createTokens>;
