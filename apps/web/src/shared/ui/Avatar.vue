<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ name: string; size?: 'md' | 'xl'; dim?: boolean }>();
const initials = computed(() => props.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase());
</script>

<template>
  <span
    class="inline-grid shrink-0 place-items-center rounded-full bg-linear-to-br from-indigo-500 to-purple-500 font-semibold text-white"
    :class="[size === 'xl' ? 'size-24 text-3xl' : 'size-11 text-base', dim && 'opacity-50 grayscale']"
    aria-hidden="true"
    >{{ initials }}</span
  >
</template>
