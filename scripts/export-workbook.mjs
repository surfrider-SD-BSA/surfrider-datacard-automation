/**
 * A scan, all the way to the chapter's spreadsheet, outside a browser.
 *
 * The other scripts here stop at the readings: `gate-coverage.mjs` counts what
 * gets filled, `audit-prefills.mjs` scores whether it is right, and neither of
 * them ever builds a workbook. That left the last step -- patch the template,
 * write the file, look at it -- reachable only by dropping a PDF into the tool
 * by hand, which is a poor way to check something that broke silently.
 *
 * It broke silently once. The column B totals cache a 0 from when the template
 * was saved blank, and `fullCalcOnLoad` only helps a reader that recalculates;
 * every preview on a phone shows the cache. The sheet was wrong for weeks in
 * the one place the chapter actually reads. `patchFormulaCache` fixes it, and
 * this is how you see that it is fixed rather than assume so:
 *
 *   npx vite-node scripts/export-workbook.mjs -- test-long
 *   qlmanage -t -s 1400 -o /tmp out/test-long.xlsx   # what a preview renders
 *   open out/test-long.xlsx                          # what Excel renders
 *
 * Takes directory names under out/pages, or paths. Writes out/<name>.xlsx.
 *
 * WHAT IT WRITES IS VOLUNTEER DATA. `out/` is gitignored for that reason and
 * the file this produces must stay there; see the note at the foot of
 * .gitignore about `assets/` being copied into every build verbatim.
 *
 * Every value goes in as the tool would fill it and none is marked corrected,
 * which is the worst case on purpose: a spreadsheet where a reviewer typed
 * nothing at all. That is also what makes the totals worth looking at, since
 * they then sum the machine's own numbers, placeholders included.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { assembleCard, cellsForSide } from "../src/lib/extract";
import { decodeModel } from "../src/lib/digits";
import { prefillFor } from "../src/lib/prefill";
import { fillTemplate } from "../src/lib/xlsx/index";
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
const template = new Uint8Array(readFileSync(join(ROOT, "assets", "template", "data-entry-template.xlsx")));

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: npx vite-node scripts/export-workbook.mjs -- <page-dir> [more...]");
  process.exit(1);
}

for (const arg of args) {
  const dir = existsSync(arg) ? arg : join(ROOT, "out", "pages", arg);
  const name = basename(dir);
  const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));

  const pages = files.map((f, i) => {
    const r = registerAgainstBestSide(decodeJpeg(join(dir, f)), targets, i + 1);
    return { pageNumber: i + 1, side: r.side, trusted: r.trusted, bannerOverlap: r.bannerOverlap,
             cells: r.trusted ? cellsForSide(r.image, i + 1, maps[r.side], r.side, model) : [] };
  });

  const { cards, problems } = pairIntoCards(pages);
  const assembled = cards.map(assembleCard).filter((c) => c.cells.length > 0);

  // Counted so the summary can say what the totals are made of. A placeholder
  // is a number the image did not produce -- see AUTO_ACCEPT and
  // PLACEHOLDER_VALUE in src/lib/prefill.ts -- and it sums like any other.
  let placeholders = 0;
  let unseen = 0;

  const exportCards = assembled.map((card) => ({
    cardNumber: card.cardNumber,
    pageNumbers: [...new Set(card.cells.map((c) => c.pageNumber))].sort((a, b) => a - b),
    cardType: card.cells.some((c) => c.tallyOnly) ? "tally" : "total",
    values: card.cells.map((cell) => {
      const p = prefillFor(cell);
      if (p.source === "placeholder") placeholders++;
      if (p.confidence >= 0.75) unseen++;
      return { row: cell.row, value: p.value, confidence: p.confidence, corrected: false };
    }),
  }));

  const bytes = fillTemplate(template, {
    sourcePdfName: `${name}.pdf`,
    // Fixed so that two runs of the same scan differ only where the reading
    // did. A timestamp here would make every export a new file to diff.
    generatedAt: new Date("2026-01-01T00:00:00.000Z"),
    event: {
      date: "2026-01-01",
      shoreline: name,
      volunteers: exportCards.length,
      pounds: null,
      durationHours: 2,
      dataEntryVolunteer: null,
      club: "Surfrider San Diego (CH54)",
    },
    cards: exportCards,
  });

  mkdirSync(join(ROOT, "out"), { recursive: true });
  const outPath = join(ROOT, "out", `${name}.xlsx`);
  writeFileSync(outPath, bytes);

  const values = exportCards.reduce((n, c) => n + c.values.length, 0);
  console.log(
    `${name}: ${exportCards.length} cards, ${values} values ` +
      `(${placeholders} placeholders, ${unseen} never shown to anyone)` +
      `${problems.length ? `, ${problems.length} page problems` : ""} -> out/${name}.xlsx`,
  );
}
