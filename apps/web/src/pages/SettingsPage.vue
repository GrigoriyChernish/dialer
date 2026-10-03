<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useSessionStore } from '@/features/auth/session';
import { useCallStore } from '@/features/call/store';
import { usePrefsStore, type Theme } from '@/features/settings/prefs';
import { usePush } from '@/features/settings/push';
import Avatar from '@/shared/ui/Avatar.vue';
import Card from '@/shared/ui/Card.vue';
import Icon, { type IconName } from '@/shared/ui/Icon.vue';
import Toggle from '@/shared/ui/Toggle.vue';

/**
 * Налаштування (дизайн: Flow · Settings). Ім'я — `profile.update`, «Не турбувати» й «Очікування виклику» — `settings.update`
 * (однакові на всіх пристроях); мелодія, камера й тема — лише цей пристрій (`usePrefsStore`).
 */
const { t } = useI18n();
const router = useRouter();
const session = useSessionStore();
const call = useCallStore();
const prefs = usePrefsStore();
const push = usePush();
onMounted(() => void push.refresh());
const fmt = (p: string) => p.replace(/^\+380(\d\d)(\d{3})(\d\d)(\d\d)$/, '+380 $1 $2 $3 $4');

// редагування імені (дизайн: Settings · edit name)
const editing = ref(false);
const draft = ref('');
const error = ref('');
const saving = ref(false);
const input = ref<HTMLInputElement>();
async function edit() {
  draft.value = call.me?.name ?? '';
  error.value = '';
  editing.value = true;
  await nextTick();
  input.value?.focus();
}
async function save() {
  const name = draft.value.trim();
  if (name.length < 2 || name.length > 40) return (error.value = t('settings.nameError'));
  if (name === call.me?.name) return (editing.value = false);
  saving.value = true;
  try {
    await call.rename(name);
    editing.value = false;
  } catch {
    error.value = t('settings.saveError');
  } finally {
    saving.value = false;
  }
}

const dnd = computed({ get: () => call.settings.dnd, set: v => void call.updateSettings({ dnd: v }) });
const waiting = computed({ get: () => call.settings.waiting, set: v => void call.updateSettings({ waiting: v }) });
const ringtone = computed({ get: () => prefs.ringtone, set: v => (prefs.ringtone = v) });
const camOnStart = computed({ get: () => prefs.camOnStart, set: v => (prefs.camOnStart = v) });
const rows = computed(() => [
  { icon: 'phoneCall' as IconName, title: t('settings.waiting'), hint: t('settings.waitingHint'), model: waiting },
  { icon: 'bell' as IconName, title: t('settings.ringtone'), hint: t('settings.thisDevice'), model: ringtone },
  { icon: 'video' as IconName, title: t('settings.camOnStart'), hint: t('settings.thisDevice'), model: camOnStart },
  // сповіщення про дзвінки (Web Push): лише коли браузер і сервер це вміють; заблоковані браузером недоступні
  ...(push.available.value
    ? [
        {
          icon: 'bellRing' as IconName,
          title: t('settings.push'),
          hint: push.denied.value
            ? t('settings.pushBlocked')
            : push.error.value
              ? t('settings.pushError')
              : t('settings.pushHint'),
          warn: push.denied.value || push.error.value,
          disabled: push.denied.value || push.busy.value,
          model: push.model,
        },
      ]
    : []),
]);

/** Вихід: підписку на сповіщення знімаємо, щоб наступний користувач цього браузера не отримував чужі дзвінки. */
async function logout() {
  if (push.enabled.value) await push.disable();
  session.logout();
}
const THEMES: { id: Theme; icon: IconName }[] = [
  { id: 'auto', icon: 'monitorSmartphone' },
  { id: 'light', icon: 'sun' },
  { id: 'dark', icon: 'moon' },
];
</script>

<template>
  <div class="scroll flex h-full flex-col px-4 pb-6">
    <header class="flex shrink-0 items-center gap-3 pb-2 pt-1">
      <button
        type="button"
        class="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        :aria-label="t('settings.back')"
        @click="router.push('/')"
      >
        <Icon name="chevronLeft" class="size-5" />
      </button>
      <h1 class="text-lg font-bold">{{ t('settings.title') }}</h1>
    </header>

    <!-- профіль: аватар, ім'я, номер; олівець відкриває редагування імені -->
    <Card class="mt-1 p-3.5">
      <form v-if="editing" class="grid gap-3" @submit.prevent="save">
        <label for="settings-name" class="text-[13px] font-medium text-mute">{{ t('settings.nameLabel') }}</label>
        <input
          id="settings-name"
          ref="input"
          v-model="draft"
          maxlength="40"
          autocomplete="name"
          class="-mt-1 h-14 rounded-2xl border-2 bg-surface px-4 text-[17px] font-medium outline-none"
          :class="error ? 'border-call-bad' : 'border-accent'"
          :aria-invalid="!!error"
          aria-describedby="settings-name-error"
          @input="error = ''"
          @keydown.esc="editing = false"
        />
        <p v-if="error" id="settings-name-error" class="-mt-1 text-[13px] text-call-bad" role="alert">{{ error }}</p>
        <div class="flex gap-2.5">
          <button
            type="button"
            class="h-12 flex-1 cursor-pointer rounded-2xl border border-line bg-surface text-[15px] font-semibold"
            @click="editing = false"
          >
            {{ t('settings.cancel') }}
          </button>
          <button
            type="submit"
            class="h-12 flex-1 cursor-pointer rounded-2xl bg-accent text-[15px] font-semibold text-white disabled:opacity-40"
            :disabled="saving"
          >
            {{ t('settings.save') }}
          </button>
        </div>
      </form>
      <div v-else class="flex items-center gap-3.5">
        <Avatar :name="call.me?.name ?? ''" size="lg" />
        <span class="grid min-w-0 flex-1 gap-0.5">
          <b class="truncate text-lg font-bold">{{ call.me?.name }}</b>
          <small class="text-[13px] text-mute">{{ fmt(call.me?.userId ?? '') }}</small>
        </span>
        <button
          type="button"
          class="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-line bg-surface text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          :aria-label="t('settings.editName')"
          @click="edit"
        >
          <Icon name="pencil" class="size-[18px]" />
        </button>
      </div>
    </Card>

    <h2 class="px-2.5 pb-1.5 pt-3 text-xs font-semibold text-mute">{{ t('settings.status') }}</h2>
    <Card class="py-1">
      <div class="flex items-center gap-3 px-3.5 py-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-surface"
          ><Icon name="moon" class="size-4"
        /></span>
        <span class="grid min-w-0 flex-1 gap-0.5">
          <b class="text-[15px] font-medium">{{ t('settings.dnd') }}</b>
          <small class="text-xs text-mute">{{ t('settings.dndHint') }}</small>
        </span>
        <Toggle v-model="dnd" :label="t('settings.dnd')" />
      </div>
    </Card>

    <h2 class="px-2.5 pb-1.5 pt-3 text-xs font-semibold text-mute">{{ t('settings.calls') }}</h2>
    <Card class="py-1">
      <div v-for="r in rows" :key="r.icon" class="flex items-center gap-3 px-3.5 py-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-full bg-surface"
          ><Icon :name="r.icon" class="size-4"
        /></span>
        <span class="grid min-w-0 flex-1 gap-0.5">
          <b class="text-[15px] font-medium">{{ r.title }}</b>
          <small class="text-xs" :class="r.warn ? 'text-warn-text' : 'text-mute'">{{ r.hint }}</small>
        </span>
        <Toggle v-model="r.model.value" :label="r.title" :disabled="r.disabled" />
      </div>
    </Card>

    <h2 class="px-2.5 pb-1.5 pt-3 text-xs font-semibold text-mute">{{ t('settings.look') }}</h2>
    <!-- тема (дизайн: Segmented): лише цей пристрій -->
    <Card class="p-2">
      <div
        class="flex gap-[3px] rounded-2xl bg-surface p-[3px]"
        role="radiogroup"
        :aria-label="t('settings.theme.label')"
      >
        <button
          v-for="th in THEMES"
          :key="th.id"
          type="button"
          role="radio"
          :aria-checked="prefs.theme === th.id"
          class="flex h-[38px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[11px] border text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-accent"
          :class="
            prefs.theme === th.id
              ? 'border-line bg-surface-strong font-semibold text-fg'
              : 'border-transparent font-medium text-mute hover:text-fg'
          "
          @click="prefs.theme = th.id"
        >
          <Icon :name="th.icon" class="size-[15px]" />{{ t(`settings.theme.${th.id}`) }}
        </button>
      </div>
    </Card>

    <Card class="mt-3.5">
      <button
        type="button"
        class="flex w-full cursor-pointer items-center gap-3 rounded-[28px] p-3.5 text-left text-[15px] font-medium text-call-bad focus-visible:outline-2 focus-visible:outline-accent"
        @click="logout()"
      >
        <span class="grid size-8 place-items-center rounded-full bg-call-bad/20"
          ><Icon name="logOut" class="size-4" /></span
        >{{ t('app.logout') }}
      </button>
    </Card>

    <!-- збереження підписки на сповіщення (дизайн: Push Saving): після дозволу браузера до відповіді сервера, під затемненням -->
    <Transition name="saving-fade">
      <div
        v-if="push.saving.value"
        class="fixed inset-0 z-50 grid place-items-center bg-bg/60 px-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby="push-saving-title"
      >
        <Card class="grid w-full max-w-[280px] justify-items-center gap-2 px-5 py-6 text-center" role="status">
          <Icon name="loader" class="mb-1 size-7 text-accent motion-safe:animate-spin" />
          <b id="push-saving-title" class="text-[15px] font-semibold">{{ t('settings.pushSaving') }}</b>
          <small class="text-xs text-mute">{{ t('settings.pushSavingHint') }}</small>
        </Card>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* попап збереження: м'яка поява й зникнення, як розгорнутий пул сповіщень (reduced-motion вимикає main.css) */
.saving-fade-enter-active {
  transition: opacity var(--duration-banner-enter) var(--ease-out);
}
.saving-fade-leave-active {
  transition: opacity var(--duration-banner-leave) var(--ease-in);
}
.saving-fade-enter-from,
.saving-fade-leave-to {
  opacity: 0;
}
</style>
