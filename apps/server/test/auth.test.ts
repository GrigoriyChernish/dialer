import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OTP_LOCK_MS, OTP_TTL_MS } from '../src/auth/otp';
import { SESSION_TTL_MS } from '../src/auth/sessions';
import { loadConfig } from '../src/config';
import { createFakeClock } from './fake-clock';
import { startServer, TestClient, type TestServer } from './helpers';

const clock = createFakeClock();
let server: TestServer;
beforeAll(async () => void (server = await startServer({ hello: 300 }, { clock })));
afterAll(() => server.close());

const post = async (path: string, body: object, headers: Record<string, string> = {}) => {
  const res = await fetch(`${server.http}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as any) };
};
// кожен тест зі своєї IP-адреси, щоб не впертися в ліміт /auth/start
let ip = 0;
const from = () => ({ 'fly-client-ip': `10.0.0.${++ip}` });

describe('вхід за номером', () => {
  it('новий номер: ім\'я + код (останні 4 цифри), далі сесія', async () => {
    const h = from();
    expect(await post('/auth/start', { phone: '0671110001' }, h)).toEqual({ status: 200, body: { known: false } });
    expect((await post('/auth/verify', { phone: '0671110001', code: '0001' }, h)).body).toEqual({ error: 'invalid_name' });
    const ok = await post('/auth/verify', { phone: '+380671110001', code: '0001', name: 'Ірина' }, h);
    expect(ok.status).toBe(200);
    expect(ok.body.user).toEqual({ userId: '+380671110001', name: 'Ірина' });
    expect(ok.body.refreshToken).toMatch(/^[\w-]{43}$/);
    expect(ok.body.sessionExpiresAt).toBe(clock.now() + SESSION_TTL_MS);

    // токен доступу працює в сигналізації
    const c = await TestClient.connect(server.ws);
    c.send({ type: 'hello', id: 'h', token: ok.body.token, deviceId: 'd_1' });
    expect((await c.next('hello.ok')).user).toEqual({ userId: '+380671110001', name: 'Ірина' });
    c.close();
  });

  it('відомий номер: лише код, ім\'я з бази', async () => {
    const h = from();
    await post('/auth/start', { phone: '0671110002' }, h);
    await post('/auth/verify', { phone: '0671110002', code: '0002', name: 'Перше' }, h);
    expect((await post('/auth/start', { phone: '0671110002' }, h)).body).toEqual({ known: true });
    const ok = await post('/auth/verify', { phone: '0671110002', code: '0002', name: 'Інше' }, h);
    expect(ok.body.user.name).toBe('Перше');
  });

  it('невірний код: лічильник спроб, потім блокування', async () => {
    const h = from();
    await post('/auth/start', { phone: '0671110003' }, h);
    for (let left = 4; left >= 1; left--) {
      expect(await post('/auth/verify', { phone: '0671110003', code: '9999', name: 'Тест' }, h)).toEqual({
        status: 401,
        body: { error: 'invalid_code', attemptsLeft: left },
      });
    }
    const locked = await post('/auth/verify', { phone: '0671110003', code: '9999', name: 'Тест' }, h);
    expect(locked).toEqual({ status: 429, body: { error: 'too_many_attempts', retryAfter: OTP_LOCK_MS / 1000 } });
    // правильний код і новий запит коду теж заблоковані
    expect((await post('/auth/verify', { phone: '0671110003', code: '0003', name: 'Тест' }, h)).status).toBe(429);
    expect((await post('/auth/start', { phone: '0671110003' }, h)).status).toBe(429);
    clock.advance(OTP_LOCK_MS);
    await post('/auth/start', { phone: '0671110003' }, h);
    expect((await post('/auth/verify', { phone: '0671110003', code: '0003', name: 'Тест' }, h)).status).toBe(200);
  });

  it('код спливає через 5 хв і без /auth/start не приймається', async () => {
    const h = from();
    expect((await post('/auth/verify', { phone: '0671110004', code: '0004', name: 'Тест' }, h)).body).toEqual({ error: 'no_challenge' });
    await post('/auth/start', { phone: '0671110004' }, h);
    clock.advance(OTP_TTL_MS);
    expect((await post('/auth/verify', { phone: '0671110004', code: '0004', name: 'Тест' }, h)).body).toEqual({ error: 'no_challenge' });
  });

  it('невалідний номер і ліміт /auth/start з однієї адреси', async () => {
    const h = from();
    expect((await post('/auth/start', { phone: '123' }, h)).body).toEqual({ error: 'invalid_phone' });
    for (let i = 0; i < 9; i++) await post('/auth/start', { phone: `06711120${10 + i}` }, h);
    const limited = await post('/auth/start', { phone: '0671112099' }, h);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');
  });

  it('refresh видає новий токен, logout і 7 днів завершують сесію', async () => {
    const h = from();
    await post('/auth/start', { phone: '0671110005' }, h);
    const { body } = await post('/auth/verify', { phone: '0671110005', code: '0005', name: 'Сесія' }, h);
    const r = await post('/auth/refresh', { refreshToken: body.refreshToken });
    expect(r.status).toBe(200);
    expect(r.body.user).toEqual({ userId: '+380671110005', name: 'Сесія' });
    expect(r.body.sessionExpiresAt).toBe(body.sessionExpiresAt);

    clock.advance(SESSION_TTL_MS);
    expect((await post('/auth/refresh', { refreshToken: body.refreshToken })).body).toEqual({ error: 'session_invalid' });

    await post('/auth/start', { phone: '0671110005' }, h);
    const again = await post('/auth/verify', { phone: '0671110005', code: '0005' }, h);
    expect((await post('/auth/logout', { refreshToken: again.body.refreshToken })).status).toBe(204);
    expect((await post('/auth/refresh', { refreshToken: again.body.refreshToken })).status).toBe(401);
    expect((await post('/auth/refresh', { refreshToken: 'nope' })).status).toBe(401);
  });

  it('/demo/login у production вимкнено, якщо не DEMO_LOGIN=on', () => {
    const base = { NODE_ENV: 'production', JWT_SECRET: 's'.repeat(32), LIVEKIT_URL: 'wss://x', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' };
    expect(loadConfig(base).demoLogin).toBe(false);
    expect(loadConfig({ ...base, DEMO_LOGIN: 'on' }).demoLogin).toBe(true);
    expect(loadConfig({ JWT_SECRET: 's'.repeat(32) }).demoLogin).toBe(true);
  });
});
