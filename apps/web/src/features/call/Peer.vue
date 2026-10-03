<script setup lang="ts">
import { computed } from 'vue';
import Avatar from '@/shared/ui/Avatar.vue';
import type { PeerState } from './peerState';

/**
 * Блок співрозмовника (дизайн: компонент Peer). Однаковий розмір 327 × 336 на всіх екранах, щоб вміст не стрибав між станами:
 * три зони фіксованої висоти — Ring 200 (аватар, кільця виклику, індикатор голосу й стану), Title 32 (ім'я), Status 64 (слот: підпис виклику
 * чи результат, притиснуті до верху зони); проміжок 20.
 *
 * Що показує Ring:
 * - виклик (`ringing`): пульсуючі кільця й аватар за напрямом: вихідний синій (accent), вхідний зелений (ok);
 * - розмова: нейтральний аватар; коли співрозмовник говорить (`speaking`), навколо «дихають» два заливні кола accent;
 * - стан співрозмовника (`state`): тонка статична обводка кольору стану й приглушений аватар (`bg` + 20% кольору стану, ініціали `*-text`; утримання жовтий, обрив червоний і .6, мікрофон сірий),
 *   стан сильніший за голос;
 * - результат (`variant="result"`): сірий аватар .55 без кілець.
 */
const props = defineProps<{
  name: string;
  /** `dimmed`: аватар .6 (обрив чи наше утримання); `result`: екран результату (сірий аватар, без кілець). */
  variant?: 'default' | 'dimmed' | 'result';
  /** Виклик (дзвонимо чи дзвонять): кільця навколо аватара й пульсація. Під час розмови й на результаті кілець немає. */
  ringing?: boolean;
  /** Напрямок виклику: колір кілець і аватара (`out` синій, `in` зелений). */
  direction?: 'out' | 'in';
  /** Стан співрозмовника в розмові: обводка й колір аватара. */
  state?: PeerState | null;
  /** Співрозмовник говорить: індикатор голосу (показуємо, лише коли немає стану). */
  speaking?: boolean;
}>();

// градієнти аватара з дизайну: accent → avatar-blue (вихідний), ok → avatar-teal (вхідний), accent → avatar-end (нейтральний у розмові)
const GRADIENT = {
  out: ['#6366f1', '#3b82f6'],
  in: ['#22c55e', '#14b8a6'],
  neutral: ['#6366f1', '#a855f7'],
} as const;
// стани співрозмовника приглушені, як смужки Peer Banner: bg + колір стану 20% (`*-soft`), ініціали `*-text` (mute для мікрофона)
const tint = (c: string) => `color-mix(in srgb, ${c} 20%, var(--bg))`;
const STATE_AVATAR = {
  hold: { gradient: [tint('#f5b84b'), tint('#f5b84b')], color: 'var(--warn-text)' },
  lost: { gradient: [tint('#f0626b'), tint('#f0626b')], color: 'var(--bad-text)' },
  mic: { gradient: [tint('var(--mute)'), tint('var(--mute)')], color: 'var(--mute)' },
} as const;
const avatar = computed(() => {
  if (props.ringing) return { gradient: [...GRADIENT[props.direction ?? 'out']], color: undefined };
  if (props.state) return { gradient: [...STATE_AVATAR[props.state].gradient], color: STATE_AVATAR[props.state].color };
  return { gradient: [...GRADIENT.neutral], color: undefined };
});
// колір кілець виклику: утиліти статичні, щоб Tailwind їх бачив; пульсація бере колір із --ring-rgb
const RINGS = {
  out: { outer: 'bg-accent/[.08]', inner: 'bg-accent/[.14]', rgb: '99 102 241' },
  in: { outer: 'bg-call-ok/[.08]', inner: 'bg-call-ok/[.14]', rgb: '34 197 94' },
} as const;
const rings = computed(() => RINGS[props.direction ?? 'out']);
const STATE_RING = { hold: 'border-warn/40', lost: 'border-call-bad/40', mic: 'border-mute/40' } as const;
const voice = computed(() => !!props.speaking && !props.state && !props.ringing);
const opacity = computed(() => (props.variant === 'dimmed' ? 0.6 : undefined));
</script>

<template>
  <div class="flex h-[336px] w-[327px] max-w-full flex-col items-center gap-5 text-center">
    <span class="relative grid size-[200px] shrink-0 place-items-center rounded-full" :class="ringing && rings.outer">
      <!-- індикатор голосу й стану лежать під аватаром -->
      <i class="peer-fx size-[152px] bg-accent/15" :class="voice && 'peer-fx-on animate-breathe'" />
      <i
        class="peer-fx size-[128px] bg-accent/30"
        :class="voice && 'peer-fx-on animate-breathe [animation-delay:.15s]'"
      />
      <i
        class="peer-fx size-[136px] border-2"
        :class="[state ? ['peer-fx-on', STATE_RING[state]] : 'border-transparent']"
      />
      <span
        class="relative z-[1] grid size-[152px] place-items-center rounded-full"
        :class="ringing && ['animate-ring', rings.inner]"
        :style="ringing ? { '--ring-rgb': rings.rgb } : undefined"
      >
        <Avatar
          :name="name"
          size="xl"
          :muted="variant === 'result'"
          :gradient="avatar.gradient"
          :color="avatar.color"
          :opacity="opacity"
        />
      </span>
    </span>
    <h3 class="flex h-8 w-full shrink-0 items-center justify-center truncate text-[26px] font-bold">{{ name }}</h3>
    <div class="flex h-16 w-full shrink-0 flex-col items-center gap-2"><slot /></div>
  </div>
</template>

<style scoped>
/* кола голосу й обводка стану: з'являються за 150 мс, гаснуть за 400 мс (за reduced-motion переходи вимикає main.css) */
.peer-fx {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  border-radius: 9999px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 400ms var(--ease-in);
}
.peer-fx-on {
  opacity: 1;
  transition: opacity 150ms var(--ease-out);
}
</style>
