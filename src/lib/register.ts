/**
 * Classify each scanned page as a card front or back, level it, and align it to
 * the reference so the cell map's coordinates apply.
 *
 * Both the classifier's thresholds and the alignment method were measured on
 * the 114-page Pacific Beach scan while building the reference card; the
 * numbers quoted below come from that run.
 */

import {
  bestShift,
  colProfile,
  estimateSkew,
  inkFraction,
  rotate,
  rowProfile,
  type GrayImage,
} from "./image";
import type { CardSide } from "./taxonomy";

export interface ReferenceImages {
  front: GrayImage;
  back: GrayImage;
}

export interface RegisteredPage {
  pageNumber: number;
  side: CardSide;
  /** The page, deskewed and shifted into the reference's coordinate space. */
  image: GrayImage;
  skewDegrees: number;
  shift: { dx: number; dy: number };
  /** How confidently the two classifiers agreed. */
  classification: {
    banner: number;
    footer: number;
    agree: boolean;
  };
}

/**
 * Decide whether a page is a card front or back.
 *
 * Two independent signals, both measured to separate with a wide margin:
 *
 *   band 4-6%    the back opens with full-width dark section banners
 *                ("PLASTIC & STYROFOAM CONT.", "GLASS"); the front has only
 *                the masthead. Fronts 0.21-0.30, backs 0.66-0.82.
 *   band 90-97%  the front ends with the donation footer and QR code; the back
 *                ends with table rows. Fronts 0.076-0.080, backs 0.020-0.024.
 *
 * Both are computed so that a page which is not a data card at all -- a stray
 * sheet, a misfeed, something upside down -- shows up as a disagreement rather
 * than being silently filed as one side or the other.
 */
export function classifyPage(img: GrayImage) {
  const band = (f0: number, f1: number) =>
    inkFraction(
      img,
      img.width * 0.05,
      img.height * f0,
      img.width * 0.9,
      img.height * (f1 - f0),
      150,
    );

  const banner = band(0.04, 0.06);
  const footer = band(0.9, 0.97);

  const byBanner: CardSide = banner > 0.45 ? "back" : "front";
  const byFooter: CardSide = footer > 0.05 ? "front" : "back";

  return { side: byBanner, agree: byBanner === byFooter, banner, footer };
}

/**
 * Level a page and shift it onto the reference.
 *
 * Deskew first: a rotated page cannot be brought into register by any
 * translation, and the residual grows with distance from the pivot. Skipping
 * this while building the reference produced a composite that was sharp on one
 * side and ghosted on the other.
 */
export function registerPage(img: GrayImage, reference: GrayImage) {
  const skewDegrees = estimateSkew(img);
  const levelled = rotate(img, skewDegrees);

  const dx = bestShift(colProfile(reference), colProfile(levelled));
  const dy = bestShift(rowProfile(reference), rowProfile(levelled));

  // Resample onto the reference's exact dimensions, so cell-map coordinates
  // can be used directly with no further arithmetic.
  const out = new Uint8Array(reference.width * reference.height);
  for (let y = 0; y < reference.height; y++) {
    const sy = y + dy;
    const dst = y * reference.width;
    for (let x = 0; x < reference.width; x++) {
      const sx = x + dx;
      out[dst + x] =
        sy >= 0 && sy < levelled.height && sx >= 0 && sx < levelled.width
          ? levelled.data[sy * levelled.width + sx]!
          : 255; // off the edge of the scan is paper, not ink
    }
  }

  return {
    image: { width: reference.width, height: reference.height, data: out },
    skewDegrees,
    shift: { dx, dy },
  };
}

export interface PairingProblem {
  kind: "odd-page-count" | "sequence-break" | "ambiguous-page";
  message: string;
  pages: number[];
}

export interface CardPages {
  cardNumber: number;
  front: RegisteredPage;
  back: RegisteredPage | null;
}

/**
 * Pair registered pages into cards.
 *
 * A card is a front followed by its back. Anything else -- a single-sided card,
 * a stray page, a misfeed -- is surfaced rather than guessed around, because a
 * silent pairing error shifts every subsequent card's data onto the wrong
 * volunteer and the spreadsheet still looks normal.
 */
export function pairIntoCards(pages: RegisteredPage[]): {
  cards: CardPages[];
  problems: PairingProblem[];
} {
  const problems: PairingProblem[] = [];
  const cards: CardPages[] = [];

  for (const p of pages) {
    if (!p.classification.agree) {
      problems.push({
        kind: "ambiguous-page",
        message:
          `Page ${p.pageNumber} does not look clearly like a card front or back. ` +
          `Check it is a data card, right way up, and not a duplicate scan.`,
        pages: [p.pageNumber],
      });
    }
  }

  let i = 0;
  while (i < pages.length) {
    const front = pages[i]!;
    const back = pages[i + 1];

    if (front.side !== "front") {
      problems.push({
        kind: "sequence-break",
        message:
          `Expected the front of a card at page ${front.pageNumber} but it ` +
          `looks like a back. The scan may be out of order or missing a page.`,
        pages: [front.pageNumber],
      });
      i += 1;
      continue;
    }

    if (!back || back.side !== "back") {
      problems.push({
        kind: "sequence-break",
        message:
          `The card starting at page ${front.pageNumber} has no matching back ` +
          `page. Its back-page items cannot be read.`,
        pages: [front.pageNumber],
      });
      cards.push({ cardNumber: cards.length + 1, front, back: null });
      i += 1;
      continue;
    }

    cards.push({ cardNumber: cards.length + 1, front, back });
    i += 2;
  }

  if (pages.length % 2 !== 0) {
    problems.push({
      kind: "odd-page-count",
      message:
        `The PDF has ${pages.length} pages. Cards are two-sided, so an odd ` +
        `count means a page is missing or was scanned twice.`,
      pages: [],
    });
  }

  return { cards, problems };
}
