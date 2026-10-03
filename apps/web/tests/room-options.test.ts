import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRoom {
  options: Record<string, unknown>;
  stopped: string[];
  handlers: Map<string, (...a: unknown[]) => void>;
  localParticipant: { setCameraEnabled: ReturnType<typeof vi.fn>; setMicrophoneEnabled: ReturnType<typeof vi.fn> };
  startAudio: ReturnType<typeof vi.fn>;
  canPlaybackAudio: boolean;
}
const created: MockRoom[] = [];

vi.mock('livekit-client', () => {
  class Room {
    options: Record<string, unknown>;
    stopped: string[] = [];
    localParticipant = {
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async () => {}),
      trackPublications: new Map([
        ['cam', { track: { stop: () => this.stopped.push('cam') } }],
        ['mic', { track: { stop: () => this.stopped.push('mic') } }],
      ]),
    };
    constructor(options: Record<string, unknown>) {
      this.options = options;
      created.push(this);
    }
    handlers = new Map<string, (...a: unknown[]) => void>();
    on(ev: string, fn: (...a: unknown[]) => void) {
      this.handlers.set(ev, fn);
      return this;
    }
    connect = vi.fn(async () => {});
    canPlaybackAudio = true;
    startAudio = vi.fn(async () => {});
    disconnect = vi.fn();
  }
  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_t, k) => String(k) }),
    Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
    ConnectionQuality: { Poor: 'poor', Lost: 'lost', Good: 'good' },
    VideoPresets: { h360: { resolution: { width: 640, height: 360 } } },
  };
});

import { CallMedia } from '@/shared/media/room';

describe('CallMedia room options', () => {
  beforeEach(() => (created.length = 0));

  it('enables adaptive stream and dynacast and sets WebRTC audio processing explicitly', async () => {
    await new CallMedia().join({ url: 'wss://lk.example', token: 't' });
    expect(created).toHaveLength(1);
    expect(created[0]!.options).toMatchObject({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: { width: 640, height: 360 } },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  });

  it('stops camera and microphone capture when the call ends', async () => {
    const media = new CallMedia();
    await media.join({ url: 'wss://lk.example', token: 't' });
    media.leave();
    expect(created[0]!.stopped.sort()).toEqual(['cam', 'mic']);
  });

  it('releases a camera that finished starting after the call was gone', async () => {
    const media = new CallMedia();
    await media.join({ url: 'wss://lk.example', token: 't' });
    const room = created[0]!;
    let done!: () => void;
    room.localParticipant.setCameraEnabled.mockImplementationOnce(() => new Promise<void>(r => (done = r)));
    media.setCamera(true);
    media.leave();
    room.stopped.length = 0;
    done();
    await Promise.resolve();
    await Promise.resolve();
    expect(room.stopped).toContain('cam');
  });

  describe('weak signal', () => {
    const quality = (room: MockRoom, q: string) => room.handlers.get('ConnectionQualityChanged')!(q, { isLocal: true });

    it('drops our camera on poor quality and brings it back only after a stable period', async () => {
      vi.useFakeTimers();
      const media = new CallMedia();
      const patches: Record<string, boolean>[] = [];
      media.onChange(p => patches.push(p as Record<string, boolean>));
      await media.join({ url: 'wss://lk.example', token: 't' });
      media.setCamera(true);
      const cam = created[0]!.localParticipant.setCameraEnabled;
      cam.mockClear();

      quality(created[0]!, 'poor');
      expect(cam).toHaveBeenLastCalledWith(false);
      expect(patches).toContainEqual({ audioOnly: true });

      quality(created[0]!, 'good');
      vi.advanceTimersByTime(14_999);
      expect(patches).not.toContainEqual({ audioOnly: false });
      quality(created[0]!, 'poor'); // перебій скидає відлік
      quality(created[0]!, 'good');
      vi.advanceTimersByTime(14_999);
      expect(patches).not.toContainEqual({ audioOnly: false });
      vi.advanceTimersByTime(1);
      expect(patches).toContainEqual({ audioOnly: false });
      expect(cam).toHaveBeenLastCalledWith(true);
      vi.useRealTimers();
    });

    it('does not turn the camera on when the user had it off', async () => {
      vi.useFakeTimers();
      const media = new CallMedia();
      await media.join({ url: 'wss://lk.example', token: 't' });
      media.setCamera(false);
      const cam = created[0]!.localParticipant.setCameraEnabled;
      quality(created[0]!, 'poor');
      quality(created[0]!, 'good');
      vi.advanceTimersByTime(15_000);
      expect(cam).toHaveBeenLastCalledWith(false);
      vi.useRealTimers();
    });
  });

  describe('audio autoplay', () => {
    it('still publishes the microphone and reports a block when startAudio is rejected', async () => {
      const media = new CallMedia();
      const patches: Record<string, boolean>[] = [];
      media.onChange(p => patches.push(p as Record<string, boolean>));
      const orig = created.length;
      const p = media.join({ url: 'wss://lk.example', token: 't' });
      const room = created[orig]!;
      room.startAudio.mockRejectedValueOnce(new Error('NotAllowedError'));
      room.canPlaybackAudio = false;
      await p;
      expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalled();
      expect(patches).toContainEqual({ audioBlocked: true });
    });

    it('reports the block from the room event and clears it after enableAudio', async () => {
      const media = new CallMedia();
      const patches: Record<string, boolean>[] = [];
      media.onChange(p => patches.push(p as Record<string, boolean>));
      await media.join({ url: 'wss://lk.example', token: 't' });
      const room = created.at(-1)!;
      room.canPlaybackAudio = false;
      room.handlers.get('AudioPlaybackStatusChanged')!(false);
      expect(patches.at(-1)).toEqual({ audioBlocked: true });
      room.canPlaybackAudio = true;
      await media.enableAudio();
      expect(room.startAudio).toHaveBeenCalledTimes(2);
      expect(patches.at(-1)).toEqual({ audioBlocked: false });
    });
  });
});
