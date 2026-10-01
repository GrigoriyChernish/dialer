<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '@/features/auth/session';
import ContactsPage from '@/pages/ContactsPage.vue';
import Icon from '@/shared/ui/Icon.vue';

// Головна застосунку (дизайн: Contacts з App Header): шапка з виходом і список контактів.
const { t } = useI18n();
const session = useSessionStore();
</script>

<template>
  <header class="flex h-14 items-center justify-between px-4">
    <h1 class="text-xl font-bold">{{ t('app.title') }}</h1>
    <button
      type="button"
      class="grid size-11 place-items-center rounded-full border border-line bg-surface text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      :aria-label="t('app.logout')"
      :title="t('app.logout')"
      @click="session.logout()"
    >
      <Icon name="logOut" class="size-5" />
    </button>
  </header>
  <ContactsPage />
</template>
