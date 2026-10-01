<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCallStore } from '@/features/call/store';
import Avatar from '@/shared/ui/Avatar.vue';
import Icon from '@/shared/ui/Icon.vue';

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
const dot = (id: string, online: boolean) => BOTS[id]?.dot ?? (online ? 'bg-call-ok' : 'bg-mute');
const sub = (id: string, online: boolean) => {
  const bot = BOTS[id];
  return bot ? t(bot.text) : `${fmt(id)} · ${online ? t('contacts.online') : t('contacts.offline')}`;
};
</script>

<template>
  <section class="p-4">
    <div
      class="grid gap-1 rounded-[28px] border border-line px-3 pb-2.5 pt-[18px]"
      style="background: linear-gradient(160deg, var(--card-top), var(--card-bottom))"
    >
      <h2 class="sr-only">{{ t('contacts.title') }}</h2>
      <button
        v-for="c in sorted"
        :key="c.userId"
        type="button"
        class="group flex w-full cursor-pointer items-center gap-3.5 rounded-[18px] px-2.5 py-[11px] text-left transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:bg-surface active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-accent"
        :aria-label="`${t('contacts.call')}: ${c.name}`"
        @click="call.call(c.userId)"
      >
        <Avatar :name="c.name" />
        <span class="grid min-w-0 flex-1 gap-0.5">
          <b class="truncate text-sm font-semibold">{{ c.name }}</b>
          <small class="flex items-center gap-1.5 text-xs text-mute">
            <i class="size-[7px] shrink-0 rounded-full" :class="dot(c.userId, c.online)" />
            <span class="truncate">{{ sub(c.userId, c.online) }}</span>
          </small>
        </span>
        <span
          class="grid size-9 shrink-0 place-items-center rounded-full bg-call-ok/15 text-call-ok transition-colors duration-150 group-hover:bg-call-ok group-hover:text-white"
          ><Icon name="phone" class="size-4"
        /></span>
      </button>
    </div>
    <p v-if="!call.online" class="px-3 pt-3 text-sm text-mute" role="status">
      {{ t('contacts.noConnection') }}{{ call.netError ? ': ' + call.netError : '. ' + t('contacts.connecting') }}
    </p>
  </section>
</template>
