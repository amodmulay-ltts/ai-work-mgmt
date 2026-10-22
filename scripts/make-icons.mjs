// Writes the Work Tracker icon into app/public: a vector SVG (icon.svg) and the PNG sizes the manifest uses.
// Both come from the same geometry below, so they match. Run after changing the design: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'app', 'public');

// Design on a 512 grid: a rounded blue square with a white W, flat, no gradients or shadows.
const BLUE = [0x1d, 0x4e, 0xd8]; // --primary in app.css
const WHITE = [0xff, 0xff, 0xff];
const SIZE = 512;
const RADIUS = 96;
const STROKE = 52;
const W_POINTS = [[120, 150], [186, 362], [256, 208], [326, 362], [392, 150]];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <title>Work Tracker</title>
  <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="#1D4ED8"/>
  <polyline points="${W_POINTS.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="#FFFFFF" stroke-width="${STROKE}" stroke-linejoin="round" stroke-linecap="round"/>
</svg>
`;
fs.writeFileSync(path.join(OUT, 'icon.svg'), svg);
console.log('wrote icon.svg');

// ---- rasterising the same geometry to PNG
const insideRoundedSquare = (x, y) => {
  const cx = Math.min(Math.max(x, RADIUS), SIZE - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), SIZE - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
};
const distToSegment = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const insideW = (x, y) => {
  let best = Infinity;
  for (let i = 0; i < W_POINTS.length - 1; i += 1) best = Math.min(best, distToSegment(x, y, W_POINTS[i], W_POINTS[i + 1]));
  return best <= STROKE / 2;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** RGBA PNG. Each pixel is averaged over a 4x4 grid of samples, so the edges are smooth. */
function iconPng(size) {
  const SAMPLES = 4;
  const scale = SIZE / size;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = (x + (sx + 0.5) / SAMPLES) * scale;
          const py = (y + (sy + 0.5) / SAMPLES) * scale;
          let colour = null;
          if (insideW(px, py)) colour = WHITE;
          else if (insideRoundedSquare(px, py)) colour = BLUE;
          if (colour) {
            r += colour[0];
            g += colour[1];
            b += colour[2];
            a += 255;
          }
        }
      }
      const n = SAMPLES * SAMPLES;
      const i = 1 + x * 4;
      if (a > 0) {
        row[i] = Math.round(r / (a / 255));
        row[i + 1] = Math.round(g / (a / 255));
        row[i + 2] = Math.round(b / (a / 255));
      }
      row[i + 3] = Math.round(a / n);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), iconPng(size));
  console.log(`wrote icon-${size}.png`);
}
