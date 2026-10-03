<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RecentEntry, RecentResult } from '@dialer/shared';
import ContactRow from '@/features/contacts/ContactRow.vue';
import ContactRowSkeleton from '@/features/contacts/ContactRowSkeleton.vue';
import { useLoadState } from '@/features/contacts/loadState';
import { useCallStore } from '@/features/call/store';
import Card from '@/shared/ui/Card.vue';
import EmptyState from '@/shared/ui/EmptyState.vue';

// Вкладка «Історія» (дизайн: Home · History): усі дзвінки з `recents` в одній картці з групами за днями, прокрутка всередині.
const { t } = useI18n();
const call = useCallStore();
// поки немає першого hello.ok: заготовка чи Empty State без зв'язку, як у контактах (дизайн: Home · History · loading)
const { skeleton, offline } = useLoadState();
const fmt = (p: string) => p.replace(/^\+380(\d\d)(\d{3})(\d\d)(\d\d)$/, '+380 $1 $2 $3 $4');
const name = (id: string) => call.contacts.find(c => c.userId === id)?.name ?? fmt(id);
const time = (ms: number) => new Date(ms).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });
const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const dayLabel = (ms: number) => {
  const days = Math.round((dayStart(Date.now()) - dayStart(ms)) / 86_400_000);
  return days === 0
    ? t('history.today')
    : days === 1
      ? t('history.yesterday')
      : new Date(ms).toLocaleDateString('uk', { day: 'numeric', month: 'long' });
};
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
// колір аватара й статусу (як у станів Peer Ring): пропущений `bad`, «не додзвонились» `warn`, решта нейтральна
const TONE: Partial<Record<RecentResult, 'bad' | 'warn'>> = {
  missed: 'bad',
  busy: 'warn',
  no_answer: 'warn',
  failed: 'warn',
};
const icon = (r: RecentEntry) => (r.result === 'missed' ? 'phoneMissed' : r.direction === 'in' ? 'phoneIncoming' : 'phoneOutgoing');
const status = (r: RecentEntry) => {
  const label = r.result === 'completed' ? t(`history.${r.direction}`) : t(`history.result.${r.result}`);
  return [label, time(r.startedAt), r.result === 'completed' && r.duration !== undefined && mmss(r.duration)]
    .filter(Boolean)
    .join(' · ');
};
const groups = computed(() => {
  const out: { day: string; items: RecentEntry[] }[] = [];
  for (const r of call.recents) {
    const day = dayLabel(r.startedAt);
    if (out.at(-1)?.day !== day) out.push({ day, items: [] });
    out.at(-1)!.items.push(r);
  }
  return out;
});
// поки вкладка відкрита, нові пропущені одразу вважаються переглянутими
watch(
  () => call.missedCalls.length,
  () => call.markMissedSeen(),
  { immediate: true },
);
</script>

<template>
  <section class="flex h-full min-h-0 flex-col">
    <h2 class="sr-only">{{ t('history.title') }}</h2>
    <EmptyState
      v-if="!call.ready && offline"
      class="my-auto pb-20"
      icon="wifiOff"
      :title="t('contacts.noConnection')"
      :caption="call.netError || t('contacts.connecting')"
    />
    <!-- прокрутка у внутрішньому блоці: картка обрізає її по своїх скругленнях -->
    <Card
      v-else-if="call.ready ? groups.length : skeleton"
      class="flex min-h-0 flex-1 flex-col overflow-hidden"
      :aria-busy="!call.ready"
    >
      <div class="min-h-0 px-3 pb-2.5 pt-3.5" :class="call.ready ? 'scroll' : 'overflow-hidden'">
        <div v-if="!call.ready" class="grid gap-1">
          <p class="sr-only" role="status">{{ t('history.loading') }}</p>
          <ContactRowSkeleton v-for="i in 9" :key="i" :index="i - 1" />
        </div>
        <template v-for="(g, i) in groups" v-else :key="g.day">
          <h3 class="px-2.5 pb-1 text-xs font-semibold text-mute" :class="i > 0 && 'pt-3'">{{ g.day }}</h3>
          <div class="grid grid-cols-[minmax(0,1fr)] gap-1">
            <ContactRow
              v-for="r in g.items"
              :key="r.callId"
              :name="name(r.peer)"
              :status="status(r)"
              :icon="icon(r)"
              :tone="TONE[r.result]"
              @call="call.call(r.peer)"
            />
          </div>
        </template>
      </div>
    </Card>
    <EmptyState v-else-if="call.ready" class="my-auto pb-20" icon="history" :title="t('history.empty')" />
  </section>
</template>
