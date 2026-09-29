/**
 * How often is an auto-accepted value WRONG?
 *
 * Every other instrument here measures how MANY cells AUTO_ACCEPT hides. This
 * one measures how many of them are wrong, against the only ground truth this
 * project has: the spreadsheets the chapter typed by hand from the same scans.
 * Card N of the scan is volunteer column N of the sheet, which is the mapping
 * label-from-spreadsheet.mjs is built on.
 *
 * A cell counts only where the sheet holds a number for it. A typed blank may
 * mean zero, or a card the typist skipped, and neither can be told from the
 * other -- so silence is not evidence either way and is left out.
 *
 * Usage:
 *   HOLDOUT=knn npx vite-node scripts/hidden-accuracy.mjs
 *   HOLDOUT=knn T=0.75 npx vite-node scripts/hidden-accuracy.mjs    # another threshold
 *   npx vite-node scripts/hidden-accuracy.mjs          # the shipped model, flattered
 *
 * HOLDOUT IS THE HONEST NUMBER. The shipped digit model is built from the
 * labelled digits of these very scans, so without it every one of those digits
 * finds itself among the exemplars at distance zero and is read right with a
 * confidence of one -- which hides it, correctly. That describes a scan the
 * model has already seen, and no chapter will ever upload one. HOLDOUT=knn
 * reads each scan with the nearest-neighbour model rebuilt from every OTHER
 * event's digits, which is the test a new cleanup next month actually sets.
 * HOLDOUT=cnn does the same for the convolutional reader, with the per-event
 * nets `train_digits_cnn.py --folds` writes to out/models/cnn/.
 *
 * Reads every scan under out/pages that has a typed spreadsheet in scans/ (see
 * `matchedPairs` in diagnose-review.mjs). Both are gitignored volunteer data, so
 * this only runs on a machine that has them. What it found is written up at
 * `AUTO_ACCEPT` in src/lib/prefill.ts.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { cellsForSide } from "../src/lib/extract";
import { decodeModel } from "../src/lib/digits";
import { reconcile } from "../src/lib/reading.ts";
import { pairIntoCards, referenceTargets, registerAgainstBestSide } from "../src/lib/register";
import { itemForRow } from "../src/lib/taxonomy.ts";
import { colName, readSpreadsheet, matchedPairs } from "./diagnose-review.mjs";
import { loadTrainingSet } from "./train-digits.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
const THRESHOLD = Number(process.env.T ?? 0.45);

const luma = (rgba, n) => {
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  return out;
};
const decodeJpeg = (p) => { const { width, height, data } = jpeg.decode(readFileSync(p), { useTArray: true, formatAsRGBA: true }); return { width, height, data: luma(data, width * height) }; };

const maps = { front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")), back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")) };
const HOLDOUT = process.env.HOLDOUT ?? "";
const shipped = decodeModel(JSON.parse(readFileSync(join(REF, "digit-model.json"), "utf8")));
const training = HOLDOUT === "knn" ? loadTrainingSet() : [];

const FOLDS = join(ROOT, "out", "models", "cnn");

/** The model this scan is read with: one that never saw it, under HOLDOUT. */
function modelFor(scan) {
  if (HOLDOUT === "knn") {
    // K=5, as train-digits.mjs ships it; loadTrainingSet has already prepared the exemplars.
    return { k: 5, exemplars: training.filter((s) => s.source !== scan).map((s) => ({ label: s.label, v: s.bitmap })) };
  }
  if (HOLDOUT === "cnn") {
    // Written by `train_digits_cnn.py --folds`: one net per event, trained
    // without it, and _all.json for a scan no event was trained on.
    const own = join(FOLDS, `${scan}.json`);
    return decodeModel(JSON.parse(readFileSync(existsSync(own) ? own : join(FOLDS, "_all.json"), "utf8")));
  }
  if (HOLDOUT) throw new Error(`HOLDOUT=${HOLDOUT}: expected knn or cnn`);
  return shipped;
}
const decodePng = (p) => { const g = PNG.sync.read(readFileSync(p)); return { width: g.width, height: g.height, data: luma(g.data, g.width * g.height) }; };
const targets = referenceTargets({ front: decodePng(join(REF, "blank-front.png")), back: decodePng(join(REF, "blank-back.png")) }, maps);

let gTotal = 0, gWrong = 0, gBySource = {}, gKind = {}, gCardsBad = 0, gCardsAll = 0, gDroppedCells = 0, gDroppedWrong = 0;
console.log(`hidden-cell accuracy at AUTO_ACCEPT >= ${THRESHOLD}, ${HOLDOUT ? `each scan read by a ${HOLDOUT} model that never saw it` : "shipped model (it has seen these scans)"}\n`);
console.log("scan              checked  wrong   rate   worst offenders");

for (const pair of matchedPairs()) {
  const model = modelFor(pair.name);
  const files = readdirSync(pair.dir).filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));
  const pages = files.map((f, i) => {
    const r = registerAgainstBestSide(decodeJpeg(join(pair.dir, f)), targets, i + 1);
    return { pageNumber: i + 1, side: r.side, trusted: r.trusted, bannerOverlap: r.bannerOverlap,
             cells: r.trusted ? cellsForSide(r.image, i + 1, maps[r.side], r.side, model) : [] };
  });
  const { cards } = pairIntoCards(pages);
  const sheet = readSpreadsheet(pair.sheet);

  let checked = 0, wrong = 0;
  const examples = [];
  const perCard = {};
  cards.forEach((card, idx) => {
    const column = sheet.get(colName(2 + (idx + 1)));
    if (!column) return;
    for (const side of ["front", "back"]) {
      for (const c of (card[side]?.cells ?? [])) {
        const r = reconcile(
          c.tallyCount === null ? null : { value: c.tallyCount, confidence: c.tallyConfidence },
          c.digitValue === null ? null : { value: c.digitValue, confidence: c.digitConfidence },
        );
        if (!r || r.confidence < THRESHOLD) continue;   // shown to a person: not our business
        if (!itemForRow(c.row)) continue;
        const raw = column.get(c.row);
        if (raw === undefined) continue;                 // no ground truth for this cell
        const typed = Math.round(Number(raw));
        if (!Number.isFinite(typed)) continue;
        checked++;
        perCard[idx] = perCard[idx] ?? { n: 0, bad: 0 };
        perCard[idx].n++;
        if (typed !== r.value) {
          wrong++;
          perCard[idx].bad++;
          gBySource[r.source] = (gBySource[r.source] ?? 0) + 1;
          const said = String(r.value), tp = String(typed);
          const kind = tp.length > said.length && tp.endsWith(said) ? "lost-leading-digit"
                     : said.length > tp.length && said.endsWith(tp) ? "extra-leading-digit"
                     : Math.abs(typed - r.value) === 1 ? "off-by-one"
                     : "unrelated";
          gKind[kind] = (gKind[kind] ?? 0) + 1;
          if (examples.length < 3) examples.push(`card${idx + 1}:row${c.row} said ${r.value} typed ${typed} (${r.source} ${r.confidence.toFixed(2)})`);
        }
      }
    }
  });
  gTotal += checked; gWrong += wrong;
  for (const k of Object.keys(perCard)) {
    gCardsAll++;
    const suspect = perCard[k].n >= 4 && perCard[k].bad / perCard[k].n > 0.6;
    if (suspect) { gCardsBad++; gDroppedCells += perCard[k].n; gDroppedWrong += perCard[k].bad; }
  }
  if (checked) {
    console.log(`${pair.name.padEnd(16)} ${String(checked).padStart(7)} ${String(wrong).padStart(6)} ${((wrong / checked) * 100).toFixed(1).padStart(6)}%   ${examples[0] ?? ""}`);
  }
}

console.log(`\nTOTAL            ${String(gTotal).padStart(7)} ${String(gWrong).padStart(6)} ${((gWrong / gTotal) * 100).toFixed(1).padStart(6)}%`);
console.log(`one wrong in every ${(gTotal / gWrong).toFixed(1)} hidden cells`);
console.log(`wrong by source: ${Object.entries(gBySource).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k} ${v}`).join(", ")}`);
console.log(`\nwhat the disagreements look like:`);
for (const [k, v] of Object.entries(gKind).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)}  ${((v / gWrong) * 100).toFixed(1)}% of wrong`);
}
console.log(`\ncards where >60% of hidden cells disagree: ${gCardsBad} of ${gCardsAll} -- these are probably column mismatches, not reading failures`);
const keptCells = gTotal - gDroppedCells, keptWrong = gWrong - gDroppedWrong;
console.log(`those cards hold ${gDroppedCells} of the checked cells and ${gDroppedWrong} of the wrong ones`);
console.log(`\nEXCLUDING THEM: ${keptWrong} wrong of ${keptCells} = ${((keptWrong / keptCells) * 100).toFixed(1)}%, one in every ${(keptCells / keptWrong).toFixed(1)}`);
