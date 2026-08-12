/**
 * How long is the review list, and does shortening it lose anything?
 *
 * The tool's whole promise to a volunteer is that nothing they wrote is thrown
 * away silently. Shortening the list is worth a great deal -- it is a person's
 * afternoon -- but only if that promise holds, and a shape test that drops one
 * number in fifty would be worse than no filter at all.
 *
 * So this measures both, and the second measurement is the point. Given a
 * matched spreadsheet, every non-zero value the chapter typed up is a cell that
 * MUST be on the list, keyed card N to column N (the chapter's rule; see
 * label-from-spreadsheet.mjs for why no offset is ever inferred). Both the old
 * ink rule and the mark test are scored against it, because the old rule's
 * recall is the ceiling: a value it also misses is a scanning or data-entry
 * problem, not something the filter did.
 *
 * A count of dropped values is not the end of that check, though, and this is
 * the trap the whole project keeps falling into: the count is an UPPER BOUND.
 * A volunteer column typed one across, a value recorded on the other side of
 * the card, a number entered against the wrong item -- each of those looks
 * exactly like a dropped value and is not one. The only way to tell is to look,
 * so `--show` writes the dropped cells out as a contact sheet.
 *
 * Usage:
 *   node scripts/diagnose-review.mjs <dir-of-page-jpegs> [spreadsheet.xlsx] [--show]
 *   node scripts/diagnose-review.mjs --all        # every matched pair in scans/
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";

import { itemForRow } from "../src/lib/taxonomy.ts";
import {
  boxMarked,
  cropCell,
  decodeGray,
  inkFraction,
  loadPng,
  referenceTarget,
  registerBestSide,
  stripMarked,
} from "./lib/cardvision.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");

/** Mirrors INK_NEGLIGIBLE in src/lib/extract.ts. */
const INK_NEGLIGIBLE = 0.008;
/** The threshold the old rule called "written in". Kept only for comparison. */
const INK_PRESENT = 0.025;

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
    if (body.includes("<f")) continue; // column B holds SUM formulas, not data
    const v = /<v>([\s\S]*?)<\/v>/.exec(body);
    if (!v) continue;
    const value = attrs.includes('t="s"') ? shared[Number(v[1])] : v[1];
    if (value === undefined || value === "") continue;
    if (!values.has(col)) values.set(col, new Map());
    values.get(col).set(Number(rowStr), value);
  }
  return values;
}

function scan(dir) {
  const maps = {
    front: JSON.parse(readFileSync(join(REF, "cells.front.json"), "utf8")),
    back: JSON.parse(readFileSync(join(REF, "cells.back.json"), "utf8")),
  };
  const targets = {
    front: referenceTarget(loadPng(join(REF, "blank-front.png")), maps.front),
    back: referenceTarget(loadPng(join(REF, "blank-back.png")), maps.back),
  };

  const files = readdirSync(dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));

  const registered = files.map((f, i) => {
    const r = registerBestSide(decodeGray(join(dir, f)), targets);
    if ((i + 1) % 10 === 0) process.stdout.write(`\r  ${i + 1}/${files.length} pages   `);
    return { ...r, pageNumber: i + 1 };
  });

  // Pair pages into cards the way the rest of the project does. Doing it by
  // counting fronts instead looks equivalent and is not: one card fed in
  // backwards, or one page missing, shifts every card after it, and then every
  // card is compared against the wrong volunteer's column. Two of eighteen real
  // scans have a reversed card in them.
  const cards = [];
  for (let i = 0; i < registered.length; ) {
    const a = registered[i];
    const b = registered[i + 1];
    if (b && a.side !== b.side) {
      cards.push({ number: cards.length + 1, pages: [a, b] });
      i += 2;
    } else {
      cards.push({ number: cards.length + 1, pages: [a] });
      i += 1;
    }
  }

  const cells = [];
  let refused = 0;
  let considered = 0;

  for (const card of cards) {
    for (const { side, image, trusted, pageNumber } of card.pages) {
      if (!trusted) {
        refused++;
        continue;
      }

      const map = maps[side];
      for (const cell of map.cells) {
        if (!itemForRow(cell.row)) continue;
        const excluded = (map.exclusions || []).some(
          (ex) =>
            cell.total.x < ex.x + ex.width &&
            cell.total.x + cell.total.width > ex.x &&
            cell.total.y < ex.y + ex.height &&
            cell.total.y + cell.total.height > ex.y,
        );
        if (excluded) continue;
        considered++;

        const total = cropCell(image, cell.total);
        const tally = cropCell(image, cell.tally);
        const ink = inkFraction(total);
        const tallyInk = inkFraction(tally);
        if (ink < INK_NEGLIGIBLE && tallyInk < INK_NEGLIGIBLE) continue;

        const hasValue = boxMarked(total);
        const tallyOnly = !hasValue && stripMarked(tally);
        cells.push({
          card: card.number,
          page: pageNumber,
          row: cell.row,
          ink,
          tallyInk,
          offeredNow: hasValue || tallyOnly,
          hasValueBefore: ink >= INK_PRESENT,
          total,
          tally,
        });
      }
    }
  }
  process.stdout.write("\r".padEnd(30) + "\r");

  return { cells, cards: cards.length, considered, refused, pages: files.length };
}

/** A grid of row crops -- tally strip then TOTAL box -- captioned card:row. */
function contactSheet(path, cells) {
  const gap = 6;
  const pad = 4;
  const labelH = 12;
  const tileW = Math.max(...cells.map((c) => c.tally.width + gap + c.total.width));
  const tileH = Math.max(...cells.map((c) => Math.max(c.tally.height, c.total.height)));
  const cellH = tileH + pad * 2 + labelH;
  const png = new PNG({ width: tileW + pad * 2, height: cells.length * cellH });
  png.data.fill(150);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;

  const put = (x, y, v) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const p = (y * png.width + x) * 4;
    png.data[p] = png.data[p + 1] = png.data[p + 2] = v;
  };
  const FONT = {
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
    ":": ["000", "010", "000", "010", "000"],
  };

  cells.forEach((c, i) => {
    const oy = i * cellH + pad;
    const blit = (img, ox) => {
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) put(ox + x, oy + y, img.gray[y * img.width + x]);
      }
    };
    blit(c.tally, pad);
    blit(c.total, pad + c.tally.width + gap);
    let tx = pad;
    for (const ch of `${c.card}:${c.row}`) {
      const glyph = FONT[ch];
      if (glyph) {
        for (let gy = 0; gy < 5; gy++) {
          for (let gx = 0; gx < 3; gx++) {
            if (glyph[gy][gx] === "1") {
              for (let sy = 0; sy < 2; sy++) {
                for (let sx = 0; sx < 2; sx++) put(tx + gx * 2 + sx, oy + tileH + 3 + gy * 2 + sy, 0);
              }
            }
          }
        }
      }
      tx += 8;
    }
  });
  writeFileSync(path, PNG.sync.write(png));
}

function report(name, dir, sheetPath, show = false) {
  const s = scan(dir);
  const before = s.cells.length;
  const after = s.cells.filter((c) => c.offeredNow).length;

  let recall = "";
  if (sheetPath) {
    const sheet = readSpreadsheet(sheetPath);
    const offered = new Map();
    for (const c of s.cells) offered.set(`${c.card}:${c.row}`, c);

    let values = 0;
    let missedBefore = 0;
    const missedNow = [];
    for (let card = 1; card <= s.cards; card++) {
      const column = sheet.get(colName(2 + card));
      if (!column) continue;
      for (const [row, raw] of column) {
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n) || n <= 0) continue;
        if (!itemForRow(row)) continue;
        values++;
        const cell = offered.get(`${card}:${row}`);
        if (!cell) missedBefore++;
        else if (!cell.offeredNow) missedNow.push(cell);
      }
    }
    if (show && missedNow.length) {
      const out = join(ROOT, "out", "review", name);
      mkdirSync(out, { recursive: true });
      const PER = 24;
      for (let i = 0; i < missedNow.length; i += PER) {
        const path = join(out, `dropped-values-${String(i / PER).padStart(2, "0")}.png`);
        contactSheet(path, missedNow.slice(i, i + PER));
        console.log(`  wrote ${path}`);
      }
    }
    recall =
      `  values typed up ${String(values).padStart(4)}  ` +
      `not offered before ${String(missedBefore).padStart(3)}  ` +
      `dropped by the mark test ${String(missedNow.length).padStart(3)}` +
      (missedNow.length
        ? `  [${missedNow.slice(0, 12).map((c) => `${c.card}:${c.row}`).join(" ")}]`
        : "");
  }

  console.log(
    `${name.padEnd(16)} ${String(s.cards).padStart(3)} cards  ` +
      `list ${String(before).padStart(4)} -> ${String(after).padStart(4)}  ` +
      `(${(before / s.cards).toFixed(1)} -> ${(after / s.cards).toFixed(1)} per card, ` +
      `${Math.round((1 - after / before) * 100)}% shorter)` +
      (s.refused ? `  ${s.refused} pages refused` : ""),
  );
  if (recall) console.log(recall);
  return { name, before, after, cards: s.cards };
}

/** Pair each out/pages/<name> with the spreadsheet in scans/ for the same event. */
function matchedPairs() {
  const pagesRoot = join(ROOT, "out", "pages");
  const sheets = readdirSync(join(ROOT, "scans")).filter((f) => /\.xlsx$/i.test(f));
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out = [];
  for (const name of readdirSync(pagesRoot)) {
    const [place, date] = name.split("-");
    if (!date) continue;
    const [m, d] = date.split(".").map(Number);
    const hit = sheets.find((f) => {
      const k = key(f);
      return (
        k.includes(key(place)) &&
        (k.includes(`${m}${d}25`) || k.includes(`${m}_${d}_25`.replace(/_/g, "")) || k.includes(`2025${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`))
      );
    });
    if (hit) out.push({ name, dir: join(pagesRoot, name), sheet: join(ROOT, "scans", hit) });
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--all") {
    const pairs = matchedPairs();
    console.log(`${pairs.length} matched (scan, spreadsheet) pairs\n`);
    const totals = { before: 0, after: 0, cards: 0 };
    for (const p of pairs) {
      const r = report(p.name, p.dir, p.sheet);
      totals.before += r.before;
      totals.after += r.after;
      totals.cards += r.cards;
    }
    console.log(
      `\nall scans: ${totals.cards} cards, list ${totals.before} -> ${totals.after} ` +
        `(${(totals.before / totals.cards).toFixed(1)} -> ${(totals.after / totals.cards).toFixed(1)} per card, ` +
        `${Math.round((1 - totals.after / totals.before) * 100)}% shorter)`,
    );
    return;
  }

  const dir = args[0];
  if (!dir || !existsSync(dir)) {
    console.error("usage: node scripts/diagnose-review.mjs <dir-of-page-jpegs> [spreadsheet.xlsx] [--show]");
    console.error("       node scripts/diagnose-review.mjs --all");
    process.exit(1);
  }
  report(dir.replace(/\/$/, "").split("/").pop(), dir, args[1], args.includes("--show"));
}

main();
