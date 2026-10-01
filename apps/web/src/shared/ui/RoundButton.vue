<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'ok' | 'bad' | 'ghost' | 'subtle'; label: string; active?: boolean; unavailable?: boolean }>(), { variant: 'ghost' });
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :aria-disabled="unavailable || undefined"
    class="grid size-[54px] cursor-pointer place-items-center rounded-full transition duration-[var(--duration-press)] ease-[var(--ease-out)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
    :class="{
      'bg-call-ok text-white shadow-[0_8px_24px_#22C55E73] hover:brightness-110 active:brightness-95': variant === 'ok',
      'bg-call-bad text-white shadow-[0_8px_24px_#F0626B66] hover:brightness-110 active:brightness-95': variant === 'bad',
      'bg-surface-strong text-fg hover:bg-white/20': variant === 'ghost' && !active,
      'bg-surface text-fg hover:bg-surface-strong': variant === 'subtle',
      'bg-fg text-bg hover:bg-fg/90 active:brightness-95': variant === 'ghost' && active,
      'opacity-40 hover:opacity-60': unavailable,
    }"
  >
    <slot />
  </button>
</template>
