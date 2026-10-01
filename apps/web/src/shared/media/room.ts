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

/** Підключення до однієї кімнати: свої елементи аудіо й відео співрозмовника. */
interface Session {
  room: Room;
  els: HTMLMediaElement[];
  remoteVideo?: RemoteTrack;
}

/**
 * Обгортка над livekit-client: аудіо й відео розмови. Мікрофон і приглушення співрозмовника керуються ззовні.
 * Утримуваний другий дзвінок (`park`) лишається в своїй кімнаті, але мовчить: не чуємо його й не надсилаємо нічого (docs/signaling.md, «Медіа»).
 */
export class CallMedia {
  private cur?: Session;
  private parked?: Session;
  private micOn = true;
  private camOn = true;
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
    const s: Session = { room: new Room(), els: [] };
    this.cur = s;
    const room = s.room;
    // події утримуваної кімнати не показуємо: стан зв'язку належить поточній розмові
    const emit = (patch: Partial<LinkState>) => s === this.cur && this.emit(patch);
    room.on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => {
      if (t.kind === 'video') {
        s.remoteVideo = t;
        emit({ peerCam: true });
        return;
      }
      if (t.kind !== 'audio') return;
      const el = t.attach();
      el.muted = s !== this.cur || this.deaf;
      document.body.append(el);
      s.els.push(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) => {
      if (t.kind === 'video') {
        t.detach();
        s.remoteVideo = undefined;
        emit({ peerCam: false });
        return;
      }
      t.detach().forEach(el => {
        el.remove();
        s.els = s.els.filter(x => x !== el);
      });
    });
    room.on(RoomEvent.LocalTrackPublished, pub => pub.source === Track.Source.Camera && emit({ localCam: true }));
    room.on(RoomEvent.LocalTrackUnpublished, pub => pub.source === Track.Source.Camera && emit({ localCam: false }));
    room.on(RoomEvent.Reconnecting, () => emit({ reconnecting: true }));
    room.on(RoomEvent.Reconnected, () => emit({ reconnecting: false }));
    room.on(
      RoomEvent.ConnectionQualityChanged,
      (q, p) => p.isLocal && emit({ poor: q === ConnectionQuality.Poor || q === ConnectionQuality.Lost }),
    );
    room.on(RoomEvent.ParticipantDisconnected, () => emit({ peerAway: true }));
    room.on(RoomEvent.ParticipantConnected, () => emit({ peerAway: false }));
    room.on(RoomEvent.TrackMuted, (pub, p) => {
      if (p.isLocal) return;
      if (pub.source === Track.Source.Microphone) emit({ peerMuted: true });
      if (pub.source === Track.Source.Camera) emit({ peerCam: false });
    });
    room.on(RoomEvent.TrackUnmuted, (pub, p) => {
      if (p.isLocal) return;
      if (pub.source === Track.Source.Microphone) emit({ peerMuted: false });
      if (pub.source === Track.Source.Camera) emit({ peerCam: true });
    });
    try {
      await room.connect(access.url, access.token);
      // поки підключались, дзвінок завершили; якщо його лише утримали (park), кімната лишається
      if (s !== this.cur && s !== this.parked) return void room.disconnect();
      await room.startAudio();
      if (s === this.cur) this.apply();
      else this.silence(s);
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
        ? this.cur?.remoteVideo
        : this.cur?.room.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack;
    track?.attach(el);
  }

  /** Утримання: не чуємо співрозмовника. */
  setDeaf(deaf: boolean) {
    this.deaf = deaf;
    this.apply();
  }

  /** Поточна розмова стає утримуваною: кімната лишається, але мовчить. Наступний `join` підключає новий дзвінок. */
  park() {
    if (!this.cur) return;
    this.dropParked();
    this.parked = this.cur;
    this.cur = undefined;
    this.silence(this.parked);
  }

  /** Міняє місцями поточну й утримувану кімнати. `false`, якщо утримуваної немає (наприклад, після перезавантаження). */
  swap() {
    if (!this.parked) return false;
    [this.cur, this.parked] = [this.parked, this.cur];
    if (this.parked) this.silence(this.parked);
    this.emit({ peerCam: !!this.cur?.remoteVideo, peerAway: false, peerMuted: false });
    this.apply();
    return true;
  }

  /** Утримуваний дзвінок завершився. */
  dropParked() {
    if (this.parked) this.close(this.parked);
    this.parked = undefined;
  }

  /** Завершує поточну розмову; утримувана лишається. */
  leave() {
    if (this.cur) this.close(this.cur);
    this.cur = undefined;
  }

  private close(s: Session) {
    s.room.disconnect();
    s.els.forEach(el => el.remove());
    s.els = [];
    s.remoteVideo = undefined;
  }

  private silence(s: Session) {
    const lp = s.room.localParticipant;
    void lp.setMicrophoneEnabled(false).catch(() => {});
    void lp.setCameraEnabled(false).catch(() => {});
    s.els.forEach(el => (el.muted = true));
  }

  private apply() {
    const lp = this.cur?.room.localParticipant;
    const wantMic = this.micOn && !this.deaf;
    void lp?.setMicrophoneEnabled(wantMic).catch(() => wantMic && this.emit({ micError: true }));
    void lp?.setCameraEnabled(this.camOn && !this.deaf).catch(() => this.emit({ camError: true }));
    this.cur?.els.forEach(el => (el.muted = this.deaf));
  }
}
