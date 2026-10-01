import Fastify from 'fastify';
import type { Otp } from '../auth/otp';
import { normalizeName, normalizePhone } from '../auth/phone';
import type { Sessions } from '../auth/sessions';
import type { Tokens } from '../auth/tokens';
import type { Clock } from '../calls/types';
import type { Config } from '../config';
import { DEMO_SITE_ID, type Users } from '../db/users';
import type { CallService } from '../calls/service';
import type { LiveKit } from '../livekit';
import type { Logger } from '../logger';
import type { Hub } from '../ws/hub';
import { createRateLimit } from './rate-limit';

export interface HttpDeps {
  config: Config;
  users: Users;
  tokens: Tokens;
  hub: Hub;
  calls: CallService;
  livekit: LiveKit | null;
  logger: Logger;
  otp: Otp;
  sessions: Sessions;
  clock: Clock;
}

export function buildHttp({ config, users, tokens, hub, calls, livekit, logger, otp, sessions, clock }: HttpDeps) {
  const app = Fastify({ loggerInstance: logger.child({ module: 'http' }) });

  // CORS лише для застосунку (GitHub Pages)
  app.addHook('onRequest', async (req, reply) => {
    if (!config.demoOrigin || req.headers.origin !== config.demoOrigin) return;
    reply.header('access-control-allow-origin', config.demoOrigin).header('vary', 'Origin');
    if (req.method === 'OPTIONS') {
      return reply
        .header('access-control-allow-methods', 'POST, OPTIONS')
        .header('access-control-allow-headers', 'content-type')
        .header('access-control-max-age', '600')
        .code(204)
        .send();
    }
  });

  app.get('/health', async () => ({ ok: true }));

  // Вхід за номером (docs/backend.md, «Вхід»): номер → код → токен доступу й сесія на 7 днів.
  // На Fly.io справжня адреса клієнта в Fly-Client-IP (заголовок ставить проксі Fly).
  const clientIp = (req: { headers: Record<string, unknown>; ip: string }) =>
    String(req.headers['fly-client-ip'] ?? req.ip);
  const startLimit = createRateLimit(10, 10 * 60_000, clock);
  const verifyLimit = createRateLimit(30, 10 * 60_000, clock);
  const tooMany = (reply: { code(c: number): { send(b: object): unknown } }, ms: number) =>
    reply.code(429).send({ error: 'rate_limited', retryAfter: Math.ceil(ms / 1000) });
  const issue = async (user: { id: string; name: string }) => {
    const { token, expiresAt } = await tokens.sign({ sub: user.id, sid: DEMO_SITE_ID, name: user.name });
    return { token, expiresAt, user: { userId: user.id, name: user.name } };
  };

  // {phone} → підтверджений номер входить одразу (токен і сесія), інакше створюємо код і кажемо, чи номер відомий.
  app.post('/auth/start', async (req, reply) => {
    const wait = startLimit(clientIp(req));
    if (wait) return tooMany(reply, wait);
    const body = (req.body ?? {}) as { phone?: unknown };
    const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
    if (!phone) return reply.code(400).send({ error: 'invalid_phone' });
    const user = users.get(DEMO_SITE_ID, phone);
    if (user?.disabled) return reply.code(403).send({ error: 'disabled' });
    // код питаємо лише раз: номер, який уже підтверджували, входить без нього (рішення продукту, див. backend.md)
    if (user?.verifiedAt) {
      const session = sessions.create(DEMO_SITE_ID, user.id);
      req.log.info({ userId: user.id }, 'вхід підтвердженим номером');
      return {
        known: true,
        ...(await issue(user)),
        refreshToken: session.refreshToken,
        sessionExpiresAt: session.expiresAt,
      };
    }
    const locked = await otp.start(phone);
    if (locked)
      return reply.code(429).send({ error: 'too_many_attempts', retryAfter: Math.ceil(locked.retryAfter / 1000) });
    return { known: !!user };
  });

  // {phone, code, name?} → токен доступу й refresh-токен сесії. Новому номеру потрібне ім'я.
  app.post('/auth/verify', async (req, reply) => {
    const wait = verifyLimit(clientIp(req));
    if (wait) return tooMany(reply, wait);
    const body = (req.body ?? {}) as { phone?: unknown; code?: unknown; name?: unknown };
    const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
    if (!phone) return reply.code(400).send({ error: 'invalid_phone' });
    const known = users.get(DEMO_SITE_ID, phone);
    const name = known ? known.name : typeof body.name === 'string' ? normalizeName(body.name) : null;
    if (!name) return reply.code(400).send({ error: 'invalid_name' });
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const res = otp.verify(phone, code);
    if (!res.ok) {
      if (res.error === 'too_many_attempts')
        return reply.code(429).send({ error: res.error, retryAfter: Math.ceil(res.retryAfter / 1000) });
      if (res.error === 'invalid_code')
        return reply.code(401).send({ error: res.error, attemptsLeft: res.attemptsLeft });
      return reply.code(400).send({ error: res.error });
    }
    const user = known ?? users.upsertDemoUser(phone, name);
    if (user.disabled) return reply.code(403).send({ error: 'disabled' });
    users.markVerified(DEMO_SITE_ID, user.id, clock.now());
    if (!known) hub.announceUser(user);
    const session = sessions.create(DEMO_SITE_ID, user.id);
    req.log.info({ userId: user.id, known: !!known }, 'вхід за номером');
    return { ...(await issue(user)), refreshToken: session.refreshToken, sessionExpiresAt: session.expiresAt };
  });

  // {refreshToken} → новий токен доступу, поки сесія чинна.
  app.post('/auth/refresh', async (req, reply) => {
    const body = (req.body ?? {}) as { refreshToken?: unknown };
    const session = typeof body.refreshToken === 'string' ? sessions.get(body.refreshToken) : null;
    const user = session && users.get(session.siteId, session.userId);
    if (!user) return reply.code(401).send({ error: 'session_invalid' });
    if (user.disabled) return reply.code(403).send({ error: 'disabled' });
    return { ...(await issue(user)), sessionExpiresAt: session.expiresAt };
  });

  app.post('/auth/logout', async (req, reply) => {
    const body = (req.body ?? {}) as { refreshToken?: unknown };
    if (typeof body.refreshToken === 'string') sessions.revoke(body.refreshToken);
    return reply.code(204).send();
  });

  // Демо-вхід без коду: {name, phone} → токен. Лише для розробки й прототипів (config.demoLogin).
  if (config.demoLogin)
    app.post('/demo/login', async (req, reply) => {
      const body = (req.body ?? {}) as { name?: unknown; phone?: unknown };
      const name = typeof body.name === 'string' ? normalizeName(body.name) : null;
      if (!name) return reply.code(400).send({ error: 'invalid_name' });
      const phone = typeof body.phone === 'string' ? normalizePhone(body.phone) : null;
      if (!phone) return reply.code(400).send({ error: 'invalid_phone' });

      const user = users.upsertDemoUser(phone, name);
      if (user.disabled) return reply.code(403).send({ error: 'disabled' });

      const { token, expiresAt } = await tokens.sign({ sub: user.id, sid: DEMO_SITE_ID, name: user.name });
      hub.announceUser(user);
      req.log.info({ userId: user.id }, 'демо-вхід');
      return { token, expiresAt, user: { userId: user.id, name: user.name } };
    });

  // Вебхук LiveKit: хто зайшов у кімнату й вийшов із неї (правило `lost`). Тіло потрібне «сирим» для перевірки підпису.
  if (livekit) {
    app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    app.post('/livekit/webhook', async (req, reply) => {
      let event;
      try {
        event = await livekit.parseWebhook(String(req.body ?? ''), req.headers.authorization);
      } catch (err) {
        req.log.warn({ err }, 'вебхук LiveKit відхилено');
        return reply.code(401).send({ error: 'invalid_signature' });
      }
      if (event) calls.onMedia(event);
      return { ok: true };
    });
  }

  return app;
}
