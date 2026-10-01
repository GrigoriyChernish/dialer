<script setup lang="ts">
import Icon from './Icon.vue';

/** Значок нашого стану в шапці розмови (дизайн: Self Status / *). Лише значок: пояснення дає плашка Call State. */
export type SelfStatus = 'hold' | 'micOff' | 'micUnavailable' | 'camOff' | 'camUnavailable';

const ICON = {
  hold: 'pause',
  micOff: 'micOff',
  micUnavailable: 'micOff',
  camOff: 'videoOff',
  camUnavailable: 'videoOff',
} as const;
const TONE = {
  hold: 'bg-white/10 text-warn',
  micOff: 'bg-call-bad text-white',
  micUnavailable: 'bg-white/10 text-warn',
  camOff: 'bg-white/10 text-mute',
  camUnavailable: 'bg-white/10 text-warn',
} as const;
defineProps<{ status: SelfStatus; label: string }>();
</script>

<template>
  <span
    class="grid size-[22px] place-items-center rounded-full"
    :class="TONE[status]"
    role="img"
    :aria-label="label"
    :title="label"
  >
    <Icon :name="ICON[status]" class="size-3" />
  </span>
</template>
