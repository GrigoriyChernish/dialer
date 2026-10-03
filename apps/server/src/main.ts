import { loadConfig, isDevSecret } from './config';
import { createLogger } from './logger';
import { createServer } from './server';

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
if (isDevSecret(config)) logger.warn('JWT_SECRET не задано: використано ключ для розробки');

const server = await createServer({ config, logger });
const port = await server.listen();
logger.info({ port }, 'сервер запущено');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'зупинка');
    server.close().finally(() => process.exit(0));
  });
}
