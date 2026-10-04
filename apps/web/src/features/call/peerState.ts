import { ref, watch, type Ref } from 'vue';

/** Стан співрозмовника, який показуємо в `Peer` і смужці `Peer Banner`: утримання, обрив зв'язку, вимкнений мікрофон. */
export type PeerState = 'hold' | 'lost' | 'mic';
export type PeerFlags = Record<PeerState, boolean>;
/** Коли кожен активний стан настав (мс). */
export type PeerSince = Partial<Record<PeerState, number>>;

// порядок лише розв'язує рівність часу: утримання, обрив, мікрофон
const ORDER: PeerState[] = ['hold', 'lost', 'mic'];

/** Оновлює час настання: активним без позначки ставимо `now`, неактивні забуваємо. */
export function trackSince(since: PeerSince, flags: PeerFlags, now: number): PeerSince {
  const next: PeerSince = {};
  for (const s of ORDER) if (flags[s]) next[s] = since[s] ?? now;
  return next;
}

/** Стан, що настав останнім серед активних (рішення дизайну: показуємо останню подію), або `null`, якщо жодного. */
export function latestPeerState(flags: PeerFlags, since: PeerSince): PeerState | null {
  let best: PeerState | null = null;
  let bestAt = -Infinity;
  for (const s of ORDER) {
    if (!flags[s]) continue;
    const at = since[s] ?? 0;
    if (at > bestAt) [best, bestAt] = [s, at];
  }
  return best;
}

/** Прапорець, що вмикається одразу, а гасне через `ms` після останнього `true` (щоб індикатор голосу не блимав на паузах між словами). */
export function holdFlag(source: () => boolean, ms: number): Ref<boolean> {
  const out = ref(source());
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    source,
    v => {
      clearTimeout(timer);
      if (v) out.value = true;
      else timer = setTimeout(() => (out.value = false), ms);
    },
    { flush: 'sync' },
  );
  return out;
}
