export interface Config {
  port: number;
  host: string;
  jwtSecret: string;
  dbPath: string;
  /** Origin сторінки демо для CORS `/demo/login`; `null`: CORS вимкнено. */
  demoOrigin: string | null;
  logLevel: string;
}

const DEV_SECRET = 'dev-only-secret-change-me-0123456789';

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const production = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET || (production ? '' : DEV_SECRET);
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET має бути не коротшим за 32 символи');
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    jwtSecret,
    dbPath: env.DB_PATH ?? './data/dialer.db',
    demoOrigin: env.DEMO_ORIGIN || null,
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}

export const isDevSecret = (config: Config) => config.jwtSecret === DEV_SECRET;
