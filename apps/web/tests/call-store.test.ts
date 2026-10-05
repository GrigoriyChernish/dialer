import type { CallInfo, ServerMessage } from '@dialer/shared';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore, type CallDeps } from '@/features/call/store';
import { usePrefsStore } from '@/features/settings/prefs';
import type { LinkState } from '@/shared/media/room';

const V = 1 as const;
const olena = { userId: '+380501111111', name: 'Олена' };
const info = (p: Partial<CallInfo> = {}): CallInfo => ({
  callId: 'c1',
  direction: 'out',
  peer: olena,
  state: 'ringing',
  expiresAt: Date.now() + 60_000,
  ...p,
});

function setup(opts: { seen?: number } = {}) {
  localStorage.clear(); // локальні налаштування (usePrefsStore) не переходять між тестами
  if (opts.seen) localStorage.setItem('dialer.missedSeen', String(opts.seen));
  setActivePinia(createPinia());
  let handler: (m: ServerMessage) => void = () => {};
  let onLink: (p: Partial<LinkState>) => void = () => {};
  let onPerm: (r: { micDenied: boolean; camDenied: boolean }) => void = () => {};
  const request = vi.fn(async (type: string): Promise<ServerMessage> =>
    type === 'call.invite' ? { v: V, type: 'ack', reqId: 'r', call: info() } : { v: V, type: 'ack', reqId: 'r' },
  );
  const deps: CallDeps = {
    client: { request, on: f => ((handler = f), () => {}), onStatus: () => () => {} },
    media: {
      join: vi.fn(async () => {}),
      leave: vi.fn(),
      setMic: vi.fn(),
      setDeaf: vi.fn(),
      setCamera: vi.fn(),
      attach: vi.fn(),
      hasCamera: vi.fn(async () => true),
      hasMicrophone: vi.fn(async () => true),
      onChange: f => (onLink = f),
      park: vi.fn(),
      swap: vi.fn(() => true),
      dropParked: vi.fn(),
      requestPermissions: vi.fn(async () => ({ audio: true, video: true })),
      watchPermissions: f => ((onPerm = f), () => {}),
    },
    sounds: { play: vi.fn() },
  };
  const store = useCallStore();
  store.init(deps);
  handler({
    v: V,
    type: 'hello.ok',
    reqId: 'h',
    user: { userId: 'me', name: 'Я' },
    serverTime: Date.now(),
    settings: { waiting: true, dnd: false },
    calls: [],
    contacts: [{ ...olena, status: 'free' }],
    recents: [],
    recentsSeenUpTo: 0,
  });
  return {
    store,
    deps,
    request,
    send: handler,
    link: (p: Partial<LinkState>) => onLink(p),
    perm: (r: { micDenied: boolean; camDenied: boolean }) => onPerm(r),
  };
}

describe('call store', () => {
  beforeEach(() => vi.useRealTimers());

  it('lists audio choices only for sections with something to choose and falls back when the pick disappears', async () => {
    const { store, deps } = setup();
    const dev = (id: string) => ({ id, label: id });
    let list = {
      canPickOutput: true,
      outputs: [dev('default'), dev('bt')],
      inputs: [dev('default')],
      cameras: [dev('a')],
    };
    deps.media.audioDevices = vi.fn(async () => list);
    deps.media.pickAudio = vi.fn(async () => {});
    deps.media.onDevicesChange = undefined;
    await store.call(olena.userId);
    expect(store.canPickAudio).toBe(false);
    store.audioDevices = list;
    expect(store.audioChoices.outputs).toHaveLength(2);
    expect(store.audioChoices.inputs).toHaveLength(0);
    expect(store.canPickAudio).toBe(true);
    await store.pickAudio('output', 'bt');
    expect(deps.media.pickAudio).toHaveBeenLastCalledWith('output', 'bt');
    list = { ...list, outputs: [dev('default')] }; // навушники відключили
    store.audioDevices = list;
    expect(store.canPickAudio).toBe(false);
    expect(store.canSwitchCamera).toBe(false);
    store.audioDevices = { ...list, cameras: [dev('a'), dev('b')] };
    expect(store.canSwitchCamera).toBe(true);
  });

  it('loads contacts from hello.ok', () => {
    expect(setup().store.contacts).toHaveLength(1);
  });

  it('presence updates the contact status', () => {
    const { store, send } = setup();
    send({ v: V, type: 'presence', userId: olena.userId, status: 'dnd' });
    expect(store.contacts[0]!.status).toBe('dnd');
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
    send({
      v: V,
      type: 'call.connected',
      call: info({ state: 'connected', startedAt: Date.now(), livekit: { url: 'wss://x', token: 't' } }),
    });
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

  it('mutes and pauses media with setDeaf when placed on hold or peer hold', async () => {
    const { store, deps, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    expect(deps.media.setDeaf).toHaveBeenLastCalledWith(false);

    // Співрозмовник ставить нас на утримання
    send({ v: V, type: 'call.peer', callId: 'c1', hold: true });
    expect(store.peerHold).toBe(true);
    expect(deps.media.setDeaf).toHaveBeenLastCalledWith(true);

    // Співрозмовник повертає з утримання
    send({ v: V, type: 'call.peer', callId: 'c1', hold: false });
    expect(store.peerHold).toBe(false);
    expect(deps.media.setDeaf).toHaveBeenLastCalledWith(false);

    // Ми ставимо на утримання
    store.toggleHold();
    expect(deps.media.setDeaf).toHaveBeenLastCalledWith(true);
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

  it('shows the peer state that started last and falls back to the earlier one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    const { store, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    expect(store.peerState).toBeNull();
    link({ peerMuted: true });
    expect(store.peerState).toBe('mic');
    vi.setSystemTime(new Date('2026-10-02T10:00:05Z'));
    send({ v: V, type: 'call.peer', callId: 'c1', hold: true });
    expect(store.peerState).toBe('hold');
    vi.setSystemTime(new Date('2026-10-02T10:00:09Z'));
    link({ peerAway: true });
    expect(store.peerState).toBe('lost');
    link({ peerAway: false });
    expect(store.peerState).toBe('hold');
    send({ v: V, type: 'call.peer', callId: 'c1', hold: false });
    expect(store.peerState).toBe('mic');
    store.end();
    expect(store.peerState).toBeNull();
    vi.useRealTimers();
  });

  it('does not report «mic off» while either side holds the call (the hold itself mutes the microphone)', async () => {
    const { store, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    store.toggleHold(); // ми тримаємо, клієнт співрозмовника глушить мікрофон
    link({ peerMuted: true });
    expect(store.peerState).toBeNull();
    store.toggleHold();
    link({ peerMuted: false });
    send({ v: V, type: 'call.peer', callId: 'c1', hold: true });
    link({ peerMuted: true });
    expect(store.peerState).toBe('hold');
    send({ v: V, type: 'call.peer', callId: 'c1', hold: false });
    link({ peerMuted: false });
    expect(store.peerState).toBeNull();
  });

  it('keeps the voice indicator for 250 ms after the peer stops speaking and clears it with the call', async () => {
    vi.useFakeTimers();
    const { store, send, link } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    link({ peerSpeaking: true });
    expect(store.peerSpeaking).toBe(true);
    link({ peerSpeaking: false });
    expect(store.peerSpeaking).toBe(true);
    vi.advanceTimersByTime(300);
    expect(store.peerSpeaking).toBe(false);
    link({ peerSpeaking: true });
    store.end();
    vi.advanceTimersByTime(300);
    expect(store.peerSpeaking).toBe(false);
    vi.useRealTimers();
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
    vi.advanceTimersByTime(4100);
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
    vi.advanceTimersByTime(4100);
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

  it('shows the call result when the peer hangs up, and closes it after 10 s', async () => {
    const { store, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    vi.useFakeTimers();
    send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup', duration: 222 });
    expect(store.missed).toMatchObject({ reason: 'ended', duration: 222 });
    vi.advanceTimersByTime(9999);
    expect(store.missed).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.missed).toBeNull();
  });

  it('replaces the ended screen with a new incoming call, and its timer does not touch the new call', async () => {
    const { store, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    vi.useFakeTimers();
    send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup', duration: 60 });
    vi.advanceTimersByTime(2000);
    send({ v: V, type: 'call.incoming', call: info({ callId: 'c2', direction: 'in' }) });
    expect(store.status).toBe('incoming');
    expect(store.missed).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(store.status).toBe('incoming');
    send({ v: V, type: 'call.ended', callId: 'c2', reason: 'cancelled' });
    expect(store.missed?.reason).toBe('incoming');
    vi.advanceTimersByTime(60_000);
    expect(store.missed?.reason).toBe('incoming'); // пропущений дзвінок сам не зникає
  });

  it('drops the ended screen when we start a new call', async () => {
    const { store, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    vi.useFakeTimers();
    send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup', duration: 60 });
    await store.call(olena.userId);
    expect(store.missed).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(store.status).toBe('ringing');
  });

  it('keeps lost and failed calls on screen, but shows nothing after our own hangup', async () => {
    for (const [reason, shown] of [
      ['lost', 'lost'],
      ['error', 'dropped'],
    ] as const) {
      const { store, send } = setup();
      await store.call(olena.userId);
      send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
      send({ v: V, type: 'call.ended', callId: 'c1', reason });
      expect(store.missed?.reason).toBe(shown);
    }
    const { store, send } = setup();
    await store.call(olena.userId);
    send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    store.end();
    send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup' });
    expect(store.missed).toBeNull();
  });

  it('counts unseen missed calls from recents and resets the count when seen', () => {
    localStorage.clear();
    const { store, send } = setup();
    const entry = (callId: string, p: object = {}) => ({
      callId,
      peer: olena.userId,
      direction: 'in' as const,
      result: 'missed' as const,
      startedAt: Date.now(),
      ...p,
    });
    send({ v: V, type: 'recents.add', entry: entry('m1') });
    send({ v: V, type: 'recents.add', entry: entry('m2', { silent: true }) });
    send({ v: V, type: 'recents.add', entry: entry('c3', { result: 'completed' }) });
    expect(store.missedCalls).toHaveLength(2);
    expect(store.unseenMissed).toBe(1);
    store.markMissedSeen();
    expect(store.unseenMissed).toBe(0);
  });

  it('syncs the viewed time: sends recents.seen, and another device or hello.ok resets the counter', () => {
    const { store, send, request } = setup();
    const t = Date.now();
    const missed = (callId: string, startedAt: number) => ({
      v: V,
      type: 'recents.add' as const,
      entry: { callId, peer: olena.userId, direction: 'in' as const, result: 'missed' as const, startedAt },
    });
    send(missed('m1', t));
    send(missed('m2', t + 1));
    expect(store.unseenMissed).toBe(2);
    store.markMissedSeen();
    expect(request).toHaveBeenCalledWith('recents.seen', { upTo: t + 1 });
    request.mockClear();
    store.markMissedSeen(); // нічого нового: на сервер не йдемо
    expect(request).not.toHaveBeenCalled();

    send(missed('m3', t + 5));
    expect(store.unseenMissed).toBe(1);
    send({ v: V, type: 'recents.seen', upTo: t + 5 }); // переглянули на іншому пристрої
    expect(store.unseenMissed).toBe(0);
  });

  it('takes the viewed time from hello.ok and gives the server a newer local one', () => {
    const { store, send, request } = setup({ seen: 500 });
    expect(request).toHaveBeenCalledWith('recents.seen', { upTo: 500 }); // сервер знає 0
    request.mockClear();
    send({
      v: V,
      type: 'hello.ok',
      reqId: 'h2',
      user: { userId: 'me', name: 'Я' },
      serverTime: Date.now(),
      settings: { waiting: true, dnd: false },
      calls: [],
      contacts: [],
      recents: [{ callId: 'a', peer: olena.userId, direction: 'in', result: 'missed', startedAt: 800 }],
      recentsSeenUpTo: 900,
    });
    expect(store.unseenMissed).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  describe('minimized call', () => {
    const connect = async (ctx: ReturnType<typeof setup>) => {
      await ctx.store.call(olena.userId);
      ctx.send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
    };

    it('minimizes only an active call, turns the camera off meanwhile and brings it back on restore', async () => {
      const ctx = setup();
      ctx.store.minimize();
      expect(ctx.store.minimized).toBe(false); // розмови ще нема

      await ctx.store.call(olena.userId);
      ctx.store.minimize();
      expect(ctx.store.minimized).toBe(false); // дзвонимо, не розмова

      ctx.send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
      ctx.store.minimize();
      expect(ctx.store.minimized).toBe(true);
      expect(ctx.deps.media.setCamera).toHaveBeenLastCalledWith(false);
      expect(ctx.store.status).toBe('connected'); // розмова триває

      ctx.store.restoreCall();
      expect(ctx.store.minimized).toBe(false);
      expect(ctx.deps.media.setCamera).toHaveBeenLastCalledWith(ctx.store.cam);
    });

    it('brings the call screen back when a second call comes in, and when the call ends', async () => {
      const ctx = setup();
      await connect(ctx);
      ctx.store.minimize();
      ctx.send({ v: V, type: 'call.incoming', call: info({ callId: 'c2', direction: 'in', waiting: true }) });
      expect(ctx.store.waiting?.callId).toBe('c2');
      expect(ctx.store.minimized).toBe(false);

      ctx.store.minimize(); // з очікуванням згортати не можна
      expect(ctx.store.minimized).toBe(false);

      const other = setup();
      await connect(other);
      other.store.minimize();
      other.send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup', duration: 5 });
      expect(other.store.minimized).toBe(false);
      expect(other.store.missed).toMatchObject({ reason: 'ended' });
    });
  });

  it('is busy while on a call', async () => {
    const { store } = setup();
    expect(store.busySelf).toBe(false);
    await store.call(olena.userId);
    expect(store.busySelf).toBe(true);
  });

  describe('second incoming call (waiting)', () => {
    const andriy = { userId: '+380502222222', name: 'Андрій' };
    const lk = (token: string) => ({ url: 'wss://x', token });
    /** Розмова з Оленою (c1) і другий вхідний від Андрія (c2). */
    async function talking() {
      const t = setup();
      await t.store.call(olena.userId);
      t.send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: 1, livekit: lk('t1') }) });
      t.send({
        v: V,
        type: 'call.incoming',
        call: info({ callId: 'c2', direction: 'in', peer: andriy, waiting: true }),
      });
      return t;
    }
    const connectC2 = (t: Awaited<ReturnType<typeof talking>>) =>
      t.send({
        v: V,
        type: 'call.connected',
        call: info({
          callId: 'c2',
          direction: 'in',
          peer: andriy,
          state: 'connected',
          startedAt: 2,
          livekit: lk('t2'),
        }),
      });

    it('rings quietly over the call instead of rejecting it', async () => {
      const { store, request, deps } = await talking();
      expect(store.waiting?.callId).toBe('c2');
      expect(store.callId).toBe('c1');
      expect(request).not.toHaveBeenCalledWith('call.reject', expect.anything());
      expect(deps.sounds.play).toHaveBeenLastCalledWith('waiting', undefined);
    });

    it('holds the first call and takes the second one', async () => {
      const t = await talking();
      vi.mocked(t.deps.media.leave).mockClear();
      t.store.acceptWaiting('hold');
      expect(t.request).toHaveBeenCalledWith('call.accept', { callId: 'c2', action: 'hold' });
      t.send({ v: V, type: 'call.updated', callId: 'c1', hold: true });
      connectC2(t);
      expect(t.store.waiting).toBeNull();
      expect(t.store.callId).toBe('c2');
      expect(t.store.hold).toBe(false);
      expect(t.store.held?.callId).toBe('c1');
      expect(t.deps.media.park).toHaveBeenCalled();
      expect(t.deps.media.leave).not.toHaveBeenCalled();
      expect(t.deps.media.join).toHaveBeenLastCalledWith(lk('t2'));
    });

    it('ends the first call without a result screen, whichever event comes first', async () => {
      for (const endedFirst of [true, false]) {
        const t = await talking();
        t.store.acceptWaiting('end');
        await Promise.resolve();
        expect(t.request).toHaveBeenCalledWith('call.accept', { callId: 'c2', action: 'end' });
        const ended = () => t.send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup' });
        if (endedFirst) ended();
        connectC2(t);
        if (!endedFirst) ended();
        expect(t.store.callId).toBe('c2');
        expect(t.store.status).toBe('connected');
        expect(t.store.missed).toBeNull();
        expect(t.store.held).toBeNull();
      }
    });

    it('declines the second call and keeps talking', async () => {
      const { store, request, deps } = await talking();
      store.rejectWaiting();
      expect(request).toHaveBeenCalledWith('call.reject', { callId: 'c2' });
      expect(store.waiting).toBeNull();
      expect(store.callId).toBe('c1');
      expect(deps.sounds.play).toHaveBeenLastCalledWith(null, undefined);
    });

    it('stops ringing when the caller gives up', async () => {
      const { store, send } = await talking();
      send({ v: V, type: 'call.ended', callId: 'c2', reason: 'timeout' });
      expect(store.waiting).toBeNull();
      expect(store.missed).toBeNull();
      expect(store.callId).toBe('c1');
    });

    it('switches between the active and the held call', async () => {
      const t = await talking();
      t.store.acceptWaiting('hold');
      connectC2(t);
      t.store.swapHeld();
      expect(t.request).toHaveBeenCalledWith('call.hold', { callId: 'c1', hold: false });
      expect(t.deps.media.swap).toHaveBeenCalled();
      expect(t.store.callId).toBe('c1');
      expect(t.store.peer?.name).toBe('Олена');
      expect(t.store.hold).toBe(false);
      expect(t.store.held?.callId).toBe('c2');
    });

    it('brings the held call back on hold when the active one ends', async () => {
      const t = await talking();
      t.store.acceptWaiting('hold');
      connectC2(t);
      t.send({ v: V, type: 'call.ended', callId: 'c2', reason: 'hangup' });
      expect(t.store.callId).toBe('c1');
      expect(t.store.status).toBe('connected');
      expect(t.store.hold).toBe(true);
      expect(t.store.held).toBeNull();
      expect(t.store.missed).toBeNull();
    });

    it('forgets the held call when its peer hangs up', async () => {
      const t = await talking();
      t.store.acceptWaiting('hold');
      connectC2(t);
      t.send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup' });
      expect(t.store.held).toBeNull();
      expect(t.deps.media.dropParked).toHaveBeenCalled();
      expect(t.store.callId).toBe('c2');
      expect(t.store.missed).toBeNull();
    });

    it('turns into a normal incoming call when the first call ends first', async () => {
      const { store, send } = await talking();
      send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup' });
      send({ v: V, type: 'call.updated', callId: 'c2', waiting: false });
      expect(store.waiting).toBeNull();
      expect(store.status).toBe('incoming');
      expect(store.callId).toBe('c2');
    });

    it('turns into a normal incoming call even when the update comes before the end', async () => {
      const { store, send } = await talking();
      send({ v: V, type: 'call.updated', callId: 'c2', waiting: false });
      expect(store.waiting?.callId).toBe('c2');
      send({ v: V, type: 'call.ended', callId: 'c1', reason: 'hangup' });
      expect(store.waiting).toBeNull();
      expect(store.status).toBe('incoming');
      expect(store.callId).toBe('c2');
    });

    it('restores both calls after a reload', () => {
      const { store, send } = setup();
      send({
        v: V,
        type: 'hello.ok',
        reqId: 'h2',
        user: { userId: 'me', name: 'Я' },
        serverTime: Date.now(),
        settings: { waiting: true, dnd: false },
        contacts: [],
        recents: [],
        recentsSeenUpTo: 0,
        calls: [
          info({ state: 'connected', hold: true, startedAt: 1 }),
          info({ callId: 'c2', direction: 'in', peer: andriy, state: 'connected', startedAt: 2 }),
        ],
      });
      expect(store.callId).toBe('c2');
      expect(store.held?.callId).toBe('c1');
    });
  });

  describe('settings', () => {
    it('updates server settings optimistically and rolls back on error', async () => {
      const { store, request } = setup();
      request.mockImplementationOnce(async () => ({
        v: V,
        type: 'ack',
        reqId: 'r',
        settings: { waiting: true, dnd: true },
      }));
      const p = store.updateSettings({ dnd: true });
      expect(store.settings.dnd).toBe(true);
      expect(store.presence).toBe('dnd');
      await p;
      expect(request).toHaveBeenCalledWith('settings.update', { settings: { dnd: true } });
      request.mockRejectedValueOnce(new Error('bad_request'));
      await store.updateSettings({ waiting: false });
      expect(store.settings.waiting).toBe(true);
    });

    it('applies settings and the new name from other devices', () => {
      const { store, send } = setup();
      send({ v: V, type: 'settings.updated', settings: { waiting: false, dnd: true } });
      send({ v: V, type: 'profile.updated', user: { userId: 'me', name: 'Нове' } });
      expect(store.settings).toEqual({ waiting: false, dnd: true });
      expect(store.me?.name).toBe('Нове');
    });

    it('renames through profile.update', async () => {
      const { store, request } = setup();
      request.mockImplementationOnce(async () => ({
        v: V,
        type: 'ack',
        reqId: 'r',
        user: { userId: 'me', name: 'Ярема' },
      }));
      await store.rename('Ярема');
      expect(request).toHaveBeenCalledWith('profile.update', { name: 'Ярема' });
      expect(store.me?.name).toBe('Ярема');
    });

    it('shows "busy" over "do not disturb" while on a call', async () => {
      const { store, send } = setup();
      send({ v: V, type: 'settings.updated', settings: { waiting: true, dnd: true } });
      await store.call(olena.userId);
      expect(store.presence).toBe('busy');
    });

    it('keeps the ringtone silent and starts with the camera off when chosen on this device', () => {
      const t = setup();
      const prefs = usePrefsStore();
      prefs.ringtone = false;
      prefs.camOnStart = false;
      t.send({ v: V, type: 'call.incoming', call: info({ callId: 'c9', direction: 'in' }) });
      expect(t.deps.sounds.play).toHaveBeenLastCalledWith(null, undefined);
      t.send({ v: V, type: 'call.connected', call: info({ callId: 'c9', direction: 'in', state: 'connected' }) });
      expect(t.store.cam).toBe(false);
      expect(t.deps.media.setCamera).toHaveBeenLastCalledWith(false);
    });
  });

  describe('media permissions', () => {
    it('asks once per page and before the first invite', async () => {
      const { store, deps, request } = setup();
      const order: string[] = [];
      (deps.media.requestPermissions as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push('permissions');
        return { audio: true, video: true };
      });
      request.mockImplementation(async (type: string) => {
        order.push(type);
        return { v: V, type: 'ack', reqId: 'r', call: info() } as ServerMessage;
      });
      await store.call(olena.userId);
      expect(order).toEqual(['permissions', 'call.invite']);
      await store.requestPermissions();
      expect(deps.media.requestPermissions).toHaveBeenCalledTimes(1);
    });

    it('does not delay the answer on an incoming call', () => {
      const { store, deps, request, send } = setup();
      send({ v: V, type: 'call.incoming', call: info({ callId: 'c2', direction: 'in' }) });
      store.accept();
      expect(request).toHaveBeenCalledWith('call.accept', { callId: 'c2' });
      expect(deps.media.requestPermissions).toHaveBeenCalledTimes(1);
    });

    it('sends a single accept for a double tap and ignores accept outside an incoming call', () => {
      const { store, request, send } = setup();
      store.accept();
      expect(request).not.toHaveBeenCalled();
      send({ v: V, type: 'call.incoming', call: info({ callId: 'c2', direction: 'in' }) });
      store.accept();
      store.accept();
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('blocks a device when the permission is revoked and unblocks it when it is granted again', () => {
      const { store, perm } = setup();
      perm({ micDenied: true, camDenied: true });
      expect(store.micBlocked).toBe(true);
      expect(store.camBlocked).toBe(true);
      perm({ micDenied: false, camDenied: true });
      expect(store.micBlocked).toBe(false);
      expect(store.camBlocked).toBe(true);
      perm({ micDenied: false, camDenied: false });
      expect(store.camBlocked).toBe(false);
    });

    it('does not unblock a camera that is missing for another reason', async () => {
      const { store, link, perm } = setup();
      link({ camError: true });
      expect(store.camBlocked).toBe(true);
      perm({ micDenied: false, camDenied: false });
      expect(store.camBlocked).toBe(true);
    });

    it('keeps the microphone off while the peer is on hold, even after we resume', async () => {
      const { store, deps, send } = setup();
      await store.call(olena.userId);
      send({ v: V, type: 'call.connected', call: info({ state: 'connected', startedAt: Date.now() }) });
      store.toggleHold();
      send({ v: V, type: 'call.peer', callId: 'c1', hold: true });
      store.toggleHold(); // ми повертаємось, співрозмовник ще тримає
      expect(deps.media.setDeaf).toHaveBeenLastCalledWith(true);
      send({ v: V, type: 'call.peer', callId: 'c1', hold: false });
      expect(deps.media.setDeaf).toHaveBeenLastCalledWith(false);
    });
  });

  describe('answer from a push notification', () => {
    it('accepts the call as soon as it arrives, without the confirmation screen', async () => {
      const { store, request, send } = setup();
      store.answerFromPush('c2');
      expect(request).not.toHaveBeenCalledWith('call.accept', expect.anything());
      send({ v: V, type: 'call.incoming', call: info({ callId: 'c2', direction: 'in' }) });
      await nextTick();
      expect(request).toHaveBeenCalledWith('call.accept', { callId: 'c2' });
    });

    it('accepts a call that is already ringing, but not another one', async () => {
      const { store, request, send } = setup();
      send({ v: V, type: 'call.incoming', call: info({ callId: 'c3', direction: 'in' }) });
      store.answerFromPush('c2');
      await nextTick();
      expect(request).not.toHaveBeenCalledWith('call.accept', expect.anything());
      store.answerFromPush('c3');
      expect(request).toHaveBeenCalledWith('call.accept', { callId: 'c3' });
    });

    it('a second incoming call during a conversation still asks hold or end', async () => {
      const { store, request, send } = setup();
      send({ v: V, type: 'call.incoming', call: info({ callId: 'c1', direction: 'in', state: 'connected' }) });
      store.answerFromPush('c2');
      send({ v: V, type: 'call.incoming', call: info({ callId: 'c2', direction: 'in', waiting: true }) });
      await nextTick();
      expect(store.waiting?.callId).toBe('c2');
      expect(request).not.toHaveBeenCalledWith('call.accept', expect.objectContaining({ callId: 'c2' }));
    });
  });
});
