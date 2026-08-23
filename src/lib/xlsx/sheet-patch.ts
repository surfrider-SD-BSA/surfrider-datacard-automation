/**
 * Minimal, dependency-free patching of a SpreadsheetML worksheet.
 *
 * Why not SheetJS: the chapter's template carries 83 shared formulas in column
 * B (`<f t="shared" ref="B18:B33" si="1">`), an Excel Table spanning A18:BZ110,
 * a drawing, and a `persons` part. A read-model-write round-trip through a
 * spreadsheet library rebuilds the workbook from its own model and does not
 * reliably carry those parts through -- which would quietly break the column B
 * totals the chapter reads off the sheet.
 *
 * We never need to restructure the sheet, only to fill cells that already
 * exist. The template ships every cell as an empty styled placeholder
 * (`<c r="C18" s="10"/>`), so filling one is a local substitution that keeps
 * the cell's style and leaves every other byte of the file untouched.
 *
 * This module is pure string-in/string-out with no zip or DOM dependency, so
 * it can be exercised directly in tests.
 */

export type CellValue =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string };

export class SheetPatchError extends Error {}

/** Escape text destined for an XML text node. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Locate the `<c r="REF" ...>` element for `ref`.
 * Returns the element's span in `xml` plus its start tag.
 */
function findCell(
  xml: string,
  ref: string,
): { start: number; end: number; startTag: string } {
  // The trailing lookahead stops `C1` from matching `C18`.
  const re = new RegExp(`<c r="${ref}"(?=[\\s/>])`, "g");
  const m = re.exec(xml);
  if (!m) {
    throw new SheetPatchError(
      `cell ${ref} not found in worksheet -- the template layout changed`,
    );
  }

  const start = m.index;
  const tagEnd = xml.indexOf(">", start);
  if (tagEnd === -1) {
    throw new SheetPatchError(`malformed cell element for ${ref}`);
  }
  const startTag = xml.slice(start, tagEnd + 1);

  if (startTag.endsWith("/>")) {
    return { start, end: tagEnd + 1, startTag };
  }

  const close = xml.indexOf("</c>", tagEnd);
  if (close === -1) {
    throw new SheetPatchError(`unclosed cell element for ${ref}`);
  }
  return { start, end: close + 4, startTag };
}

/** Pull the `s="N"` style index off a start tag so we can preserve it. */
function styleAttr(startTag: string): string {
  const m = /\ss="(\d+)"/.exec(startTag);
  return m ? ` s="${m[1]}"` : "";
}

function renderCell(ref: string, style: string, value: CellValue): string {
  if (value.kind === "number") {
    if (!Number.isFinite(value.value)) {
      throw new SheetPatchError(`cell ${ref}: ${value.value} is not a finite number`);
    }
    return `<c r="${ref}"${style}><v>${value.value}</v></c>`;
  }
  // Inline strings avoid having to append to (and reindex) sharedStrings.xml.
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(
    value.value,
  )}</t></is></c>`;
}

/**
 * Replace the contents of the given cells, preserving each cell's style.
 *
 * Every target cell must already exist in the sheet; a missing one means the
 * template no longer matches our assumptions and is raised rather than guessed
 * around.
 */
export function patchSheetXml(xml: string, cells: Map<string, CellValue>): string {
  // Apply right-to-left by document position so earlier offsets stay valid.
  const edits = [...cells.entries()].map(([ref, value]) => {
    const { start, end, startTag } = findCell(xml, ref);
    return { start, end, text: renderCell(ref, styleAttr(startTag), value) };
  });

  edits.sort((a, b) => b.start - a.start);

  let out = xml;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * Refresh the cached result of a formula cell, leaving the formula itself alone.
 *
 * A formula cell in xlsx carries two things: the formula, and the value Excel
 * last computed for it. Every reader that is not a calculation engine shows the
 * cached one. The chapter's template was saved blank, so all 83 of its column B
 * totals cache `<v>0</v>`, and `forceFullCalcOnLoad` only helps a reader that
 * recalculates -- desktop Excel does, and Quick Look, the iOS Files preview and
 * the preview inside a share sheet do not. On a phone, which is where this tool
 * is now used, the totals column read 0 all the way down beside columns full of
 * numbers.
 *
 * So the totals are computed here as well as by the sheet, and written into the
 * cache. Excel still recalculates on open and arrives at the same figures; every
 * other reader shows them without having to.
 *
 * The formula element is preserved byte for byte -- shared formulas carry a
 * `si` index and only the first cell of a group holds the text, so rebuilding
 * one is exactly the corruption `assertNeverWritesFormulaColumn` exists to
 * prevent. This only ever replaces what is between `</f>` and `</c>`.
 */
export function patchFormulaCache(xml: string, cached: Map<string, number>): string {
  const edits = [...cached.entries()].map(([ref, value]) => {
    if (!Number.isFinite(value)) {
      throw new SheetPatchError(`cell ${ref}: ${value} is not a finite number`);
    }
    const { start, end, startTag } = findCell(xml, ref);
    const body = xml.slice(start, end);
    const formula = /<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/.exec(body);
    if (!formula) {
      throw new SheetPatchError(
        `cell ${ref} holds no formula -- the template layout changed`,
      );
    }
    return {
      start,
      end,
      text: `<c r="${ref}"${styleAttr(startTag)}>${formula[0]}<v>${value}</v></c>`,
    };
  });

  edits.sort((a, b) => b.start - a.start);

  let out = xml;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/**
 * Force Excel to recalculate on open.
 *
 * Column B holds `SUM(C18:BZ18)`. `patchFormulaCache` above now writes the right
 * answer into each of those cells so that a reader which does not calculate
 * still shows a correct total; this flag is the other half, and makes Excel
 * recompute from the sheet itself rather than trusting a number we put there.
 * Both are needed: the flag alone left phone previews reading 0, and the cache
 * alone would leave the totals frozen if someone edited a column by hand.
 */
export function forceFullCalcOnLoad(workbookXml: string): string {
  if (/<calcPr[^>]*fullCalcOnLoad="1"/.test(workbookXml)) {
    return workbookXml;
  }
  if (/<calcPr\s*\/>/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\s*\/>/, '<calcPr fullCalcOnLoad="1"/>');
  }
  if (/<calcPr\b/.test(workbookXml)) {
    return workbookXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="1"');
  }
  return workbookXml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>');
}

/** Convert a 1-based column index to a spreadsheet column name (3 -> "C"). */
export function columnName(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new SheetPatchError(`invalid column index ${index}`);
  }
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}
