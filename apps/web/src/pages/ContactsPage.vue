<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useCallStore } from '@/features/call/store';
import Avatar from '@/shared/ui/Avatar.vue';
import Icon from '@/shared/ui/Icon.vue';

const { t } = useI18n();
const call = useCallStore();
const fmt = (p: string) => p.replace(/^\+380(\d\d)(\d{3})(\d\d)(\d\d)$/, '+380 $1 $2 $3 $4');
const sub = (id: string, online: boolean) => (id.startsWith('bot:') ? t('contacts.demo') : `${fmt(id)} · ${online ? t('contacts.online') : t('contacts.offline')}`);
</script>

<template>
  <section class="p-3">
    <h2 class="px-2 pb-2 pt-1 text-xl font-semibold">{{ t('contacts.title') }}</h2>
    <button
      v-for="c in call.contacts"
      :key="c.userId"
      type="button"
      class="flex w-full items-center gap-3 rounded-2xl p-2 text-left hover:bg-fg/5 focus-visible:outline-2 focus-visible:outline-accent"
      @click="call.call(c.userId)"
    >
      <Avatar :name="c.name" />
      <span class="min-w-0 flex-1">
        <b class="block truncate">{{ c.name }}</b>
        <small class="text-mute">{{ sub(c.userId, c.online) }}</small>
      </span>
      <span class="grid size-10 place-items-center rounded-full bg-call-ok/15 text-call-ok" :title="t('contacts.call')"><Icon name="phone" class="size-5" /></span>
    </button>
    <p v-if="!call.online" class="px-3 py-2 text-sm text-mute" role="status">
      {{ t('contacts.noConnection') }}{{ call.netError ? ': ' + call.netError : '. ' + t('contacts.connecting') }}
    </p>
  </section>
</template>
