import {
  ENDED_CALL_TTL_MS,
  MAX_INVITES_PER_MINUTE,
  PROTOCOL_VERSION as V,
  RING_TIMEOUT_MS,
  type CallInfo,
  type EndReason,
  type ErrorCode,
  type RecentResult,
} from '@dialer/shared';
import { botScenario } from '../bots/scenarios';
import type { Recents } from '../db/recents';
import type { Users } from '../db/users';
import type { Logger } from '../logger';
import type { CallStore } from '../store/calls';
import type { Actor, Call, Clock, Effect } from './types';

export class CallError extends Error {
  constructor(readonly code: ErrorCode, message?: string) {
    super(message ?? code);
  }
}

/** Результат команди: що відповісти в `ack` і що розіслати після нього. */
export interface Result {
  call?: CallInfo;
  effects: Effect[];
}

export interface CallServiceDeps {
  store: CallStore;
  users: Users;
  recents: Recents;
  clock: Clock;
  isOnline(siteId: string, userId: string): boolean;
  /** Доставляє повідомлення, які виникли без команди (таймери, боти). */
  deliver(effects: Effect[]): void;
  newId(): string;
  logger: Logger;
}

/** [запис того, хто дзвонив, запис адресата]; `null`: запису немає. */
const RECENT_RESULTS: Record<EndReason, [RecentResult | null, RecentResult | null]> = {
  hangup: ['completed', 'completed'],
  cancelled: ['cancelled', 'missed'],
  rejected: ['rejected', 'rejected'],
  busy: ['busy', null],
  timeout: ['no_answer', 'missed'],
  offline: ['no_answer', 'missed'],
  answered_elsewhere: [null, null],
  lost: ['completed', 'completed'],
  error: ['failed', 'failed'],
};

const BOT_DEVICE = 'bot';

/**
 * Логіка дзвінків за docs/signaling.md: стани, правила `call.invite`, таймаути, історія.
 * Команди повертають `Result`; повідомлення розсилає той, хто викликав, після `ack`.
 */
export function createCallService(deps: CallServiceDeps) {
  const { store, users, recents, clock, logger } = deps;
  const log = logger.child({ module: 'calls' });
  const timers = new Map<string, () => void>();
  const invites = new Map<string, number[]>();

  const armTimer = (id: string, ms: number, fn: () => void) => {
    timers.get(id)?.();
    timers.set(id, clock.after(ms, fn));
  };
  const clearTimer = (id: string) => {
    for (const key of [id, `bot:${id}`]) {
      timers.get(key)?.();
      timers.delete(key);
    }
  };

  const info = (call: Call, forUserId: string): CallInfo => {
    const outgoing = call.callerId === forUserId;
    const peerId = outgoing ? call.calleeId : call.callerId;
    const peer = users.get(call.siteId, peerId);
    const mine = outgoing ? call.holdCaller : call.holdCallee;
    const theirs = outgoing ? call.holdCallee : call.holdCaller;
    return {
      callId: call.id,
      direction: outgoing ? 'out' : 'in',
      peer: { userId: peerId, name: peer?.name ?? peerId },
      state: call.state === 'connected' ? 'connected' : 'ringing',
      ...(call.state === 'ringing' && { expiresAt: call.expiresAt }),
      ...(call.state === 'connected' && { startedAt: call.answeredAt, hold: mine, peerHold: theirs }),
    };
  };

  const toCaller = (call: Call, msg: Effect['msg']): Effect => ({ siteId: call.siteId, userId: call.callerId, msg });
  const toCallee = (call: Call, msg: Effect['msg'], rest: Partial<Effect> = {}): Effect => ({
    siteId: call.siteId,
    userId: call.calleeId,
    msg,
    ...rest,
  });

  const load = (id: string): Call => {
    const call = store.get(id);
    if (!call) throw new CallError('call_not_found');
    if (call.state === 'ended') throw new CallError('call_ended');
    return call;
  };

  /** Завершує дзвінок: стан, історія, повідомлення. */
  function end(call: Call, reason: EndReason, actorDevice?: string, calleeNotified = true): Effect[] {
    const now = clock.now();
    const wasConnected = call.state === 'connected';
    call.state = 'ended';
    call.endedAt = now;
    call.reason = reason;
    clearTimer(call.id);
    store.save(call);
    clock.after(ENDED_CALL_TTL_MS, () => store.remove(call.id));

    const duration = wasConnected && call.answeredAt ? Math.round((now - call.answeredAt) / 1000) : undefined;
    const ended = { v: V, type: 'call.ended', callId: call.id, reason, ...(duration !== undefined && { duration }) } as const;
    log.info({ callId: call.id, reason, duration }, 'дзвінок завершено');

    const effects: Effect[] = [toCaller(call, ended)];
    if (!calleeNotified) {
      // адресат не отримував `call.incoming` (зайнятий чи не в мережі): подія йому не потрібна
    } else if (wasConnected) {
      effects.push(toCallee(call, ended, { deviceId: call.answeredDevice }));
    } else if (reason === 'rejected' && actorDevice) {
      // інші пристрої адресата не мають показувати «відхилено»
      effects.push(toCallee(call, ended, { deviceId: actorDevice }));
      effects.push(toCallee(call, { ...ended, reason: 'answered_elsewhere' }, { exceptDeviceId: actorDevice }));
    } else {
      effects.push(toCallee(call, ended));
    }

    const [callerResult, calleeResult] = RECENT_RESULTS[reason];
    const sides = [
      { userId: call.callerId, peer: call.calleeId, direction: 'out', result: callerResult },
      { userId: call.calleeId, peer: call.callerId, direction: 'in', result: calleeResult },
    ] as const;
    for (const side of sides) {
      if (!side.result || users.get(call.siteId, side.userId)?.isBot) continue;
      const entry = {
        callId: call.id,
        peer: side.peer,
        direction: side.direction,
        result: side.result,
        startedAt: call.createdAt,
        ...(duration !== undefined && { duration }),
      };
      recents.add(call.siteId, side.userId, entry);
      effects.push({ siteId: call.siteId, userId: side.userId, msg: { v: V, type: 'recents.add', entry } });
    }
    return effects;
  }

  /** Переводить дзвінок у `connected` і повідомляє обидві сторони. */
  function connect(call: Call, deviceId: string): Effect[] {
    call.state = 'connected';
    call.answeredAt = clock.now();
    call.answeredDevice = deviceId;
    clearTimer(call.id);
    store.save(call);
    log.info({ callId: call.id, deviceId }, 'дзвінок прийнято');
    return [
      toCaller(call, { v: V, type: 'call.connected', call: info(call, call.callerId) }),
      toCallee(call, { v: V, type: 'call.connected', call: info(call, call.calleeId) }, { deviceId }),
      // решта пристроїв адресата припиняє дзвонити
      toCallee(call, { v: V, type: 'call.ended', callId: call.id, reason: 'answered_elsewhere' }, { exceptDeviceId: deviceId }),
    ];
  }

  function expire(id: string) {
    const call = store.get(id);
    if (!call || call.state !== 'ringing') return;
    deps.deliver(end(call, 'timeout'));
  }

  /** Запускає поведінку демо-бота, коли йому дзвонять. */
  function ringBot(call: Call, scenario: ReturnType<typeof botScenario>) {
    if (scenario.kind !== 'answer') return;
    const delay = Math.max(0, call.createdAt + scenario.delayMs - clock.now());
    armTimer(`bot:${call.id}`, delay, () => {
      const current = store.get(call.id);
      if (current?.state === 'ringing') deps.deliver(connect(current, BOT_DEVICE));
    });
  }

  function checkRate(userKey: string): void {
    const now = clock.now();
    const recent = (invites.get(userKey) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= MAX_INVITES_PER_MINUTE) throw new CallError('rate_limited');
    recent.push(now);
    invites.set(userKey, recent);
  }

  return {
    callsFor: (siteId: string, userId: string): CallInfo[] =>
      store.activeFor(siteId, userId).map((c) => info(c, userId)),

    invite(actor: Actor, req: { to: string; video: boolean }): Result {
      const callee = users.get(actor.siteId, req.to);
      if (!callee || callee.disabled || callee.id === actor.userId) throw new CallError('invalid_target');
      if (store.activeFor(actor.siteId, actor.userId).length > 0) throw new CallError('already_in_call');
      checkRate(`${actor.siteId}\u0000${actor.userId}`);

      const scenario = callee.isBot ? botScenario(callee.id) : null;
      const now = clock.now();
      const timeoutMs = scenario?.kind === 'ignore' ? scenario.timeoutMs : RING_TIMEOUT_MS;
      const call: Call = {
        id: deps.newId(),
        siteId: actor.siteId,
        callerId: actor.userId,
        calleeId: callee.id,
        callerDevice: actor.deviceId,
        video: req.video,
        state: 'ringing',
        createdAt: now,
        expiresAt: now + timeoutMs,
        holdCaller: false,
        holdCallee: false,
      };
      store.save(call);
      log.info({ callId: call.id, from: actor.userId, to: callee.id }, 'новий дзвінок');
      const ack = info(call, actor.userId);

      // правила в порядку з docs/signaling.md; dnd і waiting додамо на кроці 4
      if (scenario?.kind === 'busy' || store.activeFor(actor.siteId, callee.id).length > 1) {
        return { call: ack, effects: end(call, 'busy', undefined, false) };
      }
      if (!callee.isBot && !deps.isOnline(actor.siteId, callee.id)) {
        return { call: ack, effects: end(call, 'offline', undefined, false) };
      }

      armTimer(call.id, timeoutMs, () => expire(call.id));
      if (scenario) ringBot(call, scenario);
      return {
        call: ack,
        effects: [
          toCallee(call, { v: V, type: 'call.incoming', call: info(call, callee.id) }),
          toCaller(call, { v: V, type: 'call.ringing', call: info(call, actor.userId) }),
        ],
      };
    },

    cancel(actor: Actor, req: { callId: string }): Result {
      const call = load(req.callId);
      if (call.callerId !== actor.userId || call.state !== 'ringing') throw new CallError('not_allowed');
      return { effects: end(call, 'cancelled') };
    },

    accept(actor: Actor, req: { callId: string }): Result {
      const call = load(req.callId);
      if (call.calleeId !== actor.userId) throw new CallError('not_allowed');
      // дзвінок уже прийнято на іншому пристрої
      if (call.state === 'connected' && call.answeredDevice !== actor.deviceId) throw new CallError('call_ended');
      if (call.state !== 'ringing') throw new CallError('not_allowed');
      return { effects: connect(call, actor.deviceId) };
    },

    reject(actor: Actor, req: { callId: string }): Result {
      const call = load(req.callId);
      if (call.calleeId !== actor.userId || call.state !== 'ringing') throw new CallError('not_allowed');
      return { effects: end(call, 'rejected', actor.deviceId) };
    },

    hangup(actor: Actor, req: { callId: string }): Result {
      const call = load(req.callId);
      if (![call.callerId, call.calleeId].includes(actor.userId) || call.state !== 'connected') {
        throw new CallError('not_allowed');
      }
      return { effects: end(call, 'hangup') };
    },

    hold(actor: Actor, req: { callId: string; hold: boolean }): Result {
      const call = load(req.callId);
      if (![call.callerId, call.calleeId].includes(actor.userId) || call.state !== 'connected') {
        throw new CallError('not_allowed');
      }
      const isCaller = call.callerId === actor.userId;
      if (isCaller) call.holdCaller = req.hold;
      else call.holdCallee = req.hold;
      store.save(call);
      const peerId = isCaller ? call.calleeId : call.callerId;
      return {
        effects: [
          { siteId: call.siteId, userId: peerId, msg: { v: V, type: 'call.peer', callId: call.id, hold: req.hold } },
          // інші пристрої того, хто тримає, теж оновлюють екран
          { siteId: call.siteId, userId: actor.userId, exceptDeviceId: actor.deviceId, msg: { v: V, type: 'call.updated', callId: call.id, hold: req.hold } },
        ],
      };
    },

    /** Після перезапуску: відновлює незавершені дзвінки з БД і таймери очікування. */
    restore(): void {
      for (const call of store.loadActive()) {
        if (call.state !== 'ringing') continue;
        const left = call.expiresAt - clock.now();
        if (left <= 0) {
          deps.deliver(end(call, 'timeout'));
          continue;
        }
        armTimer(call.id, left, () => expire(call.id));
        const callee = users.get(call.siteId, call.calleeId);
        if (callee?.isBot) ringBot(call, botScenario(callee.id));
      }
    },
  };
}

export type CallService = ReturnType<typeof createCallService>;
