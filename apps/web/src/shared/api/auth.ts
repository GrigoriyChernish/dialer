/** HTTP-вхід за номером (docs/backend.md, «Вхід за номером»). */
export interface AuthUser {
  userId: string;
  name: string;
}
export interface AccessToken {
  token: string;
  expiresAt: number;
  user: AuthUser;
  sessionExpiresAt: number;
}
export interface LoginResult extends AccessToken {
  refreshToken: string;
}

/** Помилка сервера (`invalid_code`, `too_many_attempts` …) чи `network`, якщо сервер недоступний. */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly data: { attemptsLeft?: number; retryAfter?: number } = {},
  ) {
    super(code);
  }
}

export function createAuthApi(server: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
  const base = server.replace(/\/+$/, '');
  async function post<T>(path: string, body: object): Promise<T> {
    let res: Response;
    try {
      // keepalive: logout довершується, навіть коли сторінка одразу перезавантажується на екран входу
      res = await fetchFn(base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {
      throw new AuthError('network');
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AuthError(data.error ?? 'error', data);
    return data as T;
  }
  return {
    /** Підтверджений номер одразу отримує токен і сесію; інакше `{ known }` і код. */
    start: (phone: string) => post<{ known: boolean } | ({ known: true } & LoginResult)>('/auth/start', { phone }),
    verify: (phone: string, code: string, name?: string) =>
      post<LoginResult>('/auth/verify', { phone, code, ...(name && { name }) }),
    refresh: (refreshToken: string) => post<AccessToken>('/auth/refresh', { refreshToken }),
    logout: (refreshToken: string) => post<void>('/auth/logout', { refreshToken }),
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
