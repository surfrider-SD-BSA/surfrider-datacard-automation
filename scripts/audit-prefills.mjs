/**
 * Every cell the tool would PRE-FILL, rendered so it can be counted by eye.
 *
 * This is the check that matters before `PREFILL_GATE` in `src/main.ts` is
 * lowered, and it is the only instrument in this repository that has ever
 * caught the failure it exists for. The counter's spreadsheet score is a lower
 * bound and absorbed it; both offline diagnostics agreed with the browser; every
 * unit test passed. What found it was listing the cells that would actually
 * reach a volunteer -- 44 of them across 27 scans -- and looking at each one.
 * Three had counted the printed border of the TOTAL box as a stroke, one of them
 * returning a number for a strip with no tally in it, at the top confidence this
 * tool issues. No threshold separates that from a correct reading, which is the
 * whole reason a confidence gate cannot be trusted to do this job alone.
 *
 * So: this renders the strip a person would be shown, and its CONTEXT -- the
 * same columns over a taller slice of the page, with the row's own band ruled
 * off -- because a printed border is only distinguishable from a pen stroke by
 * what it does in the rows above and below. Count the strokes between the two
 * bright marks; anything running past them is not a volunteer's.
 *
 * Usage:
 *   npx vite-node scripts/audit-prefills.mjs -- [--only <scan>]
 *     [--gate N]      the confidence to audit at; must match PREFILL_GATE in
 *                     src/main.ts, which is what the tool actually fills at
 *     [--no-show]     list the cells without rendering them
 *     [--per N]       cells per contact sheet (default 12)
 *     [--debug]       print the segments the decomposition found for each cell,
 *                     which is how a wrong count gets attributed to a cause
 *
 * Writes out/audit/tiles/<n>-<scan>-card<n>-row<n>-said<n>.png, one per cell,
 * and scores what it found against eye-labels/prefill-audit.json.
 * `scripts/sweep-row-escape.mjs` reads the same labels to set the bar that
 * refuses a neighbouring row's ink.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { countTally, _debugSegments } from "../src/lib/tally.ts";
import { reconcile } from "../src/lib/reading.ts";
import { itemForRow } from "../src/lib/taxonomy.ts";
import { colName, readSpreadsheet, scan } from "./diagnose-review.mjs";
import { sheet } from "./review-sheets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Strip and context side by side, with the row band marked on the context.
 *
 * The two dark ticks down the context's left edge are where the strip itself
 * starts and ends -- `tallyContext` in diagnose-review.mjs takes 0.6 of the
 * strip's height above and below, so the band is the middle. Without them a
 * reader cannot tell which strokes belong to this row, and telling that is the
 * entire purpose of looking at the context.
 */
function auditTile(cell) {
  const gap = 8;
  const strip = cell.tally;
  const ctx = cell.tallyCtx;
  const width = strip.width + gap + ctx.width;
  const height = Math.max(strip.height, ctx.height);
  const gray = new Uint8Array(width * height).fill(90);

  const blit = (img, ox, oy) => {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        gray[(oy + y) * width + ox + x] = img.gray[y * img.width + x];
      }
    }
  };
  blit(strip, 0, Math.floor((height - strip.height) / 2));
  const ctxY = Math.floor((height - ctx.height) / 2);
  blit(ctx, strip.width + gap, ctxY);

  // Where the row's own band sits inside the context.
  const margin = Math.round((ctx.height - strip.height) / 2);
  for (const y of [ctxY + margin, ctxY + ctx.height - margin - 1]) {
    for (let x = strip.width + gap; x < width; x += 6) {
      gray[y * width + x] = 0;
      gray[y * width + x + 1] = 0;
    }
  }
  return { width, height, gray };
}

function auditScan(name, dir, sheetPath, gate, debug) {
  const s = scan(dir);

  const typed = new Map();
  if (sheetPath) {
    const book = readSpreadsheet(sheetPath);
    for (let card = 1; card <= s.cards; card++) {
      const column = book.get(colName(2 + card));
      if (!column) continue;
      for (const [row, raw] of column) {
        const n = Math.round(Number(raw));
        if (!Number.isFinite(n) || n <= 0) continue;
        if (!itemForRow(row)) continue;
        typed.set(`${card}:${row}`, n);
      }
    }
  }

  const hits = [];
  for (const c of s.cells) {
    // Exactly the cells `extract.ts` counts, which is not every marked strip:
    // where the volunteer also wrote the total, the number is what the reviewer
    // reads and the tally beside it is their working. Auditing the strips the
    // tool never pre-fills from would measure the wrong population -- it put
    // 31 cells on 3.15 Imperial alone into the first run of this script, most
    // of them cells whose box already holds the answer.
    if (!c.tallyMarked || c.hasValue) continue;
    const t = countTally(
      { width: c.tally.width, height: c.tally.height, data: c.tally.gray },
      { context: { width: c.tallyCtx.width, height: c.tallyCtx.height, data: c.tallyCtx.gray } },
    );
    if (t.count === null) continue;
    const reading = reconcile({ value: t.count, confidence: t.confidence }, null);
    if (!reading || reading.confidence < gate) continue;
    hits.push({ ...c, scan: name, reading: t, confidence: reading.confidence, sheet: typed.get(`${c.card}:${c.row}`) ?? null });
  }
  return { hits, cards: s.cards, marked: s.cells.filter((c) => c.tallyMarked).length };
}

/** Pair each page directory with its spreadsheet, keeping the unmatched ones. */
function allScans() {
  const pagesRoot = join(ROOT, "out", "pages");
  const sheets = readdirSync(join(ROOT, "scans")).filter((f) => /\.xlsx$/i.test(f));
  const key = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return readdirSync(pagesRoot)
    .filter((n) => !n.startsWith("."))
    .sort()
    .map((name) => {
      const [place, date] = name.split("-");
      let match = null;
      if (date) {
        const [m, d] = date.split(".").map(Number);
        const hit = sheets.find((f) => {
          const k = key(f);
          return (
            k.includes(key(place)) &&
            (k.includes(`${m}${d}25`) ||
              k.includes(`2025${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`))
          );
        });
        if (hit) match = join(ROOT, "scans", hit);
      }
      return { name, dir: join(pagesRoot, name), sheet: match };
    });
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const gate = Number(opt("--gate", "0.8"));
  const only = opt("--only", null);
  const per = Number(opt("--per", "12"));
  const show = !args.includes("--no-show");
  const debug = args.includes("--debug");

  const scans = allScans().filter((s) => !only || s.name === only);
  const out = join(ROOT, "out", "audit");
  mkdirSync(out, { recursive: true });

  const all = [];
  for (const s of scans) {
    const { hits, cards, marked } = auditScan(s.name, s.dir, s.sheet, gate, debug);
    console.log(
      `${s.name.padEnd(18)} ${String(cards).padStart(3)} cards  ` +
        `${String(marked).padStart(4)} marked strips  ` +
        `${String(hits.length).padStart(3)} would be pre-filled`,
    );
    for (const h of hits) {
      if (debug) {
        const d = _debugSegments(
          { width: h.tally.width, height: h.tally.height, data: h.tally.gray },
          {
            context: {
              width: h.tallyCtx.width,
              height: h.tallyCtx.height,
              data: h.tallyCtx.gray,
            },
          },
        );
        console.log(`    -- ${h.card}:${h.row} strip ${d.width}px wide, ${d.ink} thinned ink pixels`);
        for (const s of d.segments) {
          console.log(
            `       angle ${s.angle.toFixed(0).padStart(4)}  len ${s.length.toFixed(1).padStart(6)}` +
              `  ink ${String(s.ink).padStart(4)}  x ${s.minX}-${s.maxX}  y ${s.minY}-${s.maxY}`,
          );
        }
      }
      console.log(
        `    ${String(h.card).padStart(3)}:${String(h.row).padEnd(3)} ` +
          `count ${String(h.reading.count).padStart(2)}  conf ${h.confidence.toFixed(2)}  ` +
          `explained ${h.reading.explained.toFixed(2)}  groups [${h.reading.groups}]  ` +
          `bars ${h.reading.bars}` +
          (h.sheet === null ? "" : `   sheet ${h.sheet}`),
      );
    }
    all.push(...hits);
  }

  console.log(`\n${all.length} cells clear the gate of ${gate} across ${scans.length} scans`);

  // Score against the counts somebody read off the rendered strips.
  //
  // Keyed scan:card:row rather than by position in this list, so the labels
  // survive a change to the counter that moves which cells clear the gate --
  // which is the whole reason the earlier audit went stale and had to be redone.
  const labelPath = join(ROOT, "eye-labels", "prefill-audit.json");
  if (existsSync(labelPath)) {
    const truth = JSON.parse(readFileSync(labelPath, "utf8")).counts ?? {};
    let right = 0;
    let wrong = 0;
    let unread = 0;
    const misses = [];
    for (const h of all) {
      const key = `${h.scan}:${h.card}:${h.row}`;
      const t = truth[key];
      if (t === undefined) {
        unread++;
        continue;
      }
      if (t === h.reading.count) right++;
      else {
        wrong++;
        misses.push(`${key}  said ${h.reading.count}, is ${t}`);
      }
    }
    const scored = right + wrong;
    console.log(
      `\nagainst ${scored} counted by eye: ` +
        `${right} right, ${wrong} wrong` +
        (scored ? ` -- ${((right / scored) * 100).toFixed(1)}% precision` : "") +
        (unread ? `   (${unread} not yet read; render them and look)` : ""),
    );
    for (const m of misses) console.log(`    ${m}`);
  }

  // A machine-readable list, so a by-eye reading can be recorded against it and
  // re-scored later. The rendered sheets are captioned with the same index.
  writeFileSync(
    join(out, "prefills.json"),
    JSON.stringify(
      {
        gate,
        cells: all.map((h, i) => ({
          index: i,
          scan: h.scan,
          card: h.card,
          row: h.row,
          count: h.reading.count,
          confidence: h.confidence,
          explained: Number(h.reading.explained.toFixed(3)),
          groups: h.reading.groups,
          bars: h.reading.bars,
          sheet: h.sheet,
        })),
      },
      null,
      2,
    ),
  );

  if (show && all.length) {
    // One file per cell as well as the sheets. Counting strokes off a contact
    // sheet means reading it at whatever scale it happens to fit in, and the
    // whole value of this audit is that somebody looked closely enough to see a
    // printed border pretending to be a stroke.
    const tiles = join(out, "tiles");
    mkdirSync(tiles, { recursive: true });
    for (const [i, h] of all.entries()) {
      const name = `${String(i).padStart(2, "0")}-${h.scan}-card${h.card}-row${h.row}-said${h.reading.count}.png`;
      sheet(join(tiles, name), [auditTile(h)], 1, 3, [`${i} ${h.reading.count}`]);
    }
    console.log(`${all.length} tiles in ${tiles}`);

    for (let i = 0; i < all.length; i += per) {
      const slice = all.slice(i, i + per);
      const path = join(out, `prefill-${String(i / per).padStart(2, "0")}.png`);
      const size = sheet(
        path,
        slice.map(auditTile),
        1,
        2,
        slice.map((h, j) => `${i + j} ${h.reading.count}`),
      );
      console.log(`${path}  ${size.width}x${size.height}`);
    }
  }
}

main();
