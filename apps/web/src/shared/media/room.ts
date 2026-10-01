import type { LiveKitAccess } from '@dialer/shared';
import { ConnectionQuality, Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';

/** Стан зв'язку, який видно з кімнати: показується плашками Call State. */
export interface LinkState {
  reconnecting: boolean;
  poor: boolean;
  peerAway: boolean;
  peerMuted: boolean;
}

/** Обгортка над livekit-client: аудіо розмови. Мікрофон і приглушення співрозмовника керуються ззовні. */
export class CallMedia {
  private room?: Room;
  private els: HTMLMediaElement[] = [];
  private gen = 0;
  private micOn = true;
  private deaf = false;
  private listeners = new Set<(patch: Partial<LinkState>) => void>();

  onChange(fn: (patch: Partial<LinkState>) => void) {
    this.listeners.add(fn);
  }

  private emit(patch: Partial<LinkState>) {
    this.listeners.forEach((f) => f(patch));
  }

  async join(access: LiveKitAccess) {
    this.leave();
    const gen = this.gen;
    const room = (this.room = new Room());
    room.on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => {
      if (t.kind !== 'audio') return;
      const el = t.attach();
      el.muted = this.deaf;
      document.body.append(el);
      this.els.push(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) =>
      t.detach().forEach((el) => {
        el.remove();
        this.els = this.els.filter((x) => x !== el);
      }),
    );
    room.on(RoomEvent.Reconnecting, () => this.emit({ reconnecting: true }));
    room.on(RoomEvent.Reconnected, () => this.emit({ reconnecting: false }));
    room.on(RoomEvent.ConnectionQualityChanged, (q, p) => p.isLocal && this.emit({ poor: q === ConnectionQuality.Poor || q === ConnectionQuality.Lost }));
    room.on(RoomEvent.ParticipantDisconnected, () => this.emit({ peerAway: true }));
    room.on(RoomEvent.ParticipantConnected, () => this.emit({ peerAway: false }));
    room.on(RoomEvent.TrackMuted, (pub, p) => !p.isLocal && pub.source === Track.Source.Microphone && this.emit({ peerMuted: true }));
    room.on(RoomEvent.TrackUnmuted, (pub, p) => !p.isLocal && pub.source === Track.Source.Microphone && this.emit({ peerMuted: false }));
    try {
      await room.connect(access.url, access.token);
      if (gen !== this.gen) return void room.disconnect();
      await room.startAudio();
      this.apply();
    } catch (e) {
      console.warn('livekit', e);
    }
  }

  setMic(on: boolean) {
    this.micOn = on;
    this.apply();
  }

  /** Утримання: не чуємо співрозмовника. */
  setDeaf(deaf: boolean) {
    this.deaf = deaf;
    this.apply();
  }

  leave() {
    this.gen++;
    this.room?.disconnect();
    this.room = undefined;
    this.els.forEach((el) => el.remove());
    this.els = [];
  }

  private apply() {
    void this.room?.localParticipant.setMicrophoneEnabled(this.micOn && !this.deaf).catch(() => {});
    this.els.forEach((el) => (el.muted = this.deaf));
  }
}
