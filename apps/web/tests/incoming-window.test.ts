import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/app/i18n';
import IncomingWindow from '@/features/call/IncomingWindow.vue';
import {
  cancelIncomingCall,
  hasNativeCallStyle,
  isDesktopCallStyle,
  showIncomingCall,
  startNativeRingtone,
  stopNativeRingtone,
} from '@/shared/native/callstyle';

const invoke = vi.fn(async () => undefined);
const setTauri = () => ((window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = { invoke });

afterEach(() => {
  delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
  invoke.mockClear();
  history.replaceState(null, '', '/');
});

describe('desktop incoming call', () => {
  it('uses the Rust commands in Tauri without the Android bridge', () => {
    expect(isDesktopCallStyle()).toBe(false);
    setTauri();
    expect(isDesktopCallStyle()).toBe(true);
    expect(hasNativeCallStyle()).toBe(true);
    showIncomingCall('c1', 'Олена', 123);
    expect(invoke).toHaveBeenCalledWith('show_incoming', { callId: 'c1', name: 'Олена', expiresAt: 123 });
    cancelIncomingCall('c1');
    expect(invoke).toHaveBeenCalledWith('hide_incoming', { callId: 'c1' });
    startNativeRingtone();
    stopNativeRingtone();
    expect(invoke).toHaveBeenCalledWith('start_ringtone', undefined);
    expect(invoke).toHaveBeenCalledWith('stop_ringtone', undefined);
  });

  it('the mini window shows the caller and sends the choice to Rust', async () => {
    setTauri();
    history.replaceState(null, '', '/incoming.html?callId=c7&name=%D0%9E%D0%BB%D0%B5%D0%BD%D0%B0');
    const w = mount(IncomingWindow, { global: { plugins: [i18n] } });
    expect(w.text()).toContain('Олена');
    await w.find('button[aria-label="Прийняти"]').trigger('click');
    expect(invoke).toHaveBeenCalledWith('incoming_action', { kind: 'answer', callId: 'c7' });
    await w.find('button[aria-label="Відхилити"]').trigger('click');
    expect(invoke).toHaveBeenCalledWith('incoming_action', { kind: 'decline', callId: 'c7' });
  });
});
