import { createHash, createHmac } from 'node:crypto';

/** Доступ до бакета Tigris (S3-сумісного сховища Fly.io): `fly storage create` кладе ці значення в секрети застосунку. */
export interface S3Config {
  /** Наприклад `https://fly.storage.tigris.dev`. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Tigris приймає `auto`. */
  region: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string | Buffer, s: string) => createHmac('sha256', key).update(s).digest();
/** Кодування за правилами SigV4: `encodeURIComponent` ще й екранує `!'()*`. */
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Підписане посилання на читання (чи запис) об'єкта (AWS Signature V4, підпис у query), без SDK: файл браузер тягне напряму зі сховища.
 * Адресація path-style: `<endpoint>/<bucket>/<key>`. `query` додає параметри відповіді (`response-content-disposition`).
 */
export function presignGet(
  cfg: S3Config,
  key: string,
  opts: { expiresS: number; now?: Date; query?: Record<string, string> },
): string {
  return presign(cfg, 'GET', key, opts);
}

/** Те саме для запису (`PUT`): так збірки вантажить `scripts/publish-build.sh` через `curl`, без aws CLI. */
export function presignPut(cfg: S3Config, key: string, opts: { expiresS: number; now?: Date }): string {
  return presign(cfg, 'PUT', key, opts);
}

function presign(
  cfg: S3Config,
  method: 'GET' | 'PUT',
  key: string,
  { expiresS, now = new Date(), query = {} }: { expiresS: number; now?: Date; query?: Record<string, string> },
): string {
  const url = new URL(cfg.endpoint);
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = stamp.slice(0, 8);
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(expiresS),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map(k => `${enc(k)}=${enc(params[k]!)}`)
    .join('&');
  const path = `/${[cfg.bucket, ...key.split('/')].map(enc).join('/')}`;
  const canonical = [method, path, canonicalQuery, `host:${url.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretAccessKey}`, day), cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
