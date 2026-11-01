'use strict';
// Generates the app icons (PNG for the PWA, ICO for the desktop shortcut)
// without external dependencies: a tiny rasterizer + PNG/ICO encoders.
//   node tools/make-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

const BG = [0x11, 0x13, 0x17];
const PANEL = [0x1e, 0x22, 0x28];
const TRACK = [0x08, 0x09, 0x0b];
const ACCENT = [0x3f, 0xb6, 0xff];
const CAP = [0xe6, 0xe8, 0xeb];

// Draw at 4x and box-filter down for anti-aliasing.
function render(size, { maskable = false } = {}) {
  const S = size * 4;
  const px = new Float32Array(S * S * 4);
  const put = (x, y, c, a = 1) => {
    const i = (y * S + x) * 4;
    px[i] = px[i] * (1 - a) + c[0] * a; px[i + 1] = px[i + 1] * (1 - a) + c[1] * a; px[i + 2] = px[i + 2] * (1 - a) + c[2] * a; px[i + 3] = Math.max(px[i + 3], a * 255);
  };
  const rrect = (x0, y0, x1, y1, r, c) => {
    for (let y = Math.max(0, y0 | 0); y < Math.min(S, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(S, x1); x++) {
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r)), dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      if (dx * dx + dy * dy <= r * r) put(x, y, c);
    }
  };
  const u = S / 64; // design grid: 64 units
  if (maskable) rrect(0, 0, S, S, 0, BG); else rrect(0, 0, S, S, 13 * u, BG);
  const pad = maskable ? 5 * u : 0; // keep content inside the maskable safe zone
  const g = (v) => pad + v * (S - 2 * pad) / S * u;
  rrect(g(8), g(10), g(56), g(54), 6 * u * (1 - pad / S * 2), PANEL);
  const faders = [[18, 0.62], [32, 0.3], [46, 0.48]];
  for (const [cx, pos] of faders) {
    rrect(g(cx - 1.5), g(16), g(cx + 1.5), g(48), 1.5 * u, TRACK);
    const capY = 16 + pos * 26;
    rrect(g(cx - 1.5), g(capY + 3), g(cx + 1.5), g(48), 1.5 * u, ACCENT);
    rrect(g(cx - 6), g(capY), g(cx + 6), g(capY + 6), 2 * u, CAP);
  }
  // downsample
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) { const i = ((y * 4 + sy) * S + x * 4 + sx) * 4; for (let k = 0; k < 4; k++) acc[k] += px[i + k]; }
    for (let k = 0; k < 4; k++) out[(y * size + x) * 4 + k] = Math.round(acc[k] / 16);
  }
  return out;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ICO with embedded PNG images (supported since Windows Vista).
function ico(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const dir = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12); offset += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images.map(i => i.data)]);
}

for (const s of [192, 512]) fs.writeFileSync(path.join(OUT, `icon-${s}.png`), png(s, render(s)));
fs.writeFileSync(path.join(OUT, 'maskable-512.png'), png(512, render(512, { maskable: true })));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), png(180, render(180, { maskable: true })));
fs.writeFileSync(path.join(OUT, 'favicon-32.png'), png(32, render(32)));
fs.writeFileSync(path.join(OUT, 'app.ico'), ico([16, 32, 48, 256].map(s => ({ size: s, data: png(s, render(s)) }))));
console.log('icons written to', OUT);
