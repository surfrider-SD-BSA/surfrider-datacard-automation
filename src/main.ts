/**
 * Beach cleanup data cards -> the chapter's Excel spreadsheet.
 *
 * The tool locates every cell a volunteer wrote in and shows a cropped picture
 * of each one beside a box to type it into. It deliberately does not try to
 * read the handwriting: deciding *whether* a box has writing is easy and
 * reliable, while reading *what* it says is neither, and a confidently wrong
 * number is worse than no number. The human reads ~10 crops per card instead of
 * hunting 83 rows on paper.
 */

import { loadCellMap, type CellMap } from "./lib/cells";
import { reconcile, type Reading } from "./lib/reading";
import {
  assembleCard,
  cellsForSide,
  type ExtractedCard,
  type ExtractedCell,
  type PageCells,
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
}> | null = null;

function loadReferences() {
  referencesPromise ??= (async () => {
    const [front, back, frontMap, backMap] = await Promise.all([
      loadReferenceImage("reference/blank-front.png"),
      loadReferenceImage("reference/blank-back.png"),
      loadCellMap("front", async (u) => (await fetch(u)).json()),
      loadCellMap("back", async (u) => (await fetch(u)).json()),
    ]);
    return { images: { front, back }, maps: { front: frontMap, back: backMap } };
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
          ? cellsForSide(registered.image, pageNumber, refs.maps[registered.side], registered.side)
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

    renderProgress("Done", 1);
    renderReview();
    offerDraft();
  } catch (err) {
    renderError(err instanceof Error ? err.message : String(err));
  }
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
  for (const key of Object.keys(state.event) as (keyof EventForm)[]) {
    const saved = draft.event[key];
    if (typeof saved === "string") state.event[key] = saved;
  }
  renderReview();
  setStatus(`${state.fileName} — ${countValues(draft)} values restored.`);
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
  const cardsWithCells = state.cards.filter((c) => c.cells.length > 0);
  const totalCells = state.cards.reduce((n, c) => n + c.cells.length, 0);

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
        Type what you see in each picture — Tab moves to the next box.
      </p>
    </div>

    <div id="cards">
      ${cardsWithCells.length === 0
        ? `<div class="panel empty">No written-in cells were found. That usually means the pages did not align — check the warnings above.</div>`
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

  const written = card.cells.filter((c) => c.hasValue).length;
  const tallies = card.cells.filter((c) => c.tallyOnly).length;

  const head = document.createElement("div");
  head.className = "card-head";
  head.innerHTML = `
    <h3>Card ${card.cardNumber} &rarr; column ${columnLetter(card.cardNumber)}</h3>
    <span class="meta">
      ${written} number${written === 1 ? "" : "s"}${tallies ? `, ${tallies} tally-only` : ""}
      ${card.missingSides.length ? ` &middot; ${card.missingSides.join(", ")} page missing` : ""}
    </span>`;
  el.appendChild(head);

  const list = document.createElement("div");
  list.className = "cells";
  for (const cell of card.cells) list.appendChild(renderCell(card.cardNumber, cell));
  el.appendChild(list);

  return el;
}

/**
 * Confidence a reading needs before it is put in a box.
 *
 * ONE NUMBER DECIDES HOW MUCH THIS TOOL RISKS, and it is this one. Raising it
 * pre-fills fewer boxes and gets more of them right; lowering it pre-fills more
 * and gets more of them wrong. The measured cost of each setting is in
 * HANDOFF.md, per bucket, so the chapter can move it on evidence.
 *
 * At 0.80 the tool pre-fills counts of one to four whose ink is fully accounted
 * for -- five boxes of the 453 on the 58-card test scan. The counter only ever
 * sees the 66 cells with tally marks and no number; the other 387 hold
 * handwriting, and reading those is the recognizer's problem, which is off.
 *
 * **What the setting is worth, measured the only way that means anything.**
 * `scripts/audit-prefills.mjs` lists every cell this gate would fill across all
 * twenty-nine page directories and renders it beside its context; all 46 were
 * counted by eye and are kept in `eye-labels/prefill-audit.json`. At 0.80
 * the tool fills 42 of them and **40 are right**. Nothing here is scored on the
 * chapter's spreadsheets, which agree 79.8% and are a lower bound rather than a
 * precision -- a value in a sheet is not proof of what is on the card.
 *
 * That is 95.2%, and it is short of the ~99% this project set as the bar for a
 * pre-fill. It ships at 0.80 because the chapter's owner asked for it after
 * being shown these figures, and because the shortfall is no longer the kind
 * the bar was written for:
 *
 *   - Neither remaining error invents a number out of nothing. Both readings
 *     that returned a count for a row holding no tally at all -- a diagonal
 *     crossing three rows, and the descenders of a word written in the row
 *     above -- are refused now; see `rowEscape` in tally.ts.
 *   - What is left is a count out by one, and a digit written inside a drawn
 *     circle read as three. The 99% bar exists because a recognizer reading
 *     "2" where the card says "21" is wrong by nineteen; the chapter's owner
 *     has said a count out by one or two is tolerable for aggregate debris.
 *   - Every pre-filled box is tagged "counted: check it" in the list and
 *     exported as `recognized` rather than `human`, so a reviewer who trusts it
 *     and a reviewer who corrects it are told apart in the chapter's own audit
 *     column.
 *
 * Set it to 0.95 to pre-fill only single strokes. Set it to 1.1 to turn
 * pre-filling off entirely. Re-run the audit after ANY change to the counter:
 * it is the only instrument here that has ever caught the failure it exists
 * for, and every other one -- the spreadsheet score, both offline diagnostics,
 * the whole test suite -- passed clean through it twice.
 */
const PREFILL_GATE = 0.8;

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
  const shot = cell.tallyOnly
    ? cropToCanvas(
        cell.image,
        cell.rect.x - cell.rect.width * 0.15,
        cell.rect.y,
        cell.rect.width * 1.3,
        cell.rect.height,
        2.0,
      )
    : cropToCanvas(cell.image, cell.rect.x, cell.rect.y, cell.rect.width, cell.rect.height, 2.4);
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
  const reading = reconcile(
    cell.tallyCount === null ? null : { value: cell.tallyCount, confidence: cell.tallyConfidence },
    null,
  );
  const prefill = reading && reading.confidence >= PREFILL_GATE ? reading : null;
  if (prefill) {
    label.innerHTML += ` &middot; <span class="tag counted">counted: check it</span>`;
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
  if (prefill) {
    input.value = String(prefill.value);
    const values = state.values.get(cardNumber) ?? new Map<number, number>();
    values.set(cell.row, prefill.value);
    state.values.set(cardNumber, values);
    const marks = state.prefilled.get(cardNumber) ?? new Map<number, Reading>();
    marks.set(cell.row, prefill);
    state.prefilled.set(cardNumber, marks);
  }
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
            ? ` — ${prefilledCount()} counted from tally marks, not yet checked.`
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
