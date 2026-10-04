/**
 * Сервер сам робить HTTP-запит на endpoint із підписки, тому endpoint від клієнта перевіряємо (інакше це SSRF):
 * лише `https` і хости відомих push-сервісів Chrome/Android (FCM), Firefox (Mozilla) та Windows (WNS).
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^updates-autopush\.(stage\.)?mozaws\.net$/,
  /\.notify\.windows\.com$/,
];

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && PUSH_HOSTS.some(h => h.test(url.hostname));
}
