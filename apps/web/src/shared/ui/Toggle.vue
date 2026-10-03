<script setup lang="ts">
/** Перемикач (дизайн: Toggle, Toggle / on): доріжка 44 × 26, кругляк 22. Вимкнений: `surface-3` і `mute`, увімкнений: `accent` і білий, недоступний (`disabled`): напівпрозорий. */
const on = defineModel<boolean>({ required: true });
defineProps<{ label: string; disabled?: boolean }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="on"
    :aria-label="label"
    :disabled="disabled"
    class="flex h-6.5 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    :class="[on ? 'bg-accent' : 'bg-surface-strong', disabled && 'cursor-not-allowed opacity-40']"
    @click="on = !on"
  >
    <i
      class="size-5.5 rounded-full transition-[translate,background-color] duration-150 ease-out"
      :class="on ? 'translate-x-4.5 bg-white' : 'bg-mute'"
    />
  </button>
</template>
