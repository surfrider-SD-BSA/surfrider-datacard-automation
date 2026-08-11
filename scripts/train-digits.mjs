/**
 * Build and measure the digit classifier.
 *
 * Approach: nearest-neighbour over normalized 28x28 bitmaps. Not a CNN, and
 * deliberately so -- there is no ML toolchain on this machine, the training set
 * is 152 digits rather than 60,000, and with a set that small a nearest-
 * neighbour model is competitive while being inspectable: every prediction can
 * be traced to the specific training digit it matched, which matters when the
 * whole design rests on knowing when NOT to trust a reading.
 *
 * Labels are derived rather than hand-assigned per digit: a cell known to read
 * "163" that segments into exactly 3 pieces gives labels 1, 6, 3 in order. Cells
 * whose segment count disagrees with their value length are dropped, since
 * their digit boundaries are by definition wrong.
 *
 * Accuracy is measured leave-one-out: each digit is classified using every
 * other digit as training data. With a set this small an ordinary train/test
 * split would be dominated by which examples happened to land in the test half.
 *
 * Usage:
 *   node scripts/train-digits.mjs            measure
 *   node scripts/train-digits.mjs --emit     also write the model
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CROPS = join(ROOT, "out", "crops");
const REF = join(ROOT, "assets", "reference");

/** Neighbours polled per prediction. */
const K = 5;

function loadTrainingSet() {
  const cells = JSON.parse(readFileSync(join(CROPS, "cells.json"), "utf8"));
  const digits = JSON.parse(readFileSync(join(CROPS, "digits.json"), "utf8"));
  const labels = JSON.parse(
    readFileSync(join(REF, "labels-pacific-beach.json"), "utf8"),
  ).labels;

  const byCell = new Map();
  for (const d of digits) {
    if (!byCell.has(d.cellId)) byCell.set(d.cellId, []);
    byCell.get(d.cellId).push(d);
  }

  const samples = [];
  let dropped = 0;

  for (const cell of cells) {
    const value = labels[String(cell.id)];
    if (typeof value !== "number") continue;

    const text = String(value);
    const parts = (byCell.get(cell.id) ?? []).sort((a, b) => a.index - b.index);

    if (parts.length !== text.length) {
      dropped++;
      continue;
    }
    parts.forEach((p, i) => {
      samples.push({
        label: Number(text[i]),
        bitmap: unitNorm(p.bitmap),
        cellId: cell.id,
        card: cell.card,
      });
    });
  }
  return { samples, dropped };
}

/**
 * Scale a bitmap to unit length.
 *
 * Without this, L2 distance is partly a comparison of how much ink each digit
 * carries, so a heavily-written 1 can sit closer to a 0 than to a light 1.
 * Normalizing leaves only the shape.
 */
function unitNorm(bitmap) {
  const out = Float64Array.from(bitmap);
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** L2 distance between two bitmaps, with early exit. */
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
 * closeness. It is reported so the caller can decline to auto-fill a reading it
 * should not trust -- a wrong number typed in silently is the failure this whole
 * design is arranged to avoid.
 */
function classify(bitmap, train, k = K, excludeCell = -1) {
  const best = [];
  for (const s of train) {
    if (s.cellId === excludeCell) continue;
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
  const { samples, dropped } = loadTrainingSet();
  console.log(`training digits: ${samples.length}`);
  console.log(`cells dropped (segment count != value length): ${dropped}`);

  const perClass = new Array(10).fill(0);
  for (const s of samples) perClass[s.label]++;
  console.log(`per class: ${perClass.map((n, i) => `${i}:${n}`).join("  ")}`);

  // Leave-one-CELL-out: excluding only the digit itself would leave its
  // siblings from the same handwriting in the training set, which flatters the
  // score. A whole unseen cell is the honest test.
  let correct = 0;
  const confusion = Array.from({ length: 10 }, () => new Array(10).fill(0));
  const byConfidence = [];

  for (const s of samples) {
    const { label, confidence } = classify(s.bitmap, samples, K, s.cellId);
    if (label === s.label) correct++;
    if (label !== null) confusion[s.label][label]++;
    byConfidence.push({ correct: label === s.label, confidence });
  }

  const acc = correct / samples.length;
  console.log(`\nper-digit accuracy (leave-one-cell-out): ${(acc * 100).toFixed(1)}%`);

  console.log("\nconfusion (row = truth, col = predicted):");
  console.log("     " + [...Array(10).keys()].map((i) => String(i).padStart(4)).join(""));
  confusion.forEach((row, i) => {
    console.log(`  ${i}: ` + row.map((n) => String(n || "").padStart(4)).join(""));
  });

  console.log("\nworst confusions:");
  const pairs = [];
  confusion.forEach((row, t) =>
    row.forEach((n, p) => {
      if (t !== p && n > 0) pairs.push({ t, p, n });
    }),
  );
  pairs.sort((a, b) => b.n - a.n);
  for (const { t, p, n } of pairs.slice(0, 6)) console.log(`  ${t} read as ${p}: ${n}`);

  // Does confidence actually track correctness? If it does not, auto-filling
  // high-confidence readings is unsafe no matter what the headline accuracy is.
  console.log("\ncalibration:");
  for (const [lo, hi] of [[0, 0.5], [0.5, 0.7], [0.7, 0.9], [0.9, 1.01]]) {
    const bucket = byConfidence.filter((b) => b.confidence >= lo && b.confidence < hi);
    if (bucket.length === 0) continue;
    const right = bucket.filter((b) => b.correct).length;
    console.log(
      `  confidence ${lo.toFixed(2)}-${hi.toFixed(2)}: ` +
        `${bucket.length} digits, ${((right / bucket.length) * 100).toFixed(0)}% correct`,
    );
  }

  if (process.argv.includes("--emit")) {
    mkdirSync(REF, { recursive: true });
    const model = {
      kind: "knn-28x28",
      k: K,
      note: "Nearest-neighbour digit model. Bitmaps are 28x28, ink 0-255, " +
        "scaled to fit 20x20 and centred by centre of mass (MNIST convention).",
      accuracy: Number(acc.toFixed(4)),
      samples: samples.map((s) => ({ label: s.label, b: Array.from(s.bitmap) })),
    };
    const path = join(REF, "digit-model.json");
    writeFileSync(path, JSON.stringify(model));
    console.log(`\nwrote ${path} (${samples.length} exemplars)`);
  }
}

main();
