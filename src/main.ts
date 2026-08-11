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
import { extractCard, type ExtractedCard, type ExtractedCell } from "./lib/extract";
import { cropToCanvas, toGray, type GrayImage } from "./lib/image";
import { rasterizePdf } from "./lib/pdf";
import {
  classifyPage,
  pairIntoCards,
  registerPage,
  type PairingProblem,
  type RegisteredPage,
} from "./lib/register";
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

const state = {
  fileName: "",
  cards: [] as ExtractedCard[],
  problems: [] as PairingProblem[],
  /** cardNumber -> taxonomy row -> typed value */
  values: new Map<number, Map<number, number>>(),
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
  renderProgress("Reading the PDF…", 0);

  try {
    const refs = await loadReferences();

    const pages = await rasterizePdf(file, ({ done, total }) => {
      renderProgress(`Rendering page ${done} of ${total}…`, (done / total) * 0.6);
    });

    if (pages.length === 0) throw new Error("That PDF has no pages.");

    const registered: RegisteredPage[] = [];
    for (const [i, page] of pages.entries()) {
      const cls = classifyPage(page.image);
      const reference = cls.side === "front" ? refs.images.front : refs.images.back;
      const { image, skewDegrees, shift } = registerPage(page.image, reference);

      registered.push({
        pageNumber: page.pageNumber,
        side: cls.side,
        image,
        skewDegrees,
        shift,
        classification: { banner: cls.banner, footer: cls.footer, agree: cls.agree },
      });

      renderProgress(
        `Aligning page ${i + 1} of ${pages.length}…`,
        0.6 + ((i + 1) / pages.length) * 0.35,
      );
      // Yield so the progress bar paints between pages.
      await new Promise((r) => setTimeout(r, 0));
    }

    const { cards, problems } = pairIntoCards(registered);

    state.cards = cards.map((c) => extractCard(c, refs.maps));
    state.problems = problems;
    state.values = new Map();

    // Seed the date and beach from the filename when it follows the chapter's
    // convention, e.g. "9.27.25_Pacific-Beach_CH54.pdf". It saves typing and is
    // always shown for confirmation rather than used silently.
    seedEventFromFilename(file.name);

    renderProgress("Done", 1);
    renderReview();
  } catch (err) {
    renderError(err instanceof Error ? err.message : String(err));
  }
}

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
        ${field("volunteers", "Volunteers", "number")}
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
    });
  }

  document.getElementById("export")!.addEventListener("click", () => void doExport());
  document.getElementById("restart")!.addEventListener("click", () => {
    state.cards = [];
    state.values = new Map();
    renderUpload();
  });

  updateGate();
  setStatus(`${state.fileName} — nothing has been uploaded anywhere.`);
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

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.inputMode = "numeric";
  // Chrome restores form state across a reload and will happily put a value
  // back into a box that is now a different item -- observed during testing,
  // where three cells came back pre-filled after a refresh. Silently wrong
  // numbers are the one outcome this tool must not produce.
  input.autocomplete = "off";
  input.setAttribute("aria-label", `${cell.itemName} count`);
  input.addEventListener("input", () => {
    const map = state.values.get(cardNumber) ?? new Map<number, number>();
    const n = input.valueAsNumber;
    if (Number.isFinite(n) && n > 0) map.set(cell.row, Math.round(n));
    else map.delete(cell.row);
    state.values.set(cardNumber, map);
    updateGate();
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
      values: [...typed.entries()].map(([row, value]) => ({
        row,
        value,
        // Typed by a person looking at the crop, so there is nothing to be
        // uncertain about and nothing was auto-filled to override.
        confidence: 1,
        corrected: true,
      })),
    });
  }
  return out;
}

function gateProblems(): string[] {
  const problems: string[] = [];
  if (!state.event.date) problems.push("date");
  if (!state.event.shoreline.trim()) problems.push("beach");
  if (!Number.isFinite(Number(state.event.volunteers)) || Number(state.event.volunteers) < 1) {
    problems.push("volunteer count");
  }
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
        : `${entered} value${entered === 1 ? "" : "s"} ready.`;
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
        volunteers: Number(state.event.volunteers),
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
