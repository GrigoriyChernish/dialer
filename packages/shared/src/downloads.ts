/** Платформи, для яких є збірки застосунку (docs/stage-builds.md). */
export type DownloadPlatform = 'android' | 'macos';

/** Опублікована збірка: один (останній) файл на платформу. */
export interface DownloadInfo {
  platform: DownloadPlatform;
  version: string;
  /** Розмір, байти. */
  size: number;
  sha256: string;
  /** ISO-дата публікації. */
  updatedAt: string;
}
