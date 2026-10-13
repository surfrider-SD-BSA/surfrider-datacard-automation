/**
 * Lone zeros for the digit reader's training set, taken only where they are clean.
 *
 * The labelling (`label-from-spreadsheet.mjs`) skips boxes the sheet leaves at 0,
 * so the net had only ever seen a 0 inside "10" or "100" (179 of them), and a
 * written 0 on its own was read as 2, 3 or 8 and taken unseen. Taking every box
 * the sheet types as 0 was tried (HANDOFF.md, 7 October) and the labels were too
 * noisy: real 5s and 6s taught as 0. This takes only the boxes the sheet types
 * as 0 that the reader cuts into exactly one piece, not a sliver, whose ink
 * (thickened 2px, since pencil zeros are rarely closed) encloses one hole near
 * the piece's middle. 96 boxes, every one of a sampled 20 a 0 by eye. The two
 * scans whose sheets are unreliable are left out.
 *
 * Writes TRAINING_OUT (default out/training-z2): out/training with these added.
 * Then train as usual, with MNIST, which the shipped model was pretrained on:
 *
 *   CELL_CACHE=out/cells-app npx vite-node scripts/zero-samples.mjs
 *   TRAINING_DIR=out/training-z2 FOLDS_DIR=out/models/cnn-z2 \
 *     python scripts/train_digits_cnn.py --folds --mnist <dir of the four idx .gz files>
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { cachedScans, loadCells } from "./lib/cellcache.mjs";
import { cropGray } from "../src/lib/marks.ts";
import { segmentDigits, normalizeDigit, inkMask } from "../src/lib/digits.ts";

function oneHoleNearMiddle(mask, w, b) {
  const W = b.maxX - b.minX + 7, H = b.maxY - b.minY + 7; // 3px border
  const ink = new Uint8Array(W * H);
  for (let y = b.minY; y <= b.maxY; y++) for (let x = b.minX; x <= b.maxX; x++)
    if (mask[y * w + x]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ink[(y - b.minY + 3 + dy) * W + (x - b.minX + 3 + dx)] = 1;
  const seen = new Uint8Array(W * H), regions = [];
  for (let s = 0; s < W * H; s++) {
    if (ink[s] || seen[s]) continue;
    const st = [s]; seen[s] = 1; let n = 0, sx = 0, sy = 0, edge = false;
    while (st.length) { const p = st.pop(), x = p % W, y = (p / W) | 0; n++; sx += x; sy += y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H || seen[q] || ink[q]) continue; if ((q % W === 0 && p % W === W - 1) || (p % W === 0 && q % W === W - 1)) continue; seen[q] = 1; st.push(q); } }
    if (!edge) regions.push({ n, cx: sx / n / W, cy: sy / n / H });
  }
  const holes = regions.filter((r) => r.n >= 0.04 * W * H);
  return holes.length === 1 && Math.abs(holes[0].cx - 0.5) < 0.2 && Math.abs(holes[0].cy - 0.5) < 0.2 && holes[0].n >= 0.08 * W * H;
}

const outDir = process.env.TRAINING_OUT ?? "out/training-z2";
mkdirSync(outDir, { recursive: true });
const added = {};
const extra = {};
for (const scan of cachedScans()) {
  if (scan === "oceanside-9.06" || scan === "oceanbeach-9.06") continue; // unreliable sheets
  const { records, page } = loadCells(scan);
  for (const r of records) {
    if (r.typed !== 0) continue;
    const t = r.cell.total, img = page(r);
    const rect = { x: t.x - t.width * 0.2, y: t.y - t.height * 0.3, width: t.width * 1.25, height: t.height * 1.6 };
    const crop = cropGray(img, rect);
    const box = { x: Math.round(t.x) - Math.max(0, Math.round(rect.x)), y: Math.round(t.y) - Math.max(0, Math.round(rect.y)), width: Math.round(t.width), height: Math.round(t.height) };
    const pieces = segmentDigits(crop, box);
    if (pieces.length !== 1) continue;
    const b = pieces[0], h = b.maxY - b.minY + 1, w = b.maxX - b.minX + 1;
    if (h < box.height * 0.35 || w < h * 0.35) continue; // a 0 is not a sliver
    if (!oneHoleNearMiddle(inkMask(crop, box), crop.width, b)) continue;
    const [, card, row] = r.key.split(":");
    (extra[scan] ??= []).push({ label: 0, bitmap: Array.from(normalizeDigit(crop, b)), card: +card, row: +row, value: 0, source: scan, zeroShape: true });
    added[scan] = (added[scan] ?? 0) + 1;
  }
}
for (const f of readdirSync("out/training").filter((f) => f.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(`out/training/${f}`, "utf8"));
  const scan = f.replace(/\.json$/, "");
  const have = new Set(d.samples.map((s) => `${s.card}:${s.row}`));
  d.samples.push(...(extra[scan] ?? []).filter((s) => !have.has(`${s.card}:${s.row}`)));
  writeFileSync(`${outDir}/${f}`, JSON.stringify(d));
}
const total = Object.values(added).reduce((a, b) => a + b, 0);
console.log("zero samples added", total, JSON.stringify(added));
