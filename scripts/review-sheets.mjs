/**
 * Render cells from a review cache so they can be LOOKED AT.
 *
 * Every wrong answer this project has recorded about the review list came from
 * measuring it instead of seeing it: an ink threshold was used as ground truth
 * for "a volunteer wrote here", faint pencil does not clear it, and the
 * conclusion was confidently backwards. So any claim about which cells are
 * noise gets settled here, by eye, against rendered pixels.
 *
 * Usage:
 *   node scripts/review-sheets.mjs <name> [options]
 *
 *   --ids 1,2,3        render exactly these cell ids
 *   --ids-file f       one id per line
 *   --sort ink|tally|id
 *   --limit N          first N after sorting
 *   --skip N
 *   --region total|tally|row   which pixels to show (default total)
 *   --cols N           tiles per row
 *   --scale N          pixel magnification (default 2 for total, 1 for tally/row)
 *   --tag s            filename suffix, so sheets from different runs coexist
 *
 * Each tile is captioned with the cell's id, which is what an eye-labelling is
 * recorded against: ids are stable for a given cache, and the cache is stable
 * because registration ran once into it.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadCache(name) {
  const dir = join(ROOT, "out", "review", name);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const bin = readFileSync(join(dir, "crops.bin"));
  const view = (r, which) => {
    const g = r[which];
    return { width: g.w, height: g.h, gray: bin.subarray(g.off, g.off + g.w * g.h) };
  };
  return { dir, manifest, cells: manifest.cells, total: (r) => view(r, "total"), tally: (r) => view(r, "tally") };
}

// 3x5 font, enough for the id captions.
const FONT = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  ".": ["000", "000", "000", "000", "010"], "-": ["000", "000", "111", "000", "000"],
  " ": ["000", "000", "000", "000", "000"],
};

export function sheet(path, tiles, cols, scale, labels) {
  const tileW = Math.max(...tiles.map((t) => t.width)) * scale;
  const tileH = Math.max(...tiles.map((t) => t.height)) * scale;
  const pad = 4;
  const labelH = 12;
  const cellW = tileW + pad * 2;
  const cellH = tileH + pad * 2 + labelH;
  const rows = Math.ceil(tiles.length / cols);
  const png = new PNG({ width: cols * cellW, height: rows * cellH });

  // Mid grey ground so a tile's own white edge is visible against it.
  png.data.fill(160);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;

  const put = (x, y, v) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const p = (y * png.width + x) * 4;
    png.data[p] = png.data[p + 1] = png.data[p + 2] = v;
  };

  tiles.forEach((tile, i) => {
    const cx = (i % cols) * cellW + pad;
    const cy = Math.floor(i / cols) * cellH + pad;
    for (let y = 0; y < tile.height * scale; y++) {
      for (let x = 0; x < tile.width * scale; x++) {
        put(cx + x, cy + y, tile.gray[Math.floor(y / scale) * tile.width + Math.floor(x / scale)]);
      }
    }
    let tx = cx;
    for (const ch of String(labels[i])) {
      const glyph = FONT[ch];
      if (glyph) {
        for (let gy = 0; gy < 5; gy++) {
          for (let gx = 0; gx < 3; gx++) {
            if (glyph[gy][gx] === "1") {
              put(tx + gx * 2, cy + tile.height * scale + 4 + gy * 2, 0);
              put(tx + gx * 2 + 1, cy + tile.height * scale + 4 + gy * 2, 0);
              put(tx + gx * 2, cy + tile.height * scale + 5 + gy * 2, 0);
              put(tx + gx * 2 + 1, cy + tile.height * scale + 5 + gy * 2, 0);
            }
          }
        }
      }
      tx += 8;
    }
  });

  writeFileSync(path, PNG.sync.write(png));
  return { width: png.width, height: png.height };
}

/** Tally strip and TOTAL box side by side: the row as the reviewer sees it. */
export function rowTile(cache, r) {
  const t = cache.tally(r);
  const b = cache.total(r);
  const gap = 6;
  const width = t.width + gap + b.width;
  const height = Math.max(t.height, b.height);
  const gray = new Uint8Array(width * height).fill(120);
  for (let y = 0; y < t.height; y++)
    for (let x = 0; x < t.width; x++) gray[y * width + x] = t.gray[y * t.width + x];
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) gray[y * width + t.width + gap + x] = b.gray[y * b.width + x];
  return { width, height, gray };
}

function main() {
  const args = process.argv.slice(2);
  const name = args[0];
  if (!name) {
    console.error("usage: node scripts/review-sheets.mjs <name> [--ids ...] [--region total|tally|row]");
    process.exit(1);
  }
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const region = opt("--region", "total");
  const cols = Number(opt("--cols", region === "total" ? 8 : 2));
  const scale = Number(opt("--scale", region === "total" ? 2 : 1));
  const tag = opt("--tag", region);

  const cache = loadCache(name);
  let cells = cache.cells;

  if (args.includes("--ids")) {
    const want = new Set(opt("--ids", "").split(",").map(Number));
    cells = cells.filter((c) => want.has(c.id));
  }
  if (args.includes("--ids-file")) {
    const want = new Set(
      readFileSync(opt("--ids-file"), "utf8").split(/\s+/).filter(Boolean).map(Number),
    );
    cells = cells.filter((c) => want.has(c.id));
  }
  const sort = opt("--sort", "id");
  if (sort === "ink") cells = cells.slice().sort((a, b) => a.ink - b.ink);
  if (sort === "tally") cells = cells.slice().sort((a, b) => a.tallyInk - b.tallyInk);

  const skip = Number(opt("--skip", 0));
  const limit = Number(opt("--limit", Infinity));
  cells = cells.slice(skip, skip + limit);

  const dir = join(cache.dir, "sheets");
  mkdirSync(dir, { recursive: true });

  const PER = Number(opt("--per", region === "total" ? 96 : 40));
  for (let i = 0; i < cells.length; i += PER) {
    const slice = cells.slice(i, i + PER);
    const tiles = slice.map((r) =>
      region === "total" ? cache.total(r) : region === "tally" ? cache.tally(r) : rowTile(cache, r),
    );
    const path = join(dir, `${tag}-${String(i / PER).padStart(2, "0")}.png`);
    const size = sheet(path, tiles, cols, scale, slice.map((r) => r.id));
    console.log(`${path}  ${size.width}x${size.height}  ids ${slice[0].id}..${slice[slice.length - 1].id}`);
  }
  console.log(`${cells.length} cells`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
