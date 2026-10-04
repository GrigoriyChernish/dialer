import { onUnmounted, ref, watch } from 'vue';
import { useCallStore } from '@/features/call/store';

/**
 * Затримки для станів списку (дизайн: Home · Contacts · loading, Home · Contacts · offline).
 * `skeleton`: заготовку показуємо через 300 мс, бо локально `hello.ok` приходить раніше, і вона б лише блимнула.
 * `offline`: «Немає зв'язку» лише якщо розрив довший за 3 с: короткі перепідключення не блимають.
 */
export function useLoadState() {
  const call = useCallStore();
  const skeleton = ref(false);
  const offline = ref(false);
  const skeletonTimer = setTimeout(() => (skeleton.value = true), 300);
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;
  watch(
    () => call.online,
    on => {
      clearTimeout(offlineTimer);
      if (on) offline.value = false;
      else offlineTimer = setTimeout(() => (offline.value = true), 3_000);
    },
    { immediate: true },
  );
  onUnmounted(() => {
    clearTimeout(skeletonTimer);
    clearTimeout(offlineTimer);
  });
  return { skeleton, offline };
}
