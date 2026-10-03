import type { RecentEntry } from '@dialer/shared';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@/app/i18n';
import { useCallStore, type CallDeps } from '@/features/call/store';
import HistoryPage from '@/pages/HistoryPage.vue';

const entry = (p: Partial<RecentEntry>): RecentEntry => ({
  callId: 'c',
  peer: '+380501111111',
  direction: 'out',
  result: 'completed',
  startedAt: Date.now(),
  ...p,
});

function mountPage(recents: RecentEntry[]) {
  setActivePinia(createPinia());
  let handler: (m: never) => void = () => {};
  const deps = {
    client: { request: vi.fn(), on: (f: typeof handler) => ((handler = f), () => {}), onStatus: () => () => {} },
    media: { join: vi.fn(), leave: vi.fn(), setMic: vi.fn(), setDeaf: vi.fn(), attach: vi.fn(), onChange: vi.fn() },
    sounds: { play: vi.fn() },
  } as unknown as CallDeps;
  const store = useCallStore();
  store.init(deps);
  handler({
    v: 1,
    type: 'hello.ok',
    serverTime: Date.now(),
    me: { userId: 'me', name: 'Я' },
    settings: {},
    contacts: [{ userId: '+380501111111', name: 'Олена Коваль', online: true }],
    calls: [],
    recents,
  } as never);
  return mount(HistoryPage, { global: { plugins: [i18n] } });
}

describe('HistoryPage', () => {
  it('shows every result with direction, time and duration, missed ones in red', () => {
    const w = mountPage([
      entry({ callId: '1', result: 'missed', direction: 'in' }),
      entry({ callId: '2', result: 'completed', direction: 'in', duration: 125 }),
      entry({ callId: '3', result: 'completed', direction: 'out', duration: 7 }),
      entry({ callId: '4', result: 'no_answer' }),
      entry({ callId: '5', result: 'cancelled' }),
    ]);
    const rows = w.findAll('button');
    expect(rows).toHaveLength(5);
    const text = (i: number) => rows[i]!.find('small').text();
    expect(text(0)).toMatch(/^пропущений · /);
    expect(text(1)).toMatch(/^вхідний · .+ · 02:05$/);
    expect(text(2)).toMatch(/^вихідний · .+ · 00:07$/);
    expect(text(3)).toMatch(/^без відповіді · /);
    expect(text(4)).toMatch(/^скасований · /);
    const avatar = (i: number) => rows[i]!.find('[aria-hidden]').attributes('style') ?? '';
    expect(avatar(0)).toContain('color-mix');
    expect(avatar(3)).toContain('color-mix');
    expect(avatar(1)).not.toContain('color-mix');
    expect(rows[0]!.find('small span').classes()).toContain('text-bad-text');
  });

  it('shows an empty state when there are no calls', () => {
    expect(mountPage([]).text()).toContain('Дзвінків ще не було');
  });
});
