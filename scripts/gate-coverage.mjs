/**
 * How many boxes each pre-fill gate actually fills, with BOTH readers on.
 *
 * The instrument for moving `PREFILL_GATE` in src/lib/prefill.ts. It answers
 * the question that decides the setting -- how much coverage is bought -- and
 * deliberately does not answer the other one. For whether those fills are
 * RIGHT, use `audit-prefills.mjs`, which renders each cell to be counted by
 * eye and scores it against eye-labels/prefill-audit.json.
 *
 * Why this exists beside `run-shipping-path.mjs`: that script passes `null`
 * for the digits, because `extractCard` takes no model, so it measures the
 * tally side alone. Since the digit reader was switched on, the tally side is
 * a small minority of what gets filled -- 11 readings against 267 on the
 * 58-card scan -- and a gate chosen on it would be chosen on the wrong data.
 *
 * Usage:
 *   npx vite-node scripts/gate-coverage.mjs -- out/pages/<name>
 *
 * Prints the number of cells filled at each gate, and the ceiling: the readers
 * only offer so many readings, and no gate reaches past that however low it
 * goes. Keep the chosen gate above `splitConfidence` in reading.ts (0.17) --
 * below it the midpoint taken when the two readers disagree starts being
 * pre-filled, and that is the weakest answer available.
 */
import { readdirSync, readFileSync } from "node:fs";
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

const GATES = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2];
const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f))
  .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));

const pages = files.map((f, i) => {
  const r = registerAgainstBestSide(decodeJpeg(join(dir, f)), targets, i + 1);
  return { pageNumber: i + 1, side: r.side, trusted: r.trusted, bannerOverlap: r.bannerOverlap,
           cells: r.trusted ? cellsForSide(r.image, i + 1, maps[r.side], r.side, model) : [] };
});
const { cards } = pairIntoCards(pages);

let total = 0;
const filled = Object.fromEntries(GATES.map((g) => [g, 0]));
const bySource = {};
for (const card of cards) {
  for (const side of ["front", "back"]) {
    for (const c of (card[side]?.cells ?? [])) {
      total++;
      const r = reconcile(
        c.tallyCount === null ? null : { value: c.tallyCount, confidence: c.tallyConfidence },
        c.digitValue === null ? null : { value: c.digitValue, confidence: c.digitConfidence },
      );
      if (!r) continue;
      for (const g of GATES) if (r.confidence >= g) filled[g]++;
      bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    }
  }
}
console.log(`\n${cards.length} cards, ${total} cells to review`);
console.log(`readings offered by source: ${JSON.stringify(bySource)}`);
console.log("\ngate   filled   coverage");
for (const g of GATES) console.log(`${g.toFixed(2)}   ${String(filled[g]).padStart(5)}   ${((filled[g] / total) * 100).toFixed(1)}%`);
