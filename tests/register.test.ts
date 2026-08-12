/**
 * Registration: does a page land where the cell map says it should?
 *
 * These tests are built on a synthetic card rather than a real scan, because
 * the point is to check the machinery against a KNOWN answer -- a page is made
 * by taking the template and applying an exact scale, shift and rotation, so
 * the test can assert that registration recovers those numbers, not merely
 * that it produces a plausible-looking picture. Real scans are measured by
 * `scripts/diagnose-registration.mjs`, which is a different question.
 */

import { describe, expect, it } from "vitest";

import type { CellMap } from "../src/lib/cells";
import {
  bannerRows,
  fitAxis,
  maskOverlap,
  paperLevel,
  quarterTurn,
  resampleToReference,
  rotate,
  rowProfile,
  type GrayImage,
} from "../src/lib/image";
import {
  MIN_BANNER_OVERLAP,
  alignmentWindow,
  bannerOverlap,
  pairIntoCards,
  referenceTargets,
  registerAgainstBestSide,
  registerPage,
  type RegisteredPage,
} from "../src/lib/register";

// ---------------------------------------------------------------------------
// A synthetic card: two blocks of ruled rows, split into sections by solid
// banners, on a page the same size and shape as the real one.
// ---------------------------------------------------------------------------

const WIDTH = 600;
const HEIGHT = 800;
const BLOCKS = [
  { x0: 40, x1: 290 },
  { x0: 310, x1: 560 },
];
const BANNERS = [120, 300, 520];
const ROW_PITCH = 20;

function syntheticCard(): GrayImage {
  const data = new Uint8Array(WIDTH * HEIGHT).fill(250);
  const paint = (x0: number, x1: number, y0: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * WIDTH + x] = v;
  };

  // A masthead, which exists to be ignored: it is the part of the real card
  // that does not keep a fixed distance from the grid.
  paint(40, 560, 20, 60, 40);

  for (const b of BLOCKS) {
    for (const y of BANNERS) paint(b.x0, b.x1, y, y + 16, 30);
    // Row rules, plus a caption stub so a row is not left/right symmetric. The
    // rules are faint on purpose: on a real card they are 1px hairlines that
    // stay above the ink threshold, which is why a full-width row of rule does
    // not read as a section banner.
    for (let y = 140; y < 780; y += ROW_PITCH) {
      paint(b.x0, b.x1, y, y + 1, 210);
      paint(b.x0 + 6, b.x0 + 60, y + 6, y + 12, 90);
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

/** A cell map over the synthetic card, in the shape the real ones have. */
function syntheticMap(side: "front" | "back"): CellMap {
  const cells = [];
  for (const [i, b] of BLOCKS.entries()) {
    for (let k = 0; k < 8; k++) {
      const y = 340 + k * ROW_PITCH;
      cells.push({
        row: k + 1,
        column: (i === 0 ? "left" : "right") as "left" | "right",
        total: { x: b.x1 - 60, y: y + 2, width: 55, height: 16 },
        tally: { x: b.x0 + 4, y: y + 2, width: b.x1 - b.x0 - 70, height: 16 },
      });
    }
  }
  return {
    side,
    referenceSize: { width: WIDTH, height: HEIGHT },
    referenceDpi: 200,
    exclusions: [],
    cells,
  };
}

/** Photograph the card: scale it, shift it, and optionally tilt it. */
function scanOf(
  card: GrayImage,
  { scale = 1, dx = 0, dy = 0, skew = 0, height = HEIGHT } = {},
): GrayImage {
  const out = new Uint8Array(WIDTH * height).fill(255);
  for (let y = 0; y < height; y++) {
    const sy = (y - dy) / scale;
    const y0 = Math.floor(sy);
    if (y0 < 0 || y0 + 1 >= card.height) continue;
    const fy = sy - y0;
    for (let x = 0; x < WIDTH; x++) {
      const sx = (x - dx) / scale;
      const x0 = Math.floor(sx);
      if (x0 < 0 || x0 + 1 >= card.width) continue;
      const fx = sx - x0;
      const i = y0 * card.width + x0;
      out[y * WIDTH + x] =
        card.data[i]! * (1 - fx) * (1 - fy) +
        card.data[i + 1]! * fx * (1 - fy) +
        card.data[i + card.width]! * (1 - fx) * fy +
        card.data[i + card.width + 1]! * fx * fy;
    }
  }
  const page = { width: WIDTH, height, data: out };
  return skew ? rotate(page, skew) : page;
}

const CARD = syntheticCard();
const MAPS = { front: syntheticMap("front"), back: syntheticMap("back") };
const TARGETS = referenceTargets({ front: CARD, back: CARD }, MAPS);

// ---------------------------------------------------------------------------

describe("fitAxis", () => {
  const ref = rowProfile(CARD);

  it("recovers a pure translation", () => {
    const fit = fitAxis(ref, rowProfile(scanOf(CARD, { dy: 37 })), 140, 780);
    expect(fit.offset).toBeCloseTo(37, 0);
    expect(fit.scale).toBeCloseTo(1, 2);
  });

  it("recovers a scale, which no translation could fix", () => {
    // 2.5% over a 640px grid moves the last row by 16px -- most of a row.
    const fit = fitAxis(ref, rowProfile(scanOf(CARD, { scale: 1.025 })), 140, 780);
    expect(fit.scale).toBeCloseTo(1.025, 2);
  });

  it("recovers a scale and a large offset together", () => {
    const fit = fitAxis(ref, rowProfile(scanOf(CARD, { scale: 0.98, dy: 120 })), 140, 780);
    const at = (y: number) => fit.scale * y + fit.offset;
    // Judge the fit by where it puts the grid, not by the parameters alone.
    expect(at(340)).toBeCloseTo(0.98 * 340 + 120, -0.5);
    expect(at(700)).toBeCloseTo(0.98 * 700 + 120, -0.5);
  });

  it("does not lock onto a whole-row alias", () => {
    // The grid repeats every 20px, so a wrong fit lands a multiple of that out.
    const fit = fitAxis(ref, rowProfile(scanOf(CARD, { dy: 46 })), 140, 780);
    expect(Math.abs(fit.offset - 46)).toBeLessThan(ROW_PITCH / 2);
  });
});

describe("resampleToReference", () => {
  it("undoes the transform it is given", () => {
    const page = scanOf(CARD, { scale: 1.03, dx: -12, dy: 40 });
    const back = resampleToReference(page, WIDTH, HEIGHT, {
      x: { scale: 1.03, offset: -12, score: 1 },
      y: { scale: 1.03, offset: 40, score: 1 },
    });

    // Resampling twice through bilinear softens edges, so individual pixels on
    // a hard edge differ; what must not happen is structure MOVING. Mean error
    // over the grid measures that, and the banners must still line up.
    let total = 0;
    let n = 0;
    for (let y = 100; y < 700; y++) {
      for (let x = 50; x < 550; x++, n++) {
        total += Math.abs(back.data[y * WIDTH + x]! - CARD.data[y * WIDTH + x]!);
      }
    }
    expect(total / n).toBeLessThan(4);
    expect(bannerOverlap(back, TARGETS.front)).toBeGreaterThan(0.9);
  });

  it("fills off the edge of the scan with paper, not ink", () => {
    const shifted = resampleToReference(CARD, WIDTH, HEIGHT, {
      x: { scale: 1, offset: 0, score: 1 },
      y: { scale: 1, offset: -40, score: 1 },
    });
    expect(shifted.data[5 * WIDTH + 300]).toBe(255);
  });
});

describe("banner overlap", () => {
  it("is near 1 for a page that is already in register", () => {
    expect(bannerOverlap(CARD, TARGETS.front)).toBeCloseTo(1, 5);
  });

  it("collapses when the page is out by one row", () => {
    const off = resampleToReference(CARD, WIDTH, HEIGHT, {
      x: { scale: 1, offset: 0, score: 1 },
      y: { scale: 1, offset: ROW_PITCH, score: 1 },
    });
    expect(bannerOverlap(off, TARGETS.front)).toBeLessThan(0.2);
  });

  it("ignores handwriting, which is what makes it usable as a check", () => {
    // Scribble over every cell: heavy, but nowhere near a banner's coverage.
    const written = { ...CARD, data: Uint8Array.from(CARD.data) };
    for (const c of MAPS.front.cells) {
      for (let y = c.tally.y; y < c.tally.y + c.tally.height; y++) {
        for (let x = c.tally.x; x < c.tally.x + c.tally.width; x += 3) {
          written.data[y * WIDTH + x] = 20;
        }
      }
    }
    expect(bannerOverlap(written, TARGETS.front)).toBeGreaterThan(MIN_BANNER_OVERLAP);
  });

  it("reads a page's own paper level, so a gray scan is not all ink", () => {
    const gray = { ...CARD, data: Uint8Array.from(CARD.data, (v) => Math.round(v * 0.75)) };
    expect(paperLevel(gray)).toBeLessThan(paperLevel(CARD));
    expect(bannerOverlap(gray, TARGETS.front)).toBeGreaterThan(MIN_BANNER_OVERLAP);
  });

  it("is an intersection over union, so an all-ink mask does not pass", () => {
    const solid = new Uint8Array(200).fill(1);
    const sparse = new Uint8Array(200);
    sparse.fill(1, 40, 60);
    expect(maskOverlap(sparse, sparse)).toBe(1);
    expect(maskOverlap(solid, sparse)).toBeCloseTo(0.1, 5);
    expect(bannerRows(CARD, BLOCKS[0]!.x0, BLOCKS[0]!.x1, 100, 140).some((v) => v)).toBe(true);
  });
});

describe("alignmentWindow", () => {
  it("covers the cells and opens upward to take in the banner above them", () => {
    const w = alignmentWindow(MAPS.front);
    const firstRow = Math.min(...MAPS.front.cells.map((c) => c.total.y));
    const lastRow = Math.max(...MAPS.front.cells.map((c) => c.total.y + c.total.height));

    expect(w.y).toBeLessThan(300); // the banner at 300 is inside
    expect(w.y).toBeLessThan(firstRow);
    expect(w.y + w.height).toBeGreaterThanOrEqual(lastRow);
    expect(w.y).toBeGreaterThan(60); // the masthead is not
  });
});

describe("registerPage", () => {
  it("places cells within a pixel through scale, shift and skew together", () => {
    const page = scanOf(CARD, { scale: 1.02, dx: 9, dy: -55, skew: 0.4 });
    const r = registerPage(page, TARGETS.front);

    expect(r.bannerOverlap).toBeGreaterThan(0.9);
    expect(r.transform.y.scale).toBeCloseTo(1.02, 2);

    // The claim that matters: a TOTAL box in reference coordinates lands on the
    // same pixels of the registered page as it does on the template.
    for (const cell of MAPS.front.cells) {
      let diff = 0;
      for (let y = cell.total.y; y < cell.total.y + cell.total.height; y++) {
        for (let x = cell.total.x; x < cell.total.x + cell.total.width; x++) {
          diff = Math.max(diff, Math.abs(r.image.data[y * WIDTH + x]! - CARD.data[y * WIDTH + x]!));
        }
      }
      expect(diff, `row ${cell.row} is cropped from different pixels`).toBeLessThan(70);
    }
  });

  it("handles a page taller than the template, as a double feed produces", () => {
    // 190px is far beyond anything a translation-only search would reach; this
    // is the case where the whole card sits low on an oversized sheet.
    const page = scanOf(CARD, { dy: 190, height: HEIGHT + 220 });
    const r = registerPage(page, TARGETS.front);
    expect(r.transform.y.offset).toBeCloseTo(190, -0.5);
    expect(r.bannerOverlap).toBeGreaterThanOrEqual(MIN_BANNER_OVERLAP);
  });
});

describe("registerAgainstBestSide", () => {
  /** A back reference that is unmistakably not the front: the card flipped. */
  const backCard: GrayImage = {
    width: WIDTH,
    height: HEIGHT,
    data: Uint8Array.from(CARD.data, (_, i) => {
      const y = HEIGHT - 1 - Math.floor(i / WIDTH);
      return CARD.data[y * WIDTH + (i % WIDTH)]!;
    }),
  };
  const targets = referenceTargets({ front: CARD, back: backCard }, MAPS);

  it("refuses when the reference block has no banner to check against", () => {
    const blank: GrayImage = { width: WIDTH, height: HEIGHT, data: new Uint8Array(WIDTH * HEIGHT).fill(250) };
    const blankTargets = referenceTargets({ front: blank, back: blank }, MAPS);
    // Two empty masks overlap perfectly. That must not read as "aligned".
    expect(bannerOverlap(CARD, blankTargets.front)).toBe(0);
  });

  it("refuses a page that is not a card at all", () => {
    const noise: GrayImage = {
      width: WIDTH,
      height: HEIGHT,
      data: Uint8Array.from({ length: WIDTH * HEIGHT }, (_, i) => ((i * 2654435761) % 256)),
    };
    const r = registerAgainstBestSide(noise, targets, 1);
    expect(r.trusted).toBe(false);
    expect(r.bannerOverlap).toBeLessThan(MIN_BANNER_OVERLAP);
  });

  it("accepts a real page and reports which side it is", () => {
    const r = registerAgainstBestSide(scanOf(CARD, { dy: 24 }), targets, 3);
    expect(r.trusted).toBe(true);
    expect(r.pageNumber).toBe(3);
    expect(r.quarterTurns).toBe(0);
  });

  it("recovers a card fed through the scanner sideways", () => {
    // One real page in 960 is like this: readable, just turned.
    const sideways = quarterTurn(scanOf(CARD, { dy: 8 }), 1);
    const r = registerAgainstBestSide(sideways, targets, 4);

    expect(r.trusted).toBe(true);
    // Turned back the other way: a page rotated clockwise needs three more
    // quarter-turns to come upright.
    expect(r.quarterTurns).toBe(3);
    expect(r.image.width).toBe(WIDTH);
    expect(r.image.height).toBe(HEIGHT);
  });

  it("does not turn a page that is already the right way up", () => {
    // The rotation retry must be reachable only from failure. If it could
    // improve on a good fit it would sometimes "recover" an upright page into
    // a turned one, which is a silent way to read every cell from the wrong
    // place.
    const r = registerAgainstBestSide(scanOf(CARD, { scale: 1.02, dx: 6 }), targets, 5);
    expect(r.quarterTurns).toBe(0);
    expect(r.trusted).toBe(true);
  });
});

describe("quarterTurn", () => {
  it("moves the corners where a clockwise turn should", () => {
    const img: GrayImage = { width: 3, height: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) };
    const turned = quarterTurn(img, 1);

    expect(turned.width).toBe(2);
    expect(turned.height).toBe(3);
    // Top-left of the source ends up top-right.
    expect([...turned.data]).toEqual([4, 1, 5, 2, 6, 3]);
  });

  it("four turns is the identity, and zero turns copies nothing", () => {
    const img: GrayImage = { width: 3, height: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) };
    expect([...quarterTurn(quarterTurn(quarterTurn(quarterTurn(img, 1), 1), 1), 1).data]).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(quarterTurn(img, 0)).toBe(img);
  });
});

describe("pairIntoCards", () => {
  const page = (n: number, side: "front" | "back", trusted = true): RegisteredPage => ({
    pageNumber: n,
    side,
    image: CARD,
    skewDegrees: 0,
    quarterTurns: 0,
    transform: { x: { scale: 1, offset: 0, score: 1 }, y: { scale: 1, offset: 0, score: 1 } },
    bannerOverlap: trusted ? 0.95 : 0.4,
    trusted,
    classification: { banner: 0.2, footer: 0.08, agree: true },
  });

  it("says nothing about a clean scan", () => {
    const { cards, problems } = pairIntoCards([page(1, "front"), page(2, "back")]);
    expect(cards).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it("surfaces a page that could not be aligned, naming it", () => {
    const { problems } = pairIntoCards([page(1, "front"), page(2, "back", false)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.kind).toBe("misaligned-page");
    expect(problems[0]!.pages).toEqual([2]);
    expect(problems[0]!.message).toContain("Page 2");
  });

  it("pairs a card that was fed in backwards, without complaining", () => {
    // Two of eighteen real scans have exactly one of these. Both pages belong
    // to the same card, so nothing shifts and there is nothing to report.
    const { cards, problems } = pairIntoCards([page(1, "back"), page(2, "front")]);
    expect(problems).toEqual([]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.front!.pageNumber).toBe(2);
    expect(cards[0]!.back!.pageNumber).toBe(1);
  });

  it("keeps a reversed card from shifting the cards after it", () => {
    const { cards, problems } = pairIntoCards([
      page(1, "front"), page(2, "back"),
      page(3, "back"), page(4, "front"), // fed in backwards
      page(5, "front"), page(6, "back"),
    ]);
    expect(problems).toEqual([]);
    expect(cards.map((c) => [c.front!.pageNumber, c.back!.pageNumber])).toEqual([
      [1, 2], [4, 3], [5, 6],
    ]);
  });

  it("resynchronises after a missing page instead of shifting every later card", () => {
    // Page 3's partner never made it through the scanner. Pages 4-7 are still
    // two good cards, and must not be paired across the gap.
    const { cards, problems } = pairIntoCards([
      page(1, "front"), page(2, "back"),
      page(3, "front"),
      page(4, "front"), page(5, "back"),
      page(6, "front"), page(7, "back"),
    ]);
    const breaks = problems.filter((p) => p.kind === "sequence-break");
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.pages).toEqual([3, 4]);
    expect(cards).toHaveLength(4);
    expect(cards[1]!.back).toBeNull();
    expect(cards.map((c) => [c.front?.pageNumber ?? null, c.back?.pageNumber ?? null])).toEqual([
      [1, 2], [3, null], [4, 5], [6, 7],
    ]);
  });

  it("reports a lone back page as a card missing its front", () => {
    const { cards, problems } = pairIntoCards([page(1, "back")]);
    expect(problems).toHaveLength(2); // sequence break, and the odd page count
    expect(cards[0]!.front).toBeNull();
    expect(cards[0]!.back!.pageNumber).toBe(1);
  });

  it("does not complain merely because the side classifier was unsure", () => {
    // The classifier's footer signal is wrong on every front of some scans;
    // alignment is what decides, so disagreement alone is not a problem.
    const unsure = { ...page(1, "front"), classification: { banner: 0.2, footer: 0.01, agree: false } };
    expect(pairIntoCards([unsure, page(2, "back")]).problems).toEqual([]);
  });
});
