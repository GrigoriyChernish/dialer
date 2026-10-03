import type { Clock } from '../calls/types';

/** Доставка коду входу. Повертає код, який перевіримо; заміна на SMS-провайдера не зачіпає решту. */
export interface OtpSender {
  send(phone: string): Promise<string>;
}

/** Поки без SMS: код = останні 4 цифри номера, нікуди не надсилається. */
export const lastDigitsOtp: OtpSender = { send: async phone => phone.slice(-4) };

export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
/** Скільки номер заблокований після вичерпаних спроб. */
export const OTP_LOCK_MS = 15 * 60_000;

interface Challenge {
  code: string;
  expiresAt: number;
  attempts: number;
  lockedUntil: number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: 'no_challenge' }
  | { ok: false; error: 'invalid_code'; attemptsLeft: number }
  | { ok: false; error: 'too_many_attempts'; retryAfter: number };

/** Виклики кодів у пам'яті: процес один (docs/backend.md), а перезапуск лише просить ввести номер знову. */
export function createOtp(sender: OtpSender, clock: Clock) {
  const challenges = new Map<string, Challenge>();

  const locked = (c: Challenge | undefined, now: number) => (c && c.lockedUntil > now ? c.lockedUntil - now : 0);

  return {
    /** Новий код для номера. Повторний запит не скидає лічильник спроб, поки діє блокування. */
    async start(phone: string): Promise<{ retryAfter: number } | null> {
      const now = clock.now();
      for (const [p, c] of challenges) if (c.expiresAt <= now && c.lockedUntil <= now) challenges.delete(p);
      const prev = challenges.get(phone);
      const wait = locked(prev, now);
      if (wait) return { retryAfter: wait };
      const code = await sender.send(phone);
      challenges.set(phone, { code, expiresAt: now + OTP_TTL_MS, attempts: 0, lockedUntil: 0 });
      return null;
    },
    verify(phone: string, code: string): VerifyResult {
      const now = clock.now();
      const c = challenges.get(phone);
      const wait = locked(c, now);
      if (wait) return { ok: false, error: 'too_many_attempts', retryAfter: wait };
      if (!c || c.expiresAt <= now) return { ok: false, error: 'no_challenge' };
      if (code === c.code) {
        challenges.delete(phone);
        return { ok: true };
      }
      c.attempts++;
      if (c.attempts >= OTP_MAX_ATTEMPTS) {
        c.lockedUntil = now + OTP_LOCK_MS;
        return { ok: false, error: 'too_many_attempts', retryAfter: OTP_LOCK_MS };
      }
      return { ok: false, error: 'invalid_code', attemptsLeft: OTP_MAX_ATTEMPTS - c.attempts };
    },
  };
}

export type Otp = ReturnType<typeof createOtp>;
