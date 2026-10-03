import type { Theme } from '@/features/settings/prefs';

const FALLBACK = { light: '#eef0f6', dark: '#0a0c14' } as const;
const SYSTEM = [
  { media: '(prefers-color-scheme: light)', color: FALLBACK.light },
  { media: '(prefers-color-scheme: dark)', color: FALLBACK.dark },
];

/**
 * Тема застосунку: атрибут `data-theme` («Авто» — системна) і колір статус-бару `theme-color` = `--bg` поточної теми.
 * При явному виборі пара тегів із `media` заміняється одним (інакше системна тема перебила б вибір), для «Авто» пара повертається.
 */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const root = doc.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;

  const metas = [...doc.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const make = (content: string, media?: string) => {
    const m = doc.createElement('meta');
    m.setAttribute('name', 'theme-color');
    m.setAttribute('content', content);
    if (media) m.setAttribute('media', media);
    return m;
  };
  metas.forEach(m => m.remove());
  if (theme === 'auto') doc.head.append(...SYSTEM.map(s => make(s.color, s.media)));
  else {
    const bg = doc.defaultView?.getComputedStyle(root).getPropertyValue('--bg').trim();
    doc.head.append(make(bg || FALLBACK[theme]));
  }
}
