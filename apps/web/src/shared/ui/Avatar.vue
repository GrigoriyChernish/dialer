<script setup lang="ts">
import { computed } from 'vue';

// палітри аватарів з дизайну: accent → avatar-end, avatar-teal → avatar-blue, avatar-amber → avatar-red
const PALETTES = [
  ['#6366f1', '#a855f7'],
  ['#14b8a6', '#3b82f6'],
  ['#f59e0b', '#ef4444'],
];
// палітра за хешем імені, тож у списку й на екрані дзвінка вона однакова; множник 45 дає демо-ботам палітри з дизайну
const palette = (name: string) => {
  let h = 0;
  for (const ch of name) h = (h * 45 + ch.codePointAt(0)!) >>> 0;
  return PALETTES[h % PALETTES.length]!;
};

// muted: сірий аватар екрана результату (дизайн: avatar-muted-start → avatar-muted-end, #6B7080 → #7A6E86, прозорість .55)
// gradient: свій градієнт замість палітри за іменем (екран дзвінка: колір за напрямом чи станом співрозмовника)
const props = defineProps<{
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  muted?: boolean;
  opacity?: number;
  gradient?: string[];
  /** Колір ініціалів замість білого (приглушені аватари станів співрозмовника). */
  color?: string;
}>();
const SIZES = { sm: 'size-9 text-xs', md: 'size-12 text-sm', lg: 'size-14 text-xl', xl: 'size-26 text-[34px]' };
const initials = computed(() =>
  props.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
);
const style = computed(() => ({
  background: `linear-gradient(135deg, ${(props.muted ? ['#6b7080', '#7a6e86'] : (props.gradient ?? palette(props.name))).join(', ')})`,
  opacity: props.muted ? 0.55 : props.opacity,
  color: props.color,
}));
</script>

<template>
  <span
    class="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
    :class="SIZES[size ?? 'md']"
    :style="style"
    aria-hidden="true"
    >{{ initials }}</span
  >
</template>
