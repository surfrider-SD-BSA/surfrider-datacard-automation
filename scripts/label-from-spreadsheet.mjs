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
 * Every card gets its own column. That is the chapter's rule and it is not
 * negotiable by this script -- no offset is ever inferred. What does happen is
 * that a person typing up thirty cards occasionally makes a mistake: a card
 * into the wrong column, one entered twice, one missed. One here and there
 * does not matter to the chapter's data. It matters a great deal to a training
 * set, because a mis-typed card labels every digit on it with someone else's
 * numbers.
 *
 * So the mapping is trusted by default and checked per card, and a card that
 * fails is dropped while the rest of the scan is kept.
 *
 * ---------------------------------------------------------------------------
 * Two things this script used to do, and why it no longer does either.
 *
 * A PER-CARD GATE at 90% agreement. A volunteer who writes `0` in every box
 * leaves ink where the sheet -- which omits zeros -- has nothing, so a
 * perfectly registered card scored near zero and was thrown away. Across
 * eleven scans it dropped 150 of 204 cards, most of them good. What actually
 * keeps bad samples out is the per-cell filter below: the segmentation must
 * find exactly as many digits as the sheet's number has.
 *
 * A FITTED PER-CARD COLUMN DRIFT. Several scans agree better one column over,
 * and it was tempting to fit a drift to explain it. The evidence was real but
 * it was the wrong evidence: ink-presence agreement is scored on WHERE the ink
 * is, and two neighbouring volunteer columns are both sparse in similar rows,
 * so a wrong column matches the ink pattern while every value on it is wrong.
 * Training on the result caught it -- drift-fitted scans classified at 26.7%
 * against their own 36.4% guess-the-commonest baseline, which is what labels
 * from the wrong column look like. There is no drift to fit: every card gets
 * its own column, and what looks like drift is somebody's typing mistake.
 * ---------------------------------------------------------------------------
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
  referenceTarget,
  cropCell,
  decodeGray,
  inkFraction,
  loadPng,
  registerBestSide,
  segmentDigits,
  normalizeDigit,
} from "./lib/cardvision.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");
const OUT = join(ROOT, "out", "training");

/** Ink coverage above which a TOTAL box is treated as written in. */
const INK_PRESENT = 0.025;

/**
 * Scan-level floor: below this the PDF and the spreadsheet are not a pair.
 *
 * Measured on where-the-ink-is agreement. Two unrelated columns score 25-40%,
 * because both are sparse in similar rows. This catches only the gross failure
 * -- the wrong two files handed to the script. Individual mis-typed cards are
 * caught per card by MIN_DIGIT_AGREEMENT, which is where they belong: a scan
 * with one bad card in thirty is a normal scan, not a broken one.
 */
const MIN_AGREEMENT = 0.3;

/**
 * A card is dropped if fewer than this share of its written cells have the
 * number of digits the sheet says they should.
 *
 * Why digit count and not "the sheet has a number here". That was the old
 * per-card gate and it fails on a volunteer who writes `0` in every box: the
 * sheet omits zeros, so a perfectly typed card looks like a total mismatch. It
 * dropped 150 of 204 cards, most of them good. Digit count only looks at cells
 * where the card HAS ink and the sheet HAS a number, so zeros and blanks are
 * simply not part of the comparison.
 *
 * It is a blunt instrument -- most counts on a beach card are single digits, so
 * a wrong column still agrees about half the time by chance -- which is why the
 * bar is low and why cards are trusted by default. It is meant to catch the
 * card typed into the wrong column, not to audit the chapter's data entry.
 */
const MIN_DIGIT_AGREEMENT = 0.6;

/**
 * Written cells a card needs before that judgement means anything. Below it the
 * card is kept: the chapter's rule is one column per card, so absence of
 * evidence is not evidence of a mistake.
 */
const MIN_CARD_EVIDENCE = 3;

/**
 * Written cells a scan needs before the offset check can decide anything.
 *
 * Below this the neighbouring columns are not distinguishable -- a one-card
 * scan scores about the same at every offset -- and refusing would be refusing
 * for want of a test rather than for a fault.
 */
const MIN_EVIDENCE = 40;

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
  const targets = {
    front: referenceTarget(refs.front, maps.front),
    back: referenceTarget(refs.back, maps.back),
  };

  const pages = [];
  files.forEach((f, i) => {
    const page = decodeGray(join(pagesDir, f));
    const { side, image, bannerOverlap, trusted } = registerBestSide(page, targets);
    pages.push({ index: i, side, image, bannerOverlap, trusted });
    if ((i + 1) % 20 === 0) process.stdout.write(`\r  registered ${i + 1}/${files.length}   `);
  });
  process.stdout.write("\n");

  const misaligned = pages.filter((p) => !p.trusted);
  const scores = pages.map((p) => p.bannerOverlap).sort((a, b) => a - b);
  console.log(
    `banner overlap: median ${scores[scores.length >> 1].toFixed(3)}, ` +
      `worst ${scores[0].toFixed(3)}, ${misaligned.length} page(s) refused` +
      (misaligned.length ? `: ${misaligned.map((p) => p.index + 1).join(", ")}` : ""),
  );

  // ---- pair into cards ----
  //
  // Either order is one card: a card fed into the scanner the wrong way round
  // comes out back-then-front, and both pages still belong to the same card.
  // Two of eighteen scans have exactly one of those. Same side twice means a
  // page is missing, and then the card is taken alone so that one bad page
  // costs one card rather than shifting every card after it.
  const cards = [];
  let reversed = 0;
  for (let i = 0; i < pages.length; ) {
    const a = pages[i];
    const b = pages[i + 1];
    if (b && a.side !== b.side) {
      if (a.side === "back") reversed++;
      cards.push({
        number: cards.length + 1,
        front: a.side === "front" ? a : b,
        back: a.side === "front" ? b : a,
      });
      i += 2;
    } else {
      console.log(
        `  WARNING page ${i + 1}${b ? ` and ${i + 2} are both ${a.side}s` : " has no partner"}` +
          ` -- taking it as a one-sided card`,
      );
      cards.push({
        number: cards.length + 1,
        front: a.side === "front" ? a : null,
        back: a.side === "back" ? a : null,
      });
      i += 1;
    }
  }
  if (reversed) console.log(`${reversed} card(s) scanned back-side first, paired anyway`);

  // ---- pass 2: crop every cell of every card ----
  for (const card of cards) {
    card.cells = [];
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
      // A page that would not align is not cropped from: its cells would come
      // from the wrong part of the card and would label digits with whatever
      // the sheet happens to say for a row nobody read.
      if (!page?.trusted) continue;

      const box = cropCell(page.image, cellDef.total);
      card.cells.push({
        item,
        box,
        ink: inkFraction(box),
        // The tally area matters here only for deciding whether a card is
        // wholly blank: a card that was tallied but never totalled still gets
        // a column, so it must not count as skipped.
        tallyInk: inkFraction(cropCell(page.image, cellDef.tally)),
      });
    }
  }

  /** What the sheet holds for a card's row, in the column `offset` to its right. */
  const rawValue = (card, row, offset) => {
    const column = sheet.get(colName(2 + card.number + offset));
    const raw = column?.get(row);
    const n = raw === undefined ? 0 : Math.round(Number(raw));
    return Number.isFinite(n) ? n : 0;
  };

  // ---- the mapping is card N to column N, or the scan is not used ----
  //
  // An earlier version fitted a per-card column drift, on the evidence that
  // some scans agree far better one column over. That evidence was real but it
  // was the wrong evidence: agreement is scored on WHERE the ink is, and two
  // neighbouring volunteer columns are both sparse in similar rows, so a wrong
  // column can match the ink pattern while every value on it is wrong.
  //
  // It was caught by training on the result. Digits from scans where no drift
  // was fitted classify at 63% against a 42% always-guess-the-commonest
  // baseline; digits from the drift-fitted scans classify at 26.7% against
  // their 36.4% baseline -- worse than guessing, which is what labels drawn
  // from the wrong column look like. Reading the cells by eye against the
  // fitted values confirmed it.
  //
  // So no drift is inferred. Card N is column N, that assumption is tested
  // below, and a scan that fails is refused rather than guessed at. Recovering
  // the refused scans needs a person to establish how those sheets were filled
  // in; it is not something the pixels can settle.
  for (const card of cards) card.offset = 0;

  /** What the sheet holds for a card's row, at an offset from its own column. */
  const sheetValue = (card, row, offset = 0) => rawValue(card, row, offset);

  // ---- verify the card-to-column mapping, for this scan, before using it ----
  //
  // Scored in the one direction that tests it: where there IS ink in a TOTAL
  // box, the sheet should have a number for that row. The reverse is not a
  // fault -- a volunteer who only tallied leaves the box empty while the person
  // entering the data counted the marks and typed a number anyway.
  //
  // The absolute rate is not meaningful on its own (volunteers who write `0`
  // depress it, since the sheet omits zeros), so it is compared against the
  // same measurement at wrong offsets. Only the true mapping should stand out.
  const precision = new Map();
  for (let offset = -3; offset <= 3; offset++) {
    let hit = 0;
    let total = 0;
    for (const card of cards) {
      for (const c of card.cells) {
        if (c.ink < INK_PRESENT) continue;
        total++;
        if (sheetValue(card, c.item.row, offset) > 0) hit++;
      }
    }
    precision.set(offset, total ? hit / total : 0);
  }

  const atZero = precision.get(0);
  const bestWrong = Math.max(...[...precision].filter(([o]) => o !== 0).map(([, p]) => p));
  const evidence = cards.reduce(
    (n, c) => n + c.cells.filter((x) => x.ink >= INK_PRESENT).length,
    0,
  );
  console.log(
    "card-to-column check: " +
      [...precision].map(([o, p]) => `${o >= 0 ? "+" : ""}${o}:${(p * 100).toFixed(0)}%`).join("  "),
  );

  // A handful of written cells cannot separate the true mapping from its
  // neighbours -- on a one-card scan every offset scores about the same, and
  // refusing on that is refusing for lack of a test rather than for a fault.
  if (evidence < MIN_EVIDENCE) {
    console.log(
      `  inconclusive: only ${evidence} written cells in the whole scan, which ` +
        `cannot distinguish one column from the next. Proceeding on the ` +
        `chapter's card-N-to-column-N convention.`,
    );
  } else if (atZero < MIN_AGREEMENT) {
    // A whole scan below the noise band means the wrong spreadsheet, not a
    // typing slip. Individual mistakes are handled per card further down; this
    // only catches a mismatched pair of files.
    console.error(
      `\nREFUSED: this spreadsheet does not appear to go with this PDF ` +
        `(the cards agree with their own columns on only ` +
        `${(atZero * 100).toFixed(0)}% of written cells, and unrelated columns ` +
        `score 25-40%). No labels written.`,
    );
    process.exit(1);
  }

  // ---- emit labels, card by card ----
  //
  // Each card is checked against its own column before any of its digits are
  // used, and dropped on its own if it disagrees. Dropping one card costs a
  // dozen training digits; keeping a mis-typed one poisons a dozen with another
  // volunteer's numbers, and there is nothing downstream that could notice.
  const samples = [];
  const perCard = [];

  for (const card of cards) {
    let written = 0;
    let tallyOnly = 0;
    let inked = 0;

    // Pass A: how well does this card's handwriting agree with this column?
    const candidates = [];
    let agree = 0;
    let comparable = 0;

    for (const c of card.cells) {
      const expected = sheetValue(card, c.item.row);
      if (c.ink >= INK_PRESENT) inked++;
      if (expected > 0) {
        written++;
        if (c.ink < INK_PRESENT) tallyOnly++;
      }
      if (expected <= 0) continue;

      const text = String(expected);
      const boxes = segmentDigits(c.box);
      const matches = boxes.length === text.length;

      // The GATE is judged only on cells with clear ink, because that is where
      // a digit count means something: an empty box segments into nothing and
      // would count as a disagreement on every tally-only cell.
      if (c.ink >= INK_PRESENT) {
        comparable++;
        if (matches) agree++;
      }

      // What gets EMITTED is any cell whose segmentation found as many digits
      // as the sheet's number has, ink threshold or not. A faint but correctly
      // segmented pencil digit is exactly the kind of training example worth
      // having, and the ink threshold is tuned for a different question.
      if (matches) candidates.push({ box: c.box, boxes, text, row: c.item.row, value: expected });
    }

    const rate = comparable ? agree / comparable : 1;
    const judged = comparable >= MIN_CARD_EVIDENCE;
    const keep = !judged || rate >= MIN_DIGIT_AGREEMENT;

    perCard.push({
      card: card.number,
      col: colName(2 + card.number),
      inked,
      written,
      tallyOnly,
      emitted: keep ? candidates.length : 0,
      rate,
      comparable,
      dropped: !keep,
    });
    if (!keep) continue;

    // Pass B: emit. A cell is only usable where the segmentation found exactly
    // as many digits as the sheet's number has -- otherwise its digit
    // boundaries are wrong by definition, whatever the card's overall score.
    for (const c of candidates) {
      c.boxes.forEach((b, k) => {
        samples.push({
          label: Number(c.text[k]),
          bitmap: Array.from(normalizeDigit(c.box, b)),
          card: card.number,
          row: c.row,
          value: c.value,
          source: name,
        });
      });
    }
  }

  const droppedCards = perCard.filter((c) => c.dropped);
  if (droppedCards.length) {
    console.log(
      `dropped ${droppedCards.length} card(s) that disagree with their column: ` +
        droppedCards
          .map((c) => `${c.card}->${c.col} (${Math.round(c.rate * 100)}% of ${c.comparable})`)
          .join(", "),
    );
  }

  const usedCards = perCard.filter((c) => c.emitted > 0).length;

  console.log("\nper card:");
  for (const c of perCard) {
    console.log(
      `  card ${String(c.card).padStart(2)} -> ${c.col.padEnd(3)} ` +
        `${String(c.emitted).padStart(2)} cells labelled  ` +
        `(${c.inked} inked, ${c.written} in sheet, ${c.tallyOnly} tally-only)`,
    );
  }

  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `${name}.json`);
  writeFileSync(path, JSON.stringify({ source: name, samples }));

  const perClass = new Array(10).fill(0);
  for (const s of samples) perClass[s.label]++;

  console.log(`\ncards yielding digits: ${usedCards}/${cards.length}`);
  console.log(`labelled digits: ${samples.length}`);
  console.log(`per class: ${perClass.map((n, i) => `${i}:${n}`).join("  ")}`);
  console.log(`wrote ${path}`);
}

main();
