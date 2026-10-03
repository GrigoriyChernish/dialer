import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from '@/features/call/store';
import { listenAnswer, resyncPush, updateWorker, usePush } from '@/features/settings/push';

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
  const reg = { pushManager: { getSubscription: async () => sub, subscribe }, update: vi.fn(async () => {}) };
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
  call.me = { userId: '+380501111111', name: 'Оля' } as typeof call.me;
  const request = vi.spyOn(call, 'pushSubscribe').mockResolvedValue();
  const unsubscribe = vi.spyOn(call, 'pushUnsubscribe').mockResolvedValue();
  return { call, push: usePush(), request, unsubscribe, subscribe, nav, reg, getSub: () => sub };
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});
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
    expect(push.saving.value).toBe(false);
  });

  it('попап збереження: лише після дозволу браузера й до відповіді сервера', async () => {
    const { push, request } = setup();
    let done!: () => void;
    let seen = false;
    request.mockImplementation(() => new Promise<void>(r => ((seen = push.saving.value), (done = r))));
    (globalThis.Notification as unknown as { requestPermission: () => Promise<string> }).requestPermission = vi.fn(
      async () => {
        expect(push.saving.value).toBe(false); // системний запит дозволу не перекриваємо
        (globalThis.Notification as { permission: string }).permission = 'granted';
        return 'granted';
      },
    );
    const enabling = push.enable();
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(seen).toBe(true);
    done();
    await enabling;
    expect(push.saving.value).toBe(false);
    expect(push.enabled.value).toBe(true);
  });

  it('дозвіл відхилено в запиті: попап не показуємо', async () => {
    const { push } = setup();
    (globalThis.Notification as unknown as { requestPermission: () => Promise<string> }).requestPermission = vi.fn(
      async () => ((globalThis.Notification as { permission: string }).permission = 'denied'),
    );
    const enabling = push.enable();
    expect(push.saving.value).toBe(false);
    await enabling;
    expect(push.saving.value).toBe(false);
    expect(push.denied.value).toBe(true);
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

describe('вихід і повторний вхід', () => {
  it('вихід знімає підписку лише на сервері; той самий користувач після входу отримує її назад', async () => {
    const { call, push, request, unsubscribe, getSub } = setup();
    await push.enable();
    await push.release();
    expect(unsubscribe).toHaveBeenCalled();
    expect(getSub()).not.toBeNull();

    setActivePinia(createPinia());
    const again = useCallStore();
    again.vapidKey = KEY;
    again.me = call.me;
    const resend = vi.spyOn(again, 'pushSubscribe').mockResolvedValue();
    await resyncPush(again);
    expect(resend).toHaveBeenCalledTimes(1);
    const next = usePush();
    await next.refresh();
    expect(next.enabled.value).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('інший користувач чужої підписки не отримує, поки не ввімкне сам', async () => {
    const { call, push, request } = setup();
    await push.enable();
    await push.release();
    request.mockClear();

    call.me = { userId: '+380502222222', name: 'Петро' } as typeof call.me;
    await resyncPush(call);
    expect(request).not.toHaveBeenCalled();
    const other = usePush();
    await other.refresh();
    expect(other.enabled.value).toBe(false);

    await other.enable();
    expect(request).toHaveBeenCalledTimes(1);
    call.me = { userId: '+380501111111', name: 'Оля' } as typeof call.me;
    request.mockClear();
    await resyncPush(call);
    expect(request).not.toHaveBeenCalled();
  });

  it('вимкнення тумблером забуває власника', async () => {
    const { push } = setup();
    await push.enable();
    expect(localStorage.getItem('dialer.push.owner')).toBe('+380501111111');
    await push.disable();
    expect(localStorage.getItem('dialer.push.owner')).toBeNull();
  });
});

describe('updateWorker', () => {
  it('старт: повторна реєстрація з поточною адресою сервера; на екрані update не частіше ніж раз на 10 хв', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { nav, reg } = setup();
      await updateWorker(true);
      expect(nav.register).toHaveBeenCalledWith(expect.stringMatching(/^sw\.js\?server=/));
      expect(reg.update).not.toHaveBeenCalled();

      await updateWorker();
      expect(reg.update).not.toHaveBeenCalled(); // щойно перевіряли
      vi.advanceTimersByTime(10 * 60_000);
      await updateWorker();
      expect(reg.update).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('без реєстрації (сповіщення не вмикали) воркер не з’являється', async () => {
    const { nav } = setup();
    nav.getRegistration = async () => undefined as never;
    await updateWorker(true);
    expect(nav.register).not.toHaveBeenCalled();
  });
});

describe('listenAnswer', () => {
  it('питає воркер про «Відповісти» й приймає дзвінок із його повідомлення', () => {
    const { call, nav } = setup({ permission: 'granted' });
    let onMessage: (e: { data: unknown }) => void = () => {};
    const post = vi.fn();
    Object.assign(nav, {
      addEventListener: (_: string, f: typeof onMessage) => (onMessage = f),
      controller: { postMessage: post },
    });
    const answer = vi.spyOn(call, 'answerFromPush').mockImplementation(() => {});
    listenAnswer(call);
    expect(post).toHaveBeenCalledWith({ type: 'answer.pending' });
    onMessage({ data: { type: 'answer', callId: 'c7' } });
    onMessage({ data: { type: 'other' } });
    expect(answer).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith('c7');
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
