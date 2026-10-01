<script setup lang="ts">
import Banner, { type BannerTone } from './Banner.vue';
import type { IconName } from './Icon.vue';

/**
 * Стек смужок сповіщень. Лежить поверх екрана (позицію задає батько: `absolute`), вміст не зсуває. Нове сповіщення додається елементом `items` (унікальний `id`), зникає, коли його прибрано.
 * Анімація: поява 220 мс ease-out, зникнення 180 мс ease-in; висота, прозорість і зсув згори на 4 px.
 * `prefers-reduced-motion`: без анімації.
 */
export interface BannerItem {
  id: string;
  tone: BannerTone;
  icon: IconName;
  text: string;
  spin?: boolean;
}
defineProps<{ items: BannerItem[] }>();

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOVE = 'height 220ms ease-out, opacity 220ms ease-out, translate 220ms ease-out';

function enter(el: Element, done: () => void) {
  const e = el as HTMLElement;
  if (reduced()) return done();
  e.style.height = '0px';
  e.style.opacity = '0';
  e.style.translate = '0 -4px';
  void e.offsetHeight; // зафіксувати початковий стан
  e.style.transition = MOVE;
  e.style.height = e.scrollHeight + 'px';
  e.style.opacity = '1';
  e.style.translate = '0 0';
  setTimeout(() => {
    e.style.cssText = '';
    done();
  }, 230);
}

function leave(el: Element, done: () => void) {
  const e = el as HTMLElement;
  if (reduced()) return done();
  e.style.height = e.offsetHeight + 'px';
  void e.offsetHeight;
  e.style.transition = 'height 180ms ease-in, opacity 180ms ease-in, translate 180ms ease-in';
  e.style.height = '0px';
  e.style.opacity = '0';
  e.style.translate = '0 -4px';
  setTimeout(done, 190);
}
</script>

<template>
  <TransitionGroup :css="false" tag="div" @enter="enter" @leave="leave">
    <Banner v-for="b in items" :key="b.id" :tone="b.tone" :icon="b.icon" :spin="b.spin">{{ b.text }}</Banner>
  </TransitionGroup>
</template>
