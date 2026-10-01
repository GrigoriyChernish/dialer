<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'ok' | 'bad' | 'ghost' | 'subtle'; label: string; active?: boolean; unavailable?: boolean }>(), { variant: 'ghost' });
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :aria-disabled="unavailable || undefined"
    class="grid size-[54px] place-items-center rounded-full transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
    :class="{
      'bg-call-ok text-white shadow-[0_8px_24px_#22C55E73]': variant === 'ok',
      'bg-call-bad text-white shadow-[0_8px_24px_#F0626B66]': variant === 'bad',
      'bg-surface-strong text-fg': variant === 'ghost' && !active,
      'bg-surface text-fg': variant === 'subtle',
      'bg-fg text-bg': variant === 'ghost' && active,
      'opacity-40': unavailable,
    }"
  >
    <slot />
  </button>
</template>
