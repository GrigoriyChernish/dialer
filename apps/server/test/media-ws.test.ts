import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeClock } from './fake-clock';
import { connectUser, LIVEKIT_TEST, signedWebhook, startServer, type TestServer } from './helpers';

const clock = createFakeClock();
let server: TestServer;
beforeAll(async () => void (server = await startServer(undefined, { clock, livekit: true })));
afterAll(() => server.close());

let seq = 0;
const phone = () => `09600000${String(++seq).padStart(2, '0')}`;
const payload = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());

async function postWebhook(event: string, callId: string, identity: string, auth?: { text: string; auth: string }) {
  const signed = auth ?? (await signedWebhook({ event, room: { name: callId }, participant: { identity } }));
  return fetch(`${server.http}/livekit/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/webhook+json', authorization: signed.auth },
    body: signed.text,
  });
}

describe('медіа і lost через WebSocket та вебхук', () => {
  it('call.connected містить токен кімнати, hello.ok повертає його лише пристрою розмови', async () => {
    const [pa, pb] = [phone(), phone()];
    const a = await connectUser(server, 'Аліса', pa, 'phone');
    const aOther = await connectUser(server, 'Аліса', pa, 'laptop');
    const b = await connectUser(server, 'Борис', pb, 'phone');

    a.client.send({ type: 'call.invite', id: 'i1', to: `+38${pb}`, video: false });
    const { call } = await a.client.next('ack');
    await b.client.next('call.incoming');
    b.client.send({ type: 'call.accept', id: 'x1', callId: call!.callId });
    await b.client.next('ack');

    const forCaller = (await a.client.next('call.connected')).call;
    const forCallee = (await b.client.next('call.connected')).call;
    expect(forCaller.livekit!.url).toBe(LIVEKIT_TEST.url);
    expect(payload(forCaller.livekit!.token)).toMatchObject({ sub: `+38${pa}:phone`, video: { room: call!.callId, roomJoin: true } });
    expect(payload(forCallee.livekit!.token).sub).toBe(`+38${pb}:phone`);
    // інший пристрій того, хто дзвонив, бачить дзвінок без медіа
    expect((await aOther.client.next('call.connected')).call.livekit).toBeUndefined();

    // перепідключення того ж пристрою повертає свіжий токен, іншого пристрою немає
    const back = await connectUser(server, 'Борис', pb, 'phone');
    expect(back.hello.calls[0]!.livekit).toBeDefined();
    const elsewhere = await connectUser(server, 'Борис', pb, 'tablet');
    expect(elsewhere.hello.calls[0]!.livekit).toBeUndefined();
    for (const c of [a, aOther, b, back, elsewhere]) c.client.close();
  });

  it('вебхуки тримають розмову живою, вихід учасника завершує її через 30 с з lost й закриває кімнату', async () => {
    const [pa, pb] = [phone(), phone()];
    const a = await connectUser(server, 'Віка', pa);
    const b = await connectUser(server, 'Гриць', pb);
    a.client.send({ type: 'call.invite', id: 'i1', to: `+38${pb}`, video: false });
    const callId = (await a.client.next('ack')).call!.callId;
    await b.client.next('call.incoming');
    b.client.send({ type: 'call.accept', id: 'x1', callId });
    await b.client.next('ack');
    await a.client.next('call.connected');

    expect((await postWebhook('participant_joined', callId, `+38${pa}:d1`)).status).toBe(200);
    expect((await postWebhook('participant_joined', callId, `+38${pb}:d1`)).status).toBe(200);
    clock.advance(120_000);
    expect(a.client.frames.filter((f) => f.type === 'call.ended')).toEqual([]);

    await postWebhook('participant_left', callId, `+38${pb}:d1`);
    clock.advance(29_000);
    expect(a.client.frames.filter((f) => f.type === 'call.ended')).toEqual([]);
    clock.advance(1_000);
    expect(await a.client.next('call.ended')).toMatchObject({ callId, reason: 'lost', duration: 150 });
    expect(await b.client.next('call.ended')).toMatchObject({ callId, reason: 'lost' });
    expect((await a.client.next('recents.add')).entry).toMatchObject({ result: 'completed', duration: 150 });
    await a.client.until(() => server.closedRooms.includes(callId));
    a.client.close();
    b.client.close();
  });

  it('вебхук з неправильним підписом відхиляється й нічого не змінює', async () => {
    const forged = await signedWebhook({ event: 'room_finished', room: { name: 'call' } }, { ...LIVEKIT_TEST, apiSecret: 'f'.repeat(32) });
    expect((await postWebhook('room_finished', 'call', '', forged)).status).toBe(401);
    const noAuth = await fetch(`${server.http}/livekit/webhook`, { method: 'POST', headers: { 'content-type': 'application/webhook+json' }, body: '{}' });
    expect(noAuth.status).toBe(401);
  });
});

describe('без LiveKit', () => {
  it('ендпоінту вебхука немає, call.connected без токена', async () => {
    const plain = await startServer(undefined, { clock: createFakeClock() });
    const res = await fetch(`${plain.http}/livekit/webhook`, { method: 'POST', headers: { 'content-type': 'application/webhook+json' }, body: '{}' });
    expect(res.status).toBe(404);
    const a = await connectUser(plain, 'Тест', phone());
    a.client.send({ type: 'call.invite', id: 'i1', to: 'bot:olena', video: false });
    await a.client.next('ack');
    a.client.close();
    await plain.close();
  });
});
