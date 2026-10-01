<script setup lang="ts">
import Icon from './Icon.vue';

/** Плашка під іменем: лише про співрозмовника й зв'язок з ним (design/dialer.pen: Call State / peer-hold, connection-lost, mic-off). */
export type PillState = 'peerHold' | 'connectionLost' | 'micOff';

const ICON = { peerHold: 'pause', connectionLost: 'wifiOff', micOff: 'micOff' } as const;
const TONE = { peerHold: 'text-warn', connectionLost: 'text-call-bad', micOff: 'text-mute' } as const;
defineProps<{ state: PillState }>();
</script>

<template>
  <div class="inline-flex items-center gap-2 rounded-[20px] border border-line bg-white/[.08] px-3.5 py-2 text-[13px]" role="status">
    <Icon :name="ICON[state]" class="size-4 shrink-0" :class="[TONE[state]]" />
    <span><slot /></span>
  </div>
</template>
