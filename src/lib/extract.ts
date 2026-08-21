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
import { readDigits, type DigitModel } from "./digits";
import { inkFraction, type GrayImage } from "./image";
import { boxMarked, cropGray, stripMarked } from "./marks";
import { countTally } from "./tally";
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
   * The tally strip counted, or null when the counter declined.
   *
   * Null far more often than not, and that is the design rather than a
   * shortfall: a strip it declines costs the reviewer the keystroke they were
   * making anyway, and a strip it counts wrongly costs data integrity. See the
   * head of `tally.ts`.
   */
  /** What the digit recognizer read in the TOTAL box, if it read one. */
  digitValue: number | null;
  /** 0-1. The WORST digit in the number: see readDigits. */
  digitConfidence: number;
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

/** Move a rectangle from page coordinates into a crop's own coordinates. */
const rebase = (r: Rect, origin: Rect): Rect => ({
  x: r.x - origin.x,
  y: r.y - origin.y,
  width: r.width,
  height: r.height,
});

export function cellsForSide(
  image: GrayImage,
  pageNumber: number,
  map: CellMap,
  side: CardSide,
  /**
   * The digit model, or null to leave the TOTAL box unread.
   *
   * Optional because every offline script that cuts cells wants the geometry
   * and not the reading, and loading 3,325 exemplars to throw them away is
   * pure cost.
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
    const hasValue = boxMarked(cropGray(image, cell.total));
    const tallyMarked = stripMarked(cropGray(image, cell.tally));
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

    // Take the row's pixels now and let the page go. Everything the reviewer
    // is shown comes out of this crop, so nothing else about the page has to
    // stay in memory once every cell on it has been cut out.
    // Read the number, where there is a number to read.
    //
    // The mirror of the tally above: that one only runs where the box is
    // EMPTY, this one only where it holds something. No cell is ever read
    // twice by the same reader, and a cell with both is what reconcile() is
    // for.
    const digitReading = model && hasValue ? readDigits(cropGray(image, cell.total), model) : null;

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
      tallyCount: tallyReading?.count ?? null,
      tallyConfidence: tallyReading?.confidence ?? 0,
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
