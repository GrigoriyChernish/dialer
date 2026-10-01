<script setup lang="ts">
const PATHS = {
  phone: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.6 3.6a1 1 0 0 1-.25 1z',
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
