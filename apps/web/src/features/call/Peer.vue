<script setup lang="ts">
import Avatar from '@/shared/ui/Avatar.vue';

/**
 * Блок співрозмовника (дизайн: компонент Peer). Однаковий розмір 327 × 336 на всіх екранах, щоб вміст не стрибав між станами:
 * три зони фіксованої висоти — Ring 200 (аватар; кільця лише під час виклику), Title 32 (ім'я), Status 64 (слот: хвиля, підпис виклику чи результат,
 * притиснуті до верху зони); проміжок 20.
 */
defineProps<{
  name: string;
  /** `dimmed`: утримання чи обрив (аватар .6); `result`: екран результату (сірий аватар, без кілець). */
  variant?: 'default' | 'dimmed' | 'result';
  /** Виклик (дзвонимо чи дзвонять): кільця навколо аватара й пульсація. Під час розмови й на результаті кілець немає. */
  ringing?: boolean;
}>();
</script>

<template>
  <div class="flex h-[336px] w-[327px] max-w-full flex-col items-center gap-5 text-center">
    <span class="grid size-[200px] shrink-0 place-items-center rounded-full" :class="ringing && 'bg-accent/[.08]'">
      <span
        class="grid size-[152px] place-items-center rounded-full"
        :class="ringing && 'animate-ring bg-accent/[.14]'"
      >
        <Avatar
          :name="name"
          size="xl"
          :muted="variant === 'result'"
          :opacity="variant === 'dimmed' ? 0.6 : undefined"
        />
      </span>
    </span>
    <h3 class="flex h-8 w-full shrink-0 items-center justify-center truncate text-[26px] font-bold">{{ name }}</h3>
    <div class="flex h-16 w-full shrink-0 flex-col items-center gap-2"><slot /></div>
  </div>
</template>
