import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme } from '@/shared/theme';

const metas = () => [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];

describe('applyTheme', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    delete document.documentElement.dataset.theme;
    document.documentElement.style.removeProperty('--bg');
  });

  it('«Авто»: атрибута теми немає, пара тегів із media', () => {
    applyTheme('dark');
    applyTheme('auto');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(metas().map(m => [m.getAttribute('media'), m.getAttribute('content')])).toEqual([
      ['(prefers-color-scheme: light)', '#eef0f6'],
      ['(prefers-color-scheme: dark)', '#0a0c14'],
    ]);
  });

  it('явна тема: один тег без media, щоб системна тема не перебила вибір', () => {
    applyTheme('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(metas().map(m => [m.getAttribute('media'), m.getAttribute('content')])).toEqual([[null, '#0a0c14']]);
  });

  it('колір береться з --bg поточної теми', () => {
    document.documentElement.style.setProperty('--bg', ' #123456 ');
    applyTheme('light');
    expect(metas()[0]?.getAttribute('content')).toBe('#123456');
  });
});
