/**
 * Turn registered card pages into the list of cells a person needs to look at.
 *
 * The point of the tool: a card has 83 rows but a volunteer fills in perhaps
 * ten. Deciding which cells carry writing is a far easier and far more reliable
 * question than reading what the writing says, so the tool answers only that,
 * and shows the human a cropped picture of each one to type from. Nothing is
 * guessed, so nothing can be confidently wrong.
 */

import type { CellMap, Rect } from "./cells";
import { inkThreshold, OVERSEGMENTED_CONFIDENCE, readDigits, type DigitBox, type DigitModel } from "./digits";
import { inkFraction, type GrayImage } from "./image";
import { boxMarked, cropGray, stripMarked, tallestMark } from "./marks";
import { countBoxTally, countTally, salvageCount, TWO_UPRIGHTS } from "./tally";
import type { CardPages, PageForPairing } from "./register";
import { itemForRow, type CardSide } from "./taxonomy";

/**
 * Ink coverage below which a cell is not looked at any harder.
 *
 * This is a cheap gate, not the decision. A cell under it has essentially no
 * dark pixels at all, so there is nothing for the mark test to find and no
 * reason to pay for it: the test costs about a millisecond a cell and there are
 * 4,800 cells on a 58-card event, of which some 730 clear this floor.
 *
 * Set deliberately low, and left where it was when the whole decision rested on
 * it. Nothing below it has ever been seen to hold writing.
 */
const INK_NEGLIGIBLE = 0.008;

/**
 * Paper kept around a cell's crop, in pixels.
 *
 * The reviewer is looking at a photograph of handwriting, and a digit flush to
 * the edge of its picture is harder to read than one with a little room. It
 * also means a stroke a volunteer ran outside the box is still visible.
 */
const CROP_MARGIN = 16;

export interface ExtractedCell {
  row: number;
  itemName: string;
  section: string;
  side: CardSide;
  /** Ink coverage of the TOTAL box, 0-1. */
  ink: number;
  /** Ink coverage of the tally area to its left. */
  tallyInk: number;
  /** True when the TOTAL box looks written in. */
  hasValue: boolean;
  /** True when there are tally marks but no numeric total. */
  tallyOnly: boolean;
  /**
   * What the digit recognizer read in the TOTAL box, if it read one.
   *
   * Null as well where the box turned out to hold tally marks rather than a
   * number: its "11" or "111" was a reading of strokes, and `tallyCount` has
   * the count of them instead.
   */
  digitValue: number | null;
  /** 0-1. The WORST digit in the number: see readDigits. */
  digitConfidence: number;
  /**
   * The tally counted, or null when the counter declined.
   *
   * Counted in the strip when the TOTAL box is empty, and in the box itself
   * when what is written there is only tally strokes -- see `countBoxTally`.
   *
   * Null far more often than not, and that is the design rather than a
   * shortfall: a strip it declines costs the reviewer the keystroke they were
   * making anyway, and a strip it counts wrongly costs data integrity. See the
   * head of `tally.ts`.
   */
  tallyCount: number | null;
  /** How far that count can be trusted, 0-1. See `confidence` in tally.ts. */
  tallyConfidence: number;
  /**
   * Where the TOTAL box is, in the coordinates of THIS CELL'S `image`.
   *
   * Not the registered page's coordinates, which is what these were until the
   * page stopped being kept -- see `image` below.
   */
  rect: Rect;
  /** The tally space for this row, to the right of its printed caption. */
  tallyRect: Rect;
  /** The whole row from the tally space to the end of the TOTAL box. */
  contextRect: Rect;
  /**
   * A small crop of the registered page: this row and a margin, nothing else.
   *
   * Every cell used to hold a reference to its whole registered page, which
   * meant a 116-page scan kept 116 full-resolution images alive for as long as
   * the review list was open -- around 840MB of browser heap, on a tool aimed
   * at whatever laptop a volunteer has. Nothing downstream ever looked outside
   * the row, so the row is all that is kept: the same review list costs about
   * 26MB, and the pages are freed as soon as they are cropped.
   */
  image: GrayImage;
  pageNumber: number;
}

export interface ExtractedCard {
  cardNumber: number;
  cells: ExtractedCell[];
  /**
   * Sides whose items are absent entirely: the page was not in the scan, or it
   * could not be aligned with the template.
   *
   * A page that failed to align is dropped rather than cropped. Its cells would
   * be taken from the wrong part of the card, which yields numbers that look
   * ordinary and are attached to the wrong debris items -- worse than a gap,
   * because a gap is visible.
   */
  missingSides: CardSide[];
}

function excluded(map: CellMap, rect: { x: number; y: number; width: number; height: number }) {
  return map.exclusions.some(
    (ex) =>
      rect.x < ex.x + ex.width &&
      rect.x + rect.width > ex.x &&
      rect.y < ex.y + ex.height &&
      rect.y + rect.height > ex.y,
  );
}

/**
 * The strip of page a cell's picture is taken from: the row, plus a margin.
 *
 * The tally-only view draws the TOTAL box wider than the box itself, so the
 * right-hand side has to reach past it.
 */
function cropRegion(total: Rect, tally: Rect, page: GrayImage): Rect {
  const left = Math.min(tally.x, total.x) - CROP_MARGIN;
  const right = total.x + total.width * 1.15 + CROP_MARGIN;
  const top = Math.min(tally.y, total.y) - CROP_MARGIN;
  const bottom = Math.max(tally.y + tally.height, total.y + total.height) + CROP_MARGIN;

  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  return {
    x,
    y,
    width: Math.min(page.width, Math.ceil(right)) - x,
    height: Math.min(page.height, Math.ceil(bottom)) - y,
  };
}

/**
 * Breathing room around the TOTAL box in the picture a PERSON is shown, as a
 * share of the box's height.
 *
 * The box the tool crops is the printed box, and handwriting is not confined to
 * it. Rendered with the crop boundary drawn on, most cells on the 58-card test
 * scan have the number's foot cut off by it, and some -- a 3 written low, a 1
 * with a long tail -- are cut in half. The reviewer was being shown a picture
 * of part of a digit and asked to confirm a number.
 *
 * The paper is already there: `cropRegion` keeps `CROP_MARGIN` around the whole
 * row, so this costs no new pixels and no new work, only the decision to show
 * them. 0.3 of a 58px box is about 17px, which is what the overhang measures.
 *
 * This was the view only at first, because every segmentation and accuracy
 * figure in HANDOFF.md had been measured on the bare box. The reader has since
 * been given room too, measured separately: see `READ_MARGIN`.
 */
const VIEW_MARGIN = 0.3;

/**
 * The rectangle to SHOW for a cell: its box, plus room for the overhang,
 * clamped to the crop that was taken.
 *
 * `wide` is for a tally-only row, whose number is not there to be read and
 * whose box is drawn wider so the strip beside it stays recognisable.
 */
export function viewRect(cell: { rect: Rect; image: GrayImage }, wide = false): Rect {
  const m = Math.round(cell.rect.height * VIEW_MARGIN);
  const mx = wide ? Math.round(cell.rect.width * 0.15) : Math.round(m * 0.6);

  const x = Math.max(0, cell.rect.x - mx);
  const y = Math.max(0, cell.rect.y - m);
  return {
    x,
    y,
    width: Math.min(cell.image.width, cell.rect.x + cell.rect.width + mx) - x,
    height: Math.min(cell.image.height, cell.rect.y + cell.rect.height + m) - y,
  };
}

/** Move a rectangle from page coordinates into a crop's own coordinates. */
const rebase = (r: Rect, origin: Rect): Rect => ({
  x: r.x - origin.x,
  y: r.y - origin.y,
  width: r.width,
  height: r.height,
});

/**
 * Room the digit READER gets around the TOTAL box, as shares of the box.
 *
 * The question `VIEW_MARGIN` left open, measured. Handwriting is not confined to
 * the printed box, and read by eye, the commonest way a hidden number came out
 * wrong was its first digit cut by the crop -- a volunteer starts on the left
 * rule, so 12 read as 2, 34 as 4, and an 8 with its left half cut off as a 3.
 * The reader now gets the room to the left, a little to the right and the same
 * overhang above and below that the reviewer sees; `segmentDigits` keeps only
 * the pieces that belong to the box, so the tally strip's last strokes and the
 * next row's number stay out.
 */
const READ_MARGIN = { left: 0.2, right: 0.05, vertical: VIEW_MARGIN };

/**
 * How a line drawn down the TOTAL column is told from a "1" written in the box.
 *
 * `reach` is how far above and below the box the stroke is followed, in box
 * heights, and `span` how long it must run to be a line. One box height either
 * side is all the cell cache keeps, so the figures were measured there;
 * `drift` and `gap` are the pixels a ruled line wanders sideways per row, and
 * the rows it may skip, on a scan.
 */
const COLUMN_LINE = { reach: 1, span: 2.5, drift: 2, gap: 3 };

/**
 * Is the piece read as "1" one stretch of a line drawn down the column?
 *
 * Two volunteers struck out their whole TOTAL column with a pen line, and a
 * printed line or band crosses some boxes; inside the box, either is a
 * perfectly good 1, read at 0.5-0.85 and taken as read. What gives it away is
 * that it does not stop at the box. Traced from the piece itself and not from
 * any ink in the box: a real 1 written beside the card's own printed line
 * would otherwise be blamed for it (test-long card 27, row 63).
 *
 * `piece` is in the coordinates of the reading crop, which starts at `origin`
 * on the page.
 */
function lineDownTheColumn(image: GrayImage, total: Rect, piece: DigitBox, origin: { x: number; y: number }): boolean {
  const { reach, span, drift, gap } = COLUMN_LINE;
  const h = total.height;
  const top = Math.max(0, Math.round(total.y - reach * h));
  const left = Math.max(0, Math.round(total.x - total.width * READ_MARGIN.left));
  const win = cropGray(image, { x: left, y: top, width: total.width * (1 + READ_MARGIN.left + READ_MARGIN.right), height: h * (1 + 2 * reach) });
  const t = inkThreshold(win);
  if (t < 0) return false;
  const ink = (x: number, y: number) => x >= 0 && x < win.width && y >= 0 && y < win.height && win.data[y * win.width + x]! <= t;

  // How far the stroke through (x0, y0) runs in one direction.
  const run = (x0: number, y0: number, dir: number) => {
    let x = x0;
    let len = 0;
    let missed = 0;
    for (let y = y0 + dir; y >= 0 && y < win.height; y += dir) {
      let found = -1;
      for (let d = 0; d <= drift && found < 0; d++) {
        if (ink(x - d, y)) found = x - d;
        else if (ink(x + d, y)) found = x + d;
      }
      if (found >= 0) {
        x = found;
        missed = 0;
        len = Math.abs(y - y0);
      } else if (++missed > gap) break;
    }
    return len;
  };

  const y = Math.round(origin.y + (piece.minY + piece.maxY) / 2) - top;
  for (let px = piece.minX; px <= piece.maxX; px++) {
    const x = origin.x + px - left;
    if (ink(x, y) && run(x, y, -1) + run(x, y, 1) >= span * h) return true;
  }
  return false;
}

/** The crop the digit reader is given, and where the printed box sits inside it. */
function readingCrop(image: GrayImage, total: Rect): { crop: GrayImage; box: Rect } {
  const rect = {
    x: total.x - total.width * READ_MARGIN.left,
    y: total.y - total.height * READ_MARGIN.vertical,
    width: total.width * (1 + READ_MARGIN.left + READ_MARGIN.right),
    height: total.height * (1 + 2 * READ_MARGIN.vertical),
  };
  const crop = cropGray(image, rect);
  // cropGray rounds and clamps to the page, so the box is placed against where
  // the crop actually starts.
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  return {
    crop,
    box: {
      x: Math.round(total.x) - x0,
      y: Math.round(total.y) - y0,
      width: Math.round(total.width),
      height: Math.round(total.height),
    },
  };
}

/**
 * How tall, as a share of the box, the tallest mark in a box must be for a box
 * the digit reader found nothing in to count as written. Empty boxes and dashes
 * measured 0.25 at most, numbers 0.8 or more (`tallestMark` in marks.ts).
 */
const NUMBER_HEIGHT = 0.35;

/** The same for a tally strip: real tallies measured 0.25 or more, empty strips under 0.15. */
const STRIP_HEIGHT = 0.15;

/**
 * Reading the number written in the tally strip, where the tally itself was
 * drawn in the TOTAL box ("3" in the strip, "|||" in the box).
 *
 * The box counter is kept away from boxes beside a marked strip, because there
 * the box is as often a tally run on from the strip, or a number, as a tally of
 * its own. But mostly the strip holds the NUMBER, so it is read with the digit
 * reader. Measured with `reading-accuracy.mjs --cache` on the apps' pixels, 28
 * scans, every changed box read by eye (`eye-labels/box-tallies.json`):
 *
 *   - 9 boxes change, all of them from 11 or 111, all right by eye and by the
 *     typed sheet. Hidden and wrong: unchanged at 781.
 *   - 5 where the strip's number and the box's stroke count agree. Two
 *     independent readers agreeing: taken as read (reconcile's "agreed").
 *   - 4 where the box would not count but the strip read at 0.9 or more. Shown,
 *     never taken as read: it replaces a 111 that is always wrong.
 *
 * All 9 are on imperial-3.15, one volunteer's habit. The reading is sensitive
 * to the rendering: on the PDFKit pages the offline tools once used, a strip on
 * the same scan read 4 at 0.99 that reads 11 on the apps' pixels.
 *
 * A strip read as nothing but 1s is a tally of its own and is left alone.
 */
const STRIP_NUMBER = {
  /** The strip's confidence at which its number replaces the box's 1s alone. */
  alone: 0.9,
  /** How far above and below the strip to look, as a fraction of its height. */
  vertical: 0.15,
};

function readStripNumber(image: GrayImage, tally: Rect, model: DigitModel) {
  const rect = {
    x: tally.x,
    y: tally.y - tally.height * STRIP_NUMBER.vertical,
    width: tally.width,
    height: tally.height * (1 + 2 * STRIP_NUMBER.vertical),
  };
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const read = readDigits(cropGray(image, rect), model, {
    x: Math.round(tally.x) - x0,
    y: Math.round(tally.y) - y0,
    width: Math.round(tally.width),
    height: Math.round(tally.height),
  });
  if (!read || /^1+$/.test(String(read.value))) return null;
  return { value: read.value, confidence: read.confidence, onlyOnes: false };
}

export function cellsForSide(
  image: GrayImage,
  pageNumber: number,
  map: CellMap,
  side: CardSide,
  /**
   * The digit model, or null to leave the TOTAL box unread.
   *
   * Optional because every offline script that cuts cells wants the geometry
   * and not the reading, and loading the digit model to throw it away is pure
   * cost.
   */
  model: DigitModel | null = null,
): ExtractedCell[] {
  const out: ExtractedCell[] = [];

  for (const cell of map.cells) {
    const item = itemForRow(cell.row);
    if (!item) continue;

    // The front's pre-printed example box is printed, not written. It sits
    // above the grid and would otherwise read as four items on every card.
    if (excluded(map, cell.total)) continue;

    const ink = inkFraction(image, cell.total.x, cell.total.y, cell.total.width, cell.total.height);
    const tallyInk = inkFraction(
      image,
      cell.tally.x,
      cell.tally.y,
      cell.tally.width,
      cell.tally.height,
    );

    if (ink < INK_NEGLIGIBLE && tallyInk < INK_NEGLIGIBLE) continue;

    // Whether a person wrote here is a question about shape, not quantity --
    // see the head of `marks.ts`. Asking it of the ink fraction instead put 450
    // pictures of printed ruling in front of the reviewer on a 58-card event.
    //
    // Both regions are examined for every cell that clears the floor, and the
    // floor is not applied to them separately. An earlier version gated each
    // region on its own ink and lost a "7" over it: the box held a faint one at
    // 0.0074, just under, and the cell only survived the floor at all because
    // its tally strip did.
    const boxInked = boxMarked(cropGray(image, cell.total));
    // The same height test for the strip: one the mark test passed on a crease
    // in the paper, a tear, the printed ruling or the tail of a neighbouring
    // row's number holds nothing a tenth as tall as a tally stroke. Of the 323
    // strips the apps offered as "nothing read" across the 28 scans, 72 read by
    // eye were half empty in this way; every real tally and written-in item
    // measured 0.25 or more, every empty strip under 0.15 but those where a
    // printed edge or a smudge stood tall, which stay. See `tallestMark`.
    const tallyMarked = stripMarked(cropGray(image, cell.tally)) && tallestMark(image, cell.tally) >= STRIP_HEIGHT;

    // Read the number, where there is a number to read.
    //
    // The mirror of the tally below: that one only runs where the box is
    // EMPTY, this one only where it holds something. No cell is ever read
    // twice by the same reader, and a cell with both is what reconcile() is
    // for.
    const read = model && boxInked ? readingCrop(image, cell.total) : null;
    const readHere = model && read ? readDigits(read.crop, model, read.box) : null;

    // A box the digit reader found nothing in, holding nothing taller than a
    // dash, has no number in it: it is empty, or a volunteer's dash for none.
    // Offered, it reached the reviewer as "nothing read: type it" with a 1 in
    // it -- about two thirds of the boxes the apps showed across the 28 scans,
    // so a volunteer's checking went mostly on boxes with nothing to type, and
    // a tap on Next recorded debris that was not there. Taken out, it is left
    // blank like any box nobody wrote in, or, where the strip beside it holds
    // marks, offered as the tally it is. See `tallestMark` in marks.ts.
    const onlyADash =
      read !== null &&
      readHere === null &&
      tallestMark(image, {
        // The same room to the left the digit reader is given: a number is
        // often written against the printed column line, short of the box.
        x: cell.total.x - cell.total.width * READ_MARGIN.left,
        y: cell.total.y,
        width: cell.total.width * (1 + READ_MARGIN.left),
        height: cell.total.height,
      }) < NUMBER_HEIGHT;
    const hasValue = boxInked && !onlyADash;
    const reading = hasValue ? read : null;
    const digits = hasValue ? readHere : null;
    const tallyOnly = !hasValue && tallyMarked;
    if (!hasValue && !tallyOnly) continue;

    // Count the strokes, where they can be counted.
    //
    // Only for cells with no number in the box. Where a volunteer wrote the
    // total as well, that number is what the reviewer is reading and the tally
    // beside it is their working; pre-filling from the working would put a
    // second opinion into a box that already has a picture of the answer.
    //
    // The context is a taller slice of the SAME COLUMNS, and is not optional:
    // it is the only way to tell a printed rule down the page from a stroke a
    // volunteer made. See `ruleCoverage` in tally.ts.
    const tallyReading = tallyOnly
      ? countTally(cropGray(image, cell.tally), {
          context: cropGray(image, {
            x: cell.tally.x,
            y: cell.tally.y - cell.tally.height * 0.6,
            width: cell.tally.width,
            height: cell.tally.height * 2.2,
          }),
        })
      : null;


    // Tally marks drawn in the box itself. The digit reader sees each stroke as
    // a perfectly good 1 and reads "|||" as 111, so where it read nothing but
    // 1s the same crop is handed to the counter. Only where the strip beside it
    // is empty: where the strip holds marks too, the box is as often a tally
    // run on from the strip, or a number, as a tally of its own. Counted
    // anyway, those answered 20 more boxes and 7 of them were wrong or could not
    // be settled by eye.
    //
    // A lone 1 is handed over too. The digit reader strikes a tall stroke near
    // either side of the box as a printed rule, so "||" or "|||" drawn there
    // comes out as one stroke and one confident 1 -- the commonest way a box of
    // tally marks reached the spreadsheet unseen (HANDOFF.md, "Strokes struck as
    // rules"). The counter tells a printed side from a stroke by whether it
    // carries on into the rows around, so it sees every upright.
    const lone =
      digits !== null && !digits.onlyOnes && digits.value === 1 && digits.piece !== undefined && !tallyMarked;
    const boxTally =
      reading && (digits?.onlyOnes || (lone && !(globalThis as { __NO_LONE?: boolean }).__NO_LONE)) && !tallyMarked
        ? countBoxTally(reading.crop, reading.box)
        : null;
    const boxCount = boxTally?.count != null ? boxTally : null;

    // The number written in the strip, where the tally is in the box ("3" in
    // the strip, "|||" in the box). Only where the box read as nothing but 1s
    // and the strip holds marks -- the population the box counter is kept away
    // from above. See `STRIP_NUMBER`.
    const stripNumber =
      model && reading && digits?.onlyOnes && tallyMarked ? readStripNumber(image, cell.tally, model) : null;
    const boxOfStrokes = stripNumber ? countBoxTally(reading!.crop, reading!.box) : null;
    const stripAgrees = stripNumber !== null && boxOfStrokes?.count === stripNumber.value;
    const stripAlone = stripNumber !== null && !stripAgrees && stripNumber.confidence >= STRIP_NUMBER.alone;
    // Two clean uprights the counter will not call a two -- they are an eleven
    // as often -- are not a 1 either, so a lone 1 beside them is shown. Only
    // when that is the counter's one objection: a 1 with a flag, a curl from
    // the row above or a circle round it also comes out as two "strokes", and
    // fails its shape tests instead.
    const twoUprights =
      lone && boxTally !== null && boxTally.count === null && boxTally.strokes === 2 && boxTally.reason === TWO_UPRIGHTS;
    // The strokes were not digits, so the digit reading is withdrawn rather
    // than left to disagree with the count of them.
    const kept = boxCount ? null : digits;
    // A "1" that is one stretch of a line down the column is shown, never
    // taken as read. Only the confidence moves: it may still be a 1.
    const struck =
      kept?.value === 1 &&
      kept.piece !== undefined &&
      reading !== null &&
      lineDownTheColumn(image, cell.total, kept.piece, {
        x: Math.round(cell.total.x) - reading.box.x,
        y: Math.round(cell.total.y) - reading.box.y,
      });
    // Then it is not a number at all. Capping it was enough while everything
    // under 0.45 was shown; the apps now show the least-sure fifth, and 14 of
    // the 22 across the 28 scans went into the spreadsheet unseen as 1. The
    // chapter's sheet has 0 for 21 of the 22. With nothing in the strip
    // beside it, the box is left blank like any box nobody wrote in.
    if (struck && !tallyMarked) continue;
    const digitReading = stripAgrees
      ? stripNumber
      : stripAlone
        ? { ...stripNumber!, confidence: Math.min(stripNumber!.confidence, OVERSEGMENTED_CONFIDENCE) }
        : kept && (struck || twoUprights)
          ? { ...kept, confidence: Math.min(kept.confidence, OVERSEGMENTED_CONFIDENCE) }
          : kept;

    // A strip the counter refused, counted anyway where there were strokes to
    // count. The instruction is that every box arrives filled in; `salvageCount`
    // is where the line is drawn between a guess made of something and a number
    // made up, and it declines the second. Worth a tenth of a real reading, so
    // it fills the box and never clears the auto-accept threshold.
    const salvaged = tallyReading ? salvageCount(tallyReading) : null;

    const region = cropRegion(cell.total, cell.tally, image);
    out.push({
      row: cell.row,
      itemName: item.name,
      section: item.section,
      side,
      ink,
      tallyInk,
      hasValue,
      tallyOnly,
      digitValue: digitReading?.value ?? null,
      digitConfidence: digitReading?.confidence ?? 0,
      tallyCount: stripAgrees ? boxOfStrokes!.count : (boxCount?.count ?? tallyReading?.count ?? salvaged?.value ?? null),
      tallyConfidence: stripAgrees
        ? boxOfStrokes!.confidence
        : boxCount
          ? boxCount.confidence
          : tallyReading?.count !== null && tallyReading?.count !== undefined
            ? tallyReading.confidence
            : (salvaged?.confidence ?? 0),
      rect: rebase(cell.total, region),
      tallyRect: rebase(cell.tally, region),
      // The tally run beside the number, so the reviewer can sanity-check one
      // against the other.
      contextRect: rebase(
        {
          x: cell.tally.x,
          y: Math.min(cell.tally.y, cell.total.y) - 2,
          width: cell.total.x + cell.total.width - cell.tally.x,
          height: Math.max(cell.tally.height, cell.total.height) + 4,
        },
        region,
      ),
      image: cropGray(image, region),
      pageNumber,
    });
  }

  return out;
}

/**
 * A page already cut into cells, with only what pairing needs kept beside them.
 *
 * The registered image is deliberately absent: by the time a card is assembled
 * the page it came from is gone, and its cells carry their own crops.
 */
export interface PageCells extends PageForPairing {
  cells: ExtractedCell[];
}

/** Put a card's two sides together, once both have been cut into cells. */
export function assembleCard(card: CardPages<PageCells>): ExtractedCard {
  const cells: ExtractedCell[] = [];
  const missingSides: CardSide[] = [];

  for (const side of ["front", "back"] as const) {
    const page = card[side];
    if (page?.trusted) cells.push(...page.cells);
    else missingSides.push(side);
  }

  cells.sort((a, b) => a.row - b.row);
  return { cardNumber: card.cardNumber, cells, missingSides };
}

/**
 * Register-then-extract in one step, for the offline scripts.
 *
 * The browser does not go through here: it cuts each page into cells as the
 * page is rendered, so that no two full-resolution pages are ever alive at
 * once. This is the same work in the order that is easier to call.
 */
export function extractCard(
  card: CardPages,
  maps: { front: CellMap; back: CellMap },
): ExtractedCard {
  return assembleCard({
    cardNumber: card.cardNumber,
    front: card.front && {
      ...card.front,
      cells: card.front.trusted
        ? cellsForSide(card.front.image, card.front.pageNumber, maps.front, "front")
        : [],
    },
    back: card.back && {
      ...card.back,
      cells: card.back.trusted
        ? cellsForSide(card.back.image, card.back.pageNumber, maps.back, "back")
        : [],
    },
  });
}
