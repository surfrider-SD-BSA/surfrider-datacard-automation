import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CellMap } from "../src/lib/cells";
import { cellsForSide } from "../src/lib/extract";
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
