import type { CallInfo, ServerMessage } from '@dialer/shared';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore, type CallDeps } from '@/features/call/store';
import type { LinkState } from '@/shared/media/room';

const V = 1 as const;
const olena = { userId: '+380501111111', name: 'Олена' };
const info = (p: Partial<CallInfo> = {}): CallInfo => ({ callId: 'c1', direction: 'out', peer: olena, state: 'ringing', expiresAt: Date.now() + 60_000, ...p });

function setup() {
  setActivePinia(createPinia());
  let handler: (m: ServerMessage) => void = () => {};
  let onLink: (p: Partial<LinkState>) => void = () => {};
  const request = vi.fn(async (type: string): Promise<ServerMessage> => (type === 'call.invite' ? { v: V, type: 'ack', reqId: 'r', call: info() } : { v: V, type: 'ack', reqId: 'r' }));
  const deps: CallDeps = {
    client: { request, on: (f) => ((handler = f), () => {}), onStatus: () => () => {} },
    media: { join: vi.fn(async () => {}), leave: vi.fn(), setMic: vi.fn(), setDeaf: vi.fn(), setCamera: vi.fn(), attach: vi.fn(), hasCamera: vi.fn(async () => true), hasMicrophone: vi.fn(async () => true), onChange: (f) => (onLink = f) },
    sounds: { play: vi.fn() },
  };
  const store = useCallStore();
  store.init(deps);
  handler({ v: V, type: 'hello.ok', reqId: 'h', user: { userId: 'me', name: 'Я' }, serverTime: Date.now(), settings: { waiting: true, dnd: false }, calls: [], contacts: [{ ...olena, online: true }], recents: [] });
  return { store, deps, request, send: handler, link: (p: Partial<LinkState>) => onLink(p) };
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
    expect(request).toHaveBeenCalledWith('call.invite', { to: olena.userId, video: true });
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

  it('starts the call with the camera on and toggles it through the media layer', async () => {
    const { store, deps, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    expect(store.cam).toBe(true);
    expect(deps.media.setCamera).toHaveBeenLastCalledWith(true);
    store.toggleCam();
    expect(store.cam).toBe(false);
    expect(deps.media.setCamera).toHaveBeenLastCalledWith(false);
  });

  it('turns the camera button off when the camera cannot be started', async () => {
    const { store, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    link({ camError: true, localCam: false });
    expect(store.cam).toBe(false);
  });

  it('tracks the peer camera and resets link state when the call ends', async () => {
    const { store, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    link({ peerCam: true });
    expect(store.link.peerCam).toBe(true);
    store.end();
    expect(store.link.peerCam).toBe(false);
    expect(store.selfHidden).toBe(false);
  });

  it('blocks the camera (no preview, button disabled) when the camera cannot be started', async () => {
    const { store, deps, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    expect(store.camBlocked).toBe(false);
    link({ camError: true });
    expect(store.camBlocked).toBe(true);
    expect(store.cam).toBe(false);
    store.toggleCam();
    expect(store.cam).toBe(false);
    expect(deps.media.setCamera).toHaveBeenLastCalledWith(false);
  });

  it('blocks the camera right away when the device has none', async () => {
    const { store, deps, send } = setup();
    vi.mocked(deps.media.hasCamera!).mockResolvedValueOnce(false);
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.camBlocked).toBe(true);
  });

  it('forgets the camera block between calls', async () => {
    const { store, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    link({ camError: true });
    store.end();
    expect(store.camBlocked).toBe(false);
  });

  it('shows the "camera unavailable" hint for a few seconds when the blocked camera button is pressed', async () => {
    vi.useFakeTimers();
    const { store, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    link({ camError: true });
    expect(store.hint).toBeNull();
    store.toggleCam();
    expect(store.hint).toBe('cam');
    vi.advanceTimersByTime(3100);
    expect(store.hint).toBeNull();
    vi.useRealTimers();
  });

  it('blocks the microphone when it cannot be started and hints on press', async () => {
    vi.useFakeTimers();
    const { store, deps, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    link({ micError: true });
    expect(store.micBlocked).toBe(true);
    expect(store.mic).toBe(false);
    expect(deps.media.setMic).toHaveBeenLastCalledWith(false);
    store.toggleMic();
    expect(store.mic).toBe(false);
    expect(store.hint).toBe('mic');
    vi.advanceTimersByTime(3100);
    expect(store.hint).toBeNull();
    vi.useRealTimers();
  });

  it('blocks the microphone right away when the device has none', async () => {
    const { store, deps, send } = setup();
    vi.mocked(deps.media.hasMicrophone!).mockResolvedValueOnce(false);
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.micBlocked).toBe(true);
  });
});
