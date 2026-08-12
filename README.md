# Surfrider San Diego — Data Cards → Spreadsheet

Browser-only extraction of beach cleanup data cards into the chapter's Excel
template. No server, no accounts, no API keys, no billing relationship.
The scanned PDF never leaves the laptop.

Plan of record: `~/.claude/plans/users-mateobesse-claude-plans-i-want-to-pure-beaver.md`

---

## Status

Phases 1 and 5 of the plan are built and verified. Phases 0, 2, 3, 4 are
blocked on inputs that do not exist yet — see **Blockers** below.

| Piece | State |
|---|---|
| `src/lib/taxonomy.ts` | **Done.** Generated from the template; 83 items, 11 sections. |
| `src/lib/schema.ts` | **Done.** Card/event schemas, review threshold, export gate. |
| `src/lib/xlsx/` | **Done and verified** against the real template (25/25 checks). |
| `src/lib/cells.ts` | **Done.** Loads and validates the measured cell map. |
| `assets/reference/blank-*.png` | **Done.** Registration template synthesized from real cards. |
| `assets/reference/cells.*.json` | **Done.** All 83 TOTAL boxes located and verified against the overlay. |
| `src/lib/pdf.ts` | **Done.** Rasterizes the PDF at 200 DPI in the browser. |
| `src/lib/register.ts` | **Done and measured** across six scans from two beaches — see below. |
| `src/lib/marks.ts` | **Done and measured.** Decides whether a person wrote in a cell, by shape rather than by how much ink is there. Halves the review list. |
| `src/lib/recognize.ts`, `tally.ts` | Not started. Digit training is unblocked; tallies are untouched. |
| UI (Phase 4) | **Done.** Drop a PDF, review the crops, download the spreadsheet. |

---

## Blockers

### 1. No scanned cards, no blank card, no ground truth

Phase 0 is marked blocking in the plan, and none of its inputs are on this
machine. `input/` in the prototype is empty; nothing matching the scans or the
completed datasheets exists anywhere under `~`.

To unblock, three separate things are needed:

- **A blank card, scanned front and back at 300 DPI.** This is the registration
  template. Every cell coordinate is measured from it, so the whole pipeline
  depends on it. The sample card received so far is neither blank nor
  full-resolution — see Blocker 2.
- **The scanned event PDFs** named in the accuracy report
  (`8.2.25_Ocean-Beach_CH54.pdf`, `6.13.25_Seaport-Village_CH54.pdf`) plus the
  14 un-entered ones. Include the ugly cases: tally-only, crossed-out
  corrections, light pencil, skewed scans, odd page counts.
- **The matching hand-entered spreadsheets**, which are the ground truth. The
  Phase 3 go/no-go measurement is meaningless without them, and so is the
  auto-generated training set.

Drop scans in `assets/scans/` and completed datasheets in
`assets/ground-truth/`. Both are gitignored — they contain volunteer
handwriting and event data.

### RESOLVED — blank card and full-resolution scan

`9.27.25_Pacific-Beach_CH54.pdf` is a real ScanSnap iX1600 scan at **200 DPI**
(1700x2192), 114 pages = 57 cards. Digits are 40-60px tall, comfortably
recognizable.

No blank card was available, so `scripts/build-reference.mjs` synthesizes one:
the printed form is identical on every card and only the handwriting differs,
so a per-pixel **median** across 41 aligned pages keeps the form and discards
the writing. Output: `assets/reference/blank-{front,back}.png`.

### 2. (historical) The first sample was 72 DPI

`scans/sample-card.pdf` is 613x793 px per page and its handwritten
digits are **7-9 px tall**. Its metadata (`Skia/PDF`, `Mozilla`,
`"... - Google Docs"`) shows it was produced by opening the file in a browser
preview and using Print -> Save as PDF, which rasterizes at screen resolution.

The original scan is still in Google Drive. It needs to come across as the
original file, downloaded rather than printed. See `docs/card-findings.md` §5 —
this probably matters more to Phase 3 than any modelling decision.

Node is now installed (`~/.local/node`, on PATH via `~/.zshrc`); typecheck and
tests run.

---

## What changed from the plan, and why

**The export does not use SheetJS.** The plan specified it; the template ruled
it out. Inspecting `data-entry-template.xlsx` turned up:

- 83 **shared formulas** in column B (`<f t="shared" ref="B18:B33" si="1">`)
- an **Excel Table** spanning `A18:BZ110` (`xl/tables/table1.xml`)
- a **drawing** and a **persons** part

A read-model-write round-trip through a spreadsheet library rebuilds the
workbook from its own model and does not reliably carry those through. The
failure would be quiet and bad: column B totals stop recalculating, and nobody
notices until someone trusts a wrong total.

Instead the exporter **patches the worksheet XML in place**. The template
already ships every cell as an empty styled placeholder (`<c r="C18" s="10"/>`),
so filling one is a local substitution. Every part we don't write stays
byte-identical. It is also less code than the SheetJS path.

Two things that fall out of this:

- `fullCalcOnLoad="1"` is set on the workbook, so column B recomputes on open
  rather than showing the template's cached `0`.
- Writing column B on an item row throws rather than being merely discouraged —
  it is the one mistake that silently corrupts the chapter's spreadsheet.

**The taxonomy is generated, not transcribed.** The prototype's `CLAUDE.md`
lists the catch-all rows as `Other (Plastic)`, `Other (Glass/Ceramic)`, etc.
The template actually reads `Other (do not write in the item name, just a
number)`. Transcribing would have baked in that error, so
`scripts/gen_taxonomy.py` reads the template directly and the section
boundaries come from the template's own shared-formula blocks.

Also worth noting: the item count is **83**, not the ~100 quoted in the plan
and `CLAUDE.md`.

**The card layout doc was wrong in three ways.** `docs/data-card-layout.md` was
written from the spreadsheet, not the card. Reading the actual card showed each
page is two independent columns with their own TOTAL columns (not one grid),
Smoking is on the back (not the front), and the TOTAL cells are open — digits
are free-written, not boxed. `docs/card-findings.md` records all of it; the
taxonomy now carries a `column` field and the corrected front/back split.

**Cell coordinates are measured data, not source code.** `cells.ts` loads them
from a calibration file and refuses to start without one. Hand-written pixel
guesses would look plausible in review and fail on every real scan.

---

## Verifying the export without Node

```bash
python3 scripts/validate_xlsx.py
```

Stdlib only. Patches the real template with a realistic event — including the
`11` vs `||` case from the accuracy report, a 76th volunteer landing exactly in
column BZ, and an ampersand in a text field — then reopens the result and
asserts the formulas, table, drawing, and styles all survived. Writes
`out/validation-output.xlsx` so you can open it in Excel and confirm the column
B totals compute.

`tests/xlsx-export.test.ts` covers the same ground via vitest and will run once
Node exists. Keep the two in sync.

## Regenerating the taxonomy

```bash
python3 scripts/gen_taxonomy.py
```

Run this whenever the chapter changes the Excel template. It fails loudly if
the template's structure no longer matches what the code assumes.

---

## Worth doing regardless of this project

The accuracy report's own top recommendation, which needs no code:

> Ask cleanup leaders to instruct volunteers to write numeric **TOTAL** values
> rather than only tally marks.

Tally-only cards are the weak spot for *every* approach — they were 64%
detection and 28% false positives even with Claude vision. One line in the
pre-cleanup briefing moves ~87% of cards into the 95–100% band. It costs
nothing and it helps whichever way this build goes.


---

## Registration

Everything downstream is a constant lookup into the cell map, so the one thing
that has to be right is where the incoming page sits. A page is deskewed, then
fitted onto the reference by **a scale and an offset per axis** — not a shift.
Scans of the same card differ in size by up to 2.5%, which moves the bottom of
the grid by half a row, and a card can sit 100px+ off where the reference has
it; neither is reachable by translation.

Two details carry most of the reliability:

- **The fit is judged on the grid, not the page.** The window is the cell map's
  own extent, opened upward to include the section banner above the first row.
  Correlating whole pages averages regions that do not move together — on the
  Imperial Beach scans the grid sits ~105px lower relative to the masthead than
  on the scan the reference was built from, and a whole-page fit splits the
  difference and misses by ~50px.
- **The result is checked against the printed banners.** Banners ink ~90% of a
  block's width where the densest handwriting reaches ~25%, so their overlap
  with the template measures placement and ignores how much a volunteer wrote.
  A page below the threshold is refused and surfaced, never cropped: a
  misregistered page produces ordinary-looking numbers against the wrong debris
  items, which is the worst failure this tool can have.

Checking a scan:

```bash
swift scripts/render-pdf.swift <scan.pdf> out/pages/<name>
```

```bash
node scripts/diagnose-registration.mjs out/pages/<name> --overlay 1,2
```

The overlay draws every TOTAL box on the registered page, red where the tool
would read a number. The boxes must sit on the boxes. A card with ~20 inked
cells instead of a handful means the crops have landed on captions and banners.

## The cell map

`assets/reference/cells.{front,back}.json` holds the pixel rectangle of every
TOTAL box and tally area, keyed to its spreadsheet row. Everything downstream
depends on it.

```bash
node scripts/build-reference.mjs <dir-of-page-jpegs>   # synthesize the blank card
node scripts/detect-cells.mjs --debug                  # locate the cells
```

Check `assets/reference/debug-grid-{front,back}.png` by eye after regenerating.
Each item should have a blue box on its caption and a red box on its TOTAL
cell, on the same row.

**Why the overlay matters.** Rows are assigned to spreadsheet rows positionally,
so a map short by one row does not lose one value — it shifts every value below
it onto the wrong debris item, and the spreadsheet still looks normal. The
script therefore refuses to write anything unless all 83 rows match, and the
overlay is rendered *after* overrides so it shows what actually ships.

**Detection strategy.** Not the printed ruling: compositing 41 scans to erase
the handwriting also averages the 1px hairlines down to near-invisible, and
every threshold that fixed one block broke another. Instead it anchors on the
section banners — solid bars that ink ~90% of a block's width against a
caption's ~10%, a 9:1 separation needing no tuning — and then uses the
taxonomy's own item-per-section counts to constrain how the captions inside
each section are grouped.

**Overrides.** 81 of 83 rows resolve automatically. Two at the foot of the
back-left block do not, because a small light "Other (write-in):" caption sits
between a wrapped caption and the table's closing border, and no
threshold/merge pair separates all three without breaking a wrapped caption
elsewhere in the same section. Those two are measured by hand in
`assets/reference/cells-overrides.json`, with the measurements and reasoning
recorded in the file. Every applied override prints a line when the script runs.
