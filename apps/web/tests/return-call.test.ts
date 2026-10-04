import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@/app/i18n';
import ReturnCall from '@/features/call/ReturnCall.vue';
import { useCallStore, type CallDeps } from '@/features/call/store';

function setup() {
  setActivePinia(createPinia());
  let handler: (m: never) => void = () => {};
  const setCamera = vi.fn();
  const deps = {
    client: {
      request: vi.fn(async () => ({})),
      on: (f: typeof handler) => ((handler = f), () => {}),
      onStatus: () => () => {},
    },
    media: {
      join: vi.fn(),
      leave: vi.fn(),
      setMic: vi.fn(),
      setDeaf: vi.fn(),
      setCamera,
      attach: vi.fn(),
      onChange: vi.fn(),
    },
    sounds: { play: vi.fn() },
  } as unknown as CallDeps;
  const store = useCallStore();
  store.init(deps);
  handler({
    v: 1,
    type: 'hello.ok',
    serverTime: Date.now(),
    user: { userId: 'me', name: 'Я' },
    settings: { waiting: true, dnd: false },
    contacts: [],
    recents: [],
    recentsSeenUpTo: 0,
    calls: [
      {
        callId: 'c1',
        direction: 'out',
        peer: { userId: '+380501111111', name: 'Олена Коваль' },
        state: 'connected',
        startedAt: Date.now() - 134_000,
      },
    ],
  } as never);
  return { store, setCamera };
}

describe('ReturnCall', () => {
  it('shows the peer and the timer, and returns the call screen on click', async () => {
    const { store, setCamera } = setup();
    store.minimize();
    const w = mount(ReturnCall, { global: { plugins: [i18n] } });
    expect(w.text()).toContain('Олена Коваль');
    expect(w.text()).toMatch(/· 0[23]:\d\d/);
    expect(w.find('button').attributes('aria-label')).toBe('Повернутися до дзвінка: Олена Коваль');
    await w.find('button').trigger('click');
    expect(store.minimized).toBe(false);
    expect(setCamera).toHaveBeenLastCalledWith(store.cam);
  });

  it('shows the hold state instead of the timer', () => {
    const { store } = setup();
    store.hold = true;
    expect(mount(ReturnCall, { global: { plugins: [i18n] } }).text()).toContain('на утриманні');
  });
});
