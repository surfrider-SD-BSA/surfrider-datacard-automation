/**
 * Did a person write in this rectangle?
 *
 * This is the question the reviewer's time depends on. The tool shows a human
 * every cell that might hold something, and it used to answer with an ink
 * fraction: count dark pixels, offer the cell if there are enough. On a
 * 58-card event that offered 730 cells, 12.6 a card, and 450 of them held
 * nothing but the card's own printed ruling. Two thirds of what a person was
 * asked to look at needed no looking at.
 *
 * Ink FRACTION cannot do better, and the reason is worth stating plainly: a
 * hairline pencil "3" covers less of its box than a sliver of the printed rule
 * above it. Measured on that event, the marginal band the ruling lives in also
 * contains real numbers -- 2, 4, 15, 3 and a "52" were read out of it by eye.
 * There is no threshold on quantity that keeps the numbers and drops the rules,
 * because on quantity the rules win.
 *
 * So this asks about SHAPE and PLACE instead:
 *
 *   ink is what is darker than the paper NEXT TO IT, not darker than some
 *   number. Paper shades across a crop by as much as a faint stroke stands out
 *   from it, so a single cut per crop either loses the stroke or takes half the
 *   crop with it. A local maximum over a 9px window is what the paper would be
 *   if the stroke were not there, because a stroke is thin and the window is
 *   wide.
 *
 *   ruling is struck out by PROJECTION: a rule is a row of pixels dark nearly
 *   all the way across, a wall is a column dark nearly all the way down.
 *   Handwriting is neither. This matters more than it sounds -- the rule often
 *   lands in the middle of a crop rather than along its edge, and where the
 *   top rule meets a side wall the two arrive as one component 117 wide and 41
 *   tall, which passes any test based on the shape of a component.
 *
 *   what is left is handwriting if any piece of it stands a quarter of the
 *   height of the box, or if there is simply a lot of it. Both paths are
 *   needed: broken hairline pencil fragments into pieces too short for the
 *   first, and one deliberate tick is too little for the second.
 *
 * Two guards, each of which was a real failure on a real scan before it was
 * added, and neither of which is obvious from the description above:
 *
 *   A run of dark rows is ruling only if the RUN IS THIN. A card with a dense
 *   tally written into its TOTAL box runs dark across most rows of the crop; a
 *   version without this struck them all out one after another and reported an
 *   empty box on a cell holding 27% ink.
 *
 *   A run of dark columns is a wall only if it is thin AND NEAR A SIDE. A
 *   handwritten "1" is a narrow full-height stroke, which is precisely the
 *   column profile of the box's own border. What separates them is where they
 *   are: the border is the border, and a volunteer writes inside it.
 *
 * Measured against 730 cells of a 58-card event read by eye, and against every
 * value the chapter typed up for its matched spreadsheets: see HANDOFF.md.
 */

export interface MarkImage {
  width: number;
  height: number;
  /** One byte per pixel, 0 = black, 255 = paper. */
  data: Uint8Array;
}

export interface MarkOptions {
  /** Grey levels below the LOCAL paper level that count as ink. */
  depth: number;
  /** Radius the local paper level is taken over. Wider than any stroke. */
  window: number;
  /** A row this dark across its width is a candidate printed rule. */
  ruleFrac: number;
  /** ...but only where the run of such rows is no thicker than this, in pixels. */
  ruleThick: number;
  /** A column this dark down its height is a candidate printed wall. */
  wallFrac: number;
  wallThick: number;
  /** Walls are looked for only this far in from either side. */
  wallEdge: number;
  /** Radius the mask is closed by, to rejoin a broken pencil stroke. */
  close: number;
  /**
   * Floor on a component's size AFTER closing, so a lone speck is not a mark.
   * It does little on its own -- closing at radius 2 grows one pixel into
   * twenty-five -- and is not what keeps grit out. The height and mass bars are.
   */
  minPixels: number;
  /** A mark this tall, as a fraction of the crop, is handwriting. */
  tallFrac: number;
}

/**
 * Ceilings on the two bars, in pixels, because the rows are not all one size.
 *
 * A TOTAL box on this card is anywhere from 29 to 113 pixels tall -- the rows
 * with wrapped captions are twice the height of the rest. Handwriting is not:
 * at 200 DPI a written digit stands 25 to 45 pixels whatever row it is in. A
 * bar set purely as a fraction of the crop therefore asks four times as much of
 * a mark on a tall row as on a short one, and a real tick 24 pixels high was
 * lost that way on a 99-pixel row while the same tick would have passed easily
 * three rows further down.
 *
 * So the fraction sets the bar on small boxes and these cap it on large ones.
 */
const TALL_CEILING = 20;
const MASS_CEILING = 90;

export const MARK_DEFAULTS: MarkOptions = {
  depth: 22,
  window: 9,
  ruleFrac: 0.5,
  ruleThick: 6,
  wallFrac: 0.5,
  wallThick: 6,
  wallEdge: 0.25,
  close: 2,
  minPixels: 4,
  tallFrac: 0.25,
};

/**
 * Ink covering this share of a TOTAL box is handwriting even if no single piece
 * of it stands tall -- which is what badly broken hairline pencil looks like.
 */
const BOX_MASS_FRAC = 0.01;

/**
 * The tally strip is asked a different question, because it is a different
 * problem. It is five times wider than the TOTAL box, so it collects five
 * times as much of everything, and two kinds of ink land in it that are nobody's
 * data: the top of the printed caption belonging to the row below, and the feet
 * of the row above's tally strokes hanging down into it. Both sit hard against
 * an edge, so the strip is trimmed before it is read.
 *
 * What the reviewer needs from a strip is a run of strokes, a scribble, or the
 * number some volunteers write here instead of in the box. All of those are
 * either several marks spread along the row, or one mark with real substance.
 */
const STRIP = {
  /** Trimmed off the top and bottom, where a neighbouring row's ink lands. */
  insetFrac: 0.1,
  /** Marks needed to count as a run... */
  minRun: 2,
  /** ...and how far apart, in pixels, so a doubled stroke is not a tally. */
  minSpan: 25,
  /** A single mark this substantial is a scribble or a misplaced number. */
  soloMass: 250,
};

interface Mark {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Ink pixels in the mark's bounding box, before closing. */
  count: number;
  width: number;
  height: number;
}

/** Copy a rectangle out of a page, clamped to it. */
export function cropGray(
  img: MarkImage,
  rect: { x: number; y: number; width: number; height: number },
): MarkImage {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(img.width, Math.round(rect.x + rect.width));
  const y1 = Math.min(img.height, Math.round(rect.y + rect.height));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = (y0 + y) * img.width + x0;
    data.set(img.data.subarray(src, src + width), y * width);
  }
  return { width, height, data };
}

/** The paper level under a window of radius r: a separable maximum filter. */
function localPaper({ width, height, data }: MarkImage, r: number): Uint8Array {
  const pass = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      let m = 0;
      const lo = Math.max(0, x - r);
      const hi = Math.min(width - 1, x + r);
      for (let nx = lo; nx <= hi; nx++) if (data[off + nx]! > m) m = data[off + nx]!;
      pass[off + x] = m;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const lo = Math.max(0, y - r);
    const hi = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let ny = lo; ny <= hi; ny++) if (pass[ny * width + x]! > m) m = pass[ny * width + x]!;
      out[y * width + x] = m;
    }
  }
  return out;
}

/** Grow the mask by r in both directions, separably, to rejoin broken strokes. */
function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const pass = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - r);
      const hi = Math.min(width - 1, x + r);
      let v = 0;
      for (let nx = lo; nx <= hi && !v; nx++) v = mask[off + nx]!;
      pass[off + x] = v;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const lo = Math.max(0, y - r);
    const hi = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let ny = lo; ny <= hi && !v; ny++) v = pass[ny * width + x]!;
      out[y * width + x] = v;
    }
  }
  return out;
}

/**
 * Flag the runs of consecutive `true`s that are no longer than `maxRun` and
 * satisfy `within`. This is what makes a rule a rule rather than just darkness:
 * printed ruling is a few pixels thick, and sixteen consecutive dark rows are
 * somebody's handwriting.
 */
function thinRuns(
  flag: boolean[],
  maxRun: number,
  within: (from: number, to: number) => boolean = () => true,
): boolean[] {
  const strike = new Array<boolean>(flag.length).fill(false);
  let i = 0;
  while (i < flag.length) {
    if (!flag[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < flag.length && flag[j]) j++;
    if (j - i <= maxRun && within(i, j - 1)) for (let k = i; k < j; k++) strike[k] = true;
    i = j;
  }
  return strike;
}

/** 8-connected components of the mask, as bounding boxes with ink counts. */
function components(
  mask: Uint8Array,
  clean: Uint8Array,
  width: number,
  height: number,
  minPixels: number,
): Mark[] {
  const seen = new Uint8Array(mask.length);
  const out: Mark[] = [];
  const stack: number[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let size = 0;

    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p / width) | 0;
      size++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (size < minPixels) continue;

    // Count the ink itself, not the dilation that joined it up, so a closing
    // radius cannot inflate how substantial a mark looks.
    let count = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) if (clean[y * width + x]) count++;
    }
    out.push({ minX, maxX, minY, maxY, count, width: maxX - minX + 1, height: maxY - minY + 1 });
  }
  return out;
}

/**
 * The crop's ink, with the card's own printed ruling struck out.
 *
 * Split out of `findMarks` because counting a tally needs the pixels and not
 * just their bounding boxes: a "5" is four upright strokes and a diagonal drawn
 * THROUGH them, which is one connected component and tells you nothing.
 */
export function inkMask(
  img: MarkImage,
  options: Partial<MarkOptions> = {},
): { mask: Uint8Array; width: number; height: number } {
  const o = { ...MARK_DEFAULTS, ...options };
  const { width, height, data } = img;
  const paper = localPaper(img, o.window);

  const raw = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) raw[i] = paper[i]! - data[i]! >= o.depth ? 1 : 0;

  const rowDark = new Array<boolean>(height);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) n += raw[y * width + x]!;
    rowDark[y] = n >= width * o.ruleFrac;
  }
  const colDark = new Array<boolean>(width);
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = 0; y < height; y++) n += raw[y * width + x]!;
    colDark[x] = n >= height * o.wallFrac;
  }

  const edge = Math.max(2, Math.round(width * o.wallEdge));
  const strikeRow = thinRuns(rowDark, o.ruleThick);
  const strikeCol = thinRuns(colDark, o.wallThick, (from, to) => from < edge || to >= width - edge);

  const clean = Uint8Array.from(raw);
  for (let y = 0; y < height; y++) {
    if (strikeRow[y]) for (let x = 0; x < width; x++) clean[y * width + x] = 0;
  }
  for (let x = 0; x < width; x++) {
    if (strikeCol[x]) for (let y = 0; y < height; y++) clean[y * width + x] = 0;
  }

  return { mask: clean, width, height };
}

/** Everything in the crop that is not the card's own printed ruling. */
export function findMarks(img: MarkImage, options: Partial<MarkOptions> = {}): Mark[] {
  const o = { ...MARK_DEFAULTS, ...options };
  const { mask, width, height } = inkMask(img, o);
  return components(dilate(mask, width, height, o.close), mask, width, height, o.minPixels);
}

/** How tall a mark has to stand in this crop to be handwriting. */
function tallBar(height: number, tallFrac: number): number {
  return Math.min(TALL_CEILING, Math.max(6, Math.round(height * tallFrac)));
}

/** Is there handwriting in this TOTAL box? */
export function boxMarked(img: MarkImage, options: Partial<MarkOptions> = {}): boolean {
  const o = { ...MARK_DEFAULTS, ...options };
  const marks = findMarks(img, o);
  if (marks.some((m) => m.height >= tallBar(img.height, o.tallFrac))) return true;
  const mass = marks.reduce((sum, m) => sum + m.count, 0);
  return mass >= Math.min(MASS_CEILING, img.width * img.height * BOX_MASS_FRAC);
}

/** Trim the top and bottom of a strip, where a neighbouring row's ink lands. */
export function insetRows(img: MarkImage, frac = STRIP.insetFrac): MarkImage {
  const dy = Math.round(img.height * frac);
  const height = img.height - dy * 2;
  if (height < 8) return img;
  const data = img.data.subarray(dy * img.width, (dy + height) * img.width);
  return { width: img.width, height, data };
}

/** Is there something in this tally strip a person has to read? */
export function stripMarked(img: MarkImage, options: Partial<MarkOptions> = {}): boolean {
  const o = { ...MARK_DEFAULTS, ...options };
  const trimmed = insetRows(img, STRIP.insetFrac);
  const marks = findMarks(trimmed, o);
  const strokes = marks.filter((m) => m.height >= tallBar(trimmed.height, o.tallFrac));
  if (strokes.length >= STRIP.minRun) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of strokes) {
      if (s.minX < lo) lo = s.minX;
      if (s.maxX > hi) hi = s.maxX;
    }
    if (hi - lo >= STRIP.minSpan) return true;
  }
  return marks.some((m) => m.count >= STRIP.soloMass);
}
