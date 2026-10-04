/** Перевірка, чи запущено додаток всередині Tauri (десктоп/мобілка). */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

const getInternals = (): TauriInternals | null =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
    ? (window as unknown as { __TAURI_INTERNALS__: TauriInternals }).__TAURI_INTERNALS__
    : null;

/** Перевірка, чи надано дозвіл на системні сповіщення. */
export async function isNotifyGranted(): Promise<boolean> {
  const tauri = getInternals();
  if (tauri) {
    try {
      const res = await tauri.invoke('plugin:notification|is_permission_granted');
      return Boolean(res);
    } catch {
      return false;
    }
  }
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/** Запит дозволу на сповіщення в системі. */
export async function requestNotifyPermission(): Promise<boolean> {
  const tauri = getInternals();
  if (tauri) {
    try {
      const res = await tauri.invoke('plugin:notification|request_permission');
      return res === 'granted' || res === true;
    } catch {
      return false;
    }
  }
  if (typeof Notification !== 'undefined') {
    const res = await Notification.requestPermission();
    return res === 'granted';
  }
  return false;
}

/** Надіслати системне сповіщення про виклик або подію. */
export async function sendNotification(title: string, body?: string): Promise<void> {
  const tauri = getInternals();
  if (tauri) {
    try {
      await tauri.invoke('plugin:notification|notify', {
        options: { title, body },
      });
      return;
    } catch (e) {
      console.warn('Tauri notify error:', e);
    }
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body, icon: './icons/icon-192.png' });
  }
}

/** Розгорнути та сфокусувати вікно на передньому плані при вхідному виклику. */
export async function focusWindow(): Promise<void> {
  const tauri = getInternals();
  if (tauri) {
    try {
      await tauri.invoke('focus_window');
    } catch (e) {
      console.warn('focus_window error:', e);
    }
  }
}

