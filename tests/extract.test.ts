import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CellMap } from "../src/lib/cells";
import { cellsForSide, viewRect } from "../src/lib/extract";
import type { GrayImage } from "../src/lib/image";

const map: CellMap = JSON.parse(
  readFileSync(fileURLToPath(new URL("../assets/reference/cells.front.json", import.meta.url)), "utf8"),
);

/** A blank page the size of the reference, with one drawn-on cell. */
function pageWithMarkIn(row: number): { page: GrayImage; cell: CellMap["cells"][number] } {
  const { width, height } = map.referenceSize;
  const data = new Uint8Array(width * height).fill(248);
  const cell = map.cells.find((c) => c.row === row)!;

  // A stroke down the middle of the TOTAL box: unmistakably handwriting, and
  // somewhere a rebasing mistake would show up as blank paper.
  const x = Math.round(cell.total.x + cell.total.width / 2);
  for (let y = Math.round(cell.total.y + 6); y < cell.total.y + cell.total.height - 6; y++) {
    for (let dx = -1; dx <= 1; dx++) data[y * width + x + dx] = 40;
  }
  return { page: { width, height, data }, cell };
}

describe("cells carry their own crop, not the page", () => {
  const row = map.cells[20]!.row;
  const { page } = pageWithMarkIn(row);
  const found = cellsForSide(page, 7, map, "front");

  it("finds the cell that was written in, and only that one", () => {
    expect(found.map((c) => c.row)).toEqual([row]);
  });

  it("keeps a crop far smaller than the page", () => {
    const kept = found[0]!.image;
    expect(kept.width).toBeLessThan(page.width);
    expect(kept.height).toBeLessThan(page.height);
    // The whole point of the exercise: a page is megabytes, a row is kilobytes.
    expect(kept.width * kept.height).toBeLessThan(page.width * page.height * 0.02);
  });

  it("rebases the rectangles onto that crop, so the picture is the right one", () => {
    // The check that matters. If `rect` still held page coordinates the UI
    // would draw whatever happened to sit at that offset inside the crop --
    // a picture of the wrong part of the card beside the box someone types
    // into, which is the failure this tool exists to prevent.
    const { image, rect } = found[0]!;
    const midX = Math.round(rect.x + rect.width / 2);
    let darkest = 255;
    for (let y = Math.round(rect.y); y < rect.y + rect.height; y++) {
      for (let dx = -2; dx <= 2; dx++) {
        darkest = Math.min(darkest, image.data[y * image.width + midX + dx]!);
      }
    }
    expect(darkest).toBeLessThan(100);
  });

  it("keeps every rectangle inside the crop", () => {
    const { image, rect, tallyRect, contextRect } = found[0]!;
    for (const [name, r] of Object.entries({ rect, tallyRect, contextRect })) {
      expect(r.x, `${name}.x`).toBeGreaterThanOrEqual(0);
      expect(r.y, `${name}.y`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, `${name} right edge`).toBeLessThanOrEqual(image.width);
      expect(r.y + r.height, `${name} bottom edge`).toBeLessThanOrEqual(image.height);
    }
  });

  it("leaves room around the number rather than cropping flush to it", () => {
    const { image, rect } = found[0]!;
    expect(rect.x).toBeGreaterThan(0);
    expect(rect.y).toBeGreaterThan(0);
    expect(rect.y + rect.height).toBeLessThan(image.height);
  });

  it("offers nothing at all from a blank page", () => {
    const { width, height } = map.referenceSize;
    const blank: GrayImage = { width, height, data: new Uint8Array(width * height).fill(248) };
    expect(cellsForSide(blank, 1, map, "front")).toEqual([]);
  });
});

describe("viewRect", () => {
  /** A cell as the crop path produces one: a box inside a slightly bigger crop. */
  const cell = (rect: { x: number; y: number; width: number; height: number }, w: number, h: number) => ({
    rect,
    image: { width: w, height: h, data: new Uint8Array(w * h) },
  });

  it("gives the number room the printed box does not", () => {
    // The defect this exists for: cropping to the box cut the foot off most
    // handwritten numbers, because a hand does not stop at the rule.
    const c = cell({ x: 60, y: 40, width: 100, height: 58 }, 400, 160);
    const v = viewRect(c);

    expect(v.y).toBeLessThan(c.rect.y);
    expect(v.y + v.height).toBeGreaterThan(c.rect.y + c.rect.height);
    expect(v.x).toBeLessThan(c.rect.x);
    expect(v.x + v.width).toBeGreaterThan(c.rect.x + c.rect.width);
  });

  it("never asks for paper the crop does not have", () => {
    // The margin comes out of what `cropRegion` already kept. A box flush to
    // the edge of its crop has to stay inside it, or cropToCanvas silently
    // clamps and the picture is off-centre instead of merely tight.
    const c = cell({ x: 0, y: 0, width: 100, height: 58 }, 100, 58);
    const v = viewRect(c);

    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.x + v.width).toBeLessThanOrEqual(100);
    expect(v.y + v.height).toBeLessThanOrEqual(58);
  });

  it("keeps the whole box, whatever the clamping", () => {
    for (const r of [
      { x: 0, y: 0, width: 100, height: 58 },
      { x: 300, y: 100, width: 100, height: 58 },
      { x: 10, y: 5, width: 40, height: 20 },
    ]) {
      const v = viewRect(cell(r, 400, 160));
      expect(v.x).toBeLessThanOrEqual(r.x);
      expect(v.y).toBeLessThanOrEqual(r.y);
      expect(v.x + v.width).toBeGreaterThanOrEqual(Math.min(400, r.x + r.width));
      expect(v.y + v.height).toBeGreaterThanOrEqual(Math.min(160, r.y + r.height));
    }
  });

  it("widens a tally-only row instead of hugging its box", () => {
    const c = cell({ x: 60, y: 40, width: 100, height: 58 }, 400, 160);
    expect(viewRect(c, true).width).toBeGreaterThan(viewRect(c, false).width);
  });
});
