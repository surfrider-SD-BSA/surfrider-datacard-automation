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
 * Force Excel to recalculate on open.
 *
 * Column B holds `SUM(C18:BZ18)` with a cached `<v>0</v>` from when the blank
 * template was saved. Without this flag some readers show the stale 0 next to
 * freshly written volunteer columns.
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
