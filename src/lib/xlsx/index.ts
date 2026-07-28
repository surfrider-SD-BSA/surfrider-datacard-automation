/**
 * Browser-side entry point for producing the filled .xlsx.
 *
 * The zip layer is deliberately thin: all workbook logic lives in `export.ts`,
 * which is pure and independently testable. This file only unzips the
 * template, hands the XML parts over, and zips the result back up.
 */

import { unzipSync, zipSync } from "fflate";
import { fillWorkbookParts, type ExportInput } from "./export";

export type {
  EventMetadata,
  ExportInput,
  ExtractedCard,
  ExtractedValue,
} from "./export";
export { ExportError } from "./export";

/** Parts we read and rewrite as text. Everything else is copied verbatim. */
const TEXT_PARTS = new Set([
  "xl/worksheets/sheet1.xml",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "[Content_Types].xml",
]);

/**
 * Fill the chapter's template and return the finished workbook bytes.
 *
 * @param templateBytes the untouched template .xlsx
 */
export function fillTemplate(
  templateBytes: Uint8Array,
  input: ExportInput,
): Uint8Array {
  const entries = unzipSync(templateBytes);

  const decoder = new TextDecoder();
  const textParts = new Map<string, string>();
  for (const name of Object.keys(entries)) {
    if (TEXT_PARTS.has(name)) {
      textParts.set(name, decoder.decode(entries[name]));
    }
  }

  const filled = fillWorkbookParts(textParts, input);

  const encoder = new TextEncoder();
  const out: Record<string, Uint8Array> = {};
  for (const name of Object.keys(entries)) {
    out[name] = entries[name];
  }
  // Overwrite the parts we changed, and add any part the fill created
  // (the provenance worksheet).
  for (const [name, xml] of filled) {
    out[name] = encoder.encode(xml);
  }

  return zipSync(out, { level: 6 });
}

/** `2025-08-02` + `Ocean Beach` -> `2025-08-02_Ocean-Beach.xlsx`. */
export function suggestFilename(date: string, shoreline: string): string {
  const slug = shoreline
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
  return `${date}_${slug || "Cleanup"}.xlsx`;
}

/** Hand the finished workbook to the browser as a download. */
export function downloadWorkbook(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
