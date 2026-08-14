/**
 * What does the tally counter say, and is it right?
 *
 * Run over a frozen review cache, so a change to the counter is re-scored
 * against exactly the same pixels in a second. Nothing here decides anything on
 * its own: `--show` renders what was answered and what was declined as contact
 * sheets, captioned `id-count`, because the only way to know whether a count is
 * right is to look at the strip and count it yourself.
 *
 * Usage:
 *   npx vite-node scripts/diagnose-tally.mjs -- <cache-name> [--show]
 *     [--labels eye-labels/<file>.json]   score against counts read by eye
 *     [--declined]                              also render the declines
 *     [--reason <r>]                            only strips declined for <r>
 */

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadCache, sheet } from "./review-sheets.mjs";
import { countTally } from "../src/lib/tally.ts";

function main() {
  const args = process.argv.slice(2);
  const name = args[0];
  if (!name) {
    console.error("usage: npx vite-node scripts/diagnose-tally.mjs -- <cache-name> [--show]");
    process.exit(1);
  }
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);

  const cache = loadCache(name);
  const labels = args.includes("--labels")
    ? JSON.parse(readFileSync(opt("--labels"), "utf8")).counts ?? {}
    : null;

  // Only strips the tool would put in front of a person: the counter never
  // sees a strip the mark test called empty.
  const strips = cache.cells.filter((c) => c.tallyMarked);

  const readings = strips.map((r) => {
    const img = cache.tally(r);
    return { r, img: { width: img.width, height: img.height, data: img.gray }, reading: null };
  });
  for (const e of readings) e.reading = countTally(e.img);

  const answered = readings.filter((e) => e.reading.count !== null);
  const declined = readings.filter((e) => e.reading.count === null);

  console.log(`${name}: ${strips.length} marked strips`);
  console.log(
    `  answered ${answered.length} (${((answered.length / strips.length) * 100).toFixed(0)}%)` +
      `   declined ${declined.length}`,
  );

  const reasons = new Map();
  for (const e of declined) reasons.set(e.reading.reason, (reasons.get(e.reading.reason) ?? 0) + 1);
  console.log("  declined because:");
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${reason}`);
  }

  if (labels) {
    let right = 0;
    let wrong = 0;
    let missed = 0;
    const misses = [];
    for (const e of readings) {
      const truth = labels[e.r.id];
      if (truth === undefined || truth === null) continue;
      if (e.reading.count === null) {
        missed++;
        continue;
      }
      if (e.reading.count === truth) right++;
      else {
        wrong++;
        misses.push(`${e.r.id}: said ${e.reading.count}, is ${truth} (${e.reading.groups})`);
      }
    }
    const answeredN = right + wrong;
    console.log(`\n  against ${right + wrong + missed} strips counted by eye:`);
    console.log(
      `    answered ${answeredN}   precision ${answeredN ? ((right / answeredN) * 100).toFixed(1) : "-"}%` +
        `   declined ${missed}`,
    );
    if (misses.length) {
      console.log("    wrong:");
      for (const m of misses) console.log(`      ${m}`);
    }
  }

  if (args.includes("--show")) {
    const dir = join(cache.dir, "sheets");
    mkdirSync(dir, { recursive: true });
    const wanted = args.includes("--declined")
      ? declined.filter((e) => !args.includes("--reason") || e.reading.reason === opt("--reason"))
      : answered;
    const tag = args.includes("--declined") ? `declined-${opt("--reason", "all")}` : "answered";
    const PER = 16;
    for (let i = 0; i < wanted.length; i += PER) {
      const slice = wanted.slice(i, i + PER);
      const path = join(dir, `tally-${tag}-${String(i / PER).padStart(2, "0")}.png`);
      const size = sheet(
        path,
        slice.map((e) => cache.tally(e.r)),
        2,
        1,
        slice.map((e) => `${e.r.id}-${e.reading.count ?? ""}`),
      );
      console.log(`${path}  ${size.width}x${size.height}`);
    }
    console.log(`${wanted.length} strips rendered`);
  }
}

main();
