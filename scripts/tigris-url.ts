// Підписане посилання на об'єкт бакета для scripts/publish-build.sh: tsx scripts/tigris-url.ts <get|put> <ключ>
// Ключі бакета беремо зі змінних середовища (BUCKET_NAME, AWS_*), посилання друкуємо в stdout.
import { presignGet, presignPut } from '../apps/server/src/downloads/s3';

const [mode, key] = process.argv.slice(2);
const env = process.env;
if (!key || (mode !== 'get' && mode !== 'put')) throw new Error('використання: tigris-url.ts <get|put> <ключ>');
const cfg = {
  endpoint: env.AWS_ENDPOINT_URL_S3 || 'https://fly.storage.tigris.dev',
  bucket: env.BUCKET_NAME ?? '',
  accessKeyId: env.AWS_ACCESS_KEY_ID ?? '',
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? '',
  region: env.AWS_REGION || 'auto',
};
console.log((mode === 'get' ? presignGet : presignPut)(cfg, key, { expiresS: 900 }));
