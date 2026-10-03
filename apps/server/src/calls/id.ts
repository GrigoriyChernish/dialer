import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID: 48 біт часу й 80 біт випадковості, 26 символів Crockford base32. */
export function ulid(nowMs = Date.now()): string {
  let time = '';
  for (let t = nowMs, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ALPHABET[t % 32]! + time;
  const rnd = randomBytes(16);
  let random = '';
  for (let i = 0; i < 16; i++) random += ALPHABET[rnd[i]! % 32];
  return time + random;
}
