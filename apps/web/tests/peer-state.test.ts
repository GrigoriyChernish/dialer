import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { holdFlag, latestPeerState, trackSince, type PeerFlags } from '@/features/call/peerState';

const none: PeerFlags = { hold: false, lost: false, mic: false };

describe('latestPeerState', () => {
  it('is null without active states', () => {
    expect(latestPeerState(none, {})).toBeNull();
  });

  it('returns the single active state', () => {
    expect(latestPeerState({ ...none, lost: true }, { lost: 5 })).toBe('lost');
  });

  it('prefers the state that started last, not a fixed priority', () => {
    const flags = { ...none, hold: true, mic: true };
    expect(latestPeerState(flags, { mic: 1, hold: 2 })).toBe('hold');
    expect(latestPeerState(flags, { hold: 1, mic: 2 })).toBe('mic');
  });

  it('falls back to the earlier state once the later one ends', () => {
    const since = { mic: 1, hold: 2 };
    expect(latestPeerState({ ...none, mic: true }, since)).toBe('mic');
  });

  it('breaks ties by hold, then lost, then mic', () => {
    expect(latestPeerState({ hold: true, lost: true, mic: true }, { hold: 7, lost: 7, mic: 7 })).toBe('hold');
    expect(latestPeerState({ hold: false, lost: true, mic: true }, { lost: 7, mic: 7 })).toBe('lost');
  });
});

describe('trackSince', () => {
  it('stamps new states, keeps old stamps and forgets ended states', () => {
    let since = trackSince({}, { ...none, mic: true }, 10);
    expect(since).toEqual({ mic: 10 });
    since = trackSince(since, { ...none, mic: true, hold: true }, 20);
    expect(since).toEqual({ mic: 10, hold: 20 });
    since = trackSince(since, { ...none, hold: true }, 30);
    expect(since).toEqual({ hold: 20 });
    expect(trackSince(since, none, 40)).toEqual({});
  });
});

describe('holdFlag', () => {
  it('turns on at once and off after the hold time', () => {
    vi.useFakeTimers();
    const src = ref(false);
    const out = holdFlag(() => src.value, 250);
    src.value = true;
    expect(out.value).toBe(true);
    src.value = false;
    vi.advanceTimersByTime(249);
    expect(out.value).toBe(true);
    vi.advanceTimersByTime(2);
    expect(out.value).toBe(false);
    vi.useRealTimers();
  });

  it('cancels the pending off when the source comes back', async () => {
    vi.useFakeTimers();
    const src = ref(true);
    const out = holdFlag(() => src.value, 250);
    src.value = false;
    vi.advanceTimersByTime(200);
    src.value = true;
    await nextTick();
    vi.advanceTimersByTime(1000);
    expect(out.value).toBe(true);
    vi.useRealTimers();
  });
});
