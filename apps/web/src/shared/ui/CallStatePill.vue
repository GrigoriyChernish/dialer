<script setup lang="ts">
import Icon from './Icon.vue';

/** Плашка стану дзвінка з design/dialer.pen: Call State / hold, peer-hold, connection-lost, reconnecting, poor-signal, mic-off. */
export type PillState = 'hold' | 'peerHold' | 'connectionLost' | 'reconnecting' | 'poorSignal' | 'micOff';

const ICON = { hold: 'pause', peerHold: 'pause', connectionLost: 'wifiOff', reconnecting: 'loader', poorSignal: 'signalLow', micOff: 'micOff' } as const;
const TONE = { hold: 'text-warn', peerHold: 'text-warn', connectionLost: 'text-call-bad', reconnecting: 'text-accent-icon', poorSignal: 'text-warn', micOff: 'text-mute' } as const;
defineProps<{ state: PillState }>();
</script>

<template>
  <div class="inline-flex items-center gap-2 rounded-[20px] border border-line bg-white/[.08] px-3.5 py-2 text-[13px]" role="status">
    <Icon :name="ICON[state]" class="size-4 shrink-0" :class="[TONE[state], state === 'reconnecting' && 'motion-safe:animate-spin']" />
    <span><slot /></span>
  </div>
</template>
