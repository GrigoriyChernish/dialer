<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ContactRow from '@/features/contacts/ContactRow.vue';
import { useCallStore } from '@/features/call/store';
import Card from '@/shared/ui/Card.vue';
import EmptyState from '@/shared/ui/EmptyState.vue';

/**
 * Список контактів у картці (дизайн: Home · Contacts). Картка тягнеться на всю висоту, прокрутка всередині неї.
 * `query`: фільтр за ім'ям чи номером (вкладка «Пошук»), тоді картка за вмістом і над нею «Знайдено: N».
 */
const props = defineProps<{ query?: string }>();
const { t } = useI18n();
const call = useCallStore();
const fmt = (p: string) => p.replace(/^\+380(\d\d)(\d{3})(\d\d)(\d\d)$/, '+380 $1 $2 $3 $4');
// демо-боти мають сценарії (docs/demo.md): статус показує, як вони поведуться
const BOTS: Record<string, { dot: string; text: string }> = {
  'bot:olena': { dot: 'bg-call-ok', text: 'contacts.bot.answers' },
  'bot:andriy': { dot: 'bg-warn', text: 'contacts.bot.ignores' },
  'bot:support': { dot: 'bg-call-bad', text: 'contacts.bot.busy' },
};
// порядок з дизайну: спершу демо-боти (Олена, Андрій, Support), далі люди: ті, хто в мережі, вище
const ORDER = ['bot:olena', 'bot:andriy', 'bot:support'];
const sorted = computed(() =>
  [...call.contacts].sort((a, b) => {
    const ia = ORDER.indexOf(a.userId),
      ib = ORDER.indexOf(b.userId);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'uk');
  }),
);
const searching = computed(() => props.query !== undefined && props.query.trim() !== '');
const shown = computed(() => {
  if (!searching.value) return sorted.value;
  const q = props.query!.trim().toLocaleLowerCase('uk');
  const digits = q.replace(/\D/g, '');
  return sorted.value.filter((c) => c.name.toLocaleLowerCase('uk').includes(q) || (digits.length > 0 && c.userId.includes(digits)));
});
const dot = (id: string, online: boolean) => BOTS[id]?.dot ?? (online ? 'bg-call-ok' : 'bg-mute');
// «Немає зв'язку» лише якщо розрив довший за 3 с: короткі перепідключення не блимають
const offline = ref(false);
let offlineTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () => call.online,
  (on) => {
    clearTimeout(offlineTimer);
    if (on) offline.value = false;
    else offlineTimer = setTimeout(() => (offline.value = true), 3_000);
  },
  { immediate: true },
);
onUnmounted(() => clearTimeout(offlineTimer));
const sub = (id: string, online: boolean) => {
  const bot = BOTS[id];
  return bot ? t(bot.text) : `${fmt(id)} · ${online ? t('contacts.online') : t('contacts.offline')}`;
};
</script>

<template>
  <section class="flex h-full min-h-0 flex-col">
    <h2 class="sr-only">{{ t('contacts.title') }}</h2>
    <template v-if="shown.length">
      <p v-if="searching" class="px-2.5 pb-1 text-xs font-semibold text-mute" role="status">{{ t('contacts.found', { n: shown.length }) }}</p>
      <Card class="min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] px-3 pb-2.5 pt-[18px]" :class="!searching && 'flex-1'">
        <div class="grid grid-cols-[minmax(0,1fr)] gap-1">
          <ContactRow v-for="c in shown" :key="c.userId" :name="c.name" :status="sub(c.userId, c.online)" :dot="dot(c.userId, c.online)" @call="call.call(c.userId)" />
        </div>
      </Card>
    </template>
    <EmptyState v-else class="my-auto pb-20" :icon="searching ? 'searchX' : 'users'" :title="searching ? t('contacts.notFound') : t('contacts.empty')" />
    <p v-if="offline" class="px-3 pt-3 text-sm text-mute" role="status">
      {{ t('contacts.noConnection') }}{{ call.netError ? ': ' + call.netError : '. ' + t('contacts.connecting') }}
    </p>
  </section>
</template>
