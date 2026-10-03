import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from '@/features/call/store';
import { resyncPush, usePush } from '@/features/settings/push';

const BYTES = new Uint8Array([4, 1, 3, 0, 1]);
const KEY = btoa(String.fromCharCode(...BYTES))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, ''); // base64url

interface FakeSub {
  toJSON(): object;
  unsubscribe: ReturnType<typeof vi.fn>;
  options: { applicationServerKey: ArrayBuffer };
}

function setup({ permission = 'default', existing = null as FakeSub | null } = {}) {
  let sub = existing;
  const subscribe = vi.fn(async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
    sub = {
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: vi.fn(async () => void (sub = null)),
      options: { applicationServerKey: applicationServerKey.buffer as ArrayBuffer },
    };
    return sub;
  });
  const reg = { pushManager: { getSubscription: async () => sub, subscribe } };
  const nav = {
    register: vi.fn(async () => reg),
    ready: Promise.resolve(reg),
    getRegistration: async () => reg,
  };
  vi.stubGlobal('Notification', {
    permission,
    requestPermission: vi.fn(async () => {
      (globalThis.Notification as { permission: string }).permission = 'granted';
      return 'granted';
    }),
  });
  vi.stubGlobal('PushManager', class {});
  Object.defineProperty(navigator, 'serviceWorker', { value: nav, configurable: true });

  const call = useCallStore();
  call.vapidKey = KEY;
  const request = vi.spyOn(call, 'pushSubscribe').mockResolvedValue();
  const unsubscribe = vi.spyOn(call, 'pushUnsubscribe').mockResolvedValue();
  return { call, push: usePush(), request, unsubscribe, subscribe, nav, getSub: () => sub };
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('usePush', () => {
  it('недоступний без ключа VAPID від сервера й без підтримки браузера', () => {
    const { call, push } = setup();
    expect(push.available.value).toBe(true);
    call.vapidKey = null;
    expect(push.available.value).toBe(false);
  });

  it('вмикання: просить дозвіл, підписується з ключем сервера й віддає підписку серверу', async () => {
    const { push, request, subscribe, nav } = setup();
    await push.refresh();
    expect(push.enabled.value).toBe(false);

    await push.enable();
    expect(nav.register).toHaveBeenCalledWith(expect.stringMatching(/^sw\.js\?server=/));
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ endpoint: expect.any(String) }));
    expect(push.enabled.value).toBe(true);
  });

  it('дозвіл відхилено: підписки немає, тумблер недоступний', async () => {
    const { push, request } = setup({ permission: 'denied' });
    await push.refresh();
    expect(push.denied.value).toBe(true);
    await push.enable();
    expect(request).not.toHaveBeenCalled();
    expect(push.enabled.value).toBe(false);
  });

  it('сервер відхилив підписку: підписку на пристрої знімаємо, показуємо помилку', async () => {
    const { push, request, getSub } = setup({ permission: 'granted' });
    request.mockRejectedValue(new Error('bad_request'));
    await push.enable();
    expect(push.error.value).toBe(true);
    expect(push.enabled.value).toBe(false);
    expect(getSub()).toBeNull();
  });

  it('вимикання: знімає підписку на пристрої й на сервері', async () => {
    const { push, unsubscribe, getSub } = setup({ permission: 'granted' });
    await push.enable();
    expect(push.enabled.value).toBe(true);
    await push.disable();
    expect(getSub()).toBeNull();
    expect(unsubscribe).toHaveBeenCalled();
    expect(push.enabled.value).toBe(false);
  });

  it('стан береться з браузера: наявна підписка вмикає тумблер після refresh', async () => {
    const existing: FakeSub = {
      toJSON: () => ({}),
      unsubscribe: vi.fn(),
      options: { applicationServerKey: new ArrayBuffer(0) },
    };
    const { push } = setup({ permission: 'granted', existing });
    await push.refresh();
    expect(push.enabled.value).toBe(true);
  });
});

describe('resyncPush', () => {
  it('віддає серверу наявну підписку, а без дозволу чи підписки мовчить', async () => {
    const existing: FakeSub = {
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x' }),
      unsubscribe: vi.fn(),
      options: { applicationServerKey: BYTES.buffer as ArrayBuffer },
    };
    const { call, request } = setup({ permission: 'granted', existing });
    await resyncPush(call);
    expect(request).toHaveBeenCalledTimes(1);

    request.mockClear();
    (globalThis.Notification as { permission: string }).permission = 'default';
    await resyncPush(call);
    expect(request).not.toHaveBeenCalled();
  });
});
