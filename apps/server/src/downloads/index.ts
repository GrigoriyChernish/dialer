import type { DownloadInfo, DownloadPlatform } from '@dialer/shared';
import { presignGet, type S3Config } from './s3';

/** Один файл на платформу: нове завантаження в бакет замінює старе (`scripts/publish-build.sh`). */
export const DOWNLOAD_FILES: Record<DownloadPlatform, { key: string; filename: string }> = {
  android: { key: 'android/dialer.apk', filename: 'dialer.apk' },
  macos: { key: 'macos/dialer.dmg', filename: 'dialer.dmg' },
};

const MANIFEST_KEY = 'manifest.json';
const LINK_TTL_S = 60;
const MANIFEST_TTL_MS = 60_000;

const isPlatform = (p: string): p is DownloadPlatform => p in DOWNLOAD_FILES;

/** Збірки для користувачів у Tigris: список із `manifest.json` і короткі підписані посилання на файли. */
export function createDownloads(cfg: S3Config | null, fetchImpl: typeof fetch = fetch, now = () => Date.now()) {
  let cache: { at: number; list: DownloadInfo[] } | null = null;

  async function list(): Promise<DownloadInfo[]> {
    if (!cfg) return [];
    if (cache && now() - cache.at < MANIFEST_TTL_MS) return cache.list;
    try {
      const res = await fetchImpl(presignGet(cfg, MANIFEST_KEY, { expiresS: 30, now: new Date(now()) }));
      if (!res.ok) return [];
      const manifest = (await res.json()) as Record<string, Omit<DownloadInfo, 'platform'>>;
      const out = Object.entries(manifest)
        .filter(([platform]) => isPlatform(platform))
        .map(([platform, info]) => ({ ...info, platform }) as DownloadInfo);
      cache = { at: now(), list: out };
      return out;
    } catch {
      return [];
    }
  }

  return {
    list,
    /** Посилання на 60 с із `attachment`; `null`: платформи немає чи збірку не опубліковано. */
    async link(platform: string): Promise<string | null> {
      if (!cfg || !isPlatform(platform) || !(await list()).some(d => d.platform === platform)) return null;
      const { key, filename } = DOWNLOAD_FILES[platform];
      return presignGet(cfg, key, {
        expiresS: LINK_TTL_S,
        now: new Date(now()),
        query: { 'response-content-disposition': `attachment; filename="${filename}"` },
      });
    },
  };
}

export type Downloads = ReturnType<typeof createDownloads>;
