<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Banner from '@/shared/ui/Banner.vue';
import { banner } from '@/shared/ui/banners';
import Icon from '@/shared/ui/Icon.vue';
import { useCallStore } from './store';

/** Утримуваний дзвінок під шапкою розмови (дизайн: Self Banner / held-call): смужка тону `warn` з `pause`, «Олена Коваль · 02:14» і кнопка-іконка «Перемкнути» (коло 24, `warn`). */
const { t } = useI18n();
const call = useCallStore();
const mm = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const h = computed(() => call.held!);
const secs = computed(() => Math.max(0, Math.floor((call.serverNow - h.value.startedAt) / 1000)));
const kind = banner('heldCall', '');
</script>

<template>
  <!-- -mb-2: нижній відступ смужки потрібен лише в стеку -->
  <Banner :tone="kind.tone" :icon="kind.icon" class="-mb-2">
    <!-- таймер прихований від читачів екрана, щоб не озвучувався щосекунди -->
    <span class="sr-only">{{ t('call.held.label', { name: h.peer.name }) }}</span
    ><span aria-hidden="true">{{ h.peer.name }} · {{ mm(secs) }}</span>
    <template #action>
      <!-- лише іконка в колі 24 тону смужки (дизайн: Switch Button), назва дії в aria-label -->
      <button
        type="button"
        class="grid size-6 cursor-pointer place-items-center rounded-full bg-warn/20 text-warn transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:bg-warn/30 active:scale-95 focus-visible:outline-2 focus-visible:outline-accent"
        :aria-label="t('call.held.switchTo', { name: h.peer.name })"
        :title="t('call.held.switch')"
        @click="call.swapHeld()"
      >
        <Icon name="arrowLeftRight" class="size-3.5" />
      </button>
    </template>
  </Banner>
</template>
