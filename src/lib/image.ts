/**
 * Grayscale image primitives shared by registration and cropping.
 *
 * These are the browser-side ports of the routines in
 * `scripts/build-reference.mjs`, which were validated by using them to
 * composite 41 real scans into the blank reference card. The measurements
 * quoted in the comments come from that run.
 */

export interface GrayImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 = black, 255 = paper. */
  data: Uint8Array;
}

/** Rec. 601 luma, matching the reference builder. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000;
  }
  return { width, height, data };
}

/** Mean darkness of each row, over an optional horizontal window. */
export function rowProfile(img: GrayImage, x0 = 0, x1 = img.width): Float64Array {
  const out = new Float64Array(img.height);
  const span = x1 - x0;
  for (let y = 0; y < img.height; y++) {
    const off = y * img.width;
    let sum = 0;
    for (let x = x0; x < x1; x++) sum += 255 - img.data[off + x]!;
    out[y] = sum / span;
  }
  return out;
}

/** Mean darkness of each column, over an optional vertical window. */
export function colProfile(img: GrayImage, y0 = 0, y1 = img.height): Float64Array {
  const out = new Float64Array(img.width);
  for (let y = y0; y < y1; y++) {
    const off = y * img.width;
    for (let x = 0; x < img.width; x++) out[x] = out[x]! + (255 - img.data[off + x]!);
  }
  const span = y1 - y0;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / span;
  return out;
}

/** How the page's coordinates map onto the reference's, along one axis. */
export interface AxisFit {
  /** reference index i corresponds to page index `scale * i + offset`. */
  scale: number;
  offset: number;
  /** Normalized cross-correlation at that fit, over the window. Higher is better. */
  score: number;
}

/** Box-average a profile down by `factor`, for the coarse pass. */
function decimate(a: Float64Array, factor: number): Float64Array {
  const n = Math.floor(a.length / factor);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += a[i * factor + k]!;
    out[i] = sum / factor;
  }
  return out;
}

/**
 * Correlate `ref[i0..i1)` against `page` sampled at `scale * i + offset`.
 *
 * Returns -1 when the window does not mostly land on the page, so a fit that
 * "wins" by hanging off the edge and correlating a handful of samples cannot be
 * chosen.
 */
function fitScore(
  ref: Float64Array,
  page: Float64Array,
  i0: number,
  i1: number,
  scale: number,
  offset: number,
): number {
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
    const b = page[t0]! * (1 - f) + page[t0 + 1]! * f;
    const a = ref[i]!;
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

/** Decimation for the coarse pass: 4x is 16x less work and still resolves a row. */
const COARSE = 4;

/**
 * Find the scale and offset mapping a page's darkness profile onto the
 * reference's, over a window of the reference.
 *
 * Three things here are deliberate, and each fixes an observed failure:
 *
 * **Scale, not just translation.** Scans of the same card differ in size by up
 * to 2.5% -- enough to move the bottom row of the grid by 30px, which is half a
 * row. No translation fixes that; cells land on row boundaries instead of TOTAL
 * boxes.
 *
 * **A window, not the whole page.** Correlating the full page averages regions
 * that do not move together. On the Imperial Beach scans the card's grid sits
 * ~105px lower relative to its masthead than on the scan the reference was
 * built from, so a whole-page fit splits the difference and lands the grid
 * ~50px out. Restricting the window to the grid -- the only part cells are
 * cropped from -- takes the fit from 0.72 to 0.98.
 *
 * **Coarse to fine.** The grid is periodic, so a fine search over a wide offset
 * range has near-equal optima one row apart. The coarse pass runs on a 4x
 * decimated profile where a single row is blurred away and the section banners
 * dominate, which picks the right basin; the fine pass then only has to refine
 * within it.
 */
export function fitAxis(
  refProfile: Float64Array,
  pageProfile: Float64Array,
  i0: number,
  i1: number,
  { maxScaleDeviation = 0.06, maxOffset = 360 } = {},
): AxisFit {
  const refCoarse = decimate(refProfile, COARSE);
  const pageCoarse = decimate(pageProfile, COARSE);
  const c0 = Math.floor(i0 / COARSE);
  const c1 = Math.floor(i1 / COARSE);

  let best: AxisFit = { scale: 1, offset: 0, score: -1 };

  for (let scale = 1 - maxScaleDeviation; scale <= 1 + maxScaleDeviation + 1e-9; scale += 0.004) {
    for (let offset = -maxOffset; offset <= maxOffset; offset += COARSE) {
      const score = fitScore(refCoarse, pageCoarse, c0, c1, scale, offset / COARSE);
      if (score > best.score) best = { scale, offset, score };
    }
  }

  // Refine at full resolution, within the basin the coarse pass chose.
  let refined = { ...best, score: -1 };
  for (let scale = best.scale - 0.005; scale <= best.scale + 0.005 + 1e-9; scale += 0.0005) {
    for (let offset = best.offset - 8; offset <= best.offset + 8 + 1e-9; offset += 0.5) {
      const score = fitScore(refProfile, pageProfile, i0, i1, scale, offset);
      if (score > refined.score) refined = { scale, offset, score };
    }
  }
  return refined;
}

/**
 * Estimate page skew in degrees.
 *
 * The card is dense with long horizontal rules. Level, they pile into a few
 * tall spikes in the row-darkness profile; rotated, they smear across many
 * rows. The angle maximizing the profile's variance is the angle that levels
 * the page. Measured across the reference scans: median 0.40 deg, max 1.00.
 */
export function estimateSkew(img: GrayImage, maxDeg = 2, step = 0.1): number {
  const S = 4; // quarter scale; full resolution buys nothing for this
  const w = Math.floor(img.width / S);
  const h = Math.floor(img.height / S);

  const small = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      small[y * w + x] = 255 - img.data[y * S * img.width + x * S]!;
    }
  }

  const rows = new Float64Array(h);
  let bestAngle = 0;
  let bestScore = -Infinity;

  for (let deg = -maxDeg; deg <= maxDeg + 1e-9; deg += step) {
    rows.fill(0);
    const t = Math.tan((deg * Math.PI) / 180);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Shear approximates rotation well at these angles.
        const sy = y + Math.round((x - w / 2) * t);
        if (sy >= 0 && sy < h) rows[sy] = rows[sy]! + small[y * w + x]!;
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

/** Rotate about the image centre with bilinear sampling. */
/**
 * Turn an image by a whole number of quarter-turns clockwise.
 *
 * Separate from `rotate`, which shears a page by a fraction of a degree to
 * undo scanner skew and keeps its dimensions. A quarter turn swaps width and
 * height and loses nothing, so it is exact -- which matters, because this runs
 * before registration decides whether a page is usable at all.
 */
export function quarterTurn(img: GrayImage, turns: number): GrayImage {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return img;

  const { width: w, height: h, data } = img;
  const width = t === 2 ? w : h;
  const height = t === 2 ? h : w;
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx: number;
      let sy: number;
      if (t === 1) {
        sx = y;
        sy = h - 1 - x;
      } else if (t === 2) {
        sx = w - 1 - x;
        sy = h - 1 - y;
      } else {
        sx = w - 1 - y;
        sy = x;
      }
      out[y * width + x] = data[sy * w + sx]!;
    }
  }
  return { width, height, data: out };
}

export function rotate(img: GrayImage, deg: number): GrayImage {
  if (Math.abs(deg) < 1e-6) return img;

  const { width, height, data } = img;
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
        data[i]! * (1 - fx) * (1 - fy) +
        data[i + 1]! * fx * (1 - fy) +
        data[i + width]! * (1 - fx) * fy +
        data[i + width + 1]! * fx * fy;
    }
  }
  return { width, height, data: out };
}

/** An axis fit for each axis: the full page-to-reference mapping. */
export interface PageTransform {
  x: AxisFit;
  y: AxisFit;
}

/**
 * Resample a page into the reference's coordinate space.
 *
 * Bilinear, because the scale is not an integer ratio: nearest-neighbour
 * sampling at a 1.02 scale drops or doubles a scan line every 50 rows, which
 * thins pencil strokes unevenly across the page and is exactly the kind of
 * damage the digit segmenter is sensitive to.
 */
export function resampleToReference(
  page: GrayImage,
  width: number,
  height: number,
  t: PageTransform,
): GrayImage {
  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    const sy = t.y.scale * y + t.y.offset;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const dst = y * width;

    if (y0 < 0 || y0 + 1 >= page.height) {
      out.fill(255, dst, dst + width); // off the edge of the scan is paper
      continue;
    }

    const rowA = y0 * page.width;
    const rowB = rowA + page.width;

    for (let x = 0; x < width; x++) {
      const sx = t.x.scale * x + t.x.offset;
      const x0 = Math.floor(sx);
      if (x0 < 0 || x0 + 1 >= page.width) {
        out[dst + x] = 255;
        continue;
      }
      const fx = sx - x0;
      out[dst + x] =
        page.data[rowA + x0]! * (1 - fx) * (1 - fy) +
        page.data[rowA + x0 + 1]! * fx * (1 - fy) +
        page.data[rowB + x0]! * (1 - fx) * fy +
        page.data[rowB + x0 + 1]! * fx * fy;
    }
  }
  return { width, height, data: out };
}

/** Median pixel value: the page's paper level, by histogram rather than sorting. */
export function paperLevel(img: GrayImage): number {
  const hist = new Uint32Array(256);
  for (const v of img.data) hist[v]!++;
  const half = img.data.length >> 1;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v]!;
    if (seen > half) return v;
  }
  return 255;
}

/**
 * Which rows of a block are section banners: mostly ink, right across it.
 *
 * The banners are the one part of the card a volunteer cannot change. They ink
 * ~90% of a block's width; the densest thing anyone writes -- a full row of
 * tally marks -- reaches about 25%, because tallies are strokes with paper
 * between them. So this reads the printed card through the handwriting, which
 * is what makes it usable as a check on alignment.
 *
 * The threshold is taken from the page's own paper level, since scans vary from
 * white to distinctly gray.
 */
export function bannerRows(
  img: GrayImage,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Uint8Array {
  const ink = Math.max(60, paperLevel(img) - 60);
  const span = x1 - x0;
  const out = new Uint8Array(y1 - y0);

  for (let y = y0; y < y1; y++) {
    const off = y * img.width;
    let dark = 0;
    for (let x = x0; x < x1; x++) if (img.data[off + x]! < ink) dark++;
    out[y - y0] = dark > span * 0.5 ? 1 : 0;
  }
  return out;
}

/** Intersection over union of two binary masks. */
export function maskOverlap(a: Uint8Array, b: Uint8Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! && b[i]!) intersection++;
    if (a[i]! || b[i]!) union++;
  }
  return union ? intersection / union : 1;
}

/** Fraction of pixels darker than `threshold` in a rectangle. */
export function inkFraction(
  img: GrayImage,
  x: number,
  y: number,
  w: number,
  h: number,
  threshold = 170,
): number {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.ceil(x + w));
  const y1 = Math.min(img.height, Math.ceil(y + h));
  if (x1 <= x0 || y1 <= y0) return 0;

  let dark = 0;
  for (let yy = y0; yy < y1; yy++) {
    const off = yy * img.width;
    for (let xx = x0; xx < x1; xx++) if (img.data[off + xx]! < threshold) dark++;
  }
  return dark / ((x1 - x0) * (y1 - y0));
}

/** Crop a rectangle, clamped to the image, as a canvas for display. */
export function cropToCanvas(
  img: GrayImage,
  x: number,
  y: number,
  w: number,
  h: number,
  scale = 1,
): HTMLCanvasElement {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w));
  const y1 = Math.min(img.height, Math.round(y + h));
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);

  const src = new ImageData(cw, ch);
  for (let yy = 0; yy < ch; yy++) {
    const off = (y0 + yy) * img.width;
    for (let xx = 0; xx < cw; xx++) {
      const v = img.data[off + x0 + xx]!;
      const p = (yy * cw + xx) * 4;
      src.data[p] = src.data[p + 1] = src.data[p + 2] = v;
      src.data[p + 3] = 255;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d")!;

  if (scale === 1) {
    ctx.putImageData(src, 0, 0);
  } else {
    const tmp = document.createElement("canvas");
    tmp.width = cw;
    tmp.height = ch;
    tmp.getContext("2d")!.putImageData(src, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}
