<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ name: string; size?: 'md' | 'xl'; dim?: boolean }>();
const initials = computed(() => props.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase());
</script>

<template>
  <span
    class="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
    :class="[size === 'xl' ? 'size-26 text-[34px]' : 'size-12 text-sm', dim && 'opacity-50 grayscale']"
    style="background: linear-gradient(135deg, #6366f1, #a855f7)"
    aria-hidden="true"
    >{{ initials }}</span
  >
</template>
