/**
 * Derive the cell map from the synthesized blank card.
 *
 * Produces the pixel rectangle of every TOTAL box and tally area on the
 * registered card, keyed to the spreadsheet row it feeds. Everything
 * downstream -- cropping a cell for review, recognizing a digit, writing the
 * value into the right spreadsheet row -- is built on these coordinates.
 *
 * ---------------------------------------------------------------------------
 * How this works, and why not the obvious way.
 *
 * The obvious approach is to detect the printed ruling and treat the boxes
 * between rules as cells. That was tried and abandoned. Compositing 41 scans
 * to erase the handwriting also averages down the 1px hairlines, because
 * sub-pixel alignment differences smear them across 2-3px; in the reference
 * they sit barely above the paper. Detection then hinged entirely on
 * thresholds, and every threshold that fixed one block broke another.
 *
 * Worse, the failure was silent. Rows were matched to the taxonomy in order,
 * so a single stray text cluster above the grid (the instructions block) or
 * below it (the donation footer) shifted every item onto the wrong spreadsheet
 * row while still producing a plausible-looking result.
 *
 * What is measured here instead is the SECTION BANNER -- the solid dark bar
 * over each section. Banners are the most unambiguous mark on the card: they
 * ink ~90% of the block's width where a caption inks ~10%, a 9:1 separation
 * that needs no tuning. They give each section's exact extent, and the
 * taxonomy gives the exact number of items inside it. Rows are then found by
 * clustering the item captions with the merge distance TUNED PER SECTION until
 * the cluster count equals the count the taxonomy demands.
 *
 * That last step is what makes this reliable: the answer is constrained by
 * data we already trust, rather than by a threshold that happens to work.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node scripts/detect-cells.mjs [--debug]
 *
 * Reads  assets/reference/lines-{front,back}.png   (grid detection)
 *        assets/reference/blank-{front,back}.png   (debug overlay)
 * Writes assets/reference/cells.{front,back}.json
 *        assets/reference/debug-grid-{front,back}.png   (with --debug)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

import { TAXONOMY } from "../src/lib/taxonomy.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REF = join(ROOT, "assets", "reference");

/** Reference scans are 200 DPI (ScanSnap iX1600). */
const REFERENCE_DPI = 200;

/** Ink threshold on the composited reference, which is paper-white at ~205. */
const INK = 200;

/** A banner inks this much of the block's width; a caption never does. */
const BANNER_COVERAGE = 0.5;

/** Plausible width of the printed TOTAL column, in reference pixels. */
const TOTAL_WIDTH_RANGE = [95, 185];

/**
 * Bottom of the usable grid, as a fraction of page height.
 * Below this on the front is the donation footer, whose bold text would
 * otherwise be clustered as item rows.
 */
const GRID_BOTTOM = { front: 0.935, back: 0.965 };
const GRID_TOP = { front: 0.26, back: 0.02 };

function loadGray(path) {
  const png = PNG.sync.read(readFileSync(path));
  const { width, height } = png;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (png.data[p] * 299 + png.data[p + 1] * 587 + png.data[p + 2] * 114) / 1000;
  }
  return { width, height, gray };
}

/** Mean darkness of each column over a rectangle. */
function profileX({ width, gray }, y0, y1, x0, x1) {
  const prof = new Float64Array(x1 - x0);
  for (let y = y0; y < y1; y++) {
    const off = y * width;
    for (let x = x0; x < x1; x++) prof[x - x0] += 255 - gray[off + x];
  }
  for (let i = 0; i < prof.length; i++) prof[i] /= y1 - y0;
  return prof;
}

/** Mean darkness of each row over a rectangle. */
function profileY({ width, gray }, x0, x1, y0, y1) {
  const prof = new Float64Array(y1 - y0);
  for (let y = y0; y < y1; y++) {
    const off = y * width;
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += 255 - gray[off + x];
    prof[y - y0] = sum / (x1 - x0);
  }
  return prof;
}

/** Local maxima standing clear of the profile's median. */
function findPeaks(prof, { minSep = 6, factor = 1.8, offset = 0 } = {}) {
  const sorted = Float64Array.from(prof).sort();
  const threshold = sorted[sorted.length >> 1] * factor;

  const candidates = [];
  for (let i = 1; i < prof.length - 1; i++) {
    if (prof[i] < threshold) continue;
    if (prof[i] < prof[i - 1] || prof[i] < prof[i + 1]) continue;
    candidates.push(i);
  }
  candidates.sort((a, b) => prof[b] - prof[a]);

  const kept = [];
  for (const c of candidates) {
    if (kept.every((k) => Math.abs(k - c) >= minSep)) kept.push(c);
  }
  return kept.sort((a, b) => a - b).map((i) => i + offset);
}

/** Fraction of each row that is inked, across a horizontal span. */
function coverage(page, x0, x1, y0, y1) {
  const out = new Float64Array(y1 - y0);
  const span = x1 - x0;
  for (let y = y0; y < y1; y++) {
    const off = y * page.width;
    let dark = 0;
    for (let x = x0; x < x1; x++) if (page.gray[off + x] < INK) dark++;
    out[y - y0] = dark / span;
  }
  return out;
}

/**
 * The solid section banners within a block.
 *
 * Measured separation on this card: banners cover 0.5-0.9 of the block width,
 * the densest caption 0.13. Nothing here needs calibrating.
 */
function bannerBands(page, x0, x1, y0, y1) {
  const cov = coverage(page, x0, x1, y0, y1);
  const bands = [];
  let start = null;
  for (let i = 0; i < cov.length; i++) {
    if (cov[i] > BANNER_COVERAGE) {
      if (start === null) start = i;
    } else if (start !== null) {
      if (i - start >= 8) bands.push({ top: y0 + start, bottom: y0 + i - 1 });
      start = null;
    }
  }
  if (start !== null && cov.length - start >= 8) {
    bands.push({ top: y0 + start, bottom: y1 - 1 });
  }
  return bands;
}

/** Group a row-darkness profile into text clusters at a given merge distance. */
function cluster(prof, threshold, mergeGap, minSize = 6) {
  const out = [];
  let start = null;
  let gap = 0;
  for (let i = 0; i < prof.length; i++) {
    if (prof[i] >= threshold) {
      if (start === null) start = i;
      gap = 0;
    } else if (start !== null) {
      if (++gap > mergeGap) {
        if (i - gap - start >= minSize) out.push({ a: start, b: i - gap });
        start = null;
        gap = 0;
      }
    }
  }
  if (start !== null && prof.length - start >= minSize) {
    out.push({ a: start, b: prof.length - 1 });
  }
  return out;
}

/**
 * Find the item rows inside one section.
 *
 * The merge distance is searched rather than fixed. A single global value
 * cannot work: the gap between a banner and the item below it (~17px) overlaps
 * the line gap inside a three-line caption such as "Large Foam Fragments /
 * larger than a dime" (13-19px). Tight settings shattered wrapped captions
 * into extra rows, loose ones welded rows together.
 *
 * Since the taxonomy states exactly how many items the section holds, the
 * ambiguity is resolvable: try increasing merge distances and take the one
 * that yields precisely that many clusters. Larger distances merge more, so
 * cluster count falls monotonically and the scan terminates at the answer.
 */
function rowsForSection(page, x0, labelX1, top, bottom, count) {
  let prof = profileY(page, x0, labelX1, top, bottom);
  const sorted = Float64Array.from(prof).sort();
  const background = sorted[Math.floor(sorted.length * 0.1)];
  const peak = sorted[Math.floor(sorted.length * 0.97)];
  // 0.16 was too high: the "Other (write-in):" captions are set small and
  // light, fell under it entirely, and so never formed a cluster at all -- a
  // phantom strip of blank paper took the missing slot and the count still
  // came out right.
  const threshold = background + (peak - background) * 0.09;

  // Erase printed rules BEFORE trimming.
  //
  // The table's closing border is far darker than any caption -- measured at
  // 114 against a caption peak of 53 in the last back-left section. Left in, it
  // both clustered as an extra "row" and, being the lowest ink on the block,
  // dragged the trim boundary past the final caption. Order matters here: an
  // earlier version masked after trimming, so the border still set the bound
  // and the fix did nothing.
  // Scale the rule cut off the 90th percentile, not the 97th. The 97th sits
  // among the rules themselves on a section with several of them, which pushed
  // the cut above the border it was meant to remove.
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const ruleCut = Math.max(p90 * 2.5, background + 20);
  for (let i = 0; i < prof.length; i++) if (prof[i] > ruleCut) prof[i] = 0;

  // Trim to the section's actual ink before clustering.
  //
  // The last section of a block is handed a `bottom` that runs to the page
  // margin, and the blank paper below the final caption still carries the
  // table's closing rule. That was enough to cluster as a ninth "row", which
  // let a wrong solution hit the expected count exactly -- the eighth caption
  // got welded to the seventh and the phantom strip took its place.
  let first = prof.findIndex((v) => v >= threshold);
  let last = prof.length - 1;
  while (last > 0 && prof[last] < threshold) last--;
  if (first < 0) first = 0;

  const PAD = 6;
  const lo = Math.max(0, first - PAD);
  const hi = Math.min(prof.length - 1, last + PAD);
  top += lo;
  bottom = top + (hi - lo);
  prof = prof.slice(lo, hi + 1);

  // Getting the right NUMBER of clusters is not the same as getting the right
  // clusters. In the back-left "Other (Plastic / Foam)" section a merge
  // distance of 15px produced exactly 8 -- but by welding "Mini Toiletry
  // Bottles" to "Other (write-in)" into one 143px band and then counting an
  // empty strip below the table as the eighth. The count check passed and the
  // last two rows were silently wrong.
  //
  // So a candidate must also be plausible as a set of printed rows: every
  // cluster has to carry real ink, and none may be wildly taller than its
  // neighbours.
  const isPlausible = (cl, thr = threshold) => {
    const heights = cl.map((c) => c.b - c.a);
    const median = [...heights].sort((a, b) => a - b)[heights.length >> 1];

    for (const c of cl) {
      // A band of blank paper is not a row, however well it makes the count.
      let ink = 0;
      for (let i = c.a; i <= c.b; i++) ink += prof[i];
      if (ink / (c.b - c.a + 1) < thr * 0.9) return false;

      // One band swallowing two captions shows up as a height outlier.
      if (c.b - c.a > median * 2.2 + 12) return false;
    }
    return true;
  };

  // Search the ink threshold as well as the merge distance.
  //
  // A single threshold cannot serve every section for the same reason a single
  // merge distance cannot: the "Other (write-in):" captions are set small and
  // light and need a low one, while a low one elsewhere lets paper texture
  // cluster. Both are free parameters constrained by the same hard fact -- the
  // taxonomy says exactly how many items the section holds -- so searching the
  // pair and keeping only plausible fits is well-posed.
  //
  // Among fits, prefer the least-merged (smallest tallest cluster): merging two
  // captions into one row is the failure that silently mis-assigns items.
  let best = null;
  let suspect = null;

  for (let f = 0.06; f <= 0.32001; f += 0.01) {
    const thr = background + (peak - background) * f;
    for (let gap = 4; gap <= 70; gap++) {
      const cl = cluster(prof, thr, gap);
      if (cl.length < count) break; // merged past the target
      if (cl.length !== count) continue;

      const tallest = Math.max(...cl.map((c) => c.b - c.a));
      if (isPlausible(cl, thr)) {
        if (!best || tallest < best.tallest) {
          best = { clusters: cl, mergeGap: gap, threshold: thr, tallest, exact: true };
        }
      } else if (!suspect) {
        suspect = { clusters: cl, mergeGap: gap, threshold: thr, exact: true, suspect: true };
      }
    }
  }
  if (best) return best;
  if (suspect) return suspect;

  // Nothing matched. Fall back to dividing the section evenly, which is at
  // least structurally correct for a printed form, and say so loudly.
  const step = (bottom - top) / count;
  const clusters = [];
  for (let i = 0; i < count; i++) {
    clusters.push({ a: Math.round(i * step + step * 0.25), b: Math.round((i + 1) * step - step * 0.25) });
  }
  return { clusters, mergeGap: null, exact: false };
}

/** Expand caption clusters into full-height row bands. */
function bandsFromClusters(clusters, top, bottom) {
  return clusters.map((c, i) => {
    const prev = clusters[i - 1];
    const next = clusters[i + 1];
    const a = prev ? Math.round((prev.b + c.a) / 2) : Math.max(0, c.a - 8);
    const b = next ? Math.round((c.b + next.a) / 2) : c.b + 8;
    return { top: top + a, bottom: Math.min(bottom, top + b) };
  });
}

/** Locate the faint rule at the left edge of a block's TOTAL column. */
function findTotalRule(page, col, y0, y1) {
  const prof = profileX(page, y0, y1, col.x0, col.x1);
  const peaks = findPeaks(prof, { minSep: 20, factor: 1.4, offset: col.x0 });
  const candidates = peaks.filter((x) => {
    const fromRight = col.x1 - x;
    return fromRight >= TOTAL_WIDTH_RANGE[0] && fromRight <= TOTAL_WIDTH_RANGE[1];
  });
  if (candidates.length === 0) return null;
  const totalLeft = candidates.reduce((best, x) =>
    prof[x - col.x0] > prof[best - col.x0] ? x : best,
  );
  return { totalLeft, strength: prof[totalLeft - col.x0] };
}

/** Sections of a block, in row order, with their item lists. */
function sectionsOf(items) {
  const out = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else out.push({ section: item.section, items: [item] });
  }
  return out;
}

function detectSide(side) {
  const page = loadGray(join(REF, `lines-${side}.png`));
  const { width, height } = page;
  const y0 = Math.round(height * GRID_TOP[side]);
  const y1 = Math.round(height * GRID_BOTTOM[side]);

  const verts = findPeaks(profileX(page, y0, y1, 0, width), { minSep: 25, factor: 2.4 });
  if (verts.length < 3) {
    throw new Error(`${side}: only ${verts.length} vertical rules found`);
  }
  const left = verts[0];
  const right = verts[verts.length - 1];
  const mid = (left + right) / 2;
  const interior = verts.filter((x) => x > left + 40 && x < right - 40);
  if (interior.length === 0) throw new Error(`${side}: no block divider found`);
  const divider = interior.reduce((b, x) => (Math.abs(x - mid) < Math.abs(b - mid) ? x : b));

  const columns = [
    { name: "left", x0: left, x1: divider },
    { name: "right", x0: divider, x1: right },
  ];

  // One TOTAL width for the whole card: it is a printed form, and the hairline
  // reads more clearly in one block than the other.
  const hits = columns
    .map((col) => ({ col, hit: findTotalRule(page, col, y0, y1) }))
    .filter((f) => f.hit);
  if (hits.length === 0) throw new Error(`${side}: no TOTAL column rule in either block`);
  const best = hits.reduce((a, b) => (b.hit.strength > a.hit.strength ? b : a));
  const totalWidth = best.col.x1 - best.hit.totalLeft;

  const cells = [];
  const report = [];
  const problems = [];

  for (const col of columns) {
    const totalLeft = col.x1 - totalWidth;
    const labelX1 = Math.round(col.x0 + (totalLeft - col.x0) * 0.62);
    const want = TAXONOMY.filter((i) => i.side === side && i.column === col.name);
    const sections = sectionsOf(want);

    let banners = bannerBands(page, col.x0 + 4, totalLeft - 4, y0, y1);

    // The card stacks a super-banner above the first section of a block
    // ("PLASTIC & STYROFOAM" over "FOOD & BEVERAGE PACKAGING"). It is
    // decorative, so drop leading banners until the counts line up.
    while (banners.length > sections.length) banners = banners.slice(1);
    if (banners.length !== sections.length) {
      problems.push(
        `${col.name}: found ${banners.length} section banners, expected ${sections.length}`,
      );
      continue;
    }

    sections.forEach((section, si) => {
      const top = banners[si].bottom + 1;
      const bottom = si + 1 < banners.length ? banners[si + 1].top - 1 : y1;
      const { clusters, mergeGap, exact } = rowsForSection(
        page,
        col.x0 + 8,
        labelX1,
        top,
        bottom,
        section.items.length,
      );
      if (!exact) {
        problems.push(`${col.name}/${section.section}: no exact row fit, divided evenly`);
      }
      report.push(
        `    ${section.section}: ${section.items.length} rows` +
          (exact ? ` (merge gap ${mergeGap}px)` : "  <-- EVEN DIVISION FALLBACK"),
      );

      const bands = bandsFromClusters(clusters, top, bottom);
      bands.forEach((band, i) => {
        const inset = 3;
        cells.push({
          row: section.items[i].row,
          column: col.name,
          total: {
            x: totalLeft + inset,
            y: band.top + inset,
            width: totalWidth - inset * 2,
            height: Math.max(4, band.bottom - band.top - inset * 2),
          },
          tally: {
            x: col.x0 + inset,
            y: band.top + inset,
            width: totalLeft - col.x0 - inset * 2,
            height: Math.max(4, band.bottom - band.top - inset * 2),
          },
        });
      });
    });
  }

  return {
    page,
    cells,
    report,
    problems,
    bounds: { left, right, top: y0, bottom: y1, divider },
  };
}

function writeDebug(side, cells) {
  const png = PNG.sync.read(readFileSync(join(REF, `blank-${side}.png`)));
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    const p = (y * png.width + x) * 4;
    png.data[p] = r;
    png.data[p + 1] = g;
    png.data[p + 2] = b;
  };
  const rect = (r, cr, cg, cb) => {
    for (let x = r.x; x < r.x + r.width; x++) {
      put(x, r.y, cr, cg, cb);
      put(x, r.y + r.height - 1, cr, cg, cb);
    }
    for (let y = r.y; y < r.y + r.height; y++) {
      put(r.x, y, cr, cg, cb);
      put(r.x + r.width - 1, y, cr, cg, cb);
    }
  };
  for (const c of cells) {
    rect(c.tally, 40, 120, 220);
    rect(c.total, 220, 30, 30);
  }
  writeFileSync(join(REF, `debug-grid-${side}.png`), PNG.sync.write(png));
}

function main() {
  const debug = process.argv.includes("--debug");
  const results = {};
  const overrides = loadOverrides();
  let failed = false;

  for (const side of ["front", "back"]) {
    const { page, cells, report, problems } = detectSide(side);
    const expected = TAXONOMY.filter((i) => i.side === side).length;

    console.log(`${side}:`);
    report.forEach((l) => console.log(l));
    console.log(`  mapped ${cells.length}/${expected} item rows`);
    problems.forEach((p) => console.log(`  PROBLEM ${p}`));

    // Apply overrides before rendering the overlay. The overlay is the only
    // way anyone checks this map by eye, so it has to show what actually gets
    // written -- an earlier version drew the pre-override boxes and would have
    // had a reviewer sign off on coordinates the tool does not use.
    applyOverrides(cells, overrides[side] ?? [], side);

    if (cells.length !== expected || problems.length > 0) failed = true;
    results[side] = { page, cells };

    if (debug) {
      writeDebug(side, cells);
      console.log(`  wrote debug-grid-${side}.png`);
    }
  }

  // Refuse to emit a partial map.
  //
  // Rows are assigned to spreadsheet rows positionally, so a map that is short
  // by one row does not lose one value -- it shifts every value below it onto
  // the wrong debris item, and the resulting spreadsheet looks entirely
  // normal. A hard stop is the only safe behaviour.
  if (failed) {
    console.error(
      "\nRefusing to write the cell map: not every taxonomy row was matched.\n" +
        "Run with --debug and inspect the overlay before changing thresholds.",
    );
    process.exit(1);
  }

  for (const side of ["front", "back"]) {
    const { page, cells } = results[side];
    const map = {
      side,
      referenceSize: { width: page.width, height: page.height },
      referenceDpi: REFERENCE_DPI,
      // The pre-printed example box on the front is not volunteer data. It is
      // proven printed: it survives a median across 41 different cards.
      exclusions:
        side === "front"
          ? [
              {
                x: Math.round(page.width * 0.49),
                y: Math.round(page.height * 0.12),
                width: Math.round(page.width * 0.47),
                height: Math.round(page.height * 0.17),
              },
            ]
          : [],
      cells: cells.sort((a, b) => a.row - b.row),
    };
    writeFileSync(join(REF, `cells.${side}.json`), JSON.stringify(map, null, 2) + "\n");
    console.log(`wrote assets/reference/cells.${side}.json (${cells.length} cells)`);
  }
}

/**
 * Hand-measured corrections layered over the automatic detection.
 *
 * The detector resolves 81 of the 83 rows from the card's own structure. The
 * remaining two sit at the foot of the back-left block, where a small light
 * "Other (write-in):" caption is sandwiched between a wrapped caption and the
 * table's closing border; no threshold/merge pair separates all three without
 * breaking a wrapped caption elsewhere in the same section.
 *
 * Pinning those two is honest and bounded -- the card is a fixed printed form
 * measured once -- and far safer than bending the detector until it happens to
 * agree. Every override is announced on stderr so it cannot rot unnoticed.
 */
function loadOverrides() {
  const path = join(REF, "cells-overrides.json");
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function applyOverrides(cells, list, side) {
  for (const o of list) {
    const cell = cells.find((c) => c.row === o.row);
    if (!cell) {
      console.error(
        `  OVERRIDE ERROR ${side} row ${o.row}: no detected cell to correct. ` +
          `The detector's output changed -- re-measure before trusting this.`,
      );
      process.exitCode = 1;
      continue;
    }
    for (const key of ["total", "tally"]) {
      if (!o[key]) continue;
      Object.assign(cell[key], o[key]);
    }
    console.log(`  override ${side} row ${o.row}: ${o.reason}`);
  }
}

main();
