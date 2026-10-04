<script setup lang="ts">
import type { PresenceStatus } from '@dialer/shared';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ContactRow from '@/features/contacts/ContactRow.vue';
import ContactRowSkeleton from '@/features/contacts/ContactRowSkeleton.vue';
import { useLoadState } from '@/features/contacts/loadState';
import { useCallStore } from '@/features/call/store';
import Card from '@/shared/ui/Card.vue';
import EmptyState from '@/shared/ui/EmptyState.vue';

/**
 * Список контактів у картці (дизайн: Home · Contacts). Картка тягнеться на всю висоту, прокрутка всередині неї.
 * `query`: фільтр за ім'ям чи номером (вкладка «Пошук»), тоді картка за вмістом.
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
  'bot:video': { dot: 'bg-call-ok', text: 'contacts.bot.video' },
};
// порядок з дизайну: спершу демо-боти (Олена, Андрій, Support, Відео-тест), далі люди: досяжні (не `offline`) вище
const ORDER = ['bot:olena', 'bot:andriy', 'bot:support', 'bot:video'];
const sorted = computed(() =>
  [...call.contacts].sort((a, b) => {
    const ia = ORDER.indexOf(a.userId),
      ib = ORDER.indexOf(b.userId);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return Number(b.status !== 'offline') - Number(a.status !== 'offline') || a.name.localeCompare(b.name, 'uk');
  }),
);
const searching = computed(() => props.query !== undefined && props.query.trim() !== '');
const shown = computed(() => {
  if (!searching.value) return sorted.value;
  const q = props.query!.trim().toLocaleLowerCase('uk');
  const digits = q.replace(/\D/g, '');
  return sorted.value.filter(
    c => c.name.toLocaleLowerCase('uk').includes(q) || (digits.length > 0 && c.userId.includes(digits)),
  );
});
/**
 * Статус від сервера (docs/signaling.md#статус-контакта). `free` і `away` (вікно приховане чи лише сповіщення) обидва «онлайн»:
 * дзвінок дійде; «зайнятий» і «не турбувати» кольорами `Presence`.
 */
const STATUS: Record<PresenceStatus, { dot: string; text: string }> = {
  free: { dot: 'bg-call-ok', text: 'contacts.online' },
  away: { dot: 'bg-call-ok', text: 'contacts.online' },
  busy: { dot: 'bg-warn', text: 'contacts.busy' },
  dnd: { dot: 'bg-call-bad', text: 'contacts.dnd' },
  offline: { dot: 'bg-mute', text: 'contacts.offline' },
};
const dot = (id: string, status: PresenceStatus) => BOTS[id]?.dot ?? STATUS[status].dot;
// поки немає першого hello.ok: заготовка, а без зв'язку довше 3 с — Empty State (дизайн: Home · Contacts · loading, offline)
const { skeleton, offline } = useLoadState();
const sub = (id: string, status: PresenceStatus) => {
  const bot = BOTS[id];
  return bot ? t(bot.text) : `${fmt(id)} · ${t(STATUS[status].text)}`;
};
</script>

<template>
  <section class="flex h-full min-h-0 flex-col">
    <h2 class="sr-only">{{ t('contacts.title') }}</h2>
    <EmptyState
      v-if="!call.ready && offline"
      class="my-auto pb-20"
      icon="wifiOff"
      :title="t('contacts.noConnection')"
      :caption="call.netError || t('contacts.connecting')"
    />
    <!-- прокрутка у внутрішньому блоці: картка обрізає її по своїх скругленнях -->
    <Card
      v-else-if="call.ready ? shown.length : skeleton"
      class="flex min-h-0 flex-col overflow-hidden"
      :class="(!searching || !call.ready) && 'flex-1'"
      :aria-busy="!call.ready"
    >
      <!-- заготовка не прокручується: зайві рядки просто обрізаються -->
      <div
        class="grid min-h-0 grid-cols-[minmax(0,1fr)] content-start gap-1 px-3 pb-2.5 pt-[18px]"
        :class="call.ready ? 'scroll' : 'overflow-hidden'"
      >
        <template v-if="!call.ready">
          <p class="sr-only" role="status">{{ t('contacts.loading') }}</p>
          <ContactRowSkeleton v-for="i in 9" :key="i" :index="i - 1" />
        </template>
        <template v-else>
          <ContactRow
            v-for="c in shown"
            :key="c.userId"
            :name="c.name"
            :status="sub(c.userId, c.status)"
            :dot="dot(c.userId, c.status)"
            @call="call.call(c.userId)"
          />
        </template>
      </div>
    </Card>
    <EmptyState
      v-else-if="call.ready"
      class="my-auto pb-20"
      :icon="searching ? 'searchX' : 'users'"
      :title="searching ? t('contacts.notFound') : t('contacts.empty')"
    />
  </section>
</template>
