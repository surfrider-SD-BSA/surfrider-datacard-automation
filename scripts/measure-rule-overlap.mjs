/**
 * How well a registered page's vertical rules match the template's, on every
 * cached real page -- as placed, and shifted sideways.
 *
 * The banner check (`bannerOverlap`) cannot see a page that is out sideways:
 * banners are full-width stripes. South Ponto card 1 (24 Oct 2026) passed it
 * about 130px out, and every left-column crop showed the right column's labels.
 * This measures the check that is meant to catch that, so its threshold is set
 * from real pages rather than guessed.
 *
 *   npx vite-node scripts/measure-rule-overlap.mjs -- [--only pacific-3.22] [--limit 400]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { matchedPairs } from "./diagnose-review.mjs";
import { scanPages } from "./lib/pages.mjs";
import { classifyPage, ruleOverlap, referenceTargets, registerAgainstBestSide, registerPage } from "../src/lib/register.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");

const luma = (rgba, n) => {
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  return out;
};
const decodePng = (p) => {
  const g = PNG.sync.read(readFileSync(p));
  return { width: g.width, height: g.height, data: luma(g.data, g.width * g.height) };
};

/** The image moved `dx` pixels sideways, paper-white where it uncovers. */
function shifted(img, dx) {
  const data = new Uint8Array(img.width * img.height).fill(255);
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width;
    for (let x = 0; x < img.width; x++) {
      const from = x - dx;
      if (from >= 0 && from < img.width) data[row + x] = img.data[row + from];
    }
  }
  return { width: img.width, height: img.height, data };
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = arg("--only");
const limit = Number(arg("--limit") ?? Infinity);

const maps = {
  front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")),
  back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")),
};
const targets = referenceTargets(
  { front: decodePng(join(REF, "blank-front.png")), back: decodePng(join(REF, "blank-back.png")) },
  maps,
);

const SHIFTS = [0, 10, 20, 30, 45, 65, 90, 130];
const scores = Object.fromEntries(SHIFTS.map((s) => [s, []]));
let seen = 0;
let refused = 0;
let refitted = 0;

outer: for (const pair of matchedPairs()) {
  if (only && pair.name !== only) continue;
  for await (const { pageNumber, image } of scanPages(pair.name)) {
    if (seen >= limit) break outer;
    const r = registerAgainstBestSide(image, targets, pageNumber);
    if (!r.trusted) {
      refused++;
      console.log(`refused: ${pair.name} p${pageNumber} banner ${r.bannerOverlap.toFixed(2)} rule ${r.ruleOverlap.toFixed(2)}`);
      continue;
    }
    // Where the line check sent a page through the retries the banners alone
    // would not have: how far the new placement moved it, at the page's edges.
    const first = registerPage(image, targets[classifyPage(image).side]);
    const at = (t, x) => t.x.scale * x + t.x.offset;
    const moved = Math.max(...[200, 1600].map((x) => Math.abs(at(first.transform, x) - at(r.transform, x))));
    if (first.bannerOverlap >= 0.75 && first.ruleOverlap < 0.25) {
      refitted++;
      console.log(`refitted: ${pair.name} p${pageNumber} rule ${first.ruleOverlap.toFixed(2)} -> ${r.ruleOverlap.toFixed(2)}, moved ${moved.toFixed(0)}px`);
    }
    seen++;
    for (const s of SHIFTS) {
      const a = ruleOverlap(shifted(r.image, s), targets[r.side]);
      const b = s === 0 ? a : ruleOverlap(shifted(r.image, -s), targets[r.side]);
      scores[s].push(Math.max(a, b));
    }
    if (r.side && scores[0].at(-1) < 0.5) {
      console.log(`low at shift 0: ${pair.name} p${pageNumber} ${r.side} ${scores[0].at(-1).toFixed(2)}`);
    }
  }
}

const q = (arr, f) => {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? NaN;
};
console.log(`${seen} trusted pages measured, ${refused} refused, ${refitted} re-fitted by the line check`);
console.log("shift  min    p1     p5     median  max   (best of +/- shift)");
for (const s of SHIFTS) {
  const a = scores[s];
  console.log(
    `${String(s).padStart(4)}  ${q(a, 0).toFixed(3)}  ${q(a, 0.01).toFixed(3)}  ${q(a, 0.05).toFixed(3)}  ${q(a, 0.5).toFixed(3)}   ${q(a, 1).toFixed(3)}`,
  );
}
