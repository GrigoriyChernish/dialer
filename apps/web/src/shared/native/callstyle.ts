import { isTauri, tauriInvoke } from './notify';

/**
 * Нативний вхідний дзвінок у Tauri. Android: Kotlin-плагін `apps/mobile/src-tauri/plugins/callstyle`
 * додає у WebView міст `window.DialerNative` (CallStyle). Десктоп (macOS): Rust-команди `apps/mobile/src-tauri/src/incoming.rs`
 * (міні-вікно поверх усіх вікон і системна мелодія), дії повертаються тією ж подією `callstyle`. У браузері нічого не робить.
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

/** Десктопний Tauri: вхідний показує міні-вікно (Rust), а не Android-міст. */
export const isDesktopCallStyle = (): boolean => isTauri() && !bridge();

export const hasNativeCallStyle = (): boolean => !!bridge() || isDesktopCallStyle();

export function showIncomingCall(callId: string, name: string, expiresAt: number): void {
  if (isDesktopCallStyle()) void tauriInvoke('show_incoming', { callId, name, expiresAt });
  else bridge()?.show(JSON.stringify({ callId, name, expiresAt }));
}

export function cancelIncomingCall(callId: string): void {
  if (isDesktopCallStyle()) void tauriInvoke('hide_incoming', { callId });
  else bridge()?.cancel(callId);
}

/** Системна мелодія дзвінка замість вбудованої (Android): звучить, поки вхідний на екрані застосунку. */
export function startNativeRingtone(): void {
  if (isDesktopCallStyle()) void tauriInvoke('start_ringtone');
  else bridge()?.startRingtone();
}

export function stopNativeRingtone(): void {
  if (isDesktopCallStyle()) void tauriInvoke('stop_ringtone');
  else bridge()?.stopRingtone();
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
