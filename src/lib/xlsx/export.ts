/**
 * Fill the chapter's Excel template from an extracted event.
 *
 * This is the port of the prototype's `scripts/write_spreadsheet.py`, with one
 * structural change: rather than loading the workbook into a spreadsheet
 * library and saving it back, we patch the worksheet XML in place. See
 * `sheet-patch.ts` for why.
 *
 * Everything here is pure: it maps the template's unzipped parts to a new set
 * of parts. Zip handling lives in `index.ts` so this can be tested without it.
 */

import {
  FIRST_DATA_COLUMN,
  HEADER_ROWS,
  LAST_DATA_COLUMN,
  MAX_VOLUNTEERS,
  TAXONOMY,
  itemForRow,
  type HeaderField,
} from "../taxonomy";
import {
  columnName,
  forceFullCalcOnLoad,
  patchSheetXml,
  type CellValue,
} from "./sheet-patch";

const SHEET_PATH = "xl/worksheets/sheet1.xml";
const WORKBOOK_PATH = "xl/workbook.xml";
const PROVENANCE_PATH = "xl/worksheets/sheet2.xml";
const RELS_PATH = "xl/_rels/workbook.xml.rels";
const CONTENT_TYPES_PATH = "[Content_Types].xml";

/** Rows that hold the template's SUM formulas -- column B here is off limits. */
const ITEM_ROWS = new Set(TAXONOMY.map((i) => i.row));

export class ExportError extends Error {}

export interface ExtractedValue {
  /** Template row, i.e. the taxonomy item id. */
  row: number;
  value: number;
  /** Recognizer confidence in [0,1]. Human-entered values are 1. */
  confidence: number;
  /** True when a person accepted or changed the recognized value. */
  corrected: boolean;
}

export interface ExtractedCard {
  /** 1-based position in the stack; decides the spreadsheet column. */
  cardNumber: number;
  /** Source pages in the scanned PDF, for provenance. */
  pageNumbers: number[];
  cardType: "total" | "tally";
  values: ExtractedValue[];
}

/**
 * Optional fields accept `null` as well as `undefined` so a validated
 * `schema.ts` event (which uses `null` for "the volunteer left it blank") can
 * be passed straight through without a lossy adapter.
 */
export interface EventMetadata {
  dataEntryVolunteer?: string | null;
  club?: string | null;
  /** ISO date, e.g. "2025-08-02". */
  date: string;
  shoreline: string;
  /** Null when nobody recorded a head count, which is common. */
  volunteers?: number | null;
  pounds?: number | null;
  durationHours?: number | null;
}

export interface ExportInput {
  event: EventMetadata;
  cards: ExtractedCard[];
  sourcePdfName: string;
  /** Injectable for deterministic tests. */
  generatedAt?: Date;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * ISO date -> the chapter's own format, e.g. "2025-09-06" -> "9.6.25".
 *
 * Taken from a completed datasheet ("9.6.25" in A6). Anything that is not an
 * ISO date is passed through untouched rather than mangled.
 */
export function chapterDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${Number(mo)}.${Number(d)}.${y!.slice(2)}`;
}

/**
 * Build the cell edits for the data sheet.
 *
 * Exported so tests can assert on the edit set -- in particular that column B
 * of an item row is never among the targets.
 */
export function buildCellEdits(input: ExportInput): Map<string, CellValue> {
  const { event, cards } = input;
  const edits = new Map<string, CellValue>();

  const headers: Array<[HeaderField, CellValue | undefined]> = [
    [
      "dataEntryVolunteer",
      event.dataEntryVolunteer
        ? { kind: "text", value: event.dataEntryVolunteer }
        : undefined,
    ],
    ["club", event.club ? { kind: "text", value: event.club } : undefined],
    // The chapter writes dates as "9.6.25", not ISO. Matching their convention
    // keeps completed sheets consistent with the ones already on file.
    ["date", { kind: "text", value: chapterDate(event.date) }],
    ["shoreline", { kind: "text", value: event.shoreline }],
    [
      "volunteers",
      event.volunteers == null ? undefined : { kind: "number", value: event.volunteers },
    ],
    [
      "pounds",
      event.pounds == null ? undefined : { kind: "number", value: event.pounds },
    ],
    [
      "duration",
      event.durationHours == null
        ? undefined
        : { kind: "text", value: `${event.durationHours} hours` },
    ],
  ];

  // Header values go in column A, on the row BELOW their label.
  //
  // Verified against a completed datasheet from the chapter: A1 holds the
  // label "Data Entry Volunteer Name" and A2 the name, A7 "Shoreline" and A8
  // the beach. Column B is not used for headers at all.
  //
  // The prototype's write_spreadsheet.py wrote column B on the label's own row,
  // which put every header value in an empty cell beside its label instead of
  // where the chapter actually reads it.
  for (const [field, value] of headers) {
    if (value === undefined) continue;
    edits.set(`A${HEADER_ROWS[field].valueRow}`, value);
  }

  const seenCardNumbers = new Set<number>();
  for (const card of cards) {
    if (seenCardNumbers.has(card.cardNumber)) {
      throw new ExportError(`duplicate card number ${card.cardNumber}`);
    }
    seenCardNumbers.add(card.cardNumber);

    if (card.cardNumber < 1 || card.cardNumber > MAX_VOLUNTEERS) {
      throw new ExportError(
        `card number ${card.cardNumber} is outside the template's ` +
          `${MAX_VOLUNTEERS} volunteer columns (C..BZ). Split the event across ` +
          `two spreadsheets.`,
      );
    }

    const colIndex = FIRST_DATA_COLUMN + card.cardNumber - 1;
    if (colIndex < FIRST_DATA_COLUMN || colIndex > LAST_DATA_COLUMN) {
      throw new ExportError(`computed column ${colIndex} is out of range`);
    }
    const col = columnName(colIndex);

    for (const v of card.values) {
      if (!itemForRow(v.row)) {
        throw new ExportError(`row ${v.row} is not a taxonomy item row`);
      }
      // Matches the prototype: blanks mean zero and are simply not written,
      // which keeps the sheet visually identical to hand entry.
      if (!Number.isFinite(v.value) || v.value <= 0) continue;
      if (!Number.isInteger(v.value)) {
        throw new ExportError(`row ${v.row}: ${v.value} is not a whole count`);
      }
      edits.set(`${col}${v.row}`, { kind: "number", value: v.value });
    }
  }

  assertNeverWritesFormulaColumn(edits);
  return edits;
}

/**
 * Guard the one mistake that silently corrupts the chapter's spreadsheet:
 * overwriting a column B SUM formula with a literal. The totals would still
 * *look* right on the day and would stop updating forever after.
 */
export function assertNeverWritesFormulaColumn(edits: Map<string, CellValue>): void {
  for (const ref of edits.keys()) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m) throw new ExportError(`malformed cell reference ${ref}`);
    const [, col, rowStr] = m;
    if (col === "B" && ITEM_ROWS.has(Number(rowStr))) {
      throw new ExportError(
        `refusing to write ${ref}: column B holds the SUM formula for that item`,
      );
    }
  }
}

function provenanceSheetXml(input: ExportInput): string {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const rows: string[] = [];
  let r = 1;

  const textRow = (cells: string[]) => {
    const tds = cells
      .map(
        (c, i) =>
          `<c r="${columnName(i + 1)}${r}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(
            c,
          )}</t></is></c>`,
      )
      .join("");
    rows.push(`<row r="${r}">${tds}</row>`);
    r += 1;
  };

  textRow(["Source PDF", input.sourcePdfName]);
  textRow(["Generated", generatedAt]);
  textRow(["Event date", input.event.date]);
  textRow(["Shoreline", input.event.shoreline]);
  textRow(["Cards", String(input.cards.length)]);
  textRow([]);
  textRow([
    "Card",
    "Column",
    "PDF pages",
    "Card type",
    "Item row",
    "Item",
    "Value",
    "Confidence",
    "Source",
  ]);

  for (const card of input.cards) {
    const col = columnName(FIRST_DATA_COLUMN + card.cardNumber - 1);
    for (const v of card.values) {
      if (!Number.isFinite(v.value) || v.value <= 0) continue;
      textRow([
        String(card.cardNumber),
        col,
        card.pageNumbers.join(", "),
        card.cardType,
        String(v.row),
        itemForRow(v.row)?.name ?? "?",
        String(v.value),
        v.confidence.toFixed(3),
        v.corrected ? "human" : "recognized",
      ]);
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rows.join("")}</sheetData>` +
    "</worksheet>"
  );
}

/** Register the provenance worksheet in the workbook, rels, and content types. */
function addProvenanceSheet(
  parts: Map<string, string>,
  input: ExportInput,
): void {
  const relsXml = parts.get(RELS_PATH);
  const workbookXml = parts.get(WORKBOOK_PATH);
  const typesXml = parts.get(CONTENT_TYPES_PATH);
  if (!relsXml || !workbookXml || !typesXml) {
    throw new ExportError("template is missing workbook, rels, or content types");
  }

  // Pick a relationship id that cannot collide with an existing one.
  const used = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  const relId = `rId${Math.max(0, ...used) + 1}`;

  const sheetIds = [...workbookXml.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]));
  const sheetId = Math.max(0, ...sheetIds) + 1;

  parts.set(PROVENANCE_PATH, provenanceSheetXml(input));

  parts.set(
    RELS_PATH,
    relsXml.replace(
      "</Relationships>",
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    ),
  );

  parts.set(
    WORKBOOK_PATH,
    workbookXml.replace(
      "</sheets>",
      `<sheet state="visible" name="Provenance" sheetId="${sheetId}" r:id="${relId}"/></sheets>`,
    ),
  );

  parts.set(
    CONTENT_TYPES_PATH,
    typesXml.replace(
      "</Types>",
      '<Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" PartName="/xl/worksheets/sheet2.xml"/></Types>',
    ),
  );
}

/**
 * Produce the filled workbook parts from the template's parts.
 *
 * `parts` maps zip entry name -> XML text. Entries we do not touch must be
 * carried through byte-for-byte by the caller.
 */
export function fillWorkbookParts(
  parts: Map<string, string>,
  input: ExportInput,
): Map<string, string> {
  const sheetXml = parts.get(SHEET_PATH);
  if (!sheetXml) {
    throw new ExportError(`template is missing ${SHEET_PATH}`);
  }

  const out = new Map(parts);
  const edits = buildCellEdits(input);

  out.set(SHEET_PATH, patchSheetXml(sheetXml, edits));

  const workbookXml = out.get(WORKBOOK_PATH);
  if (workbookXml) {
    out.set(WORKBOOK_PATH, forceFullCalcOnLoad(workbookXml));
  }

  addProvenanceSheet(out, input);
  return out;
}
