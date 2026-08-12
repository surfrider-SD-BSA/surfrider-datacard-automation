/**
 * Extract every written-in TOTAL box from a scanned event, and segment each
 * into individual digit images.
 *
 * This is the offline half of recognition: it produces the training material
 * and the contact sheets used to check that segmentation actually works before
 * anything is built on top of it. The plan flags segmentation as the real risk
 * -- the card's TOTAL cells are open boxes with free-written numbers, not
 * per-digit combs -- so it gets looked at directly rather than assumed.
 *
 * Usage:
 *   node scripts/extract-crops.mjs <dir-of-page-jpegs> [--limit N]
 *
 * Writes to out/crops/:
 *   cells.json         one record per written cell (card, row, item, page)
 *   digits.json        one record per segmented digit, keyed to its cell
 *   contact-cells-N.png    grids of whole TOTAL boxes
 *   contact-digits-N.png   grids of segmented digits
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { itemForRow } from "../src/lib/taxonomy.ts";
import {
  cropCell,
  decodeGray,
  inkFraction,
  loadPng,
  normalizeDigit,
  referenceTarget,
  registerBestSide,
  segmentDigits,
} from "./lib/cardvision.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
const OUT = join(ROOT, "out", "crops");

/** Ink coverage above which a TOTAL box counts as written in. */
const INK_PRESENT = 0.025;

// ---------------------------------------------------------------------------
// Contact sheets
// ---------------------------------------------------------------------------

function writeContactSheet(path, tiles, cols, tileW, tileH, labels) {
  const rows = Math.ceil(tiles.length / cols);
  const pad = 3;
  const labelH = 11;
  const cellW = tileW + pad * 2;
  const cellH = tileH + pad * 2 + labelH;
  const png = new PNG({ width: cols * cellW, height: rows * cellH });

  png.data.fill(235);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;

  const put = (x, y, v) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const p = (y * png.width + x) * 4;
    png.data[p] = png.data[p + 1] = png.data[p + 2] = v;
  };

  // 3x5 digit font for the tile index, so a label in a contact sheet can be
  // matched back to its record.
  const FONT = {
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
  };

  tiles.forEach((tile, i) => {
    const cx = (i % cols) * cellW + pad;
    const cy = Math.floor(i / cols) * cellH + pad;

    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        const sx = Math.floor((x * tile.width) / tileW);
        const sy = Math.floor((y * tile.height) / tileH);
        put(cx + x, cy + y, tile.gray[sy * tile.width + sx]);
      }
    }

    const text = String(labels[i]);
    let tx = cx;
    for (const ch of text) {
      const glyph = FONT[ch];
      if (glyph) {
        for (let gy = 0; gy < 5; gy++) {
          for (let gx = 0; gx < 3; gx++) {
            if (glyph[gy][gx] === "1") put(tx + gx, cy + tileH + 3 + gy, 0);
          }
        }
      }
      tx += 4;
    }
  });

  writeFileSync(path, PNG.sync.write(png));
}

// ---------------------------------------------------------------------------

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/extract-crops.mjs <dir-of-page-jpegs>");
    process.exit(1);
  }
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const maps = {
    front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")),
    back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")),
  };
  const targets = {
    front: referenceTarget(loadPng(join(REF, "blank-front.png")), maps.front),
    back: referenceTarget(loadPng(join(REF, "blank-back.png")), maps.back),
  };

  const files = readdirSync(dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0))
    .slice(0, limit);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const cellRecords = [];
  const digitRecords = [];
  const cellTiles = [];
  const digitTiles = [];

  let cardNumber = 0;
  let refused = 0;

  files.forEach((f, pageIndex) => {
    const page = decodeGray(join(dir, f));
    const { side, image: registered, trusted, bannerOverlap } = registerBestSide(page, targets);
    if (side === "front") cardNumber += 1;

    // A page that would not align is not cropped from. Its crops would be
    // taken from the wrong part of the card, and as training material they
    // would teach the recognizer on pictures of section banners.
    if (!trusted) {
      refused++;
      console.log(`\n  page ${pageIndex + 1}: refused, banners match ${bannerOverlap.toFixed(2)}`);
      return;
    }

    const map = maps[side];

    for (const cell of map.cells) {
      const excluded = (map.exclusions || []).some(
        (ex) =>
          cell.total.x < ex.x + ex.width &&
          cell.total.x + cell.total.width > ex.x &&
          cell.total.y < ex.y + ex.height &&
          cell.total.y + cell.total.height > ex.y,
      );
      if (excluded) continue;

      const box = cropCell(registered, cell.total);
      const ink = inkFraction(box);
      if (ink < INK_PRESENT) continue;

      const boxes = segmentDigits(box);
      const cellId = cellRecords.length;

      cellRecords.push({
        id: cellId,
        card: cardNumber,
        page: pageIndex + 1,
        side,
        row: cell.row,
        item: itemForRow(cell.row)?.name ?? "?",
        ink: Number(ink.toFixed(4)),
        digitCount: boxes.length,
      });
      cellTiles.push(box);

      boxes.forEach((b, k) => {
        digitRecords.push({
          id: digitRecords.length,
          cellId,
          index: k,
          of: boxes.length,
          card: cardNumber,
          row: cell.row,
          bitmap: Array.from(normalizeDigit(box, b)),
        });
        digitTiles.push({
          width: 28,
          height: 28,
          gray: Uint8Array.from(normalizeDigit(box, b), (v) => 255 - v),
        });
      });
    }

    if ((pageIndex + 1) % 20 === 0) {
      process.stdout.write(`\r  ${pageIndex + 1}/${files.length} pages   `);
    }
  });
  process.stdout.write("\n");

  writeFileSync(join(OUT, "cells.json"), JSON.stringify(cellRecords, null, 1));
  writeFileSync(join(OUT, "digits.json"), JSON.stringify(digitRecords));

  const PER_SHEET = 240;
  for (let i = 0; i < cellTiles.length; i += PER_SHEET) {
    const slice = cellTiles.slice(i, i + PER_SHEET);
    writeContactSheet(
      join(OUT, `contact-cells-${String(i / PER_SHEET).padStart(2, "0")}.png`),
      slice, 12, 100, 58,
      slice.map((_, k) => i + k),
    );
  }
  for (let i = 0; i < digitTiles.length; i += PER_SHEET) {
    const slice = digitTiles.slice(i, i + PER_SHEET);
    writeContactSheet(
      join(OUT, `contact-digits-${String(i / PER_SHEET).padStart(2, "0")}.png`),
      slice, 20, 42, 42,
      slice.map((_, k) => i + k),
    );
  }

  const counts = {};
  for (const c of cellRecords) counts[c.digitCount] = (counts[c.digitCount] || 0) + 1;

  console.log(`\ncards: ${cardNumber}`);
  console.log(`pages refused by registration: ${refused}`);
  console.log(`written cells: ${cellRecords.length}`);
  console.log(`segmented digits: ${digitRecords.length}`);
  console.log("digits per cell:");
  for (const k of Object.keys(counts).sort((a, b) => a - b)) {
    console.log(`  ${k}: ${counts[k]}`);
  }
  console.log(`\nwrote ${OUT}`);
}

main();
