/**
 * Shared card-vision routines: decode, register, crop, segment, normalize.
 *
 * Factored out of extract-crops.mjs so the crop extractor and the
 * spreadsheet labeller cannot drift apart. If these two disagreed about how a
 * cell is cropped or a digit is normalized, the training data would not match
 * what the recognizer sees at run time, and the measured accuracy would be a
 * fiction.
 *
 * These mirror src/lib/image.ts and src/lib/register.ts; the browser versions
 * are the ones that ship, these are the offline equivalents.
 */

import { readFileSync } from "node:fs";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

import { boxMarked as boxMarkedImpl, stripMarked as stripMarkedImpl } from "../../src/lib/marks.ts";

/**
 * Banner overlap below this is not trusted; see MIN_BANNER_OVERLAP in
 * src/lib/register.ts for the measurements behind the number.
 */
const MIN_BANNER_OVERLAP = 0.75;

/** Decimation for the coarse alignment pass. */
const COARSE = 4;


function decodeGray(path) {
  const { width, height, data } = jpeg.decode(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
  });
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return { width, height, gray };
}

function loadPng(path) {
  const png = PNG.sync.read(readFileSync(path));
  const gray = new Uint8Array(png.width * png.height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (png.data[p] * 299 + png.data[p + 1] * 587 + png.data[p + 2] * 114) / 1000;
  }
  return { width: png.width, height: png.height, gray };
}

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

function classify(page) {
  const banner = darkFraction(page, 0.04, 0.06);
  const footer = darkFraction(page, 0.9, 0.97);
  const byBanner = banner > 0.45 ? "back" : "front";
  const byFooter = footer > 0.05 ? "front" : "back";
  return { side: byBanner, agree: byBanner === byFooter };
}

/** Mean darkness of each row, over an optional horizontal window. */
function rowProfile({ width, height, gray }, x0 = 0, x1 = width) {
  const out = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += 255 - gray[off + x];
    out[y] = sum / (x1 - x0);
  }
  return out;
}

/** Mean darkness of each column, over an optional vertical window. */
function colProfile({ width, height, gray }, y0 = 0, y1 = height) {
  const out = new Float64Array(width);
  for (let y = y0; y < y1; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) out[x] += 255 - gray[off + x];
  }
  for (let i = 0; i < out.length; i++) out[i] /= y1 - y0;
  return out;
}

function decimate(a, factor) {
  const n = Math.floor(a.length / factor);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += a[i * factor + k];
    out[i] = sum / factor;
  }
  return out;
}

function fitScore(ref, page, i0, i1, scale, offset) {
  let n = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  for (let i = i0; i < i1; i++) {
    const t = scale * i + offset;
    const t0 = Math.floor(t);
    if (t0 < 0 || t0 + 1 >= page.length) continue;
    const f = t - t0;
    const b = page[t0] * (1 - f) + page[t0 + 1] * f;
    const a = ref[i];
    n++;
    sumA += a;
    sumB += b;
    sumAA += a * a;
    sumBB += b * b;
    sumAB += a * b;
  }
  if (n < (i1 - i0) * 0.6) return -1;
  const cov = sumAB - (sumA * sumB) / n;
  const va = sumAA - (sumA * sumA) / n;
  const vb = sumBB - (sumB * sumB) / n;
  const denom = Math.sqrt(va * vb);
  return denom > 0 ? cov / denom : -1;
}

/** Scale and offset mapping a page profile onto the reference's, coarse to fine. */
function fitAxis(refProfile, pageProfile, i0, i1, { maxScaleDeviation = 0.06, maxOffset = 360 } = {}) {
  const refCoarse = decimate(refProfile, COARSE);
  const pageCoarse = decimate(pageProfile, COARSE);
  const c0 = Math.floor(i0 / COARSE);
  const c1 = Math.floor(i1 / COARSE);

  let best = { scale: 1, offset: 0, score: -1 };
  for (let scale = 1 - maxScaleDeviation; scale <= 1 + maxScaleDeviation + 1e-9; scale += 0.004) {
    for (let offset = -maxOffset; offset <= maxOffset; offset += COARSE) {
      const score = fitScore(refCoarse, pageCoarse, c0, c1, scale, offset / COARSE);
      if (score > best.score) best = { scale, offset, score };
    }
  }

  let refined = { ...best, score: -1 };
  for (let scale = best.scale - 0.005; scale <= best.scale + 0.005 + 1e-9; scale += 0.0005) {
    for (let offset = best.offset - 8; offset <= best.offset + 8 + 1e-9; offset += 0.5) {
      const score = fitScore(refProfile, pageProfile, i0, i1, scale, offset);
      if (score > refined.score) refined = { scale, offset, score };
    }
  }
  return refined;
}

/** Median pixel value: the page's paper level, by histogram rather than sorting. */
function paperLevel({ gray }) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const half = gray.length >> 1;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen > half) return v;
  }
  return 255;
}

/** Which rows of a block are section banner: mostly ink, right across it. */
function bannerRows(img, x0, x1, y0, y1) {
  const ink = Math.max(60, paperLevel(img) - 60);
  const span = x1 - x0;
  const out = new Uint8Array(y1 - y0);
  for (let y = y0; y < y1; y++) {
    const off = y * img.width;
    let dark = 0;
    for (let x = x0; x < x1; x++) if (img.gray[off + x] < ink) dark++;
    out[y - y0] = dark > span * 0.5 ? 1 : 0;
  }
  return out;
}

/** Intersection over union of two binary masks. */
function maskOverlap(a, b) {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) intersection++;
    if (a[i] || b[i]) union++;
  }
  return union ? intersection / union : 1;
}

/** The x-span of each of a side's two printed blocks, from the cell map. */
function blocksOf(map) {
  const out = [];
  for (const column of ["left", "right"]) {
    const cells = map.cells.filter((c) => c.column === column);
    if (!cells.length) continue;
    out.push({
      x0: Math.min(...cells.map((c) => c.tally.x)),
      x1: Math.max(...cells.map((c) => c.total.x + c.total.width)),
    });
  }
  return out;
}

/** Build a registration target -- blank card, fit window, and banner mask. */
function referenceTarget(image, map) {
  const window = alignmentWindow(map);
  const blocks = blocksOf(map);
  return {
    image,
    window,
    blocks,
    banners: blocks.map((b) => bannerRows(image, b.x0, b.x1, window.y, window.y + window.height)),
  };
}

/**
 * How well a registered page's section banners match the template's.
 *
 * A block with no banner in the reference cannot vouch for anything and is
 * skipped; if no block can, the answer is 0, not 1. See bannerOverlap in
 * src/lib/register.ts.
 */
function bannerOverlap(registered, target) {
  const { window, blocks, banners } = target;
  let worst = 1;
  let checked = 0;
  blocks.forEach((b, i) => {
    if (!banners[i].some((v) => v)) return;
    const rows = bannerRows(registered, b.x0, b.x1, window.y, window.y + window.height);
    worst = Math.min(worst, maskOverlap(banners[i], rows));
    checked++;
  });
  return checked > 0 ? worst : 0;
}

/** The region alignment is judged on: the cells, plus the banner above them. */
function alignmentWindow(map) {
  const boxes = map.cells.flatMap((c) => [c.total, c.tally]);
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 8);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 72);
  const x1 = Math.min(map.referenceSize.width, Math.max(...boxes.map((b) => b.x + b.width)) + 8);
  const y1 = Math.min(map.referenceSize.height, Math.max(...boxes.map((b) => b.y + b.height)) + 8);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function estimateSkew({ width, height, gray }, maxDeg = 2, step = 0.1) {
  const S = 4;
  const w = Math.floor(width / S);
  const h = Math.floor(height / S);
  const small = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) small[y * w + x] = 255 - gray[y * S * width + x * S];
  }
  const rows = new Float64Array(h);
  let bestAngle = 0;
  let bestScore = -Infinity;
  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
    rows.fill(0);
    const t = Math.tan((deg * Math.PI) / 180);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
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

function rotate(page, deg) {
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

/**
 * Deskew a page and resample it into the reference's coordinate space.
 *
 * `target` is `{ image, window }` -- the blank card and the region of it that
 * the fit is judged on, from `alignmentWindow`. Returns the registered page and
 * the alignment score, which the caller must check: below MIN_ALIGNMENT the
 * cells would be cropped from the wrong part of the card.
 */
function registerTo(page, target) {
  const reference = target.image;
  const window = target.window;
  const levelled = rotate(page, estimateSkew(page));

  const y = fitAxis(
    rowProfile(reference, window.x, window.x + window.width),
    rowProfile(levelled),
    window.y,
    window.y + window.height,
  );

  const pageY0 = Math.max(0, Math.round(y.scale * window.y + y.offset));
  const pageY1 = Math.min(levelled.height, Math.round(y.scale * (window.y + window.height) + y.offset));
  const x =
    pageY1 - pageY0 > 32
      ? fitAxis(
          colProfile(reference, window.y, window.y + window.height),
          colProfile(levelled, pageY0, pageY1),
          window.x,
          window.x + window.width,
          { maxScaleDeviation: 0.03, maxOffset: 200 },
        )
      : { scale: 1, offset: 0, score: -1 };

  const out = new Uint8Array(reference.width * reference.height);
  for (let yy = 0; yy < reference.height; yy++) {
    const sy = y.scale * yy + y.offset;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const dst = yy * reference.width;
    if (y0 < 0 || y0 + 1 >= levelled.height) {
      out.fill(255, dst, dst + reference.width);
      continue;
    }
    const rowA = y0 * levelled.width;
    const rowB = rowA + levelled.width;
    for (let xx = 0; xx < reference.width; xx++) {
      const sx = x.scale * xx + x.offset;
      const x0 = Math.floor(sx);
      if (x0 < 0 || x0 + 1 >= levelled.width) {
        out[dst + xx] = 255;
        continue;
      }
      const fx = sx - x0;
      out[dst + xx] =
        levelled.gray[rowA + x0] * (1 - fx) * (1 - fy) +
        levelled.gray[rowA + x0 + 1] * fx * (1 - fy) +
        levelled.gray[rowB + x0] * (1 - fx) * fy +
        levelled.gray[rowB + x0 + 1] * fx * fy;
    }
  }

  const image = { width: reference.width, height: reference.height, gray: out };

  return {
    image,
    transform: { x, y },
    // Checked against the printed banners, not against the correlation that
    // placed it: the correlation falls with how much a volunteer wrote rather
    // than with how far the page is out.
    bannerOverlap: bannerOverlap(image, target),
  };
}

/**
 * Register against whichever side the page actually is.
 *
 * The banner/footer classifier chooses which reference to try first; alignment
 * decides. See registerAgainstBestSide in src/lib/register.ts.
 */
/** Turn an image by whole quarter-turns clockwise. Mirrors quarterTurn in src/lib/image.ts. */
function quarterTurn(img, turns) {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return img;
  const { width: w, height: h, gray } = img;
  const width = t === 2 ? w : h;
  const height = t === 2 ? h : w;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx, sy;
      if (t === 1) { sx = y; sy = h - 1 - x; }
      else if (t === 2) { sx = w - 1 - x; sy = h - 1 - y; }
      else { sx = w - 1 - y; sy = x; }
      out[y * width + x] = gray[sy * w + sx];
    }
  }
  return { width, height, gray: out };
}

function registerBestSide(page, targets) {
  const cls = classify(page);
  const other = cls.side === "front" ? "back" : "front";

  let side = cls.side;
  let fit = registerTo(page, targets[side]);

  if (fit.bannerOverlap < MIN_BANNER_OVERLAP) {
    const alternative = registerTo(page, targets[other]);
    if (alternative.bannerOverlap > fit.bannerOverlap) {
      side = other;
      fit = alternative;
    }
  }

  // A card fed in sideways is readable, just turned. Only tried for a page that
  // has already failed. See registerAgainstBestSide in src/lib/register.ts.
  let quarterTurns = 0;
  if (fit.bannerOverlap < MIN_BANNER_OVERLAP) {
    for (const turns of [1, 2, 3]) {
      const turned = quarterTurn(page, turns);
      for (const candidate of ["front", "back"]) {
        const attempt = registerTo(turned, targets[candidate]);
        if (attempt.bannerOverlap > fit.bannerOverlap) {
          side = candidate;
          quarterTurns = turns;
          fit = attempt;
        }
      }
    }
  }

  return {
    side,
    ...fit,
    quarterTurns,
    trusted: fit.bannerOverlap >= MIN_BANNER_OVERLAP,
    classifierAgreed: cls.agree,
  };
}

function cropCell(page, r) {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(page.width, Math.round(r.x + r.width));
  const y1 = Math.min(page.height, Math.round(r.y + r.height));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const gray = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) gray[y * w + x] = page.gray[(y0 + y) * page.width + x0 + x];
  }
  return { width: w, height: h, gray };
}

function inkFraction(img, threshold = 170) {
  let dark = 0;
  for (const v of img.gray) if (v < threshold) dark++;
  return dark / img.gray.length;
}

/**
 * Is there handwriting in this TOTAL box? In this tally strip?
 *
 * The real work is in src/lib/marks.ts, imported rather than mirrored. Three
 * earlier attempts lived here as offline-only copies and every one of them was
 * measured on a scan and then never wired into the app, which is exactly how
 * two implementations of the same idea drift apart. There is one now, and these
 * are the adapters that let it read this file's `{ gray }` images.
 */
function boxMarked(img, options) {
  return boxMarkedImpl({ width: img.width, height: img.height, data: img.gray }, options);
}

function stripMarked(img, options) {
  return stripMarkedImpl({ width: img.width, height: img.height, data: img.gray }, options);
}

/**
 * Otsu's threshold: the cut that best separates ink from paper for THIS crop.
 *
 * A fixed threshold cannot serve every cell -- pencil varies from faint to
 * heavy across volunteers, and scanner exposure drifts across a 114-page feed.
 */
function otsu(img) {
  const hist = new Array(256).fill(0);
  for (const v of img.gray) hist[v]++;
  const total = img.gray.length;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/**
 * Ink threshold for a cell crop, relative to its own paper level.
 *
 * Otsu alone is wrong here. It assumes two populations, but a TOTAL box is
 * ~95% white paper with a thin pencil mark, so it splits inside the paper's own
 * noise and the cell's printed border and shading come back as "ink". That
 * produced large blob components that outranked the real digits.
 *
 * The paper level is the median; anything meaningfully darker is a mark.
 */
function inkThreshold(img) {
  const sorted = Uint8Array.from(img.gray).sort();
  const paper = sorted[sorted.length >> 1];
  const dark = sorted[Math.floor(sorted.length * 0.02)];

  // If the darkest 2% is not clearly darker than the paper, the cell holds no
  // real mark and nothing should be segmented out of it.
  if (paper - dark < 25) return -1;

  const relative = paper - 45;
  return Math.max(30, Math.min(relative, otsu(img), 200));
}

/**
 * Binary ink mask, ignoring a margin around the crop.
 *
 * The inset is proportional, not a fixed 2px: the cell map's boxes sit right on
 * the printed rules, and at 200 DPI those are several pixels thick.
 */
function inkMask(img) {
  const t = inkThreshold(img);
  const mask = new Uint8Array(img.width * img.height);
  if (t < 0) return mask;

  const ix = Math.max(3, Math.round(img.width * 0.06));
  const iy = Math.max(3, Math.round(img.height * 0.08));

  for (let y = iy; y < img.height - iy; y++) {
    for (let x = ix; x < img.width - ix; x++) {
      const i = y * img.width + x;
      mask[i] = img.gray[i] <= t ? 1 : 0;
    }
  }
  return mask;
}

/**
 * Connected components of ink, 8-connected.
 *
 * Components rather than a vertical projection: the numbers are free-written
 * and often slanted, so two digits can overlap in x while remaining separate
 * strokes. Projection cuts would merge those.
 */
function components(mask, width, height, minPixels = 12) {
  const labels = new Int32Array(width * height).fill(-1);
  const out = [];
  const stack = [];

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i] !== -1) continue;
    const id = out.length;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let count = 0;

    stack.push(i);
    labels[i] = id;

    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p / width) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const q = ny * width + nx;
          if (mask[q] && labels[q] === -1) {
            labels[q] = id;
            stack.push(q);
          }
        }
      }
    }

    if (count >= minPixels) out.push({ minX, maxX, minY, maxY, count });
  }
  return out;
}

/**
 * Split a cell crop into digit boxes, left to right.
 *
 * Components that overlap heavily in x are merged: a "5" written with a
 * detached top bar, or a dotted stroke, arrives as two components but is one
 * digit.
 */
function segmentDigits(img) {
  const mask = inkMask(img);
  if (!mask.some((v) => v)) return [];
  let boxes = components(mask, img.width, img.height);
  if (boxes.length === 0) return [];

  // Reject anything shaped like a rule rather than a digit. A leftover slice of
  // the printed border arrives as a very wide, very short component, or a very
  // tall hairline; a digit is neither.
  boxes = boxes.filter((b) => {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    if (h < img.height * 0.18) return false; // too short to be a digit
    if (w > img.width * 0.75) return false; // spans the cell: a rule
    if (w / h > 3.5) return false; // a horizontal bar
    // Ink should fill a fair share of a digit's own box; a hollow rectangle
    // outline (the cell border) does not.
    return b.count >= w * h * 0.12;
  });
  if (boxes.length === 0) return [];

  // Drop specks: anything far smaller than the tallest survivor is a stray
  // mark, not a digit.
  const tallest = Math.max(...boxes.map((b) => b.maxY - b.minY + 1));
  boxes = boxes.filter((b) => b.maxY - b.minY + 1 >= tallest * 0.45);

  boxes.sort((a, b) => a.minX - b.minX);

  const merged = [];
  for (const b of boxes) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const overlap = Math.min(prev.maxX, b.maxX) - Math.max(prev.minX, b.minX);
      const narrower = Math.min(prev.maxX - prev.minX, b.maxX - b.minX) + 1;
      if (overlap > narrower * 0.5) {
        prev.minX = Math.min(prev.minX, b.minX);
        prev.maxX = Math.max(prev.maxX, b.maxX);
        prev.minY = Math.min(prev.minY, b.minY);
        prev.maxY = Math.max(prev.maxY, b.maxY);
        prev.count += b.count;
        continue;
      }
    }
    merged.push({ ...b });
  }
  return merged;
}

/**
 * Normalize a digit box to a 28x28 bitmap: scaled to fit 20x20 and centred by
 * centre of mass. This is the MNIST convention, so the same preprocessing
 * serves whichever classifier ends up being used.
 */
function normalizeDigit(img, box) {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const scale = 20 / Math.max(w, h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const t = inkThreshold(img);
  const small = new Float64Array(tw * th);

  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      // Box-filter the source region, averaging INK COVERAGE (a 0/1 mask) --
      // not gray level.
      //
      // Averaging gray produced almost-blank bitmaps: pencil on a white cell is
      // faint, so `255 - v` over a mostly-white patch lands near zero. Distance
      // between two such bitmaps is then driven by how much ink a digit happens
      // to carry rather than its shape, and the first classifier read 2, 3, 5
      // and 7 as 0 because 0 has the most ink of all. Coverage is scale-free
      // and gives a clean 0-1 signal regardless of how hard someone pressed.
      // The window is computed in coordinates RELATIVE to the box and only
      // then offset by its origin. Mixing the two -- taking max() of an
      // already-offset start against a relative end -- makes the window run
      // box.minX pixels too far right, so most of what gets averaged is the
      // paper beside the digit. That washed every bitmap out: 77% of training
      // digits peaked below half intensity, distances stopped discriminating
      // shape, and everything collapsed onto the commonest class.
      const rx0 = Math.floor((x * w) / tw);
      const ry0 = Math.floor((y * h) / th);
      const sx0 = box.minX + rx0;
      const sx1 = box.minX + Math.max(rx0 + 1, Math.floor(((x + 1) * w) / tw));
      const sy0 = box.minY + ry0;
      const sy1 = box.minY + Math.max(ry0 + 1, Math.floor(((y + 1) * h) / th));

      let ink = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < img.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < img.width; sx++) {
          if (img.gray[sy * img.width + sx] <= t) ink++;
          n++;
        }
      }
      small[y * tw + x] = n ? (ink / n) * 255 : 0;
    }
  }

  let mass = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const v = small[y * tw + x];
      mass += v;
      cx += x * v;
      cy += y * v;
    }
  }
  cx = mass ? cx / mass : tw / 2;
  cy = mass ? cy / mass : th / 2;

  const out = new Uint8Array(28 * 28);
  const ox = Math.round(14 - cx);
  const oy = Math.round(14 - cy);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const dx = x + ox;
      const dy = y + oy;
      if (dx < 0 || dy < 0 || dx >= 28 || dy >= 28) continue;
      out[dy * 28 + dx] = Math.min(255, Math.round(small[y * tw + x]));
    }
  }
  return out;
}

export {
  MIN_BANNER_OVERLAP,
  decodeGray,
  loadPng,
  classify,
  alignmentWindow,
  referenceTarget,
  bannerOverlap,
  fitAxis,
  rowProfile,
  colProfile,
  registerTo,
  registerBestSide,
  quarterTurn,
  cropCell,
  inkFraction,
  inkThreshold,
  components,
  boxMarked,
  stripMarked,
  segmentDigits,
  normalizeDigit,
};
