/**
 * Score the tally counter against every value the chapter ever typed up.
 *
 * The counter reads a strip of pencil strokes and returns a number, and the
 * chapter's own datasheets hold a number for the same cell, keyed card N to
 * column N. That makes 28 matched spreadsheets into a labelled set nobody had
 * to sit and produce -- which is the only way to measure this at a scale where
 * a precision figure means anything, since counting a thousand tallies by eye
 * is a week of somebody's life.
 *
 * READ THE DISAGREEMENTS BEFORE BELIEVING THEM. This is the trap the project
 * keeps falling into and it applies here exactly as it does to the review list:
 * a value in a spreadsheet is not proof of what is on the card. Across 28
 * sheets, 5,798 of 9,526 typed values sit on cells that are blank on the card --
 * a number worked out on the other side, entered against the wrong item, or a
 * column typed one across. Every one of those looks like the counter being
 * wrong and is not. So the figure this prints is a LOWER BOUND on precision,
 * `--show` renders the disagreements, and the number to quote is the one that
 * survives looking at them.
 *
 * Usage:
 *   npx vite-node scripts/diagnose-tally-sheets.mjs -- [--show] [--only <name>]
 */

import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { itemForRow } from "../src/lib/taxonomy.ts";
import { countTally } from "../src/lib/tally.ts";
import { colName, contactSheet, matchedPairs, readSpreadsheet, scan } from "./diagnose-review.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The shape of a reading, which is what its trustworthiness turns on.
 *
 * The first version of this split on whether the tally had crossbars, on the
 * theory that a group of five checks its own arithmetic. Measured, that theory
 * is wrong -- crossed groups score WORSE -- and the reason is worth keeping:
 * a crossbar means the volunteer counted past five, and a tally past five is
 * the one that runs out of room. The failures read "said 5, sheet 19": the
 * strip holds the first group and the rest of the tally is somewhere else.
 *
 * So the split that matters is how much was counted and whether every pixel was
 * accounted for, not what the strokes were arranged into.
 */
function shapeOf(r) {
  const size = r.count <= 4 ? `count ${r.count}` : r.count <= 9 ? "count 5-9" : "count 10+";
  return `${size}, ${r.explained >= 0.95 ? "fully explained" : "some ink over"}`;
}

function report(pair, show) {
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
      typed.set(`${card}:${row}`, n);
    }
  }

  const stats = {
    buckets: new Map(),
    strips: 0,
    answered: 0,
    scored: 0,
    agree: 0,
    disagree: 0,
    tallyOnlyScored: 0,
    tallyOnlyAgree: 0,
  };
  const wrong = [];
  // Precision is not one number. A tally made of complete crossed fives checks
  // itself -- every group but the last has to hold exactly five, and a missed
  // stroke or a missed crossbar breaks that -- where a bare run of two or three
  // uprights has nothing to check it against. Bucketing by the SHAPE of the
  // answer is how the gate gets chosen on evidence rather than by feel.
  const buckets = stats.buckets;

  for (const c of s.cells) {
    // The counter only ever sees a strip the mark test says holds a tally.
    // Running it on the rest is not a harder test, it is the wrong one: those
    // strips are blank, the number lives in the TOTAL box beside them, and a
    // count of nothing scored against that number measures neither.
    if (!c.tallyMarked) continue;
    const reading = countTally(
      { width: c.tally.width, height: c.tally.height, data: c.tally.gray },
      {
        context: { width: c.tallyCtx.width, height: c.tallyCtx.height, data: c.tallyCtx.gray },
      },
    );
    if (reading.count === null) continue;
    stats.strips++;
    stats.answered++;

    const truth = typed.get(`${c.card}:${c.row}`);
    if (truth === undefined) continue;
    stats.scored++;
    const tallyOnly = !c.hasValue;
    if (tallyOnly) stats.tallyOnlyScored++;
    const key = shapeOf(reading);
    const b = buckets.get(key) ?? { n: 0, right: 0 };
    b.n++;
    buckets.set(key, b);

    if (reading.count === truth) {
      b.right++;
      stats.agree++;
      if (tallyOnly) stats.tallyOnlyAgree++;
    } else {
      stats.disagree++;
      wrong.push({ ...c, said: reading.count, truth });
    }
  }

  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");
  console.log(
    `${pair.name.padEnd(16)} answered ${String(stats.answered).padStart(4)}   ` +
      `scored ${String(stats.scored).padStart(4)}   ` +
      `agree ${pct(stats.agree, stats.scored).padStart(6)}   ` +
      `tally-only ${pct(stats.tallyOnlyAgree, stats.tallyOnlyScored).padStart(6)} ` +
      `of ${stats.tallyOnlyScored}`,
  );
  if (wrong.length) {
    console.log(
      `    disagreed: ${wrong
        .slice(0, 14)
        .map((w) => `${w.card}:${w.row} said ${w.said} sheet ${w.truth}`)
        .join(", ")}`,
    );
  }

  if (show && wrong.length) {
    const out = join(ROOT, "out", "review", pair.name);
    mkdirSync(out, { recursive: true });
    const PER = 24;
    for (let i = 0; i < wrong.length; i += PER) {
      const path = join(out, `tally-disagreed-${String(i / PER).padStart(2, "0")}.png`);
      contactSheet(path, wrong.slice(i, i + PER));
      console.log(`  wrote ${path}`);
    }
  }
  return stats;
}

function main() {
  const args = process.argv.slice(2);
  const show = args.includes("--show");
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const pairs = matchedPairs().filter((p) => !only || p.name === only);

  console.log(`${pairs.length} matched (scan, spreadsheet) pairs\n`);
  const totals = { answered: 0, scored: 0, agree: 0, tallyOnlyScored: 0, tallyOnlyAgree: 0 };
  const buckets = new Map();
  for (const p of pairs) {
    const s = report(p, show);
    for (const k of Object.keys(totals)) totals[k] += s[k];
    for (const [key, b] of s.buckets) {
      const t = buckets.get(key) ?? { n: 0, right: 0 };
      t.n += b.n;
      t.right += b.right;
      buckets.set(key, t);
    }
  }
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");
  console.log(
    `\nall scans: answered ${totals.answered}, of which ${totals.scored} have a typed value` +
      `\n  agreement ${pct(totals.agree, totals.scored)}` +
      `  (tally-only cells: ${pct(totals.tallyOnlyAgree, totals.tallyOnlyScored)} of ${totals.tallyOnlyScored})` +
      `\n  read the disagreements before treating this as a precision figure.`,
  );
  console.log("\nby the shape of the answer:");
  for (const [key, b] of [...buckets].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${key.padEnd(24)} ${String(b.n).padStart(4)}   ${pct(b.right, b.n)}`);
  }
}

main();
