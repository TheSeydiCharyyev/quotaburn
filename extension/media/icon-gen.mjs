// Generates media/icon.png (256x256) with zero dependencies: SDF-drawn flame
// on a dark rounded square, encoded as PNG via node:zlib. Deterministic —
// rerun any time, same bytes out.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 256;

// ---- colors ----
const BG = [0x16, 0x19, 0x1f];        // brand dark surface
const FLAME_TOP = [0xff, 0x8a, 0x3d]; // lighter orange at the tip
const FLAME_BOT = [0xe8, 0x59, 0x0c]; // brand accent at the base
const INNER = [0xff, 0xc2, 0x4d];     // warm core

// ---- SDFs (y grows downward, normalized units) ----
function sdRoundBox(px, py, half, r) {
  const qx = Math.abs(px) - half + r;
  const qy = Math.abs(py) - half + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

// capsule with different cap radii: cap r1 at origin, cap r2 at (0, -h) (pointing up)
function sdFlame(nx, ny, r1, r2, h) {
  const px = Math.abs(nx);
  const py = -ny; // up = positive toward the tip
  const b = (r1 - r2) / h;
  const a = Math.sqrt(1 - b * b);
  const k = px * -b + py * a;
  if (k < 0) return Math.hypot(px, py) - r1;
  if (k > a * h) return Math.hypot(px, py - h) - r2;
  return px * a + py * b - r1;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---- raster ----
const px = Buffer.alloc(W * W * 4);
const scale = W * 0.36;          // 1 normalized unit in pixels
const cx = W / 2;
const cy = W / 2 + 6;
const aa = (d) => clamp01(0.5 - (d * scale) / 1.6); // ~1.6px soft edge

for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    let r = 0, g = 0, b = 0, a = 0;

    // dark rounded square
    const dBox = sdRoundBox(x - W / 2 + 0.5, y - W / 2 + 0.5, W / 2 - 2, 52) / scale;
    const aBox = aa(dBox);
    if (aBox > 0) { r = BG[0]; g = BG[1]; b = BG[2]; a = aBox; }

    // normalized flame coords: body center at (0, 0.30), tip at (0, -0.72)
    const nx = (x - cx + 0.5) / scale;
    const ny = (y - cy + 0.5) / scale;

    const dOuter = sdFlame(nx, ny - 0.3, 0.46, 0.025, 1.04);
    const aOuter = aa(dOuter) * aBox;
    if (aOuter > 0) {
      const t = clamp01((ny + 0.74) / 1.5); // 0 at tip → 1 at base
      const fr = lerp(FLAME_TOP[0], FLAME_BOT[0], t);
      const fg = lerp(FLAME_TOP[1], FLAME_BOT[1], t);
      const fb = lerp(FLAME_TOP[2], FLAME_BOT[2], t);
      r = lerp(r, fr, aOuter); g = lerp(g, fg, aOuter); b = lerp(b, fb, aOuter);
    }

    const inx = nx / 0.52;
    const iny = (ny - 0.36) / 0.52;
    const dInner = sdFlame(inx, iny - 0.3, 0.46, 0.03, 1.04);
    const aInner = aa(dInner * 0.52) * aBox;
    if (aInner > 0) {
      r = lerp(r, INNER[0], aInner); g = lerp(g, INNER[1], aInner); b = lerp(b, INNER[2], aInner);
    }

    px[i] = Math.round(r); px[i + 1] = Math.round(g); px[i + 2] = Math.round(b);
    px[i + 3] = Math.round(a * 255);
  }
}

// ---- PNG encode ----
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(W, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA

const raw = Buffer.alloc(W * (W * 4 + 1));
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(dirname(fileURLToPath(import.meta.url)), 'icon.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes)`);
