<script setup lang="ts">
/** Заготовка рядка контакту, поки дані не прийшли (дизайн: Contact Row / skeleton). `index`: від нього ширина смужок, щоб рядки не були однакові. */
const props = defineProps<{ index: number }>();
const WIDTHS = [
  [132, 88],
  [108, 120],
  [150, 72],
  [120, 96],
  [96, 110],
  [140, 80],
  [116, 100],
  [128, 90],
  [104, 76],
];
const [name, status] = WIDTHS[props.index % WIDTHS.length]!;
</script>

<template>
  <div class="flex animate-pulse items-center gap-3.5 px-2.5 py-[11px]" aria-hidden="true">
    <i class="size-12 shrink-0 rounded-full bg-surface" />
    <span class="grid gap-2">
      <i class="h-3 rounded-full bg-surface" :style="{ width: `${name}px` }" />
      <i class="h-2.5 rounded-full bg-surface" :style="{ width: `${status}px` }" />
    </span>
  </div>
</template>
