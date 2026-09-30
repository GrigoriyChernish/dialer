import type { ServerMessage } from '@dialer/shared';
import { PROTOCOL_VERSION } from '@dialer/shared';
import { pino } from 'pino';
import WebSocket from 'ws';
import { loadConfig } from '../src/config';
import { createServer } from '../src/server';
import type { GatewayTimeouts } from '../src/ws/gateway';

export async function startServer(timeouts?: Partial<GatewayTimeouts>) {
  const config = { ...loadConfig({ JWT_SECRET: 's'.repeat(32) }), port: 0, host: '127.0.0.1', dbPath: ':memory:' };
  const server = await createServer({ config, logger: pino({ level: 'silent' }), timeouts });
  const port = await server.listen();
  return {
    ...server,
    http: `http://127.0.0.1:${port}`,
    ws: `ws://127.0.0.1:${port}/ws`,
  };
}

export type TestServer = Awaited<ReturnType<typeof startServer>>;

export async function login(server: TestServer, name: string, phone: string) {
  const res = await fetch(`${server.http}/demo/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, phone }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** Клієнт: черга отриманих кадрів і закриття. */
export class TestClient {
  readonly frames: ServerMessage[] = [];
  closed: { code: number } | null = null;
  private waiters: Array<() => void> = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.frames.push(JSON.parse(data.toString()));
      this.notify();
    });
    ws.on('close', (code) => {
      this.closed = { code };
      this.notify();
    });
  }

  static async connect(url: string) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    return new TestClient(ws);
  }

  private notify() {
    for (const w of this.waiters.splice(0)) w();
  }

  send(msg: Record<string, unknown>) {
    this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }));
  }

  /** Чекає, поки виконається умова над кадрами чи закриттям. */
  async until<T>(check: () => T | undefined | false, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() > deadline) throw new Error('timeout; кадри: ' + JSON.stringify(this.frames));
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    return this.until(() => this.frames.find((f) => f.type === type) as any).then((f) => {
      this.frames.splice(this.frames.indexOf(f), 1);
      return f;
    });
  }

  waitClosed(): Promise<{ code: number }> {
    return this.until(() => this.closed ?? undefined);
  }

  close() {
    this.ws.close();
  }
}

/** Вхід і підключення: повертає клієнта після `hello.ok`. */
export async function connectUser(server: TestServer, name: string, phone: string, deviceId = 'd1') {
  const { body } = await login(server, name, phone);
  const client = await TestClient.connect(server.ws);
  client.send({ type: 'hello', id: 'h1', token: body.token, deviceId });
  const hello = await client.next('hello.ok');
  return { client, hello, token: body.token as string };
}
