import { ref } from 'vue';

export type HomeTab = 'history' | 'contacts' | 'search';

/** Вибрана вкладка головної й запит пошуку живуть поза компонентами: перехід у налаштування й назад їх не скидає. */
export const homeTab = ref<HomeTab>('contacts');
export const searchQuery = ref('');
