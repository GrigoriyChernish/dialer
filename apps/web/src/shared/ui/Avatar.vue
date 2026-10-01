<script setup lang="ts">
import { computed } from 'vue';

// muted: сірий аватар екрана результату (дизайн: градієнт #6B7080 → #7A6E86, прозорість .55)
const props = defineProps<{ name: string; size?: 'md' | 'xl'; muted?: boolean; opacity?: number }>();
const initials = computed(() => props.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase());
const style = computed(() => ({
  background: props.muted ? 'linear-gradient(135deg, #6b7080, #7a6e86)' : 'linear-gradient(135deg, #6366f1, #a855f7)',
  opacity: props.muted ? 0.55 : props.opacity,
}));
</script>

<template>
  <span
    class="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
    :class="size === 'xl' ? 'size-26 text-[34px]' : 'size-12 text-sm'"
    :style="style"
    aria-hidden="true"
    >{{ initials }}</span
  >
</template>
