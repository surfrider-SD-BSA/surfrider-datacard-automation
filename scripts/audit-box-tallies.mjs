/**
 * Tally marks drawn in the TOTAL box: every box the digit reader reads as
 * nothing but 1s, what the app does with it, and whether that is what is on the
 * card.
 *
 * `countBoxTally` in src/lib/tally.ts counts the strokes in those boxes, and
 * this is the instrument it was built against. The spreadsheets cannot judge
 * it: the question is whether "|||" is 3 or 111, and on whole cards the sheets
 * are typed into the wrong column. So every box is scored against
 * `eye-labels/box-tallies.json`, 277 boxes read by eye, and a box the labels do
 * not cover is listed rather than scored -- a change to the digit reader or the
 * cutting moves which boxes come out as 1s, and those need looking at before
 * any figure here means anything.
 *
 * Usage:
 *   npx vite-node scripts/audit-box-tallies.mjs -- [--show] [--which counted|all|unlabelled] [--only <scan>]
 *
 *   --show     render the boxes as contact sheets in out/audit/, each tile the
 *              end of the tally strip and the box over the rows above and
 *              below, ticks marking the row's band and the box's printed sides
 *   --which    which boxes to render: the ones the counter counted (default),
 *              all of them, or the ones the labels do not cover
 *
 * Reads the cell cache (`scripts/cell-cache.mjs`), with each scan read by the
 * net that never saw its event, the same folds reading-accuracy.mjs uses.
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { cachedScans, loadCells } from "./lib/cellcache.mjs";
import { sheet } from "./review-sheets.mjs";
import { cellsForSide } from "../src/lib/extract.ts";
import { decodeModel } from "../src/lib/digits.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOLDS = join(ROOT, "out", "models", "cnn");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const ONLY = arg("--only");
const WHICH = arg("--which", "counted");
const SHOW = process.argv.includes("--show");

const labels = JSON.parse(readFileSync(join(ROOT, "eye-labels", "box-tallies.json"), "utf8")).labels;

function modelFor(scan) {
  const own = join(FOLDS, `${scan}.json`);
  const path = existsSync(own) ? own : join(FOLDS, "_all.json");
  if (!existsSync(path)) throw new Error(`no ${path}: run train_digits_cnn.py --folds first`);
  return decodeModel(JSON.parse(readFileSync(path, "utf8")));
}

/** The end of the tally strip and the box, over the rows above and below it. */
function tile(page, r) {
  const t = r.cell.total;
  const s = r.cell.tally;
  const x0 = Math.max(0, Math.round(Math.max(s.x, s.x + s.width - 200)));
  const x1 = Math.min(page.width, Math.round(t.x + t.width * 1.3));
  const y0 = Math.max(0, Math.round(t.y - t.height * 0.6));
  const y1 = Math.min(page.height, Math.round(t.y + t.height * 1.6));
  const width = x1 - x0 + 6;
  const height = y1 - y0 + 6;
  const gray = new Uint8Array(width * height).fill(255);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) gray[(y - y0 + 3) * width + (x - x0 + 6)] = page.data[y * page.width + x];
  }
  for (const yy of [t.y, t.y + t.height]) {
    const y = Math.round(yy - y0 + 3);
    for (let x = 0; x < 5; x++) if (y >= 0 && y < height) gray[y * width + x] = 0;
  }
  for (const xx of [t.x, t.x + t.width]) {
    const x = Math.round(xx - x0 + 6);
    for (let y = 0; y < 3; y++) {
      if (x < 0 || x >= width) continue;
      gray[y * width + x] = 0;
      gray[(height - 1 - y) * width + x] = 0;
    }
  }
  return { width, height, gray };
}

const boxes = [];
for (const scan of cachedScans()) {
  if (ONLY && scan !== ONLY) continue;
  const model = modelFor(scan);
  const { records, page, map } = loadCells(scan);
  for (const r of records) {
    if (!r.hasValue) continue;
    const [c] = cellsForSide(page(r), r.pageNumber, map(r), r.side, model);
    if (!c) continue;
    // The box counter answered: the digit reading was withdrawn in its favour.
    const counted = c.digitValue === null && c.tallyCount !== null ? c.tallyCount : null;
    const ones = counted !== null || (c.digitValue !== null && /^1{2,}$/.test(String(c.digitValue)));
    if (!ones) continue;
    boxes.push({ key: r.key, counted, read: c.digitValue, eye: labels[r.key], tile: SHOW ? tile(page(r), r) : null });
  }
  process.stdout.write(`\r  ${scan.padEnd(18)} ${boxes.length} boxes read as 1s so far   `);
}

const counted = boxes.filter((b) => b.counted !== null);
const unlabelled = boxes.filter((b) => b.eye === undefined);
const scoredBoxes = counted.filter((b) => b.eye !== undefined);
const right = scoredBoxes.filter((b) => b.eye === b.counted);
const wrong = scoredBoxes.filter((b) => typeof b.eye === "number" && b.eye !== b.counted);
const notTally = scoredBoxes.filter((b) => typeof b.eye !== "number");
const tallies = boxes.filter((b) => typeof b.eye === "number" && b.eye >= 3);

console.log(`\n\nboxes the digit reader reads as all 1s   ${boxes.length}  (${unlabelled.length} not in the eye labels)`);
console.log(`  counted as a tally instead            ${counted.length}`);
console.log(`    right by eye                        ${right.length}`);
console.log(`    a tally, counted wrong              ${wrong.length}  ${wrong.map((b) => `${b.key} ${b.counted}/${b.eye}`).join("  ")}`);
console.log(`    not a tally, or unclear, by eye    ${notTally.length}  ${notTally.map((b) => `${b.key} ${b.counted}/"${b.eye}"`).join("  ")}`);
console.log(`  tallies of 3+ by eye                  ${tallies.length}, of which counted right ${tallies.filter((b) => b.counted === b.eye).length}`);
if (unlabelled.length) {
  console.log(`\nnot in eye-labels/box-tallies.json -- read these before quoting a figure:`);
  for (const b of unlabelled) console.log(`  ${b.key}  read ${b.read ?? "-"}  counted ${b.counted ?? "-"}`);
}

if (SHOW) {
  const pick = WHICH === "all" ? boxes : WHICH === "unlabelled" ? unlabelled : counted;
  const out = join(ROOT, "out", "audit");
  mkdirSync(out, { recursive: true });
  const per = 24;
  console.log("");
  for (let i = 0; i < pick.length; i += per) {
    const chunk = pick.slice(i, i + per);
    const path = join(out, `box-tallies-${String(i / per).padStart(2, "0")}.png`);
    sheet(path, chunk.map((b) => b.tile), 4, 1, chunk.map((_, j) => String(i + j)));
    console.log(path);
  }
  pick.forEach((b, i) => console.log(`${String(i).padStart(3)}  ${b.key.padEnd(22)} read ${String(b.read ?? "-").padEnd(4)} counted ${String(b.counted ?? "-").padEnd(3)} eye ${b.eye ?? "?"}`));
}
