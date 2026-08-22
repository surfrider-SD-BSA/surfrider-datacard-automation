/**
 * Why did segmentation find NOTHING in this cell?
 *
 * `diagnose-segmentation.mjs --kind none --show` renders that bucket, and
 * looking at it is necessary but not sufficient: the renders show a legible
 * digit sitting in a box the code swears is empty, and the eye cannot tell
 * which of the four tests threw it away. This attributes each one, with the
 * numbers that decided it, so the answer is a filter name and not a guess.
 *
 * Read the render AND this together. On 1.18 Imperial the render suggested the
 * digits were being lost to the printed border; the attribution showed four of
 * them were legible digits rejected by the hollow test at fills of 0.100 to
 * 0.118, against a threshold of 0.12. That is what `sweep-segment-shape.mjs`
 * then measured and what moved the line.
 *
 * Same warning as everywhere: a value in the spreadsheet is not proof that
 * anything is written on the card. A cell reported here as specks or refused by
 * the threshold is usually an empty box with a number typed from somewhere
 * else, and is not a defect.
 *
 * Usage:
 *   npx vite-node scripts/diagnose-none.mjs -- [scan-name]
 */
import { itemForRow } from "../src/lib/taxonomy.ts";
import { segmentDigits, inkThreshold, components } from "./lib/cardvision.mjs";
import { colName, matchedPairs, readSpreadsheet, scan } from "./diagnose-review.mjs";

// inkMask is not exported; mirrored exactly.
function inkMask(img) {
  const t = inkThreshold(img);
  const mask = new Uint8Array(img.width * img.height);
  if (t < 0) return mask;
  const ix = Math.max(3, Math.round(img.width * 0.06));
  const iy = Math.max(3, Math.round(img.height * 0.08));
  for (let y = iy; y < img.height - iy; y++)
    for (let x = ix; x < img.width - ix; x++) {
      const i = y * img.width + x;
      mask[i] = img.gray[i] <= t ? 1 : 0;
    }
  return mask;
}

const only = process.argv[2] ?? "imperial-1.18";
const pair = matchedPairs().find((p) => p.name === only);
const s = scan(pair.dir);
const sheet = readSpreadsheet(pair.sheet);
const typed = new Map();
for (let card = 1; card <= s.cards; card++) {
  const col = sheet.get(colName(2 + card));
  if (!col) continue;
  for (const [row, raw] of col) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!itemForRow(row)) continue;
    typed.set(`${card}:${row}`, String(n));
  }
}

const tally = new Map();
let n = 0;
for (const c of s.cells) {
  if (!c.hasValue) continue;
  const truth = typed.get(`${c.card}:${c.row}`);
  if (truth === undefined) continue;
  if (segmentDigits(c.total).length !== 0) continue;
  n++;
  const img = c.total;
  const t = inkThreshold(img);
  if (t < 0) { tally.set("inkThreshold refused the cell", (tally.get("inkThreshold refused the cell") ?? 0) + 1); console.log(`${c.card}:${c.row} sheet=${truth}  THRESHOLD REFUSED`); continue; }
  const mask = inkMask(img);
  const inked = mask.reduce((a, v) => a + v, 0);
  if (!inked) { tally.set("all ink inside the 6% inset", (tally.get("all ink inside the 6% inset") ?? 0) + 1); console.log(`${c.card}:${c.row} sheet=${truth}  NO INK INSIDE INSET (t=${t})`); continue; }
  const comps = components(mask, img.width, img.height);
  if (!comps.length) { tally.set("only specks (<12px)", (tally.get("only specks (<12px)") ?? 0) + 1); console.log(`${c.card}:${c.row} sheet=${truth}  ONLY SPECKS (ink=${inked})`); continue; }
  const why = comps.map((b) => {
    const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
    const r = [];
    if (h < img.height * 0.18) r.push(`short h=${h}/${img.height}`);
    if (w / h > 3.5) r.push(`bar w/h=${(w / h).toFixed(1)}`);
    if (b.count < w * h * 0.12) r.push(`hollow fill=${(b.count / (w * h)).toFixed(3)}`);
    return { w, h, count: b.count, r };
  });
  const killed = why.filter((x) => x.r.length);
  const reason = killed.length === why.length
    ? [...new Set(killed.flatMap((x) => x.r.map((s) => s.split(" ")[0])))].sort().join("+")
    : "survived filters, then speck rule";
  tally.set(reason, (tally.get(reason) ?? 0) + 1);
  console.log(`${c.card}:${c.row} sheet=${truth}  crop ${img.width}x${img.height} t=${t} ink=${inked}  comps=${comps.length}  -> ${reason}`);
  for (const x of why) console.log(`     w=${String(x.w).padStart(3)} h=${String(x.h).padStart(3)} px=${String(x.count).padStart(4)}  ${x.r.join(", ") || "OK"}`);
}
console.log(`\n${n} cells where nothing is found`);
for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
