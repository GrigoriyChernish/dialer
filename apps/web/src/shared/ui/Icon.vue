<script setup lang="ts">
const PATHS = {
  phone: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.6 3.6a1 1 0 0 1-.25 1z',
  phoneOut: 'M15 3h6v6M14 10l6.8-6.8M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
  phoneIn: 'M16 2v6h6M22 2l-6.8 6.8M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
  x: 'M6 6l12 12M18 6L6 18',
  pause: 'M9 5v14M15 5v14',
  mic: 'M9 3h6v11H9z M5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M9 3h6v11H9z M5 11a7 7 0 0 0 14 0M12 18v3M4 4l16 16',
} as const;
defineProps<{ name: keyof typeof PATHS }>();
const filled = new Set(['phone']);
</script>

<template>
  <svg viewBox="0 0 24 24" class="size-6" aria-hidden="true" :fill="filled.has(name) ? 'currentColor' : 'none'" :stroke="filled.has(name) ? 'none' : 'currentColor'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path :d="PATHS[name]" />
  </svg>
</template>
