/**
 * Do the two readers agree, and does agreeing mean being right?
 *
 * The tool now has two independent ways to read the same cell. The TOTAL box
 * holds a number, which the digit recognizer reads at about 84% precision --
 * not good enough to pre-fill, because one wrong number in six invites
 * agreement and that is the failure the whole project is arranged around. The
 * tally strip beside it holds the same quantity written a completely different
 * way, which the counter in `src/lib/tally.ts` reads geometrically.
 *
 * They share no machinery and fail for unrelated reasons: the recognizer
 * confuses an 8 for a 1 because of how it is shaped, the counter miscounts
 * because a stroke was faint. So when both answer and they answer the SAME
 * NUMBER, that is far better evidence than either on its own -- and the point
 * of this script is to find out how much better, because if it is enough, it is
 * a subset the tool can pre-fill at the precision the design demands.
 *
 * Measured leave-one-EVENT-out: a scan's own digits are never in the exemplar
 * set used to read it.
 *
 * The usual warning applies to the scoring: the spreadsheet is not proof of
 * what is on the card, so "wrong" here is an upper bound. `--show` renders the
 * cases where the two agreed with each other and disagreed with the sheet,
 * which is the set worth reading by eye.
 *
 * Usage:
 *   npx vite-node scripts/diagnose-agreement.mjs -- [--only <name>] [--show]
 */

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { itemForRow } from "../src/lib/taxonomy.ts";
import { countTally } from "../src/lib/tally.ts";
import { normalizeDigit, segmentDigits } from "./lib/cardvision.mjs";
import { colName, contactSheet, matchedPairs, readSpreadsheet, scan } from "./diagnose-review.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRAINING = join(ROOT, "out", "training");

/** Neighbours polled per digit, as in train-digits.mjs. */
const K = 5;
/** The gate the recognizer's own measurements are quoted at. */
const DIGIT_GATE = 0.9;

function unitNorm(bitmap) {
  const out = Float32Array.from(bitmap);
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function loadExemplars() {
  const samples = [];
  for (const file of readdirSync(TRAINING).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(TRAINING, file), "utf8"));
    for (const s of data.samples ?? []) {
      samples.push({
        label: s.label,
        bitmap: unitNorm(s.bitmap),
        source: s.source ?? data.source ?? file.replace(/\.json$/, ""),
      });
    }
  }
  return samples;
}

function classify(bitmap, train) {
  const best = [];
  for (const s of train) {
    const cutoff = best.length < K ? Infinity : best[best.length - 1].d;
    let sum = 0;
    for (let i = 0; i < bitmap.length; i++) {
      const d = bitmap[i] - s.bitmap[i];
      sum += d * d;
      if (sum > cutoff) break;
    }
    if (sum > cutoff) continue;
    best.push({ d: sum, label: s.label });
    best.sort((x, y) => x.d - y.d);
    if (best.length > K) best.pop();
  }
  if (!best.length) return { label: null, confidence: 0 };

  const weights = new Map();
  let total = 0;
  for (const b of best) {
    const w = 1 / (Math.sqrt(b.d) + 1e-6);
    weights.set(b.label, (weights.get(b.label) ?? 0) + w);
    total += w;
  }
  let label = null;
  let bestW = -1;
  for (const [l, w] of weights) {
    if (w > bestW) {
      bestW = w;
      label = l;
    }
  }
  return { label, confidence: total ? bestW / total : 0 };
}

/** Read the TOTAL box as a number, or null if any digit is below the gate. */
function readDigits(total, train) {
  const boxes = segmentDigits(total);
  if (!boxes.length) return { value: null, confidence: 0 };
  let text = "";
  let worst = 1;
  for (const box of boxes) {
    const { label, confidence } = classify(unitNorm(normalizeDigit(total, box)), train);
    if (label === null) return { value: null, confidence: 0 };
    text += label;
    worst = Math.min(worst, confidence);
  }
  return { value: Number(text), confidence: worst };
}

function report(pair, exemplars, show) {
  const s = scan(pair.dir);
  const sheet = readSpreadsheet(pair.sheet);
  const train = exemplars.filter((e) => e.source !== pair.name);

  const typed = new Map();
  for (let card = 1; card <= s.cards; card++) {
    const column = sheet.get(colName(2 + card));
    if (!column) continue;
    for (const [row, raw] of column) {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n) || n <= 0) continue;
      if (itemForRow(row)) typed.set(`${card}:${row}`, n);
    }
  }

  const stats = {
    both: 0,
    agreed: 0,
    agreedScored: 0,
    agreedRight: 0,
    digitsAloneScored: 0,
    digitsAloneRight: 0,
    tallyAloneScored: 0,
    tallyAloneRight: 0,
    // When the two readers disagree, which of the three answers is right: the
    // tally, the digits, or the number halfway between them?
    splitScored: 0,
    splitTally: 0,
    splitDigits: 0,
    splitMiddle: 0,
  };
  const suspect = [];

  for (const c of s.cells) {
    if (!c.offeredNow) continue;
    const truth = typed.get(`${c.card}:${c.row}`);

    const tally = c.tallyMarked
      ? countTally(
          { width: c.tally.width, height: c.tally.height, data: c.tally.gray },
          { context: { width: c.tallyCtx.width, height: c.tallyCtx.height, data: c.tallyCtx.gray } },
        ).count
      : null;
    const digits = c.hasValue ? readDigits(c.total, train) : { value: null, confidence: 0 };
    const digitValue = digits.confidence >= DIGIT_GATE ? digits.value : null;

    if (digitValue !== null && truth !== undefined) {
      stats.digitsAloneScored++;
      if (digitValue === truth) stats.digitsAloneRight++;
    }
    if (tally !== null && truth !== undefined) {
      stats.tallyAloneScored++;
      if (tally === truth) stats.tallyAloneRight++;
    }

    if (tally === null || digitValue === null) continue;
    stats.both++;
    if (tally !== digitValue) {
      if (truth !== undefined) {
        stats.splitScored++;
        if (tally === truth) stats.splitTally++;
        if (digitValue === truth) stats.splitDigits++;
        if (Math.round((tally + digitValue) / 2) === truth) stats.splitMiddle++;
      }
      continue;
    }
    stats.agreed++;
    if (truth === undefined) continue;
    stats.agreedScored++;
    if (tally === truth) stats.agreedRight++;
    else suspect.push({ ...c, said: tally, truth });
  }

  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");
  console.log(
    `${pair.name.padEnd(16)} both read ${String(stats.both).padStart(4)}  agreed ${String(stats.agreed).padStart(4)}   ` +
      `when agreed ${pct(stats.agreedRight, stats.agreedScored).padStart(6)} of ${stats.agreedScored}   ` +
      `| digits alone ${pct(stats.digitsAloneRight, stats.digitsAloneScored).padStart(6)}   ` +
      `tally alone ${pct(stats.tallyAloneRight, stats.tallyAloneScored).padStart(6)}`,
  );
  if (stats.splitScored) {
    console.log(
      `    when they disagreed (${stats.splitScored}): tally right ${stats.splitTally}, ` +
        `digits right ${stats.splitDigits}, halfway between right ${stats.splitMiddle}`,
    );
  }

  if (show && suspect.length) {
    const out = join(ROOT, "out", "review", pair.name);
    mkdirSync(out, { recursive: true });
    contactSheet(join(out, "agreed-but-wrong.png"), suspect.slice(0, 24));
    console.log(`  wrote ${join(out, "agreed-but-wrong.png")}`);
  }
  return stats;
}

function main() {
  const args = process.argv.slice(2);
  const show = args.includes("--show");
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const pairs = matchedPairs().filter((p) => !only || p.name === only);
  const exemplars = loadExemplars();
  console.log(`${exemplars.length} exemplar digits; ${pairs.length} pairs\n`);

  const totals = {
    both: 0,
    agreed: 0,
    agreedScored: 0,
    agreedRight: 0,
    digitsAloneScored: 0,
    digitsAloneRight: 0,
    tallyAloneScored: 0,
    tallyAloneRight: 0,
    splitScored: 0,
    splitTally: 0,
    splitDigits: 0,
    splitMiddle: 0,
  };
  for (const p of pairs) {
    const s = report(p, exemplars, show);
    for (const k of Object.keys(totals)) totals[k] += s[k];
  }
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "-");
  console.log(
    `\nall: both readers answered ${totals.both} cells, agreed on ${totals.agreed}` +
      `\n  where they agreed and the sheet has a value: ${pct(totals.agreedRight, totals.agreedScored)} of ${totals.agreedScored}` +
      `\n  digits alone at the ${DIGIT_GATE} gate: ${pct(totals.digitsAloneRight, totals.digitsAloneScored)} of ${totals.digitsAloneScored}` +
      `\n  tally alone: ${pct(totals.tallyAloneRight, totals.tallyAloneScored)} of ${totals.tallyAloneScored}` +
      `\n\n  where the two readers DISAGREED and the sheet has a value (${totals.splitScored}):` +
      `\n    the tally was right      ${totals.splitTally} (${pct(totals.splitTally, totals.splitScored)})` +
      `\n    the digits were right    ${totals.splitDigits} (${pct(totals.splitDigits, totals.splitScored)})` +
      `\n    halfway between was right ${totals.splitMiddle} (${pct(totals.splitMiddle, totals.splitScored)})` +
      `\n\n  all of these are lower bounds: the sheet is not proof of what is on the card.`,
  );
}

main();
