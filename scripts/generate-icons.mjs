// HASHI application icons. Regenerate with: node scripts/generate-icons.mjs
// Only Node.js built-ins are required; all icons have an opaque background.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outputDirectory = new URL('../public/icons/', import.meta.url);
const colors = {
  background: [28, 41, 41],
  border: [54, 72, 68],
  green: [198, 238, 158],
  shade: [157, 199, 124],
};

const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function insideRoundedRectangle(x, y, left, top, right, bottom, radius) {
  const dx = Math.max(left + radius - x, 0, x - right + radius);
  const dy = Math.max(top + radius - y, 0, y - bottom + radius);
  return dx * dx + dy * dy <= radius * radius;
}

function sample(x, y, maskable) {
  // Both icon variants keep the H inside the central 52% of the canvas,
  // comfortably inside Android's circular maskable safe area.
  const leftPost = insideRoundedRectangle(x, y, 0.24, 0.24, 0.36, 0.76, 0.024);
  const rightPost = insideRoundedRectangle(x, y, 0.64, 0.24, 0.76, 0.76, 0.024);
  const bridge = insideRoundedRectangle(x, y, 0.30, 0.44, 0.70, 0.56, 0.014);
  if (leftPost || rightPost) return colors.green;
  if (bridge) return y > 0.535 ? colors.shade : colors.green;

  // A restrained frame echoes the machine's cabinet. The maskable variant
  // omits it because operating systems may crop the icon into any shape.
  if (!maskable) {
    const outer = insideRoundedRectangle(x, y, 0.09, 0.09, 0.91, 0.91, 0.14);
    const inner = insideRoundedRectangle(x, y, 0.095, 0.095, 0.905, 0.905, 0.135);
    if (outer && !inner) return colors.border;
  }
  return colors.background;
}

function createPng(size, maskable = false) {
  const samplesPerAxis = 4;
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    scanlines[offset++] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      const total = [0, 0, 0];
      for (let sy = 0; sy < samplesPerAxis; sy++) {
        for (let sx = 0; sx < samplesPerAxis; sx++) {
          const color = sample(
            (x + (sx + 0.5) / samplesPerAxis) / size,
            (y + (sy + 0.5) / samplesPerAxis) / size,
            maskable,
          );
          for (let channel = 0; channel < 3; channel++) total[channel] += color[channel];
        }
      }
      for (const channel of total) scanlines[offset++] = Math.round(channel / 16);
      scanlines[offset++] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outputDirectory, { recursive: true });
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]) {
  const file = new URL(name, outputDirectory);
  const png = createPng(size, maskable);
  await writeFile(file, png);
  console.log(`${fileURLToPath(file)} (${size} × ${size}, ${png.length} bytes)`);
}
