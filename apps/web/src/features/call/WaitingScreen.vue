<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import Banner from '@/shared/ui/Banner.vue';
import { banner } from '@/shared/ui/banners';
import Icon from '@/shared/ui/Icon.vue';
import RoundButton from '@/shared/ui/RoundButton.vue';
import Peer from './Peer.vue';
import { useCallStore } from './store';

/**
 * Другий вхідний під час розмови (дизайн: Incoming · waiting): як звичайний вхідний, але згори смужка поточної розмови
 * (Self Banner / active-call), а внизу три дії без підписів (лише `aria-label`, як на вхідному): «Відхилити», «Утримати й прийняти», «Завершити й прийняти».
 */
const { t } = useI18n();
const call = useCallStore();
const mm = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
const w = computed(() => call.waiting!);
const left = computed(() =>
  w.value.expiresAt ? Math.max(0, Math.ceil((w.value.expiresAt - call.serverNow) / 1000)) : 0,
);
const active = banner('activeCall', '');
const actions = computed(
  () =>
    [
      { label: t('call.reject'), variant: 'bad', icon: 'x', run: () => call.rejectWaiting() },
      { label: t('call.waiting.holdAccept'), variant: 'ok', icon: 'pause', run: () => call.acceptWaiting('hold') },
      { label: t('call.waiting.endAccept'), variant: 'ok', icon: 'phoneOff', run: () => call.acceptWaiting('end') },
    ] as const,
);
</script>

<template>
  <section
    class="relative h-full overflow-hidden"
    style="background: linear-gradient(180deg, var(--stage-glow), var(--bg))"
    aria-live="polite"
  >
    <!-- смужка поточної розмови (дизайн: Self Banner / active-call); таймер прихований від читачів екрана, щоб не озвучувався щосекунди -->
    <div class="px-4 pt-2">
      <Banner :tone="active.tone" :icon="active.icon"
        ><span class="sr-only">{{ t('call.waiting.active', { name: call.peer?.name }) }}</span
        ><span aria-hidden="true">{{ call.peer?.name }} · {{ mm(call.seconds) }}</span></Banner
      >
    </div>
    <Peer class="peer-pos" :name="w.peer.name" ringing>
      <p class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent-icon">
        <Icon name="phoneIncoming" class="size-4" />{{ t('call.incomingLabel') }}
      </p>
      <small v-if="left" class="text-xs text-mute">{{ t('call.left', { time: mm(left) }) }}</small>
    </Peer>
    <div class="absolute inset-x-0 bottom-10 flex justify-center gap-5">
      <div v-for="a in actions" :key="a.icon" class="grid w-22 justify-items-center">
        <RoundButton :variant="a.variant" :label="a.label" @click="a.run()"><Icon :name="a.icon" /></RoundButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* та сама висота блоку співрозмовника, що й на звичайному вхідному (CallScreen) */
.peer-pos {
  position: absolute;
  left: 50%;
  translate: -50% 0;
  top: clamp(16px, calc(100% - 506px), 158px);
}
</style>
