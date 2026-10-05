<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import { useCallStore } from '@/features/call/store';
import ReturnCall from '@/features/call/ReturnCall.vue';
import { useLoadState } from '@/features/contacts/loadState';
import { homeTab as tab, type HomeTab as Tab } from '@/features/contacts/homeState';
import ContactsPage from '@/pages/ContactsPage.vue';
import HistoryPage from '@/pages/HistoryPage.vue';
import SearchPage from '@/pages/SearchPage.vue';
import Avatar from '@/shared/ui/Avatar.vue';
import Card from '@/shared/ui/Card.vue';
import BannerStack from '@/shared/ui/BannerStack.vue';
import { banner } from '@/shared/ui/banners';
import Icon, { type IconName } from '@/shared/ui/Icon.vue';

// Головна застосунку (дизайн: Flow · Contacts): три картки — шапка (Home Header), вміст вкладки, вкладки (Tab Bar).
const { t } = useI18n();
const call = useCallStore();
// обрив після першого hello.ok: банер у шапці замість аватара, імені й мітки (дизайн: Home · Contacts · connection lost); до нього — Empty State у ContactsPage
const { offline } = useLoadState();
const lost = computed(() => call.ready && offline.value);

const TABS: { id: Tab; icon: IconName }[] = [
  { id: 'history', icon: 'history' },
  { id: 'contacts', icon: 'users' },
  { id: 'search', icon: 'search' },
];
const PAGES = { history: HistoryPage, contacts: ContactsPage, search: SearchPage };
// лічильник ховаємо, поки відкрита сама вкладка «Історія»
// мітка присутності (дизайн: Presence, / busy, / dnd)
const PRESENCE = {
  free: 'bg-call-ok/15 text-ok-text',
  busy: 'bg-warn/15 text-warn-text',
  dnd: 'bg-call-bad/15 text-bad-text',
} as const;
const badge = computed(() => (tab.value === 'history' ? 0 : call.unseenMissed));
</script>

<template>
  <div class="flex h-full flex-col gap-3 px-4 pb-6 pt-1">
    <!-- шапка (дизайн: Home Header): уся картка відкриває налаштування; до першого hello.ok заготовка (Home Header / loading) -->
    <Card class="shrink-0">
      <RouterLink
        to="/settings"
        class="relative flex items-center gap-2.5 rounded-[28px] py-2.5 pl-2.5 pr-3.5 focus-visible:outline-2 focus-visible:outline-accent"
        :aria-label="t('settings.open')"
      >
        <Avatar v-if="call.ready" :name="call.me?.name ?? ''" size="sm" :class="lost && 'invisible'" />
        <i v-else class="size-9 shrink-0 animate-pulse rounded-full bg-surface" />
        <!-- ім'я одним рядком, задовге обрізається з «…» -->
        <h1 v-if="call.ready" class="min-w-0 flex-1 truncate text-lg font-bold" :class="lost && 'invisible'">
          {{ call.me?.name }}
        </h1>
        <span v-else class="flex h-6 flex-1 animate-pulse items-center" aria-hidden="true"
          ><i class="h-3.5 w-35 rounded-full bg-surface"
        /></span>
        <span
          v-if="call.ready"
          class="flex shrink-0 items-center gap-1.5 rounded-full py-[3px] pl-2 pr-2.5 text-xs font-medium"
          :class="[PRESENCE[call.presence], lost && 'invisible']"
          :role="lost ? undefined : 'status'"
        >
          <i class="size-1.75 rounded-full bg-current" />{{ t(`presence.${call.presence}`) }}
        </span>
        <!-- банер лежить поверх рядка до chevron; висоту шапки не змінює -->
        <BannerStack
          class="pointer-events-none absolute inset-y-0 left-2.5 right-10 flex flex-col justify-center pt-2"
          :items="lost ? [banner('noConnection', t('contacts.noConnection'))] : []"
        />
        <Icon name="chevronRight" class="size-4.5 shrink-0 text-mute" />
      </RouterLink>
    </Card>

    <!-- розмову згорнуто: плашка «Повернутися до дзвінка» (дизайн: Return Call) -->
    <ReturnCall v-if="call.minimized" />

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
            <Icon :name="x.icon" class="size-5.5" />
            <b
              v-if="x.id === 'history' && badge"
              class="absolute -top-1 left-4 grid h-4 min-w-4 place-items-center rounded-full bg-call-bad px-1.25 text-[10px] font-bold text-white"
              >{{ badge }}</b
            >
          </span>
        </button>
      </nav>
    </Card>
  </div>
</template>
