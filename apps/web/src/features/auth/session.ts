import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { AuthError, type AuthApi, type LoginResult } from '@/shared/api/auth';

const KEY = 'dialer.session';

export type Session = LoginResult;

function load(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Session | null;
    return s && s.sessionExpiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}
function save(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // приватний режим: сесія живе лише до перезавантаження
  }
}

/** Сесія застосунку: токен доступу (30 хв) і refresh-токен (7 днів) у localStorage. */
export const useSessionStore = defineStore('session', () => {
  const session = ref<Session | null>(load());
  let api: AuthApi;

  const loggedIn = computed(() => !!session.value);
  const token = computed(() => session.value?.token ?? '');

  function set(s: Session | null) {
    session.value = s;
    save(s);
  }

  return {
    session,
    loggedIn,
    token,
    configure(a: AuthApi) {
      api = a;
    },
    /** `true`: номер уже підтверджений, вхід без коду; інакше `{ known }` і крок коду. */
    async start(phone: string): Promise<{ known: boolean; loggedIn: boolean }> {
      const res = await api.start(phone);
      if ('token' in res) set(res);
      return { known: res.known, loggedIn: 'token' in res };
    },
    async verify(phone: string, code: string, name?: string) {
      set(await api.verify(phone, code, name));
    },
    /** Новий токен доступу. `false`: сесія закінчилась (вихід) чи сервер недоступний (спробуємо пізніше). */
    async refresh(): Promise<boolean> {
      const s = session.value;
      if (!s) return false;
      try {
        set({ ...s, ...(await api.refresh(s.refreshToken)) });
        return true;
      } catch (e) {
        if (e instanceof AuthError && e.code !== 'network') set(null);
        return false;
      }
    },
    logout() {
      const s = session.value;
      if (s) void api.logout(s.refreshToken).catch(() => {});
      set(null);
    },
  };
});
