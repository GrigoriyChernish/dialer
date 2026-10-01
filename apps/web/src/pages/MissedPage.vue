<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ContactRow from '@/features/contacts/ContactRow.vue';
import { useCallStore } from '@/features/call/store';
import Card from '@/shared/ui/Card.vue';
import EmptyState from '@/shared/ui/EmptyState.vue';

// Вкладка «Пропущені» (дизайн: Home · Missed): одна картка з групами за днями, прокрутка всередині.
const { t } = useI18n();
const call = useCallStore();
const fmt = (p: string) => p.replace(/^\+380(\d\d)(\d{3})(\d\d)(\d\d)$/, '+380 $1 $2 $3 $4');
const name = (id: string) => call.contacts.find((c) => c.userId === id)?.name ?? fmt(id);
const time = (ms: number) => new Date(ms).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' });
const dayStart = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const dayLabel = (ms: number) => {
  const days = Math.round((dayStart(Date.now()) - dayStart(ms)) / 86_400_000);
  return days === 0 ? t('missed.today') : days === 1 ? t('missed.yesterday') : new Date(ms).toLocaleDateString('uk', { day: 'numeric', month: 'long' });
};
const groups = computed(() => {
  const out: { day: string; items: typeof call.missedCalls }[] = [];
  for (const r of call.missedCalls) {
    const day = dayLabel(r.startedAt);
    if (out.at(-1)?.day !== day) out.push({ day, items: [] });
    out.at(-1)!.items.push(r);
  }
  return out;
});
// поки вкладка відкрита, нові пропущені одразу вважаються переглянутими
watch(() => call.missedCalls.length, () => call.markMissedSeen(), { immediate: true });
</script>

<template>
  <section class="flex h-full min-h-0 flex-col">
    <h2 class="sr-only">{{ t('missed.title') }}</h2>
    <Card v-if="groups.length" class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] px-3 pb-2.5 pt-3.5">
      <template v-for="(g, i) in groups" :key="g.day">
        <h3 class="px-2.5 pb-1 text-xs font-semibold text-mute" :class="i > 0 && 'pt-3'">{{ g.day }}</h3>
        <div class="grid grid-cols-[minmax(0,1fr)] gap-1">
          <ContactRow
            v-for="r in g.items"
            :key="r.callId"
            :name="name(r.peer)"
            :status="`${t('missed.label')} · ${time(r.startedAt)}`"
            dot="bg-call-bad"
            @call="call.call(r.peer)"
          />
        </div>
      </template>
    </Card>
    <EmptyState v-else class="my-auto pb-20" icon="phoneMissed" :title="t('missed.empty')" />
  </section>
</template>
