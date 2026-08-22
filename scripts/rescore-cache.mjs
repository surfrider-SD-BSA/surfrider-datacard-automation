/**
 * Recompute the mark test over a frozen crop cache, without re-registering.
 *
 * The cache's own `hasValue`/`tallyMarked` are whatever the code said on the day
 * it was written, and marks.ts has moved since. Re-running review-cache.mjs
 * would refresh them, but it also re-registers every page, and the eye labels
 * are keyed to THIS cache's cell ids. So the pixels stay and only the verdicts
 * are recomputed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCache } from "./review-sheets.mjs";
import { boxMarked, stripMarked } from "./lib/cardvision.mjs";

const name = process.argv[2];
if (!name) {
  console.error("usage: npx vite-node scripts/rescore-cache.mjs -- <name>");
  process.exit(1);
}

const cache = loadCache(name);
let hasValue = 0;
let tallyOnly = 0;
for (const r of cache.cells) {
  r.hasValue = boxMarked(cache.total(r));
  r.tallyMarked = stripMarked(cache.tally(r));
  if (r.hasValue) hasValue++;
  else if (r.tallyMarked) tallyOnly++;
}
writeFileSync(join(cache.dir, "manifest.json"), JSON.stringify(cache.manifest));
console.log(`${name}: ${cache.cells.length} cached, offered ${hasValue + tallyOnly}` +
  `  (hasValue ${hasValue}, tally-only ${tallyOnly})`);
