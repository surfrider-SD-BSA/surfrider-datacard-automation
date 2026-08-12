/**
 * Report how every page of a scan registers, and show it.
 *
 * Registration is the step whose failures are invisible downstream: a
 * misregistered page yields ordinary-looking numbers attached to the wrong
 * debris items. So there are two outputs here, and the second one matters most.
 *
 *   the table    per page: which side, the fitted scale and offset per axis,
 *                and the alignment score the page is accepted or refused on
 *   the overlay  the registered page with every TOTAL box drawn on it, which
 *                is the only way to confirm the boxes land where the numbers
 *                are rather than on a row boundary or a section banner
 *
 * Usage:
 *   node scripts/diagnose-registration.mjs <dir-of-page-jpegs> [--limit N] [--overlay 1,2,7]
 */

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import {
  MIN_BANNER_OVERLAP,
  referenceTarget,
  decodeGray,
  inkFraction,
  cropCell,
  loadPng,
  registerBestSide,
} from "./lib/cardvision.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
const OUT = join(ROOT, "out", "registration");

/** Ink coverage above which a TOTAL box counts as written in. */
const INK_PRESENT = 0.025;

function drawBox(png, r, [red, green, blue]) {
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const p = (y * png.width + x) * 4;
    png.data[p] = red;
    png.data[p + 1] = green;
    png.data[p + 2] = blue;
    png.data[p + 3] = 255;
  };
  const x1 = Math.round(r.x + r.width);
  const y1 = Math.round(r.y + r.height);
  for (let x = Math.round(r.x); x <= x1; x++) {
    put(x, Math.round(r.y));
    put(x, y1);
  }
  for (let y = Math.round(r.y); y <= y1; y++) {
    put(Math.round(r.x), y);
    put(x1, y);
  }
}

function writeOverlay(path, image, map) {
  const png = new PNG({ width: image.width, height: image.height });
  for (let i = 0; i < image.gray.length; i++) {
    const v = image.gray[i];
    png.data[i * 4] = v;
    png.data[i * 4 + 1] = v;
    png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  for (const cell of map.cells) {
    const ink = inkFraction(cropCell(image, cell.total));
    // Red for a box the tool would read a number from, blue for an empty one.
    drawBox(png, cell.total, ink >= INK_PRESENT ? [220, 30, 30] : [60, 110, 220]);
  }
  writeFileSync(path, PNG.sync.write(png));
}

function main() {
  const args = process.argv.slice(2);
  const dir = args[0];
  if (!dir) {
    console.error("usage: node scripts/diagnose-registration.mjs <dir-of-page-jpegs> [--limit N] [--overlay 1,2]");
    process.exit(1);
  }
  const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
  const overlay = args.includes("--overlay")
    ? new Set(args[args.indexOf("--overlay") + 1].split(",").map(Number))
    : new Set();

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

  if (overlay.size) mkdirSync(OUT, { recursive: true });

  const scores = [];
  let refused = 0;
  let reassigned = 0;

  files.forEach((f, i) => {
    const page = decodeGray(join(dir, f));
    const r = registerBestSide(page, targets);
    scores.push(r.bannerOverlap);
    if (!r.trusted) refused++;
    if (!r.classifierAgreed) reassigned++;

    // A correctly registered card shows a handful of inked TOTAL boxes. Twenty
    // is the signature of a page cropped off the grid: the boxes have landed on
    // captions and section banners, which are inked on every card.
    const inked = maps[r.side].cells.filter(
      (c) => inkFraction(cropCell(r.image, c.total)) >= INK_PRESENT,
    ).length;

    console.log(
      `${f.padEnd(13)} ${String(page.width).padStart(4)}x${String(page.height).padEnd(4)} ` +
        `${r.side.padEnd(5)} ` +
        `y ${r.transform.y.scale.toFixed(4)}/${String(Math.round(r.transform.y.offset)).padStart(4)}  ` +
        `x ${r.transform.x.scale.toFixed(4)}/${String(Math.round(r.transform.x.offset)).padStart(4)}  ` +
        `banners ${r.bannerOverlap.toFixed(3)}${r.trusted ? "" : "  REFUSED"}  ` +
        `${String(inked).padStart(2)} inked`,
    );

    if (overlay.has(i + 1)) {
      const path = join(OUT, `overlay-${String(i + 1).padStart(3, "0")}-${r.side}.png`);
      writeOverlay(path, r.image, maps[r.side]);
      console.log(`   wrote ${path}`);
    }
  });

  scores.sort((a, b) => a - b);
  const pct = (q) => scores[Math.min(scores.length - 1, Math.floor(scores.length * q))].toFixed(3);
  console.log(
    `\n${files.length} pages: banner overlap min ${pct(0)}, 10th ${pct(0.1)}, median ${pct(0.5)}, max ${pct(0.999)}\n` +
      `${refused} refused (below ${MIN_BANNER_OVERLAP}), ` +
      `${reassigned} where the banner/footer classifier disagreed with itself`,
  );
}

main();
