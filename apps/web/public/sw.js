// Сервіс-воркер лише для Web Push (docs/pwa-and-push.md). Без кешування й `fetch`: застосунок офлайн не працює.
// Поки що дві події: вхідний дзвінок (сповіщення) і його завершення (сповіщення закривається).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const ICON = 'icons/icon-192.png';

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

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find(c => 'focus' in c);
      if (open) return open.focus();
      return self.clients.openWindow(self.registration.scope);
    })(),
  );
});
