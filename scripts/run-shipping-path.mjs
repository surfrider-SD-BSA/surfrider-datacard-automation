/**
 * Run a scan through the code the BROWSER runs, offline.
 *
 * Everything else under scripts/ uses `lib/cardvision.mjs`, the offline mirror
 * of `src/lib/image.ts` and `src/lib/register.ts`. That mirror is what makes
 * the diagnostics cheap to run, and it is also the one place this project can
 * lie to itself: a measurement taken through the mirror says nothing about what
 * the app does if the two have drifted.
 *
 * So this imports the shipping modules themselves -- `register.ts` and
 * `extract.ts` -- and reports the review list they produce. If this and
 * `diagnose-review.mjs` disagree about the same scan, the mirror has drifted
 * and the mirror is what is wrong.
 *
 * It has to run under vite-node rather than node, because the browser modules
 * import each other without file extensions:
 *
 *   npx vite-node scripts/run-shipping-path.mjs -- out/pages/<name> [limit]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { extractCard } from "../src/lib/extract";
import { reconcile } from "../src/lib/reading.ts";
import { pairIntoCards, referenceTargets, registerAgainstBestSide } from "../src/lib/register";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");

/** Rec. 601 luma, matching `toGray` in src/lib/image.ts. */
const luma = (rgba, n) => {
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return out;
};

function decodeJpeg(path) {
  const { width, height, data } = jpeg.decode(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
  });
  return { width, height, data: luma(data, width * height) };
}

function decodePng(path) {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: luma(png.data, png.width * png.height) };
}

/** Mirrors PREFILL_GATE in src/main.ts. */
const PREFILL_GATE = 1.1;

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: npx vite-node scripts/run-shipping-path.mjs -- <dir-of-page-jpegs> [limit]");
    process.exit(1);
  }
  const limit = Number(process.argv[3] ?? Infinity);

  const maps = {
    front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")),
    back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")),
  };
  const targets = referenceTargets(
    {
      front: decodePng(join(REF, "blank-front.png")),
      back: decodePng(join(REF, "blank-back.png")),
    },
    maps,
  );

  const files = readdirSync(dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0))
    .slice(0, limit);

  const pages = files.map((f, i) => ({
    ...registerAgainstBestSide(decodeJpeg(join(dir, f)), targets),
    pageNumber: i + 1,
  }));

  const { cards, problems } = pairIntoCards(pages);
  for (const p of problems) console.log(`  ${p.kind}: ${p.message}`);

  let cells = 0;
  let values = 0;
  let tallies = 0;
  let counted = 0;
  let prefilled = 0;
  for (const card of cards) {
    const out = extractCard(card, maps);
    cells += out.cells.length;
    values += out.cells.filter((c) => c.hasValue).length;
    tallies += out.cells.filter((c) => c.tallyOnly).length;
    counted += out.cells.filter((c) => c.tallyCount !== null).length;
    for (const c of out.cells) {
      const reading = reconcile(
        c.tallyCount === null ? null : { value: c.tallyCount, confidence: c.tallyConfidence },
        null,
      );
      if (reading && reading.confidence >= PREFILL_GATE) prefilled++;
    }
  }

  console.log(
    `${cards.length} cards, ${cells} cells to review ` +
      `(${(cells / Math.max(1, cards.length)).toFixed(1)} per card): ` +
      `${values} with a number in the box, ${tallies} tally-only`,
  );
  console.log(
    `of the ${tallies} tally-only cells, ${counted} were counted and ` +
      `${prefilled} clear the pre-fill gate of ${PREFILL_GATE} — the rest stay blank`,
  );
}

main();
