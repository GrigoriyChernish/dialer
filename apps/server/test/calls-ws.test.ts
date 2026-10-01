import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeClock } from './fake-clock';
import { connectUser, startServer, type TestServer } from './helpers';

const clock = createFakeClock();
let server: TestServer;
beforeAll(async () => void (server = await startServer(undefined, { clock })));
afterAll(() => server.close());

let phoneSeq = 0;
const phone = () => `09500000${String(++phoneSeq).padStart(2, '0')}`;

describe('дзвінок через WebSocket', () => {
  it('повний цикл: invite → accept → hold → hangup, історія доступна після перепідключення', async () => {
    const pa = phone(),
      pb = phone();
    const a = await connectUser(server, 'Анна', pa);
    const b = await connectUser(server, 'Богдан', pb);

    a.client.send({ type: 'call.invite', id: 'i1', to: `+38${pb}`, video: true });
    const ack = await a.client.next('ack');
    expect(ack).toMatchObject({ reqId: 'i1', call: { direction: 'out', state: 'ringing', peer: { name: 'Богдан' } } });
    const callId = ack.call!.callId;
    expect((await a.client.next('call.ringing')).call.callId).toBe(callId);
    const incoming = await b.client.next('call.incoming');
    expect(incoming.call).toMatchObject({ callId, direction: 'in', peer: { name: 'Анна' } });

    b.client.send({ type: 'call.accept', id: 'x1', callId });
    await b.client.next('ack');
    expect((await a.client.next('call.connected')).call).toMatchObject({ state: 'connected', direction: 'out' });
    expect((await b.client.next('call.connected')).call).toMatchObject({ state: 'connected', direction: 'in' });

    a.client.send({ type: 'call.hold', id: 'h1', callId, hold: true });
    await a.client.next('ack');
    expect(await b.client.next('call.peer')).toMatchObject({ callId, hold: true });

    clock.advance(42_000);
    b.client.send({ type: 'call.hangup', id: 'x2', callId });
    await b.client.next('ack');
    expect(await a.client.next('call.ended')).toMatchObject({ callId, reason: 'hangup', duration: 42 });
    expect(await b.client.next('call.ended')).toMatchObject({ callId, reason: 'hangup', duration: 42 });
    expect((await a.client.next('recents.add')).entry).toMatchObject({
      result: 'completed',
      direction: 'out',
      duration: 42,
    });
    expect((await b.client.next('recents.add')).entry).toMatchObject({ result: 'completed', direction: 'in' });

    const again = await connectUser(server, 'Анна', pa, 'd2');
    expect(again.hello.calls).toEqual([]);
    expect(again.hello.recents).toMatchObject([{ callId, peer: `+38${pb}`, result: 'completed', duration: 42 }]);
    for (const c of [a, b, again]) c.client.close();
  });

  it('помилки мають reqId і код, а повтор запиту не створює другий дзвінок', async () => {
    const a = await connectUser(server, 'Ірина', phone());
    a.client.send({ type: 'call.invite', id: 'e1', to: '+380999999999', video: false });
    expect(await a.client.next('error')).toMatchObject({ reqId: 'e1', code: 'invalid_target' });

    a.client.send({ type: 'call.invite', to: 'bot:andriy' });
    expect((await a.client.next('error')).code).toBe('bad_request');
    a.client.send({ type: 'call.invite', id: 'e2', to: 5 });
    expect(await a.client.next('error')).toMatchObject({ reqId: 'e2', code: 'bad_request' });

    a.client.send({ type: 'call.invite', id: 'e3', to: 'bot:andriy', video: false });
    const first = await a.client.next('ack');
    a.client.send({ type: 'call.invite', id: 'e3', to: 'bot:andriy', video: false });
    expect(await a.client.next('ack')).toEqual(first);
    a.client.send({ type: 'call.invite', id: 'e4', to: 'bot:olena', video: false });
    expect((await a.client.next('error')).code).toBe('already_in_call');
    a.client.send({ type: 'call.cancel', id: 'e5', callId: first.call!.callId });
    await a.client.next('ack');
    a.client.close();
  });

  it('Олена відповідає через 3,5 с, Support зайнятий', async () => {
    const a = await connectUser(server, 'Олег', phone());
    a.client.send({ type: 'call.invite', id: 'b1', to: 'bot:olena', video: false });
    const { call } = await a.client.next('ack');
    await a.client.next('call.ringing');
    clock.advance(3_500);
    expect((await a.client.next('call.connected')).call.peer.name).toBe('Олена');
    a.client.send({ type: 'call.hangup', id: 'b2', callId: call!.callId });
    expect(await a.client.next('call.ended')).toMatchObject({ reason: 'hangup' });
    a.client.close();

    const b = await connectUser(server, 'Павло', phone());
    b.client.send({ type: 'call.invite', id: 'b3', to: 'bot:support', video: false });
    expect((await b.client.next('ack')).call!.state).toBe('ringing');
    expect(await b.client.next('call.ended')).toMatchObject({ reason: 'busy' });
    expect((await b.client.next('recents.add')).entry.result).toBe('busy');
    b.client.close();
  });

  it('другий пристрій адресата: бачить дзвінок у hello.ok, перший отримує answered_elsewhere', async () => {
    const pb = phone();
    const a = await connectUser(server, 'Роман', phone());
    const b1 = await connectUser(server, 'Софія', pb, 'phone');
    a.client.send({ type: 'call.invite', id: 'm1', to: `+38${pb}`, video: false });
    const { call } = await a.client.next('ack');
    await b1.client.next('call.incoming');

    const b2 = await connectUser(server, 'Софія', pb, 'laptop');
    expect(b2.hello.calls).toMatchObject([{ callId: call!.callId, direction: 'in', state: 'ringing' }]);

    b2.client.send({ type: 'call.accept', id: 'm2', callId: call!.callId });
    await b2.client.next('ack');
    expect(await b1.client.next('call.ended')).toMatchObject({ callId: call!.callId, reason: 'answered_elsewhere' });
    b1.client.send({ type: 'call.accept', id: 'm3', callId: call!.callId });
    expect(await b1.client.next('error')).toMatchObject({ reqId: 'm3', code: 'call_ended' });
    for (const c of [a, b1, b2]) c.client.close();
  });

  it('таймаут 60 с: обидва отримують call.ended і запис в історії', async () => {
    const pb = phone();
    const a = await connectUser(server, 'Тетяна', phone());
    const b = await connectUser(server, 'Юрій', pb);
    a.client.send({ type: 'call.invite', id: 't1', to: `+38${pb}`, video: false });
    await a.client.next('ack');
    await b.client.next('call.incoming');
    clock.advance(60_000);
    expect(await a.client.next('call.ended')).toMatchObject({ reason: 'timeout' });
    expect(await b.client.next('call.ended')).toMatchObject({ reason: 'timeout' });
    expect((await b.client.next('recents.add')).entry.result).toBe('missed');
    a.client.close();
    b.client.close();
  });

  it('settings.update: ack з повними налаштуваннями, інші пристрої отримують settings.updated, значення переживають перепідключення', async () => {
    const p = phone();
    const d1 = await connectUser(server, 'Лілія', p, 'phone');
    const d2 = await connectUser(server, 'Лілія', p, 'laptop');
    d1.client.send({ type: 'settings.update', id: 's1', settings: { dnd: true, невідоме: 1 } });
    expect(await d1.client.next('ack')).toMatchObject({ reqId: 's1', settings: { waiting: true, dnd: true } });
    expect((await d2.client.next('settings.updated')).settings).toEqual({ waiting: true, dnd: true });
    expect(d1.client.frames.filter(f => f.type === 'settings.updated')).toEqual([]);

    d1.client.send({ type: 'settings.update', id: 's2', settings: { waiting: 'так' } });
    expect(await d1.client.next('error')).toMatchObject({ reqId: 's2', code: 'bad_request' });
    d1.client.send({ type: 'settings.update', id: 's3', settings: 5 });
    expect((await d1.client.next('error')).code).toBe('bad_request');

    const again = await connectUser(server, 'Лілія', p, 'tablet');
    expect(again.hello.settings).toEqual({ waiting: true, dnd: true });
    for (const c of [d1, d2, again]) c.client.close();
  });

  it('dnd: дзвінок отримує busy, а адресат тихий пропущений', async () => {
    const pb = phone();
    const a = await connectUser(server, 'Максим', phone());
    const b = await connectUser(server, 'Надія', pb);
    b.client.send({ type: 'settings.update', id: 's1', settings: { dnd: true } });
    await b.client.next('ack');

    a.client.send({ type: 'call.invite', id: 'd1', to: `+38${pb}`, video: false });
    await a.client.next('ack');
    expect(await a.client.next('call.ended')).toMatchObject({ reason: 'busy' });
    expect((await b.client.next('recents.add')).entry).toMatchObject({ result: 'missed', silent: true });
    expect(b.client.frames.filter(f => f.type === 'call.incoming')).toEqual([]);
    a.client.close();
    b.client.close();
  });

  it('другий вхідний: waiting, «Утримати й прийняти», call.updated і третій дзвінок busy', async () => {
    const [pa, pb, pc, pd] = [phone(), phone(), phone(), phone()];
    const a = await connectUser(server, 'Оля', pa);
    const b = await connectUser(server, 'Павло', pb);
    const c = await connectUser(server, 'Руслан', pc);
    const d = await connectUser(server, 'Саша', pd);

    a.client.send({ type: 'call.invite', id: 'w1', to: `+38${pb}`, video: false });
    const first = (await a.client.next('ack')).call!.callId;
    await b.client.next('call.incoming');
    b.client.send({ type: 'call.accept', id: 'w2', callId: first });
    await b.client.next('ack');
    await b.client.next('call.connected');

    c.client.send({ type: 'call.invite', id: 'w3', to: `+38${pb}`, video: false });
    const second = (await c.client.next('ack')).call!;
    expect(second.waiting).toBe(true);
    expect((await b.client.next('call.incoming')).call).toMatchObject({ callId: second.callId, waiting: true });

    // без action: помилка
    b.client.send({ type: 'call.accept', id: 'w4', callId: second.callId });
    expect(await b.client.next('error')).toMatchObject({ reqId: 'w4', code: 'bad_request' });
    b.client.send({ type: 'call.accept', id: 'w5', callId: second.callId, action: 'перехрестя' });
    expect((await b.client.next('error')).code).toBe('bad_request');

    b.client.send({ type: 'call.accept', id: 'w6', callId: second.callId, action: 'hold' });
    await b.client.next('ack');
    expect(await a.client.next('call.peer')).toMatchObject({ callId: first, hold: true });
    expect(await b.client.next('call.updated')).toMatchObject({ callId: first, hold: true });
    expect((await c.client.next('call.connected')).call.state).toBe('connected');

    // третій: зайнято
    d.client.send({ type: 'call.invite', id: 'w7', to: `+38${pb}`, video: false });
    await d.client.next('ack');
    expect(await d.client.next('call.ended')).toMatchObject({ reason: 'busy' });

    // перемикання назад на першу розмову
    b.client.send({ type: 'call.hold', id: 'w8', callId: first, hold: false });
    await b.client.next('ack');
    expect(await c.client.next('call.peer')).toMatchObject({ callId: second.callId, hold: true });
    expect(await a.client.next('call.peer')).toMatchObject({ callId: first, hold: false });
    for (const x of [a, b, c, d]) x.client.close();
  });
});
