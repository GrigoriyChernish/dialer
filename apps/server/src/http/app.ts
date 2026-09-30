import Fastify from 'fastify';
import { normalizeName, normalizePhone } from '../auth/phone';
import type { Tokens } from '../auth/tokens';
import type { Config } from '../config';
import { DEMO_SITE_ID, type Users } from '../db/users';
import type { Logger } from '../logger';
import type { Hub } from '../ws/hub';

export interface HttpDeps {
  config: Config;
  users: Users;
  tokens: Tokens;
  hub: Hub;
  logger: Logger;
}

export function buildHttp({ config, users, tokens, hub, logger }: HttpDeps) {
  const app = Fastify({ loggerInstance: logger.child({ module: 'http' }) });

  // CORS лише для сторінки демо
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

  // Демо-вхід: {name, phone} → токен. Без підтвердження кодом, лише номери +380.
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

  return app;
}
