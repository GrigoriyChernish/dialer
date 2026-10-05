import type { DownloadInfo, DownloadPlatform } from '@dialer/shared';

/** Збірки застосунку для тих, хто увійшов (docs/stage-builds.md, «Роздача користувачам»). */
export function createDownloadsApi(
  server: string,
  getToken: () => string,
  fetchFn: typeof fetch = (...a) => fetch(...a),
) {
  const base = server.replace(/\/+$/, '');
  const headers = () => ({ authorization: `Bearer ${getToken()}` });
  return {
    async list(): Promise<DownloadInfo[]> {
      const res = await fetchFn(`${base}/downloads`, { headers: headers() });
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json()) as { builds: DownloadInfo[] }).builds;
    },
    /** Підписане посилання на файл, діє хвилину. */
    async link(platform: DownloadPlatform): Promise<string> {
      const res = await fetchFn(`${base}/downloads/${platform}/link`, { method: 'POST', headers: headers() });
      if (!res.ok) throw new Error(String(res.status));
      return ((await res.json()) as { url: string }).url;
    },
  };
}
