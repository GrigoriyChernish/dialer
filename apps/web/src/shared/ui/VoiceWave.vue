<script setup lang="ts">
/** Хвиля голосу співрозмовника (дизайн: Voice Wave). `silent`: пласка приглушена (Voice Wave / silent), голосу немає. */
defineProps<{ silent?: boolean }>();
const BARS = [8, 16, 26, 16, 8];
</script>

<template>
  <div class="flex h-7 items-center gap-1" aria-hidden="true">
    <i
      v-for="(h, i) in BARS"
      :key="i"
      class="w-1 origin-center rounded-sm"
      :class="silent ? 'h-1 bg-mute/50' : 'bg-accent motion-safe:animate-wave'"
      :style="silent ? undefined : { height: h + 'px', animationDelay: `calc(${i} * var(--duration-wave-stagger))` }"
    />
  </div>
</template>
