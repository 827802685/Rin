// Extracts static cursor images (PNG) from Windows .ani cursor files.
// ANI is a RIFF container; each frame is a `LIST 'fram'` with `icon` chunks.
// Each icon chunk holds an ICO/CUR image. We render the first frame of each
// .ani file into a web-friendly PNG (RGBA, top-down).
//
// Usage: node scripts/extract-cursor.js <sourceDir> <outputDir>
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function pngEncode(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });

  const chunks = [];
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  chunks.push(pngChunk("IHDR", ihdr));
  chunks.push(pngChunk("IDAT", idat));
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function parseIcons(buf) {
  const icons = [];
  let p = 12;
  while (p < buf.length - 8) {
    const id = buf.slice(p, p + 4).toString("ascii");
    const size = buf.readUInt32LE(p + 4);
    if (id === "LIST") {
      const listType = buf.slice(p + 8, p + 12).toString("ascii");
      if (listType === "fram") {
        let q = p + 12;
        while (q < p + 8 + size) {
          const cid = buf.slice(q, q + 4).toString("ascii");
          const csize = buf.readUInt32LE(q + 4);
          if (cid === "icon") {
            icons.push(buf.slice(q + 8, q + 8 + csize));
          }
          q += 8 + csize + (csize % 2 ? 1 : 0);
        }
      }
    }
    p += 8 + size + (size % 2 ? 1 : 0);
  }
  return icons;
}

function parseIconImage(icon) {
  if (icon.length < 22) return null;
  const count = icon.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    if (e + 16 > icon.length) break;
    entries.push({
      width: icon[e] === 0 ? 256 : icon[e],
      height: icon[e + 1] === 0 ? 256 : icon[e + 1],
      bpp: icon.readUInt16LE(e + 6),
      bytesInRes: icon.readUInt32LE(e + 8),
      imageOffset: icon.readUInt32LE(e + 12),
    });
  }
  // Prefer the largest frame.
  entries.sort((a, b) => b.width * b.height - a.width * a.height);
  const entry = entries[0];
  if (!entry) return null;
  const img = icon.slice(entry.imageOffset, entry.imageOffset + entry.bytesInRes);
  if (img.length < 40) return null;
  const infoSize = img.readUInt32LE(0);
  const width = img.readInt32LE(4);
  const heightRaw = img.readInt32LE(8);
  const bpp = img.readUInt16LE(14);
  if (bpp !== 32 || infoSize < 40 || width <= 0 || heightRaw <= 0) return null;
  const height = Math.floor(Math.abs(heightRaw) / 2); // 32bpp ICO doubles height (color + AND mask)
  const dataOffset = infoSize;
  const rowBytes = width * 4;
  if (dataOffset + rowBytes * height > img.length) return null;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = dataOffset + (height - 1 - y) * rowBytes; // bottom-up BGRA
    const dstRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      rgba[d] = img[s + 2]; // R
      rgba[d + 1] = img[s + 1]; // G
      rgba[d + 2] = img[s]; // B
      rgba[d + 3] = img[s + 3]; // A
    }
  }
  return { width, height, rgba };
}

function main() {
  const [sourceDir, outputDir] = process.argv.slice(2);
  if (!sourceDir || !outputDir) {
    console.error("Usage: node scripts/extract-cursor.js <sourceDir> <outputDir>");
    process.exit(1);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs.readdirSync(sourceDir).filter((f) => f.toLowerCase().endsWith(".ani"));
  for (const file of files) {
    const buf = fs.readFileSync(path.join(sourceDir, file));
    const icons = parseIcons(buf);
    if (icons.length === 0) {
      console.warn(`  skip ${file}: no frames`);
      continue;
    }
    const image = parseIconImage(icons[0]);
    if (!image) {
      console.warn(`  skip ${file}: unsupported frame encoding`);
      continue;
    }
    const name = path.basename(file, ".ani").toLowerCase();
    const png = pngEncode(image.width, image.height, image.rgba);
    const out = path.join(outputDir, `${name}.png`);
    fs.writeFileSync(out, png);
    console.log(`  ${file} -> ${path.basename(out)} (${image.width}x${image.height}, ${png.length} bytes)`);
  }
}

main();
