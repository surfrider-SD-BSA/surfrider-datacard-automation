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
| `src/lib/cells.ts` | Structure done. **Coordinates blocked** on a blank-card scan. |
| `src/lib/pdf.ts`, `register.ts`, `recognize.ts`, `tally.ts` | Not started — blocked. |
| UI (Phase 4) | Not started. Plan says build no UI until Phase 3 passes. |

---

## Blockers

### 1. No scanned cards, no blank card, no ground truth

Phase 0 is marked blocking in the plan, and none of its inputs are on this
machine. `input/` in the prototype is empty; nothing matching the scans or the
completed datasheets exists anywhere under `~`.

To unblock, three separate things are needed:

- **A blank card, scanned front and back at 300 DPI.** This is the registration
  template. Every cell coordinate is measured from it, so the whole pipeline
  depends on it. This one is the long pole — nothing in Phase 2 can start
  without it.
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

### 2. No Node.js toolchain on this machine

No `node`, no `npm`, no Homebrew. The TypeScript is written but cannot be
typechecked, tested, or bundled here yet.

Everything verified so far was verified with stdlib Python for exactly this
reason. Tell me and I'll set Node up.

### 3. One open question the plan flags as high-impact

> Does the card give each digit its own printed box, or is the number
> free-written in a cell?

Boxed digits make segmentation nearly free; free-written numbers make it a real
failure mode. This single fact moves the Phase 3 estimate more than anything
else. It needs an eyeball on a physical blank card — it is not answerable from
any file here.

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
