/**
 * Beach cleanup data cards -> the chapter's Excel spreadsheet.
 *
 * The tool locates every cell a volunteer wrote in and shows a cropped picture
 * of each one beside a box to type it into. The human reads ~10 crops per card
 * instead of hunting 83 rows on paper.
 *
 * Two readers offer a first guess at what the box says. `tally.ts` counts
 * marks geometrically and is good; `digits.ts` recognises handwriting and is
 * not -- 70% of digits right, 86% where it is most confident. Both are on, and
 * the asymmetry is the design: deciding *whether* a box has writing is easy and
 * reliable, reading *what* it says is neither, and a confidently wrong number
 * is worse than no number because it invites agreement.
 *
 * What made that survivable was that nothing here was presented as an answer:
 * every filled box was tagged with which reader filled it, sat beside a picture
 * of the handwriting, and was exported as machine-read rather than
 * human-entered so the chapter's own audit column could tell them apart.
 *
 * THAT IS NO LONGER TRUE OF EVERY CELL. On the chapter owner's instruction, a
 * reading of `AUTO_ACCEPT` confidence or better is taken as the answer and its
 * cell is never shown to anyone -- around 60% of the cells on a real scan, and
 * almost all of them the digit reader working alone. Those values still carry
 * their confidence into the spreadsheet as machine-read, so the audit column
 * remains able to find them afterwards, but nobody sees the handwriting first.
 * Both numbers, and what the second one costs, are in `lib/prefill.ts`, which
 * is the one place either of them lives.
 */

import { loadCellMap, type CellMap } from "./lib/cells";
import type { Reading } from "./lib/reading";
import { isAutoAccepted, prefillFor, prefillTag } from "./lib/prefill";
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
import { rasterizePdf } from "./lib/pdf";
import {
  pairIntoCards,
  referenceTargets,
  registerAgainstBestSide,
  type PairingProblem,
} from "./lib/register";
import {
  countValues,
  createDraftStore,
  describeAge,
  draftMatches,
  type Draft,
  type DraftFingerprint,
} from "./lib/draft";
import { downloadWorkbook, fillTemplate, suggestFilename } from "./lib/xlsx";
import type { ExtractedCard as ExportCard } from "./lib/xlsx";

const app = document.getElementById("app")!;
const statusEl = document.getElementById("status")!;

interface EventForm {
  date: string;
  shoreline: string;
  volunteers: string;
  pounds: string;
  durationHours: string;
  dataEntryVolunteer: string;
  club: string;
}

const drafts = createDraftStore();

const state = {
  fileName: "",
  fileSize: 0,
  cards: [] as ExtractedCard[],
  problems: [] as PairingProblem[],
  /** cardNumber -> taxonomy row -> typed value */
  values: new Map<number, Map<number, number>>(),
  /**
   * The values that were put there by the tool rather than by a person, and
   * that nobody has touched since.
   *
   * Kept apart from `values` for one reason: the spreadsheet records, per
   * value, whether a human entered it. A machine reading a reviewer scrolled
   * past is not the same evidence as a number somebody read off the picture,
   * and the export says which is which. Editing a box takes its cell out of
   * this set, because at that point a person has looked.
   */
  prefilled: new Map<number, Map<number, Reading>>(),
  event: {
    date: "",
    shoreline: "",
    volunteers: "",
    pounds: "",
    durationHours: "2",
    dataEntryVolunteer: "",
    club: "Surfrider San Diego (CH54)",
  } as EventForm,
};

function setStatus(text: string) {
  statusEl.textContent = text;
}

// ---------------------------------------------------------------------------
// Reference assets
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

let referencesPromise: Promise<{
  images: { front: GrayImage; back: GrayImage };
  maps: { front: CellMap; back: CellMap };
  digits: DigitModel | null;
}> | null = null;

/**
 * The handwriting model, or null if it will not load.
 *
 * Null is a supported state and not an error path: the tally counter is the
 * older and better-measured reader, it needs nothing fetched, and a scan is
 * still worth reviewing without the digits. A 3.4MB fetch failing on a phone
 * at a beach is a thing that will happen, and when it does the tool should
 * quietly do less rather than refuse to open.
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
// Processing
// ---------------------------------------------------------------------------

async function processFile(file: File) {
  state.fileName = file.name;
  state.fileSize = file.size;
  renderProgress("Reading the PDF…", 0);

  try {
    const refs = await loadReferences();

    const targets = referenceTargets(refs.images, refs.maps);

    // One page at a time, all the way through to its crops.
    //
    // The obvious shape -- rasterize every page, then align every page, then
    // crop -- holds two full-resolution copies of the whole scan at once, and
    // measured 840MB of browser heap on a 116-page file. Nothing needs two
    // pages at the same time, so nothing keeps two: each page is rendered,
    // aligned, cut into cells, and dropped before the next one is read.
    const pages: PageCells[] = [];
    const pageCount = await rasterizePdf(file, ({ pageNumber, image, total }) => {
      const registered = registerAgainstBestSide(image, targets, pageNumber);
      pages.push({
        pageNumber,
        side: registered.side,
        trusted: registered.trusted,
        bannerOverlap: registered.bannerOverlap,
        cells: registered.trusted
          ? cellsForSide(
              registered.image,
              pageNumber,
              refs.maps[registered.side],
              registered.side,
              refs.digits,
            )
          : [],
      });
      renderProgress(`Reading page ${pageNumber} of ${total}…`, (pageNumber / total) * 0.98);
    });

    if (pageCount === 0) throw new Error("That PDF has no pages.");

    const { cards, problems } = pairIntoCards(pages);

    state.cards = cards.map(assembleCard);
    state.problems = problems;
    state.values = new Map();
    state.prefilled = new Map();

    // Seed the date and beach from the filename when it follows the chapter's
    // convention, e.g. "9.27.25_Pacific-Beach_CH54.pdf". It saves typing and is
    // always shown for confirmation rather than used silently.
    seedEventFromFilename(file.name);

    // Every reading goes into `state` here rather than as a side effect of
    // drawing a row, because most of the rows are no longer drawn. An
    // auto-accepted cell has no box on screen and still has to reach the
    // spreadsheet, which it cannot do if putting it there is something the
    // renderer does.
    seedPrefills();

    renderProgress("Done", 1);
    renderReview();
    offerDraft();
  } catch (err) {
    renderError(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// What the tool filled in, and what it kept to itself
// ---------------------------------------------------------------------------

/**
 * Put every reading the tool has into the values it will export.
 *
 * This used to happen inside `renderCell`, one row at a time, which was fine
 * while every cell had a row. It does not survive auto-accept: the cells with
 * the strongest readings are exactly the ones with nothing on screen, so a
 * value that only exists because something was drawn would be the value most
 * likely to be missing.
 */
function seedPrefills() {
  for (const card of state.cards) {
    for (const cell of card.cells) {
      const prefill = prefillFor(cell);
      if (!prefill) continue;
      const values = state.values.get(card.cardNumber) ?? new Map<number, number>();
      values.set(cell.row, prefill.value);
      state.values.set(card.cardNumber, values);
      const marks = state.prefilled.get(card.cardNumber) ?? new Map<number, Reading>();
      marks.set(cell.row, prefill);
      state.prefilled.set(card.cardNumber, marks);
    }
  }
}

/**
 * The cells a person is asked to look at.
 *
 * Everything the tool did not accept on its own. A cell above `AUTO_ACCEPT` is
 * not collapsed or greyed or moved to the bottom of the list; it is not on the
 * list, and there is nothing in the interface that will show it. That is the
 * instruction this was built to, and it is worth being plain about which cells
 * it applies to -- see `AUTO_ACCEPT` in lib/prefill.ts for the measurement.
 */
function cellsToCheck(card: ExtractedCard): ExtractedCell[] {
  return card.cells.filter((cell) => !isAutoAccepted(prefillFor(cell)));
}

/** How many cells were taken as read across the whole scan. */
function autoAcceptedCount(): number {
  return state.cards.reduce((n, c) => n + (c.cells.length - cellsToCheck(c).length), 0);
}

// ---------------------------------------------------------------------------
// Keeping what has been typed
// ---------------------------------------------------------------------------

/**
 * Make the boxes on screen say exactly what we think was typed, and nothing else.
 *
 * Browsers put values back into form fields on their own -- Chrome restores
 * form state across a reload, matching fields by position. This tool creates
 * its inputs from script, several hundred of them, and the item each one stands
 * for depends on which PDF was dropped, so a restored value lands against
 * whatever item happens to sit at that index. It has been seen: three boxes
 * came back filled after a refresh, against items nobody had typed for.
 * `autocomplete="off"` does not prevent it; it governs autofill suggestions,
 * not session restore.
 *
 * A restored value also fires `input`, so it writes itself into `state.values`
 * and would be exported as though a person had read it off the card. That is
 * precisely the failure this whole tool is built to avoid.
 *
 * So the typed values are treated as the only truth: after the list renders,
 * and again whenever the page comes back from the browser's cache, every box is
 * set from `state.values` and anything the browser put in is thrown away. The
 * deferral matters -- the restore happens after the elements are inserted, so
 * doing this synchronously would run before there was anything to undo.
 */
function assertTypedValues() {
  const intended = new Map([...state.values].map(([card, rows]) => [card, new Map(rows)]));

  const apply = () => {
    state.values = intended;
    for (const input of document.querySelectorAll<HTMLInputElement>("input[data-card][data-row]")) {
      const card = Number(input.dataset.card);
      const row = Number(input.dataset.row);
      const value = intended.get(card)?.get(row);
      const want = value === undefined ? "" : String(value);
      if (input.value !== want) input.value = want;
    }
    updateGate();
  };

  apply();
  requestAnimationFrame(apply);
}

window.addEventListener("pageshow", (e) => {
  if (e.persisted) assertTypedValues();
});

function fingerprint(): DraftFingerprint {
  return {
    fileName: state.fileName,
    fileSize: state.fileSize,
    cardCount: state.cards.length,
    cellCount: state.cards.reduce((n, c) => n + c.cells.length, 0),
  };
}

/** Machine readings the reviewer has not touched. */
function prefilledCount(): number {
  return [...state.prefilled.values()].reduce((n, m) => n + m.size, 0);
}

function typedCount(): number {
  return [...state.values.values()].reduce((n, m) => n + m.size, 0);
}

let saveTimer: number | undefined;

/**
 * Write the draft, at most a few times a second.
 *
 * Debounced because this runs on every keystroke in every one of several
 * hundred boxes, and serializing the lot on each one would be felt while
 * typing. The delay is short enough that anything worth losing is a keystroke,
 * and `flushDraft` closes the gap when the page is going away.
 */
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushDraft, 400);
}

function flushDraft() {
  window.clearTimeout(saveTimer);
  if (state.cards.length === 0) return;
  drafts.save({
    ...fingerprint(),
    savedAt: Date.now(),
    event: { ...state.event },
    values: [...state.values].map(([card, rows]) => [card, [...rows]]),
  });
}

/**
 * Offer a draft for this file, if there is one. Never applies it unasked.
 */
function offerDraft() {
  const draft = drafts.load();
  if (!draft || !draftMatches(draft, fingerprint())) return;
  const values = countValues(draft);
  if (values === 0) return;

  const banner = document.createElement("div");
  banner.className = "notice warn";
  banner.innerHTML = `
    <strong>Work saved on this computer ${escapeHtml(describeAge(draft.savedAt))}.</strong>
    ${values} value${values === 1 ? "" : "s"} were typed for this file. Nothing has
    been put in the boxes below unless you ask for it.
    <div class="actions" style="margin-top:10px">
      <button id="draft-restore">Put them back</button>
      <button class="secondary" id="draft-discard">Start fresh</button>
    </div>`;
  app.prepend(banner);

  document.getElementById("draft-restore")!.addEventListener("click", () => {
    restoreDraft(draft);
    banner.remove();
  });
  document.getElementById("draft-discard")!.addEventListener("click", () => {
    drafts.clear();
    banner.remove();
  });
}

function restoreDraft(draft: Draft) {
  state.values = new Map(draft.values.map(([card, rows]) => [card, new Map(rows)]));
  // A restored draft is a person's work. Nothing in it is claimed as a machine
  // reading, even where the number happens to match what the tool would have
  // counted -- the reviewer saw these boxes and kept them.
  state.prefilled = new Map();
  // With one exception, which is the whole point of auto-accept: the reviewer
  // did NOT see the cells the tool took as read, so a draft cannot turn one of
  // them into human-entered evidence by having been saved. Only where the
  // stored value still matches what the tool read -- a draft from before this
  // setting existed may hold a number a person really did type into a box that
  // is no longer shown.
  remarkAutoAccepted();
  for (const key of Object.keys(state.event) as (keyof EventForm)[]) {
    const saved = draft.event[key];
    if (typeof saved === "string") state.event[key] = saved;
  }
  renderReview();
  setStatus(`${state.fileName} — ${countValues(draft)} values restored.`);
}

/**
 * Put the machine-reading mark back on the cells nobody was shown.
 *
 * `state.prefilled` is what the export uses to tell a number a person read off
 * a picture from one the tool read off a scan. Restoring a draft clears it, on
 * the grounds that a saved value is a person's work -- true of every cell that
 * was on the review list, and false by construction of every cell that was not.
 */
function remarkAutoAccepted() {
  for (const card of state.cards) {
    for (const cell of card.cells) {
      const prefill = prefillFor(cell);
      if (!isAutoAccepted(prefill) || !prefill) continue;
      if (state.values.get(card.cardNumber)?.get(cell.row) !== prefill.value) continue;
      const marks = state.prefilled.get(card.cardNumber) ?? new Map<number, Reading>();
      marks.set(cell.row, prefill);
      state.prefilled.set(card.cardNumber, marks);
    }
  }
}

/**
 * A last chance before the tab goes.
 *
 * The draft makes this recoverable rather than fatal, but a reviewer who
 * fat-fingers Cmd-W two hours in should be asked first. Browsers ignore the
 * message and show their own wording; returning a value is what triggers it.
 */
window.addEventListener("beforeunload", (e) => {
  if (typedCount() === 0) return;
  flushDraft();
  e.preventDefault();
  e.returnValue = "";
});

// ---------------------------------------------------------------------------

function seedEventFromFilename(name: string) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})[_-](.+?)(?:[_-]CH\d+)?\.pdf$/i.exec(name);
  if (!m) return;

  const [, mm, dd, yy, place] = m;
  const year = yy!.length === 2 ? `20${yy}` : yy!;
  state.event.date = `${year}-${mm!.padStart(2, "0")}-${dd!.padStart(2, "0")}`;
  state.event.shoreline = place!.replace(/[-_]+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function renderUpload() {
  app.innerHTML = `
    <div id="drop">
      <strong>Drop a scanned PDF here</strong>
      <span class="hint">or click to choose a file</span>
      <input type="file" accept="application/pdf" hidden />
    </div>
    <p class="hint">
      One PDF per cleanup event, scanned front-and-back in card order.
    </p>`;

  const drop = document.getElementById("drop")!;
  const input = drop.querySelector("input")!;

  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files?.[0]) void processFile(input.files[0]);
  });

  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    const file = e.dataTransfer?.files?.[0];
    if (file) void processFile(file);
  });
}

function renderProgress(message: string, fraction: number) {
  app.innerHTML = `
    <div class="panel">
      <h2>${escapeHtml(state.fileName)}</h2>
      <div class="bar"><div style="width:${Math.round(fraction * 100)}%"></div></div>
      <p class="hint">${escapeHtml(message)}</p>
    </div>`;
  setStatus("Working — the file stays on this computer.");
}

function renderError(message: string) {
  app.innerHTML = `
    <div class="notice bad"><strong>That didn't work.</strong><br>${escapeHtml(message)}</div>
    <button class="secondary" id="again">Try another file</button>`;
  document.getElementById("again")!.addEventListener("click", renderUpload);
  setStatus("");
}

function renderReview() {
  const cardsWithCells = state.cards.filter((c) => cellsToCheck(c).length > 0);
  const totalCells = state.cards.reduce((n, c) => n + c.cells.length, 0);
  const accepted = autoAcceptedCount();
  const toCheck = totalCells - accepted;

  app.innerHTML = `
    ${renderProblems()}
    <div class="panel">
      <h2>Event details</h2>
      <p class="hint">
        These usually appear only on the leader's card, so they are typed in
        once here. Date, beach and volunteer count are required.
      </p>
      <div class="grid-form" style="margin-top:14px">
        ${field("date", "Date", "date")}
        ${field("shoreline", "Beach", "text")}
        ${field("volunteers", "Volunteers", "number", true)}
        ${field("pounds", "Pounds of trash", "number", true)}
        ${field("durationHours", "Duration (hours)", "number", true)}
        ${field("dataEntryVolunteer", "Your name", "text", true)}
        ${field("club", "Club & contact", "text", true)}
      </div>
    </div>

    <div class="panel">
      <h2>Check the numbers</h2>
      <p class="hint">
        ${state.cards.length} cards, ${totalCells} cells with something written.
        ${accepted > 0
          ? `${accepted} of them were read confidently and have been filled in
             and taken as read; they are not listed here. ${toCheck} left to
             check — type what you see in each picture, Tab moves to the next
             box.`
          : `Type what you see in each picture — Tab moves to the next box.`}
      </p>
    </div>

    <div id="cards">
      ${cardsWithCells.length === 0
        ? accepted > 0
          ? `<div class="panel empty">Nothing left to check — all ${accepted} cells the tool found were read confidently enough to be taken as read. Download the spreadsheet below.</div>`
          : `<div class="panel empty">No written-in cells were found. That usually means the pages did not align — check the warnings above.</div>`
        : ""}
    </div>

    <div class="sticky">
      <div class="actions">
        <button id="export">Download spreadsheet</button>
        <button class="secondary" id="restart">Start over</button>
        <span class="hint" id="gate"></span>
      </div>
    </div>`;

  const container = document.getElementById("cards")!;
  for (const card of cardsWithCells) container.appendChild(renderCard(card));

  for (const key of Object.keys(state.event) as (keyof EventForm)[]) {
    const el = document.getElementById(`f-${key}`) as HTMLInputElement | null;
    el?.addEventListener("input", () => {
      state.event[key] = el.value;
      updateGate();
      scheduleSave();
    });
  }

  document.getElementById("export")!.addEventListener("click", () => void doExport());
  document.getElementById("restart")!.addEventListener("click", () => {
    if (typedCount() > 0 && !confirm("Discard the numbers typed so far and start over?")) return;
    drafts.clear();
    state.cards = [];
    state.values = new Map();
    state.prefilled = new Map();
    renderUpload();
  });

  assertTypedValues();
  updateGate();
  setStatus(
    `${state.fileName} — nothing has been uploaded anywhere.` +
      // If the browser will not store anything, say so rather than letting
      // someone type for an hour believing it is being kept.
      (drafts.available ? "" : " This browser will not save your work — do not close the tab."),
  );
}

function field(key: keyof EventForm, label: string, type: string, optional = false) {
  return `
    <div>
      <label for="f-${key}">${label}${optional ? ' <span class="opt">(optional)</span>' : ""}</label>
      <input id="f-${key}" type="${type}" value="${escapeHtml(state.event[key])}" />
    </div>`;
}

function renderProblems() {
  if (state.problems.length === 0) return "";
  const items = state.problems.map((p) => `<li>${escapeHtml(p.message)}</li>`).join("");
  return `
    <div class="notice warn">
      <strong>${state.problems.length} page problem${state.problems.length === 1 ? "" : "s"} to look at.</strong>
      Values below may be on the wrong card. Worth resolving before exporting.
      <ul>${items}</ul>
    </div>`;
}

function renderCard(card: ExtractedCard): HTMLElement {
  const el = document.createElement("div");
  el.className = "panel";

  // The header counts what is on the list, not what is on the card. A card
  // saying "12 numbers" above three rows reads as a bug, and the missing nine
  // are the ones the reviewer is least able to account for.
  const shown = cellsToCheck(card);
  const accepted = card.cells.length - shown.length;
  const tallies = shown.filter((c) => c.tallyOnly).length;

  const head = document.createElement("div");
  head.className = "card-head";
  head.innerHTML = `
    <h3>Card ${card.cardNumber} &rarr; column ${columnLetter(card.cardNumber)}</h3>
    <span class="meta">
      ${shown.length} to check${tallies ? `, ${tallies} tally-only` : ""}
      ${accepted ? ` &middot; ${accepted} filled in and taken as read` : ""}
      ${card.missingSides.length ? ` &middot; ${card.missingSides.join(", ")} page missing` : ""}
    </span>`;
  el.appendChild(head);

  const list = document.createElement("div");
  list.className = "cells";
  for (const cell of shown) list.appendChild(renderCell(card.cardNumber, cell));
  el.appendChild(list);

  return el;
}

function renderCell(cardNumber: number, cell: ExtractedCell): HTMLElement {
  const row = document.createElement("div");
  row.className = "cell" + (cell.tallyOnly ? " tally-only" : "");

  const left = document.createElement("div");
  const label = document.createElement("div");
  label.className = "label";
  label.innerHTML =
    `${escapeHtml(cell.itemName)} &middot; ${escapeHtml(cell.section)}` +
    (cell.tallyOnly ? ` &middot; <span class="tag">tally marks, no total</span>` : "");
  left.appendChild(label);

  // Show the TOTAL box itself, enlarged.
  //
  // The first build cropped the whole row, label included. At that width the
  // handwritten number was a few pixels across the far right of a very wide
  // strip -- unreadable, and the label was already printed above it as text.
  // The number is the only thing being read here, so it gets the space.
  //
  // The rectangle is `viewRect` and not the box itself. Cropping to the printed
  // box cut the foot off most handwritten numbers -- the reviewer was being
  // shown part of a digit and asked to confirm it. See VIEW_MARGIN in
  // lib/extract.ts; the paper it shows was already in the crop.
  const view = viewRect(cell, cell.tallyOnly);
  const shot = cropToCanvas(
    cell.image,
    view.x,
    view.y,
    view.width,
    view.height,
    cell.tallyOnly ? 2.0 : 2.4,
  );
  shot.className = "shot";
  left.appendChild(shot);

  // Tally-only rows have no number to read, so the marks are shown too --
  // that is what the reviewer has to count.
  if (cell.tallyOnly) {
    const marks = cropToCanvas(
      cell.image,
      cell.tallyRect.x,
      cell.tallyRect.y,
      cell.tallyRect.width,
      cell.tallyRect.height,
      1.0,
    );
    marks.className = "marks";
    left.appendChild(marks);
  }

  row.appendChild(left);

  // Pre-fill, where the tool can read the cell well enough to be worth it.
  //
  // A pre-filled box is a claim, and the reviewer is looking at the picture
  // beside it. Below the gate the box stays EMPTY rather than showing a guess:
  // an empty box next to a legible picture costs one keystroke, and a wrong
  // number costs the chapter's data, because a confident wrong number invites
  // agreement rather than correction.
  const prefill = prefillFor(cell);
  if (prefill) {
    label.innerHTML += ` &middot; <span class="tag counted">${prefillTag(prefill.source)}</span>`;
    row.classList.add("prefilled");
  }

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.inputMode = "numeric";
  // Chrome restores form state across a reload and will happily put a value
  // back into a box that is now a different item -- observed during testing,
  // where three cells came back pre-filled after a refresh. Silently wrong
  // numbers are the one outcome this tool must not produce.
  //
  // This alone does NOT stop it: `autocomplete` governs autofill suggestions,
  // not session restore. `assertTypedValues` is what actually undoes it, and
  // the two data attributes are how it knows which item each box belongs to.
  input.autocomplete = "off";
  input.dataset.card = String(cardNumber);
  input.dataset.row = String(cell.row);
  input.setAttribute("aria-label", `${cell.itemName} count`);
  // From `state.values`, not from the reading: `seedPrefills` has already put
  // every reading there, and a restored draft has since overwritten some of
  // them with what a person typed. The box shows what will be exported.
  const current = state.values.get(cardNumber)?.get(cell.row);
  if (current !== undefined) input.value = String(current);
  input.addEventListener("input", () => {
    // A box a person has touched is theirs, however it started out, so the
    // export stops calling it a machine reading.
    state.prefilled.get(cardNumber)?.delete(cell.row);
    const map = state.values.get(cardNumber) ?? new Map<number, number>();
    const n = input.valueAsNumber;
    if (Number.isFinite(n) && n > 0) map.set(cell.row, Math.round(n));
    else map.delete(cell.row);
    state.values.set(cardNumber, map);
    updateGate();
    scheduleSave();
  });
  row.appendChild(input);

  return row;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function collectCards(): ExportCard[] {
  const out: ExportCard[] = [];
  for (const card of state.cards) {
    const typed = state.values.get(card.cardNumber);
    if (!typed || typed.size === 0) continue;

    out.push({
      cardNumber: card.cardNumber,
      pageNumbers: [...new Set(card.cells.map((c) => c.pageNumber))].sort((a, b) => a - b),
      cardType: card.cells.some((c) => c.tallyOnly) ? "tally" : "total",
      values: [...typed.entries()].map(([row, value]) => {
        // Values a person typed or corrected are certain and are recorded as
        // human. A machine reading nobody touched carries the confidence it was
        // pre-filled at and is recorded as recognized, so the chapter's audit
        // column shows exactly which numbers a person read off the picture.
        const machine = state.prefilled.get(card.cardNumber)?.get(row);
        return {
          row,
          value,
          confidence: machine ? machine.confidence : 1,
          corrected: !machine,
        };
      }),
    });
  }
  return out;
}

function gateProblems(): string[] {
  const problems: string[] = [];
  if (!state.event.date) problems.push("date");
  if (!state.event.shoreline.trim()) problems.push("beach");
  return problems;
}

function updateGate() {
  const missing = gateProblems();
  const entered = [...state.values.values()].reduce((n, m) => n + m.size, 0);
  const button = document.getElementById("export") as HTMLButtonElement | null;
  const gate = document.getElementById("gate");
  if (!button || !gate) return;

  button.disabled = missing.length > 0 || entered === 0;
  gate.textContent =
    missing.length > 0
      ? `Still needed: ${missing.join(", ")}.`
      : entered === 0
        ? "Type at least one number to export."
        : // Machine readings are counted out separately and on purpose. The
          // reviewer should know how much of what is about to be exported they
          // have actually looked at.
          `${entered} value${entered === 1 ? "" : "s"} ready` +
          (prefilledCount() > 0
            ? // "filled in by the tool", not "counted from tally marks": most of
              // them are now read off the handwriting, and the two are not
              // equally trustworthy. Saying the wrong one here would tell a
              // reviewer the weaker readings are the stronger kind.
              //
              // The never-shown count is called out separately because it is a
              // different claim. A pre-filled box the reviewer scrolled past
              // was at least in front of them beside its picture; these were
              // not on the list at all, and this line is the only place in the
              // interface that says so before the file is downloaded.
              ` — ${prefilledCount()} filled in by the tool and not checked` +
              (autoAcceptedCount() > 0 ? `, ${autoAcceptedCount()} of them never shown.` : ".")
            : ".");
}

async function doExport() {
  try {
    setStatus("Building the spreadsheet…");
    const res = await fetch("template/data-entry-template.xlsx");
    if (!res.ok) throw new Error("could not load the chapter's Excel template");
    const template = new Uint8Array(await res.arrayBuffer());

    const bytes = fillTemplate(template, {
      sourcePdfName: state.fileName,
      event: {
        date: state.event.date,
        shoreline: state.event.shoreline.trim(),
        volunteers: state.event.volunteers ? Number(state.event.volunteers) : null,
        pounds: state.event.pounds ? Number(state.event.pounds) : null,
        durationHours: state.event.durationHours ? Number(state.event.durationHours) : null,
        dataEntryVolunteer: state.event.dataEntryVolunteer.trim() || null,
        club: state.event.club.trim() || null,
      },
      cards: collectCards(),
    });

    downloadWorkbook(bytes, suggestFilename(state.event.date, state.event.shoreline));
    setStatus("Spreadsheet downloaded.");
  } catch (err) {
    setStatus("");
    alert(`Could not build the spreadsheet.\n\n${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------

function columnLetter(cardNumber: number): string {
  let n = cardNumber + 2; // card 1 -> column C
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

renderUpload();
