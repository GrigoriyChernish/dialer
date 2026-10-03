import type { LiveKitAccess } from '@dialer/shared';
import { ConnectionQuality, Room, RoomEvent, Track, VideoPresets, type RemoteTrack } from 'livekit-client';
import { requestMediaPermissions, watchMediaPermissions, type PermissionStatusResult } from './permissions';

/** Стан зв'язку, який видно з кімнати: показується плашками Call State. */
export interface LinkState {
  reconnecting: boolean;
  poor: boolean;
  peerAway: boolean;
  peerMuted: boolean;
  /** Співрозмовник зараз говорить (серед активних мовців кімнати є віддалений учасник). */
  peerSpeaking: boolean;
  /** Співрозмовник публікує камеру. */
  peerCam: boolean;
  /** Наша камера справді публікується. */
  localCam: boolean;
  /** Браузер заблокував відтворення звуку співрозмовника (автовідтворення), потрібне натискання «Увімкнути звук». */
  audioBlocked: boolean;
  /** Слабкий канал: свою камеру вимкнено, відео співрозмовника не качаємо, лишився звук (повертається, коли канал стабільний). */
  audioOnly: boolean;
  /** Мікрофон не вдалося ввімкнути (немає пристрою чи дозволу). */
  micError: boolean;
  /** Камеру не вдалося ввімкнути (немає пристрою чи дозволу). */
  camError: boolean;
}

/** Скільки канал має бути нормальним, щоб після слабкого сигналу повернути відео. */
const RECOVER_MS = 15_000;

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
  private degraded = false;
  private recoverTimer?: ReturnType<typeof setTimeout>;
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
    this.resetDegraded();
    const s: Session = {
      room: new Room({
        // обидва типово вимкнені: adaptiveStream не качає відео, чий <video> прихований чи відмонтований (утримання, аватар, мініатюра без відео),
        // dynacast не кодує шари симулкасту, яких ніхто не дивиться (docs/livekit-recommendations.md)
        adaptiveStream: true,
        dynacast: true,
        // явно, щоб не залежати від типових значень браузера: ехо, шум і гучність обробляє WebRTC (не Krisp чи RNNoise)
        // мобільний канал: камера 640 × 360 (типово 720p) і simulcast з нижчими шарами, щоб відео не гальмувало на 3G
        videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
      els: [],
    };
    this.cur = s;
    const room = s.room;
    // події утримуваної кімнати не показуємо: стан зв'язку належить поточній розмові
    const emit = (patch: Partial<LinkState>) => s === this.cur && this.emit(patch);
    room.on(RoomEvent.TrackSubscribed, (t: RemoteTrack, pub) => {
      if (t.kind === 'video') {
        if (this.degraded && s === this.cur) pub?.setEnabled?.(false);
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
    room.on(RoomEvent.AudioPlaybackStatusChanged, ok => emit({ audioBlocked: !ok }));
    room.on(RoomEvent.Reconnecting, () => emit({ reconnecting: true }));
    room.on(RoomEvent.Reconnected, () => emit({ reconnecting: false }));
    room.on(RoomEvent.ConnectionQualityChanged, (q, p) => {
      if (!p.isLocal) return;
      const bad = q === ConnectionQuality.Poor || q === ConnectionQuality.Lost;
      emit({ poor: bad });
      if (s === this.cur) this.degrade(bad);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, speakers => emit({ peerSpeaking: speakers.some(p => !p.isLocal) }));
    room.on(RoomEvent.ParticipantDisconnected, () => emit({ peerAway: true, peerSpeaking: false }));
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
      // без жесту користувача startAudio відхиляється: це не привід не вмикати мікрофон, а сигнал показати «Увімкнути звук»
      await room.startAudio().catch(() => {});
      emit({ audioBlocked: !room.canPlaybackAudio });
      if (s === this.cur) this.apply();
      else this.silence(s);
    } catch (e) {
      console.warn('livekit', e);
    }
  }

  /**
   * Слабкий канал (`Poor`, `Lost`): одразу лишаємо звук, а відео вимикаємо; вмикаємо назад, коли канал `RECOVER_MS` без перебоїв нормальний,
   * щоб не мигало на межі. Користувацькі `micOn`/`camOn` не змінюються: після відновлення все повертається за ними.
   */
  private degrade(bad: boolean) {
    if (bad) {
      clearTimeout(this.recoverTimer);
      this.recoverTimer = undefined;
      if (this.degraded) return;
      this.degraded = true;
    } else {
      if (!this.degraded || this.recoverTimer) return;
      this.recoverTimer = setTimeout(() => {
        this.recoverTimer = undefined;
        this.degraded = false;
        this.syncDegraded();
      }, RECOVER_MS);
      return;
    }
    this.syncDegraded();
  }

  private syncDegraded() {
    this.emit({ audioOnly: this.degraded });
    this.apply();
    this.cur?.room.remoteParticipants?.forEach(p =>
      p.videoTrackPublications?.forEach(pub => pub.setEnabled?.(!this.degraded)),
    );
  }

  private resetDegraded() {
    clearTimeout(this.recoverTimer);
    this.recoverTimer = undefined;
    this.degraded = false;
  }

  /** Кнопка «Увімкнути звук»: `startAudio` має викликатись із жесту користувача. */
  async enableAudio() {
    const room = this.cur?.room;
    if (!room) return;
    await room.startAudio().catch(() => {});
    this.emit({ audioBlocked: !room.canPlaybackAudio });
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
    this.resetDegraded();
    [this.cur, this.parked] = [this.parked, this.cur];
    if (this.parked) this.silence(this.parked);
    this.emit({
      peerCam: !!this.cur?.remoteVideo,
      peerAway: false,
      peerMuted: false,
      audioOnly: false,
      audioBlocked: !!this.cur && !this.cur.room.canPlaybackAudio,
    });
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
    this.resetDegraded();
    if (this.cur) this.close(this.cur);
    this.cur = undefined;
  }

  /**
   * Зупиняє захоплення камери й мікрофона сесії. `setCameraEnabled(true)` може завершитись уже після `disconnect` (дзвінок скінчився, поки камера
   * ще вмикалась): трек тоді нікому не належить і тримає камеру, а Chrome показує, що сайт її використовує, навіть без розмови.
   */
  private release(s: Session) {
    s.room.localParticipant.trackPublications?.forEach(pub => pub.track?.stop());
  }

  private close(s: Session) {
    this.release(s);
    s.room.disconnect();
    s.els.forEach(el => el.remove());
    s.els = [];
    s.remoteVideo = undefined;
  }

  private silence(s: Session) {
    const lp = s.room.localParticipant;
    void lp.setMicrophoneEnabled(false).catch(() => {});
    void lp
      .setCameraEnabled(false)
      .catch(() => {})
      .then(() => this.release(s));
    s.els.forEach(el => (el.muted = true));
  }

  private apply() {
    const s = this.cur;
    const lp = s?.room.localParticipant;
    const wantMic = this.micOn && !this.deaf;
    // якщо поки пристрій вмикався, сесія вже не поточна (завершена чи утримана), знімаємо захоплення
    const settled = () => s && s !== this.cur && this.release(s);
    void lp
      ?.setMicrophoneEnabled(wantMic)
      .catch(() => wantMic && this.emit({ micError: true }))
      .then(settled);
    void lp
      ?.setCameraEnabled(this.camOn && !this.deaf && !this.degraded)
      .catch(() => this.emit({ camError: true }))
      .then(settled);
    this.cur?.els.forEach(el => (el.muted = this.deaf));
  }

  /** Запит дозволів на аудіо та відео до першого дзвінка. */
  async requestPermissions() {
    return requestMediaPermissions();
  }

  /** Підписка на статус дозволів браузера та стан пристроїв. */
  watchPermissions(fn: (res: PermissionStatusResult) => void) {
    return watchMediaPermissions(fn);
  }
}
