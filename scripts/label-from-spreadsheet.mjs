/**
 * Turn a matched (scanned PDF, completed spreadsheet) pair into labelled
 * training data, automatically.
 *
 * This is the whole reason matched pairs matter. The PDF supplies the picture
 * of the handwriting; the spreadsheet supplies what a person read it as. Card N
 * of the scan is volunteer column N of the sheet, so every non-zero cell in the
 * sheet labels a specific TOTAL box in the scan, and nobody has to label
 * anything by hand.
 *
 * The card-to-column assumption is checked rather than trusted. If the person
 * entering the data skipped a blank card or worked out of order, the mapping
 * shifts and every label after that point is wrong -- which would poison the
 * training set silently. So the script compares where it finds ink against
 * where the sheet has numbers, and reports the agreement per card. A card that
 * disagrees is dropped, not guessed at.
 *
 * Usage:
 *   node scripts/label-from-spreadsheet.mjs <pages-dir> <spreadsheet.xlsx> <name>
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

import { TAXONOMY, itemForRow } from "../src/lib/taxonomy.ts";
import {
  classify,
  cropCell,
  decodeGray,
  inkFraction,
  loadPng,
  registerTo,
  segmentDigits,
  normalizeDigit,
} from "./lib/cardvision.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
const OUT = join(ROOT, "out", "training");

/** Ink coverage above which a TOTAL box is treated as written in. */
const INK_PRESENT = 0.025;

/**
 * A card must agree with its column on at least this share of rows to be
 * trusted. Below it, the card-to-column mapping is probably off and the labels
 * would be worse than useless.
 */
const MIN_AGREEMENT = 0.9;

// ---------------------------------------------------------------------------

function colName(index) {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Read a completed datasheet into { column -> { row -> value } }. */
function readSpreadsheet(path) {
  const parts = unzipSync(new Uint8Array(readFileSync(path)));
  const dec = new TextDecoder();

  const shared = [];
  if (parts["xl/sharedStrings.xml"]) {
    const sx = dec.decode(parts["xl/sharedStrings.xml"]);
    for (const si of sx.split("<si>").slice(1)) {
      shared.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
    }
  }

  const sheet = dec.decode(parts["xl/worksheets/sheet1.xml"]);
  const values = new Map();

  for (const m of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
    const [, col, rowStr, attrs, body] = m;
    // Skip formula cells: column B holds the SUM totals, not volunteer data.
    if (body.includes("<f")) continue;

    const v = /<v>([\s\S]*?)<\/v>/.exec(body);
    if (!v) continue;

    let value = attrs.includes('t="s"') ? shared[Number(v[1])] : v[1];
    if (value === undefined || value === "") continue;

    if (!values.has(col)) values.set(col, new Map());
    values.get(col).set(Number(rowStr), value);
  }
  return values;
}

function main() {
  const [pagesDir, sheetPath, name] = process.argv.slice(2);
  if (!pagesDir || !sheetPath || !name) {
    console.error(
      "usage: node scripts/label-from-spreadsheet.mjs <pages-dir> <spreadsheet.xlsx> <name>",
    );
    process.exit(1);
  }

  const refs = {
    front: loadPng(join(REF, "blank-front.png")),
    back: loadPng(join(REF, "blank-back.png")),
  };
  const maps = {
    front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")),
    back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")),
  };

  const sheet = readSpreadsheet(sheetPath);
  const dataCols = [...sheet.keys()]
    .filter((c) => c !== "A" && c !== "B")
    .filter((c) => [...sheet.get(c).keys()].some((r) => r >= 18));
  console.log(`spreadsheet: ${dataCols.length} volunteer columns with data`);

  const files = readdirSync(pagesDir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));
  console.log(`scan: ${files.length} pages -> ${files.length / 2} cards`);

  // ---- pass 1: register every page and note which cells carry ink ----
  const pages = [];
  files.forEach((f, i) => {
    const page = decodeGray(join(pagesDir, f));
    const { side, agree } = classify(page);
    const registered = registerTo(page, refs[side]);
    pages.push({ index: i, side, agree, image: registered });
    if ((i + 1) % 20 === 0) process.stdout.write(`\r  registered ${i + 1}/${files.length}   `);
  });
  process.stdout.write("\n");

  // ---- pair into cards ----
  const cards = [];
  for (let i = 0; i + 1 < pages.length; i += 2) {
    const a = pages[i];
    const b = pages[i + 1];
    if (a.side !== "front" || b.side !== "back") {
      console.log(`  WARNING pages ${i + 1}-${i + 2} are ${a.side}/${b.side}, not front/back`);
    }
    cards.push({ number: cards.length + 1, front: a, back: b });
  }

  // ---- pass 2: label each card from its column, checking agreement ----
  const samples = [];
  const perCard = [];
  let usedCards = 0;

  for (const card of cards) {
    const col = colName(2 + card.number); // card 1 -> C
    const column = sheet.get(col);
    if (!column) {
      perCard.push({ card: card.number, col, status: "no column in sheet" });
      continue;
    }

    const observed = [];
    for (const item of TAXONOMY) {
      const map = maps[item.side];
      const cellDef = map.cells.find((c) => c.row === item.row);
      if (!cellDef) continue;

      const excluded = (map.exclusions || []).some(
        (ex) =>
          cellDef.total.x < ex.x + ex.width &&
          cellDef.total.x + cellDef.total.width > ex.x &&
          cellDef.total.y < ex.y + ex.height &&
          cellDef.total.y + cellDef.total.height > ex.y,
      );
      if (excluded) continue;

      const page = item.side === "front" ? card.front : card.back;
      const box = cropCell(page.image, cellDef.total);
      const ink = inkFraction(box);

      const raw = column.get(item.row);
      const expected = raw === undefined ? 0 : Math.round(Number(raw));
      observed.push({ item, box, ink, expected: Number.isFinite(expected) ? expected : 0 });
    }

    // Check the mapping in the one direction that actually tests it: where
    // there IS ink in a TOTAL box, the sheet should have a number for that row.
    //
    // The reverse is not a fault and must not be scored. A volunteer who only
    // tallied leaves the TOTAL box empty; the person entering the data counted
    // the marks and typed a number anyway. Scoring both directions treated that
    // as a mismatch and rejected all 31 cards of a scan whose mapping was
    // in fact correct, at a suspiciously uniform 70-85% on every single card.
    const inked = observed.filter((o) => o.ink >= INK_PRESENT);
    const matched = inked.filter((o) => o.expected > 0).length;
    const rate = inked.length ? matched / inked.length : 0;

    const written = observed.filter((o) => o.expected > 0).length;
    const tallyOnly = observed.filter((o) => o.expected > 0 && o.ink < INK_PRESENT).length;

    if (rate < MIN_AGREEMENT) {
      perCard.push({
        card: card.number, col, status: `only ${(rate * 100).toFixed(0)}% of inked cells have a value -- dropped`,
        written, tallyOnly, inked: inked.length,
      });
      continue;
    }
    usedCards++;
    perCard.push({
      card: card.number, col, status: `ok ${(rate * 100).toFixed(0)}%`,
      written, tallyOnly, inked: inked.length,
    });

    // Emit digit samples for cells the sheet says hold a number.
    for (const o of observed) {
      if (o.expected <= 0) continue;
      const text = String(o.expected);
      const boxes = segmentDigits(o.box);
      // Only usable when the segmentation agrees with the known digit count.
      if (boxes.length !== text.length) continue;

      boxes.forEach((b, k) => {
        samples.push({
          label: Number(text[k]),
          bitmap: Array.from(normalizeDigit(o.box, b)),
          card: card.number,
          row: o.item.row,
          value: o.expected,
          source: name,
        });
      });
    }
  }

  console.log("\nper card:");
  for (const c of perCard) {
    console.log(
      `  card ${String(c.card).padStart(2)} -> ${c.col.padEnd(3)} ${c.status}` +
        (c.written !== undefined
          ? `  (${c.inked} inked, ${c.written} in sheet, ${c.tallyOnly} tally-only)`
          : ""),
    );
  }

  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `${name}.json`);
  writeFileSync(path, JSON.stringify({ source: name, samples }));

  const perClass = new Array(10).fill(0);
  for (const s of samples) perClass[s.label]++;

  console.log(`\ncards used: ${usedCards}/${cards.length}`);
  console.log(`labelled digits: ${samples.length}`);
  console.log(`per class: ${perClass.map((n, i) => `${i}:${n}`).join("  ")}`);
  console.log(`wrote ${path}`);
}

main();
