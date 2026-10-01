<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Avatar from '@/shared/ui/Avatar.vue';
import Icon from '@/shared/ui/Icon.vue';
import RoundButton from '@/shared/ui/RoundButton.vue';
import { useCallStore } from './store';

const { t } = useI18n();
const call = useCallStore();
const mm = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const name = computed(() => call.peer?.name ?? call.missed?.peer.name ?? '');
const statusLine = computed(() => {
  if (call.status === 'incoming') return t('call.incoming');
  if (call.status === 'ringing') return t('call.calling');
  if (call.hold) return t('call.youHold');
  if (call.peerHold) return t('call.peerHold', { name: name.value.split(' ')[0] });
  return '';
});
</script>

<template>
  <!-- пропущений / зайнято / помилка -->
  <section v-if="call.status === 'idle' && call.missed" class="flex h-full flex-col items-center justify-between p-8 text-center">
    <div class="mt-16 grid justify-items-center gap-2">
      <Avatar :name="name" size="xl" dim />
      <h3 class="mt-3 text-2xl font-semibold">{{ name }}</h3>
      <p class="font-medium">{{ t(`call.missed.${call.missed.reason}`) }}</p>
      <small class="text-mute">{{ call.missed.note ? t(call.missed.note) : t(`call.missedNote.${call.missed.reason}`) }}</small>
    </div>
    <div class="flex gap-10">
      <div class="grid justify-items-center gap-1 text-sm"><RoundButton :label="t('call.close')" @click="call.dismissMissed()"><Icon name="x" /></RoundButton>{{ t('call.close') }}</div>
      <div class="grid justify-items-center gap-1 text-sm"><RoundButton variant="ok" :label="t('call.redial')" @click="call.call(call.missed.peer.userId)"><Icon name="phone" /></RoundButton>{{ t('call.redial') }}</div>
    </div>
  </section>

  <!-- дзвонимо / вхідний / розмова -->
  <section v-else class="flex h-full flex-col items-center justify-between p-8 text-center" aria-live="polite">
    <header v-if="call.status === 'connected'" class="flex w-full justify-between text-sm">
      <b>{{ name }}</b><span class="tabular-nums">{{ mm(call.seconds) }}</span>
    </header>
    <div v-else />
    <div class="grid justify-items-center gap-2">
      <span class="rounded-full" :class="call.status !== 'connected' && 'animate-ring'"><Avatar :name="name" size="xl" /></span>
      <h3 class="mt-3 text-2xl font-semibold">{{ name }}</h3>
      <p class="text-mute">{{ statusLine }}</p>
      <small v-if="call.status !== 'connected' && call.left" class="text-mute">{{ t('call.left', { time: mm(call.left) }) }}</small>
    </div>
    <div class="flex items-center gap-5">
      <template v-if="call.status === 'connected'">
        <RoundButton :label="call.mic ? t('call.mute') : t('call.unmute')" :active="!call.mic" :disabled="call.hold" @click="call.toggleMic()"><Icon :name="call.mic ? 'mic' : 'micOff'" /></RoundButton>
        <RoundButton :label="call.hold ? t('call.resume') : t('call.hold')" :active="call.hold" @click="call.toggleHold()"><Icon name="pause" /></RoundButton>
        <RoundButton variant="bad" :label="t('call.hangup')" @click="call.end()"><Icon name="x" /></RoundButton>
      </template>
      <template v-else-if="call.status === 'incoming'">
        <RoundButton variant="bad" :label="t('call.reject')" @click="call.end()"><Icon name="x" /></RoundButton>
        <RoundButton variant="ok" :label="t('call.accept')" @click="call.accept()"><Icon name="phone" /></RoundButton>
      </template>
      <RoundButton v-else variant="bad" :label="t('call.cancel')" @click="call.end()"><Icon name="x" /></RoundButton>
    </div>
  </section>
</template>
