# Brief: finish making the tool read the numbers

Project: `~/surfrider-datacard-web`, branch `feature/read-the-numbers` (7 commits
on top of `publish/browser-tool`; the PR to `surfrider-SD-BSA/surfrider-datacard-automation`
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

## State: the tally counter works and is switched off

`src/lib/tally.ts` counts a strip of pencil strokes geometrically (Hough
decomposition into straight segments, uprights vs crossbars, "explain every ink
pixel or decline"). It is measured, tested (112 vitest tests pass), wired into
`extract.ts` and `main.ts`, and verified end to end in the BUILT bundle.

- Answers 34 of 249 marked strips on the test scan.
- On cells it answered, read by eye: **11 of 11 correct** (before the last fix).
- Against all 27 spreadsheets: 81.4% — a LOWER BOUND, see trap 1.

**`PREFILL_GATE` in `src/main.ts` is 1.1, i.e. pre-filling is OFF.** Why: every
one of the 44 cells the gate would fill was rendered and read by eye, and at
least three counted a printed border as a stroke — returning a number for a strip
with no tally in it, at the TOP confidence the tool issues (0.95). No threshold
separates that, which is the whole point. Set it back to **0.80** once the audit
below comes back clean.

## Start here, in this order

### 1. Re-run the 44-cell audit. Nothing ships until it is clean

The border bug was fixed after the audit was taken, and coverage changed (49 → 34
answers), so **the audit is stale**. Redo it: list every cell that clears gate
0.80 across all scans, render the strips, count them by eye. It is ~30 tiles and
maybe twenty minutes. If they are all right, set `PREFILL_GATE = 0.8`.

The audit script was scratch and is gone; rebuild it from
`scripts/diagnose-tally.mjs` and `scripts/diagnose-tally-sheets.mjs`, both of
which already do the hard parts.

### 2. Buy back the coverage the border fix cost

`verticalRules` in `tally.ts` now strikes any column inked **above or below** the
row band. That correctly kills the dotted printed borders, and it also kills real
strokes, because tallies in neighbouring rows sit at similar columns. 49 → 34.

Narrow it: require the ink above/below to be **straight and at the same angle** as
the candidate. A printed rule is one continuous line; a stacked tally's strokes
are separate marks that merely share a column.

### 3. Digit segmentation — the largest lever on the owner's goal

Measured for the first time this session and it caps everything:

```
  cut into the right number of digits    75.8%   (was 72.8%)
  too many pieces  28    too few  25    none at all  26
```

A perfect classifier is still wrong on a quarter of cells, because "2" and "21"
are different amounts of debris. Also: `label-from-spreadsheet.mjs` only emits
training digits from cells where cutting already matched the sheet, so **every
accuracy figure for the recognizer is conditional on this step having worked.**

Two things already tried, do not repeat:
- **Splitting a wide component in two** made it worse (72.8% → 68.5%). Single
  digits are wider than tall often enough that a width rule cuts more real digits
  than joined pairs. Fixing touching digits needs to recognise the JOIN.
- **The 26 "none at all" are not faint pencil.** Dropping the ink threshold from
  25 to 10 changes the figure by exactly nothing. It is the shape filters in
  `segmentDigits` rejecting real writing, or cells blank on the card with a value
  in the sheet. Worth 8 points and still unexplained — **look at them.**

**Cheapest win in the whole project:** regenerate the training set against the
improved cutting (`label-from-spreadsheet.mjs` for all 27 pairs) and retrain.
More cells now qualify. This has NOT been done.

### 4. Only then, a CNN

`torch 2.8.0` and `scikit-learn 1.6.1` both install fine with
`pip install --target` — the note in `train-digits.mjs` saying there is no ML
toolchain is stale. But an MLP with augmentation was tried and **loses** at the
gate: 81.5% precision against nearest-neighbour's 84.2%. Augmentation fixed the
class imbalance (8s 13%→42%, 9s 22%→44%) and bought nothing where it counts. A
CNN is worth trying only after the cutting is fixed.

## Traps. Each cost real time this session

1. **A spreadsheet value is not proof of what is on the card.** 5,798 of 9,526
   typed values sit on cells blank on the card. Every spreadsheet-scored figure
   is a LOWER BOUND. Render and look before believing one.
2. **Look at the cells the tool would actually show a person.** The border bug
   passed 112 tests, both offline diagnostics, and the spreadsheet score. It was
   found only by listing every cell that would reach a volunteer and counting the
   strokes by eye.
3. **The automated browser pane runs its tab HIDDEN**, so `requestAnimationFrame`
   never fires and pdf.js hangs forever with no error. Not a bug in the tool. Use
   `window.requestAnimationFrame = (cb) => setTimeout(cb, 0)` as a harness shim,
   or front the tab. Every symptom points at the PDF pipeline; none of it is.
4. **`wallEdge: 0` does not disable the mark test's wall rule** — `marks.ts`
   floors the edge at two columns. Use `wallFrac: 2`. This silently turned a
   tally of two into a one.
5. **Do not average two disagreeing readers.** The owner asked for the midpoint;
   measured on 18 disagreements the tally alone was right 9 times, the digits 7,
   and halfway between **3**. `reconcile` computes it and scores it 0.17, below
   any gate. Do not raise that without new evidence.
6. **Anything under `assets/` is copied into the build verbatim.** Scans live in
   `/scans/`, outside it. Do not weaken `scripts/check-dist.mjs`.
7. **`scans/eye-labels/` is the most valuable thing in the repo.** Hours of
   looking. Never throw it away.

## How to measure

```bash
npx vite-node scripts/diagnose-tally.mjs -- test-long [--show --declined --reason R]
npx vite-node scripts/diagnose-tally-sheets.mjs --            # tally vs 27 sheets
npx vite-node scripts/diagnose-segmentation.mjs -- [--show]   # digit cutting
npx vite-node scripts/diagnose-agreement.mjs --               # both readers
npx vite-node scripts/run-shipping-path.mjs -- out/pages/<name>
node scripts/train-digits.mjs                                 # knn precision curve
PYTHONPATH=<dir-with-sklearn> python3 scripts/train_digits.py  # MLP
```

`run-shipping-path.mjs` is the guard against the offline mirrors drifting from
what the browser runs. They agree today.

## What the owner could supply, and it is worth asking again

**~100 tally strips counted by eye.** The spreadsheets can only ever give a lower
bound, which is why the counter's precision is quoted as "81.4%, but 11 of 11 by
eye". A hundred real counts would let the gate be set on evidence. Generate the
contact sheets with `diagnose-tally.mjs --show`; someone reads them and writes
numbers. It is an hour and it outlasts any session.
