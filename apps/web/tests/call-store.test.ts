import type { CallInfo, ServerMessage } from '@dialer/shared';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore, type CallDeps } from '@/features/call/store';

const V = 1 as const;
const olena = { userId: '+380501111111', name: 'Олена' };
const info = (p: Partial<CallInfo> = {}): CallInfo => ({ callId: 'c1', direction: 'out', peer: olena, state: 'ringing', expiresAt: Date.now() + 60_000, ...p });

function setup() {
  setActivePinia(createPinia());
  let handler: (m: ServerMessage) => void = () => {};
  const request = vi.fn(async (type: string): Promise<ServerMessage> => (type === 'call.invite' ? { v: V, type: 'ack', reqId: 'r', call: info() } : { v: V, type: 'ack', reqId: 'r' }));
  const deps: CallDeps = {
    client: { request, on: (f) => ((handler = f), () => {}), onStatus: () => () => {} },
    media: { join: vi.fn(async () => {}), leave: vi.fn(), setMic: vi.fn(), setDeaf: vi.fn() },
    sounds: { play: vi.fn() },
  };
  const store = useCallStore();
  store.init(deps);
  handler({ v: V, type: 'hello.ok', reqId: 'h', user: { userId: 'me', name: 'Я' }, serverTime: Date.now(), settings: { waiting: true, dnd: false }, calls: [], contacts: [{ ...olena, online: true }], recents: [] });
  return { store, deps, request, send: handler };
}

describe('call store', () => {
  beforeEach(() => vi.useRealTimers());

  it('loads contacts from hello.ok', () => {
    expect(setup().store.contacts).toHaveLength(1);
  });

  it('goes ringing only after the server ack', async () => {
    const { store, request } = setup();
    const p = store.call(olena.userId);
    expect(store.status).toBe('idle');
    await p;
    expect(request).toHaveBeenCalledWith('call.invite', { to: olena.userId, video: false });
    expect(store.status).toBe('ringing');
  });

  it('connects on call.connected and joins the LiveKit room', async () => {
    const { store, deps, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now(), livekit: { url: 'wss://x', token: 't' } }) });
    expect(store.status).toBe('connected');
    expect(deps.media.join).toHaveBeenCalledWith({ url: 'wss://x', token: 't' });
  });

  it('shows "busy" when the callee is busy', async () => {
    const { store, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.ended', callId: 'c1', reason: 'busy' });
    expect(store.status).toBe('idle');
    expect(store.missed?.reason).toBe('busy');
  });

  it('turns a cancelled incoming call into a missed one, but stays quiet when answered elsewhere', () => {
    const a = setup();
    a.send({ v: V, type: 'call.incoming', call: info({ direction: 'in' }) });
    expect(a.store.status).toBe('incoming');
    a.send({ v: V, type: 'call.ended', callId: 'c1', reason: 'cancelled' });
    expect(a.store.missed?.reason).toBe('incoming');

    const b = setup();
    b.send({ v: V, type: 'call.incoming', call: info({ direction: 'in' }) });
    b.send({ v: V, type: 'call.ended', callId: 'c1', reason: 'answered_elsewhere' });
    expect(b.store.missed).toBeNull();
  });

  it('rejects a second incoming call while busy', async () => {
    const { store, request, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.incoming', call: info({ callId: 'c2', direction: 'in' }) });
    expect(request).toHaveBeenCalledWith('call.reject', { callId: 'c2' });
    expect(store.callId).toBe('c1');
  });

  it('sends cancel / reject / hangup by state and resets locally', async () => {
    const { store, request } = setup();
    await store.call(olena.userId);
    store.end();
    expect(request).toHaveBeenCalledWith('call.cancel', { callId: 'c1' });
    expect(store.status).toBe('idle');
  });

  it('rolls hold back when the server refuses', async () => {
    const { store, request, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    request.mockRejectedValueOnce(new Error('call_ended'));
    store.toggleHold();
    expect(store.hold).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.hold).toBe(false);
  });
});
