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
      (async () => {
        // прихований пристрій отримує вхідний і сокетом, і push; якщо вікно вже на екрані, дзвінок видно в ньому.
        // Chrome не вимагає сповіщення, поки сторінка сайту видима
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (windows.some(c => c.visibilityState === 'visible')) return;
        await self.registration.showNotification(data.from?.name || 'Дзвінок', {
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
        });
      })(),
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

/** «Відповісти» для вікна, що ще відкривається: віддаємо його на запит `answer.pending` (не довше за 30 с). */
let pendingAnswer = null;
let answerTaken = null;

self.addEventListener('message', e => {
  if (e.data?.type !== 'answer.pending') return;
  const p = pendingAnswer;
  pendingAnswer = null;
  if (p && p.until > Date.now()) e.source?.postMessage({ type: 'answer', callId: p.callId });
  answerTaken?.();
});

/**
 * Відкриває застосунок. З `answerCallId` («Відповісти») застосунок одразу приймає цей дзвінок, без екрана підтвердження;
 * інакше він підхопить дзвінок сам (після `hello.ok` той приходить у `calls`), а відповідь за користувачем.
 */
async function openApp(answerCallId) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find(c => 'focus' in c);
  if (open) {
    await open.focus();
    if (answerCallId) open.postMessage({ type: 'answer', callId: answerCallId });
    return;
  }
  if (answerCallId) pendingAnswer = { callId: answerCallId, until: Date.now() + 30_000 };
  await self.clients.openWindow(self.registration.scope);
  // воркер не має заснути, поки нове вікно не забрало відповідь
  if (answerCallId) await new Promise(r => ((answerTaken = r), setTimeout(r, 15_000)));
}

self.addEventListener('notificationclick', e => {
  const { callId, rejectToken } = e.notification.data || {};
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
  e.waitUntil(openApp(e.action === 'answer' ? callId : undefined));
});
