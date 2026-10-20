/**
 * Cut every tally-only box -- strokes in the strip, no number in the TOTAL box
 * -- out of the cell cache, with the chapter's typed number: the pictures and
 * labels scripts/train-tally.py teaches our tally readers on
 * (`tallyFromReaders` in src/lib/prefill.ts).
 *
 * The crop is the one the phone's tally readers see (`tallyStripBoxes` in
 * src/engine.ts): the tally area and 6 pixels round it, at the scan's own
 * resolution. Each entry also records what the app's own counter said, which
 * is what the readers are measured against. The shipped pair was trained on
 * strips cut with FOLDS_DIR=out/models/cnn-w4s1.
 *
 *   CELL_CACHE=out/cells-app FOLDS_DIR=out/models/cnn-w4s1 npx vite-node scripts/tally-strips.mjs   -> out/tally/
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const { cachedScans, loadCells } = await import("./lib/cellcache.mjs");
const { cellsForSide } = await import("../src/lib/extract.ts");
const { decodeModel } = await import("../src/lib/digits.ts");
const { prefillFor } = await import("../src/lib/prefill.ts");

const OUT = process.env.TALLY_OUT ?? "out/tally";
const FOLDS = process.env.FOLDS_DIR ?? "out/models/cnn";
mkdirSync(join(OUT, "png"), { recursive: true });

const modelFor = (scan) =>
  decodeModel(
    JSON.parse(readFileSync(existsSync(join(FOLDS, `${scan}.json`)) ? join(FOLDS, `${scan}.json`) : join(FOLDS, "_all.json"), "utf8")),
  );

const index = [];
for (const scan of cachedScans()) {
  const model = modelFor(scan);
  const { records, page, map } = loadCells(scan);
  for (const r of records) {
    const img = page(r);
    const [c] = cellsForSide(img, r.pageNumber, map(r), r.side, model);
    if (!c || !c.tallyOnly) continue;
    const t = r.cell.tally, m = 6;
    const x0 = Math.max(0, t.x - m), y0 = Math.max(0, t.y - m);
    const x1 = Math.min(img.width, t.x + t.width + m), y1 = Math.min(img.height, t.y + t.height + m);
    const png = new PNG({ width: x1 - x0, height: y1 - y0 });
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = img.data[y * img.width + x], i = ((y - y0) * (x1 - x0) + (x - x0)) * 4;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
        png.data[i + 3] = 255;
      }
    }
    const file = r.key.replaceAll(":", "_") + ".png";
    writeFileSync(join(OUT, "png", file), PNG.sync.write(png));
    const p = prefillFor(c);
    index.push({ key: r.key, scan, file, sheet: r.typed ?? null, app: p?.value ?? null, appConf: p?.confidence ?? null });
  }
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
const labelled = index.filter((x) => x.sheet !== null);
const off = labelled.reduce((a, x) => a + Math.abs((x.app ?? 0) - x.sheet), 0);
console.log(
  `${index.length} tally-only strips, ${labelled.length} with a sheet number; the app's counter exactly right on`,
  `${labelled.filter((x) => x.app === x.sheet).length}, off by ${off} in all -> ${OUT}`,
);
