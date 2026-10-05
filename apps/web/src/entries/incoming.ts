import { createPinia } from 'pinia';
import { createApp, watch } from 'vue';
import { i18n } from '@/app/i18n';
import '@/app/styles/main.css';
import IncomingWindow from '@/features/call/IncomingWindow.vue';
import { usePrefsStore } from '@/features/settings/prefs';
import { applyTheme } from '@/shared/theme';

// Міні-вікно вхідного на десктопі (Tauri): відкривається з Rust (`src-tauri/src/incoming.rs`), параметри дзвінка в query.
const pinia = createPinia();
const prefs = usePrefsStore(pinia);
watch(
  () => prefs.theme,
  th => applyTheme(th),
  { immediate: true },
);
createApp(IncomingWindow).use(pinia).use(i18n).mount('#app');
