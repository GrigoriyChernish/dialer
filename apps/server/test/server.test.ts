import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { connectUser, login, startServer, TestClient, type TestServer } from './helpers';

let server: TestServer;
beforeAll(async () => {
  server = await startServer({ hello: 300 });
});
afterAll(() => server.close());

describe('HTTP', () => {
  it('health', async () => {
    const res = await fetch(`${server.http}/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('демо-вхід нормалізує номер і повертає токен', async () => {
    const { status, body } = await login(server, '  Ірина ', '050 123 45 67');
    expect(status).toBe(200);
    expect(body.user).toEqual({ userId: '+380501234567', name: 'Ірина' });
    expect(typeof body.token).toBe('string');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it("відхиляє неправильні ім'я й номер", async () => {
    expect((await login(server, 'І', '0501234567')).body).toEqual({ error: 'invalid_name' });
    expect((await login(server, 'Ірина', '123')).body).toEqual({ error: 'invalid_phone' });
  });

  it("той самий номер оновлює ім'я", async () => {
    await login(server, 'Стара', '0670000001');
    const { body } = await login(server, 'Нова', '+380670000001');
    expect(body.user.name).toBe('Нова');
  });
});

describe('WebSocket: підключення', () => {
  it('hello.ok містить користувача, налаштування й контакти з ботами', async () => {
    const { client, hello } = await connectUser(server, 'Марія', '0931111111');
    expect(hello.user).toEqual({ userId: '+380931111111', name: 'Марія' });
    expect(hello.settings).toEqual({ waiting: true, dnd: false });
    expect(hello.calls).toEqual([]);
    expect(hello.reqId).toBe('h1');
    expect(hello.serverTime).toBeGreaterThan(0);
    const ids = hello.contacts.map(c => c.userId);
    expect(ids).toEqual(expect.arrayContaining(['bot:olena', 'bot:andriy', 'bot:support']));
    expect(ids).not.toContain('+380931111111');
    expect(hello.contacts.filter(c => c.userId.startsWith('bot:')).every(c => c.online)).toBe(true);
    client.close();
  });

  it('закриває з 4401, якщо hello не надійшов', async () => {
    const client = await TestClient.connect(server.ws);
    expect((await client.waitClosed()).code).toBe(4401);
  });

  it('закриває з 4401 на недійсний токен', async () => {
    const client = await TestClient.connect(server.ws);
    client.send({ type: 'hello', id: 'h1', token: 'сміття', deviceId: 'd1' });
    const err = await client.next('error');
    expect(err).toMatchObject({ code: 'token_invalid', reqId: 'h1' });
    expect((await client.waitClosed()).code).toBe(4401);
  });

  it('перший кадр не hello: помилка й закриття', async () => {
    const client = await TestClient.connect(server.ws);
    client.send({ type: 'ping' });
    expect((await client.next('error')).code).toBe('bad_request');
    expect((await client.waitClosed()).code).toBe(4401);
  });

  it('несумісна версія протоколу', async () => {
    const client = await TestClient.connect(server.ws);
    client.ws.send(JSON.stringify({ v: 99, type: 'hello', id: 'h1' }));
    expect((await client.next('error')).code).toBe('unsupported_version');
    expect((await client.waitClosed()).code).toBe(4426);
  });
});

describe('WebSocket: після hello', () => {
  it('ping → pong, невідомий тип → unknown_type, повтор id дає ту саму відповідь', async () => {
    const { client } = await connectUser(server, 'Петро', '0932222222');
    client.send({ type: 'ping' });
    await client.next('pong');

    client.send({ type: 'nope', id: 'r1' });
    const first = await client.next('error');
    expect(first).toMatchObject({ code: 'unknown_type', reqId: 'r1' });
    client.send({ type: 'nope', id: 'r1' });
    expect(await client.next('error')).toEqual(first);
    client.close();
  });

  it("некоректний JSON не рве з'єднання", async () => {
    const { client } = await connectUser(server, 'Оксана', '0933333333');
    client.ws.send('не json');
    expect((await client.next('error')).code).toBe('bad_request');
    client.send({ type: 'ping' });
    await client.next('pong');
    client.close();
  });

  it('повторний hello відхиляється', async () => {
    const { client, token } = await connectUser(server, 'Ігор', '0934444444');
    client.send({ type: 'hello', id: 'h2', token, deviceId: 'd1' });
    expect((await client.next('error')).code).toBe('bad_request');
    client.close();
  });

  it('auth.refresh приймає новий токен того ж користувача й відхиляє чужий', async () => {
    const { client } = await connectUser(server, 'Тарас', '0935555555');
    const fresh = (await login(server, 'Тарас', '0935555555')).body.token;
    client.send({ type: 'auth.refresh', id: 'a1', token: fresh });
    expect(await client.next('ack')).toMatchObject({ reqId: 'a1' });

    const other = (await login(server, 'Інший', '0936666666')).body.token;
    client.send({ type: 'auth.refresh', id: 'a2', token: other });
    expect((await client.next('error')).code).toBe('token_invalid');
    expect((await client.waitClosed()).code).toBe(4401);
  });
});

describe('присутність і контакти', () => {
  it('інші бачать вхід, підключення й відключення', async () => {
    const a = await connectUser(server, 'Аня', '0940000001');
    const b = await connectUser(server, 'Богдан', '0940000002');

    // Аня отримала presence про Богдана
    expect(await a.client.next('presence')).toEqual({ v: 1, type: 'presence', userId: '+380940000002', online: true });
    // Богдан бачить Аню в мережі
    expect(b.hello.contacts.find(c => c.userId === '+380940000001')?.online).toBe(true);

    b.client.close();
    expect(await a.client.next('presence')).toMatchObject({ userId: '+380940000002', online: false });
    a.client.close();
  });

  it('другий пристрій того ж користувача не дублює presence', async () => {
    const a = await connectUser(server, 'Вікторія', '0940000003');
    const b1 = await connectUser(server, 'Гліб', '0940000004', 'phone');
    await a.client.next('presence');
    const b2 = await connectUser(server, 'Гліб', '0940000004', 'laptop');
    b1.client.close();
    // Гліб ще в мережі через другий пристрій: даємо серверу обробити закриття першого
    await new Promise(resolve => setTimeout(resolve, 100));
    a.client.send({ type: 'ping' });
    await a.client.next('pong');
    expect(a.client.frames.filter(f => f.type === 'presence')).toEqual([]);
    b2.client.close();
    expect(await a.client.next('presence')).toMatchObject({ userId: '+380940000004', online: false });
    a.client.close();
  });

  it("новий демо-користувач з'являється в контактах підключених", async () => {
    const a = await connectUser(server, 'Дарина', '0940000005');
    await login(server, 'Едуард', '0940000006');
    const update = await a.client.next('contacts.update');
    expect(update.upsert).toEqual([{ userId: '+380940000006', name: 'Едуард', online: false }]);
    a.client.close();
  });
});

/** Рукостискання з заголовком `Origin`: `open` або HTTP-статус відмови. */
function handshake(url: string, origin?: string): Promise<number> {
  return new Promise(resolve => {
    const ws = new WebSocket(url, origin ? { headers: { origin } } : undefined);
    ws.once('open', () => {
      ws.close();
      resolve(101);
    });
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    ws.once('error', () => {});
  });
}

describe('WebSocket: Origin', () => {
  it('поза production приймає localhost і запити без Origin, чужий origin відхиляє з 403', async () => {
    expect(await handshake(server.ws)).toBe(101);
    expect(await handshake(server.ws, 'http://localhost:5173')).toBe(101);
    expect(await handshake(server.ws, 'https://evil.example')).toBe(403);
  });

  it('у production приймає лише DEMO_ORIGIN і allowed_origins сайтів', async () => {
    const prod = await startServer(undefined, {
      config: { production: true, demoOrigin: 'https://pages.example' },
    });
    try {
      expect(await handshake(prod.ws, 'https://pages.example')).toBe(101);
      expect(await handshake(prod.ws, 'http://localhost:5173')).toBe(403);
      expect(await handshake(prod.ws, 'https://host.example')).toBe(403);
      prod.db
        .prepare("UPDATE sites SET allowed_origins = ? WHERE id = 'demo'")
        .run(JSON.stringify(['https://host.example']));
      expect(await handshake(prod.ws, 'https://host.example')).toBe(101);
      expect(await handshake(prod.ws)).toBe(101); // не браузер: доступ дає токен
    } finally {
      await prod.close();
    }
  });
});
