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

function normalize(a: Float64Array): Float64Array {
  let mean = 0;
  for (const v of a) mean += v;
  mean /= a.length;

  const out = new Float64Array(a.length);
  let norm = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]! - mean;
    out[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / norm;
  return out;
}

/**
 * Integer shift of `b` that best matches `a`, by normalized cross-correlation.
 *
 * Sheet-fed scanning offsets each page by a few pixels; across the 82 reference
 * pages this ran from -14 to +9.
 */
export function bestShift(a: Float64Array, b: Float64Array, maxShift = 60): number {
  const A = normalize(a);
  const B = normalize(b);
  let best = 0;
  let bestScore = -Infinity;

  for (let s = -maxShift; s <= maxShift; s++) {
    let score = 0;
    const start = Math.max(0, -s);
    const end = Math.min(A.length, B.length - s);
    for (let i = start; i < end; i++) score += A[i]! * B[i + s]!;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
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
