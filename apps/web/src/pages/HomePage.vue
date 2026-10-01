<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '@/features/auth/session';
import { useCallStore } from '@/features/call/store';
import ContactsPage from '@/pages/ContactsPage.vue';
import MissedPage from '@/pages/MissedPage.vue';
import SearchPage from '@/pages/SearchPage.vue';
import Card from '@/shared/ui/Card.vue';
import Icon, { type IconName } from '@/shared/ui/Icon.vue';

// Головна застосунку (дизайн: Flow · Contacts): три картки — шапка (Home Header), вміст вкладки, вкладки (Tab Bar).
const { t } = useI18n();
const session = useSessionStore();
const call = useCallStore();

type Tab = 'missed' | 'contacts' | 'search';
const TABS: { id: Tab; icon: IconName }[] = [
  { id: 'missed', icon: 'phoneMissed' },
  { id: 'contacts', icon: 'users' },
  { id: 'search', icon: 'search' },
];
const tab = ref<Tab>('contacts');
const PAGES = { missed: MissedPage, contacts: ContactsPage, search: SearchPage };
// лічильник ховаємо, поки відкрита сама вкладка «Пропущені»
const badge = computed(() => (tab.value === 'missed' ? 0 : call.unseenMissed));
</script>

<template>
  <div class="flex h-full flex-col gap-3 px-4 pb-6 pt-1">
    <Card class="flex shrink-0 items-center gap-3 py-3 pl-4 pr-3">
      <!-- ім'я одним рядком, задовге обрізається з «…»; до першого hello.ok смужка-заготовка, а мітки присутності немає (дизайн: Home Header / loading) -->
      <h1 v-if="call.ready" class="min-w-0 flex-1 truncate text-lg font-bold">{{ call.me?.name }}</h1>
      <span v-else class="flex h-6 flex-1 animate-pulse items-center" aria-hidden="true"
        ><i class="h-3.5 w-[140px] rounded-full bg-surface"
      /></span>
      <span
        v-if="call.ready"
        class="flex shrink-0 items-center gap-1.5 rounded-full py-[3px] pl-2 pr-2.5 text-xs font-medium"
        :class="call.busySelf ? 'bg-call-bad/15 text-call-bad' : 'bg-call-ok/15 text-call-ok'"
        role="status"
      >
        <i class="size-[7px] rounded-full bg-current" />{{ call.busySelf ? t('presence.busy') : t('presence.free') }}
      </span>
      <button
        type="button"
        class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        :aria-label="t('app.logout')"
        :title="t('app.logout')"
        @click="session.logout()"
      >
        <Icon name="logOut" class="size-5" />
      </button>
    </Card>

    <component :is="PAGES[tab]" class="min-h-0 flex-1" />

    <Card class="shrink-0 px-1 py-1.5">
      <nav class="flex" :aria-label="t('tabs.label')">
        <button
          v-for="x in TABS"
          :key="x.id"
          type="button"
          class="grid flex-1 cursor-pointer place-items-center py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-accent"
          :class="tab === x.id ? 'text-accent-icon' : 'text-mute hover:text-fg'"
          :aria-label="t(`tabs.${x.id}`)"
          :aria-current="tab === x.id ? 'page' : undefined"
          @click="tab = x.id"
        >
          <span class="relative grid h-6 w-7 place-items-center">
            <Icon :name="x.icon" class="size-[22px]" />
            <b
              v-if="x.id === 'missed' && badge"
              class="absolute -top-1 left-4 grid h-4 min-w-4 place-items-center rounded-full bg-call-bad px-[5px] text-[10px] font-bold text-white"
              >{{ badge }}</b
            >
          </span>
        </button>
      </nav>
    </Card>
  </div>
</template>
