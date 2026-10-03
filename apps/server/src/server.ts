import { createOtp, lastDigitsOtp, type OtpSender } from './auth/otp';
import { createSessions } from './auth/sessions';
import { createTokens } from './auth/tokens';
import { ulid } from './calls/id';
import { createCallService } from './calls/service';
import { realClock, type Clock } from './calls/types';
import type { Config } from './config';
import { openDb } from './db';
import { createLiveKit, type RoomApi } from './livekit';
import { createPushSubs } from './db/push';
import { createRecents } from './db/recents';
import { createUsers } from './db/users';
import { buildHttp } from './http/app';
import type { Logger } from './logger';
import { createPush } from './push';
import { createPushSender, type PushSender } from './push/sender';
import { createCallStore } from './store/calls';
import { createMemoryPresence } from './store/presence';
import { createDeliver } from './ws/deliver';
import { attachGateway, type GatewayTimeouts } from './ws/gateway';
import { createOriginPolicy } from './ws/origin';
import { createHub } from './ws/hub';

export interface ServerOptions {
  config: Config;
  logger: Logger;
  timeouts?: Partial<GatewayTimeouts>;
  /** Годинник і генератор id підміняються в тестах. */
  clock?: Clock;
  newId?: () => string;
  /** Підміна REST-викликів LiveKit у тестах. */
  livekitRooms?: RoomApi;
  /** Доставка кодів входу; поки код = останні 4 цифри номера. */
  otpSender?: OtpSender;
  /** Підміна відправника Web Push у тестах. */
  pushSender?: PushSender;
}

/** Збирає сервер: БД, токени, присутність, HTTP і WebSocket. */
export async function createServer({
  config,
  logger,
  timeouts,
  clock = realClock,
  newId = ulid,
  livekitRooms,
  otpSender = lastDigitsOtp,
  pushSender,
}: ServerOptions) {
  const db = openDb(config.dbPath);
  const users = createUsers(db);
  users.seedBots();
  const tokens = createTokens(config.jwtSecret);
  const presence = createMemoryPresence();
  const hub = createHub(presence, users);
  const recents = createRecents(db);
  const deliver = createDeliver(presence);
  const push = createPush({
    subs: createPushSubs(db),
    sender: pushSender ?? (config.vapid ? createPushSender(config.vapid) : null),
    vapidPublicKey: config.vapid?.publicKey ?? null,
    logger,
    now: () => clock.now(),
  });
  const livekit = config.livekit ? createLiveKit(config.livekit, livekitRooms) : null;
  const calls = createCallService({
    store: createCallStore(db),
    users,
    recents,
    clock,
    livekit,
    isOnline: presence.isOnline,
    deliver,
    newId,
    logger,
  });
  calls.restore();
  // перевірка кімнат у LiveKit не блокує запуск; помилки логуються всередині
  void calls.restoreMedia();

  const otp = createOtp(otpSender, clock);
  const sessions = createSessions(db, clock);
  const app = buildHttp({ config, users, tokens, hub, calls, livekit, logger, otp, sessions, clock });
  const gateway = attachGateway(app.server, {
    users,
    recents,
    calls,
    push,
    deliver,
    hub,
    tokens,
    originAllowed: createOriginPolicy(config, db),
    logger,
    timeouts,
  });

  return {
    app,
    db,
    users,
    push,
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
