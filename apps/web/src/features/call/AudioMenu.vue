<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AudioDevice } from '@/shared/media/room';
import Icon from '@/shared/ui/Icon.vue';

/**
 * Меню «Звук» над панеллю керування (дизайн: Audio Menu, Audio Option): секції «Динамік» (вивід) і «Мікрофон» (вхід),
 * вибраний пристрій позначено. Секцію з одним пристроєм не показуємо (вибирати нема з чого). Закриття: натискання поза меню чи Esc.
 */
defineProps<{
  outputs: AudioDevice[];
  inputs: AudioDevice[];
  output: string;
  input: string;
}>();
const emit = defineEmits<{ pick: [kind: 'output' | 'input', id: string]; close: [] }>();
const { t } = useI18n();

// без підписів (дозволу на мікрофон ще немає) показуємо номер пристрою
const label = (d: AudioDevice, i: number) => d.label || t('call.audio.device', { n: i + 1 });
// типовий пристрій може не мати запису `default` (Safari, Firefox): тоді вибраним вважаємо перший
const isSelected = (list: AudioDevice[], current: string, d: AudioDevice) =>
  d.id === current || (!list.some(x => x.id === current) && d === list[0]);

const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => addEventListener('keydown', onKey));
onBeforeUnmount(() => removeEventListener('keydown', onKey));
</script>

<template>
  <div class="absolute inset-0 z-30">
    <button
      type="button"
      class="absolute inset-0 cursor-default bg-bg/60"
      :aria-label="t('call.audio.close')"
      @click="emit('close')"
    />
    <div
      role="dialog"
      :aria-label="t('call.audio.title')"
      class="absolute inset-x-6 bottom-[180px] mx-auto grid max-w-[327px] gap-0.5 rounded-[28px] border border-line px-2 pb-2.5 pt-2"
      style="background: linear-gradient(160deg, var(--card-top), var(--card-bottom))"
    >
      <template
        v-for="section in [
          {
            kind: 'output' as const,
            title: t('call.audio.output'),
            icon: 'volume2' as const,
            list: outputs,
            current: output,
          },
          { kind: 'input' as const, title: t('call.audio.input'), icon: 'mic' as const, list: inputs, current: input },
        ]"
        :key="section.kind"
      >
        <div v-if="section.list.length" role="group" :aria-label="section.title" class="grid gap-0.5">
          <!-- заголовок секції сховано, а місце лишено (за відгуками користувачів можна повернути); для скрінрідерів назва в aria-label групи -->
          <p class="invisible px-2.5 pb-1 pt-3 text-xs font-semibold" aria-hidden="true">{{ section.title }}</p>
          <button
            v-for="(d, i) in section.list"
            :key="d.id"
            type="button"
            role="menuitemradio"
            :aria-checked="isSelected(section.list, section.current, d)"
            class="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-[11px] text-left text-sm font-medium transition-colors duration-150 hover:bg-surface-strong focus-visible:outline-2 focus-visible:outline-accent"
            :class="isSelected(section.list, section.current, d) && 'bg-surface'"
            @click="emit('pick', section.kind, d.id)"
          >
            <Icon :name="section.icon" class="size-4 shrink-0 text-mute" />
            <span class="min-w-0 flex-1 truncate">{{ label(d, i) }}</span>
            <Icon
              v-if="isSelected(section.list, section.current, d)"
              name="check"
              class="size-4 shrink-0 text-accent-icon"
            />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
