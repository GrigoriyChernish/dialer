import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from '@/app/App.vue';
import { i18n } from '@/app/i18n';
import '@/app/styles/main.css';
import { useSessionStore } from '@/features/auth/session';
import { useCallStore } from '@/features/call/store';
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
import { focusWindow, isTauri, sendNotification } from '@/shared/native/notify';



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
call.init({ client, media: new CallMedia(), sounds: new Sounds() });
// після кожного hello.ok віддаємо серверу підписку пристрою на сповіщення, якщо вона є
watch(
  () => call.ready,
  ready => ready && void resyncPush(call),
  { immediate: true },
);

// системні сповіщення та CallStyle реакція при вхідному дзвінку (Tauri / десктоп)
watch(
  () => call.status,
  (st, prev) => {
    if (st === 'incoming' && prev !== 'incoming') {
      void focusWindow();
      const allowed = localStorage.getItem('dialer.tauri_notify') !== '0';
      if (allowed && (isTauri() || document.visibilityState === 'hidden')) {
        const callerName = call.peer?.name || call.peer?.userId || 'Невідомий';
        void sendNotification('Вхідний дзвінок', `${callerName} телефонує вам`);
      }
    }
  },
);

// Гарячі клавіші CallStyle: Enter — прийняти, Esc — відхилити вхідний виклик
window.addEventListener('keydown', e => {
  if (call.status === 'incoming') {
    const active = document.activeElement;
    const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (e.key === 'Enter' && !isInput) {
      e.preventDefault();
      void call.accept();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      void call.end();
    }
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
