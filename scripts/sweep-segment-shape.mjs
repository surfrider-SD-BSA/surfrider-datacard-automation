/**
 * The shape tests in `segmentDigits` reject a component that is too short, too
 * bar-like, or too hollow. Where should the hollow line actually sit?
 *
 * Attributing the cells where segmentation finds NOTHING (see
 * `diagnose-none.mjs`) turned up four on 1.18 Imperial rejected by the hollow
 * test at fills of 0.100, 0.113, 0.114 and 0.118 -- against a threshold of
 * 0.12. Every one of them is a legible digit missed by a hair, which is the
 * signature of a threshold set by eye rather than swept.
 *
 * A digit drawn as a large open loop -- a 0, a 5, a 6 by someone who writes
 * roundly -- genuinely does have a low fill, so lowering the line should win
 * cells back. What it risks is the printed cell border, which is the hollow
 * rectangle the test exists to reject, so the sweep reports BOTH directions:
 * cells cut right, and cells cut into too many pieces.
 *
 * Usage:
 *   npx vite-node scripts/sweep-segment-shape.mjs -- [--scans a,b,c]
 *     [--param hollow|short|bar]   which shape test to move
 */

import { itemForRow } from "../src/lib/taxonomy.ts";
import { inkThreshold, components } from "./lib/cardvision.mjs";
import { colName, matchedPairs, readSpreadsheet, scan } from "./diagnose-review.mjs";

const FRAGMENT_GAP = 0.18;

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

/** segmentDigits with the shape constants exposed. Mirrors it otherwise. */
function segment(img, { hollow, short: shortFrac, bar }) {
  const mask = inkMask(img);
  if (!mask.some((v) => v)) return [];
  let boxes = components(mask, img.width, img.height);
  if (!boxes.length) return [];
  boxes = boxes.filter((b) => {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    if (h < img.height * shortFrac) return false;
    if (w / h > bar) return false;
    return b.count >= w * h * hollow;
  });
  if (!boxes.length) return [];
  const tallest = Math.max(...boxes.map((b) => b.maxY - b.minY + 1));
  boxes = boxes.filter((b) => b.maxY - b.minY + 1 >= tallest * 0.45);
  boxes.sort((a, b) => a.minX - b.minX);
  const merged = [];
  for (const b of boxes) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const overlap = Math.min(prev.maxX, b.maxX) - Math.max(prev.minX, b.minX);
      const narrower = Math.min(prev.maxX - prev.minX, b.maxX - b.minX) + 1;
      const gap = b.minX - prev.maxX - 1;
      const height = Math.max(prev.maxY, b.maxY) - Math.min(prev.minY, b.minY) + 1;
      const joinedWidth = Math.max(prev.maxX, b.maxX) - Math.min(prev.minX, b.minX) + 1;
      if (overlap > narrower * 0.5 || (gap <= height * FRAGMENT_GAP && joinedWidth <= height * 1.05)) {
        prev.minX = Math.min(prev.minX, b.minX); prev.maxX = Math.max(prev.maxX, b.maxX);
        prev.minY = Math.min(prev.minY, b.minY); prev.maxY = Math.max(prev.maxY, b.maxY);
        prev.count += b.count;
        continue;
      }
    }
    merged.push({ ...b });
  }
  return merged;
}

function cellsOf(pair) {
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
  const out = [];
  for (const c of s.cells) {
    if (!c.hasValue) continue;
    const truth = typed.get(`${c.card}:${c.row}`);
    if (truth === undefined) continue;
    out.push({ img: c.total, len: truth.length });
  }
  return out;
}

const args = process.argv.slice(2);
const want = args.includes("--scans")
  ? args[args.indexOf("--scans") + 1].split(",")
  : ["imperial-1.18", "pacific-3.22", "seaport-8.23"];

const sets = [];
for (const name of want) {
  const pair = matchedPairs().find((p) => p.name === name);
  if (!pair) { console.error(`no pair ${name}`); continue; }
  sets.push({ name, cells: cellsOf(pair) });
}

/** What ships today. A sweep moves exactly one of these and holds the rest. */
const SHIPPING = { hollow: 0.06, short: 0.18, bar: 3.5 };

const VALUES = {
  hollow: [0.12, 0.11, 0.1, 0.09, 0.08, 0.06, 0.04, 0.0],
  short: [0.18, 0.16, 0.14, 0.12, 0.1, 0.08, 0.05],
  bar: [3.5, 4.5, 6, 8, 12, 20],
};

const param = args.includes("--param") ? args[args.indexOf("--param") + 1] : "hollow";
if (!VALUES[param]) {
  console.error(`--param must be one of ${Object.keys(VALUES).join(", ")}`);
  process.exit(1);
}

const perScan = sets.length <= 6;
const total = sets.reduce((a, s) => a + s.cells.length, 0);
console.log(
  `\n${total} written cells with a typed value across ${sets.length} scan(s)` +
    `\nsweeping ${param}; ${Object.entries(SHIPPING).filter(([k]) => k !== param).map(([k, v]) => `${k}=${v}`).join(", ")} held\n` +
    `\n${param.padEnd(6)}` + (perScan ? want.map((n) => n.padStart(15)).join("") : "") +
    `      all      none    over`,
);
for (const v of VALUES[param]) {
  let line = `  ${String(v).padEnd(4)}`;
  let none = 0, over = 0, allRight = 0;
  for (const s of sets) {
    let right = 0;
    for (const c of s.cells) {
      const n = segment(c.img, { ...SHIPPING, [param]: v }).length;
      if (n === c.len) right++;
      else if (n === 0) none++;
      else if (n > c.len) over++;
    }
    allRight += right;
    if (perScan) line += `${((right / s.cells.length) * 100).toFixed(1)}%`.padStart(15);
  }
  console.log(
    line + `${((allRight / total) * 100).toFixed(1)}%`.padStart(9) +
      `${String(none).padStart(10)}${String(over).padStart(8)}`,
  );
}
