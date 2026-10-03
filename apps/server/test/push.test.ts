import type { PushPayload } from '@dialer/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { PushSub } from '../src/db/push';
import { isAllowedPushEndpoint } from '../src/push/endpoint';
import type { PushResult, PushSender } from '../src/push/sender';
import { connectUser, startServer, VAPID_TEST, type TestServer } from './helpers';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const sub = (endpoint = ENDPOINT) => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });

let seq = 0;
const phone = () => `09600000${String(++seq).padStart(2, '0')}`;

class FakeSender implements PushSender {
  sent: Array<{ sub: PushSub; payload: PushPayload }> = [];
  result: PushResult = 'ok';
  async send(s: PushSub, payload: PushPayload) {
    this.sent.push({ sub: s, payload });
    return this.result;
  }
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const withPush = async (sender = new FakeSender()) => {
  server = await startServer(undefined, { config: { vapid: VAPID_TEST }, pushSender: sender });
  return { server, sender };
};

describe('isAllowedPushEndpoint', () => {
  it('приймає https і відомі push-сервіси', () => {
    for (const e of [
      ENDPOINT,
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://db5p.notify.windows.com/?token=x',
    ])
      expect(isAllowedPushEndpoint(e), e).toBe(true);
  });

  it('відхиляє http, чужі хости, службові адреси й обхід через userinfo', () => {
    for (const e of [
      'http://fcm.googleapis.com/x',
      'https://evil.example.com/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.example.com/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest',
      'не url',
      42,
      undefined,
    ])
      expect(isAllowedPushEndpoint(e), String(e)).toBe(false);
  });
});

describe('конфігурація VAPID', () => {
  it('без ключів push вимкнено; частково задані ключі: помилка', () => {
    const base = { JWT_SECRET: 's'.repeat(32) };
    expect(loadConfig(base).vapid).toBeNull();
    expect(() => loadConfig({ ...base, VAPID_PUBLIC_KEY: 'x' })).toThrow(/VAPID/);
    expect(
      loadConfig({ ...base, VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'mailto:a@b.c' }).vapid,
    ).toEqual({ publicKey: 'a', privateKey: 'b', subject: 'mailto:a@b.c' });
  });
});

describe('push.subscribe / push.unsubscribe', () => {
  it('hello.ok віддає ключ VAPID, без ключів поля немає', async () => {
    const withKeys = await withPush();
    const a = await connectUser(withKeys.server, 'Анна', phone());
    expect(a.hello.vapidPublicKey).toBe(VAPID_TEST.publicKey);
    a.client.close();
    await withKeys.server.close();

    server = await startServer();
    const b = await connectUser(server, 'Богдан', phone());
    expect(b.hello.vapidPublicKey).toBeUndefined();
    b.client.send({ type: 'push.subscribe', id: 's1', subscription: sub() });
    expect((await b.client.next('error')).code).toBe('bad_request');
    b.client.close();
  });

  it('зберігає підписку пристрою, нова замінює стару, unsubscribe знімає', async () => {
    const { server } = await withPush();
    const p = phone();
    const a = await connectUser(server, 'Анна', p, 'phone');
    const list = () => server.push.hasSubscriptions('demo', `+38${p}`);

    a.client.send({ type: 'push.subscribe', id: 's1', subscription: sub() });
    expect(await a.client.next('ack')).toMatchObject({ reqId: 's1' });
    expect(list()).toBe(true);

    a.client.send({ type: 'push.subscribe', id: 's2', subscription: sub('https://fcm.googleapis.com/fcm/send/new') });
    await a.client.next('ack');
    const rows = server.db.prepare('SELECT endpoint FROM push_subscriptions').all();
    expect(rows).toEqual([{ endpoint: 'https://fcm.googleapis.com/fcm/send/new' }]);

    a.client.send({ type: 'push.unsubscribe', id: 'u1' });
    await a.client.next('ack');
    expect(list()).toBe(false);
    a.client.close();
  });

  it('відхиляє чужий endpoint і неповну підписку', async () => {
    const { server } = await withPush();
    const a = await connectUser(server, 'Анна', phone());
    for (const subscription of [
      sub('https://169.254.169.254/x'),
      { endpoint: ENDPOINT },
      { endpoint: ENDPOINT, keys: { p256dh: '', auth: 'a' } },
      'рядок',
    ]) {
      a.client.send({ type: 'push.subscribe', id: 'bad', subscription });
      expect((await a.client.next('error')).code).toBe('bad_request');
    }
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
    a.client.close();
  });

  it('endpoint переходить до користувача, що увійшов на тому ж пристрої', async () => {
    const { server } = await withPush();
    const [p1, p2] = [phone(), phone()];
    const a = await connectUser(server, 'Анна', p1, 'shared');
    a.client.send({ type: 'push.subscribe', id: 's1', subscription: sub() });
    await a.client.next('ack');
    const b = await connectUser(server, 'Богдан', p2, 'shared');
    b.client.send({ type: 'push.subscribe', id: 's2', subscription: sub() });
    await b.client.next('ack');
    expect(server.db.prepare('SELECT user_id FROM push_subscriptions').all()).toEqual([{ user_id: `+38${p2}` }]);
    a.client.close();
    b.client.close();
  });
});

describe('notify', () => {
  it('надсилає на всі підписки, крім виключених пристроїв; 410 видаляє підписку', async () => {
    const { server, sender } = await withPush();
    const p = phone();
    const a = await connectUser(server, 'Анна', p, 'phone');
    const b = await connectUser(server, 'Анна', p, 'laptop');
    a.client.send({ type: 'push.subscribe', id: 's1', subscription: sub('https://fcm.googleapis.com/fcm/send/a') });
    b.client.send({ type: 'push.subscribe', id: 's2', subscription: sub('https://fcm.googleapis.com/fcm/send/b') });
    await a.client.next('ack');
    await b.client.next('ack');

    const payload: PushPayload = { type: 'call.ended', callId: 'c1' };
    await server.push.notify('demo', `+38${p}`, payload, { ttl: 30 }, new Set(['laptop']));
    expect(sender.sent.map(s => s.sub.deviceId)).toEqual(['phone']);

    sender.result = 'gone';
    await server.push.notify('demo', `+38${p}`, payload, { ttl: 30 });
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
    a.client.close();
    b.client.close();
  });
});
