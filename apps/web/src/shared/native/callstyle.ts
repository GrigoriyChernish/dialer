/**
 * Нативне сповіщення про вхідний (CallStyle) у Tauri на Android: Kotlin-плагін `apps/mobile/src-tauri/plugins/callstyle`
 * додає у WebView міст `window.DialerNative`. Поза Android моста немає, і все нижче нічого не робить.
 */
interface NativeBridge {
  show(json: string): void;
  cancel(callId: string): void;
  takeLaunchAnswer(): string;
  takeLaunchOpen(): string;
  setServer(url: string): void;
  requestFcmToken(): void;
  startRingtone(): void;
  stopRingtone(): void;
}

export interface CallAction {
  /** `token`: новий токен FCM (в `token`), відповідь на `requestNativeFcmToken` чи його ротація. `open`: відкрити вкладку з `token` (`history`) — тап по «Пропущений дзвінок». */
  type: 'answer' | 'decline' | 'token' | 'open';
  callId: string;
  token?: string;
}

const bridge = (): NativeBridge | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { DialerNative?: NativeBridge }).DialerNative;

export const hasNativeCallStyle = (): boolean => !!bridge();

export function showIncomingCall(callId: string, name: string, expiresAt: number): void {
  bridge()?.show(JSON.stringify({ callId, name, expiresAt }));
}

export function cancelIncomingCall(callId: string): void {
  bridge()?.cancel(callId);
}

/** Системна мелодія дзвінка замість вбудованої (Android): звучить, поки вхідний на екрані застосунку. */
export function startNativeRingtone(): void {
  bridge()?.startRingtone();
}

export function stopNativeRingtone(): void {
  bridge()?.stopRingtone();
}

/** Адреса сервера для нативного «Відхилити», коли застосунок не запущено. */
export function setNativeServer(url: string): void {
  bridge()?.setServer(url);
}

/** Просить токен FCM: він приходить подією `token` в `onCallAction`. */
export function requestNativeFcmToken(): void {
  bridge()?.requestFcmToken();
}

/**
 * Дії користувача зі сповіщення: подія `callstyle` (застосунок живий) і «Відповісти» на холодному запуску
 * (`takeLaunchAnswer`, коли JS ще не слухав подію). Повертає відписку.
 */
export function onCallAction(fn: (a: CallAction) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<CallAction>).detail);
  window.addEventListener('callstyle', handler);
  const launched = bridge()?.takeLaunchAnswer();
  if (launched) fn({ type: 'answer', callId: launched });
  const open = bridge()?.takeLaunchOpen();
  if (open) fn({ type: 'open', callId: '', token: open });
  return () => window.removeEventListener('callstyle', handler);
}
