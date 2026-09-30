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
    const pa = phone(), pb = phone();
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
    expect((await a.client.next('recents.add')).entry).toMatchObject({ result: 'completed', direction: 'out', duration: 42 });
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

    a.client.send({ type: 'call.invite', to: 'bot:support' });
    expect((await a.client.next('error')).code).toBe('bad_request');
    a.client.send({ type: 'call.invite', id: 'e2', to: 5 });
    expect(await a.client.next('error')).toMatchObject({ reqId: 'e2', code: 'bad_request' });

    a.client.send({ type: 'call.invite', id: 'e3', to: 'bot:support', video: false });
    const first = await a.client.next('ack');
    a.client.send({ type: 'call.invite', id: 'e3', to: 'bot:support', video: false });
    expect(await a.client.next('ack')).toEqual(first);
    a.client.send({ type: 'call.invite', id: 'e4', to: 'bot:olena', video: false });
    expect((await a.client.next('error')).code).toBe('already_in_call');
    a.client.send({ type: 'call.cancel', id: 'e5', callId: first.call!.callId });
    await a.client.next('ack');
    a.client.close();
  });

  it('Олена відповідає через 3,5 с, Андрій зайнятий', async () => {
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
    b.client.send({ type: 'call.invite', id: 'b3', to: 'bot:andriy', video: false });
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
});
