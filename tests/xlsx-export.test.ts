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
  rowTotals,
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

/**
 * Read a filled workbook back the way an OUTSIDER would: unzip it, walk the
 * sheet, and collect every numeric cell by its reference.
 *
 * Deliberately shares no code with the writer. Every other check in this file
 * asserts that the export produced a particular string, which cannot catch the
 * failure that matters most -- a value landing in the wrong volunteer's column
 * or against the wrong debris item. Both the writer and an assertion about the
 * writer's own output agree about where C18 is; a second parser starting from
 * the bytes does not have to.
 */
function readNumericCells(bytes: Uint8Array): Map<string, number> {
  const sheet = text(parts(bytes)["xl/worksheets/sheet1.xml"]);
  const out = new Map<string, number>();

  // Self-closing cells have to be matched explicitly. `<c r="C18" s="10"/>` is
  // how the template stores an empty cell, and a pattern that only knows about
  // `<c ...>…</c>` runs past it to the next closing tag and reads a DIFFERENT
  // cell's value under this cell's reference. That is how the first version of
  // this test reported 166 misplaced numbers that were all in the right place.
  const cell = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>((?:(?!<c[ >])[\s\S])*?)<\/c>)/g;

  for (const m of sheet.matchAll(cell)) {
    const [, ref, attrs, body] = m;
    if (body === undefined) continue; // empty cell
    // t="s" is an index into sharedStrings and t="inlineStr" is text; neither
    // is a count. A cell holding a formula is skipped as well: its <v> is
    // Excel's cached result, not anything this tool wrote.
    if (/t="(?:s|str|inlineStr|b|e)"/.test(attrs!)) continue;
    if (/<f[ >]/.test(body)) continue;
    const v = /<v>([^<]*)<\/v>/.exec(body);
    if (!v) continue;
    const n = Number(v[1]);
    if (Number.isFinite(n)) out.set(ref!, n);
  }
  return out;
}

describe("a typed number comes back out of the file in the right cell", () => {
  /**
   * Every taxonomy row, spread across the volunteer columns, with a value that
   * encodes where it was supposed to go.
   *
   * The value is `card * 1000 + row`, so a number landing one column across or
   * one item down does not merely fail the assertion -- it says exactly how far
   * it moved. A spot check of one cell cannot do that, and a wrong OFFSET is
   * the shape this failure takes: it is uniform, it looks like ordinary data,
   * and nothing downstream of the export could ever detect it.
   */
  const rows = TAXONOMY.map((item) => item.row);
  const cards = [1, 2, 7, MAX_VOLUNTEERS - 1, MAX_VOLUNTEERS];
  const input: ExportInput = {
    ...baseInput,
    cards: cards.map((cardNumber, i) => ({
      cardNumber,
      pageNumbers: [i * 2 + 1, i * 2 + 2],
      cardType: "total" as const,
      values: rows.map((row) => ({
        row,
        value: cardNumber * 1000 + row,
        confidence: 0.9,
        corrected: false,
      })),
    })),
  };

  const cells = readNumericCells(fillTemplate(template, input));
  const before = readNumericCells(template);

  /**
   * The column a card's numbers belong in.
   *
   * Card NUMBER, not position in the list: card 7 belongs in column I whether
   * or not cards 3 to 6 were scanned. Writing this as "the third card I was
   * handed goes in the third column" is how a scan with a missing card silently
   * attributes every value after it to the wrong volunteer.
   */
  const columnFor = (cardNumber: number) => columnName(2 + cardNumber);

  it("puts every item of every card where the chapter reads it", () => {
    const misplaced: string[] = [];
    for (const cardNumber of cards) {
      for (const row of rows) {
        const ref = `${columnFor(cardNumber)}${row}`;
        const want = cardNumber * 1000 + row;
        if (cells.get(ref) !== want) {
          misplaced.push(`${ref}: expected ${want}, found ${cells.get(ref) ?? "nothing"}`);
        }
      }
    }
    expect(misplaced).toEqual([]);
  });

  it("writes nothing into any cell it was not asked to", () => {
    // The other half of the same property: a value in a column no card owns is
    // a number attributed to a volunteer who did not record it.
    //
    // Compared against the numeric cells the TEMPLATE already carries, not
    // against an empty sheet. The template is a working spreadsheet with its
    // own contents, and asserting that the filled copy holds nothing else would
    // be asserting something false about the file the chapter gave us.
    const wanted = new Set([
      ...cards.flatMap((cardNumber) => rows.map((row) => `${columnFor(cardNumber)}${row}`)),
      // The event header, which is numeric in two places: the head count and
      // the weight of trash. Named rather than pattern-matched, so that a value
      // escaping into column B -- where the template's own SUM formulas live,
      // and where a written number would silently replace the total of a row --
      // fails this test rather than being waved through as "something in A or B".
      "A10", // volunteers
      "A12", // pounds of trash
    ]);
    const added = [...cells.keys()].filter((ref) => !before.has(ref));
    expect(added.filter((ref) => !wanted.has(ref))).toEqual([]);
  });

  it("covers every item on the card, not just the ones with a convenient row", () => {
    // Guards the guard: if the taxonomy or the template ever stops lining up,
    // the two cases above could pass by checking almost nothing.
    expect(rows.length).toBe(83);
    expect(new Set(rows).size).toBe(83);
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

/**
 * The totals column, which is the number the chapter actually reads.
 *
 * Column B holds `SUM(Cn:BZn)` and a cached result from when the blank template
 * was saved. Excel recalculates on open and was fine; every reader that does
 * not -- Quick Look, the iOS Files preview, the preview inside a share sheet --
 * showed 0 down the whole column beside columns full of numbers. Reported from
 * a phone, which is where the tool is now used.
 */
describe("column B totals", () => {
  const filled = fillTemplate(template, baseInput);
  const sheet = new TextDecoder().decode(
    unzipSync(filled)["xl/worksheets/sheet1.xml"]!,
  );

  const cellOf = (ref: string) => {
    const at = sheet.indexOf(`<c r="${ref}"`);
    expect(at, `${ref} is missing from the sheet`).toBeGreaterThan(-1);
    return sheet.slice(at, sheet.indexOf("</c>", at) + 4);
  };

  it("caches the right total beside the formula", () => {
    // 46 + 100 from the fixture's two volunteers, the same figures the
    // per-cell checks above assert on C18 and D18.
    expect(cellOf("B18")).toContain("<v>146</v>");
  });

  it("keeps the shared formula itself untouched", () => {
    expect(cellOf("B18")).toContain('<f t="shared" ref="B18:B33" si="1">SUM(C18:BZ18)</f>');
  });

  it("keeps a shared-formula continuation cell self-closing and cached", () => {
    // These carry only an `si` index -- rebuilding one instead of preserving it
    // is exactly the corruption the column B guard exists to prevent.
    const b19 = cellOf("B19");
    expect(b19).toContain('<f t="shared" si="1"/>');
    expect(b19).toMatch(/<v>\d+<\/v>/);
  });

  it("preserves the cell style on a total", () => {
    expect(cellOf("B18")).toContain('s="9"');
  });

  it("sums only the volunteer columns of an item row", () => {
    const totals = rowTotals(buildCellEdits(baseInput));
    // Header text in column A, and anything off an item row, is not a count.
    for (const ref of totals.keys()) expect(ref.startsWith("B")).toBe(true);
    expect(totals.get("B18")).toBe(146);
  });

  it("leaves a row nobody wrote to at zero", () => {
    expect(rowTotals(buildCellEdits(baseInput)).has("B107")).toBe(false);
  });
});
