<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BannerTone } from '@/shared/ui/Banner.vue';
import BannerStack, { type BannerItem } from '@/shared/ui/BannerStack.vue';

/**
 * Пул сповіщень `Self`-зони (дизайн: слот Self Banner Slot 40, Pool Badge, Pool Expanded). `items` уже впорядковані (`usePool`):
 * у слоті видно перше, справа бейдж «+N» кольору цього сповіщення; натискання розгортає всі поверх екрана (абсолютно, вміст не зсувається)
 * під затемненням. Закриття: натискання поза списком чи Esc; коли лишилось одне, список згортається сам.
 */
const props = defineProps<{ items: BannerItem[] }>();
const { t } = useI18n();
const top = computed(() => props.items.slice(0, 1));
const more = computed(() => props.items.length - 1);
const expanded = ref(false);

// колір бейджа = колір верхнього сповіщення: *-soft, *-edge, *-text (accent: accent-icon, нейтральний: mute)
const BADGE: Record<BannerTone, string> = {
  accent: 'bg-accent/18 border-accent/40 text-accent-icon',
  warn: 'bg-warn/20 border-warn/40 text-warn-text',
  ok: 'bg-call-ok/15 border-call-ok/40 text-ok-text',
  bad: 'bg-call-bad/20 border-call-bad/40 text-bad-text',
  neutral: 'bg-mute/20 border-mute/40 text-mute',
};
// з кнопкою-дією праворуч (утримуваний дзвінок) бейдж лягає лівіше, щоб не перекрити її
const badgeClass = computed(() => [
  BADGE[props.items[0]?.tone ?? 'neutral'],
  props.items[0]?.action ? 'right-12' : 'right-2',
]);

watch(more, n => n < 1 && (expanded.value = false));
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (expanded.value = false);
watch(expanded, on => (on ? addEventListener('keydown', onKey) : removeEventListener('keydown', onKey)));
onBeforeUnmount(() => removeEventListener('keydown', onKey));
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-20">
    <!-- слот 40: верхнє сповіщення і бейдж; смужка не перехоплює натискання, тож мініатюра під нею клікабельна -->
    <div class="absolute inset-x-4 top-[46px] h-10">
      <BannerStack :items="top" fade />
      <Transition name="pool-fade">
        <button
          v-if="more > 0 && !expanded"
          type="button"
          class="pointer-events-auto absolute top-2 grid h-6 min-w-6 cursor-pointer place-items-center rounded-full border px-2 text-xs font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-accent"
          :class="badgeClass"
          :aria-label="t('call.pool.more', { n: more })"
          aria-expanded="false"
          @click="expanded = true"
        >
          +{{ more }}
        </button>
      </Transition>
    </div>
    <Transition name="pool-fade">
      <div v-if="expanded" class="absolute inset-0">
        <button
          type="button"
          class="pointer-events-auto absolute inset-0 cursor-default bg-bg/60"
          :aria-label="t('call.pool.close')"
          @click="expanded = false"
        />
        <BannerStack class="absolute inset-x-4 top-[46px]" :items="items" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* бейдж і розгорнутий список: м'яка поява 220 мс та зникнення 180 мс (за reduced-motion переходи вимикає main.css) */
.pool-fade-enter-active {
  transition: opacity var(--duration-banner-enter) var(--ease-out);
}
.pool-fade-leave-active {
  transition: opacity var(--duration-banner-leave) var(--ease-in);
}
.pool-fade-enter-from,
.pool-fade-leave-to {
  opacity: 0;
}
</style>
