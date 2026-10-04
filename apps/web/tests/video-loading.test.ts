import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVideoLoading } from '@/shared/media/videoLoading';

const make = () => {
  const scope = effectScope();
  return { scope, v: scope.run(() => useVideoLoading({ spinnerDelay: 400, stallAfter: 10_000 }))! };
};

describe('useVideoLoading', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hides the video at once but shows the spinner only after the delay', () => {
    const { v } = make();
    expect(v.loading.value).toBe(true);
    expect(v.spinner.value).toBe(false);
    vi.advanceTimersByTime(399);
    expect(v.spinner.value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(v.spinner.value).toBe(true);
  });

  it('does not flash the spinner when the first frame comes quickly', () => {
    const { v } = make();
    vi.advanceTimersByTime(200);
    v.ready();
    vi.advanceTimersByTime(20_000);
    expect(v.loading.value).toBe(false);
    expect(v.spinner.value).toBe(false);
    expect(v.stalled.value).toBe(false);
  });

  it('reports a stalled stream after 10 s and recovers when a frame arrives', () => {
    const { v } = make();
    vi.advanceTimersByTime(10_000);
    expect(v.stalled.value).toBe(true);
    v.ready();
    expect(v.stalled.value).toBe(false);
    expect(v.loading.value).toBe(false);
  });

  it('does not restart the timers on repeated waiting events', () => {
    const { v } = make();
    vi.advanceTimersByTime(9_000);
    v.start();
    vi.advanceTimersByTime(1_000);
    expect(v.stalled.value).toBe(true);
  });

  it('starts over after buffering and for a new track', () => {
    const { v } = make();
    v.ready();
    v.start();
    expect(v.loading.value).toBe(true);
    vi.advanceTimersByTime(400);
    expect(v.spinner.value).toBe(true);
    v.reset();
    expect(v.spinner.value).toBe(false);
    expect(v.loading.value).toBe(true);
  });

  it('clears its timers when the scope is disposed', () => {
    const { scope, v } = make();
    scope.stop();
    vi.advanceTimersByTime(20_000);
    expect(v.spinner.value).toBe(false);
    expect(v.stalled.value).toBe(false);
  });
});
