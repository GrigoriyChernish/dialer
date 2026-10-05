import { isTauri } from '@/shared/native/notify';

/** Адреса сервера: підтримує query ?server=, localStorage dialer.server, VITE_SERVER_URL або origin (для Tauri за замовчуванням localhost:8787; на телефоні це сам телефон, тож адресу ПК задають `VITE_SERVER_URL` при збірці чи `dialer.server`) */
const queryServer = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('server') : null;
const storedServer = typeof localStorage !== 'undefined' ? localStorage.getItem('dialer.server') : null;

const defaultOrigin = (): string => {
  if (typeof location === 'undefined') return '';
  if (isTauri() || location.origin.includes('tauri.localhost') || location.protocol === 'tauri:') {
    return 'http://localhost:8787';
  }
  return location.origin;
};

export const serverUrl: string =
  queryServer ||
  storedServer ||
  import.meta.env.VITE_SERVER_URL ||
  defaultOrigin();


