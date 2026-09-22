// Renders the pixel-art icon to PNG at several sizes.
// Pure Node — zlib is built in, so there is no image dependency.
//   node scripts/make-icons.mjs

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const OUT = resolve(import.meta.dirname, "../public");

// 16x16 pixel art: a CRT set showing a question mark.
//  . transparent   c chassis   d chassis shadow   s screen   p pink   a amber
const ART = `
................
..cccccccccccc..
..cccccccccccc..
..ccsssssssscc..
..ccssppppsscc..
..ccsppssppscc..
..ccssssppsscc..
..ccsssppssscc..
..ccsssppssscc..
..ccsssssssscc..
..ccsssppssscc..
..cccccccccccc..
..cddddddddadc..
...c........c...
................
................
`.trim().split("\n").map((r) => r.padEnd(16, ".").slice(0, 16));

const PALETTE = {
  ".": [0, 0, 0, 0],
  c: [0x8d, 0x81, 0x70, 255], // chassis highlight
  d: [0x3f, 0x38, 0x2e, 255], // chassis shadow
  s: [0x0b, 0x10, 0x30, 255], // screen navy
  p: [0xff, 0x2e, 0x88, 255], // hot pink
  a: [0xff, 0xc9, 0x3c, 255], // amber
};

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const scale = size / 16;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const ch = ART[Math.floor(y / scale)][Math.floor(x / scale)];
      const [r, g, b, a] = PALETTE[ch] || PALETTE["."];
      raw[o++] = r; raw[o++] = g; raw[o++] = b; raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ["favicon-32.png", 32],
  ["apple-touch-icon.png", 180],
  ["icon-512.png", 512],
]) {
  const buf = png(size);
  writeFileSync(resolve(OUT, name), buf);
  console.log(`  ${name.padEnd(22)} ${size}x${size}  ${buf.length} bytes`);
}
