/**
 * Build a blank registration template out of filled-in cards.
 *
 * The chapter could not find a blank data card, but it does not need one. The
 * printed form is identical on every card and only the handwriting differs, so
 * a per-pixel MEDIAN across many cards keeps whatever is common to all of them
 * (the printed grid) and discards whatever is not (the writing). With ~40
 * samples a pen stroke has to land on the same pixel in more than half of them
 * to survive, which essentially never happens.
 *
 * Pages are aligned before compositing. The scanner is sheet-fed, so each page
 * comes out a few pixels off and a few pixels different in size; compositing
 * without aligning would soften every printed line by that jitter.
 *
 * Usage:
 *   node scripts/build-reference.mjs <dir-of-page-jpegs> [--limit 41]
 *
 * Writes assets/reference/blank-{front,back}.png.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "reference");

/** Max pages to composite per side. Odd, so the median is a real sample. */
const DEFAULT_LIMIT = 41;
/** How far to search when aligning, in pixels. */
const MAX_SHIFT = 40;

function decodeGray(path) {
  const { width, height, data } = jpeg.decode(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
  });
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // Rec. 601 luma.
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return { width, height, gray };
}

/** Fraction of dark pixels in a horizontal band, ignoring the page margins. */
function darkFraction({ width, height, gray }, f0, f1) {
  const x0 = Math.round(width * 0.05);
  const x1 = Math.round(width * 0.95);
  let dark = 0;
  let total = 0;
  for (let y = Math.round(height * f0); y < Math.round(height * f1); y++) {
    const off = y * width;
    for (let x = x0; x < x1; x++) {
      if (gray[off + x] < 150) dark++;
      total++;
    }
  }
  return dark / total;
}

/**
 * Classify a page as the front or back of a card.
 *
 * Two independent signals, both measured to separate cleanly on this scanner:
 *
 *   band 4-6%   backs open with two full-width dark section banners
 *               ("PLASTIC & STYROFOAM CONT." and "GLASS"); fronts have only
 *               the masthead. Measured: fronts 0.21-0.30, backs 0.66-0.82.
 *   band 90-97% fronts end with the donation footer and QR code; backs end
 *               with the last table rows. Measured: fronts 0.076-0.080,
 *               backs 0.020-0.024 -- a very tight cluster either side.
 *
 * Both are checked so a page that is torn, rotated, or simply not a data card
 * shows up as a disagreement rather than being silently binned.
 */
function classify(page) {
  const banner = darkFraction(page, 0.04, 0.06);
  const footer = darkFraction(page, 0.9, 0.97);

  const byBanner = banner > 0.45 ? "back" : "front";
  const byFooter = footer > 0.05 ? "front" : "back";

  return {
    side: byBanner,
    agree: byBanner === byFooter,
    banner,
    footer,
  };
}

/** Darkness projected onto each axis; the printed rules dominate these. */
function profiles({ width, height, gray }) {
  const cols = new Float64Array(width);
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      const dark = 255 - gray[off + x];
      cols[x] += dark;
      rows[y] += dark;
    }
  }
  return { cols, rows };
}

function normalize(a) {
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;
  const out = new Float64Array(a.length);
  let norm = 0;
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] - mean;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/**
 * Estimate page skew in degrees.
 *
 * The card is dense with long horizontal rules. When the page is level those
 * rules pile into a few very tall spikes in the row-darkness profile; when it
 * is rotated they smear across many rows. So the angle that maximises the
 * variance of the row profile is the angle that levels the page.
 *
 * Measured on a quarter-scale copy: the search is over a hundred-odd angles
 * and full resolution buys nothing here.
 */
function estimateSkew({ width, height, gray }, maxDeg = 2.0, step = 0.1) {
  const S = 4;
  const w = Math.floor(width / S);
  const h = Math.floor(height / S);
  const small = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      small[y * w + x] = 255 - gray[y * S * width + x * S];
    }
  }

  let bestAngle = 0;
  let bestScore = -Infinity;
  const rows = new Float64Array(h);

  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
    rows.fill(0);
    const t = Math.tan((deg * Math.PI) / 180);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Shear is a good approximation of rotation for angles this small.
        const sy = y + Math.round((x - w / 2) * t);
        if (sy >= 0 && sy < h) rows[sy] += small[y * w + x];
      }
    }
    let mean = 0;
    for (const v of rows) mean += v;
    mean /= h;
    let variance = 0;
    for (const v of rows) variance += (v - mean) * (v - mean);

    if (variance > bestScore) {
      bestScore = variance;
      bestAngle = deg;
    }
  }
  return bestAngle;
}

/** Rotate about the page centre with bilinear sampling. */
function rotated(page, deg) {
  if (Math.abs(deg) < 1e-6) return page;
  const { width, height, gray } = page;
  const out = new Uint8Array(width * height);
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const sx = cx + dx * cos + dy * sin;
      const sy = cy - dx * sin + dy * cos;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);

      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) {
        out[y * width + x] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * width + x0;
      out[y * width + x] =
        gray[i] * (1 - fx) * (1 - fy) +
        gray[i + 1] * fx * (1 - fy) +
        gray[i + width] * (1 - fx) * fy +
        gray[i + width + 1] * fx * fy;
    }
  }
  return { width, height, gray: out };
}

/** Integer shift maximizing correlation of `b` against `a`. */
function bestShift(a, b) {
  const A = normalize(a);
  const B = normalize(b);
  let best = 0;
  let bestScore = -Infinity;
  for (let s = -MAX_SHIFT; s <= MAX_SHIFT; s++) {
    let score = 0;
    const start = Math.max(0, -s);
    const end = Math.min(A.length, B.length - s);
    for (let i = start; i < end; i++) score += A[i] * B[i + s];
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function medianComposite(pages, width, height, refProfiles) {
  const count = pages.length;
  const stack = new Uint8Array(count * width * height);

  const skews = [];

  pages.forEach((raw, k) => {
    // Deskew first: a page that is rotated cannot be brought into register by
    // any translation, and the error grows with distance from the pivot -- it
    // shows up as one half of the composite being sharp and the other ghosted.
    const skew = estimateSkew(raw);
    skews.push(skew);
    const page = rotated(raw, skew);

    const p = profiles(page);
    const dx = bestShift(refProfiles.cols, p.cols);
    const dy = bestShift(refProfiles.rows, p.rows);
    const base = k * width * height;

    for (let y = 0; y < height; y++) {
      const sy = y + dy;
      for (let x = 0; x < width; x++) {
        const sx = x + dx;
        let v = 255; // outside the source page, treat as paper white
        if (sy >= 0 && sy < page.height && sx >= 0 && sx < page.width) {
          v = page.gray[sy * page.width + sx];
        }
        stack[base + y * width + x] = v;
      }
    }
    process.stdout.write(
      `\r    aligned ${k + 1}/${count} (skew=${skew.toFixed(1)}deg dx=${dx} dy=${dy})    `,
    );
  });
  process.stdout.write("\n");

  const absSkew = skews.map(Math.abs).sort((a, b) => a - b);
  console.log(
    `    skew: median ${absSkew[absSkew.length >> 1].toFixed(2)}deg, ` +
      `max ${absSkew[absSkew.length - 1].toFixed(2)}deg`,
  );

  const out = new Uint8Array(width * height);
  const scratch = new Uint8Array(count);
  const mid = count >> 1;
  const plane = width * height;

  for (let i = 0; i < plane; i++) {
    for (let k = 0; k < count; k++) scratch[k] = stack[k * plane + i];
    scratch.sort();
    out[i] = scratch[mid];
  }
  return out;
}

function writeGrayPng(path, gray, width, height) {
  const png = new PNG({ width, height });
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    png.data[p] = png.data[p + 1] = png.data[p + 2] = gray[i];
    png.data[p + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/build-reference.mjs <dir-of-page-jpegs>");
    process.exit(1);
  }
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : DEFAULT_LIMIT;

  const files = readdirSync(dir)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));

  if (files.length === 0) {
    console.error(`no jpegs in ${dir}`);
    process.exit(1);
  }

  console.log(`Classifying ${files.length} pages...`);
  const bySide = { front: [], back: [] };
  const disagreements = [];
  const sequence = [];

  for (const f of files) {
    const page = decodeGray(join(dir, f));
    const { side, agree, banner, footer } = classify(page);
    sequence.push(side);
    if (!agree) {
      disagreements.push(
        `${f} (banner ${banner.toFixed(3)}, footer ${footer.toFixed(3)})`,
      );
    }
    if (bySide[side].length < limit) bySide[side].push(page);
  }

  console.log(`  front: ${sequence.filter((s) => s === "front").length}   ` +
    `back: ${sequence.filter((s) => s === "back").length}   ` +
    `(compositing up to ${limit} each)`);

  if (disagreements.length) {
    console.log(
      `  WARNING the two classifiers disagree on ${disagreements.length} page(s): ` +
        disagreements.join(", "),
    );
  }

  // Cards are front-then-back pairs. A break means a single-sided card, a
  // stray page, or a misfeed -- exactly the case the plan wants hard-stopped
  // rather than guessed around.
  const breaks = [];
  for (let i = 0; i + 1 < sequence.length; i += 2) {
    if (sequence[i] !== "front" || sequence[i + 1] !== "back") {
      breaks.push(`pages ${i + 1}-${i + 2} (${sequence[i]}/${sequence[i + 1]})`);
    }
  }
  if (sequence.length % 2 !== 0) breaks.push(`odd page count (${sequence.length})`);
  console.log(
    breaks.length
      ? `  WARNING front/back pairing breaks at: ${breaks.join(", ")}`
      : `  front/back alternation is clean across all ${sequence.length} pages`,
  );

  mkdirSync(OUT_DIR, { recursive: true });

  for (const side of ["front", "back"]) {
    const pages = bySide[side];
    if (pages.length < 5) {
      console.log(`  skipping ${side}: only ${pages.length} pages`);
      continue;
    }
    // Composite onto the smallest common canvas so no page is extrapolated.
    const width = Math.min(...pages.map((p) => p.width));
    const height = Math.min(...pages.map((p) => p.height));
    console.log(`\n  ${side}: ${pages.length} pages onto ${width}x${height}`);

    // The alignment reference must itself be level, or every page inherits
    // page 0's skew.
    const ref = profiles(rotated(pages[0], estimateSkew(pages[0])));
    const composite = medianComposite(pages, width, height, ref);
    const out = join(OUT_DIR, `blank-${side}.png`);
    writeGrayPng(out, composite, width, height);
    console.log(`    wrote ${out}`);
  }
}

main();
