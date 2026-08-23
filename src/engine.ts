/**
 * The reading pipeline, driven from Swift instead of from a page.
 *
 * WHY THIS FILE EXISTS. The iOS app is SwiftUI, and the reading is not
 * reimplemented in Swift -- every figure in HANDOFF.md was measured against the
 * TypeScript in `src/lib/`, and a second implementation would be a second set
 * of numbers to keep in step with. So the phone runs this: the same modules the
 * desktop tool runs, in an off-screen WKWebView, with the interface stripped
 * off. `main.ts` is the browser's front end and this is the phone's back end;
 * neither owns an algorithm.
 *
 * THE PROTOCOL. Swift calls `window.tally.dispatch(json)` and gets everything
 * back through `webkit.messageHandlers.tally`, because the return value of
 * `evaluateJavaScript` cannot carry a promise. Every message is
 * `{ id, ok, result }` or `{ id, ok: false, error }`, except progress, which is
 * `{ event: "progress", ... }` and carries no id.
 *
 * WHAT DOES NOT CROSS THE BRIDGE. Page images. A letter page at 200 DPI is
 * 3.7MB of grayscale and a 116-page scan is 430MB of them; they are cut into
 * row crops here and dropped, exactly as `processFile` does in `main.ts`, and
 * Swift asks for one cell picture at a time by card and row. The PDF comes the
 * other way for the same reason -- Swift writes it to the inbox and sends a
 * URL, rather than a base64 string the size of the scan.
 */

import { loadCellMap, type CellMap } from "./lib/cells";
import { decodeModel, type DigitModel } from "./lib/digits";
import {
  assembleCard,
  cellsForSide,
  type ExtractedCard,
  type ExtractedCell,
  type PageCells,
  viewRect,
} from "./lib/extract";
import { cropToCanvas, toGray, type GrayImage } from "./lib/image";
import { isAutoAccepted, prefillFor } from "./lib/prefill";
import { rasterizePdf } from "./lib/pdf";
import {
  pairIntoCards,
  referenceTargets,
  registerAgainstBestSide,
  MIN_BANNER_OVERLAP,
  type PairingProblem,
} from "./lib/register";
import { fillTemplate, suggestFilename } from "./lib/xlsx";
import type { ExtractedCard as ExportCard } from "./lib/xlsx";

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

interface Bridge {
  postMessage(body: string): void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { tally?: Bridge } };
    tally: { dispatch(json: string): void };
  }
}

function post(message: unknown): void {
  const bridge = window.webkit?.messageHandlers?.tally;
  const body = JSON.stringify(message);
  // Without a host the engine still runs -- `npm run dev` and engine.html in a
  // desktop browser is how this file is debugged, and the console is the only
  // place the answers can go.
  if (bridge) bridge.postMessage(body);
  else console.log("[engine]", body);
}

type Stage = "opening" | "reading" | "pairing" | "done";

function progress(stage: Stage, fraction: number, detail: Record<string, unknown> = {}): void {
  post({ event: "progress", stage, fraction, ...detail });
}

// ---------------------------------------------------------------------------
// Reference assets -- identical to main.ts, and deliberately so
// ---------------------------------------------------------------------------

async function loadReferenceImage(url: string): Promise<GrayImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  const bitmap = await createImageBitmap(await res.blob());

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return toGray(data, canvas.width, canvas.height);
}

/**
 * The handwriting model, or null if it will not load.
 *
 * Null is a supported state and not an error path: the tally counter needs
 * nothing fetched, and a scan is still worth reviewing without the digits. A
 * 3.4MB read failing on a phone at a beach is a thing that will happen, and
 * when it does the app should quietly do less rather than refuse to open.
 */
async function loadDigitModel(): Promise<DigitModel | null> {
  try {
    const res = await fetch("reference/digit-model.json");
    if (!res.ok) return null;
    return decodeModel(await res.json());
  } catch {
    return null;
  }
}

let referencesPromise: Promise<{
  images: { front: GrayImage; back: GrayImage };
  maps: { front: CellMap; back: CellMap };
  digits: DigitModel | null;
}> | null = null;

function loadReferences() {
  referencesPromise ??= (async () => {
    const [front, back, frontMap, backMap, digits] = await Promise.all([
      loadReferenceImage("reference/blank-front.png"),
      loadReferenceImage("reference/blank-back.png"),
      loadCellMap("front", async (u) => (await fetch(u)).json()),
      loadCellMap("back", async (u) => (await fetch(u)).json()),
      loadDigitModel(),
    ]);
    return { images: { front, back }, maps: { front: frontMap, back: backMap }, digits };
  })();
  return referencesPromise;
}

// ---------------------------------------------------------------------------
// What the engine holds between calls
// ---------------------------------------------------------------------------

const state = {
  fileName: "",
  fileSize: 0,
  cards: [] as ExtractedCard[],
  problems: [] as PairingProblem[],
};

/** Card 1 is column C, and the mapping is never inferred from anything else. */
function columnLetter(cardNumber: number): string {
  let n = cardNumber + 2;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function findCell(cardNumber: number, row: number): ExtractedCell | undefined {
  return state.cards.find((c) => c.cardNumber === cardNumber)?.cells.find((c) => c.row === row);
}

/**
 * Seed the date and beach from the filename, where it follows the chapter's
 * convention. Always shown for confirmation, never used silently.
 */
function seedFromFilename(name: string): { date: string; shoreline: string } | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})[_-](.+?)(?:[_-]CH\d+)?\.pdf$/i.exec(name);
  if (!m) return null;
  const [, mm, dd, yy, place] = m;
  const year = yy!.length === 2 ? `20${yy}` : yy!;
  return {
    date: `${year}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`,
    shoreline: place!.replace(/[-_]+/g, " ").trim(),
  };
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

interface ProcessParams {
  /** A `cleanup://app/__inbox/…` URL Swift has just made readable. */
  url: string;
  fileName: string;
  fileSize: number;
}

/**
 * Read a scan, all the way to the cells worth showing someone.
 *
 * One page at a time, through to its crops, and then dropped -- the shape is
 * `processFile` in `main.ts` and the reason is the same: the obvious version
 * holds two full-resolution copies of the whole scan and measured 840MB of
 * browser heap on a 116-page file. That mattered on a laptop. On a phone it
 * decides whether the app survives the scan at all.
 */
async function process(params: ProcessParams) {
  progress("opening", 0);
  const refs = await loadReferences();
  const targets = referenceTargets(refs.images, refs.maps);

  const res = await fetch(params.url);
  if (!res.ok) throw new Error(`could not read the scan (${res.status})`);
  const file = new File([await res.blob()], params.fileName, { type: "application/pdf" });

  state.fileName = params.fileName;
  state.fileSize = params.fileSize;

  const pages: PageCells[] = [];
  const pageCount = await rasterizePdf(file, ({ pageNumber, image, total }) => {
    const registered = registerAgainstBestSide(image, targets, pageNumber);
    pages.push({
      pageNumber,
      side: registered.side,
      trusted: registered.trusted,
      bannerOverlap: registered.bannerOverlap,
      cells: registered.trusted
        ? cellsForSide(registered.image, pageNumber, refs.maps[registered.side], registered.side, refs.digits)
        : [],
    });
    progress("reading", (pageNumber / total) * 0.98, { pageNumber, total });
  });

  if (pageCount === 0) throw new Error("That PDF has no pages.");

  progress("pairing", 0.99);
  const { cards, problems } = pairIntoCards(pages);
  state.cards = cards.map(assembleCard);
  state.problems = problems;
  progress("done", 1);

  return {
    fileName: state.fileName,
    fileSize: state.fileSize,
    pageCount,
    seeded: seedFromFilename(params.fileName),
    /**
     * Every page, whether it was trusted or not, with the figure the refusal
     * was made on. Screen 5 shows the reviewer the real overlap rather than a
     * generic failure, which is the difference between "it did not work" and
     * "retake it in flatter light".
     */
    pages: pages.map((p) => ({
      pageNumber: p.pageNumber,
      side: p.side,
      trusted: p.trusted,
      bannerOverlap: p.bannerOverlap,
    })),
    minBannerOverlap: MIN_BANNER_OVERLAP,
    problems: state.problems,
    cards: state.cards.map((card) => ({
      cardNumber: card.cardNumber,
      column: columnLetter(card.cardNumber),
      missingSides: card.missingSides,
      cells: card.cells.map((cell) => {
        const prefill = prefillFor(cell);
        return {
          row: cell.row,
          itemName: cell.itemName,
          section: cell.section,
          side: cell.side,
          hasValue: cell.hasValue,
          tallyOnly: cell.tallyOnly,
          pageNumber: cell.pageNumber,
          // Null only where both readers declined outright; the gate is 0 and
          // fills everything either of them offers. See lib/prefill.ts.
          prefill: prefill && {
            value: prefill.value,
            confidence: prefill.confidence,
            source: prefill.source,
            // Whether this cell is taken as read and kept off the review list.
            // Decided here rather than by comparing confidences on the far
            // side, because which cells a person is shown must not depend on
            // which front end they opened -- the desktop tool and the phone
            // read the threshold from the same constant.
            autoAccepted: isAutoAccepted(prefill),
          },
        };
      }),
    })),
  };
}

type CropKind = "total" | "marks" | "context";

/**
 * One cell's picture, as a PNG.
 *
 * The enlargements are the desktop tool's, unchanged: 2.4x on the TOTAL box,
 * which is what `renderCell` shows and what the caption on screen 6 claims;
 * 2.0x and 30% wider for a tally-only row, whose number is not there to read;
 * 1.0x for the marks themselves, because counting them is easier at the size
 * they were drawn.
 */
function crop(params: { cardNumber: number; row: number; kind: CropKind }) {
  const cell = findCell(params.cardNumber, params.row);
  if (!cell) throw new Error(`no cell for card ${params.cardNumber} row ${params.row}`);

  let canvas: HTMLCanvasElement;
  switch (params.kind) {
    case "marks":
      canvas = cropToCanvas(
        cell.image,
        cell.tallyRect.x, cell.tallyRect.y, cell.tallyRect.width, cell.tallyRect.height, 1.0,
      );
      break;
    case "context":
      // 2x. The row is shown as a 34pt strip beneath the box, scrolled
      // sideways rather than squeezed to the screen's width, so it needs
      // enough pixels to stand being read at that height and no more --
      // every one of them crosses the bridge as base64.
      canvas = cropToCanvas(
        cell.image,
        cell.contextRect.x, cell.contextRect.y, cell.contextRect.width, cell.contextRect.height, 2.0,
      );
      break;
    default:
      {
        // `viewRect`, not `cell.rect`: the box plus the room a hand actually
        // uses. Cropping to the printed box cut the foot off most numbers --
        // see the note beside VIEW_MARGIN in lib/extract.ts.
        const view = viewRect(cell, cell.tallyOnly);
        canvas = cropToCanvas(
          cell.image, view.x, view.y, view.width, view.height, cell.tallyOnly ? 2.0 : 2.4,
        );
      }
  }

  return {
    width: canvas.width,
    height: canvas.height,
    // Base64 rather than a data URL: Swift wants bytes, and the `data:image/png;base64,`
    // prefix would only be stripped again on the other side.
    png: canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""),
  };
}

interface ExportParams {
  event: {
    date: string;
    shoreline: string;
    volunteers: number | null;
    pounds: number | null;
    durationHours: number | null;
    dataEntryVolunteer: string | null;
    club: string | null;
  };
  /** cardNumber -> [row, value][]. The typed values, and only those. */
  values: [number, [number, number][]][];
  /**
   * The values still standing as the tool put them, as [card, row] pairs.
   *
   * Swift owns this rather than the engine, because it is a record of what a
   * person has touched and the engine never sees a keystroke. A box that came
   * pre-filled and was then edited is not in here, and is exported as human.
   */
  prefilled: [number, number][];
  confidences: [number, number, number][];
}

async function exportWorkbook(params: ExportParams) {
  const res = await fetch("template/data-entry-template.xlsx");
  if (!res.ok) throw new Error("could not load the chapter's Excel template");
  const template = new Uint8Array(await res.arrayBuffer());

  const untouched = new Set(params.prefilled.map(([card, row]) => `${card}:${row}`));
  const confidence = new Map(params.confidences.map(([card, row, c]) => [`${card}:${row}`, c]));

  const cards: ExportCard[] = [];
  for (const [cardNumber, rows] of params.values) {
    if (rows.length === 0) continue;
    const source = state.cards.find((c) => c.cardNumber === cardNumber);
    cards.push({
      cardNumber,
      pageNumbers: [...new Set(source?.cells.map((c) => c.pageNumber) ?? [])].sort((a, b) => a - b),
      cardType: source?.cells.some((c) => c.tallyOnly) ? "tally" : "total",
      values: rows.map(([row, value]) => {
        // A machine reading nobody touched carries the confidence it was
        // pre-filled at and is recorded as recognized; a value a person typed
        // or corrected is certain and is recorded as human. The chapter's audit
        // column is the whole reason the two are kept apart.
        const key = `${cardNumber}:${row}`;
        const machine = untouched.has(key);
        return { row, value, confidence: machine ? (confidence.get(key) ?? 1) : 1, corrected: !machine };
      }),
    });
  }

  const bytes = fillTemplate(template, {
    sourcePdfName: state.fileName,
    event: params.event,
    cards,
  });

  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }

  return {
    filename: suggestFilename(params.event.date, params.event.shoreline),
    xlsx: btoa(binary),
  };
}

/** Let go of a scan's crops. Called when the app leaves an event. */
function reset() {
  state.cards = [];
  state.problems = [];
  state.fileName = "";
  state.fileSize = 0;
  return { ok: true };
}

const METHODS: Record<string, (params: any) => unknown | Promise<unknown>> = {
  open: async () => {
    await loadReferences();
    return { ready: true };
  },
  process,
  crop,
  export: exportWorkbook,
  reset,
};

// ---------------------------------------------------------------------------

window.tally = {
  dispatch(json: string) {
    let id = 0;
    void (async () => {
      try {
        const req = JSON.parse(json) as { id: number; method: string; params?: unknown };
        id = req.id;
        const method = METHODS[req.method];
        if (!method) throw new Error(`no such method: ${req.method}`);
        post({ id, ok: true, result: await method(req.params ?? {}) });
      } catch (err) {
        post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  },
};

// Say so as soon as the modules are parsed. Swift waits for this before it
// sends anything, so a message that arrives first would be dropped.
post({ event: "loaded" });
