import { describe, expect, it } from 'vitest';
import { normalizeName, normalizePhone } from '../src/auth/phone';
import { createTokens, TokenError, TOKEN_TTL_S } from '../src/auth/tokens';

describe('normalizePhone', () => {
  it.each([
    ['501234567', '+380501234567'],
    ['0501234567', '+380501234567'],
    ['380501234567', '+380501234567'],
    ['+380 50 123 45 67', '+380501234567'],
    ['(050) 123-45-67', '+380501234567'],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(['', '12345', '+48123456789', '05012345678', 'abc'])('відхиляє %j', input =>
    expect(normalizePhone(input)).toBeNull(),
  );
});

describe('normalizeName', () => {
  it('обрізає пробіли й перевіряє довжину', () => {
    expect(normalizeName('  Ірина ')).toBe('Ірина');
    expect(normalizeName('І')).toBeNull();
    expect(normalizeName('а'.repeat(41))).toBeNull();
    expect(normalizeName('а'.repeat(40))).not.toBeNull();
  });
});

describe('tokens', () => {
  const secret = 'x'.repeat(32);
  const claims = { sub: '+380501234567', sid: 'demo', name: 'Ірина' };

  it('підписує й перевіряє', async () => {
    const tokens = createTokens(secret);
    const { token, expiresAt } = await tokens.sign(claims);
    const verified = await tokens.verify(token);
    expect(verified).toMatchObject(claims);
    expect(verified.expiresAt).toBe(expiresAt);
  });

  it('відрізняє прострочений токен від недійсного', async () => {
    const tokens = createTokens(secret);
    const old = await tokens.sign(claims, Date.now() - (TOKEN_TTL_S + 10) * 1000);
    await expect(tokens.verify(old.token)).rejects.toMatchObject({ code: 'token_expired' });
    await expect(tokens.verify('сміття')).rejects.toBeInstanceOf(TokenError);
    const other = createTokens('y'.repeat(32));
    await expect(other.verify((await tokens.sign(claims)).token)).rejects.toMatchObject({ code: 'token_invalid' });
  });
});
