/**
 * How many cells an auto-accept threshold takes off the review list.
 *
 * The instrument for moving `AUTO_ACCEPT` in src/lib/prefill.ts, and the
 * counterpart to `gate-coverage.mjs`. That script answers how many boxes get
 * FILLED; this one answers how many stop being SHOWN, which is the more
 * expensive question -- a pre-fill the reviewer can see is a claim they can
 * refuse, and an auto-accepted cell is a number that reaches the chapter's
 * spreadsheet with nobody having looked at the handwriting.
 *
 * It deliberately does not say whether those readings are RIGHT. For that use
 * `audit-prefills.mjs`, which renders each filled cell to be counted by eye,
 * and the digit precision table in HANDOFF.md. Read the two together: this
 * script's "hidden" column times that table's error rate is the number of
 * wrong values a scan ships unseen.
 *
 * Usage:
 *   npx vite-node scripts/autoaccept-coverage.mjs -- test-long pacific-3.22
 *
 * Takes directory names under out/pages, or paths. The source breakdown is the
 * point: "agreed" and "tally" are the readers measured in the nineties,
 * "digits" is the one measured at 86% at its most confident, and a threshold
 * that hides the third is not the same decision as one that hides the first
 * two.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { cellsForSide } from "../src/lib/extract";
import { decodeModel } from "../src/lib/digits";
import { reconcile } from "../src/lib/reading.ts";
import { pairIntoCards, referenceTargets, registerAgainstBestSide } from "../src/lib/register";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
const luma = (rgba, n) => {
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  return out;
};
const decodeJpeg = (p) => { const { width, height, data } = jpeg.decode(readFileSync(p), { useTArray: true, formatAsRGBA: true }); return { width, height, data: luma(data, width * height) }; };
const decodePng = (p) => { const g = PNG.sync.read(readFileSync(p)); return { width: g.width, height: g.height, data: luma(g.data, g.width * g.height) }; };

const maps = { front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")), back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")) };
const targets = referenceTargets({ front: decodePng(join(REF, "blank-front.png")), back: decodePng(join(REF, "blank-back.png")) }, maps);
const model = decodeModel(JSON.parse(readFileSync(join(REF, "digit-model.json"), "utf8")));

const THRESHOLDS = [0.99, 0.9, 0.86, 0.8, 0.75, 0.7, 0.6];

for (const arg of process.argv.slice(2)) {
  const dir = existsSync(arg) ? arg : join(ROOT, "out", "pages", arg);
  const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));

  const pages = files.map((f, i) => {
    const r = registerAgainstBestSide(decodeJpeg(join(dir, f)), targets, i + 1);
    return { pageNumber: i + 1, side: r.side, trusted: r.trusted, bannerOverlap: r.bannerOverlap,
             cells: r.trusted ? cellsForSide(r.image, i + 1, maps[r.side], r.side, model) : [] };
  });
  const { cards } = pairIntoCards(pages);

  let total = 0;
  const readings = [];
  for (const card of cards) {
    for (const side of ["front", "back"]) {
      for (const c of (card[side]?.cells ?? [])) {
        total++;
        const r = reconcile(
          c.tallyCount === null ? null : { value: c.tallyCount, confidence: c.tallyConfidence },
          c.digitValue === null ? null : { value: c.digitValue, confidence: c.digitConfidence },
        );
        if (r) readings.push(r);
      }
    }
  }

  console.log(`\n${arg}: ${cards.length} cards, ${total} cells, ${readings.length} readings offered`);
  console.log("thresh   hidden   of cells   left to check   by source");
  for (const t of THRESHOLDS) {
    const hid = readings.filter((r) => r.confidence >= t);
    const by = {};
    for (const r of hid) by[r.source] = (by[r.source] ?? 0) + 1;
    const parts = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
    console.log(`${t.toFixed(2)}    ${String(hid.length).padStart(5)}    ${((hid.length / total) * 100).toFixed(1).padStart(5)}%    ${String(total - hid.length).padStart(9)}   ${parts}`);
  }
}
