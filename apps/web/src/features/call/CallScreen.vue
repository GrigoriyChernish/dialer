<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Icon from '@/shared/ui/Icon.vue';
import BannerStack, { type BannerItem } from '@/shared/ui/BannerStack.vue';
import { banner } from '@/shared/ui/banners';
import RoundButton from '@/shared/ui/RoundButton.vue';
import SelfStatusChip, { type SelfStatus } from '@/shared/ui/SelfStatusChip.vue';
import VideoSurface from '@/shared/ui/VideoSurface.vue';
import VoiceWave from '@/shared/ui/VoiceWave.vue';
import Peer from './Peer.vue';
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

// смужка співрозмовника внизу над панеллю керування (дизайн: Peer Banner), одна за раз: утримання, зв'язок, мікрофон
const peerBanners = computed<BannerItem[]>(() => {
  if (!connected.value) return [];
  const who = { name: first.value };
  if (call.peerHold) return [banner('peerHold', t(`call.peer.hold.${g.value}`, who))];
  if (call.link.peerAway) return [banner('connectionLost', t(`call.peer.connectionLost.${g.value}`, who))];
  if (call.link.peerMuted) return [banner('peerMicOff', t(`call.peer.micOff.${g.value}`, who))];
  return [];
});
// хвиля голосу лише коли співрозмовник на зв'язку й говорить може (без утримання, обриву й вимкненого мікрофона)
const talking = computed(() => peerBanners.value.length === 0);
// дизайн: аватар тьмянішає (прозорість .6), коли розмова призупинена чи співрозмовник втратив зв'язок
const dimmed = computed(() => call.hold || call.peerHold || call.link.peerAway);
// смужки під шапкою (дизайн: Self Banner): наша мережа, потім сповіщення про наші пристрої
const banners = computed<BannerItem[]>(() => {
  if (!connected.value) return [];
  const list: BannerItem[] = [];
  if (call.link.reconnecting) list.push(banner('reconnecting', t('call.network.reconnecting')));
  else if (call.link.poor) list.push(banner('poorSignal', t('call.network.poorSignal')));
  if (call.hint === 'cam') list.push(banner('cameraUnavailable', t('call.notice.cameraUnavailable')));
  if (call.hint === 'mic') list.push(banner('micUnavailable', t('call.notice.micUnavailable')));
  return list;
});
const missedIcon = computed(() => (call.missed?.reason === 'incoming' || call.missed?.reason === 'timeout' ? 'phoneMissed' : 'phoneOff'));
// наші статуси в шапці (дизайн: Self Status), зліва направо: утримання, мікрофон, камера; «недоступно» сильніше за «вимкнено»
const selfStatuses = computed<{ status: SelfStatus; label: string }[]>(() => {
  const list: { status: SelfStatus; label: string }[] = [];
  if (call.hold) list.push({ status: 'hold', label: t('call.self.hold') });
  if (call.micBlocked) list.push({ status: 'micUnavailable', label: t('call.self.micUnavailable') });
  else if (!call.mic) list.push({ status: 'micOff', label: t('call.self.micOff') });
  if (call.camBlocked) list.push({ status: 'camUnavailable', label: t('call.self.camUnavailable') });
  else if (!call.cam) list.push({ status: 'camOff', label: t('call.self.camOff') });
  return list;
});
const selfVideo = computed(() => call.cam && call.link.localCam && !call.hold);
</script>

<template>
  <!-- пропущений / зайнято / без відповіді / помилка -->
  <section v-if="call.status === 'idle' && call.missed" class="relative h-full" style="background: linear-gradient(180deg, var(--stage-missed-glow), var(--bg))">
    <Peer class="peer-pos" :name="name" variant="result">
      <p class="flex items-center gap-2 text-lg font-semibold text-call-bad"><Icon :name="missedIcon" class="size-[18px]" />{{ t(`call.missed.${call.missed.reason}`) }}</p>
      <small class="text-[13px] text-mute">{{ call.missed.note ? t(call.missed.note) : t(`call.missedNote.${call.missed.reason}`) }}</small>
    </Peer>
    <div class="absolute inset-x-0 bottom-10 flex justify-center gap-[72px]">
      <div class="grid w-22 justify-items-center gap-2 text-xs font-medium text-mute"><RoundButton variant="subtle" :label="t('call.close')" @click="call.dismissMissed()"><Icon name="x" /></RoundButton>{{ t('call.close') }}</div>
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
      <div class="flex items-center gap-2">
        <SelfStatusChip v-for="s in selfStatuses" :key="s.status" :status="s.status" :label="s.label" />
        <span class="rounded-[14px] bg-surface px-2.5 py-1 text-[13px] font-medium tabular-nums">{{ mm(call.seconds) }}</span>
      </div>
    </header>
    <!-- смужки-пігулки поверх екрана під шапкою (h-10 + 6), відступ 16 з боків, вміст не зсувають -->
    <BannerStack v-if="connected" class="pointer-events-none absolute inset-x-4 top-[46px] z-20" :items="banners" />
    <!-- смужка співрозмовника внизу: над панеллю керування (відступ 40 + висота панелі 74 + проміжок 8) -->
    <BannerStack v-if="connected" class="pointer-events-none absolute inset-x-4 bottom-[122px] z-20" :items="peerBanners" />

    <div class="relative flex min-h-0 flex-1 flex-col">
      <!-- мініатюра себе (дизайн: Self View) і кнопка «показати себе» (Show Self); без камери їх не показуємо -->
      <template v-if="connected && !call.camBlocked">
        <button
          v-if="!call.selfHidden"
          type="button"
          :aria-label="t('call.hideSelf')"
          class="absolute right-4 top-8 z-10 grid h-[122px] w-[92px] cursor-pointer place-items-center overflow-hidden rounded-2xl border border-line bg-pip text-[13px] text-mute transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:border-white/30 active:scale-[0.98]"
          :class="selfVideo && 'shadow-[0_10px_24px_#00000066]'"
          @click="call.selfHidden = true"
        >
          <VideoSurface v-if="selfVideo" kind="local" :track="selfVideo" class="absolute inset-0" />
          <span v-if="!call.cam || call.hold" class="px-1 text-xs">{{ t('call.camOff') }}</span>
          <span v-else class="relative" :class="selfVideo && 'text-fg drop-shadow'">{{ t('call.you') }}</span>
        </button>
        <button
          v-else
          type="button"
          :aria-label="t('call.showSelf')"
          class="absolute right-5 top-4 z-10 grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:border-white/30 hover:bg-surface-strong active:scale-95"
          @click="call.selfHidden = false"
        >
          <Icon name="video" class="size-5" />
        </button>
      </template>

      <div class="flex-1" />
    </div>
    <!-- блок співрозмовника на одній висоті в усіх станах (поза потоком, тож шапка й кнопки його не зсувають) -->
    <Peer v-if="!video" class="peer-pos" :name="name" :variant="dimmed ? 'dimmed' : 'default'" :ringing="!connected">
      <p v-if="call.status === 'ringing'" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"><Icon name="phoneOutgoing" class="size-4" />{{ t('call.outgoing') }}</p>
      <p v-else-if="call.status === 'incoming'" class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"><Icon name="phoneIncoming" class="size-4" />{{ t('call.incomingLabel') }}</p>
      <VoiceWave v-else :silent="!talking || call.hold" />
      <small v-if="!connected && call.left" class="text-xs text-mute">{{ t('call.left', { time: mm(call.left) }) }}</small>
    </Peer>

    <div class="relative z-10 flex justify-center pb-10">
      <div v-if="connected" class="flex gap-2.5 rounded-[40px] border border-line bg-surface p-2.5">
        <RoundButton :label="call.micBlocked ? t('call.micUnavailable') : call.mic ? t('call.mute') : t('call.unmute')" :active="!call.mic && !call.micBlocked" :unavailable="call.micBlocked" :disabled="call.hold" @click="call.toggleMic()"><Icon :name="call.mic ? 'mic' : 'micOff'" /></RoundButton>
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

<style scoped>
/*
 * Блок співрозмовника стоїть на одній висоті в усіх станах (дизайн: 220 від верху екрана 844, тобто 158 під системною смугою).
 * У низькій панелі опускаємо його рівно настільки, щоб лишилось місце під кнопки (114) і смужку співрозмовника (56): висота
 * панелі не змінюється між станами, тож блок і тоді не стрибає.
 */
.peer-pos {
  position: absolute;
  left: 50%;
  translate: -50% 0;
  top: clamp(16px, calc(100% - 506px), 158px);
}
</style>
