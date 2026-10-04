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
  /** Слабкий канал співрозмовника: його відео не качаємо (фрізи), звук і наша камера працюють. */
  peerWeak: boolean;
  /** Слабкий канал: свою камеру вимкнено, відео співрозмовника не качаємо, лишився звук (повертається, коли канал стабільний). */
  audioOnly: boolean;
  /** Мікрофон не вдалося ввімкнути (немає пристрою чи дозволу). */
  micError: boolean;
  /** Камеру не вдалося ввімкнути (немає пристрою чи дозволу). */
  camError: boolean;
  /** Чому камера не ввімкнулась: `denied` (немає дозволу), `busy` (її тримає інша програма чи вкладка), `none` (пристрою немає), порожньо (інше). */
  camReason: CamReason;
}

export type CamReason = '' | 'denied' | 'busy' | 'none';

/** Причина збою `getUserMedia` за назвою помилки браузера. */
export function camReasonOf(e: unknown): CamReason {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDenied') return 'denied';
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'busy';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'none';
  return '';
}

/** Пристрій звуку для меню вибору (`label` порожній, поки браузер не дав дозвіл на мікрофон). */
export interface AudioDevice {
  id: string;
  label: string;
}

/** Пристрої розмови: `cameras` — камери для «Перемкнути камеру»; `canPickOutput` — чи дозволяє браузер обирати вивід (`setSinkId`: Chromium; Safari і Firefox ні). */
export interface CallDevices {
  outputs: AudioDevice[];
  inputs: AudioDevice[];
  cameras: AudioDevice[];
  canPickOutput: boolean;
}

/** Скільки канал має бути нормальним, щоб після слабкого сигналу повернути відео. */
const RECOVER_MS = 15_000;

/**
 * Слабкий канал з гістерезисом: `set(true)` вмикає одразу, `set(false)` вимикає лише коли канал `RECOVER_MS` без перебоїв нормальний
 * (будь-який новий поганий стан скидає відлік), щоб не мигало на межі. `onChange` викликається при зміні `active`.
 */
class WeakLink {
  active = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private onChange: () => void) {}

  set(bad: boolean) {
    if (bad) {
      clearTimeout(this.timer);
      this.timer = undefined;
      if (this.active) return;
      this.active = true;
      this.onChange();
      return;
    }
    if (!this.active || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.active = false;
      this.onChange();
    }, RECOVER_MS);
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.active = false;
  }
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
  /** Вибрані пристрої звуку (`default`: типовий); діють на всі наступні розмови, поки сторінка відкрита. */
  private outId = 'default';
  private inId = 'default';
  private camId = 'default';
  /** Наш канал слабкий: камеру вимкнено, відео співрозмовника не качаємо. */
  private own = new WeakLink(() => this.syncOwn());
  /** Канал співрозмовника слабкий: його відео фризить, не качаємо лише його (наша камера працює). */
  private peerLink = new WeakLink(() => this.syncPeer());
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

  /** Пристрої звуку для меню вибору (дублі `communications` ховаємо). */
  async audioDevices(): Promise<CallDevices> {
    const canPickOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const pick = (kind: MediaDeviceKind) =>
        all
          .filter(d => d.kind === kind && d.deviceId !== 'communications')
          .map(d => ({ id: d.deviceId, label: d.label }));
      return { outputs: pick('audiooutput'), inputs: pick('audioinput'), cameras: pick('videoinput'), canPickOutput };
    } catch {
      return { outputs: [], inputs: [], cameras: [], canPickOutput };
    }
  }

  /** Зміна списку пристроїв (підключили чи відключили навушники); повертає відписку. */
  onDevicesChange(fn: () => void) {
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', fn);
    return () => md?.removeEventListener?.('devicechange', fn);
  }

  /** Вибір пристрою виводу чи входу: запам'ятовуємо для наступних розмов і застосовуємо до поточної. */
  async pickAudio(kind: 'output' | 'input', id: string) {
    if (kind === 'output') this.outId = id;
    else this.inId = id;
    await this.cur?.room
      .switchActiveDevice(kind === 'output' ? 'audiooutput' : 'audioinput', id)
      .catch(e => console.warn('audio device', e));
  }

  /** «Перемкнути камеру»: наступна з камер по колу (фронтальна ↔ задня), запам'ятовується для наступних розмов. */
  async switchCamera() {
    const { cameras } = await this.audioDevices();
    if (cameras.length < 2) return;
    const i = cameras.findIndex(c => c.id === this.camId);
    this.camId = cameras[(i + 1) % cameras.length]!.id;
    await this.cur?.room.switchActiveDevice('videoinput', this.camId).catch(e => console.warn('camera', e));
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
    this.resetWeak();
    const s: Session = {
      room: new Room({
        // обидва типово вимкнені: adaptiveStream не качає відео, чий <video> прихований чи відмонтований (утримання, аватар, мініатюра без відео),
        // dynacast не кодує шари симулкасту, яких ніхто не дивиться (work/backlog/livekit-recommendations.md)
        adaptiveStream: true,
        dynacast: true,
        // явно, щоб не залежати від типових значень браузера: ехо, шум і гучність обробляє WebRTC (не Krisp чи RNNoise)
        // мобільний канал: камера 640 × 360 (типово 720p) і simulcast з нижчими шарами, щоб відео не гальмувало на 3G
        videoCaptureDefaults: {
          resolution: VideoPresets.h360.resolution,
          ...(this.camId !== 'default' && { deviceId: this.camId }),
        },
        audioCaptureDefaults: {
          ...(this.inId !== 'default' && { deviceId: this.inId }),
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
        if (this.videoPaused && s === this.cur) pub?.setEnabled?.(false);
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
      const bad = q === ConnectionQuality.Poor || q === ConnectionQuality.Lost;
      if (p.isLocal) {
        emit({ poor: bad });
        if (s === this.cur) this.own.set(bad);
      } else if (s === this.cur) this.peerLink.set(bad);
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
      if (this.outId !== 'default') await room.switchActiveDevice('audiooutput', this.outId).catch(() => {});
      if (s === this.cur) this.apply();
      else this.silence(s);
    } catch (e) {
      console.warn('livekit', e);
    }
  }

  /** Відео співрозмовника не качаємо, якщо слабкий наш канал чи його. */
  private get videoPaused() {
    return this.own.active || this.peerLink.active;
  }

  /**
   * Слабкий наш канал (`Poor`, `Lost`, див. `WeakLink`): лишаємо звук, свою камеру й відео співрозмовника вимикаємо.
   * Користувацькі `micOn`/`camOn` не змінюються: після відновлення все повертається за ними.
   */
  private syncOwn() {
    this.emit({ audioOnly: this.own.active });
    this.apply();
    this.syncRemoteVideo();
  }

  /** Слабкий канал співрозмовника: вимикаємо лише його відео (фрізи), наша камера працює. */
  private syncPeer() {
    this.emit({ peerWeak: this.peerLink.active });
    this.syncRemoteVideo();
  }

  private syncRemoteVideo() {
    this.cur?.room.remoteParticipants?.forEach(p =>
      p.videoTrackPublications?.forEach(pub => pub.setEnabled?.(!this.videoPaused)),
    );
  }

  private resetWeak() {
    this.own.reset();
    this.peerLink.reset();
  }

  /** Перезапуск треку камери: вимикаємо й вмикаємо за поточним станом (`apply`). Допомагає, коли камера не віддає кадр. */
  async restartCamera() {
    await this.cur?.room.localParticipant.setCameraEnabled(false).catch(() => {});
    this.apply();
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
    this.resetWeak();
    [this.cur, this.parked] = [this.parked, this.cur];
    if (this.parked) this.silence(this.parked);
    this.emit({
      peerCam: !!this.cur?.remoteVideo,
      peerAway: false,
      peerMuted: false,
      audioOnly: false,
      peerWeak: false,
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
    this.resetWeak();
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

  private get wantMic() {
    return this.micOn && !this.deaf;
  }

  private get wantCam() {
    return this.camOn && !this.deaf && !this.own.active;
  }

  /** Черга вмикань пристроїв: кожен запуск читає актуальні побажання, тож запізніле вмикання не переживе вимкнення. */
  private queue: Promise<void> = Promise.resolve();

  private apply() {
    this.cur?.els.forEach(el => (el.muted = this.deaf));
    this.queue = this.queue.then(() => this.applyDevices()).catch(() => {});
  }

  /**
   * Мікрофон і камера вмикаються по черзі: паралельні `getUserMedia` на Android Chrome ламають один із пристроїв.
   * Якщо камера не ввімкнулась, її захоплення знімаємо, щоб індикатор камери не горів без публікації.
   */
  private async applyDevices() {
    const s = this.cur;
    const lp = s?.room.localParticipant;
    if (!s || !lp) return;
    try {
      await lp.setMicrophoneEnabled(this.wantMic);
    } catch (e) {
      console.warn('microphone', e);
      if (this.wantMic) this.emit({ micError: true });
    }
    try {
      await lp.setCameraEnabled(this.wantCam);
    } catch (e) {
      console.warn('camera', e);
      lp.getTrackPublication(Track.Source.Camera)?.track?.stop();
      this.emit({ camError: true, camReason: camReasonOf(e) });
    }
    // поки пристрої вмикались, сесія вже не поточна (завершена чи утримана): знімаємо захоплення
    if (s !== this.cur) this.release(s);
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
