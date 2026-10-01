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
const connected = computed(() => call.status === 'connected');
const stateLine = computed(() => {
  if (call.hold) return t('call.youHold');
  if (call.peerHold) return t('call.peerHold', { name: name.value.split(' ')[0] });
  return '';
});
const WAVE = [8, 16, 26, 16, 8];
</script>

<template>
  <!-- пропущений / зайнято / помилка -->
  <section
    v-if="call.status === 'idle' && call.missed"
    class="flex h-full flex-col items-center justify-between px-6 pb-10 pt-24 text-center"
    style="background: linear-gradient(180deg, var(--stage-missed-glow), var(--bg))"
  >
    <div class="grid justify-items-center gap-2.5">
      <Avatar :name="name" size="xl" dim />
      <h3 class="text-[26px] font-bold">{{ name }}</h3>
      <p class="font-semibold text-call-bad">{{ t(`call.missed.${call.missed.reason}`) }}</p>
      <small class="text-mute">{{ call.missed.note ? t(call.missed.note) : t(`call.missedNote.${call.missed.reason}`) }}</small>
    </div>
    <div class="flex gap-10">
      <div class="grid justify-items-center gap-2 text-xs text-mute"><RoundButton :label="t('call.close')" @click="call.dismissMissed()"><Icon name="x" /></RoundButton>{{ t('call.close') }}</div>
      <div class="grid justify-items-center gap-2 text-xs text-mute"><RoundButton variant="ok" :label="t('call.redial')" @click="call.call(call.missed.peer.userId)"><Icon name="phone" /></RoundButton>{{ t('call.redial') }}</div>
    </div>
  </section>

  <!-- дзвонимо / вхідний / розмова -->
  <section v-else class="relative flex h-full flex-col" style="background: linear-gradient(180deg, var(--stage-glow), var(--bg))" aria-live="polite">
    <header v-if="connected" class="flex items-center justify-between px-4 py-3">
      <b class="text-base font-semibold">{{ name }}</b>
      <span class="rounded-[14px] bg-surface px-2.5 py-1 text-[13px] font-medium tabular-nums">{{ mm(call.seconds) }}</span>
    </header>

    <!-- «Ви»: мініатюра себе, як у дизайні -->
    <div v-if="connected" class="absolute right-4 top-16 z-10 grid h-[122px] w-[92px] place-items-center rounded-2xl border border-line bg-pip text-[13px] text-mute">{{ t('call.you') }}</div>

    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6">
      <span class="grid size-[200px] place-items-center rounded-full bg-accent/[.08]">
        <span class="grid size-[152px] place-items-center rounded-full bg-accent/[.14]" :class="!connected && 'animate-ring'">
          <Avatar :name="name" size="xl" />
        </span>
      </span>
      <h3 class="mt-1 text-[26px] font-bold">{{ name }}</h3>

      <p v-if="call.status === 'ringing'" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"><Icon name="phoneOut" class="size-4" />{{ t('call.outgoing') }}</p>
      <p v-else-if="call.status === 'incoming'" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"><Icon name="phoneIn" class="size-4" />{{ t('call.incomingLabel') }}</p>
      <div v-else-if="!stateLine" class="flex h-7 items-center gap-1" aria-hidden="true">
        <i v-for="(h, i) in WAVE" :key="i" class="w-1 origin-center rounded-sm bg-accent motion-safe:animate-wave" :style="{ height: h + 'px', animationDelay: i * 0.12 + 's' }" />
      </div>
      <p v-else class="rounded-full bg-surface px-3 py-1 text-[13px]" role="status">{{ stateLine }}</p>
      <small v-if="!connected && call.left" class="text-mute">{{ t('call.left', { time: mm(call.left) }) }}</small>
    </div>

    <div class="flex justify-center pb-10">
      <div v-if="connected" class="flex gap-2.5 rounded-[40px] border border-line bg-surface p-2.5">
        <RoundButton :label="call.mic ? t('call.mute') : t('call.unmute')" :active="!call.mic" :disabled="call.hold" @click="call.toggleMic()"><Icon :name="call.mic ? 'mic' : 'micOff'" /></RoundButton>
        <RoundButton :label="call.hold ? t('call.resume') : t('call.hold')" :active="call.hold" @click="call.toggleHold()"><Icon name="pause" /></RoundButton>
        <RoundButton variant="bad" :label="t('call.hangup')" @click="call.end()"><Icon name="x" /></RoundButton>
      </div>
      <div v-else-if="call.status === 'incoming'" class="flex gap-16">
        <RoundButton variant="bad" :label="t('call.reject')" @click="call.end()"><Icon name="x" /></RoundButton>
        <RoundButton variant="ok" :label="t('call.accept')" @click="call.accept()"><Icon name="phone" /></RoundButton>
      </div>
      <RoundButton v-else variant="bad" :label="t('call.cancel')" @click="call.end()"><Icon name="x" /></RoundButton>
    </div>
  </section>
</template>
