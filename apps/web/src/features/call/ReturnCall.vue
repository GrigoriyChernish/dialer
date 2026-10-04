<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useCallStore } from '@/features/call/store';
import Card from '@/shared/ui/Card.vue';
import Icon from '@/shared/ui/Icon.vue';

/**
 * Плашка «Повернутися до дзвінка» на головному, коли розмову згорнуто (дизайн: Return Call, Return Call / hold).
 * Уся картка кнопка: повертає екран розмови. Таймер іде далі; на утриманні іконка `pause` і «на утриманні».
 * Звук триває, камера на час згортання вимкнена (див. store: `minimize`).
 */
const { t } = useI18n();
const call = useCallStore();
const mm = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
</script>

<template>
  <Card class="shrink-0">
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2.5 rounded-[28px] py-2 pl-2.5 pr-3.5 text-left focus-visible:outline-2 focus-visible:outline-accent"
      :aria-label="t('call.returnTo', { name: call.peer?.name ?? '' })"
      @click="call.restoreCall()"
    >
      <span
        class="grid size-8 shrink-0 place-items-center rounded-full"
        :class="call.hold ? 'bg-warn/20 text-warn' : 'bg-call-ok/15 text-call-ok'"
        ><Icon :name="call.hold ? 'pause' : 'phone'" class="size-4"
      /></span>
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <b class="truncate text-sm font-semibold">{{ call.peer?.name }}</b>
        <small class="shrink-0 text-[13px] font-medium tabular-nums" :class="call.hold ? 'text-warn-text' : 'text-mute'"
          >· {{ call.hold ? t('call.onHold') : mm(call.seconds) }}</small
        >
      </span>
      <Icon name="chevronUp" class="size-4.5 shrink-0 text-mute" />
    </button>
  </Card>
</template>
