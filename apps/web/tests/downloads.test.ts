import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDownloadsApi } from '@/shared/api/downloads';
import { formatSize, useDownloads } from '@/features/settings/downloads';

const BUILD = { platform: 'android', version: '0.1.0', size: 110 * 1_048_576, sha256: 'a', updatedAt: '2026-10-05' };

describe('createDownloadsApi', () => {
  it('шле токен і повертає список та посилання', async () => {
    const fetchFn = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/downloads')
        ? new Response(JSON.stringify({ builds: [BUILD] }))
        : new Response(JSON.stringify({ url: 'https://s3/x' })),
    );
    const api = createDownloadsApi('http://srv/', () => 'T', fetchFn as unknown as typeof fetch);
    expect(await api.list()).toEqual([BUILD]);
    expect(await api.link('android')).toBe('https://s3/x');
    expect(fetchFn).toHaveBeenCalledWith('http://srv/downloads', { headers: { authorization: 'Bearer T' } });
    expect(fetchFn.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
  });

  it('помилка сервера викидає виняток', async () => {
    const api = createDownloadsApi('http://srv', () => 'T', (async () => new Response('', { status: 401 })) as never);
    await expect(api.list()).rejects.toThrow('401');
    await expect(api.link('macos')).rejects.toThrow('401');
  });
});

describe('useDownloads', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.unstubAllGlobals());

  it('у Tauri розділу немає: список не вантажиться', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const d = useDownloads();
    await d.load();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(d.builds.value).toEqual([]);
  });

  it('помилка списку дає порожній список', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    const d = useDownloads();
    await d.load();
    expect(d.builds.value).toEqual([]);
  });
});

it('formatSize', () => {
  expect(formatSize(110 * 1_048_576)).toBe('110 МБ');
  expect(formatSize(10)).toBe('1 МБ');
});
