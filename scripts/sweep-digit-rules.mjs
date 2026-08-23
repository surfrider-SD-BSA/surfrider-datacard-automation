/**
 * What precision is actually reachable, and what it costs in coverage.
 *
 * This exists because "make it 90%" is a reasonable thing to ask and the only
 * honest answer is a table. A confidence gate does not create accuracy; it
 * trades away the digits it is least sure of. So the question is never "can it
 * hit N%" on its own -- it is "how many digits can it still answer at N%".
 *
 * The expensive part is the neighbour search, which does not depend on how the
 * poll is counted, so it is done once and cached in out/. Delete the cache
 * after any change to the preparation in train-digits.mjs, or the sweep will
 * be measuring the old comparison.
 *
 * NOTE the figures here sit a few points below the ones train-digits.mjs
 * prints, and that is deliberate rather than drift: the trainer also tries the
 * query in the 45 forms `matchVariants` allows -- nine offsets of five warps --
 * which is worth roughly that much and cannot be replayed from a cache of
 * fixed distances. Use this script for the SHAPE of
 * the precision/coverage trade and the trainer for the headline number.
 *
 * Measured leave-one-SCAN-out, like everything else here: an event the model
 * has never seen, because digits from one event share a handful of volunteers,
 * one pen each and one scanner session.
 *
 * Usage:
 *   node scripts/sweep-digit-rules.mjs           the reachable table
 *   node scripts/sweep-digit-rules.mjs --rules   also compare voting rules
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// `distance` comes from the library and not from train-digits.mjs, which
// imports it without re-exporting it -- an ESM import is not a re-export, so
// this script could not start at all.
import { distance } from "../src/lib/digits.ts";
import { loadTrainingSet } from "./train-digits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, "out", "digit-neighbours.json");
const POOL = 25;

function neighbours() {
  if (existsSync(CACHE)) {
    console.log(`using cached neighbours (${CACHE})`);
    return JSON.parse(readFileSync(CACHE, "utf8"));
  }
  const samples = loadTrainingSet();
  const scans = [...new Set(samples.map((s) => s.source))];
  console.log(`${samples.length} digits from ${scans.length} events; searching`);

  const rows = [];
  for (const held of scans) {
    const train = samples.filter((s) => s.source !== held);
    // Class counts of the training side only -- a frequency-balanced poll must
    // not be allowed to see the held-out event either.
    const counts = new Array(10).fill(0);
    for (const s of train) counts[s.label]++;

    for (const s of samples.filter((x) => x.source === held)) {
      const best = [];
      for (const t of train) {
        const cutoff = best.length < POOL ? Infinity : best[best.length - 1].d;
        const d = distance(s.bitmap, t.bitmap, cutoff);
        if (d === Infinity) continue;
        best.push({ d, label: t.label });
        best.sort((x, y) => x.d - y.d);
        if (best.length > POOL) best.pop();
      }
      rows.push({ label: s.label, cell: s.cell, counts, n: best.map((b) => ({ d: Math.sqrt(b.d), label: b.label })) });
    }
    process.stdout.write(`\r  ${rows.length}/${samples.length}   `);
  }
  process.stdout.write("\n");
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(rows));
  return rows;
}

/** Poll the k nearest; `margin` scores the winner against the runner-up. */
function poll(rows, { k, margin = false, balance = false }) {
  return rows.map((r) => {
    const near = r.n.slice(0, k);
    const w = new Map();
    let total = 0;
    for (const b of near) {
      let x = 1 / (b.d + 1e-6);
      if (balance) x /= Math.max(1, r.counts[b.label]);
      w.set(b.label, (w.get(b.label) ?? 0) + x);
      total += x;
    }
    const s = [...w.entries()].sort((a, b) => b[1] - a[1]);
    const conf = margin ? (s[0][1] - (s[1]?.[1] ?? 0)) / total : s[0][1] / total;
    return { correct: s[0][0] === r.label, conf };
  });
}

const RULES = [];
for (const k of [5, 9, 15, 21, 25]) for (const margin of [false, true]) RULES.push({ k, margin });

function main() {
  const rows = neighbours();

  if (process.argv.includes("--rules")) {
    console.log("\nvoting rules, all digits:");
    for (const r of [...RULES, { k: 5, margin: false, balance: true }]) {
      const sc = poll(rows, r);
      const acc = sc.filter((x) => x.correct).length / sc.length;
      console.log(`  K=${String(r.k).padStart(2)} ${(r.margin ? "margin" : "share ")}${r.balance ? " balanced" : "         "}  accuracy ${(acc * 100).toFixed(1)}%`);
    }
  }

  console.log("\ntarget precision -> the most digits that can still be answered at it");
  console.log("(best over K in 5,9,15,21,25 and both confidence rules)\n");
  const total = rows.length;
  for (const target of [0.8, 0.85, 0.9, 0.95, 0.99, 1.0]) {
    let best = null;
    for (const rule of RULES) {
      const sc = poll(rows, rule);
      for (const t of [...new Set(sc.map((x) => x.conf))].sort((a, b) => a - b)) {
        const ans = sc.filter((x) => x.conf >= t);
        if (!ans.length) continue;
        const p = ans.filter((x) => x.correct).length / ans.length;
        if (p >= target && (!best || ans.length > best.n)) best = { n: ans.length, p, ...rule, t };
      }
    }
    console.log(
      `  ${String((target * 100).toFixed(0)).padStart(3)}%   ` +
        (best
          ? `${String(best.n).padStart(4)} of ${total} (${((best.n / total) * 100).toFixed(1)}%)   measured ${(best.p * 100).toFixed(1)}%   [K=${best.k} ${best.margin ? "margin" : "share"}, gate ${best.t.toFixed(3)}]`
          : `not reachable at any setting`),
    );
  }
  console.log(
    "\nA gate does not create accuracy, it discards the least certain digits.\n" +
      "Where a row says not reachable, no threshold isolates a clean subset --\n" +
      "even unanimous polls contain errors. That is a model and cutting problem.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
