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
 *
 * --src reads with another copy of src/ -- how two versions of the cutter were
 * compared side by side, each in its own copy. --out writes one row per cell
 * ([scan:card:row, reading, typed, confidence, card looks mismatched]) for
 * digging into what changed. Takes about eight minutes; needs the gitignored
 * out/pages, out/models/cnn and scans/.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { colName, readSpreadsheet, matchedPairs } from "./diagnose-review.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
const FOLDS = join(ROOT, "out", "models", "cnn");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const SRC = resolve(arg("--src") ?? join(ROOT, "src"));
const OUT = arg("--out");

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
const decodeJpeg = (p) => {
  const { width, height, data } = jpeg.decode(readFileSync(p), { useTArray: true, formatAsRGBA: true });
  return { width, height, data: luma(data, width * height) };
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

for (const pair of matchedPairs()) {
  const model = modelFor(pair.name);
  const files = readdirSync(pair.dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));
  const pages = files.map((f, i) => {
    const r = registerAgainstBestSide(decodeJpeg(join(pair.dir, f)), targets, i + 1);
    return {
      pageNumber: i + 1,
      side: r.side,
      trusted: r.trusted,
      bannerOverlap: r.bannerOverlap,
      cells: r.trusted ? cellsForSide(r.image, i + 1, maps[r.side], r.side, model) : [],
    };
  });
  const { cards } = pairIntoCards(pages);
  const sheet = readSpreadsheet(pair.sheet);

  cards.forEach((card, idx) => {
    const column = sheet.get(colName(2 + (idx + 1)));
    if (!column) return;
    const cells = [];
    for (const side of ["front", "back"]) {
      for (const c of card[side]?.cells ?? []) {
        if (!itemForRow(c.row) || !c.hasValue) continue;
        const raw = column.get(c.row);
        if (raw === undefined) continue;
        const typed = Math.round(Number(raw));
        if (!Number.isFinite(typed)) continue;
        const r = reconcile(
          c.tallyCount === null ? null : { value: c.tallyCount, confidence: c.tallyConfidence },
          c.digitValue === null ? null : { value: c.digitValue, confidence: c.digitConfidence },
        );
        cells.push({ key: `${pair.name}:${idx + 1}:${c.row}`, typed, value: r?.value ?? null, conf: r?.confidence ?? 0 });
      }
    }
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
      rows.push([c.key, c.value, c.typed, Number(c.conf.toFixed(3)), mismatched]);
    }
  });
  process.stdout.write(`\r  ${pair.name.padEnd(18)} ${String(total.written).padStart(5)} cells so far   `);
}

const pct = (a, b) => ((a / b) * 100).toFixed(1) + "%";
console.log(`\n\nreading from ${SRC}`);
console.log(`written cells with a typed value   ${total.written}`);
console.log(`  given a reading                  ${total.read}`);
console.log(`  reading equals the sheet         ${total.right}  (${pct(total.right, total.written)})`);
console.log(`hidden at AUTO_ACCEPT ${AUTO_ACCEPT}          ${total.hidden}`);
console.log(`  of which disagree with sheet     ${total.hiddenWrong}  (${pct(total.hiddenWrong, total.hidden)})`);
console.log(`  leaving out mismatched cards     ${total.keptWrong} of ${total.kept}  (${pct(total.keptWrong, total.kept)})`);
if (OUT) writeFileSync(OUT, JSON.stringify(rows));
