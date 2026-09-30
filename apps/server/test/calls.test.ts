import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { CallError, createCallService } from '../src/calls/service';
import type { Actor, Effect } from '../src/calls/types';
import { openDb } from '../src/db';
import { createRecents } from '../src/db/recents';
import { createUsers } from '../src/db/users';
import { createCallStore } from '../src/store/calls';
import { createFakeClock } from './fake-clock';

const SITE = 'demo';
const anna: Actor = { siteId: SITE, userId: '+380500000001', deviceId: 'a1' };
const bohdan: Actor = { siteId: SITE, userId: '+380500000002', deviceId: 'b1' };
const bohdan2: Actor = { ...bohdan, deviceId: 'b2' };
const clara: Actor = { siteId: SITE, userId: '+380500000003', deviceId: 'c1' };

function setup(dbPath = ':memory:') {
  const db = openDb(dbPath);
  const users = createUsers(db);
  users.seedBots();
  for (const [a, name] of [[anna, 'Анна'], [bohdan, 'Богдан'], [clara, 'Клара']] as const) users.upsertDemoUser(a.userId, name);
  const clock = createFakeClock();
  const online = new Set<string>([anna.userId, bohdan.userId, clara.userId]);
  const delivered: Effect[] = [];
  let n = 0;
  const recents = createRecents(db);
  const make = () =>
    createCallService({
      store: createCallStore(db),
      users,
      recents,
      clock,
      isOnline: (_s, u) => online.has(u),
      deliver: (e) => void delivered.push(...e),
      newId: () => `call${++n}`,
      logger: pino({ level: 'silent' }),
    });
  return { db, calls: make(), make, clock, online, delivered, recents, users };
}

/** Повідомлення типу `type` серед effects, з адресатами. */
const find = (effects: Effect[], type: string) =>
  effects.filter((e) => e.msg.type === type).map((e) => ({ user: e.userId, device: e.deviceId, except: e.exceptDeviceId, msg: e.msg as any }));

describe('call.invite', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => void (t = setup()));

  it('дзвонить адресату й повідомляє того, хто дзвонить', () => {
    const r = t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(r.call).toMatchObject({ callId: 'call1', direction: 'out', state: 'ringing', peer: { userId: bohdan.userId, name: 'Богдан' } });
    expect(r.call!.expiresAt).toBe(t.clock.now() + 60_000);
    expect(find(r.effects, 'call.incoming')).toMatchObject([{ user: bohdan.userId, msg: { call: { direction: 'in', peer: { name: 'Анна' } } } }]);
    expect(find(r.effects, 'call.ringing')).toMatchObject([{ user: anna.userId }]);
  });

  it('відхиляє неіснуючого адресата, себе й заблокованого', () => {
    expect(() => t.calls.invite(anna, { to: '+380999999999', video: false })).toThrow(expect.objectContaining({ code: 'invalid_target' }));
    expect(() => t.calls.invite(anna, { to: anna.userId, video: false })).toThrow(expect.objectContaining({ code: 'invalid_target' }));
    t.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(bohdan.userId);
    expect(() => t.calls.invite(anna, { to: bohdan.userId, video: false })).toThrow(expect.objectContaining({ code: 'invalid_target' }));
  });

  it('already_in_call, якщо в того, хто дзвонить, уже є дзвінок', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(() => t.calls.invite(anna, { to: clara.userId, video: false })).toThrow(expect.objectContaining({ code: 'already_in_call' }));
    // і в адресата, який уже дзвонить: той, хто дзвонить, не може бути й адресатом
    expect(() => t.calls.invite(bohdan, { to: clara.userId, video: false })).toThrow(expect.objectContaining({ code: 'already_in_call' }));
  });

  it('busy, якщо адресат уже в дзвінку; історія лише в того, хто дзвонив', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    const r = t.calls.invite(clara, { to: bohdan.userId, video: false });
    expect(find(r.effects, 'call.ended')).toMatchObject([{ user: clara.userId, msg: { reason: 'busy' } }]);
    expect(t.recents.list(SITE, clara.userId)).toMatchObject([{ result: 'busy', peer: bohdan.userId, direction: 'out' }]);
    expect(t.recents.list(SITE, bohdan.userId)).toEqual([]);
    // завершений дзвінок не займає користувача
    expect(t.calls.callsFor(SITE, clara.userId)).toEqual([]);
  });

  it('offline, якщо адресата немає в мережі', () => {
    t.online.delete(bohdan.userId);
    const r = t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(find(r.effects, 'call.ended').map((e) => e.user)).toEqual([anna.userId]);
    expect(find(r.effects, 'call.ended')[0]!.msg.reason).toBe('offline');
    expect(t.recents.list(SITE, anna.userId)[0]).toMatchObject({ result: 'no_answer' });
    expect(t.recents.list(SITE, bohdan.userId)[0]).toMatchObject({ result: 'missed', direction: 'in' });
  });

  it('rate_limited після 10 дзвінків за хвилину', () => {
    for (let i = 0; i < 10; i++) {
      const r = t.calls.invite(anna, { to: bohdan.userId, video: false });
      t.calls.cancel(anna, { callId: r.call!.callId });
    }
    expect(() => t.calls.invite(anna, { to: bohdan.userId, video: false })).toThrow(expect.objectContaining({ code: 'rate_limited' }));
    t.clock.advance(61_000);
    expect(() => t.calls.invite(anna, { to: bohdan.userId, video: false })).not.toThrow();
  });
});

describe('життєвий цикл', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => void (t = setup()));

  it('прийняття, утримання, завершення з тривалістю й історією', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    t.clock.advance(5_000);
    const accepted = t.calls.accept(bohdan, { callId: 'call1' });
    expect(find(accepted.effects, 'call.connected').map((e) => [e.user, e.device, e.msg.call.direction])).toEqual([
      [anna.userId, undefined, 'out'],
      [bohdan.userId, 'b1', 'in'],
    ]);

    const held = t.calls.hold(anna, { callId: 'call1', hold: true });
    expect(find(held.effects, 'call.peer')).toMatchObject([{ user: bohdan.userId, msg: { callId: 'call1', hold: true } }]);
    expect(find(held.effects, 'call.updated')).toMatchObject([{ user: anna.userId, except: 'a1', msg: { hold: true } }]);
    expect(t.calls.callsFor(SITE, bohdan.userId)[0]).toMatchObject({ state: 'connected', peerHold: true, hold: false });

    t.clock.advance(65_000);
    const ended = t.calls.hangup(bohdan, { callId: 'call1' });
    expect(find(ended.effects, 'call.ended').map((e) => [e.user, e.msg.reason, e.msg.duration])).toEqual([
      [anna.userId, 'hangup', 65],
      [bohdan.userId, 'hangup', 65],
    ]);
    expect(t.recents.list(SITE, anna.userId)[0]).toMatchObject({ result: 'completed', direction: 'out', duration: 65 });
    expect(t.recents.list(SITE, bohdan.userId)[0]).toMatchObject({ result: 'completed', direction: 'in', duration: 65 });
    expect(find(ended.effects, 'recents.add')).toHaveLength(2);
  });

  it('cancel: адресат отримує пропущений', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    const r = t.calls.cancel(anna, { callId: 'call1' });
    expect(find(r.effects, 'call.ended').every((e) => e.msg.reason === 'cancelled')).toBe(true);
    expect(t.recents.list(SITE, anna.userId)[0]!.result).toBe('cancelled');
    expect(t.recents.list(SITE, bohdan.userId)[0]!.result).toBe('missed');
  });

  it('reject: інші пристрої адресата бачать answered_elsewhere', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    const r = t.calls.reject(bohdan2, { callId: 'call1' });
    const ended = find(r.effects, 'call.ended');
    expect(ended.find((e) => e.user === anna.userId)!.msg.reason).toBe('rejected');
    expect(ended.find((e) => e.device === 'b2')!.msg.reason).toBe('rejected');
    expect(ended.find((e) => e.except === 'b2')!.msg.reason).toBe('answered_elsewhere');
    expect(t.recents.list(SITE, bohdan.userId)[0]!.result).toBe('rejected');
  });

  it('два пристрої: перший accept виграє, запізнілий отримує call_ended', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    const r = t.calls.accept(bohdan, { callId: 'call1' });
    expect(find(r.effects, 'call.ended')).toMatchObject([{ user: bohdan.userId, except: 'b1', msg: { reason: 'answered_elsewhere' } }]);
    expect(() => t.calls.accept(bohdan2, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'call_ended' }));
    expect(() => t.calls.accept(bohdan, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'not_allowed' }));
  });

  it('таймаут 60 с: дзвінок завершується, обидва отримують історію', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    t.clock.advance(59_999);
    expect(t.delivered).toEqual([]);
    t.clock.advance(1);
    expect(find(t.delivered, 'call.ended').map((e) => e.msg.reason)).toEqual(['timeout', 'timeout']);
    expect(t.recents.list(SITE, anna.userId)[0]!.result).toBe('no_answer');
    expect(t.recents.list(SITE, bohdan.userId)[0]!.result).toBe('missed');
  });

  it('прийнятий дзвінок не завершується таймаутом', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    t.calls.accept(bohdan, { callId: 'call1' });
    t.clock.advance(120_000);
    expect(find(t.delivered, 'call.ended')).toEqual([]);
  });

  it('команди в неправильному стані чи від сторонніх', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(() => t.calls.accept(anna, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'not_allowed' }));
    expect(() => t.calls.cancel(bohdan, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'not_allowed' }));
    expect(() => t.calls.hangup(anna, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'not_allowed' }));
    expect(() => t.calls.hold(anna, { callId: 'call1', hold: true })).toThrow(expect.objectContaining({ code: 'not_allowed' }));
    expect(() => t.calls.accept(clara, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'not_allowed' }));
    expect(() => t.calls.cancel(anna, { callId: 'нема' })).toThrow(expect.objectContaining({ code: 'call_not_found' }));
    t.calls.cancel(anna, { callId: 'call1' });
    expect(() => t.calls.cancel(anna, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'call_ended' }));
    t.clock.advance(31_000); // завершений дзвінок забуто
    expect(() => t.calls.cancel(anna, { callId: 'call1' })).toThrow(expect.objectContaining({ code: 'call_not_found' }));
  });

  it('CallError має код', () => {
    expect(new CallError('call_ended').code).toBe('call_ended');
  });
});

describe('демо-боти', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => void (t = setup()));

  it('Олена відповідає через 3,5 с', () => {
    t.calls.invite(anna, { to: 'bot:olena', video: false });
    t.clock.advance(3_499);
    expect(find(t.delivered, 'call.connected')).toEqual([]);
    t.clock.advance(1);
    expect(find(t.delivered, 'call.connected').filter((e) => e.user === anna.userId)).toMatchObject([{ msg: { call: { peer: { name: 'Олена' } } } }]);
    // дзвінок триває, таймаут не спрацьовує
    t.clock.advance(120_000);
    expect(find(t.delivered, 'call.ended').filter((e) => e.msg.reason !== 'answered_elsewhere')).toEqual([]);
    const r = t.calls.hangup(anna, { callId: 'call1' });
    expect(find(r.effects, 'recents.add')).toHaveLength(1); // лише для людини
  });

  it('Андрій одразу зайнятий', () => {
    const r = t.calls.invite(anna, { to: 'bot:andriy', video: false });
    expect(find(r.effects, 'call.ended')[0]!.msg.reason).toBe('busy');
  });

  it('Support не відповідає, без відповіді через 8 с', () => {
    const r = t.calls.invite(anna, { to: 'bot:support', video: false });
    expect(r.call!.expiresAt).toBe(t.clock.now() + 8_000);
    t.clock.advance(8_000);
    expect(find(t.delivered, 'call.ended')[0]!.msg.reason).toBe('timeout');
    expect(t.recents.list(SITE, anna.userId)[0]!.result).toBe('no_answer');
  });

  it('скасований дзвінок Олена не приймає', () => {
    t.calls.invite(anna, { to: 'bot:olena', video: false });
    t.calls.cancel(anna, { callId: 'call1' });
    t.delivered.length = 0;
    t.clock.advance(10_000);
    expect(t.delivered).toEqual([]);
  });
});

describe('відновлення після перезапуску', () => {
  it('ringing повертається з таймером, connected лишається', () => {
    const t = setup();
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    t.calls.invite(clara, { to: 'bot:support', video: false });
    t.calls.accept(bohdan, { callId: 'call1' });

    // «перезапуск»: новий сервіс і нове сховище над тією самою БД
    const restarted = t.make();
    restarted.restore();
    expect(restarted.callsFor(SITE, bohdan.userId)).toMatchObject([{ callId: 'call1', state: 'connected' }]);
    expect(restarted.callsFor(SITE, clara.userId)).toMatchObject([{ callId: 'call2', state: 'ringing' }]);
    t.clock.advance(8_000);
    expect(find(t.delivered, 'call.ended').map((e) => e.msg.reason)).toContain('timeout');
    expect(restarted.hangup(anna, { callId: 'call1' }).effects.length).toBeGreaterThan(0);
  });

  it('ringing з простроченим часом завершується при старті', () => {
    const t = setup();
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    t.clock.advance(70_000);
    // таймер уже спрацював би; імітуємо перезапуск, у якому його не було
    t.db.prepare("UPDATE calls SET state = 'ringing', ended_at = NULL, reason = NULL").run();
    const restarted = t.make();
    t.delivered.length = 0;
    restarted.restore();
    expect(find(t.delivered, 'call.ended').map((e) => e.msg.reason)).toEqual(['timeout', 'timeout']);
  });
});

describe('dnd', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.users.updateSettings(SITE, bohdan.userId, { dnd: true });
  });

  it('будь-який вхідний дає busy без сповіщення адресата, адресат отримує тихий missed', () => {
    const r = t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(find(r.effects, 'call.incoming')).toEqual([]);
    expect(find(r.effects, 'call.ended').map((e) => [e.user, e.msg.reason])).toEqual([[anna.userId, 'busy']]);
    expect(t.recents.list(SITE, anna.userId)).toMatchObject([{ result: 'busy', direction: 'out' }]);
    expect(t.recents.list(SITE, bohdan.userId)).toEqual([{ callId: 'call1', peer: anna.userId, direction: 'in', result: 'missed', startedAt: t.clock.now(), silent: true }]);
    expect(find(r.effects, 'recents.add').find((e) => e.user === bohdan.userId)!.msg.entry.silent).toBe(true);
    expect(t.calls.callsFor(SITE, anna.userId)).toEqual([]);
  });

  it('dnd діє й коли користувач вільний офлайн, і сильніший за waiting', () => {
    t.online.delete(bohdan.userId);
    const r = t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(find(r.effects, 'call.ended')[0]!.msg.reason).toBe('busy'); // не offline: стан не розкривається
  });

  it('власні виклики користувача з dnd працюють', () => {
    const r = t.calls.invite(bohdan, { to: clara.userId, video: false });
    expect(find(r.effects, 'call.incoming')).toHaveLength(1);
  });

  it('зняття dnd повертає звичайні вхідні', () => {
    t.users.updateSettings(SITE, bohdan.userId, { dnd: false });
    const r = t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(find(r.effects, 'call.incoming')).toHaveLength(1);
  });
});

describe('другий вхідний (waiting)', () => {
  let t: ReturnType<typeof setup>;
  /** Анна і Богдан розмовляють; Клара дзвонить Богданові. */
  function waitingCall() {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    t.calls.accept(bohdan, { callId: 'call1' });
    t.delivered.length = 0;
    return t.calls.invite(clara, { to: bohdan.userId, video: false });
  }
  beforeEach(() => void (t = setup()));

  it('очікуючий вхідний має waiting у всіх повідомленнях', () => {
    const r = waitingCall();
    expect(r.call).toMatchObject({ callId: 'call2', state: 'ringing', waiting: true });
    expect(find(r.effects, 'call.incoming')).toMatchObject([{ user: bohdan.userId, msg: { call: { waiting: true, direction: 'in' } } }]);
    expect(find(r.effects, 'call.ringing')).toMatchObject([{ user: clara.userId, msg: { call: { waiting: true } } }]);
    expect(t.calls.callsFor(SITE, bohdan.userId).map((c) => [c.callId, c.waiting ?? false])).toEqual([['call1', false], ['call2', true]]);
  });

  it('accept без action відхиляється й нічого не змінює', () => {
    waitingCall();
    expect(() => t.calls.accept(bohdan, { callId: 'call2' })).toThrow(expect.objectContaining({ code: 'bad_request' }));
    expect(t.calls.callsFor(SITE, bohdan.userId).map((c) => c.state)).toEqual(['connected', 'ringing']);
  });

  it('«Утримати й прийняти»: перша розмова утримується, друга connected', () => {
    waitingCall();
    const r = t.calls.accept(bohdan, { callId: 'call2', action: 'hold' });
    expect(find(r.effects, 'call.peer')).toMatchObject([{ user: anna.userId, msg: { callId: 'call1', hold: true } }]);
    expect(find(r.effects, 'call.updated')).toMatchObject([{ user: bohdan.userId, except: undefined, msg: { callId: 'call1', hold: true } }]);
    expect(find(r.effects, 'call.connected').map((e) => e.user).sort()).toEqual([bohdan.userId, clara.userId].sort());
    const calls = t.calls.callsFor(SITE, bohdan.userId);
    expect(calls.map((c) => [c.callId, c.state, c.hold])).toEqual([['call1', 'connected', true], ['call2', 'connected', false]]);
    // третій дзвінок: уже два
    const third = t.calls.invite({ siteId: SITE, userId: 'bot:olena', deviceId: 'x' } as Actor, { to: bohdan.userId, video: false });
    expect(find(third.effects, 'call.ended')[0]!.msg.reason).toBe('busy');
  });

  it('«Завершити й прийняти»: перша розмова завершується', () => {
    waitingCall();
    t.clock.advance(10_000);
    const r = t.calls.accept(bohdan, { callId: 'call2', action: 'end' });
    expect(find(r.effects, 'call.ended').filter((e) => e.msg.callId === 'call1').map((e) => [e.user, e.msg.callId, e.msg.reason, e.msg.duration])).toEqual([
      [anna.userId, 'call1', 'hangup', 10],
      [bohdan.userId, 'call1', 'hangup', 10],
    ]);
    expect(t.calls.callsFor(SITE, bohdan.userId).map((c) => [c.callId, c.state])).toEqual([['call2', 'connected']]);
  });

  it('«Відхилити» не чіпає першу розмову', () => {
    waitingCall();
    const r = t.calls.reject(bohdan, { callId: 'call2' });
    expect(find(r.effects, 'call.ended')[0]!.msg.reason).toBe('rejected');
    expect(t.calls.callsFor(SITE, bohdan.userId).map((c) => c.callId)).toEqual(['call1']);
  });

  it('action без розмови ігнорується', () => {
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    expect(() => t.calls.accept(bohdan, { callId: 'call1', action: 'end' })).not.toThrow();
  });

  it('завершення першої розмови знімає waiting з другого дзвінка', () => {
    waitingCall();
    const r = t.calls.hangup(anna, { callId: 'call1' });
    expect(find(r.effects, 'call.updated').map((e) => [e.user, e.msg.callId, e.msg.waiting]).sort()).toEqual(
      [[bohdan.userId, 'call2', false], [clara.userId, 'call2', false]].sort(),
    );
    expect(t.calls.callsFor(SITE, bohdan.userId)[0]!.waiting).toBeUndefined();
    // звичайний вхідний далі можна прийняти без action
    expect(() => t.calls.accept(bohdan, { callId: 'call2' })).not.toThrow();
  });

  it('перемикання: hold:false на утримуваному ставить іншу розмову на утримання', () => {
    waitingCall();
    t.calls.accept(bohdan, { callId: 'call2', action: 'hold' });
    const r = t.calls.hold(bohdan, { callId: 'call1', hold: false });
    const peers = find(r.effects, 'call.peer').map((e) => [e.user, e.msg.callId, e.msg.hold]);
    expect(peers).toEqual([[anna.userId, 'call1', false], [clara.userId, 'call2', true]]);
    expect(t.calls.callsFor(SITE, bohdan.userId).map((c) => [c.callId, c.hold])).toEqual([['call1', false], ['call2', true]]);
  });

  it('busy, коли уже дзвонить інший вхідний', () => {
    const t2 = setup();
    t2.users.upsertDemoUser('+380500000004', 'Дмитро');
    t2.online.add('+380500000004');
    const d: Actor = { siteId: SITE, userId: '+380500000004', deviceId: 'd1' };
    t2.calls.invite(anna, { to: bohdan.userId, video: false });
    t2.calls.accept(bohdan, { callId: 'call1' });
    t2.calls.invite(clara, { to: bohdan.userId, video: false }); // waiting
    const r = t2.calls.invite(d, { to: bohdan.userId, video: false });
    expect(find(r.effects, 'call.ended')[0]!.msg.reason).toBe('busy');
    expect(t2.recents.list(SITE, bohdan.userId)).toEqual([]);
  });

  it('waiting: false дає busy з тихим missed', () => {
    t.users.updateSettings(SITE, bohdan.userId, { waiting: false });
    t.calls.invite(anna, { to: bohdan.userId, video: false });
    t.calls.accept(bohdan, { callId: 'call1' });
    t.delivered.length = 0;
    const r = t.calls.invite(clara, { to: bohdan.userId, video: false });
    expect(find(r.effects, 'call.incoming')).toEqual([]);
    expect(find(r.effects, 'call.ended')[0]!.msg.reason).toBe('busy');
    expect(t.recents.list(SITE, bohdan.userId)[0]).toMatchObject({ result: 'missed', silent: true, peer: clara.userId });
  });

  it('очікуючий дзвінок без відповіді завершується звичайним missed', () => {
    waitingCall();
    t.clock.advance(60_000);
    expect(find(t.delivered, 'call.ended').map((e) => e.msg.reason)).toEqual(['timeout', 'timeout']);
    expect(t.recents.list(SITE, bohdan.userId)[0]).toMatchObject({ result: 'missed', peer: clara.userId });
    expect(t.recents.list(SITE, bohdan.userId)[0]!.silent).toBeUndefined();
  });

  it('боти не мають очікування: зайнятий бот дає busy', () => {
    t.calls.invite(anna, { to: 'bot:olena', video: false });
    t.clock.advance(3_500);
    const r = t.calls.invite(clara, { to: 'bot:olena', video: false });
    expect(find(r.effects, 'call.ended')[0]!.msg.reason).toBe('busy');
  });
});
