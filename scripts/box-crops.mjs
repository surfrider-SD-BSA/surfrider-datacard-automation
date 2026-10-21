/**
 * Cut every TOTAL box read as written digits, with a sheet value, out of the
 * cell cache: the pictures and labels scripts/train-trocr.py fine-tunes our
 * tuned reader on (TUNED_AGREE in src/lib/prefill.ts).
 *
 * The crop is the one the phone gives our tuned reader (`wide` in
 * `secondOpinionBoxes`, src/engine.ts): the printed box with 35% of its width
 * more to the left, 8% to the right and 15% of its height above and below, at
 * the scan's own resolution -- volunteers write past the box's left edge, and
 * a reader shown only the box lost the digits there ("200" read as 20).
 * Measured 20 October 2026 held out by halves, every box taken or missed
 * counted (out/exp/fake/complete.mjs): total off 9,394 / 9,244 / 9,111 with
 * the box + 4 px crop, 9,166 / 9,040 / 8,971 with this one, both halves better
 * on all three seeds. Labels are the chapter's typed sheet values; the three cards
 * whose sheet column belongs to another card, and oceanside-9.06, whose sheet
 * is unreliable, are left out.
 *
 *   CELL_CACHE=out/cells npx vite-node scripts/cell-cache.mjs       (once, with today's ink floor)
 *   CELL_CACHE=out/cells npx vite-node scripts/box-crops.mjs        -> out/boxes/
 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";

const { cachedScans, loadCells } = await import("./lib/cellcache.mjs");
const { cellsForSide } = await import("../src/lib/extract.ts");
const { decodeModel } = await import("../src/lib/digits.ts");
const { prefillFor } = await import("../src/lib/prefill.ts");

const OUT = process.env.BOXES_OUT ?? "out/boxes";
const FOLDS = process.env.FOLDS_DIR ?? "out/models/cnn";
const MISMATCHED = new Set(["seaport-6.28:28", "pacific-9.27:1", "oceanside-9.06:13"]);
mkdirSync(join(OUT, "png"), { recursive: true });

const index = [];
for (const scan of cachedScans()) {
  if (scan === "oceanside-9.06") continue;
  const file = existsSync(join(FOLDS, `${scan}.json`)) ? join(FOLDS, `${scan}.json`) : join(FOLDS, "_all.json");
  const model = decodeModel(JSON.parse(readFileSync(file, "utf8")));
  const { records, page, map } = loadCells(scan);
  for (const r of records) {
    if (r.typed == null || MISMATCHED.has(r.key.split(":").slice(0, 2).join(":"))) continue;
    const [c] = cellsForSide(page(r), r.pageNumber, map(r), r.side, model);
    if (!c || prefillFor(c)?.source !== "digits") continue;
    const t = r.cell.total, img = page(r);
    const x0 = Math.max(0, Math.round(t.x - 0.35 * t.width)), x1 = Math.min(img.width, Math.round(t.x + 1.08 * t.width));
    const y0 = Math.max(0, Math.round(t.y - 0.15 * t.height)), y1 = Math.min(img.height, Math.round(t.y + 1.15 * t.height));
    const png = new PNG({ width: x1 - x0, height: y1 - y0 });
    for (let y = 0; y < y1 - y0; y++) {
      for (let x = 0; x < x1 - x0; x++) {
        const v = img.data[(y0 + y) * img.width + x0 + x], j = 4 * (y * (x1 - x0) + x);
        png.data[j] = png.data[j + 1] = png.data[j + 2] = v;
        png.data[j + 3] = 255;
      }
    }
    const name = r.key.replace(/:/g, "_") + ".png";
    writeFileSync(join(OUT, "png", name), PNG.sync.write(png));
    index.push({ key: r.key, file: name, sheet: r.typed });
  }
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(index));
console.log(`${index.length} boxes in ${OUT}`);
