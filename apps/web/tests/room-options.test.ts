import { beforeEach, describe, expect, it, vi } from 'vitest';

const created: { options: Record<string, unknown> }[] = [];

vi.mock('livekit-client', () => {
  class Room {
    options: Record<string, unknown>;
    localParticipant = { setMicrophoneEnabled: vi.fn(async () => {}), setCameraEnabled: vi.fn(async () => {}) };
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
});
