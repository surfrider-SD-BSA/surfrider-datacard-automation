/**
 * Reading the cell cache `scripts/cell-cache.mjs` writes. See there for what it
 * holds and why running `cellsForSide` on it gives what the app gets.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

export const CELLS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "out", "cells");

/** The scans in the cache, or a message saying how to build it. */
export function cachedScans() {
  if (!existsSync(CELLS)) throw new Error(`no ${CELLS}: run npx vite-node scripts/cell-cache.mjs first`);
  return readdirSync(CELLS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort();
}

/** A cached scan: its records, and for each one a mini page and one-cell map to hand to `cellsForSide`. */
export function loadCells(scan) {
  const { records } = JSON.parse(readFileSync(join(CELLS, `${scan}.json`), "utf8"));
  const pixels = inflateSync(readFileSync(join(CELLS, `${scan}.bin`)));
  return {
    records,
    page: (r) => ({ width: r.width, height: r.height, data: pixels.subarray(r.offset, r.offset + r.width * r.height) }),
    map: (r) => ({ side: r.side, cells: [r.cell], exclusions: [] }),
  };
}
