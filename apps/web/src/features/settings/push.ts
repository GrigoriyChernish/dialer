import { computed, ref } from 'vue';
import { useCallStore } from '@/features/call/store';
import { serverUrl } from '@/shared/api/server';

import {
  isNotifyGranted,
  isTauri,
  requestNotifyPermission,
  setTauriNotify,
  tauriNotifyEnabled,
} from '@/shared/native/notify';

/** Ключ VAPID приходить у base64url, `pushManager.subscribe` чекає байти. */
function keyBytes(key: string): Uint8Array {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}


const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a || a.byteLength !== b.length) return false;
  const x = new Uint8Array(a);
  return b.every((v, i) => v === x[i]);
};

const supported = () => isTauri() || ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);


/**
 * Реєстрація сервіс-воркера (відносний шлях: за будь-якою адресою, на Pages це `/dialer/`). Адреса сервера передається в
 * параметрі `server`: воркер не бачить налаштувань застосунку, а йому треба `POST /push/reject` для кнопки «Відхилити».
 */
/**
 * Хто ввімкнув сповіщення на цьому пристрої (`userId`). Вихід знімає підписку лише на сервері, а в браузері лишає: після входу
 * того самого користувача її віддає `resyncPush`, і вмикати заново не треба. Іншому користувачу чужа підписка не дістається.
 */
const OWNER_KEY = 'dialer.push.owner';
const readOwner = () => {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
};
const writeOwner = (id: string | null) => {
  try {
    if (id) localStorage.setItem(OWNER_KEY, id);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // без сховища після виходу доведеться ввімкнути заново
  }
};
/** Підписка належить користувачу; без запису власника (підписки до цієї зміни) вона дістається тому, хто увійшов. */
const ownedBy = (id: string | undefined) => {
  if (!id) return false;
  const owner = readOwner();
  if (!owner) writeOwner(id);
  return !owner || owner === id;
};

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
  /** Підписка зберігається: дозвіл уже дано, лишились сервіс-воркер, `pushManager.subscribe` і сервер (попап із завантаженням). */
  const saving = ref(false);
  const error = ref(false);

  /** Тумблер показуємо, коли це Tauri або коли браузер вміє Web Push і сервер віддав ключ VAPID. */
  const available = computed(() => isTauri() || (supported() && !!call.vapidKey));
  const enabled = computed(() => subscribed.value && !denied.value);

  async function current() {
    if (isTauri()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  }

  async function refresh() {
    if (isTauri()) {
      const granted = await isNotifyGranted();
      subscribed.value = granted && tauriNotifyEnabled();
      return;
    }
    if (!supported()) return;
    denied.value = Notification.permission === 'denied';
    subscribed.value = !denied.value && !!(await current()) && ownedBy(call.me?.userId);
  }

  async function enable() {
    if (isTauri()) {
      const ok = await requestNotifyPermission();
      if (ok) {
        setTauriNotify(true);
        subscribed.value = true;
      } else {
        denied.value = true;
      }
      return;
    }
    const key = call.vapidKey;
    if (!key || busy.value) return;
    busy.value = true;
    error.value = false;
    try {
      if (Notification.permission === 'default') await Notification.requestPermission();
      denied.value = Notification.permission === 'denied';
      if (Notification.permission !== 'granted') return;
      saving.value = true;
      await register();
      const reg = await navigator.serviceWorker.ready;
      const bytes = keyBytes(key);
      let sub = await reg.pushManager.getSubscription();
      // сервер змінив ключ VAPID: стара підписка йому не підходить
      if (sub && !sameKey(sub.options.applicationServerKey, bytes)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes as BufferSource,
      });

      await call.pushSubscribe(sub.toJSON());
      writeOwner(call.me?.userId ?? null);
      subscribed.value = true;
    } catch {
      error.value = true;
      await (await current())?.unsubscribe().catch(() => {});
      subscribed.value = false;
    } finally {
      busy.value = false;
      saving.value = false;
    }
  }

  /** Знімає підписку на пристрої й на сервері; на сервері не чекає довше за секунду (вихід не має зависати без мережі). */
  async function disable() {
    if (isTauri()) {
      setTauriNotify(false);
      subscribed.value = false;
      return;
    }
    if (busy.value) return;
    busy.value = true;
    try {
      await (await current())?.unsubscribe().catch(() => {});
      writeOwner(null);
      subscribed.value = false;
      await Promise.race([call.pushUnsubscribe().catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
    } finally {
      busy.value = false;
    }
  }

  /**
   * Вихід: відв'язує підписку від користувача лише на сервері (не довше за секунду), у браузері вона лишається разом із власником,
   * тож після повторного входу сповіщення вже ввімкнені.
   */
  async function release() {
    await Promise.race([call.pushUnsubscribe().catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
  }

  /** Тумблер: увімкнути чи вимкнути. */
  const model = computed({
    get: () => enabled.value,
    set: on => void (on ? enable() : disable()),
  });

  return { available, enabled, model, denied, busy, saving, error, refresh, enable, disable, release };
}

/** Як часто при поверненні на екран перевіряти нову версію `sw.js`. */
const UPDATE_EVERY_MS = 10 * 60_000;
let lastUpdate = 0;

/**
 * Оновлення сервіс-воркера (лише якщо його вже зареєстровано, тобто сповіщення вмикали). Сам браузер перевіряє `sw.js` при
 * відкритті застосунку й при push (раз на добу), а PWA, яку не закривають, без цього лишалась би на старій версії.
 * - `start`: при старті застосунку реєструє воркер повторно: так до параметра `server` доходить нова адреса сервера.
 * - інакше (повернення на екран): `registration.update()`, не частіше ніж раз на `UPDATE_EVERY_MS`.
 * Нова версія вмикається одразу (`skipWaiting` і `clients.claim` у `sw.js`), перезавантаження не треба.
 */
export async function updateWorker(start = false) {
  if (!supported() || (!start && Date.now() - lastUpdate < UPDATE_EVERY_MS)) return;
  lastUpdate = Date.now();
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    if (start) await register();
    else await reg.update();
  } catch {
    // немає мережі: перевіримо наступного разу
  }
}

/**
 * Кнопка «Відповісти» в сповіщенні: воркер передає `callId` повідомленням (`answer`) у вже відкрите вікно, а щойно відкрите
 * питає його саме (`answer.pending`). Через посилання не передаємо: інакше чуже посилання вмикало б камеру й мікрофон.
 */
export function listenAnswer(call: ReturnType<typeof useCallStore>) {
  if (!supported()) return;
  const sw = navigator.serviceWorker;
  sw.addEventListener('message', e => {
    const m = e.data as { type?: string; callId?: unknown } | null;
    if (m?.type === 'answer' && typeof m.callId === 'string') call.answerFromPush(m.callId);
  });
  sw.startMessages?.();
  sw.controller?.postMessage({ type: 'answer.pending' });
}

/**
 * Закриває сповіщення «Вхідний дзвінок» (у них є `rejectToken`), коли застосунок на екрані: дзвінок видно в ньому самому.
 * «Пропущений» лишається.
 */
export async function closeIncomingNotifications() {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    for (const n of (await reg?.getNotifications()) ?? []) if (n.data?.rejectToken) n.close();
  } catch {
    // не страшно: сповіщення закриється з push про завершення
  }
}

/**
 * Після `hello.ok` повторно віддає серверу підписку пристрою, якщо вона є й належить тому, хто увійшов: сервер міг її втратити,
 * а після виходу й повторного входу вона знову прив'язується до користувача. Без дозволу, підписки чи чужу — нічого не робить.
 */
export async function resyncPush(call: ReturnType<typeof useCallStore>) {
  if (!supported() || !call.vapidKey || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub && sameKey(sub.options.applicationServerKey, keyBytes(call.vapidKey)) && ownedBy(call.me?.userId))
      await call.pushSubscribe(sub.toJSON());
  } catch {
    // не вдалося: повторимо після наступного підключення
  }
}
