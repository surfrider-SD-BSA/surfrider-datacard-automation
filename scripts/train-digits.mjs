/**
 * Build and measure the digit classifier.
 *
 * Approach: nearest-neighbour over normalized 28x28 bitmaps. Not a CNN, and
 * deliberately so -- there is no ML toolchain on this machine, and with a few
 * thousand training digits a nearest-neighbour model is competitive while being
 * inspectable: every prediction can be traced to the specific training digit it
 * matched, which matters when the whole design rests on knowing when NOT to
 * trust a reading.
 *
 * ---------------------------------------------------------------------------
 * What this is FOR, which decides how it is measured.
 *
 * The recognizer does not replace the human. It pre-fills a box that a person
 * is looking at anyway, beside a picture of the handwriting. So the number that
 * matters is not accuracy over all digits -- it is PRECISION ON THE ONES IT
 * CHOOSES TO ANSWER. A cell it declines to fill costs a keystroke the human was
 * going to make regardless. A cell it fills wrongly costs far more, because it
 * invites agreement, and a wrong number that looks confident is the one failure
 * this project is arranged to avoid.
 *
 * So the output below is a precision/coverage curve, not a single accuracy
 * figure, and the threshold is chosen for precision with coverage as whatever
 * falls out.
 * ---------------------------------------------------------------------------
 *
 * Measured leave-one-SCAN-out: the model is trained on 17 events and tested on
 * the 18th, then rotated. Anything less flatters the result -- digits from one
 * event share a handful of volunteers, one pen each, and one scanner session,
 * so a digit from the same card (or even the same event) is a much easier test
 * than the real one, which is a new event by new people next month.
 *
 * Labels come from `label-from-spreadsheet.mjs`; see out/training/.
 *
 * Usage:
 *   node scripts/train-digits.mjs            measure
 *   node scripts/train-digits.mjs --emit     also write the model
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { distance, prepare, shiftVariants, unitNorm } from "../src/lib/digits.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRAINING = join(ROOT, "out", "training");
const REF = join(ROOT, "assets", "reference");

/** Neighbours polled per prediction. */
const K = 5;

/**
 * Scale a bitmap to unit length.
 *
 * Without this, L2 distance is partly a comparison of how much ink each digit
 * carries, so a heavily-written 1 can sit closer to a 0 than to a light 1.
 * Normalizing leaves only the shape.
 */
/**
 * The preparation and the distance both live in src/lib/digits.ts now, so the
 * browser and this measurement run the same code. A query prepared any
 * differently from the exemplars is comparing nothing, which is exactly the
 * kind of drift a second copy invites.
 */

export function loadTrainingSet() {
  const samples = [];
  for (const file of readdirSync(TRAINING).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(TRAINING, file), "utf8"));
    for (const s of data.samples ?? []) {
      samples.push({
        label: s.label,
        bitmap: prepare(s.bitmap),
        // Kept unprepared for --emit: the shipped model stores raw 0-255
        // bytes and the app prepares them, which is a third of the size.
        raw: Uint8Array.from(s.bitmap),
        source: s.source ?? data.source ?? file.replace(/\.json$/, ""),
        // A cell is identified by scan + card + row; its digits stand or fall
        // together when a value is judged.
        cell: `${s.source}:${s.card}:${s.row}`,
        value: s.value,
      });
    }
  }
  return samples;
}

/**
 * Classify by polling the K nearest training digits.
 *
 * Confidence is the share of the poll won by the top class, weighted by
 * closeness. It is what the pre-fill is gated on, so it is checked below that
 * it actually tracks correctness rather than merely correlating with it.
 *
 * The pool size, the shift re-score and the distance all come from
 * src/lib/digits.ts, which is what the browser runs.
 */
const POOL = 25;

function classify(bitmap, train, k = K) {
  const pool = [];
  for (const s of train) {
    const cutoff = pool.length < POOL ? Infinity : pool[pool.length - 1].d;
    const d = distance(bitmap, s.bitmap, cutoff);
    if (d === Infinity) continue;

    pool.push({ d, label: s.label, bitmap: s.bitmap });
    pool.sort((x, y) => x.d - y.d);
    if (pool.length > POOL) pool.pop();
  }
  if (pool.length === 0) return { label: null, confidence: 0 };

  // Re-score the pool allowing the query to move, then keep the k best.
  const variants = shiftVariants(bitmap);
  const best = pool
    .map((c) => {
      let m = Infinity;
      for (const v of variants) {
        const d = distance(v, c.bitmap, m);
        if (d < m) m = d;
      }
      return { d: m, label: c.label };
    })
    .sort((x, y) => x.d - y.d)
    .slice(0, k);

  const weights = new Map();
  let total = 0;
  for (const b of best) {
    // Inverse-distance weighting, so a very close match counts for more than a
    // distant one that happens to be inside the poll.
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

function main() {
  const samples = loadTrainingSet();
  const scans = [...new Set(samples.map((s) => s.source))];

  console.log(`training digits: ${samples.length} from ${scans.length} events`);
  const perClass = new Array(10).fill(0);
  for (const s of samples) perClass[s.label]++;
  console.log(`per class: ${perClass.map((n, i) => `${i}:${n}`).join("  ")}`);

  // ---- leave-one-scan-out ----
  const results = [];
  for (const held of scans) {
    const train = samples.filter((s) => s.source !== held);
    const test = samples.filter((s) => s.source === held);
    for (const s of test) {
      const { label, confidence } = classify(s.bitmap, train);
      results.push({ ...s, predicted: label, confidence, correct: label === s.label });
    }
    process.stdout.write(`\r  tested ${results.length}/${samples.length}   `);
  }
  process.stdout.write("\n");

  const acc = results.filter((r) => r.correct).length / results.length;
  console.log(`\nper-digit accuracy, all digits: ${(acc * 100).toFixed(1)}%`);

  // ---- the number that decides the design: precision where it answers ----
  console.log("\nprecision/coverage by confidence threshold:");
  console.log("  threshold   answered   precision   cells fully right");
  for (const t of [0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0]) {
    const answered = results.filter((r) => r.confidence >= t);
    if (answered.length === 0) continue;
    const right = answered.filter((r) => r.correct).length;

    // A value is only usable if EVERY digit in it was answered and right --
    // "2" and "21" are different numbers of debris.
    const byCell = new Map();
    for (const r of results) {
      if (!byCell.has(r.cell)) byCell.set(r.cell, []);
      byCell.get(r.cell).push(r);
    }
    let fullCells = 0;
    let wholeCells = 0;
    for (const digits of byCell.values()) {
      if (!digits.every((d) => d.confidence >= t)) continue;
      wholeCells++;
      if (digits.every((d) => d.correct)) fullCells++;
    }

    console.log(
      `  >= ${t.toFixed(2)}    ` +
        `${String(answered.length).padStart(5)} (${String(Math.round((answered.length / results.length) * 100)).padStart(3)}%)   ` +
        `${((right / answered.length) * 100).toFixed(1)}%      ` +
        `${wholeCells ? ((fullCells / wholeCells) * 100).toFixed(1) : "-"}% of ${wholeCells} cells`,
    );
  }

  // ---- what it gets wrong, so the failures are known rather than assumed ----
  const confusion = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (const r of results) if (r.predicted !== null) confusion[r.label][r.predicted]++;

  console.log("\nconfusion (row = truth, col = predicted):");
  console.log("     " + [...Array(10).keys()].map((i) => String(i).padStart(5)).join(""));
  confusion.forEach((row, i) => {
    console.log(`  ${i}: ` + row.map((n) => String(n || "").padStart(5)).join(""));
  });

  const pairs = [];
  confusion.forEach((row, t) =>
    row.forEach((n, p) => {
      if (t !== p && n > 0) pairs.push({ t, p, n });
    }),
  );
  pairs.sort((a, b) => b.n - a.n);
  console.log("\nworst confusions:");
  for (const { t, p, n } of pairs.slice(0, 8)) console.log(`  ${t} read as ${p}: ${n}`);

  console.log("\nper class recall:");
  for (let d = 0; d < 10; d++) {
    const of = results.filter((r) => r.label === d);
    if (!of.length) continue;
    const right = of.filter((r) => r.correct).length;
    console.log(
      `  ${d}: ${String(right).padStart(4)}/${String(of.length).padEnd(4)} ` +
        `${((right / of.length) * 100).toFixed(0)}%`,
    );
  }

  console.log("\nper event (a whole unseen event each time):");
  for (const scan of scans) {
    const of = results.filter((r) => r.source === scan);
    const right = of.filter((r) => r.correct).length;
    console.log(
      `  ${scan.padEnd(16)} ${String(right).padStart(4)}/${String(of.length).padEnd(4)} ` +
        `${((right / of.length) * 100).toFixed(0)}%`,
    );
  }

  if (process.argv.includes("--emit")) {
    mkdirSync(REF, { recursive: true });
    const model = {
      kind: "knn-28x28",
      k: K,
      note:
        "Nearest-neighbour digit model. Bitmaps are 28x28, ink 0-255, scaled " +
        "to fit 20x20 and centred by centre of mass (MNIST convention). " +
        "Exemplars are RAW bytes, base64: run prepare() from src/lib/digits.ts " +
        "over each one before comparing, and over the query too, or the " +
        "distances mean nothing. At read time the query is also tried at nine " +
        "one-pixel offsets and the closest is kept.",
      digitAccuracy: Number(acc.toFixed(4)),
      trainedOn: scans,
      // Raw bytes, base64. Storing the PREPARED float vectors instead costs
      // 8.1MB against 3.5MB, and the preparation is a few milliseconds over the
      // whole set at load time.
      samples: samples.map((s) => ({
        label: s.label,
        b: Buffer.from(s.raw).toString("base64"),
      })),
    };
    const path = join(REF, "digit-model.json");
    writeFileSync(path, JSON.stringify(model));
    console.log(`\nwrote ${path} (${samples.length} exemplars)`);
  }
}

// Guarded so the preparation helpers above can be imported by the rule sweep
// without this file measuring anything on the way in.
if (import.meta.url === `file://${process.argv[1]}`) main();
