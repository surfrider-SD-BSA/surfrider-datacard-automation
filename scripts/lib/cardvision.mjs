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

const MAX_SHIFT = 40;


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

function registerTo(page, reference) {
  const levelled = rotate(page, estimateSkew(page));
  const pr = profiles(levelled);
  const rr = profiles(reference);
  const dx = bestShift(rr.cols, pr.cols);
  const dy = bestShift(rr.rows, pr.rows);

  const out = new Uint8Array(reference.width * reference.height);
  for (let y = 0; y < reference.height; y++) {
    const sy = y + dy;
    const dst = y * reference.width;
    for (let x = 0; x < reference.width; x++) {
      const sx = x + dx;
      out[dst + x] =
        sy >= 0 && sy < levelled.height && sx >= 0 && sx < levelled.width
          ? levelled.gray[sy * levelled.width + sx]
          : 255;
    }
  }
  return { width: reference.width, height: reference.height, gray: out };
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
 * Extract every written-in TOTAL box from a scanned event, and segment each
 * into individual digit images.
 *
 * This is the offline half of recognition: it produces the training material
 * and the contact sheets used to check that segmentation actually works before
 * anything is built on top of it. The plan flags segmentation as the real risk
 * -- the card's TOTAL cells are open boxes with free-written numbers, not
 * per-digit combs -- so it gets looked at directly rather than assumed.
 *
 * Usage:
 *   node scripts/extract-crops.mjs <dir-of-page-jpegs> [--limit N]
 *
 * Writes to out/crops/:
 *   cells.json         one record per written cell (card, row, item, page)
 *   digits.json        one record per segmented digit, keyed to its cell
 *   contact-cells-N.png    grids of whole TOTAL boxes
 *   contact-digits-N.png   grids of segmented digits
 */





/**
 * Extract every written-in TOTAL box from a scanned event, and segment each
 * into individual digit images.
 *
 * This is the offline half of recognition: it produces the training material
 * and the contact sheets used to check that segmentation actually works before
 * anything is built on top of it. The plan flags segmentation as the real risk
 * -- the card's TOTAL cells are open boxes with free-written numbers, not
 * per-digit combs -- so it gets looked at directly rather than assumed.
 *
 * Usage:
 *   node scripts/extract-crops.mjs <dir-of-page-jpegs> [--limit N]
 *
 * Writes to out/crops/:
 *   cells.json         one record per written cell (card, row, item, page)
 *   digits.json        one record per segmented digit, keyed to its cell
 *   contact-cells-N.png    grids of whole TOTAL boxes
 *   contact-digits-N.png   grids of segmented digits
 */





/**
 * Extract every written-in TOTAL box from a scanned event, and segment each
 * into individual digit images.
 *
 * This is the offline half of recognition: it produces the training material
 * and the contact sheets used to check that segmentation actually works before
 * anything is built on top of it. The plan flags segmentation as the real risk
 * -- the card's TOTAL cells are open boxes with free-written numbers, not
 * per-digit combs -- so it gets looked at directly rather than assumed.
 *
 * Usage:
 *   node scripts/extract-crops.mjs <dir-of-page-jpegs> [--limit N]
 *
 * Writes to out/crops/:
 *   cells.json         one record per written cell (card, row, item, page)
 *   digits.json        one record per segmented digit, keyed to its cell
 *   contact-cells-N.png    grids of whole TOTAL boxes
 *   contact-digits-N.png   grids of segmented digits
 */





/**
 * Extract every written-in TOTAL box from a scanned event, and segment each
 * into individual digit images.
 *
 * This is the offline half of recognition: it produces the training material
 * and the contact sheets used to check that segmentation actually works before
 * anything is built on top of it. The plan flags segmentation as the real risk
 * -- the card's TOTAL cells are open boxes with free-written numbers, not
 * per-digit combs -- so it gets looked at directly rather than assumed.
 *
 * Usage:
 *   node scripts/extract-crops.mjs <dir-of-page-jpegs> [--limit N]
 *
 * Writes to out/crops/:
 *   cells.json         one record per written cell (card, row, item, page)
 *   digits.json        one record per segmented digit, keyed to its cell
 *   contact-cells-N.png    grids of whole TOTAL boxes
 *   contact-digits-N.png   grids of segmented digits
 */





/**
 * Extract every written-in TOTAL box from a scanned event, and segment each
 * into individual digit images.
 *
 * This is the offline half of recognition: it produces the training material
 * and the contact sheets used to check that segmentation actually works before
 * anything is built on top of it. The plan flags segmentation as the real risk
 * -- the card's TOTAL cells are open boxes with free-written numbers, not
 * per-digit combs -- so it gets looked at directly rather than assumed.
 *
 * Usage:
 *   node scripts/extract-crops.mjs <dir-of-page-jpegs> [--limit N]
 *
 * Writes to out/crops/:
 *   cells.json         one record per written cell (card, row, item, page)
 *   digits.json        one record per segmented digit, keyed to its cell
 *   contact-cells-N.png    grids of whole TOTAL boxes
 *   contact-digits-N.png   grids of segmented digits
 */





/**
 * Extract every written-in TOTAL box from a scanned event, and segment each
 * into individual digit images.
 *
 * This is the offline half of recognition: it produces the training material
 * and the contact sheets used to check that segmentation actually works before
 * anything is built on top of it. The plan flags segmentation as the real risk
 * -- the card's TOTAL cells are open boxes with free-written numbers, not
 * per-digit combs -- so it gets looked at directly rather than assumed.
 *
 * Usage:
 *   node scripts/extract-crops.mjs <dir-of-page-jpegs> [--limit N]
 *
 * Writes to out/crops/:
 *   cells.json         one record per written cell (card, row, item, page)
 *   digits.json        one record per segmented digit, keyed to its cell
 *   contact-cells-N.png    grids of whole TOTAL boxes
 *   contact-digits-N.png   grids of segmented digits
 */






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
      const sx0 = box.minX + Math.floor((x * w) / tw);
      const sx1 = box.minX + Math.max(sx0 + 1, Math.floor(((x + 1) * w) / tw));
      const sy0 = box.minY + Math.floor((y * h) / th);
      const sy1 = box.minY + Math.max(sy0 + 1, Math.floor(((y + 1) * h) / th));

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
  decodeGray,
  loadPng,
  classify,
  registerTo,
  cropCell,
  inkFraction,
  inkThreshold,
  segmentDigits,
  normalizeDigit,
};
