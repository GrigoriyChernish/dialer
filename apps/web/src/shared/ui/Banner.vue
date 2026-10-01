<script setup lang="ts">
import Icon, { type IconName } from './Icon.vue';

/**
 * Базова смужка-пігулка (дизайн: компонент Banner). Від неї наслідуються Self Banner / * і Peer Banner / * (див. banners.ts):
 * вони лише задають тон, іконку й текст. Нові види смужок додаються так само, власного вигляду не мають.
 *
 * Смужка лежить поверх екрана (абсолютна позиція, її задає BannerStack) і не зсуває вміст.
 * Слот `action`: кнопка праворуч (Self Banner / held-call); вона, на відміну від смужки, клікабельна, а правий відступ 8.
 * Вигляд: радіус 20; підкладка `bg` (85% → 60% → 0), градієнт тону (20% → 10% → 0) і тонка рамка (40% → 20% → 0)
 * розчиняються вправо, тож праворуч видно екран під смужкою, а текст зліва лишається на щільному тлі.
 */
export type BannerTone = 'warn' | 'accent' | 'bad' | 'ok' | 'neutral';
defineProps<{ tone: BannerTone; icon: IconName; spin?: boolean }>();

const BADGE = {
  warn: 'bg-warn/20 text-warn',
  accent: 'bg-accent/20 text-accent-icon',
  bad: 'bg-call-bad/20 text-call-bad',
  ok: 'bg-call-ok/20 text-call-ok',
  neutral: 'bg-mute/20 text-mute',
} as const;
</script>

<template>
  <!-- нижній відступ 8 лежить у корені: проміжок між смужками анімується разом із ними -->
  <div class="pointer-events-none overflow-hidden pb-2" role="status">
    <div
      class="banner flex items-center gap-2.5 py-2 pl-2.5 text-[13px] font-semibold"
      :class="[tone, $slots.action ? 'pr-2' : 'pr-3.5']"
    >
      <span class="grid size-6 shrink-0 place-items-center rounded-full" :class="BADGE[tone]">
        <Icon :name="icon" class="size-3.5" :class="spin && 'motion-safe:animate-spin'" />
      </span>
      <!-- з кнопкою текст в один рядок, щоб вона не з'їжджала; без неї переноситься як раніше -->
      <span class="min-w-0 flex-1" :class="$slots.action && 'truncate'"><slot /></span>
      <span v-if="$slots.action" class="pointer-events-auto shrink-0"><slot name="action" /></span>
    </div>
  </div>
</template>

<style scoped>
.banner {
  /* база нейтральна, як Banner у дизайні; тон задає клас */
  --c: var(--mute);
  position: relative;
  border-radius: 20px;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--bg) 85%, transparent),
      color-mix(in srgb, var(--bg) 60%, transparent) 65%,
      transparent
    ),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--c) 20%, transparent),
      color-mix(in srgb, var(--c) 10%, transparent) 60%,
      transparent
    );
}
.banner.warn {
  --c: var(--color-warn);
}
.banner.accent {
  --c: var(--color-accent);
}
.banner.bad {
  --c: var(--color-call-bad);
}
.banner.ok {
  --c: var(--color-call-ok);
}
.banner.neutral {
  --c: var(--mute);
}
/* рамка теж розчиняється вправо: градієнт, вирізаний маскою в кільце завтовшки 1 px */
.banner::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--c) 40%, transparent),
    color-mix(in srgb, var(--c) 20%, transparent) 60%,
    transparent
  );
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
  pointer-events: none;
}
</style>
