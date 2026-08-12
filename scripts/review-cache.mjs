/**
 * Cache the review list of a scan, exactly as the app would offer it.
 *
 * The review list is what a human is asked to look at, and shortening it is
 * worth more to them than anything left in the recognizer. Every attempt to
 * shorten it has to be checked by LOOKING at the cells -- an ink threshold
 * standing in for "someone wrote here" has already produced one confident,
 * wrong answer, because faint pencil does not clear it.
 *
 * So this does the expensive half once: register every page, crop every cell
 * the app would offer, and write the pixels to disk. Filters are then measured
 * and rendered from the cache in a second or two, against the same pixels every
 * time, which is what makes an eye-labelling of those cells reusable.
 *
 * Usage:
 *   node scripts/review-cache.mjs <dir-of-page-jpegs> <name> [--limit N]
 *
 * Writes out/review/<name>/:
 *   manifest.json  one record per offered cell, with byte offsets into
 *   crops.bin      the TOTAL box and tally strip pixels, 8-bit gray
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { itemForRow } from "../src/lib/taxonomy.ts";
import {
  boxMarked,
  cropCell,
  decodeGray,
  inkFraction,
  loadPng,
  referenceTarget,
  registerBestSide,
  stripMarked,
} from "./lib/cardvision.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");

/** Mirrors INK_NEGLIGIBLE in src/lib/extract.ts: below this a cell is not offered. */
const INK_NEGLIGIBLE = 0.008;

function main() {
  const args = process.argv.slice(2);
  const [dir, name] = args;
  if (!dir || !name) {
    console.error("usage: node scripts/review-cache.mjs <dir-of-page-jpegs> <name> [--limit N]");
    process.exit(1);
  }
  const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

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

  const out = join(ROOT, "out", "review", name);
  mkdirSync(out, { recursive: true });

  const records = [];
  const chunks = [];
  let offset = 0;
  let cardNumber = 0;
  let refused = 0;
  let considered = 0;

  files.forEach((f, pageIndex) => {
    const page = decodeGray(join(dir, f));
    const { side, image: registered, trusted, bannerOverlap } = registerBestSide(page, targets);
    if (side === "front") cardNumber += 1;

    if (!trusted) {
      refused++;
      console.log(`\n  page ${pageIndex + 1}: refused, banners match ${bannerOverlap.toFixed(2)}`);
      return;
    }

    const map = maps[side];
    for (const cell of map.cells) {
      const item = itemForRow(cell.row);
      if (!item) continue;
      const excluded = (map.exclusions || []).some(
        (ex) =>
          cell.total.x < ex.x + ex.width &&
          cell.total.x + cell.total.width > ex.x &&
          cell.total.y < ex.y + ex.height &&
          cell.total.y + cell.total.height > ex.y,
      );
      if (excluded) continue;
      considered++;

      const total = cropCell(registered, cell.total);
      const tally = cropCell(registered, cell.tally);
      const ink = inkFraction(total);
      const tallyInk = inkFraction(tally);
      if (ink < INK_NEGLIGIBLE && tallyInk < INK_NEGLIGIBLE) continue;

      records.push({
        id: records.length,
        card: cardNumber,
        page: pageIndex + 1,
        side,
        row: cell.row,
        item: item.name,
        section: item.section,
        ink: Number(ink.toFixed(4)),
        tallyInk: Number(tallyInk.toFixed(4)),
        hasValue: boxMarked(total),
        tallyMarked: stripMarked(tally),
        total: { w: total.width, h: total.height, off: offset },
        tally: { w: tally.width, h: tally.height, off: offset + total.gray.length },
      });
      chunks.push(Buffer.from(total.gray), Buffer.from(tally.gray));
      offset += total.gray.length + tally.gray.length;
    }

    if ((pageIndex + 1) % 10 === 0) process.stdout.write(`\r  ${pageIndex + 1}/${files.length} pages   `);
  });
  process.stdout.write("\n");

  writeFileSync(join(out, "manifest.json"), JSON.stringify({ scan: name, dir, cards: cardNumber, considered, cells: records }));
  writeFileSync(join(out, "crops.bin"), Buffer.concat(chunks));

  const marked = records.filter((r) => r.hasValue || r.tallyMarked).length;
  console.log(`\ncards: ${cardNumber}   pages refused: ${refused}`);
  console.log(`cells considered: ${considered}`);
  console.log(`cells over the ink floor: ${records.length}  (${(records.length / cardNumber).toFixed(1)} per card)`);
  console.log(`  of those, the mark test would offer: ${marked}  (${(marked / cardNumber).toFixed(1)} per card)`);
  console.log(`wrote ${out}`);
}

main();
