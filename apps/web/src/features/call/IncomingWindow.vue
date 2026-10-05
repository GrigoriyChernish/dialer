<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { tauriInvoke } from '@/shared/native/notify';
import Avatar from '@/shared/ui/Avatar.vue';
import Icon from '@/shared/ui/Icon.vue';
import RoundButton from '@/shared/ui/RoundButton.vue';

/**
 * Міні-вікно вхідного на десктопі (дизайн: Desktop · Incoming window): аватар, ім'я, «Вхідний дзвінок» і дві кнопки.
 * Дзвінок із query (`callId`, `name`); вибір іде в Rust (`incoming_action`), який закриває вікно й передає його основному вікну.
 */
const { t } = useI18n();
const q = new URLSearchParams(location.search);
const callId = q.get('callId') ?? '';
const name = q.get('name') || t('call.notify.unknown');
const act = (kind: 'answer' | 'decline') => void tauriInvoke('incoming_action', { kind, callId });
</script>

<template>
  <main
    data-tauri-drag-region
    class="flex h-screen items-center gap-3.5 border border-line px-4"
    style="background: linear-gradient(180deg, var(--stage-glow), var(--bg))"
    role="alertdialog"
    :aria-label="t('call.incomingLabel')"
  >
    <Avatar :name="name" size="lg" class="pointer-events-none" />
    <div class="pointer-events-none grid min-w-0 flex-1 gap-0.5">
      <b class="truncate text-base font-semibold">{{ name }}</b>
      <small class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ok-text">
        <Icon name="phoneIncoming" class="size-4" />{{ t('call.incomingLabel') }}
      </small>
    </div>
    <RoundButton variant="bad" :label="t('call.reject')" @click="act('decline')"><Icon name="x" /></RoundButton>
    <RoundButton variant="ok" :label="t('call.accept')" @click="act('answer')"><Icon name="phone" /></RoundButton>
  </main>
</template>
