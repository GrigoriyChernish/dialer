import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'dialer.prefs';
interface Prefs {
  theme: Theme;
  /** Мелодія вхідних і сигнал другого вхідного. */
  ringtone: boolean;
  /** Камера вмикається разом із розмовою. */
  camOnStart: boolean;
}
const DEFAULTS: Prefs = { theme: 'auto', ringtone: true, camOnStart: true };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Налаштування лише цього пристрою (localStorage): тема, мелодія, камера на початку дзвінка. Серверні — у `useCallStore().settings`. */
export const usePrefsStore = defineStore('prefs', () => {
  const p = load();
  const theme = ref<Theme>(p.theme);
  const ringtone = ref(p.ringtone);
  const camOnStart = ref(p.camOnStart);
  watch([theme, ringtone, camOnStart], () => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ theme: theme.value, ringtone: ringtone.value, camOnStart: camOnStart.value }),
      );
    } catch {
      // приватний режим: вибір живе лише до перезавантаження
    }
  });
  return { theme, ringtone, camOnStart };
});
