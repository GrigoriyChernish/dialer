import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from '@/app/App.vue';
import { i18n } from '@/app/i18n';
import '@/app/styles/main.css';
import { useSessionStore } from '@/features/auth/session';
import { useCallStore } from '@/features/call/store';
import { homeTab, searchQuery } from '@/features/contacts/homeState';
import HomePage from '@/pages/HomePage.vue';
import LoginPage from '@/pages/LoginPage.vue';
import SettingsPage from '@/pages/SettingsPage.vue';
import { usePrefsStore } from '@/features/settings/prefs';
import { closeIncomingNotifications, listenAnswer, resyncPush, updateWorker } from '@/features/settings/push';
import { createAuthApi } from '@/shared/api/auth';
import { serverUrl } from '@/shared/api/server';
import { SignalingClient } from '@/shared/api/signaling';
import { applyTheme } from '@/shared/theme';
import { CallMedia } from '@/shared/media/room';
import { Sounds } from '@/shared/sounds/sounds';
import {
  cancelIncomingCall,
  hasNativeCallStyle,
  isDesktopCallStyle,
  onCallAction,
  requestNativeFcmToken,
  setNativeServer,
  showIncomingCall,
  startNativeRingtone,
  stopNativeRingtone,
} from '@/shared/native/callstyle';
import { focusWindow, isTauri, sendNotification, tauriNotifyEnabled } from '@/shared/native/notify';

// Окремий застосунок (GitHub Pages): вхід за номером, далі контакти й дзвінки. Віджет для iframe — entries/widget.ts.
const server = serverUrl;

let deviceId: string;
try {
  deviceId = localStorage.getItem('dialer.dev') ?? 'd_' + crypto.randomUUID().slice(0, 8);
  localStorage.setItem('dialer.dev', deviceId);
} catch {
  deviceId = 'd_' + crypto.randomUUID().slice(0, 8);
}

const pinia = createPinia();
const session = useSessionStore(pinia);
session.configure(createAuthApi(server));

const client: SignalingClient = new SignalingClient({
  url: server.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws',
  deviceId,
  getToken: () => session.token,
  getHidden: () => document.visibilityState === 'hidden',
  // токен відхилено: пробуємо оновити, інакше сесія закінчилась і гард поверне на вхід
  onAuthFailed: () => void session.refresh().then(ok => ok && client.connect()),
});
const call = useCallStore(pinia);
// тема з налаштувань (лише цей пристрій) і колір статус-бару: «Авто» — системна; у віджеті тему задає сайт-господар, тому лише тут
const prefs = usePrefsStore(pinia);
watch(
  () => prefs.theme,
  th => applyTheme(th),
  { immediate: true },
);
// Android: мелодію вхідного грає система (сповіщення CallStyle, а коли застосунок на екрані, системна мелодія через міст), не вбудована
const webSounds = new Sounds();
const sounds = hasNativeCallStyle()
  ? {
      play(kind: Parameters<Sounds['play']>[0], ms?: number) {
        stopNativeRingtone();
        if (kind === 'ringtone') {
          if (document.visibilityState === 'visible') startNativeRingtone();
          webSounds.play(null);
        } else webSounds.play(kind, ms);
      },
    }
  : webSounds;
call.init({ client, media: new CallMedia(), sounds });
// після кожного hello.ok віддаємо серверу підписку пристрою на сповіщення, якщо вона є
watch(
  () => call.ready,
  ready => ready && void resyncPush(call),
  { immediate: true },
);

// системне сповіщення про вхідний лише в Tauri: у браузері прихованій вкладці його шле сервер через Web Push, власне було б другим.
// На Android це нативний CallStyle (кнопки «Відповісти» / «Відхилити»), поки вікно приховане; він зникає, щойно вхідний перестав дзвонити
let incomingId: string | null = null;
/** Застосунок не перед очима: вікно приховане чи (десктоп) без фокусу. Android вважає «поза екраном» лише приховане вікно. */
const away = () => document.visibilityState === 'hidden' || (isDesktopCallStyle() && !document.hasFocus());
watch(
  () => call.status,
  (st, prev) => {
    if (prev === 'incoming' && st !== 'incoming' && incomingId) {
      // і сповіщення, яке показав FCM, коли застосунок не працював: власного прапорця на нього немає
      cancelIncomingCall(incomingId);
      incomingId = null;
    }
    if (st === 'incoming' && prev !== 'incoming') {
      incomingId = call.callId;
      if (hasNativeCallStyle()) {
        if (!call.callId) return;
        if (away()) {
          const name = call.peer?.name || call.peer?.userId || i18n.global.t('call.notify.unknown');
          showIncomingCall(call.callId, name, Date.now() + call.left * 1000);
        } else cancelIncomingCall(call.callId); // дзвінок уже на екрані (застосунок відкрила FCM-сповіщення)
      } else {
        void focusWindow();
        if (isTauri() && tauriNotifyEnabled()) {
          const { t } = i18n.global;
          const name = call.peer?.name || call.peer?.userId || t('call.notify.unknown');
          void sendNotification(t('call.notify.title'), t('call.notify.body', { name }));
        }
      }
    }
  },
);

// десктоп: пропущений вхідний, поки застосунок не перед очима, дає системне сповіщення; екран «Ви не відповіли» чекає у вікні
watch(
  () => call.missed,
  m => {
    if (!isDesktopCallStyle() || m?.reason !== 'incoming' || !away() || !tauriNotifyEnabled()) return;
    const { t } = i18n.global;
    void sendNotification(t('call.notify.missed'), m.peer.name || m.peer.userId);
  },
);

/** Фокус на елементі, який сам реагує на Enter чи пробіл: його натискання не можна перехоплювати. */
const isInteractive = (el: Element | null) =>
  !!el?.closest('input, textarea, select, button, a[href], [role="button"], [contenteditable="true"]');

// дії зі сповіщення CallStyle: «Відповісти» приймає дзвінок, щойно він з'явиться, «Відхилити» завершує вхідний
onCallAction(a => {
  if (a.type === 'answer') call.answerFromPush(a.callId);
  else if (a.type === 'decline') {
    if (call.status === 'incoming' && call.callId === a.callId) call.end();
  } else if (a.type === 'open') {
    // тап по «Пропущений дзвінок»: вкладка історії на головній (роутера ще може не бути на холодному запуску, тож через hash)
    if (a.token === 'history') homeTab.value = 'history';
    if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
  } else if (a.token && call.ready) void call.pushSubscribeFcm(a.token).catch(() => {});
});
// FCM: адреса сервера для нативного «Відхилити», після кожного hello.ok просимо токен (пристрій віддає його серверу заново)
setNativeServer(server);
watch(
  () => call.ready,
  ready => ready && requestNativeFcmToken(),
  { immediate: true },
);
// вікно відкрили чи воно отримало фокус: сповіщення про вхідний більше не потрібне, дзвінок уже на екрані
const onActive = () => {
  if (away()) return;
  if (incomingId) {
    cancelIncomingCall(incomingId);
    if (call.status === 'incoming') startNativeRingtone(); // сповіщення знято, мелодію далі грає застосунок
  }
};
document.addEventListener('visibilitychange', onActive);
window.addEventListener('focus', onActive);

// гарячі клавіші вхідного: Enter — прийняти, Esc — відхилити (не під час утримання клавіші й не з фокусом на кнопці чи полі)
window.addEventListener('keydown', e => {
  if (call.status !== 'incoming' || e.repeat) return;
  if (e.key === 'Enter' && !isInteractive(document.activeElement)) {
    e.preventDefault();
    call.accept();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    call.end();
  }
});

// токен доступу живе 30 хв: оновлюємо за хвилину до кінця (і за запитом сервера `token.expiring`)
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const refreshSoon = async () => {
  if (await session.refresh()) client.refreshToken();
};
client.on(m => m.type === 'token.expiring' && void refreshSoon());

/** Вихід: перезавантаження скидає стан дзвінків і контактів, сесії вже немає. */
const restart = () => location.replace(location.pathname + '#/login');

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: LoginPage, meta: { guest: true } },
    { path: '/', component: HomePage },
    { path: '/settings', component: SettingsPage },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
});
router.beforeEach(to => {
  if (!session.loggedIn && !to.meta.guest) return '/login';
  if (session.loggedIn && to.meta.guest) return '/';
});

watch(
  () => session.session,
  (s, prev) => {
    clearTimeout(refreshTimer);
    if (!s) {
      client.close();
      // вихід лише міняє фрагмент адреси, а не перезавантажує сторінку: вкладка й пошук попереднього користувача не мають лишатись
      homeTab.value = 'contacts';
      searchQuery.value = '';
      if (prev) restart();
      return;
    }
    refreshTimer = setTimeout(() => void refreshSoon(), Math.max(5_000, s.expiresAt - Date.now() - 60_000));
    if (!prev) {
      client.connect();
      // один раз за вхід (оновлення токена змінює session, але не `prev`); якщо дозвіл уже є, пристрої не відкриваються
      void call.requestPermissions();
    }
  },
  { immediate: true },
);

// після обриву не чекаємо паузи, коли мережа повернулась чи вкладку знову відкрили; живий на вигляд сокет перевіряємо пінгом
const wake = () => session.loggedIn && client.reconnectNow();
addEventListener('online', wake);
// Android заморожує PWA у фоні, а сервер закриває сокет лише після хвилини тиші: на цей час прихований пристрій отримує
// вхідні й через Web Push (`device.visibility`); показані знову сповіщення про вхідні закриваємо, дзвінок уже на екрані
document.addEventListener('visibilitychange', () => {
  const hidden = document.visibilityState === 'hidden';
  client.setHidden(hidden);
  if (!hidden) {
    wake();
    void closeIncomingNotifications();
    void updateWorker();
  }
});
void closeIncomingNotifications();
void updateWorker(true);
listenAnswer(call);

createApp(App).use(pinia).use(router).use(i18n).mount('#app');
