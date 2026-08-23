/**
 * Reading the number written in a TOTAL box.
 *
 * This is the second reader. `tally.ts` counts marks geometrically; this one
 * cuts the handwritten number into digits and matches each against exemplars.
 * The two share no code and fail for unrelated reasons, which is what makes
 * `reconcile` worth having.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE IS THE ONLY COPY. `scripts/lib/cardvision.mjs` imports from here.
 *
 * The cutting was tuned against the ink threshold below and not against the
 * one in `marks.ts`, which estimates paper locally and strikes printed rules.
 * They are different algorithms and are not interchangeable: swapping them
 * silently invalidates every segmentation figure in HANDOFF.md. That is why
 * this module carries its own threshold rather than reusing the mark one.
 * ---------------------------------------------------------------------------
 */

/**
 * A grayscale crop: 0 is black, 255 is paper.
 *
 * Structurally the same as MarkImage in marks.ts and deliberately named the
 * same way, so a crop can be handed to either reader without being reshaped.
 */
export interface DigitImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface DigitBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

/**
 * Otsu's threshold: the cut that best separates ink from paper for THIS crop.
 *
 * A fixed threshold cannot serve every cell -- pencil varies from faint to
 * heavy across volunteers, and scanner exposure drifts across a 114-page feed.
 */
function otsu(img: DigitImage): number {
  const hist = new Array(256).fill(0);
  for (const v of img.data) hist[v]++;
  const total = img.data.length;

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
export function inkThreshold(img: DigitImage): number {
  const sorted = Uint8Array.from(img.data).sort();
  const paper = sorted[sorted.length >> 1]!;
  const dark = sorted[Math.floor(sorted.length * 0.02)]!;

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
export function inkMask(img: DigitImage): Uint8Array {
  const t = inkThreshold(img);
  const mask = new Uint8Array(img.width * img.height);
  if (t < 0) return mask;

  const ix = Math.max(3, Math.round(img.width * 0.06));
  const iy = Math.max(3, Math.round(img.height * 0.08));

  for (let y = iy; y < img.height - iy; y++) {
    for (let x = ix; x < img.width - ix; x++) {
      const i = y * img.width + x;
      mask[i] = img.data[i]! <= t ? 1 : 0;
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
export function components(
  mask: Uint8Array,
  width: number,
  height: number,
  minPixels = 12,
): DigitBox[] {
  const labels = new Int32Array(width * height).fill(-1);
  const out = [];
  const stack: number[] = [];

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
      const p = stack.pop()!;
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
/**
 * Splitting a wide component into two digits was tried and made things worse.
 *
 * "20" written with the nought joined to the two is one component, and cutting
 * it at the emptiest column in the middle is the obvious repair. Measured on
 * 1.18 Imperial Beach it took the cells cut into too many pieces from 45 to 65
 * and the total from 72.8% to 68.5%: single digits are wider than tall often
 * enough -- a 4, a 7 with a bar, anything written in a hurry -- that the rule
 * cuts more real digits than joined pairs. Whatever fixes touching digits has
 * to recognise the join, not just the width.
 */

/**
 * A gap this small, as a share of digit height, is a break in one digit rather
 * than the space between two. Volunteers lift the pen mid-digit constantly.
 *
 * Swept against the sheets rather than picked. It trades one failure for the
 * other -- join more eagerly and cells cut into too MANY pieces fall from 45 to
 * 18 while cells cut into too few climb from 18 to 38 -- and this sits at the
 * bottom of that curve.
 */
const FRAGMENT_GAP = 0.18;

export function segmentDigits(img: DigitImage): DigitBox[] {
  const mask = inkMask(img);
  if (!mask.some((v) => v)) return [];
  let boxes = components(mask, img.width, img.height);
  if (boxes.length === 0) return [];

  // Reject anything shaped like a rule rather than a digit. A leftover slice of
  // the printed border arrives as a very wide, very short component, or a very
  // tall hairline; a digit is neither.
  //
  // There used to be a fourth test here -- `w > img.width * 0.75` is a rule --
  // and it was throwing away real numbers. A volunteer who writes "30" across
  // the whole box leaves ONE component 76 pixels wide in a 100-pixel crop, and
  // that is not a rule by any other measure: it is 33 tall, so the bar test
  // (w/h > 3.5) does not touch it, and it is solid, so the hollow test does
  // not either. Rendering the cells where segmentation found NOTHING is what
  // turned it up; four of the twenty-six on 1.18 Imperial were digits struck by
  // that one line, each of them plainly legible.
  //
  // Removed rather than loosened, because a bar this high can only ever fire on
  // handwriting: `inkMask` insets the crop by 6% a side, so no component can be
  // wider than 88% of it, and a printed rule spanning the cell is caught by the
  // two tests that remain. Measured, it costs nothing anywhere:
  //
  //   cut into the right number of digits   1.18 Imperial  3.22 Pacific  8.23 Seaport
  //     with the width test                     75.8%          74.7%        81.5%
  //     without it                              76.8%          74.9%        81.5%
  //
  // and the cells cut into too MANY pieces do not move at all (28, 37, 7).
  boxes = boxes.filter((b) => {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    // Too short to be a digit.
    //
    // 0.18 was set by eye, like the hollow line below, and moving it was tried
    // properly: swept over 28 scans and then carried all the way through a
    // regenerated training set and a retrain, because segmentation figures on
    // their own do not say whether a change is good.
    //
    // Lowering it to 0.16 DOES cut more cells correctly -- 73.0% -> 73.5%, with
    // cells nothing is found in falling 274 -> 260. It was still reverted:
    //
    //                          digits   accuracy   precision   cells offered
    //   short 0.18              3,325      70.3%       86.0%      938 @ 85.7%
    //   short 0.16              3,387      69.5%       85.6%      947 @ 85.3%
    //
    // The 62 extra digits are harder than the ones already there, so both
    // accuracy and precision fall. Net it is about four more cells read right
    // and about as many more read WRONG, which is not a trade this project
    // makes: a blank box costs a keystroke, a confident wrong number costs the
    // chapter's data.
    //
    // The lesson is the method, not the constant. A segmentation sweep alone
    // would have shipped this as a clear win.
    if (h < img.height * 0.18) return false;
    if (w / h > 3.5) return false; // a horizontal bar
    // Ink should fill some of a digit's own box; a hollow rectangle outline
    // (the cell border) does not.
    //
    // This was 0.12 and set by eye, and it was throwing away legible digits by
    // a hair -- of the cells where segmentation found NOTHING on 1.18 Imperial,
    // four were rejected here at fills of 0.100, 0.113, 0.114 and 0.118. A
    // digit drawn as a large open loop by someone who writes roundly is exactly
    // this shape. Swept over nine scans, cells cut into the right number of
    // digits against cells cut into too MANY (the failure this test guards):
    //
    //   hollow   1.18 Imp   3.22 Pac   8.23 Sea   7.05 Moon   8.02 OB   over
    //     0.12      76.8%      74.9%      81.5%       67.9%     62.7%    176
    //     0.06      79.2%      77.2%      82.0%       70.5%     65.3%    175
    //
    // No scan gets worse and the over-cut count does not move, because the
    // border this test was meant to catch is already gone: inkMask insets the
    // crop by 6% a side. Lowered rather than removed -- a one-pixel outline
    // still scores below 0.06 -- and it is a floor now, not a filter.
    return b.count >= w * h * 0.06;
  });
  if (boxes.length === 0) return [];

  // Drop specks: anything far smaller than the tallest survivor is a stray
  // mark, not a digit.
  const tallest = Math.max(...boxes.map((b) => b.maxY - b.minY + 1));
  boxes = boxes.filter((b) => b.maxY - b.minY + 1 >= tallest * 0.45);

  boxes.sort((a, b) => a.minX - b.minX);

  // Put the pieces of one digit back together.
  //
  // Overlap in x is not enough on its own, and the cases it misses are ordinary:
  // a nought closed badly leaves two arcs side by side, a 5 is drawn as a bar
  // and a bowl. Those sit ADJACENT rather than on top of each other, so they are
  // joined on a small gap instead -- but only when what comes out is still
  // shaped like a digit, which is what stops two real digits being welded into
  // one.
  const merged = [];
  for (const b of boxes) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const overlap = Math.min(prev.maxX, b.maxX) - Math.max(prev.minX, b.minX);
      const narrower = Math.min(prev.maxX - prev.minX, b.maxX - b.minX) + 1;
      const gap = b.minX - prev.maxX - 1;
      const height = Math.max(prev.maxY, b.maxY) - Math.min(prev.minY, b.minY) + 1;
      const joinedWidth = Math.max(prev.maxX, b.maxX) - Math.min(prev.minX, b.minX) + 1;
      const adjacent = gap <= height * FRAGMENT_GAP && joinedWidth <= height * 1.05;

      if (overlap > narrower * 0.5 || adjacent) {
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
export function normalizeDigit(img: DigitImage, box: DigitBox): Uint8Array {
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
          if (img.data[sy * img.width + sx]! <= t) ink++;
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
      const v = small[y * tw + x]!;
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
      out[dy * 28 + dx] = Math.min(255, Math.round(small[y * tw + x]!));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recognising a cut-out digit.
//
// Nearest neighbour over 28x28 bitmaps. Not a convolutional net, and the
// reason is inspectability: every reading can be traced to the exemplar it
// matched, which matters when the whole design rests on knowing when NOT to
// trust itself.
//
// train-digits.mjs imports the preparation below rather than keeping its own,
// because a query prepared differently from the exemplars is comparing nothing.
// ---------------------------------------------------------------------------

const SIDE = 28;

const px = (b: ArrayLike<number>, x: number, y: number): number =>
  x < 0 || y < 0 || x >= SIDE || y >= SIDE ? 0 : b[y * SIDE + x]!;

/** Bilinear sample, so a shear does not alias the strokes into steps. */
function sampleAt(b: ArrayLike<number>, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  return (
    px(b, x0, y0) * (1 - fx) * (1 - fy) +
    px(b, x0 + 1, y0) * fx * (1 - fy) +
    px(b, x0, y0 + 1) * (1 - fx) * fy +
    px(b, x0 + 1, y0 + 1) * fx * fy
  );
}

/**
 * Shear out the writer's slant and put the centre of ink in the middle.
 *
 * Two people writing the same digit at different slants sit further apart in
 * pixels than two DIFFERENT digits at the same slant, which is a property of
 * the comparison rather than of the handwriting. Worth about 3 points.
 */
export function deskewRecentre(b: ArrayLike<number>): Float32Array {
  let m = 0;
  let cx = 0;
  let cy = 0;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const v = b[y * SIDE + x]!;
      m += v;
      cx += x * v;
      cy += y * v;
    }
  }
  if (!m) return Float32Array.from(b);
  cx /= m;
  cy /= m;

  let mu11 = 0;
  let mu02 = 0;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const v = b[y * SIDE + x]!;
      mu11 += (x - cx) * (y - cy) * v;
      mu02 += (y - cy) ** 2 * v;
    }
  }
  const skew = mu02 > 1e-6 ? mu11 / mu02 : 0;
  const ctr = (SIDE - 1) / 2;

  const out = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const sy = y + (cy - ctr);
      out[y * SIDE + x] = sampleAt(b, x + (cx - ctr) + skew * (sy - cy), sy);
    }
  }
  return out;
}

/**
 * 3x3 blur.
 *
 * Straight L2 punishes a stroke drawn one pixel over exactly as hard as it
 * punishes a different digit. Blurring lets a near miss score as a near miss.
 */
export function blur3(b: ArrayLike<number>): Float32Array {
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const out = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      let s = 0;
      let w = 0;
      let i = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, i++) {
          s += px(b, x + dx, y + dy) * k[i]!;
          w += k[i]!;
        }
      }
      out[y * SIDE + x] = s / w;
    }
  }
  return out;
}

/**
 * Scale to unit length.
 *
 * Without this, L2 is partly a comparison of how much ink each digit carries,
 * so a heavily written 1 can sit closer to a 0 than to a light 1.
 */
export function unitNorm(b: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(b);
  let n = 0;
  for (const v of out) n += v * v;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= n;
  return out;
}

/** Everything a bitmap gets before it is ever compared. */
export function prepare(bitmap: ArrayLike<number>): Float32Array {
  return unitNorm(blur3(deskewRecentre(bitmap)));
}

/** Squared L2, with an early exit once it cannot make the poll. */
export function distance(a: Float32Array, b: Float32Array, cutoff: number): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
    if (sum > cutoff) return Infinity;
  }
  return sum;
}

const SHIFTS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
] as const;

/** The query moved a pixel each way, so a near miss can score as a near miss. */
export function shiftVariants(b: Float32Array): Float32Array[] {
  return SHIFTS.map(([dx, dy]) => {
    const o = new Float32Array(SIDE * SIDE);
    for (let y = 0; y < SIDE; y++) {
      for (let x = 0; x < SIDE; x++) o[y * SIDE + x] = px(b, x + dx, y + dy);
    }
    return unitNorm(o);
  });
}

export interface Exemplar {
  label: number;
  /** Prepared and unit-normalized, ready to compare. */
  v: Float32Array;
}

export interface DigitModel {
  k: number;
  exemplars: Exemplar[];
}

/** How many nearest are pulled before the shift re-score. */
const POOL = 25;

/**
 * Classify by polling the k nearest exemplars.
 *
 * Confidence is the share of the poll won by the top label, weighted by
 * closeness. It is what a pre-fill is gated on, so it is measured rather than
 * assumed to track correctness -- see `scripts/train-digits.mjs`.
 */
export function classifyDigit(
  bitmap: ArrayLike<number>,
  model: DigitModel,
): { label: number | null; confidence: number } {
  const q = prepare(bitmap);

  const pool: { d: number; label: number; v: Float32Array }[] = [];
  for (const e of model.exemplars) {
    const cutoff = pool.length < POOL ? Infinity : pool[pool.length - 1]!.d;
    const d = distance(q, e.v, cutoff);
    if (d === Infinity) continue;
    pool.push({ d, label: e.label, v: e.v });
    pool.sort((x, y) => x.d - y.d);
    if (pool.length > POOL) pool.pop();
  }
  if (pool.length === 0) return { label: null, confidence: 0 };

  const variants = shiftVariants(q);
  const best = pool
    .map((c) => {
      let m = Infinity;
      for (const v of variants) {
        const d = distance(v, c.v, m);
        if (d < m) m = d;
      }
      return { d: m, label: c.label };
    })
    .sort((x, y) => x.d - y.d)
    .slice(0, model.k);

  const weights = new Map<number, number>();
  let total = 0;
  for (const b of best) {
    const w = 1 / (Math.sqrt(b.d) + 1e-6);
    weights.set(b.label, (weights.get(b.label) ?? 0) + w);
    total += w;
  }

  let label: number | null = null;
  let bestW = -1;
  for (const [l, w] of weights) {
    if (w > bestW) {
      bestW = w;
      label = l;
    }
  }
  return { label, confidence: total ? bestW / total : 0 };
}

/**
 * Read the whole number in a TOTAL box: cut it, classify each digit, and give
 * the value only if EVERY digit was read.
 *
 * "2" and "21" are different numbers of debris, so a cell is worth nothing
 * unless all of its digits are answered. The confidence returned is the WORST
 * of them for the same reason.
 */
export function readDigits(
  img: DigitImage,
  model: DigitModel,
): { value: number; confidence: number } | null {
  const boxes = segmentDigits(img);
  if (boxes.length === 0) return null;

  // More than three pieces used to be refused outright. It is now read as the
  // three tallest, left to right, on the chapter owner's instruction to fill
  // every box it can.
  //
  // A total on this card is one to three digits, so a fourth piece is a speck,
  // a stray mark, or one digit that came apart -- and height is what separates
  // those from the digits, since a hand writes them all the same size. It is a
  // guess either way: dropping the wrong piece turns 105 into 10. So it is
  // capped hard below, and it is rare -- 2 cells of 450 on 1.18 Imperial, none
  // on the 58-card test scan.
  const tooMany = boxes.length > 3;
  const use = tooMany
    ? [...boxes]
        .sort((a, b) => b.maxY - b.minY - (a.maxY - a.minY))
        .slice(0, 3)
        .sort((a, b) => a.minX - b.minX)
    : boxes;

  let text = "";
  let worst = 1;
  for (const box of use) {
    const { label, confidence } = classifyDigit(normalizeDigit(img, box), model);
    if (label === null) return null;
    text += String(label);
    worst = Math.min(worst, confidence);
  }

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  // A number assembled from a guess about which pieces are digits is worth less
  // than the worst digit in it, whatever the classifier says. Unmeasured, and
  // deliberately far below `AUTO_ACCEPT` so it is always shown.
  return { value, confidence: tooMany ? Math.min(worst, OVERSEGMENTED_CONFIDENCE) : worst };
}

/** Ceiling on a reading assembled from more pieces than a number can have. */
export const OVERSEGMENTED_CONFIDENCE = 0.3;

/** The shipped model's on-disk shape: raw 0-255 bytes, base64 per exemplar. */
interface EncodedModel {
  k: number;
  samples: { label: number; b: string }[];
}

/**
 * Turn the shipped JSON into something comparable.
 *
 * The file stores raw bytes because that is a third of the size of the
 * prepared float vectors; the preparation happens here, once, at load. It must
 * be the SAME preparation the query gets, which is why both go through
 * `prepare` rather than each having its own.
 */
export function decodeModel(raw: unknown): DigitModel {
  const m = raw as EncodedModel;
  if (!m || !Array.isArray(m.samples)) throw new Error("digit model is not in the expected shape");

  const exemplars: Exemplar[] = [];
  for (const s of m.samples) {
    const bin = atob(s.b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    exemplars.push({ label: s.label, v: prepare(bytes) });
  }
  return { k: m.k ?? 5, exemplars };
}
