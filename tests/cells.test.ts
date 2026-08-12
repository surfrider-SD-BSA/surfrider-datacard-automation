import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCellMap, validateCellMap, type CellMap } from "../src/lib/cells";
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

  // vite.config.ts sets publicDir: "assets", which makes that directory the web
  // root: assets/reference/x is served at /reference/x. Asking for the longer
  // path worked in dev, because the dev server also serves the project
  // directory, and 404ed in every built bundle -- so the tool failed for anyone
  // who ran `npm run build` and opened the result, and passed every test.
  it("asks for cell maps at the path a BUILD serves them from", async () => {
    const asked: string[] = [];
    await loadCellMap("front", async (url) => {
      asked.push(url);
      return load("front");
    });
    expect(asked).toEqual(["reference/cells.front.json"]);
    expect(asked[0]).not.toContain("assets/");
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
