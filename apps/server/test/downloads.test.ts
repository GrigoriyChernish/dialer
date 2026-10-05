import { createHash, createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { presignGet, type S3Config } from '../src/downloads/s3';
import { login, startServer, type TestServer } from './helpers';

const AWS_EXAMPLE: S3Config = {
  endpoint: 'https://examplebucket.s3.amazonaws.com',
  bucket: 'examplebucket',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};

describe('presignGet', () => {
  it('містить параметри SigV4 і підпис', () => {
    const url = presignGet(AWS_EXAMPLE, 'test.txt', {
      expiresS: 86400,
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(url).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request');
    expect(url).toContain('X-Amz-Expires=86400');
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('підпис відтворюється вручну за алгоритмом SigV4', () => {
    const cfg: S3Config = { ...AWS_EXAMPLE, endpoint: 'https://fly.storage.tigris.dev', bucket: 'b', region: 'auto' };
    const url = new URL(presignGet(cfg, 'android/dialer.apk', { expiresS: 60, now: new Date('2026-10-05T10:00:00Z') }));
    const sig = url.searchParams.get('X-Amz-Signature');
    url.searchParams.delete('X-Amz-Signature');
    const query = [...url.searchParams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonical = [
      'GET',
      '/b/android/dialer.apk',
      query,
      'host:fly.storage.tigris.dev\n',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const scope = '20261005/auto/s3/aws4_request';
    const toSign = [
      'AWS4-HMAC-SHA256',
      '20261005T100000Z',
      scope,
      createHash('sha256').update(canonical).digest('hex'),
    ].join('\n');
    const h = (k: string | Buffer, s: string) => createHmac('sha256', k).update(s).digest();
    const key = h(h(h(h(`AWS4${cfg.secretAccessKey}`, '20261005'), 'auto'), 's3'), 'aws4_request');
    expect(sig).toBe(createHmac('sha256', key).update(toSign).digest('hex'));
  });
});

const MANIFEST = {
  android: { version: '0.1.0', size: 110, sha256: 'a'.repeat(64), updatedAt: '2026-10-05T10:00:00Z' },
};

describe('GET /downloads', () => {
  let s3: Server | null = null;
  let srv: TestServer | null = null;
  afterEach(async () => {
    await srv?.close();
    await new Promise(r => (s3 ? s3.close(r) : r(null)));
    s3 = srv = null;
  });

  async function start(withBucket: boolean) {
    if (withBucket) {
      s3 = createServer((req, res) => {
        if (req.url?.startsWith('/bkt/manifest.json')) res.end(JSON.stringify(MANIFEST));
        else res.writeHead(404).end();
      });
      await new Promise<void>(r => s3!.listen(0, '127.0.0.1', r));
    }
    const port = withBucket ? (s3!.address() as { port: number }).port : 0;
    srv = await startServer(undefined, {
      config: withBucket
        ? {
            downloads: {
              endpoint: `http://127.0.0.1:${port}`,
              bucket: 'bkt',
              accessKeyId: 'AK',
              secretAccessKey: 'SK',
              region: 'auto',
            },
          }
        : {},
    });
    const { body } = await login(srv, 'Оля', '+380501110001');
    return { srv, auth: { authorization: `Bearer ${body.token}` } };
  }

  it('без токена 401', async () => {
    const { srv } = await start(true);
    expect((await fetch(`${srv.http}/downloads`)).status).toBe(401);
    expect((await fetch(`${srv.http}/downloads/android/link`, { method: 'POST' })).status).toBe(401);
  });

  it('без бакета порожній список, посилання немає', async () => {
    const { srv, auth } = await start(false);
    const res = await fetch(`${srv.http}/downloads`, { headers: auth });
    expect(await res.json()).toEqual({ builds: [] });
    expect((await fetch(`${srv.http}/downloads/android/link`, { method: 'POST', headers: auth })).status).toBe(404);
  });

  it('віддає список із маніфесту й посилання на 60 с з attachment', async () => {
    const { srv, auth } = await start(true);
    const list = (await (await fetch(`${srv.http}/downloads`, { headers: auth })).json()) as any;
    expect(list.builds).toEqual([{ platform: 'android', ...MANIFEST.android }]);
    const res = await fetch(`${srv.http}/downloads/android/link`, { method: 'POST', headers: auth });
    const { url } = (await res.json()) as { url: string };
    expect(url).toContain('/bkt/android/dialer.apk?');
    expect(url).toContain('X-Amz-Expires=60');
    expect(decodeURIComponent(url)).toContain('attachment; filename="dialer.apk"');
  });

  it('платформа без збірки чи невідома: 404', async () => {
    const { srv, auth } = await start(true);
    for (const p of ['macos', 'windows'])
      expect((await fetch(`${srv.http}/downloads/${p}/link`, { method: 'POST', headers: auth })).status).toBe(404);
  });
});
