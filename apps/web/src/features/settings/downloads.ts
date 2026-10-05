import type { DownloadInfo, DownloadPlatform } from '@dialer/shared';
import { ref } from 'vue';
import { useSessionStore } from '@/features/auth/session';
import { createDownloadsApi } from '@/shared/api/downloads';
import { serverUrl } from '@/shared/api/server';
import { isTauri } from '@/shared/native/notify';

/**
 * Завантаження застосунків Android і macOS (Налаштування → «Застосунки»): список збірок і запуск завантаження підписаним
 * посиланням. У самому застосунку (Tauri) розділу немає: він уже встановлений.
 */
export function useDownloads() {
  const session = useSessionStore();
  const api = createDownloadsApi(serverUrl, () => session.token);
  const builds = ref<DownloadInfo[]>([]);
  const error = ref(false);
  const busy = ref<DownloadPlatform | null>(null);

  async function load() {
    if (isTauri()) return;
    try {
      builds.value = await api.list();
    } catch {
      builds.value = [];
    }
  }

  async function download(platform: DownloadPlatform) {
    if (busy.value) return;
    busy.value = platform;
    error.value = false;
    try {
      location.href = await api.link(platform);
    } catch {
      error.value = true;
    } finally {
      busy.value = null;
    }
  }

  return { builds, error, busy, load, download };
}

/** Розмір файлу для підпису: «110 МБ». */
export const formatSize = (bytes: number) => `${Math.max(1, Math.round(bytes / 1_048_576))} МБ`;
