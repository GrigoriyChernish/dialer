<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/features/auth/session';
import { AuthError } from '@/shared/api/auth';
import Icon from '@/shared/ui/Icon.vue';

// Вхід за номером (дизайн: Flow · Auth): номер → ім'я (лише новий номер) → код з 4 цифр.
const { t, te } = useI18n();
const router = useRouter();
const session = useSessionStore();

type Step = 'phone' | 'name' | 'code';
const step = ref<Step>('phone');
const digits = ref(''); // 9 цифр після +380
const name = ref('');
const code = ref('');
const known = ref(false);
const busy = ref(false);
const error = ref('');
const codeInput = ref<HTMLInputElement>();
const codeFocused = ref(false);

const fmt = (d: string) => [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
const phone = computed(() => '+380' + digits.value);
const phoneText = computed(() => '+380 ' + fmt(digits.value));
const phoneShown = computed(() => fmt(digits.value));

/** Вставлений номер `+380…`, `380…` чи `0…` → 9 цифр. */
function onPhone(e: Event) {
  let d = (e.target as HTMLInputElement).value.replace(/\D/g, '');
  if (d.length > 9 && d.startsWith('380')) d = d.slice(3);
  else if (d.length > 9 && d.startsWith('0')) d = d.slice(1);
  digits.value = d.slice(0, 9);
  (e.target as HTMLInputElement).value = fmt(digits.value);
  error.value = '';
}
function onCode(e: Event) {
  code.value = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4);
  (e.target as HTMLInputElement).value = code.value;
  error.value = '';
  if (code.value.length === 4) void submit();
}

const canSubmit = computed(() =>
  busy.value ? false : step.value === 'phone' ? digits.value.length === 9 : step.value === 'name' ? name.value.trim().length >= 2 : code.value.length === 4,
);

function fail(e: unknown) {
  const err = e instanceof AuthError ? e : new AuthError('error');
  const min = Math.max(1, Math.ceil((err.data.retryAfter ?? 60) / 60));
  const key = `auth.err.${err.code}`;
  error.value = te(key) ? t(key, { n: err.data.attemptsLeft ?? 0, min }) : t('auth.err.error');
}

// фокус на полі кроку: autofocus ненадійний після переходів роутера
onMounted(() => document.getElementById('phone')?.focus());
watch(step, async (s) => {
  await nextTick();
  (s === 'code' ? codeInput.value : document.getElementById(s))?.focus();
});

function toCode() {
  code.value = '';
  step.value = 'code';
}

async function submit() {
  if (!canSubmit.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (step.value === 'phone') {
      known.value = (await session.start(phone.value)).known;
      if (known.value) toCode();
      else step.value = 'name';
    } else if (step.value === 'name') {
      toCode();
    } else {
      await session.verify(phone.value, code.value, known.value ? undefined : name.value.trim());
      await router.replace('/');
    }
  } catch (e) {
    fail(e);
    if (step.value === 'code') code.value = '';
  } finally {
    busy.value = false;
  }
}

function back() {
  error.value = '';
  step.value = step.value === 'code' && !known.value ? 'name' : 'phone';
}
</script>

<template>
  <form class="flex h-full flex-col px-6 pb-10" :class="step === 'phone' ? 'pt-[72px]' : 'pt-2'" novalidate @submit.prevent="submit">
    <button
      v-if="step !== 'phone'"
      type="button"
      class="mb-8 grid size-11 place-items-center rounded-full border border-line bg-surface text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      :aria-label="t('auth.back')"
      @click="back"
    >
      <Icon name="chevronLeft" class="size-5" />
    </button>

    <h1 class="text-[26px] font-bold">{{ t(`auth.${step}.title`) }}</h1>
    <p class="mt-2 text-[15px] text-mute">{{ t(`auth.${step}.subtitle`, { phone: phoneText }) }}</p>

    <div class="mt-8 grid gap-2">
      <template v-if="step === 'phone'">
        <label for="phone" class="text-[13px] font-medium text-mute">{{ t('auth.phone.label') }}</label>
        <div class="field" :class="error && 'error'">
          <span class="text-mute">+380</span>
          <input
            id="phone"
            :value="phoneShown"
            type="tel"
            inputmode="tel"
            autocomplete="tel-national"
            placeholder="XX XXX XX XX"
            class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-mute/50"
            :aria-invalid="!!error"
            aria-describedby="auth-error"
            @input="onPhone"
          />
        </div>
      </template>

      <template v-else-if="step === 'name'">
        <label for="name" class="text-[13px] font-medium text-mute">{{ t('auth.name.label') }}</label>
        <div class="field" :class="error && 'error'">
          <input
            id="name"
            v-model="name"
            autocomplete="name"
            maxlength="40"
            class="min-w-0 flex-1 bg-transparent outline-none"
            :aria-invalid="!!error"
            aria-describedby="auth-error"
            @input="error = ''"
          />
        </div>
      </template>

      <template v-else>
        <!-- справжнє поле прозоре поверх чотирьох клітинок: працюють вставка й автозаповнення one-time-code -->
        <div class="relative flex justify-between">
          <span
            v-for="i in 4"
            :key="i"
            class="grid h-[72px] w-16 place-items-center rounded-2xl border bg-surface text-[28px] font-bold"
            :class="error ? 'border-2 border-call-bad' : codeFocused && i - 1 === Math.min(code.length, 3) ? 'border-2 border-accent' : 'border-line'"
            aria-hidden="true"
            >{{ code[i - 1] ?? '' }}</span
          >
          <input
            ref="codeInput"
            :value="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="4"
            class="absolute inset-0 cursor-pointer opacity-0"
            :aria-label="t('auth.code.label')"
            :aria-invalid="!!error"
            aria-describedby="auth-error"
            @input="onCode"
            @focus="codeFocused = true"
            @blur="codeFocused = false"
          />
        </div>
      </template>

      <p id="auth-error" class="min-h-5 text-[13px] text-call-bad" role="alert">{{ error }}</p>
      <button
        v-if="step === 'code'"
        type="button"
        class="justify-self-start text-sm font-semibold text-accent-icon focus-visible:outline-2 focus-visible:outline-accent"
        @click="(step = 'phone'), (error = '')"
      >
        {{ t('auth.code.change') }}
      </button>
    </div>

    <button
      type="submit"
      class="mt-auto h-14 w-full rounded-2xl bg-accent text-base font-semibold text-white transition-opacity disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      :disabled="!canSubmit"
    >
      {{ step === 'code' ? t('auth.submit') : t('auth.next') }}
    </button>
  </form>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 56px;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 17px;
  font-weight: 500;
}
.field:focus-within {
  border: 2px solid var(--color-accent);
  padding: 0 15px;
}
.field.error {
  border: 2px solid var(--color-call-bad);
  padding: 0 15px;
}
</style>
