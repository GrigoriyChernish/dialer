<script setup lang="ts">
import { computed } from 'vue';

// палітри аватарів з дизайну: accent → avatar-end, avatar-teal → avatar-blue, avatar-amber → avatar-red
const PALETTES = [['#6366f1', '#a855f7'], ['#14b8a6', '#3b82f6'], ['#f59e0b', '#ef4444']];
// палітра за хешем імені, тож у списку й на екрані дзвінка вона однакова; множник 45 дає демо-ботам палітри з дизайну
const palette = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 45 + ch.codePointAt(0)!) >>> 0;
  return PALETTES[h % PALETTES.length]!;
};

// muted: сірий аватар екрана результату (дизайн: avatar-muted-start → avatar-muted-end, #6B7080 → #7A6E86, прозорість .55)
const props = defineProps<{ name: string; size?: 'md' | 'xl'; muted?: boolean; opacity?: number }>();
const initials = computed(() => props.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase());
const style = computed(() => ({
  background: `linear-gradient(135deg, ${(props.muted ? ['#6b7080', '#7a6e86'] : palette(props.name)).join(', ')})`,
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
