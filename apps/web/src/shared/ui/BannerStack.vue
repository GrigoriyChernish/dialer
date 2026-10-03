<script setup lang="ts">
import Banner, { type BannerTone } from './Banner.vue';
import Icon from './Icon.vue';
import type { IconName } from './Icon.vue';

/**
 * Стек смужок сповіщень. Лежить поверх екрана (позицію задає батько: `absolute`), вміст не зсуває. На екрані дзвінка вживається в пулі сповіщень (`NotificationPool.vue`). Нове сповіщення додається елементом `items` (унікальний `id`), зникає, коли його прибрано.
 * Анімація: поява 220 мс ease-out, зникнення 180 мс ease-in; висота, прозорість і зсув згори на 4 px.
 * `prefers-reduced-motion`: без анімації.
 */
export interface BannerItem {
  id: string;
  tone: BannerTone;
  icon: IconName;
  text: string;
  spin?: boolean;
  /** Підпис для читачів екрана, коли видимий текст змінюється (таймер): текст ховаємо через `aria-hidden`. */
  srLabel?: string;
  /** Кнопка-іконка праворуч (Self Banner / held-call: «Перемкнути»), клікабельна, на відміну від смужки. */
  action?: { label: string; title?: string; icon?: IconName; run: () => void };
}
defineProps<{
  items: BannerItem[];
  /** Зміна на місці: сповіщення міняються у фіксованому слоті прозорістю й зсувом, без зміни висоти. */
  fade?: boolean;
}>();

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOVE = 'var(--transition-banner-enter)';

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
  e.style.transition = 'var(--transition-banner-leave)';
  e.style.height = '0px';
  e.style.opacity = '0';
  e.style.translate = '0 -4px';
  setTimeout(done, 190);
}

// режим fade: висота не змінюється, старе сповіщення йде абсолютно на тому ж місці, нове з'являється під ним
function enterFade(el: Element, done: () => void) {
  const e = el as HTMLElement;
  if (reduced()) return done();
  e.style.opacity = '0';
  e.style.translate = '0 -4px';
  void e.offsetHeight;
  e.style.transition = 'var(--transition-fade-enter)';
  e.style.opacity = '1';
  e.style.translate = '0 0';
  setTimeout(() => {
    e.style.cssText = '';
    done();
  }, 230);
}

function leaveFade(el: Element, done: () => void) {
  const e = el as HTMLElement;
  if (reduced()) return done();
  Object.assign(e.style, { position: 'absolute', insetInline: '0', top: '0', width: 'auto' });
  void e.offsetHeight;
  e.style.transition = 'var(--transition-fade-leave)';
  e.style.opacity = '0';
  e.style.translate = '0 -4px';
  setTimeout(done, 190);
}
</script>

<template>
  <TransitionGroup
    :css="false"
    tag="div"
    :class="fade && 'relative'"
    v-bind="fade ? { onEnter: enterFade, onLeave: leaveFade } : { onEnter: enter, onLeave: leave }"
  >
    <Banner v-for="b in items" :key="b.id" :tone="b.tone" :icon="b.icon" :spin="b.spin">
      <template v-if="b.srLabel"
        ><span class="sr-only">{{ b.srLabel }}</span
        ><span aria-hidden="true">{{ b.text }}</span></template
      ><template v-else>{{ b.text }}</template>
      <template v-if="b.action" #action>
        <!-- лише іконка в колі 24 тону смужки (дизайн: Switch Button), назва дії в aria-label -->
        <button
          type="button"
          class="grid size-6 cursor-pointer place-items-center rounded-full bg-warn/20 text-warn transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:bg-warn/30 active:scale-95 focus-visible:outline-2 focus-visible:outline-accent"
          :aria-label="b.action.label"
          :title="b.action.title"
          @click="b.action.run()"
        >
          <Icon :name="b.action.icon ?? 'arrowLeftRight'" class="size-3.5" />
        </button>
      </template>
    </Banner>
  </TransitionGroup>
</template>
