<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Avatar from '@/shared/ui/Avatar.vue';
import Icon from '@/shared/ui/Icon.vue';

/** Рядок контакту (дизайн: Contact Row, Contact Row / missed): весь рядок дзвонить. `dot`: клас кольору крапки статусу. */
defineProps<{ name: string; status: string; dot: string }>();
defineEmits<{ call: [] }>();
const { t } = useI18n();
</script>

<template>
  <button
    type="button"
    class="group flex w-full cursor-pointer items-center gap-3.5 rounded-[18px] px-2.5 py-[11px] text-left transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:bg-surface active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-accent"
    :aria-label="`${t('contacts.call')}: ${name}`"
    @click="$emit('call')"
  >
    <Avatar :name="name" />
    <span class="grid min-w-0 flex-1 gap-0.5">
      <b class="truncate text-sm font-semibold">{{ name }}</b>
      <small class="flex items-center gap-1.5 text-xs text-mute">
        <i class="size-[7px] shrink-0 rounded-full" :class="dot" />
        <span class="truncate">{{ status }}</span>
      </small>
    </span>
    <span
      class="grid size-9 shrink-0 place-items-center rounded-full bg-call-ok/15 text-call-ok transition-colors duration-150 group-hover:bg-call-ok group-hover:text-white"
      ><Icon name="phone" class="size-4"
    /></span>
  </button>
</template>
