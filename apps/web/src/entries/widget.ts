import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import App from '@/app/App.vue';
import { i18n } from '@/app/i18n';
import '@/app/styles/main.css';
import { useCallStore } from '@/features/call/store';
import ContactsPage from '@/pages/ContactsPage.vue';
import { SignalingClient } from '@/shared/api/signaling';
import { CallMedia } from '@/shared/media/room';
import { Sounds } from '@/shared/sounds/sounds';

// Віджет відкривається в iframe з demo/embed.js: токен, адреса сервера й тема приходять у query.
const q = new URLSearchParams(location.search);
const host = q.get('host') || location.origin;
let token = q.get('token') ?? '';
const server = q.get('server') || import.meta.env.VITE_SERVER_URL || 'http://localhost:8787';
const toHost = (m: object) => parent !== window && parent.postMessage(m, host);

const setTheme = (t: string | null) => (t && t !== 'auto' ? (document.documentElement.dataset.theme = t) : delete document.documentElement.dataset.theme);
setTheme(q.get('theme'));

let deviceId: string;
try {
  deviceId = sessionStorage.getItem('dialer.dev') ?? 'd_' + crypto.randomUUID().slice(0, 8);
  sessionStorage.setItem('dialer.dev', deviceId);
} catch {
  deviceId = 'd_' + crypto.randomUUID().slice(0, 8);
}

const client = new SignalingClient({
  url: server.replace(/^http/, 'ws').replace(/\/+$/, '') + '/ws',
  deviceId,
  getToken: () => token,
  onAuthFailed: () => toHost({ type: 'token:expired' }),
});

const pinia = createPinia();
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: ContactsPage }] });
const app = createApp(App).use(pinia).use(router).use(i18n);

const call = useCallStore(pinia);
call.init({ client, media: new CallMedia(), sounds: new Sounds() });
client.on((m) => m.type === 'token.expiring' && toHost({ type: 'token:expired' }));
client.connect();

// повідомлення лише від сайту-господаря, який нас вбудував
addEventListener('message', (e) => {
  if (e.source !== parent || e.origin !== host) return;
  const m = e.data ?? {};
  if (m.type === 'theme') setTheme(m.theme);
  if (m.type === 'token') {
    token = m.token;
    client.refreshToken();
  }
  if (m.type === 'call') void call.call(m.id);
});
addEventListener('keydown', (e) => e.key === 'Escape' && toHost({ type: 'close' }));
call.$subscribe(() => toHost({ type: 'state', state: call.status }));

app.mount('#app');
toHost({ type: 'ready' });
