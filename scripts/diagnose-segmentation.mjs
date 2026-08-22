/**
 * How often is CUTTING the number into digits the thing that goes wrong?
 *
 * This has never been measured on its own, and the shape of the whole
 * recognizer depends on it. `train-digits.mjs` reports 83.5% of whole cells
 * right at its best gate, but that figure is conditional in a way that is easy
 * to miss: `label-from-spreadsheet.mjs` only emits a cell when segmentation
 * already found exactly as many digit boxes as the sheet's number has digits.
 * Every cell where the cutting went wrong was dropped before a single digit was
 * labelled, so the accuracy figures are measured on the subset where this step
 * had already succeeded.
 *
 * That matters because "2" and "21" are different numbers of debris. A cell cut
 * into the wrong number of pieces is wrong no matter how well each piece is
 * then read, and gating on classifier confidence cannot catch it -- the model
 * is perfectly confident about each of the two digits it was handed.
 *
 * Same warning as everywhere else here: a value in the spreadsheet is not proof
 * of what is on the card, so a mismatch is an UPPER BOUND on segmentation
 * failure, not a rate. `--show` renders them.
 *
 * Usage:
 *   npx vite-node scripts/diagnose-segmentation.mjs -- [--show] [--only <name>]
 *     [--kind none|over|under]   render only one kind of failure
 *
 * `--kind none` is the one worth looking at first. The cells where nothing is
 * found at all are the largest single bucket and the least explained: dropping
 * the ink threshold from 25 to 10 changes their number by exactly nothing, so
 * they are not faint pencil.
 */

import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { itemForRow } from "../src/lib/taxonomy.ts";
import { segmentDigits } from "./lib/cardvision.mjs";
import { colName, contactSheet, matchedPairs, readSpreadsheet, scan } from "./diagnose-review.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function report(pair, show, kind) {
  const s = scan(pair.dir);
  const sheet = readSpreadsheet(pair.sheet);

  const typed = new Map();
  for (let card = 1; card <= s.cards; card++) {
    const column = sheet.get(colName(2 + card));
    if (!column) continue;
    for (const [row, raw] of column) {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!itemForRow(row)) continue;
      typed.set(`${card}:${row}`, String(n));
    }
  }

  const stats = { cells: 0, right: 0, over: 0, under: 0, none: 0 };
  const wrong = [];

  for (const c of s.cells) {
    // Only cells the tool says hold a written number: a blank box with a value
    // in the spreadsheet is the other problem, and it is measured elsewhere.
    if (!c.hasValue) continue;
    const truth = typed.get(`${c.card}:${c.row}`);
    if (truth === undefined) continue;

    stats.cells++;
    const boxes = segmentDigits(c.total);
    if (boxes.length === truth.length) stats.right++;
    else {
      const which = boxes.length === 0 ? "none" : boxes.length > truth.length ? "over" : "under";
      stats[which]++;
      wrong.push({ ...c, boxes: boxes.length, truth, kind: which });
    }
  }

  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");
  console.log(
    `${pair.name.padEnd(16)} cells ${String(stats.cells).padStart(4)}   ` +
      `cut right ${pct(stats.right, stats.cells).padStart(6)}   ` +
      `too many ${String(stats.over).padStart(3)}  too few ${String(stats.under).padStart(3)}  ` +
      `none ${String(stats.none).padStart(3)}`,
  );

  const shown = kind ? wrong.filter((w) => w.kind === kind) : wrong;
  if (show && shown.length) {
    const out = join(ROOT, "out", "review", pair.name);
    mkdirSync(out, { recursive: true });
    const PER = 24;
    for (let i = 0; i < Math.min(shown.length, PER * 2); i += PER) {
      const path = join(out, `segmentation-${kind ?? "all"}-${String(i / PER).padStart(2, "0")}.png`);
      contactSheet(path, shown.slice(i, i + PER));
      console.log(`  wrote ${path}`);
    }
  }
  return stats;
}

function main() {
  const args = process.argv.slice(2);
  const show = args.includes("--show");
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const kind = args.includes("--kind") ? args[args.indexOf("--kind") + 1] : null;
  const pairs = matchedPairs().filter((p) => !only || p.name === only);

  console.log(`${pairs.length} matched (scan, spreadsheet) pairs\n`);
  const totals = { cells: 0, right: 0, over: 0, under: 0, none: 0 };
  for (const p of pairs) {
    const s = report(p, show, kind);
    for (const k of Object.keys(totals)) totals[k] += s[k];
  }
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");
  console.log(
    `\nall scans: ${totals.cells} written cells with a typed value` +
      `\n  cut into the right number of digits: ${pct(totals.right, totals.cells)}` +
      `\n  too many ${totals.over}, too few ${totals.under}, none at all ${totals.none}` +
      `\n  an upper bound on segmentation failure: read the renders before quoting it.`,
  );
}

main();
