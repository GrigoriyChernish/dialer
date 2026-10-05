import { generateKeyPairSync } from 'node:crypto';
import type { PushPayload } from '@dialer/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushSub } from '../src/db/push';
import { loadConfig } from '../src/config';
import { createFcmSender, fcmData, parseFcmToken } from '../src/push/fcm';
import type { PushResult, PushSender } from '../src/push/sender';
import { connectUser, startServer, type TestServer } from './helpers';

const incoming: PushPayload = {
  type: 'call.incoming',
  callId: 'c1',
  from: { userId: '+380500000001', name: 'Анна' },
  expiresAt: 1700000000000,
  rejectToken: 'tok',
};

describe('FCM', () => {
  it('сплющує payload у рядкові поля data', () => {
    expect(fcmData(incoming)).toEqual({
      type: 'call.incoming',
      callId: 'c1',
      fromUserId: '+380500000001',
      fromName: 'Анна',
      expiresAt: '1700000000000',
      rejectToken: 'tok',
    });
    expect(fcmData({ type: 'call.ended', callId: 'c1' })).toEqual({ type: 'call.ended', callId: 'c1' });
    expect(fcmData({ type: 'call.ended', callId: 'c1', missed: true, from: incoming.from })).toMatchObject({
      missed: '1',
      fromName: 'Анна',
    });
  });

  it('приймає лише розумні токени', () => {
    expect(parseFcmToken('abc:APA91b-_x.y')).toBe('abc:APA91b-_x.y');
    for (const bad of ['', 'з пробілом', 'a'.repeat(5000), 42, undefined]) expect(parseFcmToken(bad)).toBeNull();
  });

  it('відправник: токен доступу один раз, high-пріоритет і ttl; 404 це gone', async () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      if (String(url).includes('oauth2')) return Response.json({ access_token: 'at', expires_in: 3600 });
      return new Response('{}', { status });
    });
    const sender = createFcmSender(
      { project_id: 'proj', client_email: 'sa@proj.iam.gserviceaccount.com', private_key: privateKey },
      { fetch: fetchFn as unknown as typeof fetch, now: () => 1_700_000_000_000 },
    );
    const sub = { endpoint: 'fcm:device-token' } as PushSub;

    expect(await sender.send(sub, incoming, { ttl: 60, urgency: 'high' })).toBe('ok');
    expect(await sender.send(sub, incoming, { ttl: 60, urgency: 'high' })).toBe('ok');
    expect(calls.filter(c => c.url.includes('oauth2'))).toHaveLength(1);
    const send = calls.filter(c => c.url.includes('messages:send'))[0]!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/proj/messages:send');
    expect((send.init.headers as Record<string, string>).authorization).toBe('Bearer at');
    expect(JSON.parse(String(send.init.body)).message).toMatchObject({
      token: 'device-token',
      android: { priority: 'HIGH', ttl: '60s' },
      data: { type: 'call.incoming', callId: 'c1' },
    });

    status = 404;
    expect(await sender.send(sub, incoming, { ttl: 60 })).toBe('gone');
    status = 500;
    expect(await sender.send(sub, incoming, { ttl: 60 })).toBe('error');
  });
});

class FakeSender implements PushSender {
  sent: { sub: PushSub; payload: PushPayload }[] = [];
  result: PushResult = 'ok';
  async send(sub: PushSub, payload: PushPayload) {
    this.sent.push({ sub, payload });
    return this.result;
  }
}

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('push.subscribe з fcmToken', () => {
  it('без FCM на сервері відхиляє, з FCM зберігає токен і шле на нього', async () => {
    server = await startServer();
    const off = await connectUser(server, 'Анна', '0970000001');
    off.client.send({ type: 'push.subscribe', id: 's0', fcmToken: 'tok-1' });
    expect((await off.client.next('error')).code).toBe('bad_request');
    off.client.close();
    await server.close();

    const fcm = new FakeSender();
    server = await startServer(undefined, { fcmSender: fcm });
    const a = await connectUser(server, 'Анна', '0970000002', 'phone');
    a.client.send({ type: 'push.subscribe', id: 's1', fcmToken: 'tok-1' });
    expect(await a.client.next('ack')).toMatchObject({ reqId: 's1' });
    expect(server.db.prepare('SELECT endpoint FROM push_subscriptions').all()).toEqual([{ endpoint: 'fcm:tok-1' }]);
    expect(server.push.hasSubscriptions('demo', '+380970000002')).toBe(true);

    await server.push.notify('demo', '+380970000002', { type: 'call.ended', callId: 'c9' }, { ttl: 30 });
    expect(fcm.sent.map(s => s.sub.endpoint)).toEqual(['fcm:tok-1']);

    fcm.result = 'gone';
    await server.push.notify('demo', '+380970000002', { type: 'call.ended', callId: 'c9' }, { ttl: 30 });
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
    a.client.close();
  });
});

describe('конфігурація FCM', () => {
  it('ключ можна задати файлом чи вмістом (секрет Fly.io); без них FCM вимкнено', () => {
    const base = { JWT_SECRET: 's'.repeat(32) };
    expect(loadConfig(base)).toMatchObject({ fcmServiceAccountFile: null, fcmServiceAccountJson: null });
    expect(loadConfig({ ...base, FCM_SERVICE_ACCOUNT_FILE: '/k.json' }).fcmServiceAccountFile).toBe('/k.json');
    expect(loadConfig({ ...base, FCM_SERVICE_ACCOUNT_JSON: '{"a":1}' }).fcmServiceAccountJson).toBe('{"a":1}');
  });
});
