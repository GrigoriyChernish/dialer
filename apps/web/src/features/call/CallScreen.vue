<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Avatar from '@/shared/ui/Avatar.vue';
import CallStatePill, { type PillState } from '@/shared/ui/CallStatePill.vue';
import Icon from '@/shared/ui/Icon.vue';
import RoundButton from '@/shared/ui/RoundButton.vue';
import VideoSurface from '@/shared/ui/VideoSurface.vue';
import { useCallStore } from './store';

const { t } = useI18n();
const call = useCallStore();
const mm = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const name = computed(() => call.peer?.name ?? call.missed?.peer.name ?? '');
const first = computed(() => name.value.split(' ')[0]);
// рід співрозмовника: сервер його не віддає, тож як у прототипі: жіночий лише для Олени (беклог, пункт 6)
const g = computed(() => ((call.peer ?? call.missed?.peer)?.userId === 'bot:olena' ? 'f' : 'm'));
const connected = computed(() => call.status === 'connected');
// екран «In Call · video»: на весь екран відео співрозмовника
const video = computed(() => connected.value && call.link.peerCam && !call.peerHold);

// одна плашка за раз, за пріоритетом: утримання, зв'язок, мікрофон співрозмовника
const pill = computed<{ state: PillState; text: string } | null>(() => {
  if (!connected.value) return null;
  if (call.hold) return { state: 'hold', text: t('call.state.hold') };
  if (call.camHint) return { state: 'cameraUnavailable', text: t('call.state.cameraUnavailable') };
  if (call.peerHold) return { state: 'peerHold', text: t(`call.state.peerHold.${g.value}`, { name: first.value }) };
  if (call.link.reconnecting) return { state: 'reconnecting', text: t('call.state.reconnecting') };
  if (call.link.peerAway) return { state: 'connectionLost', text: t(`call.state.connectionLost.${g.value}`, { name: first.value }) };
  if (call.link.poor) return { state: 'poorSignal', text: t('call.state.poorSignal') };
  if (call.link.peerMuted) return { state: 'micOff', text: t(`call.state.micOff.${g.value}`, { name: first.value }) };
  return null;
});
// дизайн: аватар тьмянішає (прозорість .6), коли розмова призупинена чи співрозмовник втратив зв'язок
const dimmed = computed(() => ['hold', 'peerHold', 'connectionLost'].includes(pill.value?.state ?? ''));
const missedIcon = computed(() => (call.missed?.reason === 'incoming' || call.missed?.reason === 'timeout' ? 'phoneMissed' : 'phoneOff'));
const WAVE = [8, 16, 26, 16, 8];
const selfVideo = computed(() => call.cam && call.link.localCam && !call.hold);
</script>

<template>
  <!-- пропущений / зайнято / без відповіді / помилка -->
  <section
    v-if="call.status === 'idle' && call.missed"
    class="flex h-full flex-col px-6 pb-10 text-center"
    style="background: linear-gradient(180deg, var(--stage-missed-glow), var(--bg))"
  >
    <div class="flex flex-1 flex-col items-center justify-center gap-2.5">
      <!-- 200 × 200, як у дизайні (прозорі кільця), щоб аватар стояв там само, що на екрані виклику -->
      <span class="grid size-[200px] place-items-center"><Avatar :name="name" size="xl" muted /></span>
      <h3 class="text-[26px] font-bold">{{ name }}</h3>
      <p class="flex items-center gap-2 text-lg font-semibold text-call-bad"><Icon :name="missedIcon" class="size-[18px]" />{{ t(`call.missed.${call.missed.reason}`) }}</p>
      <small class="text-[13px] text-mute">{{ call.missed.note ? t(call.missed.note) : t(`call.missedNote.${call.missed.reason}`) }}</small>
    </div>
    <div class="flex justify-center gap-[72px]">
      <div class="grid w-22 justify-items-center gap-2 text-xs font-medium text-mute"><RoundButton :label="t('call.close')" @click="call.dismissMissed()"><Icon name="x" /></RoundButton>{{ t('call.close') }}</div>
      <div class="grid w-22 justify-items-center gap-2 text-xs font-medium text-mute"><RoundButton variant="ok" :label="t('call.redial')" @click="call.call(call.missed.peer.userId)"><Icon name="phone" /></RoundButton>{{ t('call.redial') }}</div>
    </div>
  </section>

  <!-- дзвонимо / вхідний / розмова -->
  <section v-else class="relative flex h-full flex-col overflow-hidden" style="background: linear-gradient(180deg, var(--stage-glow), var(--bg))" aria-live="polite">
    <template v-if="video">
      <VideoSurface kind="remote" :track="video" class="absolute inset-0" />
      <!-- градієнти під відео: згори 180, знизу 220 -->
      <div class="absolute inset-x-0 top-0 h-[180px]" style="background: linear-gradient(180deg, #000000a0, #00000000)" />
      <div class="absolute inset-x-0 bottom-0 h-[220px]" style="background: linear-gradient(0deg, #000000a0, #00000000)" />
    </template>

    <header v-if="connected" class="relative z-10 flex h-10 shrink-0 items-center justify-between px-4">
      <b class="text-base font-semibold">{{ name }}</b>
      <span class="rounded-[14px] bg-surface px-2.5 py-1 text-[13px] font-medium tabular-nums">{{ mm(call.seconds) }}</span>
    </header>
    <div v-if="video && pill" class="absolute left-5 top-12 z-10"><CallStatePill :state="pill.state">{{ pill.text }}</CallStatePill></div>

    <!-- мініатюра себе (дизайн: Self View) і кнопка «показати себе» (Show Self); без камери їх не показуємо -->
    <template v-if="connected && !call.camBlocked">
      <button
        v-if="!call.selfHidden"
        type="button"
        :aria-label="t('call.hideSelf')"
        class="absolute right-4 top-[72px] z-10 grid h-[122px] w-[92px] place-items-center overflow-hidden rounded-2xl border border-line bg-pip text-[13px] text-mute"
        :class="selfVideo && 'shadow-[0_10px_24px_#00000066]'"
        @click="call.selfHidden = true"
      >
        <VideoSurface v-if="selfVideo" kind="local" :track="selfVideo" class="absolute inset-0" />
        <span v-if="!call.cam || call.hold" class="px-1 text-xs">{{ t('call.camOff') }}</span>
        <span v-else class="relative" :class="selfVideo && 'text-fg drop-shadow'">{{ t('call.you') }}</span>
        <!-- бейдж «мій мікрофон вимкнено»: 22 × 22, праворуч угорі, відступ 6 (дизайн: My Mic Off) -->
        <span v-if="!call.mic" class="absolute right-1.5 top-1.5 grid size-[22px] place-items-center rounded-full bg-call-bad text-white" :title="t('call.myMicOff')"><Icon name="micOff" class="size-3" /></span>
      </button>
      <button
        v-else
        type="button"
        :aria-label="t('call.showSelf')"
        class="absolute right-5 top-14 z-10 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg"
        @click="call.selfHidden = false"
      >
        <Icon name="video" class="size-5" />
      </button>
    </template>

    <div v-if="!video" class="flex flex-1 flex-col items-center justify-center gap-3 px-6">
      <span class="grid size-[200px] place-items-center rounded-full bg-accent/[.08]">
        <span class="grid size-[152px] place-items-center rounded-full bg-accent/[.14]" :class="!connected && 'animate-ring'">
          <Avatar :name="name" size="xl" :opacity="dimmed ? 0.6 : undefined" />
        </span>
      </span>
      <h3 class="mt-1 text-[26px] font-bold">{{ name }}</h3>

      <p v-if="call.status === 'ringing'" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"><Icon name="phoneOutgoing" class="size-4" />{{ t('call.outgoing') }}</p>
      <p v-else-if="call.status === 'incoming'" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"><Icon name="phoneIncoming" class="size-4" />{{ t('call.incomingLabel') }}</p>
      <CallStatePill v-else-if="pill" :state="pill.state">{{ pill.text }}</CallStatePill>
      <div v-else class="flex h-7 items-center gap-1" aria-hidden="true">
        <i v-for="(h, i) in WAVE" :key="i" class="w-1 origin-center rounded-sm bg-accent motion-safe:animate-wave" :style="{ height: h + 'px', animationDelay: i * 0.12 + 's' }" />
      </div>
      <small v-if="!connected && call.left" class="text-xs text-mute">{{ t('call.left', { time: mm(call.left) }) }}</small>
    </div>
    <div v-else class="flex-1" />

    <div class="relative z-10 flex justify-center pb-10">
      <div v-if="connected" class="flex gap-2.5 rounded-[40px] border border-line bg-surface p-2.5">
        <RoundButton :label="call.mic ? t('call.mute') : t('call.unmute')" :active="!call.mic" :disabled="call.hold" @click="call.toggleMic()"><Icon :name="call.mic ? 'mic' : 'micOff'" /></RoundButton>
        <RoundButton :label="call.camBlocked ? t('call.cameraUnavailable') : call.cam ? t('call.camera') : t('call.cameraOn')" :active="!call.cam && !call.camBlocked" :unavailable="call.camBlocked" :disabled="call.hold" @click="call.toggleCam()"><Icon :name="call.cam ? 'video' : 'videoOff'" /></RoundButton>
        <RoundButton :label="call.hold ? t('call.resume') : t('call.hold')" :active="call.hold" @click="call.toggleHold()"><Icon name="pause" /></RoundButton>
        <RoundButton variant="bad" :label="t('call.hangup')" @click="call.end()"><Icon name="x" /></RoundButton>
      </div>
      <div v-else-if="call.status === 'incoming'" class="flex gap-[72px]">
        <div class="grid w-22 justify-items-center gap-2 text-xs font-medium text-mute"><RoundButton variant="bad" :label="t('call.reject')" @click="call.end()"><Icon name="x" /></RoundButton>{{ t('call.reject') }}</div>
        <div class="grid w-22 justify-items-center gap-2 text-xs font-medium text-mute"><RoundButton variant="ok" :label="t('call.accept')" @click="call.accept()"><Icon name="phone" /></RoundButton>{{ t('call.accept') }}</div>
      </div>
      <RoundButton v-else variant="bad" :label="t('call.cancel')" @click="call.end()"><Icon name="x" /></RoundButton>
    </div>
  </section>
</template>
