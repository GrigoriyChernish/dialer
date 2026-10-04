// Генерує іконки PWA (apps/web/public/icons/*.png) без залежностей: значок слухавки на зеленому диску (maskable: суцільний фон).
// Запуск: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../apps/web/public/icons/', import.meta.url));
const BG = [10, 12, 20]; // --bg темної теми
const OK = [34, 197, 94]; // колір виклику
const FG = [255, 255, 255];

/** Слухавка: дуга кола з круглими кінцями, випукла вниз-вліво; центр фігури в (0, 0). Координати в [-1, 1]; відстань до фігури. */
function handset(x, y) {
  const R = 0.6;
  const w = 0.17;
  const c = R * Math.SQRT1_2; // центр кола, щоб середина дуги (135°) лежала в початку координат
  const ang = Math.atan2(y + c, x - c);
  const lo = (Math.PI * 85) / 180;
  const hi = (Math.PI * 185) / 180;
  const t = Math.min(Math.max(ang < 0 ? ang + 2 * Math.PI : ang, lo), hi);
  return Math.hypot(x - c - R * Math.cos(t), y + c - R * Math.sin(t)) - w;
}

function render(size, { maskable }) {
  const buf = Buffer.alloc(size * (size * 4 + 1));
  const scale = maskable ? 0.8 : 1; // maskable: вміст у безпечній зоні
  const SS = 3;
  for (let j = 0; j < size; j++) {
    buf[j * (size * 4 + 1)] = 0;
    for (let i = 0; i < size; i++) {
      let acc = [0, 0, 0];
      for (let sj = 0; sj < SS; sj++)
        for (let si = 0; si < SS; si++) {
          const x = ((i + (si + 0.5) / SS) / size) * 2 - 1;
          const y = ((j + (sj + 0.5) / SS) / size) * 2 - 1;
          let c = maskable || Math.hypot(x, y) <= 0.9 ? OK : BG;
          if (handset(x / scale, y / scale) <= 0) c = FG;
          acc = acc.map((v, k) => v + c[k]);
        }
      const o = j * (size * 4 + 1) + 1 + i * 4;
      for (let k = 0; k < 3; k++) buf[o + k] = Math.round(acc[k] / (SS * SS));
      buf[o + 3] = 255;
    }
  }
  return buf;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = b => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(t));
  return Buffer.concat([len, t, sum]);
};
function png(size, opts) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(render(size, opts))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(out, { recursive: true });
writeFileSync(out + 'icon-192.png', png(192, { maskable: false }));
writeFileSync(out + 'icon-512.png', png(512, { maskable: false }));
writeFileSync(out + 'maskable-512.png', png(512, { maskable: true }));
