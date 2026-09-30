import { createTokens } from './auth/tokens';
import { ulid } from './calls/id';
import { createCallService } from './calls/service';
import { realClock, type Clock } from './calls/types';
import type { Config } from './config';
import { openDb } from './db';
import { createRecents } from './db/recents';
import { createUsers } from './db/users';
import { buildHttp } from './http/app';
import type { Logger } from './logger';
import { createCallStore } from './store/calls';
import { createMemoryPresence } from './store/presence';
import { createDeliver } from './ws/deliver';
import { attachGateway, type GatewayTimeouts } from './ws/gateway';
import { createHub } from './ws/hub';

export interface ServerOptions {
  config: Config;
  logger: Logger;
  timeouts?: Partial<GatewayTimeouts>;
  /** Годинник і генератор id підміняються в тестах. */
  clock?: Clock;
  newId?: () => string;
}

/** Збирає сервер: БД, токени, присутність, HTTP і WebSocket. */
export async function createServer({ config, logger, timeouts, clock = realClock, newId = ulid }: ServerOptions) {
  const db = openDb(config.dbPath);
  const users = createUsers(db);
  users.seedBots();
  const tokens = createTokens(config.jwtSecret);
  const presence = createMemoryPresence();
  const hub = createHub(presence, users);
  const recents = createRecents(db);
  const deliver = createDeliver(presence);
  const calls = createCallService({
    store: createCallStore(db),
    users,
    recents,
    clock,
    isOnline: presence.isOnline,
    deliver,
    newId,
    logger,
  });
  calls.restore();

  const app = buildHttp({ config, users, tokens, hub, logger });
  const gateway = attachGateway(app.server, { users, recents, calls, deliver, hub, tokens, logger, timeouts });

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
