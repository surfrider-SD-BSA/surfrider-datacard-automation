/**
 * Turn the boxes volunteers checked in the apps into training digits.
 *
 * Every spreadsheet the apps export carries a hidden "Training" sheet: each box
 * a person was shown and settled, its final number, and a picture of the
 * printed box (TrainingBox in src/lib/xlsx/export.ts). Those numbers were typed
 * or confirmed with the picture in front of the person, so they are the clean
 * labels the typed sheets are not -- about one in five of those is wrong for its
 * box, which is the ceiling every bigger reader hit (HANDOFF.md).
 *
 * Each box is cut into digits exactly as scripts/label-from-spreadsheet.mjs
 * cuts its own, and kept only where the cutting finds as many digits as the
 * number has. Writes out/training/app-<export>.json, which
 * scripts/train_digits_cnn.py reads alongside everything else there.
 *
 *   npx vite-node scripts/training-from-exports.mjs -- exports/*.xlsx
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { PNG } from "pngjs";

import { normalizeDigit, segmentDigits } from "../src/lib/digits.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out", "training");

/** The hidden Training sheet's rows, as arrays of cell text. */
function trainingRows(xlsx) {
  const zip = unzipSync(new Uint8Array(readFileSync(xlsx)));
  const workbook = strFromU8(zip["xl/workbook.xml"]);
  const rels = strFromU8(zip["xl/_rels/workbook.xml.rels"]);
  const id = /<sheet [^>]*name="Training"[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  if (!id) return [];
  const target = new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  const xml = strFromU8(zip[`xl/${target}`]);
  const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/g)].map((t) => unescape(t[1])),
  );
}

mkdirSync(OUT, { recursive: true });
for (const xlsx of process.argv.slice(2).filter((a) => a.endsWith(".xlsx"))) {
  const name = `app-${basename(xlsx, ".xlsx")}`;
  const rows = trainingRows(xlsx).slice(1);
  const samples = [];
  let used = 0;
  for (const [card, row, , value, , png] of rows) {
    const text = String(Number(value));
    if (!(Number(value) > 0)) continue;
    const img = PNG.sync.read(Buffer.from(png, "base64"));
    const grey = { width: img.width, height: img.height, data: new Uint8Array(img.width * img.height) };
    for (let i = 0; i < grey.data.length; i++) {
      const p = i * 4;
      grey.data[i] = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000;
    }
    const boxes = segmentDigits(grey);
    if (boxes.length !== text.length) continue;
    used++;
    boxes.forEach((b, k) =>
      samples.push({
        label: Number(text[k]),
        bitmap: Array.from(normalizeDigit(grey, b)),
        card: Number(card),
        row: Number(row),
        value: Number(value),
        source: name,
      }),
    );
  }
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ source: name, samples }));
  console.log(`${name}: ${rows.length} checked boxes, ${used} cut cleanly, ${samples.length} digits`);
}
