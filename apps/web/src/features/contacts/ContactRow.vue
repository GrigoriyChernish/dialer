<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { computed } from 'vue';
import Avatar from '@/shared/ui/Avatar.vue';
import Icon, { type IconName } from '@/shared/ui/Icon.vue';

/**
 * Рядок контакту (дизайн: Contact Row, Contact Row / history): весь рядок дзвонить.
 * Контакти: `dot` — клас кольору крапки статусу присутності.
 * Історія: `icon` — напрям дзвінка замість крапки; `tone` — як у станів Peer Ring: приглушений аватар кольору результату
 * (`bad` пропущений, `warn` не додзвонились) і статус того ж кольору; без `tone` звичайний аватар.
 */
const props = defineProps<{ name: string; status: string; dot?: string; icon?: IconName; tone?: 'bad' | 'warn' }>();
defineEmits<{ call: [] }>();
const { t } = useI18n();
const TONES = {
  bad: { text: 'text-bad-text', color: '#f0626b' },
  warn: { text: 'text-warn-text', color: '#f5b84b' },
} as const;
const tone = computed(() => (props.tone ? TONES[props.tone] : null));
// приглушений аватар, як у станів Peer Ring: bg + 20% кольору результату, ініціали `*-text`
const muted = computed(() => {
  if (!tone.value) return {};
  const c = `color-mix(in srgb, ${tone.value.color} 20%, var(--bg))`;
  return { gradient: [c, c], color: `var(--${props.tone}-text)` };
});
</script>

<template>
  <button
    type="button"
    class="group flex w-full cursor-pointer items-center gap-3.5 rounded-[18px] px-2.5 py-[11px] text-left transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:bg-surface active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-accent"
    :aria-label="`${t('contacts.call')}: ${name}`"
    @click="$emit('call')"
  >
    <Avatar :name="name" v-bind="muted" />
    <span class="grid min-w-0 flex-1 gap-0.5">
      <b class="truncate text-sm font-semibold">{{ name }}</b>
      <small class="flex min-w-0 items-center gap-1.5 text-xs text-mute">
        <Icon v-if="icon" :name="icon" class="size-3.5 shrink-0" :class="tone?.text" />
        <i v-else class="size-[7px] shrink-0 rounded-full" :class="dot" />
        <span class="min-w-0 truncate" :class="tone?.text">{{ status }}</span>
      </small>
    </span>
    <span
      class="grid size-9 shrink-0 place-items-center rounded-full bg-call-ok/15 text-call-ok transition-colors duration-150 group-hover:bg-call-ok group-hover:text-white"
      ><Icon name="phone" class="size-4"
    /></span>
  </button>
</template>
