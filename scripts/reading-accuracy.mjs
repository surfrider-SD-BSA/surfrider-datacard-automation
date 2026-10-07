/**
 * How many written cells does the tool read right, and how many of the ones it
 * hides are wrong? The end-to-end measure every change to the digit reader or
 * its cutting has been judged by since September 2026.
 *
 * Every TOTAL box that has writing and a typed value in the chapter's sheet is
 * read the way the app reads it -- cut, read, reconciled with the tally counter
 * -- and compared with the sheet. Each scan is read by the CNN trained WITHOUT
 * its event (`train_digits_cnn.py --folds`), so no scan is read by a model that
 * has seen its digits. See HOLDOUT in hidden-accuracy.mjs for why that matters.
 *
 * The sheet is not ground truth: about one typed label in five is wrong for the
 * crop it is attached to (HANDOFF.md). The figures are for comparing one version
 * of the tool with another on the same cells, not for quoting as accuracy.
 * "Leaving out mismatched cards" drops cards where more than 60% of at least
 * four hidden cells disagree, which are almost always a card typed into the
 * wrong column.
 *
 * Usage:
 *   npx vite-node scripts/reading-accuracy.mjs
 *   npx vite-node scripts/reading-accuracy.mjs -- --src <copy of src/> --out cells.json
 *   npx vite-node scripts/reading-accuracy.mjs -- --cache
 *
 * --src reads with another copy of src/ -- how two versions of the cutter were
 * compared side by side, each in its own copy. --out writes one row per cell
 * ([scan:card:row, reading, typed, confidence, card looks mismatched, which
 * reader spoke, the digit reader's number and confidence, the counter's count
 * and confidence]) for digging into what changed. Takes about eight minutes; needs the gitignored
 * out/models/cnn and scans/, and out/pages for the list of scans.
 *
 * Pages are rendered from the PDFs in scans/ exactly as the apps render them
 * (scripts/lib/pages.mjs), always with this checkout's src/lib/scanpage.ts.
 * `PAGES=pdfkit` reads the PDFKit renders in out/pages instead, which every
 * figure before 30 September 2026 was measured on.
 *
 * --cache reads the cells `scripts/cell-cache.mjs` cut out once instead of
 * registering every page again: the same figures in under a minute, for any
 * change to the readers. Not for a change to registration or to which cells are
 * offered -- rebuild the cache for those.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { colName, readSpreadsheet, matchedPairs } from "./diagnose-review.mjs";
import { cachedScans, loadCells } from "./lib/cellcache.mjs";
import { PAGES, scanPages } from "./lib/pages.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
// FOLDS_DIR measures a second set of per-event models, as train_digits_cnn.py writes them.
const FOLDS = join(ROOT, process.env.FOLDS_DIR ?? join("out", "models", "cnn"));

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SRC = resolve(arg("--src") ?? join(ROOT, "src"));
const OUT = arg("--out");
const CACHE = process.argv.includes("--cache");

const { cellsForSide } = await import(join(SRC, "lib/extract.ts"));
const { decodeModel } = await import(join(SRC, "lib/digits.ts"));
const { reconcile } = await import(join(SRC, "lib/reading.ts"));
const { pairIntoCards, referenceTargets, registerAgainstBestSide } = await import(join(SRC, "lib/register.ts"));
const { itemForRow } = await import(join(SRC, "lib/taxonomy.ts"));
const { AUTO_ACCEPT } = await import(join(SRC, "lib/prefill.ts"));

const luma = (rgba, n) => {
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  return out;
};
const decodePng = (p) => {
  const g = PNG.sync.read(readFileSync(p));
  return { width: g.width, height: g.height, data: luma(g.data, g.width * g.height) };
};

const maps = {
  front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")),
  back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")),
};
const targets = referenceTargets(
  { front: decodePng(join(REF, "blank-front.png")), back: decodePng(join(REF, "blank-back.png")) },
  maps,
);

/** The net that never saw this scan's event, or the full one for a scan no event was trained on. */
function modelFor(scan) {
  const own = join(FOLDS, `${scan}.json`);
  const path = existsSync(own) ? own : join(FOLDS, "_all.json");
  if (!existsSync(path)) throw new Error(`no ${path}: run train_digits_cnn.py --folds first`);
  return decodeModel(JSON.parse(readFileSync(path, "utf8")));
}

const total = { written: 0, read: 0, right: 0, hidden: 0, hiddenWrong: 0, kept: 0, keptWrong: 0 };
const rows = [];

/** Score one card: its written cells that have a typed value, read and reconciled. */
function scoreCard(cells) {
  const hidden = cells.filter((c) => c.conf >= AUTO_ACCEPT);
  const mismatched = hidden.length >= 4 && hidden.filter((c) => c.value !== c.typed).length / hidden.length > 0.6;
  for (const c of cells) {
    total.written++;
    if (c.value !== null) total.read++;
    if (c.value === c.typed) total.right++;
    if (c.conf >= AUTO_ACCEPT) {
      total.hidden++;
      if (c.value !== c.typed) total.hiddenWrong++;
      if (!mismatched) {
        total.kept++;
        if (c.value !== c.typed) total.keptWrong++;
      }
    }
    rows.push([
      c.key,
      c.value,
      c.typed,
      Number(c.conf.toFixed(3)),
      mismatched,
      c.source,
      c.digits,
      Number(c.digitsConf.toFixed(3)),
      c.tally,
      Number(c.tallyConf.toFixed(3)),
    ]);
  }
}

/** A written cell with a typed value, as the app would read it; null for any other cell. */
function scored(key, c, typed) {
  if (!itemForRow(c.row) || !c.hasValue || typed === null || !Number.isFinite(typed)) return null;
  const r = reconcile(
    c.tallyCount === null ? null : { value: c.tallyCount, confidence: c.tallyConfidence },
    c.digitValue === null ? null : { value: c.digitValue, confidence: c.digitConfidence },
  );
  return {
    key,
    typed,
    value: r?.value ?? null,
    conf: r?.confidence ?? 0,
    source: r?.source ?? null,
    digits: c.digitValue,
    digitsConf: c.digitConfidence,
    tally: c.tallyCount,
    tallyConf: c.tallyConfidence,
  };
}

const progress = (name) =>
  process.stdout.write(`\r  ${name.padEnd(18)} ${String(total.written).padStart(5)} cells so far   `);

if (CACHE) {
  for (const scan of cachedScans()) {
    const model = modelFor(scan);
    const { records, page, map } = loadCells(scan);
    const cards = new Map();
    for (const r of records) {
      const [c] = cellsForSide(page(r), r.pageNumber, map(r), r.side, model);
      const cell = c && scored(r.key, c, r.typed);
      if (!cell) continue;
      if (!cards.has(r.card)) cards.set(r.card, []);
      cards.get(r.card).push(cell);
    }
    for (const cells of cards.values()) scoreCard(cells);
    progress(scan);
  }
} else {
  for (const pair of matchedPairs()) {
    const model = modelFor(pair.name);
    const pages = [];
    for await (const { pageNumber, image } of scanPages(pair.name)) {
      const r = registerAgainstBestSide(image, targets, pageNumber);
      pages.push({
        pageNumber,
        side: r.side,
        trusted: r.trusted,
        bannerOverlap: r.bannerOverlap,
        cells: r.trusted ? cellsForSide(r.image, pageNumber, maps[r.side], r.side, model) : [],
      });
    }
    const { cards } = pairIntoCards(pages);
    const sheet = readSpreadsheet(pair.sheet);

    cards.forEach((card, idx) => {
      const column = sheet.get(colName(2 + (idx + 1)));
      if (!column) return;
      const cells = [];
      for (const side of ["front", "back"]) {
        for (const c of card[side]?.cells ?? []) {
          const raw = column.get(c.row);
          const cell = raw === undefined ? null : scored(`${pair.name}:${idx + 1}:${c.row}`, c, Math.round(Number(raw)));
          if (cell) cells.push(cell);
        }
      }
      scoreCard(cells);
    });
    progress(pair.name);
  }
}

const pct = (a, b) => ((a / b) * 100).toFixed(1) + "%";
console.log(
  `\n\nreading from ${SRC}${CACHE ? ", cells from the cache" : PAGES === "app" ? ", pages rendered as the apps render them" : ", pages from out/pages (PDFKit)"}`,
);
console.log(`written cells with a typed value   ${total.written}`);
console.log(`  given a reading                  ${total.read}`);
console.log(`  reading equals the sheet         ${total.right}  (${pct(total.right, total.written)})`);
console.log(`hidden at AUTO_ACCEPT ${AUTO_ACCEPT}          ${total.hidden}`);
console.log(`  of which disagree with sheet     ${total.hiddenWrong}  (${pct(total.hiddenWrong, total.hidden)})`);
console.log(`  leaving out mismatched cards     ${total.keptWrong} of ${total.kept}  (${pct(total.keptWrong, total.kept)})`);
if (OUT) writeFileSync(OUT, JSON.stringify(rows));
