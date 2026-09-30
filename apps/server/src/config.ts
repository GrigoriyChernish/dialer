import type { LiveKitConfig } from './livekit';

export interface Config {
  port: number;
  host: string;
  jwtSecret: string;
  dbPath: string;
  /** Origin сторінки демо для CORS `/demo/login`; `null`: CORS вимкнено. */
  demoOrigin: string | null;
  logLevel: string;
  /** LiveKit Cloud; `null`: медіа вимкнено (дзвінки без токенів кімнат, лише для розробки). */
  livekit: LiveKitConfig | null;
}

const DEV_SECRET = 'dev-only-secret-change-me-0123456789';

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const production = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET || (production ? '' : DEV_SECRET);
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET має бути не коротшим за 32 символи');
  const lk = { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET };
  const lkSet = Object.values(lk).filter(Boolean).length;
  if (lkSet > 0 && lkSet < 3) throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY і LIVEKIT_API_SECRET задаються разом');
  if (production && lkSet === 0) throw new Error('У production потрібні LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET');
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    jwtSecret,
    dbPath: env.DB_PATH ?? './data/dialer.db',
    demoOrigin: env.DEMO_ORIGIN || null,
    logLevel: env.LOG_LEVEL ?? 'info',
    livekit: lkSet === 3 ? (lk as LiveKitConfig) : null,
  };
}

export const isDevSecret = (config: Config) => config.jwtSecret === DEV_SECRET;
