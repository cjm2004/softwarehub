import { deflateSync } from "node:zlib";
import { writeFile, mkdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return output;
}

function makeIcon(size) {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const radius = size * 0.18;
      const insideRound = (x >= radius && x < size - radius) || (y >= radius && y < size - radius) ||
        Math.hypot(x - radius, y - radius) <= radius || Math.hypot(x - (size - radius - 1), y - radius) <= radius ||
        Math.hypot(x - radius, y - (size - radius - 1)) <= radius || Math.hypot(x - (size - radius - 1), y - (size - radius - 1)) <= radius;
      let color = insideRound ? [228, 73, 63, 255] : [0, 0, 0, 0];
      const shelf = x > size * 0.25 && x < size * 0.75 && y > size * 0.24 && y < size * 0.68;
      const gap = y > size * 0.38 && y < size * 0.46;
      const label = x > size * 0.36 && x < size * 0.64 && y > size * 0.52 && y < size * 0.59;
      if (shelf && !gap) color = [255, 255, 255, 255];
      if (label) color = [228, 73, 63, 255];
      const offset = 1 + x * 4;
      row.set(color, offset);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const imageDir = join(root, "fpk", "app", "ui", "images");
await mkdir(imageDir, { recursive: true });
await writeFile(join(root, "fpk", "ICON.PNG"), makeIcon(64));
await writeFile(join(root, "fpk", "ICON_256.PNG"), makeIcon(256));
await copyFile(join(root, "fpk", "ICON.PNG"), join(imageDir, "icon-64.png"));
await copyFile(join(root, "fpk", "ICON_256.PNG"), join(imageDir, "icon-256.png"));
