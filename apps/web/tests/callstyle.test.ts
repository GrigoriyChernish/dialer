import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelIncomingCall,
  hasNativeCallStyle,
  onCallAction,
  requestNativeFcmToken,
  setNativeServer,
  showIncomingCall,
  startNativeRingtone,
  stopNativeRingtone,
} from '@/shared/native/callstyle';

const setBridge = (b?: object) => ((window as unknown as { DialerNative?: object }).DialerNative = b);

afterEach(() => setBridge(undefined));

describe('native CallStyle bridge', () => {
  it('does nothing without the Android bridge', () => {
    expect(hasNativeCallStyle()).toBe(false);
    showIncomingCall('c1', 'Олена', 1);
    cancelIncomingCall('c1');
    const fn = vi.fn();
    onCallAction(fn)();
    expect(fn).not.toHaveBeenCalled();
  });

  it('passes the call to the bridge and reports the answer given at launch', () => {
    const bridge = {
      show: vi.fn(),
      cancel: vi.fn(),
      takeLaunchAnswer: vi.fn(() => 'c9'),
      takeLaunchOpen: vi.fn(() => 'history'),
      setServer: vi.fn(),
      requestFcmToken: vi.fn(),
      startRingtone: vi.fn(),
      stopRingtone: vi.fn(),
    };
    setBridge(bridge);
    expect(hasNativeCallStyle()).toBe(true);
    showIncomingCall('c1', 'Олена', 123);
    expect(JSON.parse(bridge.show.mock.calls[0]![0])).toEqual({ callId: 'c1', name: 'Олена', expiresAt: 123 });
    cancelIncomingCall('c1');
    expect(bridge.cancel).toHaveBeenCalledWith('c1');
    setNativeServer('http://x:8787');
    expect(bridge.setServer).toHaveBeenCalledWith('http://x:8787');
    requestNativeFcmToken();
    expect(bridge.requestFcmToken).toHaveBeenCalled();
    startNativeRingtone();
    stopNativeRingtone();
    expect(bridge.startRingtone).toHaveBeenCalled();
    expect(bridge.stopRingtone).toHaveBeenCalled();
    const fn = vi.fn();
    const off = onCallAction(fn);
    expect(fn).toHaveBeenCalledWith({ type: 'answer', callId: 'c9' });
    expect(fn).toHaveBeenCalledWith({ type: 'open', callId: '', token: 'history' });
    window.dispatchEvent(new CustomEvent('callstyle', { detail: { type: 'decline', callId: 'c1' } }));
    expect(fn).toHaveBeenLastCalledWith({ type: 'decline', callId: 'c1' });
    off();
    window.dispatchEvent(new CustomEvent('callstyle', { detail: { type: 'decline', callId: 'c2' } }));
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
