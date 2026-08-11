/**
 * Turn registered card pages into the list of cells a person needs to look at.
 *
 * The point of the tool: a card has 83 rows but a volunteer fills in perhaps
 * ten. Deciding which cells carry writing is a far easier and far more reliable
 * question than reading what the writing says, so the tool answers only that,
 * and shows the human a cropped picture of each one to type from. Nothing is
 * guessed, so nothing can be confidently wrong.
 */

import type { CellMap } from "./cells";
import { inkFraction, type GrayImage } from "./image";
import type { CardPages } from "./register";
import { itemForRow, type CardSide } from "./taxonomy";

/**
 * Ink coverage above which a TOTAL box is treated as written in.
 *
 * A blank box is not perfectly clean: it carries its own printed rules and
 * scanner noise. Measured on the reference card, an empty TOTAL box sits around
 * 0.01-0.02; a single handwritten digit covers 0.05 or more.
 *
 * Set deliberately low. A false positive costs one glance at an empty crop; a
 * false negative silently drops a number the volunteer recorded, which is the
 * failure this tool exists to prevent.
 */
const INK_PRESENT = 0.025;

/** Cells below this are not even offered for review. */
const INK_NEGLIGIBLE = 0.008;

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
  /** Where the TOTAL box is, in reference coordinates. */
  rect: { x: number; y: number; width: number; height: number };
  /** The tally space for this row, to the right of its printed caption. */
  tallyRect: { x: number; y: number; width: number; height: number };
  /** Wider crop including the item label, for context. */
  contextRect: { x: number; y: number; width: number; height: number };
  /** The registered page this came from. */
  image: GrayImage;
  pageNumber: number;
}

export interface ExtractedCard {
  cardNumber: number;
  cells: ExtractedCell[];
  /** Pages that could not be read, so their items are absent entirely. */
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

function cellsForSide(
  image: GrayImage,
  pageNumber: number,
  map: CellMap,
  side: CardSide,
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

    const hasValue = ink >= INK_PRESENT;

    out.push({
      row: cell.row,
      itemName: item.name,
      section: item.section,
      side,
      ink,
      tallyInk,
      hasValue,
      tallyOnly: !hasValue && tallyInk >= INK_PRESENT,
      rect: cell.total,
      tallyRect: cell.tally,
      // Include the label and the tally run so the reviewer can see which item
      // it is and sanity-check the number against the marks.
      contextRect: {
        x: cell.tally.x,
        y: Math.min(cell.tally.y, cell.total.y) - 2,
        width: cell.total.x + cell.total.width - cell.tally.x,
        height: Math.max(cell.tally.height, cell.total.height) + 4,
      },
      image,
      pageNumber,
    });
  }

  return out;
}

export function extractCard(
  card: CardPages,
  maps: { front: CellMap; back: CellMap },
): ExtractedCard {
  const cells: ExtractedCell[] = [];
  const missingSides: CardSide[] = [];

  cells.push(...cellsForSide(card.front.image, card.front.pageNumber, maps.front, "front"));

  if (card.back) {
    cells.push(...cellsForSide(card.back.image, card.back.pageNumber, maps.back, "back"));
  } else {
    missingSides.push("back");
  }

  cells.sort((a, b) => a.row - b.row);
  return { cardNumber: card.cardNumber, cells, missingSides };
}
