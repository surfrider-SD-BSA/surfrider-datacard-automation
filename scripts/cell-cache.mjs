/**
 * Register every matched scan once, and keep each offered cell as a small piece
 * of its registered page, so that measuring a change to the readers no longer
 * means registering 1,600 pages again.
 *
 * `reading-accuracy.mjs` spent almost all of its eight minutes decoding and
 * registering pages that never change between two versions of a reader. This
 * does that part once. Each cell the app offers is stored as a "mini page": its
 * row and a margin of a row's height above and below, cut from the REGISTERED
 * page, with the cell's boxes moved into it. Every crop `cellsForSide` takes is
 * local to the row and lies inside that margin, so running it on a mini page
 * with a one-cell map gives exactly what it gives on the whole page -- checked
 * over all 7,180 offered cells, none differ. `reading-accuracy.mjs --cache` and
 * `audit-box-tallies.mjs` read from here.
 *
 * Rebuild it after a change to registration, to the cell map, or to which cells
 * are offered (`marks.ts`, the ink floor in `extract.ts`). A change to either
 * reader does not need it: that is the point.
 *
 * Usage:
 *   npx vite-node scripts/cell-cache.mjs [-- --only <scan>]
 *
 * Writes out/cells/<scan>.json (one record per offered cell, keyed
 * scan:card:row, with the typed value where the sheet has one) and
 * out/cells/<scan>.bin (their pixels, deflated), or under CELL_CACHE when that is
 * set. Takes about six and a half minutes; needs the gitignored scans/, and
 * out/pages for the list of scans.
 *
 * The pages are rendered from the PDF in scans/ exactly as the apps render them
 * (scripts/lib/pages.mjs). `PAGES=pdfkit` builds from the PDFKit renders in
 * out/pages instead, which is what every figure before 30 September 2026 was
 * measured on.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";

import { colName, readSpreadsheet, matchedPairs } from "./diagnose-review.mjs";
import { CELLS } from "./lib/cellcache.mjs";
import { PAGES, scanPages } from "./lib/pages.mjs";
import { cellsForSide } from "../src/lib/extract.ts";
import { cropGray } from "../src/lib/marks.ts";
import { pairIntoCards, referenceTargets, registerAgainstBestSide } from "../src/lib/register.ts";

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

const rebase = (r, x0, y0) => ({ x: r.x - x0, y: r.y - y0, width: r.width, height: r.height });

async function main() {
  const i = process.argv.indexOf("--only");
  const only = i >= 0 ? process.argv[i + 1] : undefined;
  mkdirSync(CELLS, { recursive: true });

  const maps = {
    front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")),
    back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")),
  };
  const targets = referenceTargets(
    { front: decodePng(join(REF, "blank-front.png")), back: decodePng(join(REF, "blank-back.png")) },
    maps,
  );

  for (const pair of matchedPairs()) {
    if (only && pair.name !== only) continue;
    const started = Date.now();
    const chunks = [];
    let offset = 0;
    const pages = [];
    for await (const { pageNumber, image } of scanPages(pair.name)) {
      const i = pageNumber - 1;
      const r = registerAgainstBestSide(image, targets, pageNumber);
      const cells = [];
      if (r.trusted) {
        const map = maps[r.side];
        // Geometry only: no model, so this is the list of cells the app offers
        // and nothing about how either reader reads them.
        for (const offered of cellsForSide(r.image, i + 1, map, r.side, null)) {
          const c = map.cells.find((m) => m.row === offered.row);
          const h = Math.max(c.total.height, c.tally.height);
          const x0 = Math.max(0, Math.floor(Math.min(c.tally.x, c.total.x) - 24));
          const y0 = Math.max(0, Math.floor(Math.min(c.tally.y, c.total.y) - h));
          const x1 = Math.min(r.image.width, Math.ceil(c.total.x + c.total.width * 1.3 + 24));
          const y1 = Math.min(r.image.height, Math.ceil(Math.max(c.tally.y + c.tally.height, c.total.y + c.total.height) + h));
          const mini = cropGray(r.image, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
          chunks.push(mini.data);
          cells.push({
            row: offered.row,
            side: r.side,
            pageNumber: i + 1,
            width: mini.width,
            height: mini.height,
            offset,
            cell: { row: c.row, column: c.column, total: rebase(c.total, x0, y0), tally: rebase(c.tally, x0, y0) },
            hasValue: offered.hasValue,
            tallyOnly: offered.tallyOnly,
          });
          offset += mini.data.length;
        }
      }
      pages.push({ pageNumber, side: r.side, trusted: r.trusted, bannerOverlap: r.bannerOverlap, cells });
    }

    // Card N is spreadsheet column N, as everywhere else; see reading-accuracy.mjs.
    const { cards } = pairIntoCards(pages);
    const sheet = readSpreadsheet(pair.sheet);
    const records = [];
    cards.forEach((card, idx) => {
      const column = sheet.get(colName(2 + (idx + 1)));
      for (const side of ["front", "back"]) {
        for (const c of card[side]?.cells ?? []) {
          const raw = column?.get(c.row);
          const typed = raw === undefined ? null : Math.round(Number(raw));
          records.push({ key: `${pair.name}:${idx + 1}:${c.row}`, card: idx + 1, typed: Number.isFinite(typed) ? typed : null, ...c });
        }
      }
    });

    const all = new Uint8Array(offset);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    writeFileSync(join(CELLS, `${pair.name}.bin`), deflateSync(all, { level: 6 }));
    writeFileSync(join(CELLS, `${pair.name}.json`), JSON.stringify({ scan: pair.name, records }));
    console.log(`${pair.name.padEnd(18)} ${String(records.length).padStart(5)} cells  ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
}

console.log(`pages: ${PAGES === "app" ? "rendered from scans/ as the apps render them" : "out/pages (PDFKit)"}`);
await main();
