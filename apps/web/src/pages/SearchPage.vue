<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ContactsPage from '@/pages/ContactsPage.vue';
import Icon from '@/shared/ui/Icon.vue';

// Вкладка «Пошук» (дизайн: Home · Search): поле зверху, під ним знайдені контакти або Empty State.
const { t } = useI18n();
const query = ref('');
const input = ref<HTMLInputElement>();
onMounted(() => input.value?.focus());
const clear = () => {
  query.value = '';
  input.value?.focus();
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <label
      class="flex h-12 shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-bg px-3.5 focus-within:border-accent"
    >
      <Icon name="search" class="size-[18px] shrink-0 text-mute" />
      <input
        ref="input"
        v-model="query"
        type="search"
        :placeholder="t('contacts.search')"
        :aria-label="t('contacts.search')"
        class="min-w-0 flex-1 bg-transparent text-base font-medium outline-none placeholder:text-mute/60 [&::-webkit-search-cancel-button]:hidden"
      />
      <button
        v-if="query"
        type="button"
        class="grid size-6 cursor-pointer place-items-center text-mute hover:text-fg"
        :aria-label="t('contacts.clear')"
        @click="clear"
      >
        <Icon name="circleX" class="size-[18px]" />
      </button>
    </label>
    <ContactsPage class="min-h-0 flex-1" :query="query" />
  </div>
</template>
