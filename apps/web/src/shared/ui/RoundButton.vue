<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'ok' | 'bad' | 'ghost'; label: string; active?: boolean }>(), { variant: 'ghost' });
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    class="grid size-14 place-items-center rounded-full transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
    :class="{
      'bg-call-ok text-white': variant === 'ok',
      'bg-call-bad text-white': variant === 'bad',
      'bg-fg/10 text-fg': variant === 'ghost' && !active,
      'bg-fg text-bg': variant === 'ghost' && active,
    }"
  >
    <slot />
  </button>
</template>
