import {
  DEFAULT_SETTINGS,
  type CallInfo,
  type Contact,
  type EndReason,
  type LiveKitAccess,
  type Peer,
  type RecentEntry,
  type ServerMessage,
  type Settings,
} from '@dialer/shared';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { usePrefsStore } from '@/features/settings/prefs';
import type { LinkState } from '@/shared/media/room';
import type { SoundKind } from '@/shared/sounds/sounds';
import { holdFlag, latestPeerState, trackSince, type PeerSince } from './peerState';

export type CallStatus = 'idle' | 'ringing' | 'incoming' | 'connected';
/** Екран результату: дзвінок не відбувся (`busy` … `error`) або розмова скінчилась не з нашої волі (`ended`, `lost`, `dropped`). */
export type MissedReason = 'busy' | 'rejected' | 'timeout' | 'incoming' | 'error' | 'ended' | 'lost' | 'dropped';

/** Те, що стору потрібно від зовнішнього світу: так його легко тестувати без мережі й звуку. */
export interface CallDeps {
  client: {
    request(type: string, payload?: object): Promise<ServerMessage>;
    on(fn: (m: ServerMessage) => void): () => void;
    onStatus(fn: (open: boolean, error?: string) => void): () => void;
  };
  media: {
    join(a: { url: string; token: string }): Promise<void>;
    leave(): void;
    setMic(on: boolean): void;
    setDeaf(d: boolean): void;
    onChange?(fn: (patch: Partial<LinkState>) => void): void;
    setCamera?(on: boolean): void;
    hasCamera?(): Promise<boolean>;
    hasMicrophone?(): Promise<boolean>;
    attach?(kind: 'local' | 'remote', el: HTMLVideoElement): void;
    park?(): void;
    swap?(): boolean;
    dropParked?(): void;
    requestPermissions?(): Promise<{ audio: boolean; video: boolean }>;
    watchPermissions?(fn: (res: { micDenied: boolean; camDenied: boolean }) => void): () => void;
  };
  sounds: { play(kind: SoundKind | null, ms?: number): void };
}

/** Розмова, яку ми утримуємо, поки говоримо з іншим (після «Утримати й прийняти»). */
export interface HeldCall {
  callId: string;
  peer: Peer;
  startedAt: number;
  peerHold: boolean;
  livekit?: LiveKitAccess;
}

const HINT_MS = 4000;
/**
 * Екран «Дзвінок завершено» після того, як поклав слухавку співрозмовник, закривається сам.
 * Новий дзвінок (вхідний чи наш) закриває його одразу й гасить таймер (`setMissed(null)` в `applyCall`/`call`).
 */
const ENDED_MS = 10_000;
const SEEN_KEY = 'dialer.missedSeen';
const loadSeen = () => {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
};

const ERRORS: Record<string, string> = {
  already_in_call: 'call.err.alreadyInCall',
  invalid_target: 'call.err.invalidTarget',
  rate_limited: 'call.err.rateLimited',
  offline: 'call.err.offline',
};

/**
 * Стан дзвінка належить серверу: стор надсилає наміри (`call.invite`, `call.accept` …),
 * а екрани міняє лише за подіями сервера (docs/signaling.md).
 */
export const useCallStore = defineStore('call', () => {
  let deps: CallDeps;
  const prefs = usePrefsStore();

  const online = ref(false);
  /** Перший `hello.ok` прийшов. Після обриву не скидається: старі дані показуємо, поки не прийде новий знімок. */
  const ready = ref(false);
  const netError = ref('');
  const contacts = ref<Contact[]>([]);
  const me = ref<Peer | null>(null);
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  /** Історія дзвінків, новіші першими (docs/signaling.md, «Історія»). */
  const recents = ref<RecentEntry[]>([]);
  /** Час останнього перегляду вкладки «Історія»: поки лише на цьому пристрої (беклог, пункт 13). */
  const missedSeenAt = ref(loadSeen());
  const status = ref<CallStatus>('idle');
  const callId = ref<string | null>(null);
  const peer = ref<Peer | null>(null);
  const expiresAt = ref(0);
  const startedAt = ref(0);
  const hold = ref(false);
  const peerHold = ref(false);
  const mic = ref(true);
  const NO_LINK: LinkState = {
    reconnecting: false,
    poor: false,
    peerAway: false,
    peerMuted: false,
    peerSpeaking: false,
    peerCam: false,
    localCam: false,
    micError: false,
    camError: false,
  };
  const link = ref<LinkState>({ ...NO_LINK });
  // коли настав кожен стан співрозмовника: показуємо той, що настав останнім (смужка, обводка й колір аватара в `Peer`)
  const peerSince = ref<PeerSince>({});
  watch(
    () => [peerHold.value, link.value.peerAway, link.value.peerMuted] as const,
    ([hold, lost, mic]) => {
      peerSince.value = trackSince(peerSince.value, { hold, lost, mic }, Date.now());
    },
    { flush: 'sync' },
  );
  const peerState = computed(() =>
    latestPeerState({ hold: peerHold.value, lost: link.value.peerAway, mic: link.value.peerMuted }, peerSince.value),
  );
  // індикатор голосу: тримається 250 мс після останнього звуку, щоб не блимати на паузах між словами
  const peerSpeaking = holdFlag(() => status.value === 'connected' && link.value.peerSpeaking, 250);
  const cam = ref(prefs.camOnStart);
  const selfHidden = ref(false);
  /** Камери немає чи немає дозволу: мініатюру себе не показуємо, кнопка камери неактивна. */
  const camBlocked = ref(false);
  /** Мікрофона немає чи немає дозволу: кнопка мікрофона приглушена. */
  const micBlocked = ref(false);
  /** Підказка «… недоступна» після натискання на приглушену кнопку камери чи мікрофона. */
  const hint = ref<'cam' | 'mic' | null>(null);
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  const missed = ref<{ peer: Peer; reason: MissedReason; note?: string; duration?: number } | null>(null);
  /** Другий вхідний під час розмови (docs/signaling.md, «Другий вхідний під час розмови»). */
  const waiting = ref<CallInfo | null>(null);
  const held = ref<HeldCall | null>(null);
  let livekit: LiveKitAccess | undefined;
  /** Розмова, яку завершуємо самі через «Завершити й прийняти»: її кінець без екрана результату. */
  let endingId: string | null = null;
  let endedTimer: ReturnType<typeof setTimeout> | undefined;
  const now = ref(Date.now());
  let offset = 0; // serverTime - локальний час
  let busy = false;

  /** Серверний час у локальному відліку. */
  const serverNow = computed(() => now.value + offset);
  const left = computed(() =>
    expiresAt.value ? Math.max(0, Math.ceil((expiresAt.value - serverNow.value) / 1000)) : 0,
  );
  const seconds = computed(() =>
    startedAt.value ? Math.max(0, Math.floor((serverNow.value - startedAt.value) / 1000)) : 0,
  );
  /** Ми зайняті: на дзвінку чи ввімкнено «Не турбувати». */
  const busySelf = computed(() => status.value !== 'idle' || settings.value.dnd);
  /** Мітка в шапці (дизайн: Presence, `/ busy`, `/ dnd`): дзвінок сильніший за «Не турбувати». */
  const presence = computed(() => (status.value !== 'idle' ? 'busy' : settings.value.dnd ? 'dnd' : 'free'));
  const missedCalls = computed(() => recents.value.filter(r => r.result === 'missed'));
  /** Лічильник на вкладці «Пропущені»: нові з часу перегляду, без тихих (`silent`). */
  const unseenMissed = computed(
    () => missedCalls.value.filter(r => !r.silent && r.startedAt > missedSeenAt.value).length,
  );

  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = () => (now.value = Date.now());
  function syncTimer() {
    if (status.value === 'idle') {
      clearInterval(timer);
      timer = undefined;
    } else if (!timer) {
      tick();
      timer = setInterval(tick, 1000);
    }
  }

  /** Звук із поправкою на другий вхідний: поки він дзвонить, замість тиші й мелодії утримання тихі сигнали очікування. */
  function play(kind: SoundKind | null, ms?: number) {
    if (waiting.value && (kind === null || kind === 'hold')) kind = 'waiting';
    // «Мелодія вхідних» вимкнена: без мелодії й сигналу другого вхідного
    if (!prefs.ringtone && (kind === 'ringtone' || kind === 'waiting')) kind = null;
    deps.sounds.play(kind, ms);
  }

  function reset(leaveMedia = true) {
    if (leaveMedia) deps.media.leave();
    livekit = undefined;
    status.value = 'idle';
    callId.value = null;
    peer.value = null;
    expiresAt.value = 0;
    startedAt.value = 0;
    hold.value = peerHold.value = false;
    mic.value = true;
    link.value = { ...NO_LINK };
    cam.value = prefs.camOnStart;
    camBlocked.value = false;
    micBlocked.value = false;
    hint.value = null;
    clearTimeout(hintTimer);
    selfHidden.value = false;
    syncTimer();
  }

  function applyCall(call: CallInfo) {
    callId.value = call.callId;
    peer.value = call.peer;
    setMissed(null);
    expiresAt.value = call.expiresAt ?? 0;
    if (call.state === 'connected') {
      status.value = 'connected';
      startedAt.value = call.startedAt ?? Date.now() + offset;
      hold.value = !!call.hold;
      peerHold.value = !!call.peerHold;
      livekit = call.livekit;
      enterConnected();
      if (call.livekit) void deps.media.join(call.livekit);
    } else if (call.direction === 'in') {
      status.value = 'incoming';
      play('ringtone');
    } else {
      status.value = 'ringing';
      play('ringback');
    }
    syncTimer();
  }

  /** Спільне для розмови, що почалась чи повернулась з утримання: медіа за станом стору, перевірка пристроїв. */
  function enterConnected() {
    play(peerHold.value ? 'hold' : null);
    deps.media.setDeaf(hold.value || peerHold.value);
    deps.media.setMic(mic.value);
    deps.media.setCamera?.(cam.value);
    void deps.media.hasCamera?.().then(ok => ok || blockCamera());
    void deps.media.hasMicrophone?.().then(ok => ok || blockMic());
  }

  const heldFrom = (c: CallInfo): HeldCall => ({
    callId: c.callId,
    peer: c.peer,
    startedAt: c.startedAt ?? 0,
    peerHold: !!c.peerHold,
    livekit: c.livekit,
  });

  /** Знімок поточної розмови для `held`. */
  const current = (): HeldCall => ({
    callId: callId.value!,
    peer: peer.value!,
    startedAt: startedAt.value,
    peerHold: peerHold.value,
    livekit,
  });

  /** Поточна розмова йде на утримання й звільняє екран для іншого дзвінка. */
  function parkCurrent() {
    held.value = current();
    deps.media.park?.();
    reset(false);
  }

  /** Утримуваний дзвінок стає поточним: після «Перемкнути» (`onHold` false) чи коли активна розмова скінчилась (true). */
  function resume(h: HeldCall, onHold: boolean) {
    link.value = { ...NO_LINK };
    // кімнати утримуваного може не бути (після перезавантаження): тоді підключаємось наново
    if (!deps.media.swap?.() && h.livekit) {
      deps.media.park?.();
      void deps.media.join(h.livekit);
    }
    callId.value = h.callId;
    peer.value = h.peer;
    startedAt.value = h.startedAt || Date.now() + offset;
    expiresAt.value = 0;
    status.value = 'connected';
    hold.value = onHold;
    peerHold.value = h.peerHold;
    livekit = h.livekit;
    setMissed(null);
    enterConnected();
    syncTimer();
  }

  /**
   * Активна розмова скінчилась: утримувана стає поточною, але лишається на утриманні (повертає її сам користувач).
   * Якщо сервер уже зняв з другого вхідного `waiting` (його `call.updated` випередив `call.ended`), той стає звичайним вхідним.
   */
  function takeHeld() {
    const h = held.value;
    const w = waiting.value;
    if (h) {
      held.value = null;
      resume(h, true);
      return true;
    }
    if (w && !w.waiting) {
      waiting.value = null;
      applyCall(w);
      return true;
    }
    return false;
  }

  function restore(calls: CallInfo[]) {
    const conn = calls.filter(x => x.state === 'connected');
    const c = conn.find(x => !x.hold) ?? conn[0] ?? calls.find(x => !x.waiting) ?? calls[0];
    const other = conn.find(x => x !== c);
    const w = calls.find(x => x.waiting && x.state !== 'connected' && x !== c);
    if (held.value && held.value.callId !== other?.callId) {
      held.value = null;
      deps.media.dropParked?.();
    }
    if (other && !held.value) held.value = heldFrom(other);
    waiting.value = w ?? null;
    if (!c) {
      if (callId.value) {
        reset();
        play(null);
      }
      return;
    }
    if (callId.value === c.callId && (status.value === 'connected') === (c.state === 'connected'))
      return play(peerHold.value ? 'hold' : null);
    if (callId.value) reset();
    if (c.state === 'connected' || c.direction === 'out' || !c.waiting) applyCall(c);
  }

  function setMissed(m: typeof missed.value) {
    clearTimeout(endedTimer);
    missed.value = m;
    if (m?.reason === 'ended') endedTimer = setTimeout(() => (missed.value = null), ENDED_MS);
  }

  function onEnded(endedId: string, reason: EndReason, duration?: number) {
    if (endedId === waiting.value?.callId) {
      waiting.value = null;
      return play(status.value === 'connected' && peerHold.value ? 'hold' : null);
    }
    if (endedId === held.value?.callId) {
      held.value = null;
      return deps.media.dropParked?.();
    }
    if (endedId !== callId.value) return;
    if (endedId === endingId) {
      endingId = null;
      return reset();
    }
    const was = status.value;
    const p = peer.value;
    const secs = duration ?? seconds.value;
    reset();
    if (takeHeld()) return;
    let shown: MissedReason | null = null;
    if (was === 'ringing') {
      shown =
        (
          { busy: 'busy', rejected: 'rejected', timeout: 'timeout', offline: 'timeout', error: 'error' } as Partial<
            Record<EndReason, MissedReason>
          >
        )[reason] ?? null;
    } else if (was === 'incoming' && (reason === 'cancelled' || reason === 'timeout')) {
      shown = 'incoming'; // answered_elsewhere, hangup: без екрана «пропущений»
    } else if (was === 'connected') {
      // свій hangup сюди не доходить: end() скидає дзвінок одразу, тож hangup тут від співрозмовника
      shown =
        ({ hangup: 'ended', lost: 'lost', error: 'dropped' } as Partial<Record<EndReason, MissedReason>>)[reason] ??
        null;
    }
    setMissed(shown && p ? { peer: p, reason: shown, ...(was === 'connected' && { duration: secs }) } : null);
    if (shown === 'busy') play('busy', 4000);
    else play(null);
  }

  function handle(m: ServerMessage) {
    switch (m.type) {
      case 'hello.ok':
        offset = m.serverTime - Date.now();
        me.value = m.user;
        settings.value = m.settings;
        contacts.value = m.contacts;
        recents.value = [...m.recents].sort((a, b) => b.startedAt - a.startedAt);
        restore(m.calls);
        ready.value = true;
        break;
      case 'call.incoming':
        if (m.call.waiting && status.value === 'connected' && !waiting.value) {
          waiting.value = m.call;
          play(peerHold.value ? 'hold' : null);
        } else if (status.value !== 'idle' || m.call.waiting)
          void deps.client.request('call.reject', { callId: m.call.callId }).catch(() => {});
        else applyCall(m.call);
        break;
      case 'call.ringing':
        if (m.call.callId === callId.value && status.value === 'ringing') expiresAt.value = m.call.expiresAt ?? 0;
        break;
      case 'call.connected':
        if (m.call.callId === waiting.value?.callId) {
          waiting.value = null;
          if (callId.value && callId.value === endingId) {
            endingId = null; // «Завершити й прийняти»: наш call.ended прийде пізніше й уже нічого не змінить
            reset();
          } else if (status.value === 'connected') parkCurrent();
          else if (callId.value) reset();
          applyCall(m.call);
        } else if (!callId.value || m.call.callId === callId.value) {
          if (callId.value) reset();
          applyCall(m.call);
        }
        break;
      case 'call.ended':
        onEnded(m.callId, m.reason, m.duration);
        break;
      case 'recents.add':
        recents.value = [m.entry, ...recents.value.filter(r => r.callId !== m.entry.callId)];
        break;
      case 'call.peer':
        if (m.callId === callId.value) {
          peerHold.value = m.hold;
          play(m.hold ? 'hold' : null);
          deps.media.setDeaf(hold.value || m.hold);
        } else if (m.callId === held.value?.callId) held.value.peerHold = m.hold;
        break;
      case 'call.updated':
        // перша розмова скінчилась, поки другий ще дзвонить: він стає звичайним вхідним
        if (m.callId === waiting.value?.callId && m.waiting === false) {
          const w = waiting.value;
          waiting.value = null;
          if (status.value === 'idle') applyCall({ ...w, waiting: false });
          // подія випередила call.ended: дзвонить далі як очікування, звичайним вхідним стане після кінця розмови (takeHeld)
          else if (status.value === 'connected') waiting.value = { ...w, waiting: false };
        }
        if (m.callId === callId.value && m.hold !== undefined) {
          hold.value = m.hold;
          deps.media.setDeaf(m.hold || peerHold.value);
        }
        break;
      case 'presence': {
        const c = contacts.value.find(x => x.userId === m.userId);
        if (c) c.online = m.online;
        break;
      }
      case 'settings.updated':
        settings.value = m.settings;
        break;
      case 'profile.updated':
        me.value = m.user;
        break;
      case 'contacts.update':
        contacts.value = contacts.value
          .filter(c => !m.remove.includes(c.userId) && !m.upsert.some(u => u.userId === c.userId))
          .concat(m.upsert);
        break;
    }
  }

  const permBlocked = { mic: false, cam: false };
  let stopPermWatch: (() => void) | undefined;

  function blockMic() {
    micBlocked.value = true;
    mic.value = false;
    deps.media.setMic(false);
  }

  function showHint(kind: 'cam' | 'mic') {
    hint.value = kind;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint.value = null), HINT_MS);
  }

  function blockCamera() {
    camBlocked.value = true;
    cam.value = false;
    deps.media.setCamera?.(false);
  }

  function init(d: CallDeps) {
    deps = d;
    d.media.onChange?.(patch => {
      Object.assign(link.value, patch);
      if (patch.micError) blockMic();
      if (patch.camError) blockCamera(); // камеру не вдалося ввімкнути (немає пристрою чи дозволу)
    });
    stopPermWatch?.();
    stopPermWatch = d.media.watchPermissions?.(res => {
      // блокуємо, коли дозвіл відкликали, і знімаємо блок, коли його повернули (лише те, що заблокували ми, а не відсутність пристрою)
      if (res.micDenied) {
        permBlocked.mic = true;
        blockMic();
      } else if (permBlocked.mic) {
        permBlocked.mic = false;
        micBlocked.value = false;
      }
      if (res.camDenied) {
        permBlocked.cam = true;
        blockCamera();
      } else if (permBlocked.cam) {
        permBlocked.cam = false;
        camBlocked.value = false;
      }
    });
    d.client.on(handle);
    d.client.onStatus((open, error) => {
      online.value = open;
      netError.value = error ?? '';
      busy = false;
    });
  }

  /** Один запит дозволів за життя сторінки; наступні виклики повертають той самий результат. */
  let permsAsked: Promise<{ audio: boolean; video: boolean }> | undefined;
  function requestPermissions() {
    return (permsAsked ??= deps.media.requestPermissions?.() ?? Promise.resolve({ audio: false, video: false }));
  }

  async function call(userId: string) {
    if (status.value !== 'idle' || busy) return;
    const target = contacts.value.find(c => c.userId === userId);
    if (!target) return;
    setMissed(null);
    busy = true;
    try {
      await requestPermissions(); // перший дзвінок: запит до набору, щоб підключення до кімнати не чекало на вікно браузера
      const ack = await deps.client.request('call.invite', { to: userId, video: true });
      if (ack.type === 'ack' && ack.call) applyCall(ack.call);
    } catch (e) {
      const code = e instanceof Error ? e.message : 'error';
      setMissed({
        peer: { userId: target.userId, name: target.name },
        reason: 'error',
        note: ERRORS[code] ?? 'call.err.generic',
      });
    } finally {
      busy = false;
    }
  }

  function accept() {
    if (!callId.value) return;
    void requestPermissions(); // відповідь не чекає: після першого запиту повертається те саме
    deps.client.request('call.accept', { callId: callId.value }).catch(() => {
      reset();
      play(null);
    });
  }

  /** Відхилити вхідний, скасувати вихідний чи завершити розмову: що саме, залежить від стану. */
  function end() {
    const id = callId.value;
    if (!id) return;
    const type =
      status.value === 'incoming' ? 'call.reject' : status.value === 'ringing' ? 'call.cancel' : 'call.hangup';
    void deps.client.request(type, { callId: id }).catch(() => {});
    reset();
    if (!takeHeld()) play(null);
  }

  /** Другий вхідний: «Утримати й прийняти» (`hold`) чи «Завершити й прийняти» (`end`). Екрани міняють події сервера. */
  function acceptWaiting(action: 'hold' | 'end') {
    const w = waiting.value;
    if (!w || busy) return;
    busy = true;
    if (action === 'end') endingId = callId.value;
    deps.client
      .request('call.accept', { callId: w.callId, action })
      .catch(() => (endingId = null))
      .finally(() => (busy = false));
  }

  function rejectWaiting() {
    const w = waiting.value;
    if (!w) return;
    waiting.value = null;
    play(peerHold.value ? 'hold' : null);
    void deps.client.request('call.reject', { callId: w.callId }).catch(() => {});
  }

  /** «Перемкнути»: утримуваний дзвінок стає поточним, а поточний — утримуваним (сервер робить це однією командою). */
  function swapHeld() {
    const h = held.value;
    if (!h || status.value !== 'connected' || !callId.value) return;
    held.value = current();
    resume(h, false);
    void deps.client.request('call.hold', { callId: h.callId, hold: false }).catch(() => {});
  }

  function toggleHold() {
    const id = callId.value;
    if (!id || status.value !== 'connected') return;
    const next = !hold.value;
    hold.value = next;
    deps.media.setDeaf(next || peerHold.value);
    deps.client.request('call.hold', { callId: id, hold: next }).catch(() => {
      hold.value = !next;
      deps.media.setDeaf(!next || peerHold.value);
    });
  }

  function toggleMic() {
    if (micBlocked.value) return showHint('mic');
    mic.value = !mic.value;
    deps.media.setMic(mic.value);
  }

  function toggleCam() {
    if (camBlocked.value) return showHint('cam');
    cam.value = !cam.value;
    deps.media.setCamera?.(cam.value);
  }

  /** Підключає відео до елемента (його створює компонент, потоки живуть у `CallMedia`). */
  function attach(kind: 'local' | 'remote', el: HTMLVideoElement) {
    deps.media.attach?.(kind, el);
  }

  function dismissMissed() {
    setMissed(null);
    play(null);
  }

  /** Серверні налаштування (`waiting`, `dnd`): одразу локально, при помилці повертаємо. */
  async function updateSettings(patch: Partial<Settings>) {
    const prev = settings.value;
    settings.value = { ...prev, ...patch };
    try {
      const ack = await deps.client.request('settings.update', { settings: patch });
      if (ack.type === 'ack' && ack.settings) settings.value = ack.settings;
    } catch {
      settings.value = prev;
    }
  }

  /** Нове ім'я (`profile.update`); кидає помилку, якщо сервер не прийняв. */
  async function rename(name: string) {
    const ack = await deps.client.request('profile.update', { name });
    if (ack.type === 'ack' && ack.user) me.value = ack.user;
  }

  /** Вкладку «Історія» переглянуто: лічильник обнуляється. */
  function markMissedSeen() {
    missedSeenAt.value = Math.max(missedSeenAt.value, ...missedCalls.value.map(r => r.startedAt));
    try {
      localStorage.setItem(SEEN_KEY, String(missedSeenAt.value));
    } catch {
      // приватний режим: лічильник обнулиться лише до перезавантаження
    }
  }

  return {
    online,
    ready,
    netError,
    contacts,
    me,
    settings,
    recents,
    missedCalls,
    unseenMissed,
    busySelf,
    presence,
    updateSettings,
    rename,
    status,
    waiting,
    held,
    acceptWaiting,
    rejectWaiting,
    swapHeld,
    callId,
    peer,
    hold,
    peerHold,
    peerState,
    peerSpeaking,
    mic,
    cam,
    micBlocked,
    camBlocked,
    hint,
    selfHidden,
    link,
    missed,
    left,
    seconds,
    serverNow,
    init,
    handle,
    call,
    accept,
    end,
    toggleHold,
    toggleMic,
    toggleCam,
    attach,
    dismissMissed,
    markMissedSeen,
    requestPermissions,
  };
});
