<script setup lang="ts">
import Icon, { type IconName } from './Icon.vue';

/**
 * Базова смужка-пігулка (дизайн: компонент Banner). Від неї наслідуються Network Banner / * і Status Banner / * (див. banners.ts):
 * вони лише задають тон, іконку й текст. Нові види смужок додаються так само, власного вигляду не мають.
 *
 * Смужка лежить поверх екрана (абсолютна позиція, її задає BannerStack) і не зсуває вміст.
 * Вигляд: радіус 20 як у Call State; підкладка `bg` (85% → 0), градієнт тону (20% → 0) і тонка рамка (40% → 0)
 * розчиняються вправо, тож праворуч видно екран під смужкою, а текст зліва лишається на щільному тлі.
 */
export type BannerTone = 'warn' | 'accent' | 'bad' | 'neutral';
defineProps<{ tone: BannerTone; icon: IconName; spin?: boolean }>();

const BADGE = {
  warn: 'bg-warn/20 text-warn',
  accent: 'bg-accent/20 text-accent-icon',
  bad: 'bg-call-bad/20 text-call-bad',
  neutral: 'bg-mute/20 text-mute',
} as const;
</script>

<template>
  <!-- нижній відступ 8 лежить у корені: проміжок між смужками анімується разом із ними -->
  <div class="pointer-events-none overflow-hidden pb-2" role="status">
    <div class="banner flex items-center gap-2.5 py-2 pl-2.5 pr-3.5 text-[13px] font-semibold" :class="tone">
      <span class="grid size-6 shrink-0 place-items-center rounded-full" :class="BADGE[tone]">
        <Icon :name="icon" class="size-3.5" :class="spin && 'motion-safe:animate-spin'" />
      </span>
      <span><slot /></span>
    </div>
  </div>
</template>

<style scoped>
.banner {
  --c: var(--color-warn);
  position: relative;
  border-radius: 20px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--bg) 85%, transparent), color-mix(in srgb, var(--bg) 60%, transparent) 65%, transparent),
    linear-gradient(90deg, color-mix(in srgb, var(--c) 20%, transparent), color-mix(in srgb, var(--c) 10%, transparent) 60%, transparent);
}
.banner.accent {
  --c: var(--color-accent);
}
.banner.bad {
  --c: var(--color-call-bad);
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
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 40%, transparent), color-mix(in srgb, var(--c) 20%, transparent) 60%, transparent);
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  -webkit-mask-composite: xor;
  pointer-events: none;
}
</style>
