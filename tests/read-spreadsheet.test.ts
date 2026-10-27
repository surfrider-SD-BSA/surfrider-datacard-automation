import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs script, no types
import { readSpreadsheet } from "../scripts/diagnose-review.mjs";

describe("readSpreadsheet", () => {
  it("keeps each value in its own column past an empty cell written <c .../>", () => {
    // As the chapter's sheets store row 18: F18 is empty, G18 holds 10.
    const sheet =
      '<worksheet><sheetData><row r="18"><c r="E18" s="9"><v>2.0</v></c><c r="F18" s="7"/>' +
      '<c r="G18" s="9"><v>10.0</v></c></row></sheetData></worksheet>';
    const dir = mkdtempSync(join(tmpdir(), "sheet-"));
    const path = join(dir, "t.xlsx");
    writeFileSync(path, zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) }));
    const values = readSpreadsheet(path);
    expect(values.get("E")?.get(18)).toBe("2.0");
    expect(values.get("F")?.get(18)).toBeUndefined();
    expect(values.get("G")?.get(18)).toBe("10.0");
  });
});
