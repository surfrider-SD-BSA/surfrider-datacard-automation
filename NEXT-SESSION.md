# Brief: finish making the tool read the numbers

Project: `~/surfrider-datacard-web`, branch `feature/read-the-numbers` (on top of
`publish/browser-tool`; the PR to `surfrider-SD-BSA/surfrider-datacard-automation`
had NOT merged as of the last check).

**Read `HANDOFF.md` first** — it has every measurement behind what follows.
This file is only the part that is still open.

---

## The goal, and the honest distance from it

The owner wants a volunteer to type **at most ~30 values per scan**, and has said
twice that **precision and reliability matter more than coverage**. Take both at
face value; they have been shown the arithmetic.

On the 58-card test scan: **453 cells** to review, ~329 with something written.

```
  cells with a number written in the TOTAL box   387
  cells with tally marks and no number            66
```

So tally counting can only ever touch a fifth of it. **Reaching 30 means solving
the digits.** Today the tool pre-fills NOTHING — see below.

## State: the tally counter works, and is still switched off

`src/lib/tally.ts` counts a strip of pencil strokes geometrically (Hough
decomposition into straight segments, uprights vs crossbars, "explain every ink
pixel or decline"). It is measured, tested (113 vitest tests pass), wired into
`extract.ts` and `main.ts`, and verified end to end in the BUILT bundle.

`PREFILL_GATE` in `src/main.ts` is **1.1, i.e. pre-filling is OFF.**

### The audit is now a script, and it is the thing to run

```bash
npx vite-node scripts/audit-prefills.mjs --                      # list, render, score
npx vite-node scripts/audit-prefills.mjs -- --debug --only <scan> --no-show
```

It lists every cell that would clear gate 0.80 across all 29 page directories,
renders each as **the strip beside its context with the row band ticked off**,
and scores it against `scans/eye-labels/prefill-audit.json` — 46 cells counted by
eye, keyed `scan:card:row` so the labels survive a change that moves which cells
clear the gate. **That keying is the point**: the previous audit was keyed to
nothing durable, went stale the moment the counter changed, and had to be redone
from scratch.

Last run: **43 of 46 right.** Down from six wrong to three.

## Start here, in this order

### 1. Ink that belongs to a NEIGHBOURING ROW. Two of the three remaining failures

```
  pacific-6.30    3:108  said 1, is 0   one long diagonal, from well above the
                                        row to well below it, cropped to band
                                        height and counted as a stroke
  moonlight-7.19  7:42   said 2, is 0   the descenders of "Paper", written by
                                        the volunteer in the row ABOVE
```

Both put a number into a box whose own row **holds no tally at all**, which is
the worst thing this tool can do and the exact failure pre-filling was switched
off for. It is also the same problem as the counter's dominant *undercount* —
a tally that runs on past its row — approached from the other side.

**One mechanism answers both, and it is geometry rather than recognition:**
follow each stroke's own line into the context above and below, and refuse the
reading where the ink carries on. The context crop this needs is already being
passed in to `countTally`. Note it must be a test on the STROKE's line, not on
its column: `verticalRules` already asks the column question and cannot see a
diagonal.

Guard against the obvious over-correction: real tally strokes commonly hang a
little below the band (see `pacific-9.27 14:26`, `oceanbeach-8.02 3:109`). The
mark to refuse is one that carries on for a good fraction of the band's height,
not one that overshoots by a few pixels.

### 2. The third failure, and it is harder

```
  pacific-3.22   14:21  said 3, is 1   a "1" written inside a drawn circle
```

The circle's two arcs are near enough to vertical to pass as uprights and the
ink comes out fully explained (0.99). No cheap guard suggests itself; the angle
spread, the baseline test and the length tolerance all pass. Worth leaving until
1 is done — it is one cell in 46, where 1 is two.

### 3. Then re-run the audit, and set the gate on the evidence

If it comes back clean, set `PREFILL_GATE = 0.8` in `src/main.ts` and mirror it
in `scripts/run-shipping-path.mjs`. **Do not set it on the spreadsheet score.**
93.5% by eye against 79.5% agreement with the sheets is the gap between what the
sheets can tell you and what is true; the sheets are a lower bound.

Note that dropping the gate to 0.95 — single strokes only, the shape that
measures highest — does NOT rescue it: `pacific-6.30 3:108` is one of the five
single-stroke cells.

### 4. Digit segmentation — still the largest lever on the owner's goal

`diagnose-segmentation.mjs` measures the cutting on its own. On 1.18 Imperial,
327 written cells with a value in the sheet:

```
  cut into the right number of digits    76.8%
  too many pieces  28    too few  26    none at all  22
```

A perfect classifier is still wrong on a quarter of cells, because "2" and "21"
are different amounts of debris.

Things already tried, do not repeat — each is written up in HANDOFF.md:

- **Splitting a wide component in two** made it worse (72.8% → 68.5%). Fixing
  touching digits needs to recognise the JOIN, not the width.
- **The 26 "none at all"** are explained now. Four were real digits struck by a
  width filter, which is fixed; the rest are boxes that hold a wisp or nothing,
  with a number in the sheet that came from somewhere else.
- **Regenerating the training set** against the improved cutting was billed as
  the cheapest win in the project. It is measured and it is not one: the set
  does not grow and the model gets slightly worse. See HANDOFF.md for the
  hypothesis about why, which is worth checking before more classifier work.

What is untried and still looks right: **recognise the join** between two
touching digits — a vertical cut at the narrowest column of a wide component,
chosen by ink profile rather than by width.

### 5. Only then, a CNN

`torch 2.8.0` and `scikit-learn 1.6.1` both install fine with
`pip install --target`. An MLP with augmentation was tried and **loses** at the
gate: 81.5% precision against nearest-neighbour's 84.2%. A CNN is worth trying
only after the cutting is fixed.

## Traps. Each cost real time

1. **A spreadsheet value is not proof of what is on the card.** 5,798 of 9,526
   typed values sit on cells blank on the card. Every spreadsheet-scored figure
   is a LOWER BOUND. Render and look before believing one. The audit turned up
   four cells where the counter is right and the sheet is wrong.
2. **Look at the cells the tool would actually show a person**, and at the right
   population: `!hasValue && tallyMarked`, which is what `extract.ts` counts.
   Auditing every marked strip measures the wrong thing.
3. **A section banner defeats any test that asks "is this column inked above the
   row".** It inks every column, so the run of them is too wide to be a rule and
   the test strikes nothing. This hid a printed border in three of six wrong
   pre-fills and cost a whole audit. `ruleCrowd` in `tally.ts` is the fix.
4. **A synthetic dark band is not a banner.** `inkMask` measures against a LOCAL
   paper level, so a uniformly dark rectangle contains no ink by that definition.
   The test for 3 passes with or without the fix unless the banner has white
   lettering reversed out of it.
5. **The automated browser pane runs its tab HIDDEN**, so `requestAnimationFrame`
   never fires and pdf.js hangs forever with no error. Use
   `window.requestAnimationFrame = (cb) => setTimeout(cb, 0)` as a harness shim,
   or front the tab.
6. **`wallEdge: 0` does not disable the mark test's wall rule** — `marks.ts`
   floors the edge at two columns. Use `wallFrac: 2`.
7. **Do not average two disagreeing readers.** Measured on 18 disagreements the
   tally alone was right 9 times, the digits 7, and halfway between **3**.
8. **Anything under `assets/` is copied into the build verbatim.** Scans live in
   `/scans/`, outside it. Do not weaken `scripts/check-dist.mjs`.
9. **`scans/eye-labels/` is the most valuable thing in the repo.** Hours of
   looking, and now three separate label sets. Never throw it away.

## How to measure

```bash
npx vite-node scripts/audit-prefills.mjs --                   # every pre-fill, by eye
npx vite-node scripts/diagnose-tally.mjs -- test-long [--show --declined --reason R]
npx vite-node scripts/diagnose-tally-sheets.mjs --            # tally vs 27 sheets
npx vite-node scripts/diagnose-segmentation.mjs -- [--show --kind none|over|under]
npx vite-node scripts/diagnose-agreement.mjs --               # both readers
npx vite-node scripts/run-shipping-path.mjs -- out/pages/<name>
node scripts/train-digits.mjs                                 # knn precision curve
PYTHONPATH=<dir-with-sklearn> python3 scripts/train_digits.py  # MLP
```

The two whole-corpus runs (`diagnose-tally-sheets`, `diagnose-segmentation`
without `--only`) take about nine minutes each; `audit-prefills` about eleven.
Budget for that rather than being surprised by it.

`run-shipping-path.mjs` is the guard against the offline mirrors drifting from
what the browser runs. They agree today.

## What the owner could supply, and it is worth asking again

**~100 tally strips counted by eye.** The spreadsheets can only ever give a lower
bound, which is why the counter's precision is quoted as "79.5% against the
sheets, 93.5% by eye on the cells that would actually be pre-filled". A hundred
real counts would let the gate be set on evidence rather than on 46 cells.
Generate the contact sheets with `diagnose-tally.mjs --show`; someone reads them
and writes numbers. It is an hour and it outlasts any session.
