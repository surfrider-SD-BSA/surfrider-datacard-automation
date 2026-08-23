/**
 * How many strokes are in this tally?
 *
 * This is most of the chapter's data. Across eleven scans, 1,217 of 1,611
 * values were tallied and never written as a number, so the TOTAL box is empty
 * and the only record of the count is a run of pencil strokes. Until now the
 * tool found those strips and handed them to a person to count.
 *
 * It is deliberately NOT a handwriting problem, and that is the whole reason to
 * expect it to work where digit recognition does not. A tally has no shape
 * ambiguity: it is a run of near-parallel strokes of similar length standing on
 * a similar baseline, in groups of five with the fifth struck across the other
 * four. Nothing has to be recognised. It has to be taken apart, and counted.
 *
 * ---------------------------------------------------------------------------
 * The design rests on one idea: EXPLAIN EVERY INK PIXEL, OR DECLINE.
 *
 * The failure that matters is not missing a tally -- that costs the keystroke
 * the human was making anyway. It is confidently returning 7 for a strip that
 * says 12, because a wrong number beside a picture invites agreement. So this
 * does not "find as many strokes as it can". It takes the strip apart into
 * straight segments, accounts for each one, and refuses to answer unless those
 * segments cover essentially all the ink that is there.
 *
 * That single rule is what throws out the things that would otherwise be read
 * as tallies, and every one of them is real on the test scan:
 *
 *   a strip holding "50", "15" or "6", because some volunteers write the number
 *   here rather than in the box. The two strokes of a "15" are nearly a tally
 *   of 2. What saves it is that the curve of the 5 is not a straight segment,
 *   so it is ink no arrangement of strokes can account for.
 *
 *   a strip holding the word SUCKS, written across a cleanup card by somebody
 *   having a bad morning, followed by two real strokes.
 *
 *   a cell scribbled out, which is a great deal of ink in roughly the right
 *   place and no strokes at all.
 *
 *   a dense tally that overran its row and was written in three overlapping
 *   layers. Those are genuinely ambiguous -- a person counting them counts
 *   slowly and sometimes twice -- and they are declined rather than guessed.
 * ---------------------------------------------------------------------------
 *
 * Why lines rather than connected components, which is the obvious thing and is
 * what the mark test uses: a crossed group of five is ONE component. The fifth
 * stroke is drawn through the other four, so the whole group -- and on many
 * cards, the whole tally -- arrives as a single blob whose bounding box says
 * nothing about how many strokes went into it.
 *
 * Why lines rather than a column projection, which is the next obvious thing:
 * the crossbar is not confined to the gaps between strokes. Measured on the
 * test scan it runs past both ends of its group and carries about half the ink
 * in the strip, so a projection sees a low ridge with spikes on it, and the
 * ridge is the majority of what has to be explained.
 *
 * So the strip is decomposed the way it was written: one pen stroke at a time,
 * longest first, each one removed before the next is looked for.
 */

import { inkMask, insetRows, type MarkImage, type MarkOptions } from "./marks";

export interface TallyReading {
  /** The count, or null when the strip is declined. */
  count: number | null;
  /** Why it was declined. Empty when it answered. */
  reason: string;
  /** Upright strokes found. */
  strokes: number;
  /** Crossbars found: the fifth stroke of a group of five. */
  bars: number;
  /** Sizes of the groups the strokes fell into, left to right. */
  groups: number[];
  /** Share of the strip's ink the reading accounts for, 0-1. */
  explained: number;
  /**
   * How much to trust the count, 0-1.
   *
   * Not one number for the whole counter, because precision is not one number.
   * A tally written as complete crossed fives CHECKS ITSELF: every group but
   * the last has to hold exactly five, so a stroke missed or a crossbar missed
   * breaks the arithmetic and the reading is declined rather than returned
   * short. A bare run of two or three uprights has no such check -- if a faint
   * third stroke was never found, two is a perfectly consistent answer to the
   * wrong question.
   *
   * Measured against the chapter's own datasheets, that difference is the
   * difference between a reading worth pre-filling and one worth leaving blank.
   */
  confidence: number;
}

/**
 * Named because two places depend on it: the decline itself, and `salvageCount`,
 * which refuses to guess from it. A typo in either would silently start putting
 * one row's tally against another row's item.
 */
const ROW_ESCAPE_REASON = "ink continues past the row";

const DECLINE = (reason: string, extra: Partial<TallyReading> = {}): TallyReading => ({
  count: null,
  reason,
  strokes: 0,
  bars: 0,
  groups: [],
  explained: 0,
  confidence: 0,
  ...extra,
});

/**
 * How far a reading can be trusted. Measured, not assumed.
 *
 * Every answer the counter gives was scored against the chapter's twenty-seven
 * matched datasheets and split by the shape of the answer. These are those
 * figures. They are LOWER bounds -- a value in a spreadsheet is not proof of
 * what is on the card, and reading the disagreements one at a time turns up
 * cases where the sheet is wrong and the counter is right -- but they are the
 * only figures measured at a scale where a precision claim means anything.
 *
 *     count 1, all ink accounted for      42   97.6%
 *     count 4, all ink accounted for      61   86.9%
 *     count 2, all ink accounted for     116   82.8%
 *     count 3, all ink accounted for     105   77.1%
 *     count 5-9, all ink accounted for    42   73.8%
 *     count 10+, all ink accounted for     7   85.7%
 *     anything with ink left over         48   50-86%
 *
 * The first version of this scored on whether the tally had crossbars, on the
 * theory that a group of five checks its own arithmetic: a missed stroke breaks
 * the count of five, so the reading is declined rather than returned short. The
 * theory is clean and the measurement says it is wrong -- crossed groups scored
 * WORST, 61.5% against 95.5% for a single stroke.
 *
 * The reason is worth keeping, because it points at the real failure. A crossbar
 * means the volunteer counted past five, and a tally past five is the one that
 * runs out of room. The disagreements read "said 5, sheet 19": the strip holds
 * the first group and the rest of the tally is somewhere else on the card. The
 * counter is not miscounting what it can see. It is counting all of what it can
 * see, and there is more.
 *
 * `touchesSide` catches a tally overrunning the LEFT or RIGHT of its crop.
 * Nothing here catches one that carries on onto the row below, which is the
 * open problem and where the next work should go.
 */
function confidenceOf(count: number, explained: number): number {
  if (explained < TRUST.explainedBar) return TRUST.inkLeftOver;
  if (count === 1) return TRUST.one;
  if (count <= 4) return TRUST.few;
  return TRUST.many;
}

const TRUST = {
  explainedBar: 0.95,
  one: 0.95,
  few: 0.8,
  many: 0.75,
  inkLeftOver: 0.6,
};
export interface TallyContext {
  /**
   * The strip's own columns, taken over a taller slice of the page.
   *
   * Same x origin and width as the strip, extended above and below it. Used
   * only to tell a printed rule from a stroke -- see `ruleCoverage`. Without
   * it the test falls back to the strip itself, which is weaker.
   */
  context?: MarkImage;
}

export interface TallyOptions {
  /**
   * Share of the strip's ink the segments must cover.
   *
   * The single most important number here, and what the precision rests on. A
   * tally of clean strokes and crossbars is straight lines and nothing else; a
   * strip with a number or a word in it is mostly not, because the bowls and
   * curves of handwriting are exactly what a straight segment cannot cover.
   */
  minExplained: number;
  /**
   * Half-width of the band that VOTES for a line, in pixels.
   *
   * Narrow, so that the peak is sharp and two strokes a pen-width apart do not
   * vote for each other.
   */
  band: number;
  /**
   * Half-width of the band a chosen line then CLAIMS, in pixels.
   *
   * Wider than the voting band, and they have to be different numbers. A thinned
   * stroke is one pixel wide but it is not straight -- the skeleton of a
   * hand-drawn line zigzags a pixel either side -- so a claim as narrow as the
   * vote leaves a dotted trail behind that is collinear, long, and gets found
   * again as a second stroke. Measured on the test scan that read a group of
   * five as six.
   */
  claim: number;
  /**
   * A break longer than this along a line ends the segment.
   *
   * Must stay well under the spacing between two strokes of a tally, or a line
   * hops from the top of one stroke to the top of the next and a whole group
   * comes out as one long diagonal.
   */
  maxGap: number;
  /**
   * The same, for the pass that looks for crossbars.
   *
   * Wider, and it has to be. The uprights are lifted out first, and each one
   * takes its claimed band with it, so by the time the bar is looked for it has
   * a hole through it everywhere it crossed a stroke -- four holes in a group of
   * five. At the upright pass's gap every piece between two holes is too short
   * to be a segment at all and the bar is never found, so the group counts four
   * instead of five.
   *
   * Safe here for the reason it is not safe there: the uprights are already
   * gone, so there is nothing left for a line to hop between.
   */
  barGap: number;
  /** Segments shorter than this are not pen strokes. */
  minLength: number;
  /** A segment within this many degrees of vertical is an upright stroke. */
  uprightDegrees: number;
  /**
   * How far apart, in degrees, the most and least slanted strokes may be.
   *
   * A tally is one hand making the same mark over and over, so its strokes are
   * near-parallel -- measured across these scans a hand varies by twenty-odd
   * degrees across one tally and no more. Handwriting does not: the humps of a lower-case "m" decompose into
   * perfectly good straight segments at wildly different angles, and one strip
   * on 1.18 Imperial Beach holding "|m." was read as a tally of four before this
   * was added.
   */
  maxAngleSpread: number;
  /** Strokes must fall within this factor of the typical stroke length. */
  lengthTolerance: number;
  /** Feet may sit this far off the common baseline, as a share of stroke length. */
  baselineTolerance: number;
  /** Gap, in pixels, across which two pieces of one stroke are put back together. */
  rejoinGap: number;
  /** ...how far off each other's line they may sit... */
  rejoinOffset: number;
  /** ...and how far apart in direction, in degrees. */
  rejoinAngle: number;
  /** Gaps this many times the typical stroke pitch start a new group. */
  groupGapRatio: number;
  /** Fewer strokes than this is not a tally worth a confident answer. */
  minStrokes: number;
  /**
   * Share of the strip's height trimmed off the top and bottom.
   *
   * Deeper than the trim the mark test uses. Deciding whether a strip holds a
   * tally at all survives a stray printed rule along the edge of the crop;
   * counting one does not. The row's own rule is not always struck -- it fades
   * across the page, so it can be dark over only a third of the strip's width,
   * under the bar for a rule -- and what is left of it is a long horizontal
   * segment hugging the top or bottom edge. That trips the clipped-tally test,
   * because it reaches the side, and goes unexplained, because it is nobody's
   * stroke.
   */
  rowInset: number;
  /** Pixels trimmed off each side of the strip, where a caption can bleed in. */
  insetRight: number;
  insetLeft: number;
  /**
   * Share of the strip's FULL height a column must be inked over to be a
   * printed rule rather than a pen stroke.
   *
   * Some card printings put the left border of the TOTAL box inside the tally
   * rectangle -- it lands at page x 728 on the Imperial Beach cards, twenty
   * pixels inside a rectangle that ends at 748, and the blank reference
   * composited from Pacific Beach cards has nothing there at all. Left in, it is
   * a dense, full-length, perfectly upright line: a flawless tally stroke by
   * every test in this file, added to every count on the scan.
   *
   * The mark test's own wall rule cannot be borrowed here. It strikes any thin
   * dark column near either EDGE of a crop, which is right for a TOTAL box --
   * the border is at the edge, a volunteer writes inside it -- and wrong for a
   * tally strip, where the first stroke is written hard against the left edge
   * and was being struck out as the wall.
   *
   * What separates them without reference to position: a printed rule appears in
   * the rows ABOVE AND BELOW this one as well, at the same column, and a pen
   * stroke exists only in its own row. That is why this is measured on
   * `context` -- the same columns over a taller slice of the page -- rather
   * than on the strip. On the strip alone it cannot be done: a volunteer who
   * writes one tall upright stroke produces a column indistinguishable from a
   * rule, and three real strokes were struck out that way on 1.18 Imperial
   * Beach before the context was passed in.
   *
   * Note it asks whether the column is inked ABOVE OR BELOW the row, not
   * whether it is inked continuously, and not both sides. An earlier version demanded a single unbroken run down
   * the whole context and let three borders through, because on some cards the
   * vertical rules are dotted and stop dead at each horizontal rule -- so a
   * perfectly ordinary printed border never spans anything. Reading all 44
   * pre-fills by eye is what turned that up; the borders it missed were counted
   * as strokes at the top confidence the tool issues. Requiring BOTH sides was
   * the next attempt and also failed -- the rule on that card runs above the row
   * and stops before the one below -- so either side alone is taken as proof
   * that the mark is not confined to this row, which is all that is being asked.
   */
  ruleCoverage: number;
  /** ...and how many columns wide such a rule may be. */
  ruleWidth: number;
  /** Share of the context, top and bottom, that belongs to the other rows. */
  ruleMargin: number;
  /**
   * Share of the strip's WIDTH inked that makes a row of the margin evidence
   * about nothing.
   *
   * A section banner is a solid black bar across the whole card, and roughly
   * one row in eight on this card sits directly under one. Where a banner falls
   * in the margin every column is inked there, so every column reads as "this
   * mark carries on above the row" -- and since that is then one run wider than
   * `ruleWidth`, the test decides the whole strip is not a rule and strikes
   * NOTHING. The printed border survives, is dense and full height and
   * perfectly upright, and is counted as a tally stroke. Three of the six wrong
   * pre-fills in the audit of 2026-08-13 are this, and nothing else: 3.15 and
   * 7.05 Seaport card 18, 6.21 Imperial card 14.
   *
   * A row inked all the way across cannot distinguish one column from another,
   * so it is dropped from both sides of the measurement rather than counted as
   * evidence for every column at once. This takes the row's own printed
   * horizontal rules with it, which is a gain and not a cost: those were being
   * left in deliberately, because STRIKING their pixels punched a hole through
   * the vertical rule they cross and dropped it below the coverage bar.
   * Dropping the row from the denominator does not.
   */
  ruleCrowd: number;
  /**
   * How much of a margin must survive that filter for it to be evidence at all.
   *
   * Where a banner fills the margin almost entirely, two or three usable rows
   * are left and a column inked in both of them would clear any coverage bar.
   * Below this the margin is treated as carrying no evidence, and the other side
   * decides alone -- which is what happens on all three of the cells above, and
   * it is enough, because a printed border runs through both.
   */
  ruleEvidence: number;
  /** Columns blanked either side of one, to take its anti-aliased fringe too. */
  ruleFringe: number;
  /** Ink pixels against a side before the tally counts as running off it. */
  edgeInk: number;
  /**
   * How far ink may carry on past the strip, along a stroke's own line, before
   * the mark is judged to belong to a NEIGHBOURING ROW -- as a share of the
   * strip's height.
   *
   * `touchesSide` catches a tally that overruns the left or right of its crop.
   * Nothing caught the other axis, and the pre-fill audit of 2026-08-13 found
   * two of its three remaining wrong pre-fills there:
   *
   *   pacific-6.30    3:108   said 1, is 0   one long diagonal, running from
   *                                          well above the row to well below it
   *   moonlight-7.19  7:42    said 2, is 0   the descenders of "Paper", written
   *                                          by the volunteer in the row ABOVE
   *
   * Both are the worst thing this tool can do: a number in a box whose own row
   * holds no tally at all. Neither is visible from the strip. Cropped to the
   * row, a diagonal crossing three rows is an ordinary slanted stroke of exactly
   * band height, and a descender is an ordinary short one.
   *
   * This is deliberately a test on the STROKE'S LINE and not on its column.
   * `verticalRules` already asks the column question -- is this column inked
   * above or below -- and it cannot see a diagonal, which leaves its column
   * within a few pixels after two rows. Walking the line the segment was found
   * at can.
   *
   * **Only ink arriving from ABOVE counts, and the direction is the finding.**
   * Measured both ways over all 46 cells of the audit, the two populations do
   * not separate at all on total overrun: the marks that belong to another row
   * reach 0.60, and so do four cells the counter reads correctly. Split by
   * direction they very nearly do, and the reason is that a volunteer writes
   * downward -- a tally stroke that runs out of room runs out BELOW its row,
   * while a descender or a slash from the row above arrives from the top:
   *
   *     cell                      up    down   read
   *     oceanbeach-8.02 3:109   0.02    0.59   right -- three strokes, all
   *                                                    hanging below their row
   *     moonlight-7.05 24:42    0.00    0.55   right
   *     pacific-9.27   14:26    0.00    0.54   right, in this respect
   *     moonlight-7.19  7:42    0.35    0.00   WRONG: descenders of "Paper"
   *     pacific-6.30    3:108   0.60    0.60   WRONG: a diagonal crossing rows
   *
   * Refusing on the downward figure would throw away most of what the counter
   * gets right. Refusing on the upward one costs two correct cells of
   * forty-six and removes both readings that put a number into a box whose own
   * row holds no tally at all -- the worst thing this tool can do, and the
   * failure pre-filling was switched off for.
   *
   * **The bar is thin and it is tuned on 46 cells: re-sweep it when there are
   * more.** The nearest correct cell sits at 0.28 and the nearer of the two
   * targets at 0.35, which is about one cell of margin. The two correct cells
   * it discards (`seaport-6.13 5:40` at 0.61, `moonlight-7.05 24:18` at 0.50)
   * are rows whose neighbour above holds its own tally, touching this one --
   * the same overlap that costs `verticalRules` coverage, and the reason this
   * cannot be pushed lower.
   */
  rowEscape: number;
  /** Columns either side of the extrapolated line that count as the same mark. */
  escapeSlack: number;
  /** Rows of white the trail may skip before it is a different mark. */
  escapeGap: number;
  /**
   * Ink a segment must carry per pixel of its length.
   *
   * A thinned pen stroke is a solid line, so it runs about 1.0. The fringe of a
   * printed rule, or a row of specks that happen to line up, is dotted and runs
   * near half that. This is the second guard against both, and unlike the trim
   * it works wherever on the strip they turn up.
   */
  minDensity: number;
  /**
   * The same, for crossbars, and necessarily lower.
   *
   * A bar is measured after the uprights have been lifted out, so it is missing
   * a few pixels everywhere it crossed one -- about a quarter of its length in a
   * group of five. Held to the uprights' figure it reads as a dotted line and is
   * thrown away, and the group counts four.
   */
  barDensity: number;
  /**
   * Above this much ink the strip is a dense overwritten mess.
   *
   * Not a limit on how large a count may be. It is that past roughly this much
   * a volunteer has run out of row and started writing over what they already
   * wrote, and the strokes stop being separable at all -- by this, or by a
   * person. Declining early also keeps the decomposition's cost bounded.
   */
  maxInk: number;
}

export const TALLY_DEFAULTS: TallyOptions = {
  minExplained: 0.9,
  band: 1.6,
  claim: 3.2,
  maxGap: 8,
  barGap: 16,
  minLength: 11,
  uprightDegrees: 36,
  maxAngleSpread: 30,
  lengthTolerance: 1.9,
  baselineTolerance: 0.85,
  rejoinGap: 14,
  rejoinOffset: 4.5,
  rejoinAngle: 14,
  groupGapRatio: 1.85,
  minStrokes: 1,
  rowInset: 0.17,
  insetRight: 3,
  insetLeft: 3,
  ruleCoverage: 0.55,
  ruleMargin: 0.2,
  ruleCrowd: 0.3,
  ruleEvidence: 0.5,
  ruleWidth: 6,
  ruleFringe: 2,
  edgeInk: 6,
  rowEscape: 0.35,
  escapeSlack: 1,
  escapeGap: 1,
  minDensity: 0.62,
  barDensity: 0.4,
  maxInk: 6000,
};

/** Angles the decomposition tries, in degrees. Finer than this buys nothing. */
const ANGLE_STEP = 4;

/**
 * Thin the ink to lines one pixel wide (Zhang-Suen).
 *
 * The decomposition below claims a band of pixels either side of the line it
 * finds, and without thinning that band has to be as wide as a pen stroke --
 * which is not a fixed width, because a volunteer with a soft pencil lays down
 * three times the ink of one with a biro. Set the band too narrow and every
 * stroke leaves a sliver behind that is itself long enough to look like another
 * stroke; measured on the test scan a two-stroke tally came apart into nine.
 * Set it wide enough for the softest pencil and it swallows the neighbouring
 * stroke.
 *
 * Thinning removes the choice. Every stroke becomes one pixel wide whatever it
 * was written with, so one narrow band takes all of it and nothing is left over
 * -- and how hard somebody pressed stops being part of the measurement.
 */
function thin(src: Uint8Array, width: number, height: number): Uint8Array {
  const mask = Uint8Array.from(src);
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]!;

  for (let round = 0; round < 40; round++) {
    let removed = 0;
    for (const step of [0, 1]) {
      const doomed: number[] = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!mask[y * width + x]) continue;
          // p2..p9 clockwise from north.
          const p = [
            at(x, y - 1),
            at(x + 1, y - 1),
            at(x + 1, y),
            at(x + 1, y + 1),
            at(x, y + 1),
            at(x - 1, y + 1),
            at(x - 1, y),
            at(x - 1, y - 1),
          ];
          const b = p.reduce((a, v) => a + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
          if (a !== 1) continue;
          // The two conditions that keep the line connected; they alternate so
          // that thinning does not eat the line from one side only.
          if (step === 0) {
            if (p[0]! && p[2]! && p[4]!) continue;
            if (p[2]! && p[4]! && p[6]!) continue;
          } else {
            if (p[0]! && p[2]! && p[6]!) continue;
            if (p[0]! && p[4]! && p[6]!) continue;
          }
          doomed.push(y * width + x);
        }
      }
      for (const i of doomed) mask[i] = 0;
      removed += doomed.length;
    }
    if (removed === 0) break;
  }
  return mask;
}

interface Segment {
  /** Direction, in degrees from the x axis. */
  angle: number;
  length: number;
  /** Ink pixels claimed. */
  ink: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  midX: number;
}

/**
 * Take the strip apart into straight segments, longest first.
 *
 * A Hough vote over line angle and offset, but the peak is not taken as the
 * answer on its own: the pixels near the winning line are ordered ALONG it and
 * the longest unbroken run is what becomes the segment. Without that, a line
 * that happens to graze three strokes and two specks scores as one long stroke.
 *
 * Each segment's pixels are removed before the next is looked for, so a crossbar
 * and the strokes it crosses are found separately rather than competing.
 */
function decompose(
  o: TallyOptions,
  /**
   * Which angles this pass may look at, in degrees from the x axis.
   *
   * The uprights are extracted before anything else, and this is what makes
   * that possible. It matters because a segment takes its whole claimed band
   * away with it: run one pass over all angles and the crossbar, being the
   * longest thing in the strip, is found first and cuts a ten-pixel hole
   * through every upright it crosses. Each of those then arrives as a long
   * piece and a short one, and a group of five reads as three.
   *
   * Widening the gap a run may bridge does not fix it -- the gap would have to
   * be wider than the spacing between two strokes, at which point a line hops
   * from the top of one stroke to the top of the next and the whole group comes
   * out as a single diagonal. Strokes do not cross each other, so taking them
   * out first costs nothing and leaves the bars to a second pass over what is
   * left.
   */
  allow: (deg: number) => boolean,
  alive: Uint8Array,
  xs: number[],
  ys: number[],
): Segment[] {
  const n = xs.length;

  const angles: number[] = [];
  for (let a = 0; a < 180; a += ANGLE_STEP) angles.push(a);
  const half = Math.ceil(o.band);

  /**
   * Per angle: the pixels in order along the line, their offset across it, and
   * where each band starts in that order.
   *
   * Sorting is done ONCE per angle here rather than once per candidate band
   * inside the search. Bands are built by walking the pixels in along-the-line
   * order, so every band comes out already ordered and the inner loop never
   * sorts at all -- which is the difference between this costing a millisecond
   * a strip and costing two hundred.
   */
  const perAngle = angles.map((deg) => {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    const u = new Float32Array(n);
    const band = new Int32Array(n);
    let lo = Infinity;
    for (let i = 0; i < n; i++) {
      u[i] = xs[i]! * c + ys[i]! * s;
      const t = Math.round(-xs[i]! * s + ys[i]! * c);
      band[i] = t;
      if (t < lo) lo = t;
    }
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      band[i] = band[i]! - lo;
      if (band[i]! > hi) hi = band[i]!;
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => u[i]! - u[j]!);
    return { u, band, bands: hi + 1, order };
  });

  const segments: Segment[] = [];

  // One segment per pass. The cap is a guard against a pathological strip, not
  // a limit on the count: a tally needing more than this many pen strokes is
  // one of the overwritten ones, which are declined anyway.
  for (let pass = 0; pass < 80; pass++) {
    let best: {
      angleIndex: number;
      centre: number;
      from: number;
      to: number;
      length: number;
      angle: number;
    } | null = null;

    for (let a = 0; a < angles.length; a++) {
      if (!allow(angles[a]! > 90 ? angles[a]! - 180 : angles[a]!)) continue;
      const { u, band, bands, order } = perAngle[a]!;

      // Each pixel joins every band its own band is within `half` of, so a line
      // claims the full width of a pen stroke rather than one row of it.
      const buckets: number[][] = Array.from({ length: bands + 2 * half }, () => []);
      for (const i of order) {
        if (!alive[i]) continue;
        const b = band[i]!;
        for (let d = -half; d <= half; d++) buckets[b + d + half]!.push(i);
      }

      for (let bucket = 0; bucket < buckets.length; bucket++) {
        const members = buckets[bucket]!;
        if (members.length < 4) continue;

        // The longest unbroken run along the line, not the whole band: a line
        // that grazes three strokes and two specks is not one long stroke.
        let runFrom = 0;
        let bestFrom = 0;
        let bestTo = 0;
        for (let k = 1; k <= members.length; k++) {
          const broken = k === members.length || u[members[k]!]! - u[members[k - 1]!]! > o.maxGap;
          if (!broken) continue;
          const span = u[members[k - 1]!]! - u[members[runFrom]!]!;
          if (span > u[members[bestTo]!]! - u[members[bestFrom]!]!) {
            bestFrom = runFrom;
            bestTo = k - 1;
          }
          runFrom = k;
        }
        const length = u[members[bestTo]!]! - u[members[bestFrom]!]!;
        if (length < o.minLength) continue;
        if (!best || length > best.length) {
          best = {
            angleIndex: a,
            centre: bucket - half,
            from: u[members[bestFrom]!]!,
            to: u[members[bestTo]!]!,
            length,
            angle: angles[a]!,
          };
        }
      }
    }

    if (!best) break;

    // Take every pixel lying along the chosen line, not merely the ones that
    // voted for it -- see `claim` above.
    const { u, band } = perAngle[best.angleIndex]!;
    const members: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!alive[i]) continue;
      if (Math.abs(band[i]! - best.centre) > o.claim) continue;
      if (u[i]! < best.from - 1 || u[i]! > best.to + 1) continue;
      members.push(i);
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let live = 0;
    for (const i of members) {
      if (!alive[i]) continue;
      alive[i] = 0;
      live++;
      sumX += xs[i]!;
      if (xs[i]! < minX) minX = xs[i]!;
      if (xs[i]! > maxX) maxX = xs[i]!;
      if (ys[i]! < minY) minY = ys[i]!;
      if (ys[i]! > maxY) maxY = ys[i]!;
    }
    if (live === 0) break;

    // Report the angle as an acute inclination from the x axis, so "upright"
    // is a test on one number.
    segments.push({
      angle: best.angle > 90 ? best.angle - 180 : best.angle,
      length: best.length,
      ink: live,
      minX,
      maxX,
      minY,
      maxY,
      midX: sumX / live,
    });
  }

  return segments;
}

/** Ink pixel coordinates of a mask, as parallel arrays. */
function inkPixels(mask: Uint8Array, width: number, height: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (mask[y * width + x]) (xs.push(x), ys.push(y));
  }
  return { xs, ys, alive: new Uint8Array(xs.length).fill(1) };
}

const isUpright = (deg: number, within: number) => Math.abs(Math.abs(deg) - 90) <= within;

/**
 * Take a strip apart: the upright strokes first, then the crossbars through
 * whatever ink is left. See `allow` above for why the order is not optional.
 */
function decomposeStrip(mask: Uint8Array, width: number, height: number, o: TallyOptions) {
  const { xs, ys, alive } = inkPixels(mask, width, height);
  const upright = decompose(o, (d) => isUpright(d, o.uprightDegrees), alive, xs, ys);
  const rest = decompose(
    { ...o, maxGap: o.barGap },
    (d) => !isUpright(d, o.uprightDegrees),
    alive,
    xs,
    ys,
  );
  return { upright, rest };
}

/**
 * Columns of a strip that hold a printed rule: see `ruleCoverage`.
 *
 * Measured on the WHOLE crop, before any trimming, because running the entire
 * height of the crop is the whole signal.
 */
function verticalRules(
  mask: Uint8Array,
  width: number,
  height: number,
  o: TallyOptions,
): Set<number> {
  // The row's own band sits in the middle of the context; what is above and
  // below it belongs to the neighbouring rows.
  const margin = Math.round(height * o.ruleMargin);

  // A row inked most of the way across is a section banner or a printed
  // horizontal rule, and says the same thing about every column. See
  // `ruleCrowd`: left in, one banner in the margin makes the whole strip read
  // as a single rule too wide to be one, and the real border goes unstruck.
  const crowded: boolean[] = [];
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) n += mask[y * width + x]!;
    crowded.push(n >= width * o.ruleCrowd);
  }

  const inked = (x: number, from: number, to: number) => {
    let n = 0;
    let rows = 0;
    for (let y = from; y < to; y++) {
      if (crowded[y]) continue;
      rows++;
      n += mask[y * width + x]!;
    }
    if (rows < Math.max(4, (to - from) * o.ruleEvidence)) return false;
    return n >= rows * o.ruleCoverage;
  };

  const full: boolean[] = [];
  for (let x = 0; x < width; x++) {
    full.push(inked(x, 0, margin) || inked(x, height - margin, height));
  }

  const out = new Set<number>();
  let x = 0;
  while (x < width) {
    if (!full[x]) {
      x++;
      continue;
    }
    let j = x;
    while (j < width && full[j]) j++;
    if (j - x <= o.ruleWidth) {
      for (let k = x - o.ruleFringe; k < j + o.ruleFringe; k++) out.add(k);
    }
    x = j;
  }
  return out;
}

/**
 * Where the strip sits inside its context, and where the counted band sits
 * inside the strip.
 *
 * Three coordinate systems meet here and getting them wrong is silent: the mask
 * that is decomposed has been trimmed on all four sides, and the context it is
 * checked against has not. `insetRows` and `insetColumns` both decline to trim
 * when what is left would be too small, so the offsets are derived by comparing
 * the sizes rather than assumed from the options.
 */
interface Frame {
  /** x in the context of the mask's column 0. */
  left: number;
  /** y in the context of the mask's row 0. */
  top: number;
  /** y in the context of the strip's own top and bottom edges. */
  stripTop: number;
  stripBottom: number;
}

/**
 * How far does this stroke's ink carry on ABOVE the row it was found in?
 *
 * A pen stroke belonging to this row starts at it; a diagonal crossing the
 * card, or the descender of a word written in the row above, comes down into
 * it from somewhere else. The downward direction is deliberately not asked --
 * see `rowEscape` for the measurement that settles why.
 *
 * **The ink is TRACED, not extrapolated, and that is the whole of it.** The
 * obvious implementation follows the segment's own line out of the strip, and
 * it measures nothing: a segment's angle is fitted to the straightest part of a
 * mark, and handwriting curves. On `moonlight-7.19 7:42` the descender of a "P"
 * reads as 2 degrees off vertical over the piece inside the row and leans about
 * ten over its whole length, so a straight line drawn from it is six pixels
 * wide of the ink twenty rows up and finds nothing at all. Following the ink
 * row by row, taking the nearest hit within a couple of columns of where the
 * last row put it, tracks the curve.
 *
 * The trace starts at the stroke's own end and has to reach the strip's edge
 * unbroken before anything is counted. That matters as much as the tracing: the
 * ink between the stroke and the edge was trimmed off by `rowInset` and is
 * still this row's own, and requiring the mark to actually CROSS the boundary
 * is what stops the trace hopping onto a neighbouring row's tally, which sits
 * at similar columns and is the coverage this project has already lost once to
 * a cruder version of this idea.
 */
function rowOverrun(
  s: Segment,
  whole: { mask: Uint8Array; width: number; height: number },
  frame: Frame,
  o: TallyOptions,
): number {
  const rad = (s.angle * Math.PI) / 180;
  const sin = Math.sin(rad);
  // A segment this shallow is a crossbar, and only uprights are asked.
  if (Math.abs(sin) < 1e-3) return 0;
  const slope = Math.cos(rad) / sin;
  const cy = (s.minY + s.maxY) / 2 + frame.top;

  const trace = () => {
    const step = -1;
    const edge = frame.stripTop;
    let y = s.minY + frame.top;
    let x = Math.round(s.midX + frame.left + (y - cy) * slope);
    let run = 0;
    let missed = 0;

    for (;;) {
      y += step;
      if (y < 0 || y >= whole.height) break;

      let found = -1;
      for (let d = 0; d <= o.escapeSlack && found < 0; d++) {
        for (const px of d === 0 ? [x] : [x - d, x + d]) {
          if (px >= 0 && px < whole.width && whole.mask[y * whole.width + px]) {
            found = px;
            break;
          }
        }
      }

      if (found >= 0) {
        x = found;
        missed = 0;
        if (y < edge) run++;
      } else if (++missed > o.escapeGap) {
        // Broken. If that happened before the edge, `run` is still zero, which
        // is the answer: the mark never left the row.
        break;
      }
    }
    return run;
  };

  return trace();
}

/**
 * Is there ink against the left or right edge of the strip?
 *
 * A volunteer who runs out of tally space writes over the printed caption, and
 * the part outside the rectangle is not there to be counted. Nothing else here
 * can notice: a clipped tally is a perfectly ordinary-looking short one.
 */
function touchesSide(
  whole: { mask: Uint8Array; width: number; height: number },
  rules: Set<number>,
  o: TallyOptions,
): boolean {
  const { mask, width, height } = whole;
  const edge = Math.max(2, o.insetLeft, o.insetRight);
  let left = 0;
  let right = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < edge; x++) {
      if (mask[y * width + x] && !rules.has(x)) left++;
      const r = width - 1 - x;
      if (mask[y * width + r] && !rules.has(r)) right++;
    }
  }
  // A few pixels are grit or the corner of a rule; a stroke hanging over the
  // edge leaves a column of them.
  return left >= o.edgeInk || right >= o.edgeInk;
}

/** Trim the sides of a strip, where the printed rules sit. */
function insetColumns(img: MarkImage, left: number, right: number): MarkImage {
  const width = img.width - left - right;
  if (width < 16) return img;
  const data = new Uint8Array(width * img.height);
  for (let y = 0; y < img.height; y++) {
    data.set(img.data.subarray(y * img.width + left, y * img.width + left + width), y * width);
  }
  return { width, height: img.height, data };
}

/**
 * Put back together a pen stroke that came out in two pieces.
 *
 * Two things break a stroke into pieces and both are ordinary. A pencil drawn
 * fast lifts off the paper in the middle. And a segment takes its whole claimed
 * band away with it, so wherever two strokes cross, whichever is found second
 * has a hole through it.
 *
 * Merged only when the pieces are COLLINEAR and end to end: same direction,
 * sitting on the same line, with a short gap between one's end and the other's
 * start. Two strokes of a tally fail every part of that -- they are side by
 * side, which is a large perpendicular offset, not a gap along the line.
 *
 * Applied to the crossbars as well as the uprights, and it has to be. A bar cut
 * in two by the strokes it crosses arrives as two bars, and a group of five
 * then counts as six.
 */
function rejoin(segments: Segment[], o: TallyOptions): Segment[] {
  const out = [...segments].sort((a, b) => b.length - a.length);

  const dir = (s: Segment) => {
    const rad = (s.angle * Math.PI) / 180;
    return { cx: (s.minX + s.maxX) / 2, cy: (s.minY + s.maxY) / 2, dx: Math.cos(rad), dy: Math.sin(rad) };
  };

  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]!;
      const b = out[j]!;

      let turn = Math.abs(a.angle - b.angle) % 180;
      if (turn > 90) turn = 180 - turn;
      if (turn > o.rejoinAngle) continue;

      const A = dir(a);
      const B = dir(b);
      const vx = B.cx - A.cx;
      const vy = B.cy - A.cy;
      const along = Math.abs(vx * A.dx + vy * A.dy);
      const across = Math.abs(-vx * A.dy + vy * A.dx);
      if (across > o.rejoinOffset) continue;
      if (along - (a.length + b.length) / 2 > o.rejoinGap) continue;

      out[i] = {
        angle: a.angle,
        length: Math.max(a.length, along + (a.length + b.length) / 2),
        ink: a.ink + b.ink,
        minX: Math.min(a.minX, b.minX),
        maxX: Math.max(a.maxX, b.maxX),
        minY: Math.min(a.minY, b.minY),
        maxY: Math.max(a.maxY, b.maxY),
        midX: (a.midX * a.ink + b.midX * b.ink) / (a.ink + b.ink),
      };
      out.splice(j, 1);
      j = i;
    }
  }
  return out;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};

/**
 * Split strokes into groups on the gaps between them.
 *
 * Within a group of five the strokes sit a pen-width apart; between groups a
 * volunteer leaves a visible space. The MEDIAN gap is the unit rather than any
 * absolute distance, which is what lets one rule work across hands and across
 * rows that differ in height by a factor of four on this card.
 */
function groupStrokes(centres: number[], gapRatio: number): number[][] {
  if (centres.length === 0) return [];
  if (centres.length === 1) return [[0]];
  const gaps: number[] = [];
  for (let i = 1; i < centres.length; i++) gaps.push(centres[i]! - centres[i - 1]!);
  const unit = median(gaps);

  const groups: number[][] = [[0]];
  for (let i = 1; i < centres.length; i++) {
    if (centres[i]! - centres[i - 1]! > unit * gapRatio) groups.push([]);
    groups[groups.length - 1]!.push(i);
  }
  return groups;
}

/**
 * Crop, trim and threshold a strip, ready to be taken apart.
 *
 * Shared with `_debugSegments` below rather than repeated there. An earlier
 * version had the diagnostic doing its own slightly different preprocessing,
 * which is how a session gets spent reading a picture of the wrong pixels.
 */
function prepare(img: MarkImage, options: Partial<TallyOptions & MarkOptions> & TallyContext) {
  const o = { ...TALLY_DEFAULTS, ...options };

  // Printed rules are found on the untrimmed crop and struck from the trimmed
  // one, so that the evidence for "this is a rule" is the full height of the
  // strip while the ink that gets counted is only the row's own.
  // Horizontal rules are deliberately NOT struck for this measurement. The row's
  // own printed rule crosses the vertical one, and striking it punches a hole
  // through the vertical line's column that drops its coverage below the bar --
  // so the border survives and is counted as a stroke. Leaving both in costs
  // nothing, because a couple of extra rows cannot lift handwriting to full
  // height.
  const whole = inkMask(options.context ?? img, { wallFrac: 2, ruleFrac: 2, ...options });
  const rules = verticalRules(whole.mask, whole.width, whole.height, o);

  // Does the tally run out of the crop? Asked on the untrimmed strip, because
  // asking it after trimming cannot work: the trim removes the very stroke that
  // was hanging over the edge, and what is left looks like a shorter tally that
  // happens to sit near the side.
  //
  // Asked on the row's own band, and on its own mask. Two mistakes are easy
  // here and both were made: `whole` deliberately leaves the row's horizontal
  // rules in, and those run the full width and touch both edges, so every strip
  // in the scan reads as clipped; and the untrimmed crop reaches into the rows
  // above and below, whose tallies commonly start at the far left, which is the
  // very thing `insetRows` exists to keep out.
  const band = insetRows(img, o.rowInset);
  const clipped = touchesSide(inkMask(band, { wallFrac: 2, ...options }), rules, o);

  const trimmed = insetColumns(band, o.insetLeft, o.insetRight);

  // The wall test is switched off for a tally strip, and this is the one place
  // in the project where that is right.
  //
  // Switched off with `wallFrac: 2` -- a column would have to be more than
  // fully inked to qualify -- and NOT with `wallEdge: 0`, which is the obvious
  // way to write it and does not work: `marks.ts` floors the edge at two
  // columns, so a stroke landing within two pixels of the side after trimming
  // was still struck out, and it took up to six columns with it. That is how a
  // tally of two came to be pre-filled into a reviewer's box as a one. It exists because a handwritten "1" in
  // a TOTAL box has the column profile of the box's own border, and what
  // separates them is that the border is at the edge and a volunteer writes
  // inside it. A tally strip is the opposite: it has no border inside the crop,
  // and the first stroke of a tally is written hard against the left edge.
  // Leaving the test on struck those strokes out -- three of them on one card
  // of 1.18 Imperial Beach, turning a tally of three into a tally of two.
  const { mask, width, height } = inkMask(trimmed, { wallFrac: 2, ...options });
  for (const x of rules) {
    const tx = x - o.insetLeft;
    if (tx >= 0 && tx < width) for (let y = 0; y < height; y++) mask[y * width + tx] = 0;
  }

  let raw = 0;
  for (const v of mask) raw += v;

  // Where the counted band sits inside the context, for `escapesRow`. Derived
  // from the sizes rather than from the options, because both insets decline to
  // trim when what would be left is too small.
  const margin = Math.round((whole.height - img.height) / 2);
  const rowTrim = Math.round((img.height - band.height) / 2);
  const frame: Frame = {
    left: trimmed.width === band.width ? 0 : o.insetLeft,
    top: margin + rowTrim,
    stripTop: margin,
    stripBottom: margin + img.height,
  };

  return { o, mask, width, height, raw, clipped, whole, frame };
}

/**
 * Count the strokes in a tally strip, or decline to.
 *
 * Returns `count: null` far more often than not, and that is the intended
 * behaviour rather than a shortfall -- see the head of this file.
 */
export function countTally(
  img: MarkImage,
  options: Partial<TallyOptions & MarkOptions> & TallyContext = {},
): TallyReading {
  const { o, mask, width, height, raw, clipped, whole, frame } = prepare(img, options);
  if (raw === 0) return DECLINE("no ink");
  if (raw > o.maxInk) return DECLINE("too dense");
  if (clipped) return DECLINE("runs off the strip");

  // Everything from here on is measured on the thinned ink, including the share
  // that has to be explained: on a skeleton that share is a statement about
  // shape alone, where on the raw mask it would partly be a statement about how
  // hard the volunteer pressed.
  const skeleton = thin(mask, width, height);
  let ink = 0;
  for (const v of skeleton) ink += v;
  if (ink === 0) return DECLINE("no ink");

  const found = decomposeStrip(skeleton, width, height, o);

  // A dotted line is not a pen stroke, whatever direction it runs in.
  const solid = (ss: Segment[]) => ss.filter((s) => s.ink >= s.length * o.minDensity);
  const upright = rejoin(solid(found.upright), o);
  const others = rejoin(
    found.rest.filter((s) => s.ink >= s.length * o.barDensity),
    o,
  );
  if (upright.length === 0) return DECLINE("no strokes");

  // Strokes are one hand writing the same mark over and over, so they are the
  // same length. Anything much shorter is a speck, or the tail left behind when
  // a stroke that crossed another was lifted out.
  //
  // Those short pieces are not declined on and not counted: their ink simply
  // goes unexplained, which is the honest treatment. A couple of fragments
  // around real strokes still leaves the account nearly complete; a strip
  // that is ALL fragments -- which is what a scribble decomposes into -- does
  // not, and fails the explained test below on its own.
  const typical = median(upright.map((s) => s.length));
  const strokes = upright.filter(
    (s) => s.length >= typical / o.lengthTolerance && s.length <= typical * o.lengthTolerance,
  );
  if (strokes.length < o.minStrokes) return DECLINE("no strokes");

  // Only ink belonging to a stroke or to a crossbar is accounted for.
  const explainedInk = (bars: Segment[]) =>
    (strokes.reduce((a, s) => a + s.ink, 0) + bars.reduce((a, s) => a + s.ink, 0)) / ink;
  const state = (bars: Segment[] = []): Partial<TallyReading> => ({
    strokes: strokes.length,
    bars: bars.length,
    explained: explainedInk(bars),
  });

  // Does any of this belong to a neighbouring row?
  //
  // Declined whole rather than counted short. One escaping stroke says the crop
  // is not showing this row's tally in the first place -- a diagonal crossing
  // the card, a word written above -- and what is left after dropping it is not
  // a smaller tally, it is the remains of something else. See `rowEscape`.
  const escape = Math.round((frame.stripBottom - frame.stripTop) * o.rowEscape);
  if (escape > 0 && strokes.some((s) => rowOverrun(s, whole, frame, o) >= escape)) {
    return DECLINE(ROW_ESCAPE_REASON, state());
  }

  // Near-parallel, or it is not a tally. Tilt is measured from vertical so that
  // a stroke leaning one way and one leaning the other are two degrees apart
  // rather than a hundred and seventy-six.
  const tilts = strokes.map((s) => (s.angle > 0 ? s.angle - 90 : s.angle + 90));
  if (Math.max(...tilts) - Math.min(...tilts) > o.maxAngleSpread) {
    return DECLINE("strokes not parallel", state());
  }

  // Strokes stand on the row's line. Feet at unrelated heights are two tallies
  // written over each other, which is the case that cannot be counted.
  const feet = strokes.map((s) => s.maxY);
  const spread = Math.max(...feet) - Math.min(...feet);
  if (spread > typical * o.baselineTolerance) {
    return DECLINE("no common baseline", state());
  }

  strokes.sort((a, b) => a.midX - b.midX);
  const groups = groupStrokes(
    strokes.map((s) => s.midX),
    o.groupGapRatio,
  );

  // A crossbar is the fifth stroke of a group, so it must cross a group: at
  // least two of that group's strokes, and no other group's. A long mark that
  // spans the whole strip is not a crossbar, it is somebody underlining, and it
  // is left unexplained rather than counted.
  const bars: Segment[] = [];
  const barsPerGroup = new Array<number>(groups.length).fill(0);
  for (const bar of others) {
    let crossed = -1;
    let hit = 0;
    groups.forEach((group, gi) => {
      const inside = group.filter(
        (i) => strokes[i]!.midX >= bar.minX - 4 && strokes[i]!.midX <= bar.maxX + 4,
      );
      if (inside.length >= 2) {
        crossed = gi;
        hit++;
      }
    });
    if (hit !== 1) continue;
    barsPerGroup[crossed]!++;
    bars.push(bar);
  }

  const sizes = groups.map((group, gi) => group.length + barsPerGroup[gi]!);
  const explained = explainedInk(bars);
  const full: Partial<TallyReading> = { strokes: strokes.length, bars: bars.length, explained };

  if (explained < o.minExplained) return DECLINE("unexplained ink", { ...full, groups: sizes });

  // The structure has to agree with itself. A tally is written in fives, so
  // every group but the last holds exactly five and the last holds at most
  // five. A middle group of three means a group was split or a crossbar was
  // missed, and the total cannot be trusted even though every stroke in it may
  // have been found correctly.
  for (let i = 0; i < sizes.length; i++) {
    const last = i === sizes.length - 1;
    if (last ? sizes[i]! > 5 : sizes[i] !== 5) {
      return DECLINE("ragged groups", { ...full, groups: sizes });
    }
  }

  return {
    count: sizes.reduce((a, b) => a + b, 0),
    reason: "",
    strokes: strokes.length,
    bars: bars.length,
    groups: sizes,
    explained,
    confidence: confidenceOf(
      sizes.reduce((a, b) => a + b, 0),
      explained,
    ),
  };
}

/**
 * What a declined strip is worth as a guess, which is very little.
 *
 * Low on purpose and low in absolute terms: `PREFILL_GATE` is 0 so this reaches
 * a box, and it is nowhere near `AUTO_ACCEPT`, so a salvaged count is always
 * put in front of a person. Nothing here has been scored against eye labels --
 * these are by definition the strips the counter's own structural tests threw
 * out, and their precision is unmeasured.
 */
export const SALVAGE_CONFIDENCE = 0.1;

/**
 * A count from a strip the counter refused, or null where there is nothing to
 * count.
 *
 * The chapter owner asked for every box to arrive filled in, wrong or not, and
 * this is the honest half of that: some declines throw away a real stroke
 * count. `countTally` finds strokes, then rejects the strip because the
 * structure does not hold up -- the strokes are not parallel, the ink is not
 * all accounted for, the groups are ragged. In every one of those the strokes
 * were found and counted; what failed was the check on whether they are a
 * tally. Adding them up is a guess, and it is a guess made of something.
 *
 * Two declines are NOT salvaged, and the difference matters:
 *
 *   - Anything with no strokes at all -- "no ink", "no strokes", "too dense",
 *     "runs off the strip". There is no count to hand over, only a number
 *     somebody would have to invent.
 *   - "ink continues past the row", which is not a weak reading of THIS row. A
 *     stroke that runs past the row boundary says the crop is showing
 *     something else -- a diagonal across the card, the descenders of a word
 *     written above -- and counting it attaches a plausible number to the wrong
 *     debris item. A wrong guess a reviewer can see is one thing; a right-
 *     looking number on the wrong line is the failure `rowEscape` exists for,
 *     and the prefill audit is the only instrument that has ever caught it.
 */
export function salvageCount(reading: TallyReading): { value: number; confidence: number } | null {
  if (reading.count !== null) return null;
  if (reading.strokes < 1) return null;
  if (reading.reason === ROW_ESCAPE_REASON) return null;
  // Strokes plus crossbars: a bar IS the fifth stroke of its group, so it is
  // one more mark and not a decoration. Same arithmetic the accepted path does
  // through `groups`.
  return { value: reading.strokes + reading.bars, confidence: SALVAGE_CONFIDENCE };
}

/** Internal, so a diagnostic can sweep the overrun bar against real cells. */
export { rowOverrun as _rowOverrun, type Frame as _Frame };

/** Internal, so a diagnostic can show what the decomposition actually saw. */
export function _debugSegments(
  img: MarkImage,
  options: Partial<TallyOptions & MarkOptions> & TallyContext = {},
) {
  const { o, mask, width, height, raw } = prepare(img, options);
  const skeleton = thin(mask, width, height);
  let ink = 0;
  for (const v of skeleton) ink += v;
  const { upright, rest } = decomposeStrip(skeleton, width, height, o);
  return { raw, ink, width, segments: [...upright, ...rest] };
}
