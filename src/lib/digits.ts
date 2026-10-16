/**
 * Reading the number written in a TOTAL box.
 *
 * This is the second reader. `tally.ts` counts marks geometrically; this one
 * cuts the handwritten number into digits and reads each one -- with a small
 * convolutional net since September 2026, or by matching it against exemplars,
 * whichever `digit-model.json` holds.
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
 * Binary ink mask, with the printed box struck out and the handwriting kept.
 *
 * The cell map's boxes sit right on the printed rules, and at 200 DPI those are
 * several pixels thick. This used to deal with them by ignoring a margin of 6%
 * of the width and 8% of the height on every side, and that margin was eating
 * the numbers: volunteers start writing hard against the left rule, so the
 * first digit of "67", "24", "13" or "100" fell inside it, came out as a sliver
 * or not at all, and the cell was read as "7", "4", "3" or "0" -- confidently,
 * because the digit that was left was perfectly legible. And a rule that
 * registration had landed a few pixels INSIDE the margin survived it whole,
 * and was read as a "1".
 *
 * So the margin is now two pixels, and a rule is recognised by what it is
 * rather than by where it is: a run of ink along one column (or one row) in the
 * outer part of the box, straight to within a pixel either way and spanning
 * most of it. Handwriting does neither -- a "1" leans and stops well short of
 * the box -- so it survives even when it touches the rule.
 *
 * Measured end to end, over the 4,096 written cells that have a typed value and
 * with each scan read by a net that never saw it (28 September 2026):
 *
 *                                       margin      rules struck
 *   reading equals the sheet             1,841        1,899
 *   hidden at AUTO_ACCEPT 0.45           2,592        2,643
 *   ... of which disagree with sheet       930          900
 *
 * More read right, more taken off the list, and fewer of those wrong. The
 * digit-COUNT measure in diagnose-segmentation.mjs does not see it at all
 * (73.0% -> 72.9%): what moved is WHICH pieces come out, not how many.
 */
export function inkMask(img: DigitImage, box?: Area, threshold?: number): Uint8Array {
  const { width: w, height: h } = img;
  const t = threshold ?? inkThreshold(img);
  const mask = new Uint8Array(w * h);
  if (t < 0) return mask;

  for (let y = EDGE; y < h - EDGE; y++) {
    for (let x = EDGE; x < w - EDGE; x++) {
      const i = y * w + x;
      mask[i] = img.data[i]! <= t ? 1 : 0;
    }
  }
  strikeRules(mask, w, h, box ?? { x: 0, y: 0, width: w, height: h });
  return mask;
}

/**
 * Where the printed TOTAL box sits inside a crop that was taken with room around
 * it. Without one, the crop IS the box, which is how every offline script cuts.
 */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixels at the very edge of a crop that are never ink: resampling fringe, not writing. */
const EDGE = 2;

/**
 * How much of the box a straight run must span to be a printed rule, and how
 * far in from the edge one can sit. The span is what separates a rule from a
 * "1"; the band is registration drift, which lands the rule a few pixels inside
 * the crop rather than on its edge.
 */
const RULE_SPAN = 0.75;
const RULE_BAND = 0.2;

/**
 * The longest run of rows (or columns) in which `ink(k, j)` is set for some j in
 * [at-1, at+1], bridging breaks of up to RULE_GAP: a printed rule comes through
 * the scanner with the odd pale pixel in it, and one gap must not halve it.
 */
function longestRun(n: number, at: number, ink: (k: number, j: number) => boolean): { length: number; start: number; end: number } {
  let best = { length: 0, start: 0, end: -1 };
  let start = -1;
  let last = -1;
  for (let k = 0; k < n; k++) {
    if (!(ink(k, at - 1) || ink(k, at) || ink(k, at + 1))) continue;
    if (start < 0 || k - last > RULE_GAP + 1) start = k;
    last = k;
    if (last - start + 1 > best.length) best = { length: last - start + 1, start, end: last };
  }
  return best;
}

const RULE_GAP = 2;

/**
 * A straight upright run that starts and ends inside the box is a "1", not a rule.
 *
 * The span test alone took a tall, upright 1 written near the left side for the
 * printed column line and erased it, and "18", "16", "13" and "10" were read,
 * confidently, as 8, 6, 3 and 0. The reader's crop has room above and below the
 * box (`READ_MARGIN` in extract.ts), and a printed line runs on into that room
 * where a 1 stops. "Runs on" and not "runs longer than the box": scanned rules
 * come through broken, often mid-box. So a run is spared when it stays within
 * `tol` of the box's top and bottom, and only when the crop has `room` (as
 * shares of the box height) to show a rule running past; without it, as in the
 * offline scripts' crops, nothing changes.
 *
 * Measured under the apps' rule (`scripts/apps-rule.mjs`, 11 October 2026):
 *
 *   tol        taken, equal to sheet   taken, not equal
 *   (before)          2,211                 1,113
 *   0.05              2,220                 1,106
 *   0.10              2,222                 1,104
 *   0.15              2,227                 1,100
 *   0.20              2,228                 1,098
 *   0.30              1,878                 1,415   rules escape: tol reaches the crop's room
 *
 * 0.15 rather than 0.2 to stay clear of that cliff; `room` is kept a tenth above it.
 *
 * The same room finds a printed line in the MIDDLE of a box, which the side
 * band never looked at: on the back of some cards a column line runs straight
 * through the TOTAL box, and it was read as a confident 1 in a box the sheet
 * has as 0. A straight run out of both the top and the bottom of the box is
 * struck wherever it is; a written 1 never does that. Seven boxes go blank (the
 * sheet has 0 for five, 1 for one), and taken right 2,275 -> 2,276, taken
 * wrong 1,047 -> 1,044 (12 October 2026).
 */
const RULE_THROUGH = { room: 0.25, tol: 0.15 };

/** Erase the printed rules from a mask in place. See `inkMask`. */
function strikeRules(mask: Uint8Array, w: number, h: number, box: Area): void {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // Near an edge of the printed box, which is the edge of the crop unless the
  // crop was taken with room around it.
  const nearX = (x: number) =>
    Math.abs(x - box.x) < box.width * RULE_BAND || Math.abs(x - (box.x + box.width)) <= box.width * RULE_BAND;
  const nearY = (y: number) =>
    Math.abs(y - box.y) < box.height * RULE_BAND || Math.abs(y - (box.y + box.height)) <= box.height * RULE_BAND;

  // With room above and below the box, a "1" stops inside it and a printed rule
  // does not: see `RULE_THROUGH`.
  const tol = box.height * RULE_THROUGH.tol;
  const room = Math.min(box.y, h - (box.y + box.height)) >= box.height * RULE_THROUGH.room;
  const columns: number[] = [];
  for (let x = 0; x < w; x++) {
    const run = longestRun(h, x, (y, j) => at(j, y));
    if (run.length < box.height * RULE_SPAN) continue;
    if (!nearX(x)) {
      // Away from the sides only a line straight through the box and out of
      // both its top and its bottom is printing: see `RULE_THROUGH`.
      if (room && run.start < box.y - tol && run.end > box.y + box.height - 1 + tol) columns.push(x);
      continue;
    }
    if (room && run.start >= box.y - tol && run.end <= box.y + box.height - 1 + tol) continue;
    columns.push(x);
  }
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    if (!nearY(y)) continue;
    if (longestRun(w, y, (x, j) => at(x, j)).length >= box.width * RULE_SPAN) rows.push(y);
  }

  // A pixel either side as well: the run test allows that much wobble, and a
  // rule's anti-aliased edge left behind reads as a hairline "1".
  for (const x of columns) {
    for (let dx = -1; dx <= 1; dx++) {
      if (x + dx < 0 || x + dx >= w) continue;
      for (let y = 0; y < h; y++) mask[y * w + x + dx] = 0;
    }
  }
  for (const y of rows) {
    for (let dy = -1; dy <= 1; dy++) {
      if (y + dy < 0 || y + dy >= h) continue;
      mask.fill(0, (y + dy) * w, (y + dy + 1) * w);
    }
  }
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
  reach = 1,
  labels = new Int32Array(width * height),
): DigitBox[] {
  labels.fill(-1);
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

      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
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
 * to recognise the join, not just the width. `JOINED` in readDigits does it by
 * asking the net, after the cutting.
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

/**
 * A "1" written just left of the TOTAL box, kept as the number's first digit.
 *
 * The box filter in `segmentDigits` keeps a piece only if a quarter of it is
 * inside the box, which is what keeps the tally strip's last strokes out. But
 * volunteers also start a number left of the box, and a 1 there was lost: 14,
 * 18 and 12 read as 4, 8 and 2, confidently. A piece outside the box is kept
 * when it is a straight stroke (`isStraightStroke`) at least `tall` box heights
 * tall, ending no more than `reach` box widths left of the box, with the first
 * piece inside the box no more than `gap` box widths to its right. A tally
 * stroke beside an empty box has nothing to stand in front of, so it stays out.
 *
 * Measured under the apps' rule (`scripts/apps-rule.mjs`, 11 October 2026),
 * from taken right 2,227 and taken wrong 1,100:
 *
 *   reach  gap   tall    right    wrong
 *   0.05   0.2   0.5     2,235    1,092
 *   0.05   0.2   0.4     2,236    1,088
 *   0.10   0.2   0.4     2,238    1,085
 *   0.15   0.2   0.4     2,238    1,085
 *   0.05   0.3   0.4     2,233    1,090
 *
 * What it still gets wrong, by eye: the last tally stroke beside a written
 * total ("|||| 24" read 124; the other strokes are outside the reading crop),
 * and tallies drawn in the box ("||", read 1 before and 11 now). Refusing a
 * stroke with another one just left of it was tried and was a wash.
 */
const LEFT_ONE = { reach: 0.1, gap: 0.2, tall: 0.4 };

/**
 * Pencil that broke up, put back together before anything is measured.
 *
 * Light pencil comes through the threshold as a dotted line, and a digit drawn
 * in it falls into fragments a pixel apart. Each fragment is shorter than half
 * the other digit, so the speck filter in `segmentDigits` threw it away before
 * `FRAGMENT_GAP` could join it: "33" read as 3, "46" as 6, "20" as 2. So pieces
 * that come within one pixel of each other (`components` with a reach of 2) are
 * joined -- unless two or more of them are each `whole` the height of the lot,
 * which is two digits written close, kept apart as before. Pencil dust (bits
 * under 12 pixels) can join a group but never make one, or a faint box would be
 * read from its dust instead of getting `FAINT_LOOK`'s second look.
 *
 * Measured under the apps' rule (`scripts/apps-rule.mjs`, 11 October 2026),
 * from taken right 2,238 and taken wrong 1,085:
 *
 *                                         right    wrong
 *   every pair within a pixel joined      2,260    1,068   but 32 broken by the sheets,
 *                                                           mostly faint boxes read from dust
 *   dust may not start a group, whole 0.75  2,258    1,067   12 broken
 *   ... whole 0.6                           2,258    1,066   10 broken
 *   ... whole 0.5                           2,259    1,066   10 broken
 *   ... never join two pieces over whole    2,248    1,074
 *
 * Then a flat sliver lying along the box's top or bottom stopped joining: what
 * striking leaves of a printed rule glued a tally stroke to the line it stood
 * on, and the pair fell outside the box ("|||" read 1). Flat pieces anywhere
 * else stay in, because they are a 5's bar or a 2's foot -- leaving out every
 * one cost 6 right readings. Taken right 2,264 -> 2,265, wrong 1,059 -> 1,057.
 */
const BRIDGE = { whole: 0.5 };

function bridgeBreaks(mask: Uint8Array, width: number, height: number, box?: Area): DigitBox[] {
  const pieceAt = new Int32Array(width * height);
  const groupAt = new Int32Array(width * height);
  const all = components(mask, width, height, 0, 1, pieceAt);
  const groups = components(mask, width, height, 0, 2, groupAt);
  // Which group each piece fell in: any one of its pixels says.
  const groupOf = new Int32Array(all.length).fill(-1);
  for (let i = 0; i < pieceAt.length; i++) if (pieceAt[i]! >= 0 && groupOf[pieceAt[i]!]! < 0) groupOf[pieceAt[i]!] = groupAt[i]!;
  const out: DigitBox[] = [];
  for (let g = 0; g < groups.length; g++) {
    // A flat sliver along the box's top or bottom is what striking leaves of a
    // printed rule: it would glue a stroke to the line it touches. Left on its
    // own for the bar test to drop. Elsewhere a flat piece is a 5's bar or a 2's foot.
    const nearRule = (y: number) =>
      box !== undefined && (Math.abs(y - box.y) <= box.height * 0.1 || Math.abs(y - (box.y + box.height)) <= box.height * 0.1);
    const bar = (p: DigitBox) =>
      p.maxX - p.minX + 1 > (p.maxY - p.minY + 1) * 3.5 && nearRule((p.minY + p.maxY) / 2);
    const inGroup = all.filter((p, k) => groupOf[k] === g && p.count >= 12);
    out.push(...inGroup.filter(bar));
    const members = inGroup.filter((p) => !bar(p));
    if (members.length === 0) continue;
    const gh = Math.max(...members.map((p) => p.maxY)) - Math.min(...members.map((p) => p.minY)) + 1;
    const whole = members.filter((p) => p.maxY - p.minY + 1 >= gh * BRIDGE.whole);
    if (whole.length >= 2) {
      out.push(...members);
      continue;
    }
    out.push({
      minX: Math.min(...members.map((p) => p.minX)),
      maxX: Math.max(...members.map((p) => p.maxX)),
      minY: Math.min(...members.map((p) => p.minY)),
      maxY: Math.max(...members.map((p) => p.maxY)),
      count: members.reduce((n, p) => n + p.count, 0),
    });
  }
  return out;
}

export function segmentDigits(img: DigitImage, box?: Area, threshold?: number): DigitBox[] {
  const mask = inkMask(img, box, threshold);
  if (!mask.some((v) => v)) return [];
  let boxes = bridgeBreaks(mask, img.width, img.height, box);
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
    if (h < (box?.height ?? img.height) * 0.18) return false;
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

  // With room around the box, keep only what belongs to it: a piece at least a
  // quarter inside it across, whose middle is on its row. That takes the digit
  // a volunteer started on the rule, or a 1 leaning out past it, and leaves the
  // last strokes of the tally strip and the next row's numbers where they are.
  // A 1 written wholly left of the box comes back in front: see `LEFT_ONE`.
  if (box) {
    const onRow = (b: DigitBox) => {
      const middle = (b.minY + b.maxY) / 2;
      return middle >= box.y && middle < box.y + box.height;
    };
    const inside = boxes.filter((b) => {
      const across = Math.min(b.maxX, box.x + box.width - 1) - Math.max(b.minX, box.x) + 1;
      return across >= (b.maxX - b.minX + 1) * 0.25 && onRow(b);
    });
    if (inside.length === 0) return [];
    const first = Math.min(...inside.map((b) => b.minX));
    const { reach, gap, tall } = LEFT_ONE;
    const leftOne = boxes
      .filter(
        (b) =>
          !inside.includes(b) &&
          onRow(b) &&
          b.maxX < first &&
          b.maxX >= box.x - box.width * reach &&
          first - b.maxX - 1 <= box.width * gap &&
          b.maxY - b.minY + 1 >= box.height * tall &&
          isStraightStroke(mask, img.width, b),
      )
      .sort((a, b) => b.maxX - a.maxX)[0];
    boxes = leftOne ? [leftOne, ...inside] : inside;
  }

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
  //
  // Except when one side is already a whole "1". A 1 is so thin that a 1 and
  // anything beside it are still narrower than they are tall, so the shape test
  // above waved "14", "12" and "10" through as one digit -- read, confidently,
  // as a 4, a 2 or a 0 -- and a count in the teens is the commonest two-digit
  // number on a beach card. A 1 is told from a fragment by being a straight
  // stroke the full height of the pair; the halves of a badly closed nought
  // are curves, and a 5's bar is short.
  //
  // This was tried once and REJECTED, and then kept once `readDigits` began
  // showing every all-1s reading to a person: what it had got wrong was
  // splitting tally marks drawn in the box into confident 1s. Measured end to
  // end over the 4,096 written cells, each scan read by a net that never saw it:
  //
  //                                    joined   kept apart
  //   reading equals the sheet          2,006      2,041
  //   hidden at AUTO_ACCEPT 0.45        2,622      2,656
  //   ... of which disagree               766        770
  //   ... leaving out mismatched cards  17.1%      16.5%
  //
  // 35 more read right, and of the 34 more hidden, 30 right.
  const merged = [];
  for (const b of boxes) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const overlap = Math.min(prev.maxX, b.maxX) - Math.max(prev.minX, b.minX);
      const narrower = Math.min(prev.maxX - prev.minX, b.maxX - b.minX) + 1;
      const gap = b.minX - prev.maxX - 1;
      const height = Math.max(prev.maxY, b.maxY) - Math.min(prev.minY, b.minY) + 1;
      const joinedWidth = Math.max(prev.maxX, b.maxX) - Math.min(prev.minX, b.minX) + 1;
      const wholeOne = (p: DigitBox) =>
        p.maxY - p.minY + 1 >= height * 0.7 && isStraightStroke(mask, img.width, p);
      const adjacent =
        gap <= height * FRAGMENT_GAP &&
        joinedWidth <= height * 1.05 &&
        !wholeOne(prev) &&
        !wholeOne(b);

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
 * Is the ink in this box one straight stroke, upright or leaning?
 *
 * The middle of the ink on each row is fitted with a line; a stroke stays within
 * a pixel or two of it, a curve bows away. Thin too: a straight stroke is narrow
 * for its height, however it leans.
 */
function isStraightStroke(mask: Uint8Array, width: number, b: DigitBox): boolean {
  const h = b.maxY - b.minY + 1;
  if (b.maxX - b.minX + 1 > h * 0.45) return false;
  const ys: number[] = [];
  const xs: number[] = [];
  for (let y = b.minY; y <= b.maxY; y++) {
    let sum = 0;
    let n = 0;
    for (let x = b.minX; x <= b.maxX; x++) {
      if (mask[y * width + x]) {
        sum += x;
        n++;
      }
    }
    if (n) {
      ys.push(y);
      xs.push(sum / n);
    }
  }
  if (ys.length < h * 0.6) return false;
  const my = ys.reduce((a, v) => a + v, 0) / ys.length;
  const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < ys.length; i++) {
    syy += (ys[i]! - my) ** 2;
    sxy += (ys[i]! - my) * (xs[i]! - mx);
  }
  const slope = syy ? sxy / syy : 0;
  let sq = 0;
  for (let i = 0; i < ys.length; i++) sq += (xs[i]! - (mx + slope * (ys[i]! - my))) ** 2;
  return Math.sqrt(sq / ys.length) <= Math.max(1.5, h * 0.05);
}

/**
 * Normalize a digit box to a 28x28 bitmap: scaled to fit 20x20 and centred by
 * centre of mass. This is the MNIST convention, so the same preprocessing
 * serves whichever classifier ends up being used.
 */
export function normalizeDigit(img: DigitImage, box: DigitBox, threshold?: number): Uint8Array {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const scale = 20 / Math.max(w, h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  // The same threshold the piece was cut with: a light-pencil piece sampled at
  // the ordinary one comes out as a nearly blank bitmap. See `LIGHT_PENCIL`.
  const t = threshold ?? inkThreshold(img);
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

/**
 * The forms a query is tried in before it is called a mismatch.
 *
 * Two people writing the same digit differ by a handful of small
 * transformations, and L2 over pixels charges full price for every one of
 * them. `prepare` already removes two: the shear a writer's slant puts in
 * (deskew) and a stroke landing a fraction of a pixel over (the blur). The
 * nine one-pixel offsets removed a third, translation, and were worth 1.6
 * points on their own.
 *
 * Rotation and size are the two that were left, and neither a shear nor a blur
 * absorbs them: a digit written at a tilt is not a sheared digit, and a small
 * one is not a blurred one. Adding them measured, leave-one-event-out over
 * 3,325 digits at K=5:
 *
 *                                  accuracy   at conf >= 0.90   whole cells
 *     nine offsets (as it was)       70.3%    1203 at 86.0%     804/938  85.7%
 *     + rotation +/-8 degrees        70.6%    1231 at 86.2%     821/957  85.8%
 *     + size +/-10%                  71.3%    1224 at 85.9%     815/943  86.4%
 *     + both, which is this          71.4%    1261 at 86.0%     842/975  86.4%
 *
 * More coverage at the same precision, on both the digit and the whole-cell
 * measure, which is the shape every accepted change here has had.
 *
 * WIDER IS NOT BETTER. Taking rotation to +/-16 degrees and size to
 * 0.85-1.20 gives 70.9% -- worse than this and better than none. A tolerance
 * wide enough to carry a 1 onto a 7 buys the confusion it was meant to avoid.
 *
 * SIZE IS WORTH MORE THAN TILT, and the reason is in `prepare` rather than in
 * the handwriting: it recentres by centre of mass and shears by second moment,
 * so a digit written a pixel over or leaning is already most of the way onto
 * its twin before a variant is tried, while nothing in it normalizes SIZE.
 * tests/digits.test.ts pins this -- on a straight stroke the offsets and the
 * tilt buy exactly zero, and the size warp is what closes the gap. What the
 * offsets and rotations still buy on real digits is the part recentring gets
 * approximately, because a centre of mass moves with the shape itself.
 *
 * ON THE QUERY AND NOT THE EXEMPLARS, which is a performance choice and was
 * measured as one. Warping all 3,325 exemplars instead scores 71.6%, two
 * tenths better, and multiplies the search -- the part that is 3,325
 * comparisons rather than 25 -- by five. On a phone that is the whole cost.
 */
const WARPS = [
  [0, 1],
  [-8, 1],
  [8, 1],
  [0, 0.9],
  [0, 1.1],
] as const;

const SHIFTS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
] as const;

/**
 * One rotation, scale and offset of a prepared vector, sampled bilinearly.
 *
 * Bilinear rather than nearest for the same reason `deskewRecentre` is: a
 * rotation snapped to whole pixels breaks a smooth stroke into a staircase,
 * and the staircase is what the distance would then be measuring. At the
 * identity warp this is exactly the whole-pixel shift it replaces.
 */
function warp(b: ArrayLike<number>, deg: number, scale: number, dx: number, dy: number): Float32Array {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const m = (SIDE - 1) / 2;

  const out = new Float32Array(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const ux = (x + dx - m) / scale;
      const uy = (y + dy - m) / scale;
      out[y * SIDE + x] = sampleAt(b, m + ux * cos + uy * sin, m - ux * sin + uy * cos);
    }
  }
  return unitNorm(out);
}

/**
 * The query in every form it is allowed to take, so a near miss scores as one.
 *
 * Each is unit-normalized, because the exemplars are and a distance between
 * differently-scaled vectors means nothing.
 */
export function matchVariants(b: Float32Array): Float32Array[] {
  const out: Float32Array[] = [];
  for (const [deg, scale] of WARPS) {
    for (const [dx, dy] of SHIFTS) out.push(warp(b, deg, scale, dx, dy));
  }
  return out;
}

export interface Exemplar {
  label: number;
  /** Prepared and unit-normalized, ready to compare. */
  v: Float32Array;
}

/** The nearest-neighbour reader: the chapter's own labelled digits, polled. */
export interface KnnModel {
  kind?: "knn";
  k: number;
  exemplars: Exemplar[];
}

/**
 * The convolutional reader, trained by `scripts/train_digits_cnn.py`: MNIST
 * first, for the digits the chapter barely writes, then the chapter's own.
 *
 * The layers are the few a small net needs and nothing more, so they run here
 * in plain loops rather than through a runtime that would cost more to fetch
 * than the model does.
 */
export interface CnnModel {
  kind: "cnn";
  /** Logits are divided by this before the softmax, which is what makes the confidence mean something. */
  temperature: number;
  layers: CnnLayer[];
}

export type CnnLayer =
  | { type: "conv"; in: number; out: number; k: number; pad: number; w: Float32Array; b: Float32Array }
  | { type: "dense"; in: number; out: number; w: Float32Array; b: Float32Array }
  | { type: "relu" }
  | { type: "maxpool"; k: number }
  | { type: "flatten" };

export type DigitModel = KnnModel | CnnModel;

/** How many nearest are pulled before the shift re-score. */
const POOL = 25;

/**
 * Classify one normalized bitmap with whichever reader the model is.
 *
 * For the nearest-neighbour reader, by polling the k nearest exemplars:
 * confidence is the share of the poll won by the top label, weighted by
 * closeness. For the net, the calibrated softmax of the top label. Either way it
 * is what a pre-fill is gated on, so it is measured rather than assumed to track
 * correctness -- see `scripts/train-digits.mjs` and `scripts/train_digits_cnn.py`.
 */
export function classifyDigit(
  bitmap: ArrayLike<number>,
  model: DigitModel,
): { label: number | null; confidence: number } {
  if (model.kind === "cnn") return classifyWithNet(bitmap, model);
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

  const variants = matchVariants(q);
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
 * The net's ten logits for one normalized bitmap.
 *
 * Plain loops over typed arrays. The loop order in the convolution is the one
 * that keeps the innermost loop running along a row of both images, which is
 * most of what makes it fast enough: about six million multiply-adds a digit,
 * the same order as the nearest-neighbour search.
 */
/**
 * The same net as `netLogitsReference`, laid out for speed: activations pixel-
 * major (every channel of a pixel together), weights reordered once per layer
 * so the innermost loop runs down one contiguous row, and every zero input --
 * most of a digit's blank paper, about half of what each ReLU passes on --
 * skipped instead of multiplied. Same arithmetic, summed in a different order,
 * so a logit can differ in its last float bits and nowhere else (pinned in
 * tests/digits-net.test.ts).
 */
const FAST = new WeakMap<object, Float32Array>();

function convWeights(layer: { in: number; out: number; k: number; w: Float32Array }): Float32Array {
  let t = FAST.get(layer);
  if (!t) {
    const { in: c, out: o, k } = layer;
    t = new Float32Array(layer.w.length);
    // [o][i][ky][kx] -> [i][ky][kx][o]
    for (let oo = 0; oo < o; oo++)
      for (let i = 0; i < c; i++)
        for (let q = 0; q < k * k; q++) t[(i * k * k + q) * o + oo] = layer.w[(oo * c + i) * k * k + q]!;
    FAST.set(layer, t);
  }
  return t;
}

function denseWeights(layer: { in: number; out: number; w: Float32Array }, c: number, h: number, w: number): Float32Array {
  let t = FAST.get(layer);
  if (!t) {
    // Trained against channel-major input ([ch][y][x]); reordered to the pixel-
    // major input it is now handed ([y][x][ch]), transposed to [in][out].
    const n = layer.out;
    t = new Float32Array(layer.w.length);
    for (let ch = 0; ch < c; ch++)
      for (let p = 0; p < h * w; p++) {
        const from = ch * h * w + p;
        const to = p * c + ch;
        for (let oo = 0; oo < n; oo++) t[to * n + oo] = layer.w[oo * layer.in + from]!;
      }
    FAST.set(layer, t);
  }
  return t;
}

export function netLogits(bitmap: ArrayLike<number>, model: CnnModel): Float32Array {
  let x = new Float32Array(SIDE * SIDE);
  for (let i = 0; i < x.length; i++) x[i] = (bitmap[i] ?? 0) / 255;
  let c = 1;
  let h = SIDE;
  let w = SIDE;
  let flat = { c: 1, h: SIDE, w: SIDE };

  for (const layer of model.layers) {
    switch (layer.type) {
      case "conv": {
        const { k, pad } = layer;
        const o = layer.out;
        const wt = convWeights(layer);
        const out = new Float32Array(h * w * o);
        for (let p = 0; p < h * w; p++) out.set(layer.b, p * o);
        for (let y = 0; y < h; y++) {
          for (let xx = 0; xx < w; xx++) {
            const base = (y * w + xx) * c;
            for (let i = 0; i < c; i++) {
              const v = x[base + i]!;
              if (v === 0) continue;
              for (let ky = 0; ky < k; ky++) {
                const oy = y - (ky - pad);
                if (oy < 0 || oy >= h) continue;
                for (let kx = 0; kx < k; kx++) {
                  const ox = xx - (kx - pad);
                  if (ox < 0 || ox >= w) continue;
                  const wr = ((i * k + ky) * k + kx) * o;
                  const dst = (oy * w + ox) * o;
                  for (let oo = 0; oo < o; oo++) out[dst + oo]! += wt[wr + oo]! * v;
                }
              }
            }
          }
        }
        x = out;
        c = o;
        break;
      }
      case "relu":
        for (let i = 0; i < x.length; i++) if (x[i]! < 0) x[i] = 0;
        break;
      case "maxpool": {
        const { k } = layer;
        const oh = Math.floor(h / k);
        const ow = Math.floor(w / k);
        const out = new Float32Array(oh * ow * c).fill(-Infinity);
        for (let y = 0; y < oh * k; y++)
          for (let xx = 0; xx < ow * k; xx++) {
            const src = (y * w + xx) * c;
            const dst = (Math.floor(y / k) * ow + Math.floor(xx / k)) * c;
            for (let ch = 0; ch < c; ch++) if (x[src + ch]! > out[dst + ch]!) out[dst + ch] = x[src + ch]!;
          }
        x = out;
        h = oh;
        w = ow;
        break;
      }
      case "flatten":
        flat = { c, h, w };
        c = c * h * w;
        h = w = 1;
        break;
      case "dense": {
        const n = layer.out;
        const wt = denseWeights(layer, flat.c, flat.h, flat.w);
        const out = Float32Array.from(layer.b);
        for (let i = 0; i < layer.in; i++) {
          const v = x[i]!;
          if (v === 0) continue;
          const row = i * n;
          for (let oo = 0; oo < n; oo++) out[oo]! += wt[row + oo]! * v;
        }
        x = out;
        c = n;
        h = w = 1;
        flat = { c: n, h: 1, w: 1 };
        break;
      }
    }
  }
  return x;
}

/** The net exactly as trained, one loop per formula: what `netLogits` is checked against. */
export function netLogitsReference(bitmap: ArrayLike<number>, model: CnnModel): Float32Array {
  let x = new Float32Array(SIDE * SIDE);
  for (let i = 0; i < x.length; i++) x[i] = (bitmap[i] ?? 0) / 255;
  let c = 1;
  let h = SIDE;
  let w = SIDE;

  for (const layer of model.layers) {
    switch (layer.type) {
      case "conv": {
        const { k, pad } = layer;
        const plane = h * w;
        const out = new Float32Array(layer.out * plane);
        for (let o = 0; o < layer.out; o++) {
          const dst = o * plane;
          out.fill(layer.b[o]!, dst, dst + plane);
          for (let i = 0; i < c; i++) {
            const src = i * plane;
            for (let ky = 0; ky < k; ky++) {
              const dy = ky - pad;
              const y0 = Math.max(0, -dy);
              const y1 = Math.min(h, h - dy);
              for (let kx = 0; kx < k; kx++) {
                const dx = kx - pad;
                const x0 = Math.max(0, -dx);
                const x1 = Math.min(w, w - dx);
                const wv = layer.w[((o * c + i) * k + ky) * k + kx]!;
                for (let y = y0; y < y1; y++) {
                  const row = dst + y * w;
                  const from = src + (y + dy) * w + dx;
                  for (let xx = x0; xx < x1; xx++) out[row + xx]! += wv * x[from + xx]!;
                }
              }
            }
          }
        }
        x = out;
        c = layer.out;
        break;
      }
      case "relu":
        for (let i = 0; i < x.length; i++) if (x[i]! < 0) x[i] = 0;
        break;
      case "maxpool": {
        const { k } = layer;
        const oh = Math.floor(h / k);
        const ow = Math.floor(w / k);
        const out = new Float32Array(c * oh * ow);
        for (let ch = 0; ch < c; ch++) {
          for (let y = 0; y < oh; y++) {
            for (let xx = 0; xx < ow; xx++) {
              let m = -Infinity;
              for (let py = 0; py < k; py++) {
                for (let px = 0; px < k; px++) {
                  const v = x[ch * h * w + (y * k + py) * w + xx * k + px]!;
                  if (v > m) m = v;
                }
              }
              out[ch * oh * ow + y * ow + xx] = m;
            }
          }
        }
        x = out;
        h = oh;
        w = ow;
        break;
      }
      case "flatten":
        // Already channel-major and contiguous, which is the order the dense
        // weights were trained against.
        c = c * h * w;
        h = w = 1;
        break;
      case "dense": {
        const out = new Float32Array(layer.out);
        for (let o = 0; o < layer.out; o++) {
          let sum = layer.b[o]!;
          const row = o * layer.in;
          for (let i = 0; i < layer.in; i++) sum += layer.w[row + i]! * x[i]!;
          out[o] = sum;
        }
        x = out;
        c = layer.out;
        h = w = 1;
        break;
      }
    }
  }
  return x;
}

/** The top label and its calibrated softmax probability. */
function classifyWithNet(
  bitmap: ArrayLike<number>,
  model: CnnModel,
): { label: number | null; confidence: number } {
  const logits = netLogits(bitmap, model);
  let top = 0;
  for (let i = 1; i < logits.length; i++) if (logits[i]! > logits[top]!) top = i;
  let total = 0;
  for (let i = 0; i < logits.length; i++) total += Math.exp((logits[i]! - logits[top]!) / model.temperature);
  return { label: top, confidence: 1 / total };
}

/**
 * Read the whole number in a TOTAL box: cut it, classify each digit, and give
 * the value only if EVERY digit was read.
 *
 * "2" and "21" are different numbers of debris, so a cell is worth nothing
 * unless all of its digits are answered. The confidence returned is the WORST
 * of them for the same reason.
 */
type DigitReading = {
  value: number;
  confidence: number;
  /**
   * Every digit read was a 1, and there were at least two: 11, 111. Capped
   * below, and the one case where `countBoxTally` in tally.ts is asked whether
   * the "digits" were tally strokes all along.
   */
  onlyOnes: boolean;
  /** Where the digit sits in `img`, when the number is one piece. */
  piece?: DigitBox;
};

export function readDigits(img: DigitImage, model: DigitModel, box?: Area): DigitReading | null {
  const first = readOnce(img, model, box);
  // A weak reading may be a faint number of which only the darkest strokes
  // were cut out: look again at the light-pencil threshold. See `FAINT_LOOK`.
  if (!first || first.light) return first && strip(first);
  const sorted = Uint8Array.from(img.data).sort();
  if (first.worst >= FAINT_LOOK.below || FAINT_LOOK.below === 0) {
    // A confident single digit may be the dark half of a number whose second
    // digit is faint pencil. See `FAINT_SECOND`.
    if (first.digits === 1) {
      const again = readOnce(img, model, box, sorted[sorted.length >> 1]! - LIGHT_PENCIL.depth);
      if (
        again &&
        again.digits === 2 &&
        String(again.value).startsWith(String(first.value)) &&
        again.value !== 11 &&
        again.worst >= FAINT_SECOND.confidence
      ) {
        return strip({ ...again, confidence: Math.min(again.worst, first.worst) });
      }
    }
    return strip(first);
  }
  const again = readOnce(img, model, box, sorted[sorted.length >> 1]! - LIGHT_PENCIL.depth);
  if (
    again &&
    again.digits <= LIGHT_PENCIL.maxDigits &&
    again.value !== first.value &&
    again.worst >= FAINT_LOOK.confidence &&
    again.worst > first.worst
  ) {
    return strip({ ...again, confidence: again.worst });
  }
  return strip(first);
}

/**
 * When the first look at a box read weakly, how a second look at the
 * light-pencil threshold (`LIGHT_PENCIL`) may replace it: only where every
 * digit of the second reading is at `confidence` or better, there are at most
 * `LIGHT_PENCIL.maxDigits` of them, and it says something else. 0 for `below`
 * turns it off.
 *
 * The first look cuts at Otsu's threshold, which on faint pencil keeps only the
 * darkest dots: a "77" comes out as part of one 7, a "35" as the 5, a "4" as
 * two strokes read 11. `LIGHT_PENCIL` already looked again where nothing at
 * all was found; this looks again where what was found read badly.
 *
 * Measured 11 October 2026 on the apps' pixels (`scripts/apps-rule.mjs`): 66
 * values change. Against the sheets 41 are fixed, 2 broken and 7 wrong either
 * way; of the 2, one is the sheet's mistake (a plain 7 typed 1) and one real
 * (a "13" read 3, its 1 against the box's edge). The 16 the sheets have no
 * value for are all right by eye. Taken right 2,176 -> 2,211, taken wrong
 * 1,139 -> 1,113.
 */
/**
 * Re-tuned on 14 October 2026 for the owner's measure (how far the numbers
 * taken unseen are off, not how many) and the width-4 reader: this bar, and
 * JOINED's and FAINT_SECOND's, were set on the width-1 reader by exact matches.
 * Swept one at a time and then together under the apps' rule: total absolute
 * error 10,007 -> 9,676 with the three moved (0.83 -> 0.75 here, 0.83 -> 0.75
 * for JOINED, 0.7 -> 0.6 for FAINT_SECOND), and exactly right 2,241 -> 2,251.
 * `below` stays at 0.6: 0.5 and 0.7 were both worse.
 */
export const FAINT_LOOK = { below: 0.6, confidence: 0.75 };

/**
 * A confident single digit, read again at the light-pencil threshold for a
 * second digit the first look missed.
 *
 * `FAINT_LOOK` only looks again where the first reading is weak. But in "12"
 * or "18" written with a hard 1 and a light second digit, Otsu's threshold
 * keeps the 1 whole and only dots of the 2 -- its foot goes as a horizontal
 * bar -- so the box reads as a confident 1, and goes in unseen. Now every
 * single digit is read again, and the second reading is taken where it is the
 * same digit followed by one more, each at `confidence` or better. Not where
 * it is 11: a second faint stroke beside a 1 is "||" for 2 as often as eleven.
 *
 * Measured under the apps' rule (`scripts/apps-rule.mjs`, 13 October 2026),
 * from taken right 2,282 and taken wrong 1,032:
 *
 *   confidence   right    wrong   by the sheets
 *   0.83         2,284    1,029   3 fixed, none broken
 *   0.70         2,291    1,024   9 fixed, none broken (12, 12, 18, 33, 17, 12, 10, 11, 15)
 *   0.60         2,291    1,024
 */
export const FAINT_SECOND = { confidence: 0.6 }; // re-tuned 14 Oct 2026, see FAINT_LOOK

const strip = ({ worst: _w, digits: _d, light: _l, ...r }: DigitReading & { worst: number; digits: number; light: boolean }) => r;

function readOnce(
  img: DigitImage,
  model: DigitModel,
  box?: Area,
  threshold?: number,
): (DigitReading & { worst: number; digits: number; light: boolean }) | null {
  let boxes = segmentDigits(img, box, threshold);

  // Nothing found: look again for light pencil. See `LIGHT_PENCIL`.
  let light: number | undefined = threshold;
  if (boxes.length === 0 && threshold === undefined) {
    const sorted = Uint8Array.from(img.data).sort();
    light = sorted[sorted.length >> 1]! - LIGHT_PENCIL.depth;
    boxes = segmentDigits(img, box, light);
    if (boxes.length > LIGHT_PENCIL.maxDigits) return null;
  }
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
  let split = false;
  for (const box of use) {
    const whole = classifyDigit(normalizeDigit(img, box, light), model);
    // Two digits written touching, read both ways: see `JOINED`.
    const halves =
      use.length < 3 && JOINED.aspect > 0 && whole.confidence < JOINED.wholeBelow ? splitJoined(img, box, light) : null;
    if (halves) {
      const reads = halves.map((h) => classifyDigit(normalizeDigit(img, h, light), model));
      const weaker = Math.min(...reads.map((r) => r.confidence));
      if (reads.every((r) => r.label !== null) && weaker >= JOINED.confidence && weaker > whole.confidence) {
        text += reads.map((r) => String(r.label)).join("");
        worst = Math.min(worst, weaker);
        split = true;
        continue;
      }
    }
    if (whole.label === null) return null;
    text += String(whole.label);
    worst = Math.min(worst, whole.confidence);
  }

  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  // One piece that is a solid block of ink is printing, a tear or a blot: see
  // `SOLID_BLOCK`.
  const solid = use.length === 1 && solidBlock(use[0]!);
  // A number assembled from a guess about which pieces are digits is worth less
  // than the worst digit in it, whatever the classifier says. Unmeasured, and
  // deliberately far below `AUTO_ACCEPT` so it is always shown.
  //
  // The same goes for a number made of nothing but 1s. Volunteers draw tally
  // marks in the TOTAL box as well as beside it, and two or three uprights are
  // read -- each one confidently -- as 11 or 111. Measured end to end over the
  // 4,096 written cells with a typed value, 160 read as all 1s and only 20 of
  // them were that number; of the 99 that cleared AUTO_ACCEPT, 80 were wrong,
  // most of them a small count (3, 4, 1, 0) the sheet has for a tally. So they
  // are always shown, at the price of a person confirming the real elevens.
  // Where the strokes are three or more and the strip beside the box is empty,
  // `countBoxTally` in tally.ts counts them instead; see `onlyOnes`.
  const allOnes = text.length >= 2 && /^1+$/.test(text);
  return {
    value,
    confidence: tooMany || allOnes || light !== undefined || solid ? Math.min(worst, OVERSEGMENTED_CONFIDENCE) : worst,
    onlyOnes: allOnes,
    piece: use.length === 1 && !split ? use[0] : undefined,
    worst,
    digits: text.length,
    light: light !== undefined,
  };
}

/**
 * Two digits written touching -- "20" with the nought joined to the two -- come
 * out of `segmentDigits` as one piece, and are read as one digit.
 *
 * Cutting every wide piece at its thinnest column was tried and made things
 * worse (see `segmentDigits`): single digits are wide often enough. So the cut
 * is only a question put to the net. A piece at least `aspect` times as wide
 * as it is tall is cut at the emptiest column in its middle, each side keeping
 * at least `minHeight` of the piece's height, and the two halves are kept only
 * where both read at `confidence` or better and better than the whole did --
 * and only where the whole read under `wholeBelow`, because a confident wide
 * "2" split into "23" is the failure this has to avoid.
 *
 * Measured 11 October 2026 on the apps' pixels (`scripts/apps-rule.mjs`): 12
 * boxes change, every one right by the sheet or by eye -- "20", "30", "25",
 * "22" and "140" that were read as 2, 5, 1 or 16. At `confidence` 0.8 and no
 * `wholeBelow` it also split a lone "2" into 23 and two slashed or slanted
 * noughts into 63 and 62 (their weaker halves read 0.81). 0 for `aspect`
 * turns it off.
 */
export const JOINED = { aspect: 1.15, middle: 0.3, minHeight: 0.6, wholeBelow: 0.6, confidence: 0.75 }; // re-tuned 14 Oct 2026, see FAINT_LOOK

function splitJoined(img: DigitImage, box: DigitBox, threshold?: number): [DigitBox, DigitBox] | null {
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  if (w < h * JOINED.aspect) return null;
  const t = threshold ?? inkThreshold(img);
  const inked = (x: number, y: number) => img.data[y * img.width + x]! <= t;
  let cut = -1;
  let least = Infinity;
  for (let x = box.minX + Math.round(w * JOINED.middle); x <= box.maxX - Math.round(w * JOINED.middle); x++) {
    let n = 0;
    for (let y = box.minY; y <= box.maxY; y++) if (inked(x, y)) n++;
    if (n < least) {
      least = n;
      cut = x;
    }
  }
  if (cut < 0) return null;
  const side = (x0: number, x1: number): DigitBox | null => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inked(x, y)) continue;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (count === 0 || maxY - minY + 1 < h * JOINED.minHeight) return null;
    return { minX, maxX, minY, maxY, count };
  };
  const left = side(box.minX, cut);
  const right = side(cut + 1, box.maxX);
  return left && right ? [left, right] : null;
}

/**
 * A piece too wide and too solid to be one stroke of a pen.
 *
 * A dark printed band at the box's edge, or a torn patch of card, comes out as
 * one piece and is read as 1 at 0.8 or more. A written 1 fills its bounding box
 * too, but only while it is narrow. Measured with `reading-accuracy.mjs`, this
 * shows one more box on the 28 scans, a torn card, and moves nothing read
 * right; on the test scan it shows both printed bands at row 71. A bar of 5
 * pixels at 0.95 showed a real 1 in marker instead (seaport-8.23 card 16), and
 * one of 8 missed a band 6 pixels wide at 0.99 (test-long card 14).
 */
const SOLID_BLOCK = { width: 6, fill: 0.85 };

function solidBlock(b: DigitBox): boolean {
  const w = b.maxX - b.minX + 1;
  const h = b.maxY - b.minY + 1;
  return w >= SOLID_BLOCK.width && b.count >= w * h * SOLID_BLOCK.fill;
}

/**
 * A second look at a box the first found nothing in, for numbers written in
 * light pencil.
 *
 * `inkThreshold` counts a pixel as ink only below 200 on paper that scans at
 * about 251, and light pencil sits between 170 and 230. So only the darkest
 * dots of each stroke survive, they fall under the twelve-pixel floor for a
 * piece, and a plainly legible "26" or "19" is read as nothing at all -- a box
 * that reaches the volunteer as "nothing read: type it" with a 1 in it. The
 * mark test that offered the box measures against the paper around it and saw
 * the number; this is the same idea, once, only where the first pass found
 * nothing, so no reading it made before can change.
 *
 * Measured over the 28 matched scans with each read by a net that never saw it
 * (`reading-accuracy.mjs --cache`), against the placeholder those boxes get
 * without it:
 *
 *   ink below paper by    read    equal to the sheet    total error vs the sheet
 *   (placeholder 1)          -          23                    1,671
 *     15                   137          58                    1,837
 *     20                   126          59                    1,973
 *     25                   115          51                    2,230
 *   20, two digits at most 119          59                    1,294   <- this
 *
 * The limit on digits is what makes it safe to have. At a lighter threshold the
 * grain of the paper beside a faint number is cut out as more digits -- a 3
 * read as 423, a 14 as 121 -- and every one of those was three digits; no
 * reading it refuses was right. With it, the second look puts the right number
 * in two and a half times as many boxes as the placeholder, and is further off
 * in total by less. On the test scan, read by eye: 6 right (26, 19, 5, 5 and
 * two faint 1s), 2 wrong numbers, 5 marks from the neighbouring rows read as
 * digits, and 3 empty boxes read from smudges.
 *
 * So it is capped like a guess and always shown: `OVERSEGMENTED_CONFIDENCE`.
 */
export const LIGHT_PENCIL = { depth: 20, maxDigits: 2 };

/** Ceiling on a reading assembled from more pieces than a number can have, or made only of 1s. */
export const OVERSEGMENTED_CONFIDENCE = 0.3;

/** The shipped model's on-disk shape: raw 0-255 bytes, base64 per exemplar. */
interface EncodedModel {
  k: number;
  samples: { label: number; b: string }[];
}

/** The net's on-disk shape: see the `note` train_digits_cnn.py writes into it. */
interface EncodedNet {
  kind: "cnn-28x28";
  temperature: number;
  layers: (
    | { type: "conv"; in: number; out: number; k: number; pad: number; w: string; b: string }
    | { type: "dense"; in: number; out: number; w: string; b: string }
    | { type: "relu" }
    | { type: "maxpool"; k: number }
    | { type: "flatten" }
  )[];
}

function floats(b64: string, expected: number, what: string): Float32Array {
  const bin = atob(b64);
  if (bin.length !== expected * 4) throw new Error(`digit model: ${what} has ${bin.length / 4} weights, expected ${expected}`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(expected);
  for (let i = 0; i < expected; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/**
 * Decode the net and walk its shapes once, so a file that does not fit together
 * fails here -- where `loadDigitModel` turns it into "no digit reader" -- rather
 * than as a wrong number halfway through a scan.
 */
function decodeNet(m: EncodedNet): CnnModel {
  let c = 1;
  let h = SIDE;
  let w = SIDE;
  const layers: CnnLayer[] = m.layers.map((l, n) => {
    const at = `layer ${n} (${l.type})`;
    switch (l.type) {
      case "conv":
        if (l.in !== c || 2 * l.pad !== l.k - 1) throw new Error(`digit model: ${at} does not fit its input`);
        c = l.out;
        return { ...l, w: floats(l.w, l.out * l.in * l.k * l.k, at), b: floats(l.b, l.out, at) };
      case "dense":
        if (l.in !== c * h * w) throw new Error(`digit model: ${at} expects ${l.in} inputs, gets ${c * h * w}`);
        c = l.out;
        h = w = 1;
        return { ...l, w: floats(l.w, l.out * l.in, at), b: floats(l.b, l.out, at) };
      case "maxpool":
        h = Math.floor(h / l.k);
        w = Math.floor(w / l.k);
        return l;
      case "flatten":
        c = c * h * w;
        h = w = 1;
        return l;
      case "relu":
        return l;
      default:
        throw new Error(`digit model: unknown ${at}`);
    }
  });
  if (c * h * w !== 10) throw new Error(`digit model: ends in ${c * h * w} outputs, not 10`);
  if (!(m.temperature > 0)) throw new Error("digit model: temperature must be positive");
  return { kind: "cnn", temperature: m.temperature, layers };
}

/**
 * Turn the shipped JSON into something comparable.
 *
 * Either reader can be shipped in the same file, and `kind` says which. The
 * nearest-neighbour file stores raw bytes because that is a third of the size of
 * the prepared float vectors; the preparation happens here, once, at load. It
 * must be the SAME preparation the query gets, which is why both go through
 * `prepare` rather than each having its own.
 */
export function decodeModel(raw: unknown): DigitModel {
  if ((raw as { kind?: string } | null)?.kind === "cnn-28x28") return decodeNet(raw as EncodedNet);
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
