import type { LiveKitConfig } from './livekit';
import { existsSync } from 'node:fs';
import type { PlayerConfig } from './bots/player';
import type { VapidConfig } from './push/sender';

export interface Config {
  port: number;
  host: string;
  jwtSecret: string;
  dbPath: string;
  /** Origin застосунку (GitHub Pages) для CORS `/auth/*` і `/demo/login`; `null`: CORS вимкнено. */
  demoOrigin: string | null;
  /** `/demo/login` без коду: для розробки й прототипів; у production вимкнено, якщо не `DEMO_LOGIN=on`. */
  demoLogin: boolean;
  logLevel: string;
  /** `NODE_ENV=production`: суворіші правила (джерела WebSocket, секрети). */
  production: boolean;
  /** LiveKit Cloud; `null`: медіа вимкнено (дзвінки без токенів кімнат, лише для розробки). */
  livekit: LiveKitConfig | null;
  /** Ключі VAPID для Web Push; `null`: push вимкнено (див. docs/pwa-and-push.md). */
  vapid: VapidConfig | null;
  /** `FCM_SERVICE_ACCOUNT_FILE`: шлях до JSON-ключа сервісного акаунта Firebase для push на Android; `null`: FCM вимкнено. */
  fcmServiceAccountFile: string | null;
  /** `FCM_SERVICE_ACCOUNT_JSON`: той самий ключ вмістом (секрет Fly.io, де файлу немає); має перевагу над файлом. */
  fcmServiceAccountJson: string | null;
  /** Що грає бот «Відео-тест»: `BOT_VIDEO_FILE` (файл у циклі, типово `media/video-test.mp4`, без файлу тестова картинка), `BOT_VIDEO_HEIGHT` (типово 720, 2160 це 4K). */
  botVideo: PlayerConfig;
  /** `DEV_APK_PATH`: файл APK для `GET /dialer.apk` (тестування Android у локальній мережі); `null`: маршруту немає. */
  devApk: string | null;
}

/** Ролик, що лежить у репозиторії; `BOT_VIDEO_FILE` його замінює (наприклад, на 4K). */
const DEFAULT_BOT_VIDEO = './media/video-test.mp4';

const DEV_SECRET = 'dev-only-secret-change-me-0123456789';

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const production = env.NODE_ENV === 'production';
  const jwtSecret = env.JWT_SECRET || (production ? '' : DEV_SECRET);
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET має бути не коротшим за 32 символи');
  const lk = { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET };
  const lkSet = Object.values(lk).filter(Boolean).length;
  if (lkSet > 0 && lkSet < 3) throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY і LIVEKIT_API_SECRET задаються разом');
  if (production && lkSet === 0)
    throw new Error('У production потрібні LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET');
  const vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
  const vapidSet = Object.values(vapid).filter(Boolean).length;
  if (vapidSet > 0 && vapidSet < 3)
    throw new Error('VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY і VAPID_SUBJECT задаються разом');
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    jwtSecret,
    dbPath: env.DB_PATH ?? './data/dialer.db',
    demoOrigin: env.DEMO_ORIGIN || null,
    demoLogin: env.DEMO_LOGIN ? env.DEMO_LOGIN === 'on' : !production,
    logLevel: env.LOG_LEVEL ?? 'info',
    production,
    livekit: lkSet === 3 ? (lk as LiveKitConfig) : null,
    vapid: vapidSet === 3 ? (vapid as VapidConfig) : null,
    devApk: env.DEV_APK_PATH || null,
    fcmServiceAccountFile: env.FCM_SERVICE_ACCOUNT_FILE || null,
    fcmServiceAccountJson: env.FCM_SERVICE_ACCOUNT_JSON || null,
    botVideo: {
      file: env.BOT_VIDEO_FILE || (existsSync(DEFAULT_BOT_VIDEO) ? DEFAULT_BOT_VIDEO : null),
      height: Number(env.BOT_VIDEO_HEIGHT) || 720,
    },
  };
}

export const isDevSecret = (config: Config) => config.jwtSecret === DEV_SECRET;
