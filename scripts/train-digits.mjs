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
function unitNorm(bitmap) {
  const out = Float32Array.from(bitmap);
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function loadTrainingSet() {
  const samples = [];
  for (const file of readdirSync(TRAINING).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(TRAINING, file), "utf8"));
    for (const s of data.samples ?? []) {
      samples.push({
        label: s.label,
        bitmap: unitNorm(s.bitmap),
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

/** Squared L2 distance, with early exit once it cannot make the poll. */
function distance(a, b, cutoff) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
    if (sum > cutoff) return Infinity;
  }
  return sum;
}

/**
 * Classify by polling the K nearest training digits.
 *
 * Confidence is the share of the poll won by the top class, weighted by
 * closeness. It is what the pre-fill is gated on, so it is checked below that
 * it actually tracks correctness rather than merely correlating with it.
 */
function classify(bitmap, train, k = K) {
  const best = [];
  for (const s of train) {
    const cutoff = best.length < k ? Infinity : best[best.length - 1].d;
    const d = distance(bitmap, s.bitmap, cutoff);
    if (d === Infinity) continue;

    best.push({ d, label: s.label });
    best.sort((x, y) => x.d - y.d);
    if (best.length > k) best.pop();
  }
  if (best.length === 0) return { label: null, confidence: 0 };

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
        "Exemplars are unit-normalized already.",
      digitAccuracy: Number(acc.toFixed(4)),
      trainedOn: scans,
      samples: samples.map((s) => ({ label: s.label, b: Array.from(s.bitmap) })),
    };
    const path = join(REF, "digit-model.json");
    writeFileSync(path, JSON.stringify(model));
    console.log(`\nwrote ${path} (${samples.length} exemplars)`);
  }
}

main();
