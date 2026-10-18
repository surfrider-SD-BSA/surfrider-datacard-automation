/**
 * Prints `TENS_SHARE` for src/lib/row-prior.ts: for each card row, how often the
 * chapter's sheets hold a count of 10 or more there, smoothed toward 1/4 with
 * four pseudo-counts ((tens + 1) / (n + 4)). Read from the cell cache's sheet
 * values, oceanside-9.06 (unreliable sheet) left out.
 *
 *   node scripts/row-prior.mjs                   CELL_CACHE=out/cells-app
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
const dir = resolve(process.env.CELL_CACHE ?? "out/cells-app");
const g = {};
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("oceanside-9.06"))) {
  for (const r of JSON.parse(readFileSync(join(dir, f), "utf8")).records) {
    if (r.typed == null) continue;
    g[r.row] ??= { n: 0, tens: 0 };
    g[r.row].n++;
    if (r.typed >= 10) g[r.row].tens++;
  }
}
const rows = Object.keys(g).map(Number).sort((a, b) => a - b);
console.log(`export const TENS_SHARE: Record<number, number> = {\n${rows.map((r) => `  ${r}: ${((g[r].tens + 1) / (g[r].n + 4)).toFixed(2)},`).join("\n")}\n};`);
