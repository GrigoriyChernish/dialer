/** Адреса сервера: без `VITE_SERVER_URL` (локально) це той самий origin, сервер за проксі Vite. */
export const serverUrl: string = import.meta.env.VITE_SERVER_URL || location.origin;
