<script setup lang="ts">
import Icon, { type IconName } from './Icon.vue';

/** Порожній список (дизайн: Empty State): значок у колі, заголовок і необов'язковий підпис. Порожню картку замість нього не показуємо. */
defineProps<{ icon: IconName; title: string; caption?: string }>();
</script>

<template>
  <div class="grid justify-items-center gap-3 px-6 text-center" role="status">
    <span class="grid size-16 place-items-center rounded-full border border-line bg-surface text-mute"
      ><Icon :name="icon" class="size-[26px]"
    /></span>
    <p class="text-base font-semibold">{{ title }}</p>
    <p v-if="caption" class="text-sm leading-[1.4] text-mute">{{ caption }}</p>
  </div>
</template>
