import {
  CLOSE_FORBIDDEN,
  CLOSE_UNAUTHORIZED,
  CLOSE_UNSUPPORTED_VERSION,
  HELLO_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  SILENCE_TIMEOUT_MS,
  TOKEN_EXPIRING_MS,
  type ErrorCode,
  type ErrorReply,
  type Settings,
  type ServerMessage,
} from '@dialer/shared';
import { randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { CallError, type CallService, type Result } from '../calls/service';
import type { Actor, Effect } from '../calls/types';
import { TokenError, type TokenClaims, type Tokens } from '../auth/tokens';
import type { Recents } from '../db/recents';
import type { Users } from '../db/users';
import type { Logger } from '../logger';
import type { Connection } from '../store/presence';
import type { Hub } from './hub';

export interface GatewayTimeouts {
  hello: number;
  silence: number;
}

export interface GatewayDeps {
  users: Users;
  recents: Recents;
  calls: CallService;
  deliver(effects: Effect[]): void;
  hub: Hub;
  tokens: Tokens;
  logger: Logger;
  timeouts?: Partial<GatewayTimeouts>;
}

/** Скільки відповідей на запити з `id` пам'ятаємо для повтору без дубля. */
const REPLY_CACHE_SIZE = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const errorFrame = (code: ErrorCode, reqId?: string, message?: string): ErrorReply => ({
  v: PROTOCOL_VERSION,
  type: 'error',
  code,
  ...(reqId && { reqId }),
  ...(message && { message }),
});

/** WebSocket на `/ws`: перший кадр `hello`, далі команди й події (docs/signaling.md). */
export function attachGateway(server: HttpServer, deps: GatewayDeps) {
  const timeouts: GatewayTimeouts = { hello: HELLO_TIMEOUT_MS, silence: SILENCE_TIMEOUT_MS, ...deps.timeouts };
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws));
  });

  function handleConnection(ws: WebSocket) {
    const connId = randomUUID();
    const log = deps.logger.child({ module: 'ws', connId });
    const replies = new Map<string, ServerMessage>();
    let conn: Connection | null = null;
    let claims: TokenClaims | null = null;
    let expiringTimer: NodeJS.Timeout | undefined;
    let silenceTimer: NodeJS.Timeout | undefined;
    // кадри обробляємо строго по черзі: після `hello` асинхронно перевіряється токен
    let queue: Promise<void> = Promise.resolve();

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    /** Надсилає відповідь на запит і запам'ятовує її для повтору. */
    const respond = (id: string | undefined, msg: ServerMessage) => {
      if (id) {
        replies.set(id, msg);
        if (replies.size > REPLY_CACHE_SIZE) replies.delete(replies.keys().next().value!);
      }
      send(msg);
    };

    const helloTimer = setTimeout(() => {
      log.warn('hello не надійшов вчасно');
      ws.close(CLOSE_UNAUTHORIZED, 'hello timeout');
    }, timeouts.hello);

    const resetSilence = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => ws.close(1001, 'silence'), timeouts.silence);
    };
    resetSilence();

    const scheduleExpiring = (expiresAt: number) => {
      clearTimeout(expiringTimer);
      const delay = Math.max(0, expiresAt - Date.now() - TOKEN_EXPIRING_MS);
      expiringTimer = setTimeout(() => send({ v: PROTOCOL_VERSION, type: 'token.expiring' }), delay);
    };

    const rejectToken = (id: string | undefined, e: unknown) => {
      const code = e instanceof TokenError ? e.code : 'token_invalid';
      log.warn({ code }, 'токен відхилено');
      send(errorFrame(code, id));
      ws.close(CLOSE_UNAUTHORIZED, code);
    };

    async function onHello(msg: Record<string, unknown>, id: string | undefined) {
      const { token, deviceId } = msg;
      if (!id || typeof token !== 'string' || typeof deviceId !== 'string' || !deviceId || deviceId.length > 64) {
        send(errorFrame('bad_request', id, 'hello: потрібні id, token, deviceId'));
        ws.close(CLOSE_UNAUTHORIZED, 'bad hello');
        return;
      }
      let verified: TokenClaims;
      try {
        verified = await deps.tokens.verify(token);
      } catch (e) {
        return rejectToken(id, e);
      }
      const user = deps.users.get(verified.sid, verified.sub);
      if (!user) return rejectToken(id, new TokenError('token_invalid'));
      if (user.disabled) {
        log.warn({ userId: user.id }, 'користувача заблоковано');
        send(errorFrame('not_allowed', id, 'user disabled'));
        ws.close(CLOSE_FORBIDDEN, 'disabled');
        return;
      }
      if (ws.readyState !== ws.OPEN) return;

      clearTimeout(helloTimer);
      claims = verified;
      conn = {
        id: connId,
        siteId: user.siteId,
        userId: user.id,
        deviceId,
        send,
        close: (code, reason) => ws.close(code, reason),
      };
      deps.hub.connect(conn);
      log.info({ userId: user.id, deviceId }, 'пристрій підключився');
      send({
        v: PROTOCOL_VERSION,
        type: 'hello.ok',
        reqId: id,
        user: { userId: user.id, name: user.name },
        serverTime: Date.now(),
        settings: user.settings,
        calls: deps.calls.callsFor(user.siteId, user.id),
        contacts: deps.hub.contactsFor(user.siteId, user.id),
        recents: deps.recents.list(user.siteId, user.id),
      });
      scheduleExpiring(verified.expiresAt);
    }

    async function onRefresh(msg: Record<string, unknown>, id: string | undefined) {
      if (!id || typeof msg.token !== 'string') return respond(id, errorFrame('bad_request', id, 'auth.refresh: потрібні id, token'));
      let fresh: TokenClaims;
      try {
        fresh = await deps.tokens.verify(msg.token);
      } catch (e) {
        return rejectToken(id, e);
      }
      const user = deps.users.get(fresh.sid, fresh.sub);
      if (!claims || fresh.sub !== claims.sub || fresh.sid !== claims.sid || !user) {
        return rejectToken(id, new TokenError('token_invalid'));
      }
      if (user.disabled) {
        send(errorFrame('not_allowed', id, 'user disabled'));
        ws.close(CLOSE_FORBIDDEN, 'disabled');
        return;
      }
      claims = fresh;
      scheduleExpiring(fresh.expiresAt);
      respond(id, { v: PROTOCOL_VERSION, type: 'ack', reqId: id });
    }

    const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

    /** Команди дзвінка: виконує, відповідає `ack` і лише після нього розсилає події. */
    function onCall(msg: Record<string, unknown>, id: string | undefined) {
      if (!id || !conn) return respond(id, errorFrame('bad_request', id, 'потрібен id'));
      const actor: Actor = { siteId: conn.siteId, userId: conn.userId, deviceId: conn.deviceId };
      try {
        let result: Result;
        switch (msg.type) {
          case 'call.invite':
            if (!isString(msg.to) || (msg.video !== undefined && typeof msg.video !== 'boolean')) throw new CallError('bad_request');
            result = deps.calls.invite(actor, { to: msg.to, video: msg.video === true });
            break;
          case 'call.accept':
            if (!isString(msg.callId) || (msg.action !== undefined && msg.action !== 'hold' && msg.action !== 'end')) {
              throw new CallError('bad_request');
            }
            result = deps.calls.accept(actor, { callId: msg.callId, action: msg.action });
            break;
          case 'call.hold':
            if (!isString(msg.callId) || typeof msg.hold !== 'boolean') throw new CallError('bad_request');
            result = deps.calls.hold(actor, { callId: msg.callId, hold: msg.hold });
            break;
          default: {
            if (!isString(msg.callId)) throw new CallError('bad_request');
            const action = { 'call.cancel': 'cancel', 'call.reject': 'reject', 'call.hangup': 'hangup' } as const;
            result = deps.calls[action[msg.type as keyof typeof action]](actor, { callId: msg.callId });
          }
        }
        respond(id, { v: PROTOCOL_VERSION, type: 'ack', reqId: id, ...(result.call && { call: result.call }) });
        deps.deliver(result.effects);
      } catch (e) {
        if (!(e instanceof CallError)) throw e;
        log.info({ type: msg.type, code: e.code }, 'команду відхилено');
        respond(id, errorFrame(e.code, id, e.message));
      }
    }

    /** Налаштування користувача: зберігає й повідомляє інші пристрої. */
    function onSettings(msg: Record<string, unknown>, id: string | undefined) {
      if (!id || !conn) return respond(id, errorFrame('bad_request', id, 'потрібен id'));
      const patch = msg.settings;
      if (!isRecord(patch)) return respond(id, errorFrame('bad_request', id, 'settings: очікується об\'єкт'));
      const clean: Partial<Settings> = {};
      for (const key of ['waiting', 'dnd'] as const) {
        if (!(key in patch)) continue;
        if (typeof patch[key] !== 'boolean') return respond(id, errorFrame('bad_request', id, `settings.${key}: очікується boolean`));
        clean[key] = patch[key];
      }
      const settings = deps.users.updateSettings(conn.siteId, conn.userId, clean);
      log.info({ userId: conn.userId, ...clean }, 'налаштування змінено');
      respond(id, { v: PROTOCOL_VERSION, type: 'ack', reqId: id, settings });
      deps.deliver([
        { siteId: conn.siteId, userId: conn.userId, exceptDeviceId: conn.deviceId, msg: { v: PROTOCOL_VERSION, type: 'settings.updated', settings } },
      ]);
    }

    async function onMessage(data: RawData, isBinary: boolean) {
      if (isBinary) return send(errorFrame('bad_request', undefined, 'бінарні кадри не підтримуються'));
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return send(errorFrame('bad_request', undefined, 'некоректний JSON'));
      }
      if (!isRecord(msg) || typeof msg.type !== 'string') {
        return send(errorFrame('bad_request', undefined, 'кадр без type'));
      }
      const id = typeof msg.id === 'string' ? msg.id : undefined;
      if (msg.v !== PROTOCOL_VERSION) {
        send(errorFrame('unsupported_version', id));
        ws.close(CLOSE_UNSUPPORTED_VERSION, 'unsupported version');
        return;
      }

      if (!conn) {
        if (msg.type !== 'hello') {
          send(errorFrame('bad_request', id, 'очікується hello'));
          ws.close(CLOSE_UNAUTHORIZED, 'hello expected');
          return;
        }
        return onHello(msg, id);
      }

      const cached = id && replies.get(id);
      if (cached) return send(cached);

      switch (msg.type) {
        case 'hello':
          return respond(id, errorFrame('bad_request', id, 'hello уже було'));
        case 'ping':
          return send({ v: PROTOCOL_VERSION, type: 'pong' });
        case 'auth.refresh':
          return onRefresh(msg, id);
        case 'call.invite':
        case 'call.cancel':
        case 'call.accept':
        case 'call.reject':
        case 'call.hangup':
        case 'call.hold':
          return onCall(msg, id);
        case 'settings.update':
          return onSettings(msg, id);
        default:
          // recents.*, push.* з'являться на наступних кроках
          return respond(id, errorFrame('unknown_type', id));
      }
    }

    ws.on('message', (data, isBinary) => {
      resetSilence();
      queue = queue.then(() => onMessage(data, isBinary)).catch((err) => {
        log.error({ err }, 'не вдалося обробити кадр');
        send(errorFrame('internal'));
      });
    });

    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      clearTimeout(expiringTimer);
      clearTimeout(silenceTimer);
      if (conn) {
        deps.hub.disconnect(conn);
        log.info({ userId: conn.userId, code }, 'пристрій відключився');
      }
    });

    ws.on('error', (err) => log.warn({ err }, 'помилка з\'єднання'));
  }

  return {
    close() {
      for (const client of wss.clients) client.close(1001, 'server shutdown');
      wss.close();
    },
  };
}
