<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'ok' | 'bad' | 'ghost'; label: string; active?: boolean }>(), { variant: 'ghost' });
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    class="grid size-[54px] place-items-center rounded-full transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
    :class="{
      'bg-call-ok text-white shadow-[0_8px_24px_rgba(34,197,94,.4)]': variant === 'ok',
      'bg-call-bad text-white shadow-[0_8px_24px_rgba(239,68,68,.4)]': variant === 'bad',
      'bg-surface-strong text-fg': variant === 'ghost' && !active,
      'bg-fg text-bg': variant === 'ghost' && active,
    }"
  >
    <slot />
  </button>
</template>
