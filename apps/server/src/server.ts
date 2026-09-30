import { createTokens } from './auth/tokens';
import type { Config } from './config';
import { openDb } from './db';
import { createUsers } from './db/users';
import { buildHttp } from './http/app';
import type { Logger } from './logger';
import { createMemoryPresence } from './store/presence';
import { attachGateway, type GatewayTimeouts } from './ws/gateway';
import { createHub } from './ws/hub';

export interface ServerOptions {
  config: Config;
  logger: Logger;
  timeouts?: Partial<GatewayTimeouts>;
}

/** Збирає сервер: БД, токени, присутність, HTTP і WebSocket. */
export async function createServer({ config, logger, timeouts }: ServerOptions) {
  const db = openDb(config.dbPath);
  const users = createUsers(db);
  users.seedBots();
  const tokens = createTokens(config.jwtSecret);
  const hub = createHub(createMemoryPresence(), users);

  const app = buildHttp({ config, users, tokens, hub, logger });
  const gateway = attachGateway(app.server, { users, hub, tokens, logger, timeouts });

  return {
    app,
    db,
    users,
    /** Повертає фактичну адресу (корисно з портом 0). */
    async listen() {
      await app.listen({ port: config.port, host: config.host });
      const addr = app.server.address();
      return typeof addr === 'object' && addr ? addr.port : config.port;
    },
    async close() {
      gateway.close();
      await app.close();
      db.close();
    },
  };
}
