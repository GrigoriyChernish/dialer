import { computed, ref, watch, type ComputedRef } from 'vue';
import type { BannerItem } from '@/shared/ui/BannerStack.vue';

/** Група сповіщення: системні (мережа) сильніші за користувацькі (наші пристрої, утримуваний дзвінок). */
export type PoolGroup = 'system' | 'user';
export type PoolSource = BannerItem & { group: PoolGroup };

/** Порядок показу: спершу системні, всередині групи новіші (за `since`) вище. */
export function sortPool<T extends { group: PoolGroup; since: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.group === 'system') - Number(a.group === 'system') || b.since - a.since);
}

/**
 * Пул сповіщень `Self`-зони (рішення дизайну): у слоті видно одне, перше за порядком `sortPool`; решта чекає в черзі.
 * Час появи (`since`) пам'ятаємо лише поки сповіщення активне; повторна поява вважається новою.
 */
export function usePool(source: () => PoolSource[]): ComputedRef<BannerItem[]> {
  let seq = 0;
  const since = ref<Record<string, number>>({});
  watch(
    () =>
      source()
        .map(i => i.id)
        .join(),
    () => {
      const next: Record<string, number> = {};
      for (const { id } of source()) next[id] = since.value[id] ?? ++seq;
      since.value = next;
    },
    { immediate: true, flush: 'sync' },
  );
  return computed(() =>
    sortPool(source().map(i => ({ ...i, since: since.value[i.id] ?? 0 }))).map(
      ({ group: _g, since: _s, ...item }) => item,
    ),
  );
}
