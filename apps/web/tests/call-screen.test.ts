import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@/app/i18n';
import CallScreen from '@/features/call/CallScreen.vue';
import { useCallStore, type CallDeps } from '@/features/call/store';

function connectedCall() {
  setActivePinia(createPinia());
  let handler: (m: never) => void = () => {};
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
      setCamera: vi.fn(),
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
        startedAt: Date.now() - 5_000,
      },
    ],
  } as never);
  return store;
}

// екран розмови не маунтився в тестах, і помилка порядку ініціалізації (пул читає ref нижче в файлі) дійшла до продакшену
describe('CallScreen', () => {
  it('mounts a connected call with the minimize button and the peer name', async () => {
    const store = connectedCall();
    const w = mount(CallScreen, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(w.text()).toContain('Олена Коваль');
    const btn = w.find('button[aria-label="Згорнути розмову"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    expect(store.minimized).toBe(true);
  });

  it('shows the weak-signal pool notification', async () => {
    const store = connectedCall();
    store.link.poor = true;
    store.link.audioOnly = true;
    const w = mount(CallScreen, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(w.text()).toContain('Слабкий сигнал · лише звук');
  });
});
