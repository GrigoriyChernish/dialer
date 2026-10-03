import { beforeEach, describe, expect, it, vi } from 'vitest';

const created: { options: Record<string, unknown>; stopped: string[] }[] = [];

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
    on() {
      return this;
    }
    connect = vi.fn(async () => {});
    startAudio = vi.fn(async () => {});
    disconnect = vi.fn();
  }
  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_t, k) => String(k) }),
    Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
    ConnectionQuality: { Poor: 'poor', Lost: 'lost' },
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
    const room = created[0] as unknown as { localParticipant: { setCameraEnabled: ReturnType<typeof vi.fn> }; stopped: string[] };
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
});
