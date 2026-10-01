import type { CallInfo, Contact, EndReason, Peer, ServerMessage } from '@dialer/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { LinkState } from '@/shared/media/room';
import type { SoundKind } from '@/shared/sounds/sounds';

export type CallStatus = 'idle' | 'ringing' | 'incoming' | 'connected';
export type MissedReason = 'busy' | 'rejected' | 'timeout' | 'incoming' | 'error';

/** Те, що стору потрібно від зовнішнього світу: так його легко тестувати без мережі й звуку. */
export interface CallDeps {
  client: {
    request(type: string, payload?: object): Promise<ServerMessage>;
    on(fn: (m: ServerMessage) => void): () => void;
    onStatus(fn: (open: boolean, error?: string) => void): () => void;
  };
  media: { join(a: { url: string; token: string }): Promise<void>; leave(): void; setMic(on: boolean): void; setDeaf(d: boolean): void; onChange?(fn: (patch: Partial<LinkState>) => void): void; setCamera?(on: boolean): void; hasCamera?(): Promise<boolean>; attach?(kind: 'local' | 'remote', el: HTMLVideoElement): void };
  sounds: { play(kind: SoundKind | null, ms?: number): void };
}

const CAM_HINT_MS = 3000;

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

  const online = ref(false);
  const netError = ref('');
  const contacts = ref<Contact[]>([]);
  const status = ref<CallStatus>('idle');
  const callId = ref<string | null>(null);
  const peer = ref<Peer | null>(null);
  const expiresAt = ref(0);
  const startedAt = ref(0);
  const hold = ref(false);
  const peerHold = ref(false);
  const mic = ref(true);
  const NO_LINK: LinkState = { reconnecting: false, poor: false, peerAway: false, peerMuted: false, peerCam: false, localCam: false, camError: false };
  const link = ref<LinkState>({ ...NO_LINK });
  const cam = ref(true);
  const selfHidden = ref(false);
  /** Камери немає чи немає дозволу: мініатюру себе не показуємо, кнопка камери неактивна. */
  const camBlocked = ref(false);
  /** Підказка «Камера недоступна» після натискання на приглушену кнопку камери. */
  const camHint = ref(false);
  let camHintTimer: ReturnType<typeof setTimeout> | undefined;
  const missed = ref<{ peer: Peer; reason: MissedReason; note?: string } | null>(null);
  const now = ref(Date.now());
  let offset = 0; // serverTime - локальний час
  let busy = false;

  /** Серверний час у локальному відліку. */
  const serverNow = computed(() => now.value + offset);
  const left = computed(() => (expiresAt.value ? Math.max(0, Math.ceil((expiresAt.value - serverNow.value) / 1000)) : 0));
  const seconds = computed(() => (startedAt.value ? Math.max(0, Math.floor((serverNow.value - startedAt.value) / 1000)) : 0));

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

  function reset() {
    deps.media.leave();
    status.value = 'idle';
    callId.value = null;
    peer.value = null;
    expiresAt.value = 0;
    startedAt.value = 0;
    hold.value = peerHold.value = false;
    mic.value = true;
    link.value = { ...NO_LINK };
    cam.value = true;
    camBlocked.value = false;
    camHint.value = false;
    clearTimeout(camHintTimer);
    selfHidden.value = false;
    syncTimer();
  }

  function applyCall(call: CallInfo) {
    callId.value = call.callId;
    peer.value = call.peer;
    missed.value = null;
    expiresAt.value = call.expiresAt ?? 0;
    if (call.state === 'connected') {
      status.value = 'connected';
      startedAt.value = call.startedAt ?? Date.now() + offset;
      hold.value = !!call.hold;
      peerHold.value = !!call.peerHold;
      deps.sounds.play(peerHold.value ? 'hold' : null);
      deps.media.setDeaf(hold.value);
      deps.media.setMic(mic.value);
      deps.media.setCamera?.(cam.value);
      void deps.media.hasCamera?.().then((ok) => ok || blockCamera());
      if (call.livekit) void deps.media.join(call.livekit);
    } else if (call.direction === 'in') {
      status.value = 'incoming';
      deps.sounds.play('ringtone');
    } else {
      status.value = 'ringing';
      deps.sounds.play('ringback');
    }
    syncTimer();
  }

  function restore(calls: CallInfo[]) {
    const c = calls.find((x) => x.state === 'connected') ?? calls[0];
    if (!c) {
      if (callId.value) {
        reset();
        deps.sounds.play(null);
      }
      return;
    }
    if (callId.value === c.callId && (status.value === 'connected') === (c.state === 'connected')) return;
    if (callId.value) reset();
    if (c.state === 'connected' || c.direction === 'out' || !c.waiting) applyCall(c);
  }

  function onEnded(endedId: string, reason: EndReason) {
    if (endedId !== callId.value) return;
    const was = status.value;
    const p = peer.value;
    reset();
    let shown: MissedReason | null = null;
    if (was === 'ringing') {
      shown = ({ busy: 'busy', rejected: 'rejected', timeout: 'timeout', offline: 'timeout', error: 'error' } as Partial<Record<EndReason, MissedReason>>)[reason] ?? null;
    } else if (was === 'incoming' && (reason === 'cancelled' || reason === 'timeout')) {
      shown = 'incoming'; // answered_elsewhere, hangup: без екрана «пропущений»
    }
    missed.value = shown && p ? { peer: p, reason: shown } : null;
    if (shown === 'busy') deps.sounds.play('busy', 4000);
    else deps.sounds.play(null);
  }

  function handle(m: ServerMessage) {
    switch (m.type) {
      case 'hello.ok':
        offset = m.serverTime - Date.now();
        contacts.value = m.contacts;
        restore(m.calls);
        break;
      case 'call.incoming':
        // другий вхідний під час розмови поки відхиляємо (беклог, пункт 3)
        if (status.value !== 'idle' || m.call.waiting) void deps.client.request('call.reject', { callId: m.call.callId }).catch(() => {});
        else applyCall(m.call);
        break;
      case 'call.ringing':
        if (m.call.callId === callId.value && status.value === 'ringing') expiresAt.value = m.call.expiresAt ?? 0;
        break;
      case 'call.connected':
        if (!callId.value || m.call.callId === callId.value) {
          if (callId.value) reset();
          applyCall(m.call);
        }
        break;
      case 'call.ended':
        onEnded(m.callId, m.reason);
        break;
      case 'call.peer':
        if (m.callId === callId.value) {
          peerHold.value = m.hold;
          deps.sounds.play(m.hold ? 'hold' : null);
        }
        break;
      case 'call.updated':
        if (m.callId === callId.value && m.hold !== undefined) {
          hold.value = m.hold;
          deps.media.setDeaf(m.hold);
        }
        break;
      case 'presence': {
        const c = contacts.value.find((x) => x.userId === m.userId);
        if (c) c.online = m.online;
        break;
      }
      case 'contacts.update':
        contacts.value = contacts.value
          .filter((c) => !m.remove.includes(c.userId) && !m.upsert.some((u) => u.userId === c.userId))
          .concat(m.upsert);
        break;
    }
  }

  function blockCamera() {
    camBlocked.value = true;
    cam.value = false;
    deps.media.setCamera?.(false);
  }

  function init(d: CallDeps) {
    deps = d;
    d.media.onChange?.((patch) => {
      Object.assign(link.value, patch);
      if (patch.camError) blockCamera(); // камеру не вдалося ввімкнути (немає пристрою чи дозволу)
    });
    d.client.on(handle);
    d.client.onStatus((open, error) => {
      online.value = open;
      netError.value = error ?? '';
      busy = false;
    });
  }

  async function call(userId: string) {
    if (status.value !== 'idle' || busy) return;
    const target = contacts.value.find((c) => c.userId === userId);
    if (!target) return;
    missed.value = null;
    busy = true;
    try {
      const ack = await deps.client.request('call.invite', { to: userId, video: true });
      if (ack.type === 'ack' && ack.call) applyCall(ack.call);
    } catch (e) {
      const code = e instanceof Error ? e.message : 'error';
      missed.value = { peer: { userId: target.userId, name: target.name }, reason: 'error', note: ERRORS[code] ?? 'call.err.generic' };
    } finally {
      busy = false;
    }
  }

  function accept() {
    if (!callId.value) return;
    deps.client.request('call.accept', { callId: callId.value }).catch(() => {
      reset();
      deps.sounds.play(null);
    });
  }

  /** Відхилити вхідний, скасувати вихідний чи завершити розмову: що саме, залежить від стану. */
  function end() {
    const id = callId.value;
    if (!id) return;
    const type = status.value === 'incoming' ? 'call.reject' : status.value === 'ringing' ? 'call.cancel' : 'call.hangup';
    void deps.client.request(type, { callId: id }).catch(() => {});
    reset();
    deps.sounds.play(null);
  }

  function toggleHold() {
    const id = callId.value;
    if (!id || status.value !== 'connected') return;
    const next = !hold.value;
    hold.value = next;
    deps.media.setDeaf(next);
    deps.client.request('call.hold', { callId: id, hold: next }).catch(() => {
      hold.value = !next;
      deps.media.setDeaf(!next);
    });
  }

  function toggleMic() {
    mic.value = !mic.value;
    deps.media.setMic(mic.value);
  }

  function toggleCam() {
    if (camBlocked.value) {
      camHint.value = true;
      clearTimeout(camHintTimer);
      camHintTimer = setTimeout(() => (camHint.value = false), CAM_HINT_MS);
      return;
    }
    cam.value = !cam.value;
    deps.media.setCamera?.(cam.value);
  }

  /** Підключає відео до елемента (його створює компонент, потоки живуть у `CallMedia`). */
  function attach(kind: 'local' | 'remote', el: HTMLVideoElement) {
    deps.media.attach?.(kind, el);
  }

  function dismissMissed() {
    missed.value = null;
    deps.sounds.play(null);
  }

  return {
    online, netError, contacts, status, callId, peer, hold, peerHold, mic, cam, camBlocked, camHint, selfHidden, link, missed, left, seconds,
    init, handle, call, accept, end, toggleHold, toggleMic, toggleCam, attach, dismissMissed,
  };
});
