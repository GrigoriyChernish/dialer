import { computed, ref } from 'vue';
import { useCallStore } from '@/features/call/store';
import { serverUrl } from '@/shared/api/server';

/** Ключ VAPID приходить у base64url, `pushManager.subscribe` чекає байти. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return b.every((v, i) => v === x[i]);
};

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Реєстрація сервіс-воркера (відносний шлях: за будь-якою адресою, на Pages це `/dialer/`). Адреса сервера передається в
 * параметрі `server`: воркер не бачить налаштувань застосунку, а йому треба `POST /push/reject` для кнопки «Відхилити».
 */
const register = () => navigator.serviceWorker.register(`sw.js?server=${encodeURIComponent(serverUrl)}`);

/**
 * Сповіщення про дзвінки (docs/pwa-and-push.md): стан тумблера береться з `pushManager.getSubscription()` і дозволу браузера,
 * а не з локальних налаштувань, щоб вони не розходились. Підписка належить пристрою; на сервері вона прив'язана до користувача.
 */
export function usePush() {
  const call = useCallStore();
  const subscribed = ref(false);
  const denied = ref(false);
  const busy = ref(false);
  const error = ref(false);

  /** Тумблер показуємо, лише коли браузер вміє push і сервер віддав ключ VAPID. */
  const available = computed(() => supported() && !!call.vapidKey);
  const enabled = computed(() => subscribed.value && !denied.value);

  async function current() {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  }

  async function refresh() {
    if (!supported()) return;
    denied.value = Notification.permission === 'denied';
    subscribed.value = !denied.value && !!(await current());
  }

  async function enable() {
    const key = call.vapidKey;
    if (!key || busy.value) return;
    busy.value = true;
    error.value = false;
    try {
      if (Notification.permission === 'default') await Notification.requestPermission();
      denied.value = Notification.permission === 'denied';
      if (Notification.permission !== 'granted') return;
      await register();
      const reg = await navigator.serviceWorker.ready;
      const bytes = keyBytes(key);
      let sub = await reg.pushManager.getSubscription();
      // сервер змінив ключ VAPID: стара підписка йому не підходить
      if (sub && !sameKey(sub.options.applicationServerKey, bytes)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await call.pushSubscribe(sub.toJSON());
      subscribed.value = true;
    } catch {
      error.value = true;
      await (await current())?.unsubscribe().catch(() => {});
      subscribed.value = false;
    } finally {
      busy.value = false;
    }
  }

  /** Знімає підписку на пристрої й на сервері; на сервері не чекає довше за секунду (вихід не має зависати без мережі). */
  async function disable() {
    if (busy.value) return;
    busy.value = true;
    try {
      await (await current())?.unsubscribe().catch(() => {});
      subscribed.value = false;
      await Promise.race([call.pushUnsubscribe().catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
    } finally {
      busy.value = false;
    }
  }

  /** Тумблер: увімкнути чи вимкнути. */
  const model = computed({
    get: () => enabled.value,
    set: on => void (on ? enable() : disable()),
  });

  return { available, enabled, model, denied, busy, error, refresh, enable, disable };
}

/**
 * Після `hello.ok` повторно віддає серверу підписку пристрою, якщо вона є: сервер міг її втратити, а на пристрої міг увійти інший
 * користувач. Без дозволу чи підписки нічого не робить.
 */
export async function resyncPush(call: ReturnType<typeof useCallStore>) {
  if (!supported() || !call.vapidKey || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub && sameKey(sub.options.applicationServerKey, keyBytes(call.vapidKey)))
      await call.pushSubscribe(sub.toJSON());
  } catch {
    // не вдалося: повторимо після наступного підключення
  }
}
