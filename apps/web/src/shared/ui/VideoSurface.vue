<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCallStore } from '@/features/call/store';
import { useVideoLoading } from '@/shared/media/videoLoading';
import Icon from '@/shared/ui/Icon.vue';

/**
 * Відео з кімнати: `remote` співрозмовника, `local` нашої камери (дзеркально). `track` змінюється, коли потік з'явився чи зник.
 * Поки немає першого кадру, відео прозоре; через 400 мс з'являється індикатор: на `remote` із затемненням і колом 32 (дизайн: Video Loader),
 * на `local` менше коло 24 без затемнення, на плитці мініатюри (дизайн: Self View / loading).
 * Якщо потік не стартував за 10 с, подія `stalled`: екран розмови повертається до аватара.
 */
const props = defineProps<{ kind: 'local' | 'remote'; track: boolean }>();
const emit = defineEmits<{ stalled: [value: boolean] }>();
const { t } = useI18n();
const call = useCallStore();
const el = ref<HTMLVideoElement>();
const { loading, spinner, stalled, start, ready, reset } = useVideoLoading();

const hasFrame = () => !!el.value && el.value.readyState >= 2 && !el.value.paused;
const bind = () => {
  if (!el.value) return;
  call.attach(props.kind, el.value);
  if (hasFrame()) ready();
};

onMounted(bind);
watch(
  () => [props.track, call.callId],
  () => {
    reset();
    void nextTick(bind);
  },
  { flush: 'post' },
);
watch(stalled, v => emit('stalled', v));
</script>

<template>
  <div class="relative size-full overflow-hidden bg-bg">
    <!-- звук іде окремо (аудіо-елементи в CallMedia), тому відео без звуку -->
    <video
      ref="el"
      autoplay
      playsinline
      muted
      class="size-full object-cover transition-opacity duration-300"
      :class="[kind === 'local' && '-scale-x-100', loading ? 'opacity-0' : 'opacity-100']"
      @playing="ready"
      @loadeddata="hasFrame() && ready()"
      @waiting="start"
      @emptied="start"
    />
    <!-- Video Loader (remote: затемнення 60%, коло 32) і Self View / loading (local: коло 24, плитка вже має фон); з затримкою, щоб не блимав -->
    <div
      v-if="spinner"
      class="pointer-events-none absolute inset-0 grid place-items-center"
      :class="kind === 'remote' && 'bg-bg/60'"
      role="status"
    >
      <span class="sr-only">{{ t('call.videoLoading') }}</span>
      <span
        class="grid place-items-center rounded-full bg-surface text-accent-icon"
        :class="kind === 'remote' ? 'size-8' : 'size-6'"
        aria-hidden="true"
      >
        <Icon name="loader" class="motion-safe:animate-spin" :class="kind === 'remote' ? 'size-4' : 'size-3.5'" />
      </span>
    </div>
  </div>
</template>
