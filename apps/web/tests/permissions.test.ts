import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requestMediaPermissions, watchMediaPermissions } from '@/shared/media/permissions';

describe('media permissions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests audio and video and immediately stops tracks', async () => {
    const stopAudio = vi.fn();
    const stopVideo = vi.fn();
    const mockStream = {
      getTracks: () => [
        { kind: 'audio', stop: stopAudio },
        { kind: 'video', stop: stopVideo },
      ],
    };

    const getUserMedia = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: { getUserMedia },
      },
      configurable: true,
      writable: true,
    });

    const res = await requestMediaPermissions();
    expect(res).toEqual({ audio: true, video: true });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(stopAudio).toHaveBeenCalled();
    expect(stopVideo).toHaveBeenCalled();
  });

  it('falls back to audio-only if combined audio+video request fails', async () => {
    const stopAudio = vi.fn();
    const mockAudioStream = {
      getTracks: () => [{ kind: 'audio', stop: stopAudio }],
    };

    const getUserMedia = vi.fn().mockRejectedValueOnce(new Error('no camera')).mockResolvedValueOnce(mockAudioStream);

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: { getUserMedia },
      },
      configurable: true,
      writable: true,
    });

    const res = await requestMediaPermissions();
    expect(res).toEqual({ audio: true, video: false });
    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: true, video: true });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
    expect(stopAudio).toHaveBeenCalled();
  });

  it('watches permission state changes and notifies listener', async () => {
    const micStatus = { state: 'granted', onchange: null as (() => void) | null };
    const camStatus = { state: 'denied', onchange: null as (() => void) | null };

    const query = vi.fn().mockImplementation(async ({ name }) => {
      if (name === 'microphone') return micStatus;
      if (name === 'camera') return camStatus;
      throw new Error('unknown');
    });

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        permissions: { query },
      },
      configurable: true,
      writable: true,
    });

    const onChange = vi.fn();
    const unsubscribe = watchMediaPermissions(onChange);

    // Перший виклик update
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith({ micDenied: false, camDenied: true });

    // Зміна стану мікрофона
    micStatus.state = 'denied';
    micStatus.onchange?.();
    await new Promise(r => setTimeout(r, 0));
    expect(onChange).toHaveBeenLastCalledWith({ micDenied: true, camDenied: true });

    unsubscribe();
    expect(micStatus.onchange).toBeNull();
  });

  const withPermissions = (states: { microphone?: string; camera?: string }, getUserMedia = vi.fn()) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: { getUserMedia },
        permissions: { query: vi.fn(async ({ name }: { name: string }) => ({ state: states[name as 'microphone'] })) },
      },
      configurable: true,
      writable: true,
    });
    return getUserMedia;
  };

  it('does not open the devices when both permissions are already granted', async () => {
    const getUserMedia = withPermissions({ microphone: 'granted', camera: 'granted' });
    expect(await requestMediaPermissions()).toEqual({ audio: true, video: true });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('does not ask again when the microphone is denied', async () => {
    const getUserMedia = withPermissions({ microphone: 'denied', camera: 'prompt' });
    expect(await requestMediaPermissions()).toEqual({ audio: false, video: false });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('asks when the state is undecided', async () => {
    const stop = vi.fn();
    const getUserMedia = withPermissions(
      { microphone: 'prompt', camera: 'prompt' },
      vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    );
    expect(await requestMediaPermissions()).toEqual({ audio: true, video: true });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });
});
