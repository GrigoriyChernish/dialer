import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/app/i18n';
import { useCallStore, type CallDeps } from '@/features/call/store';
import VideoSurface from '@/shared/ui/VideoSurface.vue';

function mountSurface(kind: 'local' | 'remote', cls = '') {
  setActivePinia(createPinia());
  const deps = {
    client: { request: vi.fn(), on: () => () => {}, onStatus: () => () => {} },
    media: { join: vi.fn(), leave: vi.fn(), setMic: vi.fn(), setDeaf: vi.fn(), attach: vi.fn(), onChange: vi.fn() },
    sounds: { play: vi.fn() },
  } as unknown as CallDeps;
  useCallStore().init(deps);
  return mount(VideoSurface, { props: { kind, track: true }, attrs: { class: cls }, global: { plugins: [i18n] } });
}

describe('VideoSurface', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the position given by the parent (a `relative` root would override `absolute` and push the video into the flow)', () => {
    const w = mountSurface('remote', 'absolute inset-0');
    expect(w.classes()).toContain('absolute');
    expect(w.classes()).not.toContain('relative');
  });

  it('hides the video until the first frame and shows an accessible loader only after a delay', async () => {
    const w = mountSurface('remote');
    const video = w.find('video');
    expect(video.classes()).toContain('opacity-0');
    expect(w.find('[role=status]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(w.find('[role=status]').text()).toContain('Завантажуємо відео');
    await video.trigger('playing');
    expect(video.classes()).toContain('opacity-100');
    expect(w.find('[role=status]').exists()).toBe(false);
  });

  it('shows a smaller loader without the dimming layer on the self view', async () => {
    const w = mountSurface('local');
    await vi.advanceTimersByTimeAsync(399);
    expect(w.find('[role=status]').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const loader = w.find('[role=status]');
    expect(loader.exists()).toBe(true);
    expect(loader.classes()).not.toContain('bg-bg/60');
    expect(loader.find('span[aria-hidden]').classes()).toContain('size-6');
    await w.find('video').trigger('playing');
    expect(w.find('[role=status]').exists()).toBe(false);
  });

  it('emits stalled after 10 s without a frame and clears it when the stream comes alive', async () => {
    const w = mountSurface('remote');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(w.emitted('stalled')?.at(-1)).toEqual([true]);
    await w.find('video').trigger('playing');
    expect(w.emitted('stalled')?.at(-1)).toEqual([false]);
  });

  it('shows the loader again after buffering stalls the picture', async () => {
    const w = mountSurface('remote');
    await w.find('video').trigger('playing');
    await w.find('video').trigger('waiting');
    expect(w.find('video').classes()).toContain('opacity-0');
    await vi.advanceTimersByTimeAsync(400);
    expect(w.find('[role=status]').exists()).toBe(true);
  });

  it('replaces the self view spinner with a video-off icon when the camera gives no frame', async () => {
    const w = mountSurface('local');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.find('[role=status]').exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(w.find('[role=status]').exists()).toBe(false);
    expect(w.find('svg').exists()).toBe(true);
    await w.find('video').trigger('playing');
    expect(w.find('svg').exists()).toBe(false);
  });
});
