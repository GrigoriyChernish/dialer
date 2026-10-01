import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/session';
import { AuthError, type AuthApi } from '@/shared/api/auth';

const user = { userId: '+380671234567', name: 'Ірина' };
const login = { token: 't1', expiresAt: Date.now() + 1_800_000, user, refreshToken: 'r1', sessionExpiresAt: Date.now() + 7 * 86_400_000 };

function setup(api: Partial<AuthApi> = {}) {
  setActivePinia(createPinia());
  const full: AuthApi = {
    start: vi.fn(async () => ({ known: false })),
    verify: vi.fn(async () => login),
    refresh: vi.fn(async () => ({ token: 't2', expiresAt: Date.now() + 1_800_000, user, sessionExpiresAt: login.sessionExpiresAt })),
    logout: vi.fn(async () => {}),
    ...api,
  };
  const store = useSessionStore();
  store.configure(full);
  return { store, api: full };
}

describe('session store', () => {
  beforeEach(() => localStorage.clear());

  it('verify зберігає сесію в localStorage, нова сторінка її підхоплює', async () => {
    const { store, api } = setup();
    await store.verify('+380671234567', '4567', 'Ірина');
    expect(api.verify).toHaveBeenCalledWith('+380671234567', '4567', 'Ірина');
    expect(store.loggedIn).toBe(true);
    expect(store.token).toBe('t1');
    expect(setup().store.session?.refreshToken).toBe('r1');
  });

  it('start: підтверджений номер входить одразу, новий іде на код', async () => {
    const fresh = setup();
    expect(await fresh.store.start('+380671234567')).toEqual({ known: false, loggedIn: false });
    expect(fresh.store.loggedIn).toBe(false);
    const verified = setup({ start: vi.fn(async () => ({ known: true as const, ...login })) });
    expect(await verified.store.start('+380671234567')).toEqual({ known: true, loggedIn: true });
    expect(verified.store.token).toBe('t1');
  });

  it('refresh міняє токен доступу й лишає refresh-токен', async () => {
    const { store } = setup();
    await store.verify('+380671234567', '4567');
    expect(await store.refresh()).toBe(true);
    expect(store.token).toBe('t2');
    expect(store.session?.refreshToken).toBe('r1');
  });

  it('сесія недійсна: вихід; сервер недоступний: сесія лишається', async () => {
    const offline = setup({ refresh: vi.fn(async () => Promise.reject(new AuthError('network'))) });
    await offline.store.verify('+380671234567', '4567');
    expect(await offline.store.refresh()).toBe(false);
    expect(offline.store.loggedIn).toBe(true);

    localStorage.clear();
    const expired = setup({ refresh: vi.fn(async () => Promise.reject(new AuthError('session_invalid'))) });
    await expired.store.verify('+380671234567', '4567');
    expect(await expired.store.refresh()).toBe(false);
    expect(expired.store.loggedIn).toBe(false);
    expect(localStorage.getItem('dialer.session')).toBeNull();
  });

  it('logout видаляє сесію на сервері й локально; прострочена сесія не завантажується', async () => {
    const { store, api } = setup();
    await store.verify('+380671234567', '4567');
    store.logout();
    expect(api.logout).toHaveBeenCalledWith('r1');
    expect(store.loggedIn).toBe(false);

    localStorage.setItem('dialer.session', JSON.stringify({ ...login, sessionExpiresAt: Date.now() - 1 }));
    expect(setup().store.loggedIn).toBe(false);
  });
});
