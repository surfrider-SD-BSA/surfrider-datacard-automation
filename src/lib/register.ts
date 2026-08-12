/**
 * Decide which side of a card each scanned page is, level it, and align it to
 * the reference so the cell map's coordinates apply.
 *
 * Alignment is the step whose failures are invisible downstream, so this module
 * both places a page and judges whether it managed to. The numbers quoted below
 * were measured over 436 pages: six scans, two beaches, three scanning
 * sessions. Where a figure comes from one scan only, it says so.
 */

import type { CellMap, Rect } from "./cells";
import {
  bannerRows,
  colProfile,
  estimateSkew,
  fitAxis,
  inkFraction,
  quarterTurn,
  maskOverlap,
  resampleToReference,
  rotate,
  rowProfile,
  type GrayImage,
  type PageTransform,
} from "./image";
import type { CardSide } from "./taxonomy";

/**
 * A reference to align pages against: the blank card, the part of it that
 * alignment is fitted on, and where its section banners lie.
 */
export interface ReferenceTarget {
  image: GrayImage;
  /** The region cells are cropped from, in reference coordinates. */
  window: Rect;
  /** The two printed blocks of the side, as x-spans within the window. */
  blocks: { x0: number; x1: number }[];
  /** Which rows of each block are banner, on the blank card. */
  banners: Uint8Array[];
}

export interface ReferenceImages {
  front: GrayImage;
  back: GrayImage;
}

export interface ReferenceTargets {
  front: ReferenceTarget;
  back: ReferenceTarget;
}

/**
 * Banner overlap below this is not trusted, and the page is refused.
 *
 * A misregistered page is the worst failure this project can have: it produces
 * plausible-looking numbers against the wrong debris items, and nothing
 * downstream can tell. So a page that cannot be placed is surfaced rather than
 * processed.
 *
 * Where the number comes from. Measured on 436 pages -- six scans, two
 * beaches -- every page that registers correctly scores 0.845 or better, median
 * 0.93. Displacing a correctly registered page by hand gives the response
 * curve:
 *
 *     out by   0px   4px   8px   16px   24px   48px (one row)
 *     overlap  0.93  0.82  0.71  0.55   0.42   0.05
 *
 * so 0.75 is roughly "within 6px", comfortably inside a TOTAL box 58px tall,
 * and it sits below every page in the measured set. Note what it does NOT
 * measure: handwriting. That was the flaw in gating on profile correlation,
 * which scored a correctly registered but densely filled card at 0.82 -- below
 * a threshold set from mostly-empty ones -- and would have thrown away the
 * cards carrying the most data.
 */
export const MIN_BANNER_OVERLAP = 0.75;

export interface RegisteredPage {
  pageNumber: number;
  side: CardSide;
  /** The page, deskewed and resampled into the reference's coordinate space. */
  image: GrayImage;
  skewDegrees: number;
  /** Quarter-turns clockwise applied before alignment; 0 for a normal page. */
  quarterTurns: number;
  transform: PageTransform;
  /**
   * How well the printed section banners land where the template says they
   * are, 0-1. This is the check that decides whether the page is usable.
   */
  bannerOverlap: number;
  /** False when the page could not be placed well enough to crop cells from. */
  trusted: boolean;
  /** What the cheap side classifier saw. Reported, not acted on -- see `classifyPage`. */
  classification: {
    banner: number;
    footer: number;
    agree: boolean;
  };
}

/**
 * The region alignment is fitted on: the cells themselves, plus enough above
 * them to take in the section banner over the first row.
 *
 * Fitting on the whole page is what broke registration on scans other than the
 * one the reference was built from -- see `fitAxis`. Deriving the window from
 * the cell map rather than hard-coding fractions keeps the two from drifting
 * apart if the card is ever recalibrated.
 */
export function alignmentWindow(map: CellMap): Rect {
  const boxes = map.cells.flatMap((c) => [c.total, c.tally]);
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));

  // The banner above the first row is the single most distinctive mark in the
  // grid -- it inks ~90% of the block's width where a caption inks ~10% -- so
  // the window is opened upward to include it. On this card the banner starts
  // 63px above the first front row and 70px above the first back row, so 72 is
  // the smallest padding that takes in both.
  const pad = 72;
  return {
    x: Math.max(0, x0 - 8),
    y: Math.max(0, y0 - pad),
    width: Math.min(map.referenceSize.width, x1 + 8) - Math.max(0, x0 - 8),
    height: Math.min(map.referenceSize.height, y1 + 8) - Math.max(0, y0 - pad),
  };
}

/** The x-span of each of a side's two printed blocks, from the cell map. */
function blocksOf(map: CellMap): { x0: number; x1: number }[] {
  const out: { x0: number; x1: number }[] = [];
  for (const column of ["left", "right"] as const) {
    const cells = map.cells.filter((c) => c.column === column);
    if (cells.length === 0) continue;
    out.push({
      x0: Math.min(...cells.map((c) => c.tally.x)),
      x1: Math.max(...cells.map((c) => c.total.x + c.total.width)),
    });
  }
  return out;
}

function target(image: GrayImage, map: CellMap): ReferenceTarget {
  const window = alignmentWindow(map);
  const blocks = blocksOf(map);
  return {
    image,
    window,
    blocks,
    banners: blocks.map((b) =>
      bannerRows(image, b.x0, b.x1, window.y, window.y + window.height),
    ),
  };
}

/** Build the alignment targets the registrar needs from the loaded references. */
export function referenceTargets(
  images: ReferenceImages,
  maps: { front: CellMap; back: CellMap },
): ReferenceTargets {
  return { front: target(images.front, maps.front), back: target(images.back, maps.back) };
}

/**
 * How well a registered page's section banners match the template's.
 *
 * The weaker block decides: the card prints two independent blocks per side,
 * and a page can be right on one and wrong on the other.
 *
 * A block whose reference mask is empty has no banner to check against, so it
 * cannot vouch for anything and is skipped; if no block can, the answer is 0
 * rather than 1. Two empty masks do overlap perfectly, and reporting that as a
 * match would let every page through unverified -- which is the one outcome
 * this function exists to prevent.
 */
export function bannerOverlap(registered: GrayImage, target: ReferenceTarget): number {
  const { window, blocks, banners } = target;
  let worst = 1;
  let checked = 0;

  for (const [i, b] of blocks.entries()) {
    if (!banners[i]!.some((v) => v)) continue;
    const rows = bannerRows(registered, b.x0, b.x1, window.y, window.y + window.height);
    worst = Math.min(worst, maskOverlap(banners[i]!, rows));
    checked++;
  }
  return checked > 0 ? worst : 0;
}

/**
 * Guess whether a page is a card front or back, cheaply.
 *
 * Two signals, measured on the Pacific Beach scan the reference was built from:
 *
 *   band 4-6%    the back opens with full-width dark section banners
 *                ("PLASTIC & STYROFOAM CONT.", "GLASS"); the front has only
 *                the masthead. Fronts 0.21-0.30, backs 0.66-0.82.
 *   band 90-97%  the front ends with the donation footer and QR code; the back
 *                ends with table rows. Fronts 0.076-0.080, backs 0.020-0.024.
 *
 * Only the first generalizes. The footer test assumes the donation footer is
 * in the bottom 7% of the page, and on every front of the Imperial Beach scans
 * the card sits low enough that its foot is cropped off, so the two signals
 * disagree on a page that is perfectly ordinary.
 *
 * This is therefore a hint about which reference to try first, not a verdict --
 * `registerAgainstBestSide` decides on how well the page actually aligns. The
 * `agree` flag is still reported, because a page that is not a data card at all
 * tends to fail both tests, but nothing is refused on it alone.
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
 * Level a page and fit it onto one reference.
 *
 * Deskew first: a rotated page cannot be brought into register by any
 * translation or scale, and the residual grows with distance from the pivot.
 * Skipping this while building the reference produced a composite that was
 * sharp on one side and ghosted on the other.
 *
 * The two axes are fitted separately. They are not physically independent --
 * one sheet through one scanner is scaled the same way in both directions --
 * but the vertical scale carries the paper-feed error and the horizontal one
 * does not, so tying them together would force the noisier axis onto the
 * cleaner one. The horizontal search is correspondingly narrower.
 */
export function registerPage(img: GrayImage, target: ReferenceTarget) {
  const { image: reference, window } = target;
  const skewDegrees = estimateSkew(img);
  const levelled = rotate(img, skewDegrees);

  const y = fitAxis(
    rowProfile(reference, window.x, window.x + window.width),
    rowProfile(levelled),
    window.y,
    window.y + window.height,
  );

  // Fit x over the rows the vertical fit just placed, so the column profile is
  // taken from the grid rather than from whatever else is on the page.
  const pageY0 = Math.max(0, Math.round(y.scale * window.y + y.offset));
  const pageY1 = Math.min(
    levelled.height,
    Math.round(y.scale * (window.y + window.height) + y.offset),
  );
  const x =
    pageY1 - pageY0 > 32
      ? fitAxis(
          colProfile(reference, window.y, window.y + window.height),
          colProfile(levelled, pageY0, pageY1),
          window.x,
          window.x + window.width,
          { maxScaleDeviation: 0.03, maxOffset: 200 },
        )
      : { scale: 1, offset: 0, score: -1 };

  const transform: PageTransform = { x, y };

  // Resampled onto the reference's exact dimensions, so cell-map coordinates
  // can be used directly with no further arithmetic.
  const image = resampleToReference(levelled, reference.width, reference.height, transform);

  return {
    image,
    skewDegrees,
    transform,
    // Checked against the printed banners, not against the correlation that
    // placed it: a fit cannot be its own evidence, and the correlation falls
    // with how much a volunteer wrote rather than with how far the page is out.
    bannerOverlap: bannerOverlap(image, target),
  };
}

/**
 * Register a page against whichever side it actually is.
 *
 * The banner/footer classifier picks which reference to try first, but it does
 * not get the last word. Its footer signal reads the bottom 7% of the page and
 * assumes the donation footer is there, which is false on scans where the card
 * sits lower and its foot is cropped off -- every front of the Imperial Beach
 * scans disagrees on that signal alone. How well a page aligns to a reference
 * is the stronger evidence and it is already being computed, so a page that
 * aligns poorly to its supposed side is tried against the other one and
 * reassigned if that fits better.
 */
export function registerAgainstBestSide(
  img: GrayImage,
  targets: ReferenceTargets,
  pageNumber: number,
): RegisteredPage {
  const cls = classifyPage(img);
  const other: CardSide = cls.side === "front" ? "back" : "front";

  let side = cls.side;
  let quarterTurns = 0;
  let fit = registerPage(img, targets[side]);

  if (fit.bannerOverlap < MIN_BANNER_OVERLAP) {
    const alternative = registerPage(img, targets[other]);
    if (alternative.bannerOverlap > fit.bannerOverlap) {
      side = other;
      fit = alternative;
    }
  }

  // Still nothing. Before refusing the page, try it the other ways up.
  //
  // A card fed into the scanner sideways is perfectly readable, just turned;
  // one turned up in 960 real pages. This is only reached for a page that has
  // already failed, so the cost falls on pages that would otherwise be thrown
  // away, and the banner check is what decides whether a turn actually helped
  // rather than merely scoring better than a failure.
  if (fit.bannerOverlap < MIN_BANNER_OVERLAP) {
    for (const turns of [1, 2, 3]) {
      const turned = quarterTurn(img, turns);
      for (const candidate of ["front", "back"] as const) {
        const attempt = registerPage(turned, targets[candidate]);
        if (attempt.bannerOverlap > fit.bannerOverlap) {
          side = candidate;
          quarterTurns = turns;
          fit = attempt;
        }
      }
    }
  }

  return {
    pageNumber,
    side,
    image: fit.image,
    skewDegrees: fit.skewDegrees,
    quarterTurns,
    transform: fit.transform,
    bannerOverlap: fit.bannerOverlap,
    trusted: fit.bannerOverlap >= MIN_BANNER_OVERLAP,
    classification: { banner: cls.banner, footer: cls.footer, agree: cls.agree },
  };
}

export interface PairingProblem {
  kind: "odd-page-count" | "sequence-break" | "misaligned-page";
  message: string;
  pages: number[];
}

/**
 * What pairing needs to know about a page. Deliberately not `RegisteredPage`:
 * pairing never looks at the pixels, and typing it this way is what lets the
 * caller crop each page and release it before the cards are assembled.
 */
export interface PageForPairing {
  pageNumber: number;
  side: CardSide;
  trusted: boolean;
  bannerOverlap: number;
}

export interface CardPages<P extends PageForPairing = RegisteredPage> {
  cardNumber: number;
  /** Either side can be absent: a scan can drop a page, and both do happen. */
  front: P | null;
  back: P | null;
}

/**
 * Pair registered pages into cards.
 *
 * A card is a front and its back, in either order. A card fed into the scanner
 * the wrong way round comes out back-then-front, and that is recovered rather
 * than reported: both pages belong to the same card and nothing shifts. Two of
 * eighteen real scans have exactly one such card in them.
 *
 * Two fronts or two backs in a row is a different matter -- a page is missing
 * or was scanned twice -- and that IS surfaced, because a silent pairing error
 * shifts every subsequent card's data onto the wrong volunteer while the
 * spreadsheet still looks normal.
 *
 * (A back followed by a front could in principle be two different cards each
 * missing a page, rather than one reversed card. Nothing in the pixels can tell
 * them apart, and the reversed-card reading is both far more likely -- it is
 * one physical mis-feed rather than two coincident ones -- and the only one
 * that keeps the data.)
 */
export function pairIntoCards<P extends PageForPairing>(
  pages: P[],
): {
  cards: CardPages<P>[];
  problems: PairingProblem[];
} {
  const problems: PairingProblem[] = [];
  const cards: CardPages<P>[] = [];

  for (const p of pages) {
    if (!p.trusted) {
      problems.push({
        kind: "misaligned-page",
        message:
          `Page ${p.pageNumber} could not be lined up with the card template ` +
          `(match ${(p.bannerOverlap * 100).toFixed(0)}%, needs ` +
          `${(MIN_BANNER_OVERLAP * 100).toFixed(0)}%). Its cells are not shown, ` +
          `because they would be read from the wrong part of the page. Check ` +
          `it is a data card, right way up, and scanned whole -- two cards fed ` +
          `through together will do this.`,
        pages: [p.pageNumber],
      });
    }
  }

  let i = 0;
  while (i < pages.length) {
    const first = pages[i]!;
    const second = pages[i + 1];

    // The two orders that are both one whole card.
    if (second && first.side !== second.side) {
      const front = first.side === "front" ? first : second;
      const back = first.side === "front" ? second : first;
      cards.push({ cardNumber: cards.length + 1, front, back });
      i += 2;
      continue;
    }

    // Same side twice, or a page with nothing after it: a page is missing or
    // was scanned twice. Take this one as a lone card and resynchronise on the
    // next page rather than consuming it, so one bad page costs one card
    // instead of shifting every card after it.
    problems.push({
      kind: "sequence-break",
      message: second
        ? `Pages ${first.pageNumber} and ${second.pageNumber} both look like ` +
          `the ${first.side} of a card. A page is missing or was scanned twice, ` +
          `so one of these cards is incomplete.`
        : `Page ${first.pageNumber} has no matching second side. Its other ` +
          `half of the card cannot be read.`,
      pages: second ? [first.pageNumber, second.pageNumber] : [first.pageNumber],
    });

    cards.push({
      cardNumber: cards.length + 1,
      front: first.side === "front" ? first : null,
      back: first.side === "back" ? first : null,
    });
    i += 1;
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
