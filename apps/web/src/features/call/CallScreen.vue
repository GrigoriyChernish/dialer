<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import Icon from '@/shared/ui/Icon.vue';
import BannerStack, { type BannerItem } from '@/shared/ui/BannerStack.vue';
import { banner } from '@/shared/ui/banners';
import RoundButton from '@/shared/ui/RoundButton.vue';
import SelfStatusChip, { type SelfStatus } from '@/shared/ui/SelfStatusChip.vue';
import VideoSurface from '@/shared/ui/VideoSurface.vue';
import AudioMenu from './AudioMenu.vue';
import NotificationPool from './NotificationPool.vue';
import { usePool, type PoolSource } from './notifications';
import Peer from './Peer.vue';
import { useCallStore, type MissedReason } from './store';
import WaitingScreen from './WaitingScreen.vue';

const { t } = useI18n();
const call = useCallStore();
const mm = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const name = computed(() => call.peer?.name ?? call.missed?.peer.name ?? '');
const first = computed(() => name.value.split(' ')[0]);
// рід співрозмовника: сервер його не віддає, тож як у прототипі: жіночий лише для Олени (беклог, пункт 6)
const g = computed(() => ((call.peer ?? call.missed?.peer)?.userId === 'bot:olena' ? 'f' : 'm'));
const connected = computed(() => call.status === 'connected');
// відео співрозмовника є (розмова не на утриманні, канал не слабкий: `audioOnly`); потік може не стартувати (`videoStalled`), тоді повертаємось до аватара
const peerVideoOn = computed(
  () =>
    connected.value && call.link.peerCam && !call.link.audioOnly && !call.link.peerWeak && !call.peerHold && !call.hold,
);
// «Ще» (дизайн: Call Controls / more) розкриває ряд додаткових дій над панеллю (Extra Actions): «Звук» і «Перемкнути камеру».
// Недоступну дію не показуємо; коли немає жодної, немає й кнопки «Ще»
const extra = ref(false);
const audioMenu = ref(false);
const hasExtra = computed(() => connected.value && (call.canPickAudio || call.canSwitchCamera));
const EXTRA_MS = 5000;
let extraTimer: ReturnType<typeof setTimeout> | undefined;
// ряд згортається сам через 5 с без дій; поки відкрите меню звуку, таймер стоїть
function armExtra() {
  clearTimeout(extraTimer);
  if (extra.value && !audioMenu.value) extraTimer = setTimeout(() => (extra.value = false), EXTRA_MS);
}
watch([extra, audioMenu], armExtra);
watch([connected, () => call.canPickAudio, () => call.canSwitchCamera], () => {
  if (!hasExtra.value) extra.value = false;
  if (!connected.value || !call.canPickAudio) audioMenu.value = false;
});
watch(extra, on => on || (audioMenu.value = false));
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !audioMenu.value && (extra.value = false);
watch(extra, on => (on ? addEventListener('keydown', onKey) : removeEventListener('keydown', onKey)));
onBeforeUnmount(() => {
  clearTimeout(extraTimer);
  removeEventListener('keydown', onKey);
});
const videoStalled = ref(false);
watch(peerVideoOn, on => on || (videoStalled.value = false));
// екран «In Call · video»: на весь екран відео співрозмовника
const video = computed(() => peerVideoOn.value && !videoStalled.value);

// смужка співрозмовника внизу над панеллю керування (дизайн: Peer Banner): одна, за станом, що настав останнім (як обводка й колір аватара в Peer)
const peerBanners = computed<BannerItem[]>(() => {
  if (!connected.value) return [];
  const who = { name: first.value };
  if (call.peerState === 'hold') return [banner('peerHold', t(`call.peer.hold.${g.value}`, who))];
  if (call.peerState === 'lost') return [banner('connectionLost', t(`call.peer.connectionLost.${g.value}`, who))];
  if (call.peerState === 'mic') return [banner('peerMicOff', t(`call.peer.micOff.${g.value}`, who))];
  if (call.link.peerWeak) return [banner('peerWeakSignal', t('call.peer.weakSignal', who))];
  if (videoStalled.value) return [banner('videoStalled', t('call.peer.videoStalled'))];
  return [];
});
// дизайн: аватар тьмянішає (прозорість .6), коли розмова призупинена нами чи співрозмовник втратив зв'язок
const dimmed = computed(() => call.hold || call.peerState === 'lost');
// сповіщення Self-зони під шапкою (дизайн: Self Banner): пул, у слоті видно одне. Системні (наша мережа) сильніші за користувацькі
// (наші пристрої, утримуваний дзвінок), усередині групи вище новіше (docs/design-system.md, «Пул сповіщень»)
const heldSecs = computed(() =>
  call.held ? Math.max(0, Math.floor((call.serverNow - call.held.startedAt) / 1000)) : 0,
);
// наша камера не віддала кадр: оголошено до `pool`, бо `usePool` читає джерело одразу при створенні (інакше помилка ініціалізації)
const selfStalled = ref(false);
const stalls = ref(0);
const pool = usePool(() => {
  if (!connected.value) return [];
  const list: PoolSource[] = [];
  if (call.link.reconnecting) list.push({ group: 'system', ...banner('reconnecting', t('call.network.reconnecting')) });
  else if (call.link.poor || call.link.audioOnly)
    list.push({
      group: 'system',
      ...banner('poorSignal', t(call.link.audioOnly ? 'call.network.poorSignalAudio' : 'call.network.poorSignal')),
    });
  if (call.link.audioBlocked)
    list.push({
      group: 'user',
      ...banner('audioBlocked', t('call.notice.audioBlocked')),
      action: {
        label: t('call.notice.enableAudio'),
        title: t('call.notice.enableAudio'),
        icon: 'volume2',
        run: () => call.enableAudio(),
      },
    });
  if (call.hint === 'cam')
    list.push({
      group: 'user',
      ...banner(
        'cameraUnavailable',
        t(
          call.link.camReason === 'denied'
            ? 'call.notice.cameraDenied'
            : call.link.camReason === 'busy'
              ? 'call.notice.cameraBusy'
              : 'call.notice.cameraUnavailable',
        ),
      ),
    });
  if (selfStalled.value && stalls.value > 1)
    list.push({ group: 'user', ...banner('cameraStalled', t('call.notice.cameraStalled')) });
  if (call.hint === 'mic') list.push({ group: 'user', ...banner('micUnavailable', t('call.notice.micUnavailable')) });
  if (call.held) {
    const h = call.held;
    list.push({
      group: 'user',
      // таймер ховаємо від читачів екрана, щоб не озвучувався щосекунди
      ...banner('heldCall', `${h.peer.name} · ${mm(heldSecs.value)}`),
      srLabel: t('call.held.label', { name: h.peer.name }),
      action: {
        label: t('call.held.switchTo', { name: h.peer.name }),
        title: t('call.held.switch'),
        run: () => call.swapHeld(),
      },
    });
  }
  return list;
});
// колір підпису результату: завершено fg, зайнято жовтий, решта (не вдалося зв'язатися, збій) червоний
const RESULT_TEXT: Partial<Record<MissedReason, string>> = { ended: 'text-fg', busy: 'text-warn-text' };
const MISSED_ICON = {
  incoming: 'phoneMissed',
  timeout: 'phoneMissed',
  lost: 'wifiOff',
  dropped: 'triangleAlert',
} as const;
const missedIcon = computed(() =>
  call.missed && call.missed.reason in MISSED_ICON
    ? MISSED_ICON[call.missed.reason as keyof typeof MISSED_ICON]
    : 'phoneOff',
);
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
const selfVideo = computed(() => call.cam && call.link.localCam && !call.hold && !call.peerHold);
// наша камера не віддала кадр за 10 с: перший раз перезапускаємо трек, якщо й після цього кадру немає, сповіщення «Камера не відповідає» (беклог 21)
watch(selfVideo, on => on || (selfStalled.value = false));
watch(
  () => call.callId,
  () => (stalls.value = 0),
);
watch(selfStalled, on => {
  if (!on) return;
  stalls.value++;
  if (stalls.value === 1) call.restartCamera();
});
</script>

<template>
  <!-- результат: пропущений / зайнято / без відповіді / помилка; кінець розмови: завершено / зв'язок втрачено / перервано -->
  <section
    v-if="call.status === 'idle' && call.missed"
    class="relative h-full"
    :style="{
      background: `linear-gradient(180deg, ${call.missed.reason === 'ended' ? 'var(--stage-glow)' : 'var(--stage-missed-glow)'}, var(--bg))`,
    }"
  >
    <Peer class="peer-pos" :name="name" variant="result">
      <p
        class="flex items-center gap-2 text-lg font-semibold"
        :class="RESULT_TEXT[call.missed.reason] ?? 'text-bad-text'"
      >
        <Icon :name="missedIcon" class="size-[18px]" />{{ t(`call.missed.${call.missed.reason}`) }}
      </p>
      <small class="text-[13px] text-mute">{{
        call.missed.note
          ? t(call.missed.note)
          : t(`call.missedNote.${call.missed.reason}`, { time: mm(call.missed.duration ?? 0) })
      }}</small>
    </Peer>
    <!-- кнопки без підписів: зелена дія ліворуч, червона праворуч (як на вхідному) -->
    <div class="absolute inset-x-0 bottom-10 flex justify-center gap-[72px]">
      <div v-if="call.missed.reason !== 'ended'" class="grid w-22 justify-items-center">
        <RoundButton variant="ok" :label="t('call.redial')" @click="call.call(call.missed.peer.userId)"
          ><Icon name="phone"
        /></RoundButton>
      </div>
      <div class="grid w-22 justify-items-center">
        <RoundButton variant="bad" :label="t('call.close')" @click="call.dismissMissed()"
          ><Icon name="x"
        /></RoundButton>
      </div>
    </div>
  </section>

  <!-- другий вхідний під час розмови: на весь екран, розмова триває під ним -->
  <WaitingScreen v-else-if="call.waiting" />

  <!-- дзвонимо / вхідний / розмова -->
  <section
    v-else
    class="relative flex h-full flex-col overflow-hidden"
    style="background: linear-gradient(180deg, var(--stage-glow), var(--bg))"
    aria-live="polite"
  >
    <!-- відео лишається змонтованим і під час `stalled` (невидиме), щоб помітити, що потік ожив -->
    <VideoSurface
      v-if="peerVideoOn"
      kind="remote"
      :track="peerVideoOn"
      class="absolute inset-0"
      :class="videoStalled && 'invisible'"
      @stalled="videoStalled = $event"
    />
    <template v-if="video">
      <!-- градієнти під відео: згори 180, знизу 220 -->
      <div
        class="absolute inset-x-0 top-0 h-[180px]"
        style="background: linear-gradient(180deg, #000000a0, #00000000)"
      />
      <div
        class="absolute inset-x-0 bottom-0 h-[220px]"
        style="background: linear-gradient(0deg, #000000a0, #00000000)"
      />
    </template>

    <header v-if="connected" class="relative z-10 flex h-10 shrink-0 items-center justify-between px-4">
      <div class="flex min-w-0 items-center gap-2">
        <!-- згорнути розмову до плашки на головному (дизайн: Call Header / Minimize Button) -->
        <button
          type="button"
          :aria-label="t('call.minimize')"
          class="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-surface transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:bg-surface-strong active:scale-95 focus-visible:outline-2 focus-visible:outline-accent"
          @click="call.minimize()"
        >
          <Icon name="chevronDown" class="size-4" />
        </button>
        <b class="truncate text-base font-semibold">{{ name }}</b>
      </div>
      <div class="flex items-center gap-2">
        <SelfStatusChip v-for="s in selfStatuses" :key="s.status" :status="s.status" :label="s.label" />
        <span class="rounded-[14px] bg-surface px-2.5 py-1 text-[13px] font-medium tabular-nums">{{
          mm(call.seconds)
        }}</span>
      </div>
    </header>
    <!-- пул сповіщень Self-зони: слот 40 під шапкою (дизайн: Self Banner Slot), поверх екрана, вміст не зсуває -->
    <NotificationPool v-if="connected" :items="pool" />
    <!-- з відео співрозмовника блок Peer ховається, тож смужка його стану лишається внизу над панеллю керування -->
    <BannerStack
      v-if="video"
      class="pointer-events-none absolute inset-x-4 z-20"
      :class="extra ? 'bottom-[180px]' : 'bottom-[122px]'"
      :items="peerBanners"
    />

    <div class="relative flex min-h-0 flex-1 flex-col">
      <!-- мініатюра себе (дизайн: Self View) і кнопка «показати себе» (Show Self); камери немає чи її вимкнули — їх не показуємо -->
      <template v-if="connected && !call.camBlocked && call.cam && !call.link.audioOnly">
        <button
          v-if="!call.selfHidden"
          type="button"
          :aria-label="t('call.hideSelf')"
          class="absolute right-4 top-[54px] z-10 grid h-[122px] w-[92px] cursor-pointer place-items-center overflow-hidden rounded-2xl border border-line bg-pip transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:border-white/30 active:scale-[0.98]"
          :class="selfVideo && 'shadow-[0_10px_24px_#00000066]'"
          @click="call.selfHidden = true"
        >
          <VideoSurface
            v-if="selfVideo"
            kind="local"
            :track="selfVideo"
            class="absolute inset-0"
            @stalled="selfStalled = $event"
          />
        </button>
        <button
          v-else
          type="button"
          :aria-label="t('call.showSelf')"
          class="absolute right-5 top-[54px] z-10 grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:border-white/30 hover:bg-surface-strong active:scale-95"
          @click="call.selfHidden = false"
        >
          <Icon name="video" class="size-5" />
        </button>
      </template>

      <div class="flex-1" />
    </div>
    <!-- блок співрозмовника на одній висоті в усіх станах (поза потоком, тож шапка й кнопки його не зсувають) -->
    <Peer
      v-if="!video"
      class="peer-pos"
      :name="name"
      :variant="dimmed ? 'dimmed' : 'default'"
      :ringing="!connected"
      :direction="call.status === 'incoming' ? 'in' : 'out'"
      :state="connected ? call.peerState : null"
      :speaking="call.peerSpeaking"
    >
      <p
        v-if="call.status === 'ringing'"
        class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"
      >
        <Icon name="phoneOutgoing" class="size-4" />{{ t('call.outgoing') }}
      </p>
      <p
        v-else-if="call.status === 'incoming'"
        class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon"
      >
        <Icon name="phoneIncoming" class="size-4" />{{ t('call.incomingLabel') }}
      </p>
      <small v-if="!connected && call.left" class="text-xs text-mute">{{
        t('call.left', { time: mm(call.left) })
      }}</small>
      <!-- стан співрозмовника (дизайн: Peer Banner у слоті Status): по центру слота, одна смужка -->
      <BannerStack v-if="connected" class="my-auto w-full translate-y-1" :items="peerBanners" />
    </Peer>

    <!-- меню «Звук» над панеллю керування (дизайн: In Call · audio-menu) -->
    <AudioMenu
      v-if="audioMenu && connected && call.canPickAudio"
      :outputs="call.audioChoices.outputs"
      :inputs="call.audioChoices.inputs"
      :output="call.audioPick.output"
      :input="call.audioPick.input"
      @pick="(kind, id) => call.pickAudio(kind, id)"
      @close="audioMenu = false"
    />

    <!-- клік поза рядом додаткових дій згортає його (під панеллю й рядом, над рештою екрана) -->
    <button
      v-if="extra"
      type="button"
      tabindex="-1"
      class="absolute inset-0 z-[5] cursor-default"
      :aria-label="t('call.moreClose')"
      @click="extra = false"
    />
    <!-- ряд додаткових дій над панеллю (дизайн: Extra Actions, Extra Button): круглі кнопки без підписів -->
    <div v-if="extra" class="absolute inset-x-0 bottom-[128px] z-40 flex justify-center gap-4" @pointerdown="armExtra">
      <button
        v-if="call.canPickAudio"
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="audioMenu"
        :aria-label="t('call.audio.button')"
        class="grid size-11 cursor-pointer place-items-center rounded-full border border-line transition duration-[var(--duration-press)] ease-[var(--ease-out)] active:scale-95 focus-visible:outline-2 focus-visible:outline-accent"
        :class="audioMenu ? 'bg-fg text-bg' : 'bg-surface text-fg hover:bg-surface-strong'"
        @click="audioMenu = !audioMenu"
      >
        <Icon name="volume2" class="size-5" />
      </button>
      <button
        v-if="call.canSwitchCamera"
        type="button"
        :aria-label="t('call.switchCamera')"
        class="grid size-11 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg transition duration-[var(--duration-press)] ease-[var(--ease-out)] hover:bg-surface-strong active:scale-95 focus-visible:outline-2 focus-visible:outline-accent"
        @click="call.switchCamera()"
      >
        <Icon name="switchCamera" class="size-5" />
      </button>
    </div>

    <div class="relative z-10 flex justify-center pb-10">
      <div v-if="connected" class="flex gap-2.5 rounded-[40px] border border-line bg-surface p-2.5">
        <RoundButton
          :label="call.micBlocked ? t('call.micUnavailable') : call.mic ? t('call.mute') : t('call.unmute')"
          :active="!call.mic && !call.micBlocked"
          :unavailable="call.micBlocked"
          :disabled="call.hold || call.peerHold"
          @click="call.toggleMic()"
          ><Icon :name="call.mic ? 'mic' : 'micOff'"
        /></RoundButton>
        <RoundButton
          :label="call.camBlocked ? t('call.cameraUnavailable') : call.cam ? t('call.camera') : t('call.cameraOn')"
          :active="!call.cam && !call.camBlocked"
          :unavailable="call.camBlocked"
          :disabled="call.hold || call.peerHold"
          @click="call.toggleCam()"
          ><Icon :name="call.cam ? 'video' : 'videoOff'"
        /></RoundButton>
        <RoundButton
          :label="call.hold ? t('call.resume') : t('call.hold')"
          :active="call.hold"
          :disabled="call.peerHold"
          @click="call.toggleHold()"
          ><Icon name="pause"
        /></RoundButton>
        <RoundButton
          v-if="hasExtra"
          :label="t('call.more')"
          :active="extra"
          aria-haspopup="true"
          :aria-expanded="extra"
          @click="extra = !extra"
          ><Icon name="ellipsis"
        /></RoundButton>
        <RoundButton variant="bad" :label="t('call.hangup')" @click="call.end()"><Icon name="x" /></RoundButton>
      </div>
      <div v-else-if="call.status === 'incoming'" class="flex gap-[72px]">
        <div class="grid w-22 justify-items-center">
          <RoundButton variant="ok" :label="t('call.accept')" @click="call.accept()"><Icon name="phone" /></RoundButton>
        </div>
        <div class="grid w-22 justify-items-center">
          <RoundButton variant="bad" :label="t('call.reject')" @click="call.end()"><Icon name="x" /></RoundButton>
        </div>
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
