import {
  ENDED_CALL_TTL_MS,
  LOST_GRACE_MS,
  MAX_INVITES_PER_MINUTE,
  PROTOCOL_VERSION as V,
  RING_TIMEOUT_MS,
  type CallInfo,
  type EndReason,
  type ErrorCode,
  type RecentResult,
} from '@dialer/shared';
import type { BotMedia } from '../bots/media';
import { botScenario } from '../bots/scenarios';
import type { Recents } from '../db/recents';
import type { Users } from '../db/users';
import { liveKitIdentity, type LiveKit, type MediaEvent } from '../livekit';
import type { Logger } from '../logger';
import type { CallStore } from '../store/calls';
import type { Actor, Call, Clock, Effect } from './types';

export class CallError extends Error {
  constructor(
    readonly code: ErrorCode,
    message?: string,
  ) {
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
  /** `null`: медіа вимкнено, дзвінки без токенів кімнат. */
  livekit: LiveKit | null;
  /** Медіа ботів (Олена, Відео-тест): без нього, як і без LiveKit, бот відповідає лише в сигналізації. */
  botMedia?: BotMedia | null;
  isOnline(siteId: string, userId: string): boolean;
  /** Адресата можна сповістити: він у мережі або має підписку Web Push. */
  isReachable(siteId: string, userId: string): boolean;
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
  /** Хто зараз у кімнаті LiveKit (ідентичності за вебхуками). */
  const media = new Map<string, Set<string>>();
  /** Дзвінки, що були `connected` до перезапуску: їхні кімнати перевіримо в LiveKit. */
  const restoredConnected: Call[] = [];
  const invites = new Map<string, number[]>();

  const armTimer = (id: string, ms: number, fn: () => void) => {
    timers.get(id)?.();
    timers.set(id, clock.after(ms, fn));
  };
  const clearTimer = (id: string) => {
    for (const key of [id, `bot:${id}`, `lost:${id}`, `gone:${id}`]) {
      timers.get(key)?.();
      timers.delete(key);
    }
  };

  /** Бот заходить у кімнату, якщо його сценарій має медіа й є `botMedia`. */
  const hasMedia = (userId: string, siteId: string): boolean => {
    const user = users.get(siteId, userId);
    if (!user?.isBot) return true;
    const scenario = botScenario(userId);
    return deps.botMedia != null && scenario.kind === 'answer' && scenario.media !== undefined;
  };

  /** Медіа відстежуємо, якщо є LiveKit і обидві сторони мають медіа: люди або бот із медіа. */
  const tracked = (call: Call): boolean =>
    deps.livekit !== null && hasMedia(call.callerId, call.siteId) && hasMedia(call.calleeId, call.siteId);

  /** Ідентичності, які мають бути в кімнаті, щоб розмова жила. */
  const expectedIdentities = (call: Call): string[] => [
    liveKitIdentity(call.callerId, call.callerDevice),
    liveKitIdentity(call.calleeId, call.answeredDevice ?? ''),
  ];

  /** Дзвінок очікує: адресат уже в розмові. */
  const isWaiting = (call: Call): boolean =>
    call.state === 'ringing' &&
    store.activeFor(call.siteId, call.calleeId).some(c => c.id !== call.id && c.state === 'connected');

  const info = (call: Call, forUserId: string, forDevice?: string): CallInfo => {
    const outgoing = call.callerId === forUserId;
    const peerId = outgoing ? call.calleeId : call.callerId;
    const peer = users.get(call.siteId, peerId);
    const mine = outgoing ? call.holdCaller : call.holdCallee;
    const theirs = outgoing ? call.holdCallee : call.holdCaller;
    // токен кімнати лише пристрою, який бере участь у розмові
    const mediaDevice = outgoing ? call.callerDevice : call.answeredDevice;
    const livekit =
      call.state === 'connected' && forDevice !== undefined && forDevice === mediaDevice && tracked(call)
        ? deps.livekit!.accessFor(
            call.id,
            liveKitIdentity(forUserId, forDevice),
            users.get(call.siteId, forUserId)?.name ?? forUserId,
          )
        : undefined;
    return {
      callId: call.id,
      direction: outgoing ? 'out' : 'in',
      peer: { userId: peerId, name: peer?.name ?? peerId },
      state: call.state === 'connected' ? 'connected' : 'ringing',
      ...(isWaiting(call) && { waiting: true }),
      ...(call.state === 'ringing' && { expiresAt: call.expiresAt }),
      ...(call.state === 'connected' && { startedAt: call.answeredAt, hold: mine, peerHold: theirs }),
      ...(livekit && { livekit }),
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
  function end(
    call: Call,
    reason: EndReason,
    opts: { actorDevice?: string; calleeNotified?: boolean; silentMissed?: boolean } = {},
  ): Effect[] {
    const { actorDevice, calleeNotified = true, silentMissed = false } = opts;
    const now = clock.now();
    const wasConnected = call.state === 'connected';
    call.state = 'ended';
    call.endedAt = now;
    call.reason = reason;
    clearTimer(call.id);
    media.delete(call.id);
    store.save(call);
    clock.after(ENDED_CALL_TTL_MS, () => store.remove(call.id));
    if (wasConnected && tracked(call)) {
      void deps.botMedia?.stop(call.id);
      deps.livekit!.closeRoom(call.id).catch(err => log.warn({ err, callId: call.id }, 'не вдалося закрити кімнату'));
    }

    const duration = wasConnected && call.answeredAt ? Math.round((now - call.answeredAt) / 1000) : undefined;
    const ended = {
      v: V,
      type: 'call.ended',
      callId: call.id,
      reason,
      ...(duration !== undefined && { duration }),
    } as const;
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

    // розмова закінчилась: дзвінок, що чекав, стає звичайним
    if (wasConnected) effects.push(...releaseWaiting(call));

    const [callerResult, calleeResult] = silentMissed ? (['busy', 'missed'] as const) : RECENT_RESULTS[reason];
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
        ...(silentMissed && side.direction === 'in' && { silent: true }),
      };
      recents.add(call.siteId, side.userId, entry);
      effects.push({ siteId: call.siteId, userId: side.userId, msg: { v: V, type: 'recents.add', entry } });
    }
    return effects;
  }

  /** Повідомляє, що дзвінок більше не «очікує», якщо в адресата не лишилось розмов. */
  function releaseWaiting(ended: Call): Effect[] {
    const effects: Effect[] = [];
    for (const userId of [ended.callerId, ended.calleeId]) {
      for (const call of store.activeFor(ended.siteId, userId)) {
        if (call.state !== 'ringing' || call.calleeId !== userId || isWaiting(call)) continue;
        const msg = { v: V, type: 'call.updated', callId: call.id, waiting: false } as const;
        effects.push(toCallee(call, msg), toCaller(call, msg));
      }
    }
    return effects;
  }

  /** Ставить чи знімає утримання з боку `userId`; повідомляє співрозмовника й пристрої користувача. */
  function setHold(call: Call, userId: string, hold: boolean, exceptDevice?: string): Effect[] {
    const isCaller = call.callerId === userId;
    if (isCaller) call.holdCaller = hold;
    else call.holdCallee = hold;
    store.save(call);
    const peerId = isCaller ? call.calleeId : call.callerId;
    return [
      { siteId: call.siteId, userId: peerId, msg: { v: V, type: 'call.peer', callId: call.id, hold } },
      {
        siteId: call.siteId,
        userId,
        ...(exceptDevice && { exceptDeviceId: exceptDevice }),
        msg: { v: V, type: 'call.updated', callId: call.id, hold },
      },
    ];
  }

  const connectedCalls = (siteId: string, userId: string, except: string): Call[] =>
    store.activeFor(siteId, userId).filter(c => c.id !== except && c.state === 'connected');

  /** Переводить дзвінок у `connected` і повідомляє обидві сторони. */
  function connect(call: Call, deviceId: string): Effect[] {
    call.state = 'connected';
    call.answeredAt = clock.now();
    call.answeredDevice = deviceId;
    clearTimer(call.id);
    store.save(call);
    log.info({ callId: call.id, deviceId }, 'дзвінок прийнято');

    // учасники мають зайти в кімнату; якщо не зайдуть, `lost`
    if (tracked(call)) {
      media.set(call.id, new Set());
      refreshLost(call.id);
      if (users.get(call.siteId, call.calleeId)?.isBot) {
        const name = users.get(call.siteId, call.calleeId)?.name ?? call.calleeId;
        const access = deps.livekit!.accessFor(call.id, liveKitIdentity(call.calleeId, deviceId), name);
        const scenario = botScenario(call.calleeId);
        if (scenario.kind === 'answer' && scenario.media)
          deps.botMedia
            ?.start(call.id, access, scenario.media)
            .catch(err => log.warn({ err, callId: call.id }, 'бот не зайшов у кімнату'));
      }
    }

    const callerMsg = (device?: string) =>
      ({ v: V, type: 'call.connected', call: info(call, call.callerId, device) }) as const;
    return [
      // токен кімнати лише пристрою, з якого дзвонили; інші пристрої бачать дзвінок без медіа
      ...(tracked(call)
        ? [
            { ...toCaller(call, callerMsg(call.callerDevice)), deviceId: call.callerDevice },
            { ...toCaller(call, callerMsg()), exceptDeviceId: call.callerDevice },
          ]
        : [toCaller(call, callerMsg())]),
      toCallee(call, { v: V, type: 'call.connected', call: info(call, call.calleeId, deviceId) }, { deviceId }),
      // решта пристроїв адресата припиняє дзвонити
      toCallee(
        call,
        { v: V, type: 'call.ended', callId: call.id, reason: 'answered_elsewhere' },
        { exceptDeviceId: deviceId },
      ),
    ];
  }

  /** Запускає чи скасовує відлік `lost`: у кімнаті мають бути обидва учасники. */
  function refreshLost(id: string) {
    const call = store.get(id);
    if (!call || call.state !== 'connected') return;
    const present = media.get(id) ?? new Set<string>();
    const key = `lost:${id}`;
    if (expectedIdentities(call).every(identity => present.has(identity))) {
      timers.get(key)?.();
      timers.delete(key);
    } else if (!timers.has(key)) {
      armTimer(key, LOST_GRACE_MS, () => void checkLost(id));
    }
  }

  /**
   * Відлік `lost` сплив: перед завершенням питаємо LiveKit напряму, бо вебхук міг не дійти (чи не налаштований).
   * Обидва в кімнаті чи LiveKit недоступний: перевіряємо знову через `LOST_GRACE_MS`, тож обрив помітимо й без вебхуків.
   */
  async function checkLost(id: string) {
    const key = `lost:${id}`;
    timers.delete(key);
    if (store.get(id)?.state !== 'connected') return;
    let present: Set<string> | null = null;
    try {
      present = new Set(await deps.livekit!.listParticipants(id));
    } catch (err) {
      log.warn({ err, callId: id }, 'не вдалося отримати учасників кімнати');
    }
    const current = store.get(id);
    if (current?.state !== 'connected' || timers.has(key)) return;
    if (present) media.set(id, present);
    if (present && !expectedIdentities(current).every(identity => present.has(identity))) {
      deps.deliver(end(current, 'lost'));
      return;
    }
    armTimer(key, LOST_GRACE_MS, () => void checkLost(id));
  }

  /** Пауза, після якої дзвінок, що дзвонить, скасовується, якщо той, хто дзвонить, так і не повернувся. */
  const CALLER_GONE_MS = 5_000;

  /** Спливла пауза: якщо пристрої того, хто дзвонить, не повернулись, а дзвінок ще дзвонить, скасовуємо його. */
  function cancelIfCallerGone(id: string) {
    timers.delete(`gone:${id}`);
    const call = store.get(id);
    if (!call || call.state !== 'ringing' || deps.isOnline(call.siteId, call.callerId)) return;
    deps.deliver(end(call, 'cancelled'));
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
    const recent = (invites.get(userKey) ?? []).filter(t => now - t < 60_000);
    if (recent.length >= MAX_INVITES_PER_MINUTE) throw new CallError('rate_limited');
    recent.push(now);
    invites.set(userKey, recent);
  }

  return {
    /** Дзвінки користувача; токен кімнати отримує лише пристрій, що бере участь у розмові. */
    callsFor: (siteId: string, userId: string, deviceId?: string): CallInfo[] =>
      store.activeFor(siteId, userId).map(c => info(c, userId, deviceId)),

    /**
     * Подія з вебхука LiveKit: хто зайшов у кімнату чи вийшов з неї. Токен кімнати отримують лише два пристрої розмови,
     * але LiveKit пустить будь-кого з дійсним токеном (наприклад, пересланим), тож сторонню ідентичність одразу викидаємо.
     */
    onMedia(event: MediaEvent): void {
      const call = store.get(event.callId);
      if (!call || call.state !== 'connected' || !tracked(call)) return;
      if (event.kind === 'joined' && event.identity && !expectedIdentities(call).includes(event.identity)) {
        const identity = event.identity;
        log.warn({ callId: call.id, identity }, 'сторонній у кімнаті дзвінка, викидаємо');
        deps
          .livekit!.removeParticipant(call.id, identity)
          .catch(err => log.warn({ err, callId: call.id, identity }, 'не вдалося викинути стороннього з кімнати'));
        return;
      }
      const present = media.get(call.id) ?? new Set<string>();
      media.set(call.id, present);
      if (event.kind === 'joined' && event.identity) present.add(event.identity);
      else if (event.kind === 'left' && event.identity) present.delete(event.identity);
      else if (event.kind === 'finished') present.clear();
      refreshLost(call.id);
    },

    /** Після перезапуску питає LiveKit, хто в кімнатах відновлених розмов. Помилка не завершує дзвінок. */
    async restoreMedia(): Promise<void> {
      for (const call of restoredConnected.splice(0)) {
        if (store.get(call.id)?.state !== 'connected') continue;
        try {
          media.set(call.id, new Set(await deps.livekit!.listParticipants(call.id)));
          refreshLost(call.id);
        } catch (err) {
          log.warn({ err, callId: call.id }, 'не вдалося отримати учасників кімнати');
        }
      }
    },

    invite(actor: Actor, req: { to: string; video: boolean }): Result {
      const callee = users.get(actor.siteId, req.to);
      if (!callee || callee.disabled || callee.id === actor.userId) throw new CallError('invalid_target');
      if (store.activeFor(actor.siteId, actor.userId).length > 0) throw new CallError('already_in_call');
      checkRate(`${actor.siteId}\u0000${actor.userId}`);

      const scenario = callee.isBot ? botScenario(callee.id) : null;
      const now = clock.now();
      const timeoutMs = scenario?.kind === 'ignore' ? scenario.timeoutMs : RING_TIMEOUT_MS;
      // дзвінки адресата до створення цього
      const others = store.activeFor(actor.siteId, callee.id);
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

      // порядок перевірок із docs/signaling.md; перші три виконано вище
      let refusal: { reason: 'busy' | 'offline'; silent?: boolean } | null = null;
      if (callee.isBot) {
        // боти не мають очікування: зайнятий бот або сценарій «зайнято» дає busy
        if (scenario?.kind === 'busy' || others.length > 0) refusal = { reason: 'busy' };
      } else if (callee.settings.dnd) {
        refusal = { reason: 'busy', silent: true };
      } else if (others.some(c => c.state === 'ringing') || others.length >= 2) {
        refusal = { reason: 'busy' };
      } else if (others.length === 1 && !callee.settings.waiting) {
        refusal = { reason: 'busy', silent: true };
      } else if (!deps.isReachable(actor.siteId, callee.id)) {
        refusal = { reason: 'offline' };
      }
      const ack = info(call, actor.userId);
      if (refusal) {
        const effects = end(call, refusal.reason, { calleeNotified: false, silentMissed: refusal.silent });
        return { call: ack, effects };
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

    /**
     * Зник останній пристрій користувача: його вихідні дзвінки, що ще дзвонять, скасуються через `CALLER_GONE_MS`,
     * якщо він за цей час не повернеться (коротке перепідключення дзвінок не рве).
     */
    callerGone(siteId: string, userId: string): void {
      for (const call of store.activeFor(siteId, userId)) {
        if (call.state !== 'ringing' || call.callerId !== userId) continue;
        armTimer(`gone:${call.id}`, CALLER_GONE_MS, () => cancelIfCallerGone(call.id));
      }
    },

    cancel(actor: Actor, req: { callId: string }): Result {
      const call = load(req.callId);
      if (call.callerId !== actor.userId || call.state !== 'ringing') throw new CallError('not_allowed');
      return { effects: end(call, 'cancelled') };
    },

    /** `action` обов'язкове, якщо в користувача вже є розмова: `hold` утримує її, `end` завершує. */
    accept(actor: Actor, req: { callId: string; action?: 'hold' | 'end' }): Result {
      const call = load(req.callId);
      if (call.calleeId !== actor.userId) throw new CallError('not_allowed');
      // дзвінок уже прийнято на іншому пристрої
      if (call.state === 'connected' && call.answeredDevice !== actor.deviceId) throw new CallError('call_ended');
      // повторне «Відповісти» з того ж пристрою (подвійний тап): уже прийнято, нічого не змінюємо
      if (call.state === 'connected') return { effects: [] };
      if (call.state !== 'ringing') throw new CallError('not_allowed');

      const current = connectedCalls(actor.siteId, actor.userId, call.id)[0];
      if (current && req.action !== 'hold' && req.action !== 'end') {
        throw new CallError('bad_request', 'call.accept: потрібне action, бо є розмова');
      }
      const effects: Effect[] = [];
      if (current) {
        effects.push(...(req.action === 'hold' ? setHold(current, actor.userId, true) : end(current, 'hangup')));
      }
      effects.push(...connect(call, actor.deviceId));
      return { effects };
    },

    reject(actor: Actor, req: { callId: string }): Result {
      const call = load(req.callId);
      if (call.calleeId !== actor.userId || call.state !== 'ringing') throw new CallError('not_allowed');
      return { effects: end(call, 'rejected', { actorDevice: actor.deviceId }) };
    },

    hangup(actor: Actor, req: { callId: string }): Result {
      const call = load(req.callId);
      if (![call.callerId, call.calleeId].includes(actor.userId) || call.state !== 'connected') {
        throw new CallError('not_allowed');
      }
      return { effects: end(call, 'hangup') };
    },

    /** `hold: false` на утримуваному дзвінку ставить на утримання іншу розмову користувача (перемикання). */
    hold(actor: Actor, req: { callId: string; hold: boolean }): Result {
      const call = load(req.callId);
      if (![call.callerId, call.calleeId].includes(actor.userId) || call.state !== 'connected') {
        throw new CallError('not_allowed');
      }
      const effects = setHold(call, actor.userId, req.hold, actor.deviceId);
      if (!req.hold) {
        for (const other of connectedCalls(actor.siteId, actor.userId, call.id)) {
          const mine = other.callerId === actor.userId ? other.holdCaller : other.holdCallee;
          if (!mine) effects.push(...setHold(other, actor.userId, true));
        }
      }
      return { effects };
    },

    /** Після перезапуску: відновлює незавершені дзвінки з БД і таймери очікування. */
    restore(): void {
      for (const call of store.loadActive()) {
        if (call.state === 'connected' && tracked(call)) restoredConnected.push(call);
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
