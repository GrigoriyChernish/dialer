import type { BannerItem } from './BannerStack.vue';

/**
 * Види смужок, що наслідуються від базового Banner (дизайн: Network Banner / *, Status Banner / *).
 * Новий вид: рядок тут (тон, іконка) + компонент `Status Banner / <назва>` у design/dialer.pen + текст у i18n.
 */
const KINDS = {
  // Network Banner: наша мережа
  poorSignal: { tone: 'warn', icon: 'signalLow' },
  reconnecting: { tone: 'accent', icon: 'loader', spin: true },
  // Peer Banner: співрозмовник і зв'язок з ним
  peerHold: { tone: 'warn', icon: 'pause' },
  connectionLost: { tone: 'bad', icon: 'wifiOff' },
  peerMicOff: { tone: 'neutral', icon: 'micOff' },
  // Status Banner: наші пристрої
  cameraUnavailable: { tone: 'warn', icon: 'videoOff' },
  micUnavailable: { tone: 'warn', icon: 'micOff' },
} as const satisfies Record<string, Omit<BannerItem, 'id' | 'text'>>;

export type BannerKind = keyof typeof KINDS;

export const banner = (kind: BannerKind, text: string): BannerItem => ({ id: kind, ...KINDS[kind], text });
