/**
 * Export tests, run against the chapter's actual template file.
 *
 * These mirror scripts/validate_xlsx.py, which was used to prove the
 * patch-in-place strategy before this suite could run. Keep the two in sync:
 * the Python script is the one that works without a Node toolchain.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";

import { fillTemplate } from "../src/lib/xlsx/index";
import {
  ExportError,
  buildCellEdits,
  type ExportInput,
} from "../src/lib/xlsx/export";
import { columnName, patchSheetXml } from "../src/lib/xlsx/sheet-patch";
import { MAX_VOLUNTEERS, TAXONOMY } from "../src/lib/taxonomy";

const TEMPLATE_PATH = fileURLToPath(
  new URL("../assets/template/data-entry-template.xlsx", import.meta.url),
);

const template = new Uint8Array(readFileSync(TEMPLATE_PATH));

const baseInput: ExportInput = {
  sourcePdfName: "8.2.25_Ocean-Beach_CH54.pdf",
  generatedAt: new Date("2026-07-28T00:00:00.000Z"),
  event: {
    date: "2025-08-02",
    shoreline: "Ocean Beach",
    volunteers: 3,
    pounds: 85,
    durationHours: 2,
    dataEntryVolunteer: "Test Runner",
    club: "San Diego CH54 <test@example.org>",
  },
  cards: [
    {
      cardNumber: 1,
      pageNumbers: [1, 2],
      cardType: "total",
      values: [
        { row: 18, value: 46, confidence: 0.98, corrected: false },
        { row: 36, value: 11, confidence: 0.61, corrected: true },
      ],
    },
    {
      cardNumber: 2,
      pageNumbers: [3, 4],
      cardType: "total",
      values: [{ row: 18, value: 100, confidence: 0.97, corrected: false }],
    },
    {
      cardNumber: 3,
      pageNumbers: [5, 6],
      cardType: "tally",
      values: [{ row: 80, value: 2, confidence: 0.35, corrected: false }],
    },
  ],
};

function parts(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function text(bytes: Uint8Array | undefined): string {
  if (!bytes) throw new Error("missing part");
  return new TextDecoder().decode(bytes);
}

describe("columnName", () => {
  it("maps indices to spreadsheet columns", () => {
    expect(columnName(1)).toBe("A");
    expect(columnName(3)).toBe("C");
    expect(columnName(26)).toBe("Z");
    expect(columnName(27)).toBe("AA");
    expect(columnName(78)).toBe("BZ");
  });
});

describe("buildCellEdits", () => {
  it("places volunteers in consecutive columns starting at C", () => {
    const edits = buildCellEdits(baseInput);
    expect(edits.get("C18")).toEqual({ kind: "number", value: 46 });
    expect(edits.get("D18")).toEqual({ kind: "number", value: 100 });
    expect(edits.get("E80")).toEqual({ kind: "number", value: 2 });
  });

  it("writes header values into column A, on the row below the label", () => {
    const edits = buildCellEdits(baseInput);
    // Verified against a real completed datasheet from the chapter: the label
    // is in A5 ("Date") and the value in A6.
    expect(edits.get("A6")).toEqual({ kind: "text", value: "8.2.25" });
    expect(edits.get("A8")).toEqual({ kind: "text", value: "Ocean Beach" });
    expect(edits.get("A10")).toEqual({ kind: "number", value: 3 });
    expect(edits.get("A14")).toEqual({ kind: "text", value: "2 hours" });
  });

  it("leaves the head count out when nobody recorded one", () => {
    // The volunteer count is written on the leader's card and often on no
    // other, so requiring it would block an export over a number that is not
    // on the paper. A6 and A8 still have to be there; A10 simply is not.
    const edits = buildCellEdits({ ...baseInput, event: { ...baseInput.event, volunteers: null } });
    expect(edits.has("A10")).toBe(false);
    expect(edits.get("A6")).toEqual({ kind: "text", value: "8.2.25" });
    expect(edits.get("A8")).toEqual({ kind: "text", value: "Ocean Beach" });
  });

  it("does not write header values into column B at all", () => {
    const edits = buildCellEdits(baseInput);
    for (let row = 1; row <= 16; row++) expect(edits.has(`B${row}`)).toBe(false);
  });

  it("never targets column B on an item row", () => {
    const edits = buildCellEdits(baseInput);
    for (const row of TAXONOMY.map((i) => i.row)) {
      expect(edits.has(`B${row}`)).toBe(false);
    }
  });

  it("skips zero and blank values rather than writing zeros", () => {
    const edits = buildCellEdits({
      ...baseInput,
      cards: [
        {
          cardNumber: 1,
          pageNumbers: [1, 2],
          cardType: "total",
          values: [
            { row: 18, value: 0, confidence: 0.99, corrected: false },
            { row: 19, value: 4, confidence: 0.99, corrected: false },
          ],
        },
      ],
    });
    expect(edits.has("C18")).toBe(false);
    expect(edits.get("C19")).toEqual({ kind: "number", value: 4 });
  });

  it("rejects a card beyond the template's volunteer columns", () => {
    const tooMany: ExportInput = {
      ...baseInput,
      cards: [
        {
          cardNumber: MAX_VOLUNTEERS + 1,
          pageNumbers: [1, 2],
          cardType: "total",
          values: [{ row: 18, value: 1, confidence: 1, corrected: false }],
        },
      ],
    };
    expect(() => buildCellEdits(tooMany)).toThrow(ExportError);
  });

  it("accepts exactly the last volunteer column (BZ)", () => {
    const edits = buildCellEdits({
      ...baseInput,
      cards: [
        {
          cardNumber: MAX_VOLUNTEERS,
          pageNumbers: [1, 2],
          cardType: "total",
          values: [{ row: 18, value: 1, confidence: 1, corrected: false }],
        },
      ],
    });
    expect(edits.get("BZ18")).toEqual({ kind: "number", value: 1 });
  });

  it("rejects duplicate card numbers", () => {
    expect(() =>
      buildCellEdits({
        ...baseInput,
        cards: [baseInput.cards[0]!, { ...baseInput.cards[0]! }],
      }),
    ).toThrow(/duplicate card number/);
  });

  it("rejects a row that is not a taxonomy item", () => {
    expect(() =>
      buildCellEdits({
        ...baseInput,
        cards: [
          {
            cardNumber: 1,
            pageNumbers: [1],
            cardType: "total",
            // Row 34 is a spacer between sections.
            values: [{ row: 34, value: 1, confidence: 1, corrected: false }],
          },
        ],
      }),
    ).toThrow(/not a taxonomy item row/);
  });
});

describe("patchSheetXml", () => {
  it("does not confuse C1 with C18", () => {
    const xml = '<row r="1"><c r="C1" s="2"/></row><row r="18"><c r="C18" s="10"/></row>';
    const out = patchSheetXml(
      xml,
      new Map([["C1", { kind: "number" as const, value: 7 }]]),
    );
    expect(out).toContain('<c r="C1" s="2"><v>7</v></c>');
    expect(out).toContain('<c r="C18" s="10"/>');
  });

  it("preserves the cell style", () => {
    const out = patchSheetXml(
      '<c r="C18" s="10"/>',
      new Map([["C18", { kind: "number" as const, value: 5 }]]),
    );
    expect(out).toBe('<c r="C18" s="10"><v>5</v></c>');
  });

  it("escapes XML in text values", () => {
    const out = patchSheetXml(
      '<c r="B3" s="2"/>',
      new Map([["B3", { kind: "text" as const, value: "A & B <c>" }]]),
    );
    expect(out).toContain("A &amp; B &lt;c&gt;");
  });

  it("throws when a target cell is absent from the template", () => {
    expect(() =>
      patchSheetXml("<c r=\"A1\"/>", new Map([["ZZ99", { kind: "number" as const, value: 1 }]])),
    ).toThrow(/not found/);
  });
});

describe("fillTemplate against the real template", () => {
  const filled = fillTemplate(template, baseInput);
  const before = parts(template);
  const after = parts(filled);

  it("preserves all 83 shared SUM formulas", () => {
    const sheet = text(after["xl/worksheets/sheet1.xml"]);
    expect(sheet.split('t="shared"').length - 1).toBe(83);
    expect(sheet).toContain('<f t="shared" ref="B18:B33" si="1">SUM(C18:BZ18)</f>');
    expect(sheet).toContain('<f t="shared" ref="B107:B110" si="11">SUM(C107:BZ107)</f>');
  });

  it.each([
    "xl/tables/table1.xml",
    "xl/drawings/drawing1.xml",
    "xl/persons/person.xml",
    "xl/styles.xml",
    "xl/sharedStrings.xml",
  ])("leaves %s byte-identical", (name) => {
    expect(after[name]).toEqual(before[name]);
  });

  it("writes the volunteer values", () => {
    const sheet = text(after["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="C18" s="10"><v>46</v></c>');
    expect(sheet).toContain('<v>100</v>');
  });

  it("puts the event date and beach where the chapter reads them", () => {
    const sheet = text(after["xl/worksheets/sheet1.xml"]);
    expect(sheet).toMatch(/<c r="A6"[^>]*t="inlineStr"><is><t[^>]*>8\.2\.25</);
    expect(sheet).toMatch(/<c r="A8"[^>]*t="inlineStr"><is><t[^>]*>Ocean Beach</);
  });

  it("forces recalculation so column B totals are not stale", () => {
    expect(text(after["xl/workbook.xml"])).toContain('fullCalcOnLoad="1"');
  });

  it("registers the provenance sheet everywhere it must be declared", () => {
    expect(text(after["xl/workbook.xml"])).toContain('name="Provenance"');
    expect(text(after["xl/_rels/workbook.xml.rels"])).toContain("worksheets/sheet2.xml");
    expect(text(after["[Content_Types].xml"])).toContain("/xl/worksheets/sheet2.xml");
    expect(after["xl/worksheets/sheet2.xml"]).toBeDefined();
  });

  it("records the human correction in provenance", () => {
    const prov = text(after["xl/worksheets/sheet2.xml"]);
    expect(prov).toContain("human");
    expect(prov).toContain("Plastic Bags (other: zip-lock, trash, etc.)");
  });
});
