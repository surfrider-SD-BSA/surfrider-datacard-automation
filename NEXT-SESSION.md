# Brief: the tool pre-fills now, and the digits are still the whole problem

Project: `~/surfrider-datacard-web`, branch `feature/read-the-numbers`, pushed
to `origin/feature/read-the-numbers`. The repo is public.

**The PR merged.** `surfrider-SD-BSA/surfrider-datacard-automation` took it as
squashed commit `1229993` (#12) and `origin/publish/browser-tool` — this
branch's base — was deleted on the remote. `main` has moved on once since.
This branch has NOT been rebased onto it. When you do:
`git rebase --onto origin/main publish/browser-tool feature/read-the-numbers`.
The two differ only in CI, Dependabot and dependency pins plus `CHANGELOG.md`;
nothing under `src/` or `scripts/`, so `CHANGELOG.md` is the one conflict to
expect. It needs a force-push, which is why it was left for the owner.

**Read `HANDOFF.md` first** — it has every measurement behind what follows.
This file is only what is still open.

---

## What changed 19 Aug 2026

- **The regeneration item was disproved and closed.** See item 1. It had been
  the top of the list twice and was already done both times.
- **The digit recognizer got materially better**, by changing how digits are
  compared rather than what it is trained on: deskew and recentre, a 3x3 blur,
  and trying the query at nine one-pixel offsets.

  ```
                          accuracy    precision at the top gate   answered at 0.80
    before                  64.2%          83.5%                     49%
    after                   70.0%          86.0%                     54%
  ```

  Better on both axes at once, so there is nothing traded away. `HANDOFF.md`
  has the per-step table and the two dead ends that were measured first
  (class-frequency balancing costs eleven points; an absolute distance cutoff
  does nothing at any value).
- **The reachable-precision table now exists**, which is what to quote when
  someone asks for a target: 90% precision costs all but 14.6% of the digits,
  and 95% and 100% are not reachable at any setting. 90% accuracy is 20 points
  away and not a tuning problem.
- **Digit CUTTING improved for the first time in three sessions.** The hollow
  shape test was rejecting legible digits and guarding nothing. Over 28 scans
  and 3,285 cells: cut right **71.7% → 73.0%**, cells nothing is found in
  **306 → 274**, over-cut unchanged. The training set grew **3,228 → 3,325**
  (+97) — the first regeneration that has ever gained anything, because this
  time the cutting really changed.
- **A change that looked good was measured and thrown away.** Lowering the
  `short` constant improves every segmentation number and makes the reader
  worse. See item 2; the reasoning is in the code beside the constant.
- New instruments: `scripts/diagnose-none.mjs` (which test killed this cell)
  and `scripts/sweep-segment-shape.mjs` (move one shape constant, hold the
  rest, report the failure it guards as well as the headline).
- Remember that none of the above is in the app yet: `src/main.ts` passes
  `null` for the digit reader and nothing loads `digit-model.json`.


## What changed last session

Pre-filling was OFF and is now **ON**. `PREFILL_GATE` in `src/main.ts` is `0.8`.

- The audit that gated it was rebuilt as `scripts/audit-prefills.mjs` and run
  over all 29 page directories. 46 cells were rendered and counted by eye; the
  labels are in `eye-labels/prefill-audit.json`.
- Two of the four wrong readings were the same failure — **ink belonging to a
  neighbouring row**, which put a number into a box whose own row holds no tally
  at all. `rowOverrun` in `tally.ts` now refuses those. 46 cells → 42, wrong 4 →
  2, precision 91.3% → 95.2%.
- The export was proven end to end for the first time: 61 values typed into the
  running app on a real scan come back out of the downloaded file in the right
  cell, all 61. Pinned in CI too, over all 83 items across five cards.
- `eye-labels/` moved out of the gitignored `/scans/` tree and is now tracked.
  It had been a single copy on one laptop.
- README and the app's front page now say the tool does **not** read
  handwriting, because a volunteer meeting 450 empty boxes otherwise concludes
  it is broken.

## The honest scale, because it is easy to oversell

On the 58-card test scan the review list is **453 cells and 5 arrive
pre-filled**. The counter only ever sees the 66 tally-only cells; the other 387
are handwritten numbers. The owner's goal of ~30 typed values needs roughly 300
of 329 filled correctly, and **almost all of that has to come from the digits.**

```
  cells with a number written in the TOTAL box   387
  cells with tally marks and no number            66
```

## Start here, in this order

### 1. SETTLED — do not regenerate the training set again

This item was wrong in the last two briefs and has now cost a third session to
disprove. `HANDOFF.md` had already recorded the work as done, and as NOT a win;
what kept it alive was a leftover sentence contradicting its own section, which
is now removed.

Re-verified 19 Aug 2026: all 28 pairs re-run against the current cutting, every
event byte-identical — **3,228 digits from 26 events, zero change**. The 28th
pair (`pacific-9.27`) is correctly refused, its spreadsheet agreeing with its
PDF on 7% of written cells against a 30% floor.

The classifier ceiling is not in the labels, and it is not in the voting either
(measured below). Start at item 2.

### 2. The cells segmentation finds nothing in — half answered, half is real

**Done:** the hollow shape test was rejecting legible digits at fills of 0.100
to 0.118 against a 0.12 line, and it was guarding nothing, because the printed
border it existed to catch is already removed by the 6% inset. Lowered to 0.06.
Across 28 scans: cut right **71.7% → 73.0%**, found nothing **306 → 274**,
cut into too many pieces unchanged. `HANDOFF.md` has the sweep.

**The instrument matters more than the fix.** `scripts/diagnose-none.mjs` says
which test killed each cell and with what numbers. Rendering alone could not:
the picture shows a legible digit in a box the code calls empty, and the eye
cannot name the filter. Use it before touching any shape constant.

**Still open, and the honest half:** of the 22 on 1.18 Imperial, six were only
specks and three were refused by `inkThreshold` outright. Those are almost
certainly empty boxes with a number typed from somewhere else — trap 1, not a
defect. Confirm that by eye before spending anything on them.

**The `short` constant was tried and rejected, and how it was rejected is the
part worth keeping.** Lowering it 0.18 → 0.16 cuts more cells correctly
(73.0% → 73.5%, nothing-found 274 → 260) and a segmentation sweep alone would
have shipped it. Carried through a regenerated training set and a retrain it
goes the other way: 62 more digits, but harder ones, so accuracy 70.3% → 69.5%
and precision 86.0% → 85.6%. Net about four more cells read right and about as
many more read wrong — not a trade this project makes.

**So: never judge a cutting change on segmentation figures alone.** Regenerate
and retrain, and look at precision. The constant is back at 0.18 with the table
in the code beside it.


### 3. Buy back the tally coverage `verticalRules` costs

It strikes any column inked above or below the row band, which correctly kills
the dotted printed borders and also kills real strokes, because tallies in
neighbouring rows sit at similar columns. The test scan answers 34 of 249 marked
strips, down from 49. Narrowing it to ink that is *straight and at the same
angle* as the candidate is the idea that has not been tried.

### 4. The two pre-fills that are still wrong

```
  pacific-3.22 14:21   said 3, is 1   a "1" inside a drawn circle: the two arcs
                                      pass as uprights, ink 0.99 explained
  pacific-9.27 14:26   said 3, is 4   four strokes, two hanging below the band,
                                      and one of the four never found
```

The circle is the harder and more interesting one. Every existing test passes it
— angle spread, baseline, length tolerance, explained ink — and nothing cheap
suggests itself.

### 5. Before it goes wider than a trial event

- Someone downstream opening a filled spreadsheet. The format is verified and
  the values are verified into the right cells; nobody has confirmed the
  chapter's data person accepts a real one.
- A second browser. Safari private mode is handled explicitly; every
  click-through so far has been Chrome.
- One real event with a real volunteer, watched. Every serious bug in this
  project was found that way and not by measurement.

## Traps. Each cost real time

1. **A spreadsheet value is not proof of what is on the card.** 5,798 of 9,526
   typed values sit on cells blank on the card. Every spreadsheet-scored figure
   is a LOWER BOUND. Render and look before believing one.
2. **Audit the cells the tool would actually FILL**, which is not every marked
   strip: `extract.ts` only counts a tally where the box has no number
   (`!hasValue && tallyMarked`). Auditing all marked strips measures the wrong
   population — it put 31 cells on 3.15 Imperial alone into the first run.
3. **Trace ink, do not extrapolate along a segment's angle.** An angle is fitted
   to the straightest part of a mark and handwriting curves. A descender reading
   2° off vertical inside the row leans ~10° over its length, so a straight line
   drawn from it misses the ink entirely twenty rows up.
4. **Total overrun does not separate a neighbour's ink from a real stroke** at
   any tolerance — both reach 0.60 of the strip's height. Only the DIRECTION
   does: a volunteer writes downward, so a tally that runs out of room runs out
   below its row. `scripts/sweep-row-escape.mjs --both` shows this.
5. **`rowEscape` is tuned on 46 cells with about one cell of margin.** Re-sweep
   it when there are more labels; do not inherit it.
6. **A test's own parser is code too.** The export round-trip's first version
   did not handle self-closing cells, ran past `<c r="C18" s="10"/>` to the next
   closing tag, and reported 166 misplaced numbers that were all in the right
   place.
7. **Card to column is by card NUMBER, not position in the list.** Card 7 goes
   in column I whether or not cards 3–6 were scanned.
8. **The automated browser pane runs its tab HIDDEN**, so `requestAnimationFrame`
   never fires and pdf.js hangs with no error. Shim it:
   `window.requestAnimationFrame = (cb) => setTimeout(cb, 0)`. Every symptom
   points at the PDF pipeline; none of it is.
9. **`wallEdge: 0` does not disable the mark test's wall rule** — `marks.ts`
   floors the edge at two columns. Use `wallFrac: 2`.
10. **Do not average two disagreeing readers.** Measured on 21 disagreements the
    tally alone was right 10 times, the digits 8, halfway between 5. `reconcile`
    computes the midpoint and scores it 0.17, below any gate. Leave it there.
11. **Anything under `assets/` is copied into the build verbatim.** Scans live in
    `/scans/`, outside it. Do not weaken `scripts/check-dist.mjs`.
12. **`eye-labels/` is the most valuable thing in the repo.** Hours of looking,
    and the only ground truth that does not come from a spreadsheet.

## How to measure

```bash
npx vite-node scripts/audit-prefills.mjs --                   # every cell that gets pre-filled, by eye
npx vite-node scripts/sweep-row-escape.mjs -- --both          # where the neighbouring-row bar belongs
npx vite-node scripts/diagnose-tally.mjs -- test-long [--show --declined --reason R]
npx vite-node scripts/diagnose-tally-sheets.mjs --            # tally vs 27 sheets
npx vite-node scripts/diagnose-segmentation.mjs -- [--show]   # digit cutting
npx vite-node scripts/diagnose-none.mjs -- <scan>              # which test killed each unreadable cell
npx vite-node scripts/sweep-segment-shape.mjs -- --param short # move one shape constant, hold the rest
npx vite-node scripts/diagnose-agreement.mjs --               # both readers
npx vite-node scripts/run-shipping-path.mjs -- out/pages/<name>
node scripts/train-digits.mjs                                 # knn precision curve
node scripts/sweep-digit-rules.mjs --rules                    # what precision is reachable, and its cost
PYTHONPATH=<dir-with-sklearn> python3 scripts/train_digits.py # MLP
```

`run-shipping-path.mjs` is the guard against the offline mirrors drifting from
what the browser runs. They agree today.

**Re-run `audit-prefills.mjs` after ANY change to the counter.** It is the only
instrument here that has ever caught the failure it exists for; the spreadsheet
score, both offline diagnostics and the whole test suite passed clean through it
twice.

## Green as of this handoff

119 vitest tests, 27/27 xlsx checks, typecheck, `npm run build` and
`check-dist.mjs` all clean. Working tree clean, branch pushed.

## What the owner could supply, and it is worth asking again

**~100 tally strips counted by eye.** The spreadsheets can only ever give a lower
bound. A hundred real counts would let both gates be set on evidence instead of
on 46 cells. Generate the contact sheets with `diagnose-tally.mjs --show`;
someone reads them and writes numbers. It is an hour and it outlasts any session.

## Not started

Hosting. The build is 11 static files and `vite.config.ts` already sets
`base: "./"` for a GitHub Pages project path; there is no deploy workflow yet.
The repo is public, so Pages is free. Note the `.mjs` worker needs a correct
MIME type or the app hangs on "Reading the PDF…" with nothing in the console.
