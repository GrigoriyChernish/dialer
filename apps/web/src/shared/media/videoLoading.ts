import { onScopeDispose, ref } from 'vue';

/**
 * Стан завантаження відеопотоку (дизайн: Video Loader). `loading`: першого кадру ще немає (відео ховаємо, щоб не було чорного прямокутника);
 * `spinner`: індикатор показуємо не одразу, а через `spinnerDelay`, щоб короткі паузи буферизації не блимали;
 * `stalled`: потік не стартував за `stallAfter`, екран розмови повертається до аватара й показує смужку «відео не завантажується».
 */
export function useVideoLoading({ spinnerDelay = 400, stallAfter = 10_000 } = {}) {
  const loading = ref(true);
  const spinner = ref(false);
  const stalled = ref(false);
  let spinTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(spinTimer);
    clearTimeout(stallTimer);
  };

  /** Кадрів немає (початок, нова доріжка, буферизація). Повторний виклик під час очікування таймери не перезапускає. */
  function start() {
    if (loading.value && (spinTimer || stallTimer)) return;
    loading.value = true;
    clear();
    spinTimer = setTimeout(() => (spinner.value = true), spinnerDelay);
    stallTimer = setTimeout(() => (stalled.value = true), stallAfter);
  }

  /** Пішов кадр: усе скидаємо, зокрема `stalled` (потік міг ожити пізніше). */
  function ready() {
    clear();
    spinTimer = stallTimer = undefined;
    loading.value = spinner.value = stalled.value = false;
  }

  /** Нова доріжка чи дзвінок: починаємо спочатку. */
  function reset() {
    ready();
    start();
  }

  start();
  onScopeDispose(clear);
  return { loading, spinner, stalled, start, ready, reset };
}
