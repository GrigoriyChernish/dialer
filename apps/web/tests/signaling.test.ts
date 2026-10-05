import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalingClient } from '@/shared/api/signaling';

/** Підробний сокет: кадри клієнта в `sent`, відповіді сервера через `receive`. */
class FakeSocket {
  readyState: number = WebSocket.CONNECTING;
  sent: { type: string; [k: string]: unknown }[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: (e: { code: number }) => void;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
  });
  open() {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }
  receive(m: object) {
    this.onmessage?.({ data: JSON.stringify({ v: 1, ...m }) });
  }
}

function setup(hidden?: boolean) {
  const sockets: FakeSocket[] = [];
  const client = new SignalingClient({
    url: 'ws://x/ws',
    deviceId: 'd1',
    getToken: () => 't',
    ...(hidden !== undefined && { getHidden: () => hidden }),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  });
  const status: boolean[] = [];
  client.onStatus(open => status.push(open));
  client.connect();
  const ready = (s = sockets.at(-1)!) => {
    s.open();
    s.receive({ type: 'hello.ok', reqId: s.sent[0]!.id });
  };
  ready();
  return { client, sockets, status, ready };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SignalingClient', () => {
  it('запит без відповіді завершується помилкою timeout', async () => {
    const { client } = setup();
    const p = client.request('call.invite', { to: 'x' });
    const failed = expect(p).rejects.toMatchObject({ code: 'timeout' });
    vi.advanceTimersByTime(10_000);
    await failed;
  });

  it('повернення на екран: живий сокет відповів на пінг — лишається', () => {
    const { client, sockets } = setup();
    client.reconnectNow();
    expect(sockets[0]!.sent.at(-1)).toMatchObject({ type: 'ping' });
    sockets[0]!.receive({ type: 'pong' });
    vi.advanceTimersByTime(5_000);
    expect(sockets).toHaveLength(1);
    expect(client.open).toBe(true);
  });

  it('сокет після заморожування мовчить: за 3 с кидаємо його й підключаємось наново', () => {
    const { client, sockets, status, ready } = setup();
    client.reconnectNow();
    client.reconnectNow(); // друга перевірка не дублює пінг
    expect(sockets[0]!.sent.filter(m => m.type === 'ping')).toHaveLength(1);
    vi.advanceTimersByTime(3_000);
    expect(sockets[0]!.close).toHaveBeenCalled();
    expect(sockets).toHaveLength(2);
    expect(status.at(-1)).toBe(false);

    sockets[0]!.onclose?.({ code: 1006 }); // запізніле закриття старого сокета нічого не ламає
    ready();
    expect(status.at(-1)).toBe(true);
    expect(client.open).toBe(true);
  });

  it('закритий сокет відкриваємо одразу', () => {
    const { client, sockets } = setup();
    sockets[0]!.readyState = WebSocket.CLOSED;
    client.reconnectNow();
    expect(sockets).toHaveLength(2);
  });

  it('hidden: передається в hello і кадром device.visibility', () => {
    const { client, sockets } = setup(true);
    expect(sockets[0]!.sent[0]).toMatchObject({ type: 'hello', hidden: true });
    client.setHidden(false);
    expect(sockets[0]!.sent.at(-1)).toMatchObject({ type: 'device.visibility', hidden: false });
    expect(setup().sockets[0]!.sent[0]).not.toHaveProperty('hidden'); // віджет не передає
  });
});
