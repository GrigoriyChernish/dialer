/** Адреса сервера: підтримує query ?server=, localStorage dialer.server, VITE_SERVER_URL або origin */
const queryServer = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('server') : null;
const storedServer = typeof localStorage !== 'undefined' ? localStorage.getItem('dialer.server') : null;

export const serverUrl: string =
  queryServer ||
  storedServer ||
  import.meta.env.VITE_SERVER_URL ||
  (typeof location !== 'undefined' ? location.origin : '');

