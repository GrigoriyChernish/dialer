<script setup lang="ts">
import { ref, watch } from 'vue';
import Icon from './Icon.vue';

/**
 * Смужка про нашу мережу під шапкою (дизайн: Network Banner / poor-signal, reconnecting).
 * Поява й зникнення анімовані: висота (0fr → 1fr), прозорість і легкий зсув згори; поява 220 мс, зникнення 180 мс.
 */
export type NetworkKind = 'poorSignal' | 'reconnecting';
const props = defineProps<{ kind: NetworkKind | null; label: Record<NetworkKind, string> }>();

// під час зникнення лишаємо останній текст, щоб він не зникав раніше за смужку
const shown = ref<NetworkKind>(props.kind ?? 'poorSignal');
watch(() => props.kind, (k) => k && (shown.value = k));

const STYLE = {
  poorSignal: { bar: 'from-warn/18 border-warn/25', badge: 'bg-warn/20 text-warn', icon: 'signalLow' },
  reconnecting: { bar: 'from-accent/18 border-accent/25', badge: 'bg-accent/20 text-accent-icon', icon: 'loader' },
} as const;
</script>

<template>
  <!-- grid-rows 0fr → 1fr анімує висоту без вимірювання -->
  <div
    class="grid transition-[grid-template-rows] motion-reduce:transition-none"
    :class="kind ? 'grid-rows-[1fr] duration-[220ms] ease-out' : 'grid-rows-[0fr] duration-[180ms] ease-in'"
    :aria-hidden="!kind"
  >
    <div class="overflow-hidden">
      <div
        class="flex items-center gap-2.5 border-b bg-linear-to-r to-transparent px-6 py-2.5 text-[13px] font-semibold transition-[opacity,translate] motion-reduce:transition-none"
        :class="[STYLE[shown].bar, kind ? 'translate-y-0 opacity-100 duration-[220ms] ease-out' : '-translate-y-1 opacity-0 duration-[180ms] ease-in']"
        :role="kind ? 'status' : undefined"
      >
        <span class="grid size-6 shrink-0 place-items-center rounded-full" :class="STYLE[shown].badge">
          <Icon :name="STYLE[shown].icon" class="size-3.5" :class="shown === 'reconnecting' && 'motion-safe:animate-spin'" />
        </span>
        <span>{{ label[shown] }}</span>
      </div>
    </div>
  </div>
</template>
