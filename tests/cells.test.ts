import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCellMap, type CellMap } from "../src/lib/cells";
import { TAXONOMY } from "../src/lib/taxonomy";

const load = (side: string): CellMap =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../assets/reference/cells.${side}.json`, import.meta.url)), "utf8"));

describe("generated cell maps", () => {
  it.each(["front", "back"])("%s validates", (side) => {
    expect(() => validateCellMap(load(side))).not.toThrow();
  });

  it("together cover every taxonomy row exactly once", () => {
    const rows = [...load("front").cells, ...load("back").cells].map((c) => c.row).sort((a, b) => a - b);
    expect(rows).toEqual(TAXONOMY.map((i) => i.row).sort((a, b) => a - b));
  });

  it("keeps every TOTAL box clear of the front's pre-printed example box", () => {
    const m = load("front");
    for (const ex of m.exclusions) {
      for (const c of m.cells) {
        const overlaps =
          c.total.x < ex.x + ex.width && c.total.x + c.total.width > ex.x &&
          c.total.y < ex.y + ex.height && c.total.y + c.total.height > ex.y;
        expect(overlaps, `row ${c.row} overlaps the printed example box`).toBe(false);
      }
    }
  });
});
