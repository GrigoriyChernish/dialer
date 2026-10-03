// Сервіс-воркер лише для Web Push (docs/pwa-and-push.md). Без кешування й `fetch` сторінок: застосунок офлайн не працює.
// Адреса сервера для «Відхилити» приходить параметром `server` при реєстрації (`sw.js?server=…`).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const ICON = 'icons/icon-192.png';
const SERVER = new URL(self.location.href).searchParams.get('server') || self.location.origin;

self.addEventListener('push', e => {
  let data = null;
  try {
    data = e.data ? e.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || typeof data.callId !== 'string') return;

  if (data.type === 'call.incoming') {
    e.waitUntil(
      self.registration.showNotification(data.from?.name || 'Дзвінок', {
        body: 'Вхідний дзвінок',
        tag: data.callId,
        icon: ICON,
        requireInteraction: true,
        vibrate: [500, 250, 500, 250, 500],
        actions: [
          { action: 'answer', title: 'Відповісти' },
          { action: 'reject', title: 'Відхилити' },
        ],
        data: { callId: data.callId, rejectToken: data.rejectToken },
      }),
    );
  } else if (data.type === 'call.ended' && data.missed) {
    // той самий тег замінює «Вхідний дзвінок» на «Пропущений»
    e.waitUntil(
      self.registration.showNotification('Пропущений дзвінок', {
        body: data.from?.name || '',
        tag: data.callId,
        icon: ICON,
        data: { callId: data.callId },
      }),
    );
  } else if (data.type === 'call.ended') {
    // кожен push мусить показати сповіщення, тому спершу заміна тим самим тегом, потім закриття
    e.waitUntil(
      (async () => {
        await self.registration.showNotification('Дзвінок завершено', { tag: data.callId, silent: true });
        for (const n of await self.registration.getNotifications({ tag: data.callId })) n.close();
      })(),
    );
  }
});

async function openApp() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find(c => 'focus' in c);
  // застосунок сам підхопить дзвінок: після `hello.ok` він приходить у `calls`, відповідь за користувачем
  return open ? open.focus() : self.clients.openWindow(self.registration.scope);
}

self.addEventListener('notificationclick', e => {
  const { rejectToken } = e.notification.data || {};
  e.notification.close();
  if (e.action === 'reject' && rejectToken) {
    // без вікна: сервер завершує дзвінок із `rejected`, у того, хто дзвонить, гудки припиняються
    e.waitUntil(
      fetch(`${SERVER}/push/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: rejectToken }),
      }).catch(() => {}),
    );
    return;
  }
  e.waitUntil(openApp());
});
