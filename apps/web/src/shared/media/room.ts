import type { LiveKitAccess } from '@dialer/shared';
import { ConnectionQuality, Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';

/** Стан зв'язку, який видно з кімнати: показується плашками Call State. */
export interface LinkState {
  reconnecting: boolean;
  poor: boolean;
  peerAway: boolean;
  peerMuted: boolean;
  /** Співрозмовник публікує камеру. */
  peerCam: boolean;
  /** Наша камера справді публікується. */
  localCam: boolean;
  /** Мікрофон не вдалося ввімкнути (немає пристрою чи дозволу). */
  micError: boolean;
  /** Камеру не вдалося ввімкнути (немає пристрою чи дозволу). */
  camError: boolean;
}

/** Обгортка над livekit-client: аудіо розмови. Мікрофон і приглушення співрозмовника керуються ззовні. */
export class CallMedia {
  private room?: Room;
  private els: HTMLMediaElement[] = [];
  private gen = 0;
  private micOn = true;
  private camOn = true;
  private remoteVideo?: RemoteTrack;
  private deaf = false;
  private listeners = new Set<(patch: Partial<LinkState>) => void>();

  onChange(fn: (patch: Partial<LinkState>) => void) {
    this.listeners.add(fn);
  }

  private emit(patch: Partial<LinkState>) {
    this.listeners.forEach(f => f(patch));
  }

  /** Чи є камера (без запиту дозволу): список пристроїв видно й до дозволу. */
  async hasCamera() {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).some(d => d.kind === 'videoinput');
    } catch {
      return false;
    }
  }

  async hasMicrophone() {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).some(d => d.kind === 'audioinput');
    } catch {
      return false;
    }
  }

  async join(access: LiveKitAccess) {
    this.leave();
    const gen = this.gen;
    const room = (this.room = new Room());
    room.on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => {
      if (t.kind === 'video') {
        this.remoteVideo = t;
        this.emit({ peerCam: true });
        return;
      }
      if (t.kind !== 'audio') return;
      const el = t.attach();
      el.muted = this.deaf;
      document.body.append(el);
      this.els.push(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => {
      if (t.kind === 'video') {
        t.detach();
        this.remoteVideo = undefined;
        this.emit({ peerCam: false });
        return;
      }
      t.detach().forEach(el => {
        el.remove();
        this.els = this.els.filter(x => x !== el);
      });
    });
    room.on(RoomEvent.LocalTrackPublished, pub => pub.source === Track.Source.Camera && this.emit({ localCam: true }));
    room.on(
      RoomEvent.LocalTrackUnpublished,
      pub => pub.source === Track.Source.Camera && this.emit({ localCam: false }),
    );
    room.on(RoomEvent.Reconnecting, () => this.emit({ reconnecting: true }));
    room.on(RoomEvent.Reconnected, () => this.emit({ reconnecting: false }));
    room.on(
      RoomEvent.ConnectionQualityChanged,
      (q, p) => p.isLocal && this.emit({ poor: q === ConnectionQuality.Poor || q === ConnectionQuality.Lost }),
    );
    room.on(RoomEvent.ParticipantDisconnected, () => this.emit({ peerAway: true }));
    room.on(RoomEvent.ParticipantConnected, () => this.emit({ peerAway: false }));
    room.on(RoomEvent.TrackMuted, (pub, p) => {
      if (p.isLocal) return;
      if (pub.source === Track.Source.Microphone) this.emit({ peerMuted: true });
      if (pub.source === Track.Source.Camera) this.emit({ peerCam: false });
    });
    room.on(RoomEvent.TrackUnmuted, (pub, p) => {
      if (p.isLocal) return;
      if (pub.source === Track.Source.Microphone) this.emit({ peerMuted: false });
      if (pub.source === Track.Source.Camera) this.emit({ peerCam: true });
    });
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

  setCamera(on: boolean) {
    this.camOn = on;
    this.apply();
  }

  /** Показує відео в елементі: `remote` співрозмовника, `local` нашу камеру. */
  attach(kind: 'local' | 'remote', el: HTMLVideoElement) {
    const track =
      kind === 'remote'
        ? this.remoteVideo
        : this.room?.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    track?.attach(el);
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
    this.remoteVideo = undefined;
    this.els.forEach(el => el.remove());
    this.els = [];
  }

  private apply() {
    const lp = this.room?.localParticipant;
    const wantMic = this.micOn && !this.deaf;
    void lp?.setMicrophoneEnabled(wantMic).catch(() => wantMic && this.emit({ micError: true }));
    void lp?.setCameraEnabled(this.camOn && !this.deaf).catch(() => this.emit({ camError: true }));
    this.els.forEach(el => (el.muted = this.deaf));
  }
}
