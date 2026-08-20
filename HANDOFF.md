# Handoff

State of the project, what is proven, and what to do next.

## What works and is verified

| Piece | Status |
|---|---|
| `src/lib/taxonomy.ts` | Generated from the chapter's template. 83 items, 11 sections. |
| `assets/reference/blank-{front,back}.png` | Blank card synthesized by median-compositing 41 real cards. |
| `assets/reference/cells.{front,back}.json` | All 83 TOTAL boxes located, verified against the debug overlay. |
| `src/lib/xlsx/` | Export. Verified against the chapter's real completed datasheet format. |
| Registration | Generalizes. 1,606 pages, twenty-eight scans, ten beaches; nothing refused. |
| `src/lib/marks.ts` | Decides whether a person wrote in a cell. Halves the review list, drops nothing written. |
| `src/lib/draft.ts` | Keeps what has been typed, so a closed tab does not cost an afternoon. |
| Memory | A 116-page scan holds 26MB, not 840MB. Pages are cropped and dropped as they are read. |
| Card pairing | Handles a card fed in backwards, and resynchronises after a missing page. |
| The UI | Dark, and only dark. Scan crops stay on white -- see the note in `style.css`. |
| The web app | Runs end to end: drop a PDF, review crops, download the spreadsheet. |
| The export, end to end | 61 values typed into the running app on a real scan come back out of the downloaded file in the right cell, all 61. Pinned in CI as well: every one of the 83 items across five cards, including the last volunteer column. |

119 vitest tests and 27 stdlib-Python checks pass. `npm run dev` to run it.

## Registration: fixed

The previous blocker -- alignment worked on the 9.27.25 Pacific Beach scan the
reference was built from and on no other -- is resolved.

**What was actually wrong.** Two things, and the second one hid the first.

1. *The fit was translation-only, over the whole page.* On the Imperial Beach
   scans the grid sits ~105px lower relative to the masthead than on the scan
   the reference was composited from, and the card is printed ~2.5% smaller.
   Correlating whole pages averages regions that do not move together, so the
   fit split the difference and landed the grid ~50px out; the search range of
   ±40px could not have reached the answer anyway.

2. *There was no check.* Pages were cropped whatever the fit did, which is how
   this survived: a misregistered page produces ordinary-looking numbers
   against the wrong debris items, and nothing downstream can tell.

**What replaced it** (`fitAxis` and `bannerOverlap` in `src/lib/image.ts` and
`src/lib/register.ts`, mirrored for the offline scripts in
`scripts/lib/cardvision.mjs`):

- Fit a **scale and an offset per axis**, not a shift, over a search wide
  enough to reach the real answer (±360px, ±6%).
- Fit only on the **grid window** -- the cell map's own extent, opened upward
  to take in the section banner above the first row. On the Imperial fronts
  this takes the fit from 0.72 to 0.98.
- Search **coarse to fine**: the coarse pass runs on a 4x decimated profile
  where a single row is blurred away and the banners dominate, which is what
  stops the fit locking onto a row-pitch alias.
- **Verify against the printed banners, not against the correlation that
  placed the page.** Section banners ink ~90% of a block's width; the densest
  handwriting reaches ~25%, so banner overlap measures placement and ignores
  how much a volunteer wrote. Below `MIN_BANNER_OVERLAP` the page is refused,
  surfaced, and not cropped from.

The check had to be independent for a reason worth keeping: gating on profile
correlation *looked* fine (correct pages 0.93-0.99) but scored a correctly
registered, densely filled Pacific Beach card at 0.82 and refused it. The
correlation falls with how much is written, not with how far the page is out,
so it would have thrown away exactly the cards carrying the most data.

Measured, before and after, on the previously-failing 1.18.25 Imperial Beach
scan:

```
                              before          after
mean inked cells per card     ~20             7.4
card-to-column agreement      38%             70%   (vs ~35% at every wrong offset)
cards usable for training     0 of 31         27 of 31
```

Across all twenty-eight scans -- 1,606 pages, ten beaches -- banner overlap
runs median 0.93, minimum 0.797. The last nine scans (646 pages: Tamarack, La
Jolla Shores, Mission Beach, Ocean Beach) were added after the fix was written
and after these thresholds were set, and not one page of them was refused.
That is the closest thing to a held-out test this project has. Displacing a correctly registered page by hand gives 0.71 at 8px out and 0.05
at one row out, so the 0.75 threshold sits between the two populations with
room on both sides.

**Nothing is refused.** The one page that used to be -- page 1 of the 6.20 Del
Mar scan, a card fed through the scanner **sideways**, scoring 0.000 -- is now
recovered. A page that fails on both sides is retried at 90, 180 and 270
degrees and accepted if a turn aligns it; that one comes back at 0.920 with its
boxes on its numbers. The retry is reachable only from failure, which matters:
if it could improve on a good fit it would occasionally "recover" an upright
page into a turned one, and every cell would then be read from the wrong place.
There is a test for exactly that.

Reproduce, or check a new scan:

```bash
swift scripts/render-pdf.swift <scan.pdf> out/pages/<name>    # PDF -> page JPEGs
node scripts/diagnose-registration.mjs out/pages/<name> --overlay 1,2
```

The overlay is the thing to look at: it draws every TOTAL box on the registered
page, red where the tool would read a number. The boxes must sit on the boxes.

## Counting the tallies: built, measured, and switched on

`src/lib/tally.ts` reads a tally strip and returns a number. This was the
largest unexploited lever in the project -- across eleven scans, 1,217 of 1,611
values were tallied and never written as a number -- and it is deliberately not
a handwriting problem, which is why it was worth expecting to work where digit
recognition does not.

**How it works, and the two things that do not work.**

The strip is thinned to one-pixel lines and taken apart into straight segments
by a Hough vote, longest first, each removed before the next is looked for.
Segments near vertical are strokes; the rest are crossbars. A group of five is
four strokes plus a bar drawn through them.

- *Connected components cannot do it.* A crossed group of five is ONE component,
  because the fifth stroke is drawn through the other four. Often the whole
  tally is one blob.
- *A column projection cannot do it either.* The crossbar is not confined to the
  gaps between strokes: measured on the test scan it runs past both ends of its
  group and carries about half the ink in the strip, so the projection is a
  ridge with spikes on it and the ridge is most of what has to be explained.

**The design rests on one rule: explain every ink pixel, or decline.** A tally
is straight lines and nothing else. A "50", a "15", the word SUCKS written
across a card by somebody having a bad morning, a scribbled-out cell -- all real
on the test scan -- are mostly not, and the ink no arrangement of straight
segments can account for is what rules them out.

### Six failures that each cost a measurement to find

Recorded because none is obvious and every one was found by rendering cells and
looking at them, not by reasoning:

1. **The uprights must be extracted BEFORE the crossbars.** A segment takes its
   claimed band with it, so a bar found first cuts a ten-pixel hole through every
   upright it crossed, and each of those then arrives as a long piece and a
   short one. Widening the gap a run may bridge does not fix it: the gap would
   have to exceed the spacing between strokes, at which point a line hops from
   the top of one stroke to the top of the next and a group comes out as one
   diagonal. The bar pass then needs its OWN wider gap (`barGap`) and its own
   lower density bar (`barDensity`), because by then the bar is the thing full
   of holes.
2. **The ink must be thinned first.** A stroke is three to five pixels wide
   depending on the pencil. Claim too narrow a band and every stroke leaves a
   collinear sliver that is found again as another stroke -- a two-stroke tally
   came apart into nine. Thinning removes the choice, and takes how hard
   somebody pressed out of the measurement.
3. **The band that VOTES for a line and the band it then CLAIMS must differ.**
   A thinned hand-drawn line zigzags a pixel either side, so a claim as narrow
   as the vote leaves a dotted trail that is found again. A group of five read
   as six.
4. **Some card printings put the TOTAL box's left border inside the tally
   rectangle.** It lands at page x 728 on the Imperial Beach cards, twenty pixels
   inside a rectangle that ends at 748, and the blank reference composited from
   Pacific Beach cards has nothing there at all. Left in, it is dense, full
   length and perfectly upright -- a flawless tally stroke by every other test --
   and it added a phantom +1 to a third of the counts on that scan.
5. **That border cannot be found from the strip alone.** A volunteer's tall
   upright stroke and a printed rule are the same column of pixels. What
   separates them is that the rule carries on through the rows above and below,
   so the test needs `context`: the same columns over a taller slice of the page.
   Measured on 1.18 Imperial the borders sit at 1.00 of full height and the
   tallest real stroke reaches 0.95. Without context, three real strokes were
   struck out as rules.
6. **The mark test's own wall rule is wrong here, and this is the one place in
   the project where that is true.** It strikes thin dark columns near either
   edge of a crop, which is right for a TOTAL box -- the border is at the edge, a
   volunteer writes inside it -- and wrong for a tally strip, where the first
   stroke is written hard against the left edge. It was striking those strokes
   out, turning a tally of three into a tally of two.

### What it is worth, measured

Scored against every value the chapter typed up, card N to column N, on the
strips the mark test offers -- 772 answers, 438 of which have a value in a
sheet:

```
  count 1, all ink accounted for      42   97.6%
  count 4, all ink accounted for      61   86.9%
  count 2, all ink accounted for     116   82.8%
  count 3, all ink accounted for     105   77.1%
  count 5-9, all ink accounted for    42   73.8%
  count 10+, all ink accounted for     7   85.7%
  anything with ink left over         48   50-86%
```

750 answers over 27 scans, 425 of them on a cell the chapter typed a value for;
81.4% agreement overall.

**These are lower bounds, not precisions**, for the same reason every other
spreadsheet-scored figure in this file is: a value in a sheet is not proof of
what is on the card. Read by eye against the test scan the counter got 9 of the
9 cells it answered, and reading the 1.18 Imperial disagreements one at a time,
two of seven were the sheet being wrong rather than the counter.

**A theory that was clean and is wrong, worth not re-deriving.** The first
version scored confidence on whether the tally had crossbars, reasoning that a
group of five checks its own arithmetic -- a missed stroke breaks the count of
five, so the reading is declined rather than returned short. Measured, crossed
groups scored WORST: 61.5% against 95.5% for a single stroke. The reason points
at the real failure. A crossbar means the volunteer counted past five, and a
tally past five is the one that runs out of room. The disagreements read "said
5, sheet 19": the strip holds the first group and the rest is elsewhere on the
card. **The counter is not miscounting what it can see; it is counting all of
what it can see, and there is more.**

### The audit, redone: 46 cells, three still wrong, and pre-filling stays OFF

The audit below was taken before the dotted-border fix and went stale, so it was
rebuilt as a script that can be re-run and re-scored rather than thrown away:

```bash
npx vite-node scripts/audit-prefills.mjs --            # list, render, score
npx vite-node scripts/audit-prefills.mjs -- --debug --only <scan> --no-show
```

It lists every cell that would clear the gate across all twenty-nine page
directories, renders each one as **the strip beside its context with the row
band ticked off**, and scores what the counter said against
`eye-labels/prefill-audit.json` -- 46 cells counted by eye. The labels are
keyed `scan:card:row`, so a change to the counter that moves which cells clear
the gate does not invalidate them, which is exactly how the last audit went
stale.

One correction to what the old audit population was: it must be the cells
`extract.ts` actually counts, which is `!hasValue && tallyMarked`. Auditing every
marked strip measures the wrong thing -- most of those cells have the answer
written in the box beside them, and the tool never pre-fills from the tally there.

**Read by eye, before any change this session: 36 of 42 right.** Six wrong, in
four kinds:

```
  imperial-6.21 14:35   said 3, is 2   printed border counted as a stroke
  seaport-7.05  18:18   said 3, is 2   the same, and the sheet says 2 as well
  seaport-7.05  18:42   said 3, is 2   the same
  pacific-3.22  14:21   said 3, is 1   a "1" written inside a drawn circle
  pacific-6.30   3:108  said 1, is 0   a long diagonal crossing three rows
  pacific-9.27  14:26   said 3, is 4   an undercount, the only one
```

#### The border failure was one bug, and it is fixed

All three border cases are the same thing, and it is not what the previous
session's note assumed. `verticalRules` asks whether a column is inked in the
margin above or below the row. **A section banner inks every column there.** So
every column reads as a rule, the run of them is far wider than `ruleWidth`, the
test concludes there is no rule in the strip and strikes *nothing* -- and the
printed border survives as a dense, full-height, perfectly upright stroke.
Roughly one row in eight on this card sits directly under a banner.

The repair is to drop rows that are inked most of the way across (`ruleCrowd`)
from the measurement rather than let them vote for every column at once, and to
treat a margin with too little left as carrying no evidence (`ruleEvidence`), so
the other side decides alone. A printed border runs through both margins, so one
clean side is enough. This also takes the row's own horizontal rules out of the
denominator, which is strictly better than the old workaround of leaving them in
-- striking their *pixels* punched a hole through the vertical rule they cross
and dropped it below the coverage bar.

Measured against the chapter's twenty-seven datasheets, it costs nothing and buys
on both axes at once:

```
                              before        after
  answers                       735          769
  of those, with a typed value  418          444
  agreement                    75.8%        79.5%
  tally-only cells             65.6%        72.7%
```

Every bucket in the by-shape table improves. Note the 81.4% quoted further down
this file is stale, and by two steps: measured on the code as it stood at the
start of the session it is 75.8%, and after the neighbouring-row test below it
is 79.8%.

`tests/tally.test.ts` has the case. The synthetic banner has white lettering
reversed out of it, and that detail is the test: `inkMask` measures against a
LOCAL paper level, so a uniformly dark band contains no ink by that definition
and the flat version of this test passes with or without the fix.

#### Ink from a neighbouring row, and the direction that separates it

Two of the four remaining failures were the same thing, and it is now refused.
`rowOverrun` in `tally.ts` traces each stroke's ink out of the strip in the
context and declines when it carries on above the row.

**Three things about this were wrong when it was first written, and each cost a
measurement.**

*The ink has to be TRACED, not extrapolated.* Following the segment's own line
out of the strip measures nothing: an angle is fitted to the straightest part of
a mark and handwriting curves. On `moonlight-7.19 7:42` the descender reads 2
degrees off vertical over the piece inside the row and leans about ten over its
whole length, so a straight line drawn from it is six pixels wide of the ink
twenty rows up and finds nothing at all.

*Total overrun does not separate the populations, at any tolerance.* Measured
over all 46 audited cells at five settings of the trace's gap and slack, the
marks belonging to another row reach 0.60 of the strip's height -- and so do
four cells the counter reads correctly. There is no threshold. This is the point
at which the obvious version of the idea should have been abandoned.

*The DIRECTION separates them, and that is the finding.* A volunteer writes
downward, so a tally that runs out of room runs out BELOW its row, while a
descender or a slash from above arrives at the top:

```
  cell                      up    down   read
  oceanbeach-8.02 3:109   0.02    0.59   right -- all three strokes hang below
  moonlight-7.05 24:42    0.00    0.55   right
  pacific-9.27   14:26    0.00    0.54   right, in this respect
  moonlight-7.19  7:42    0.35    0.00   WRONG: the descenders of "Paper"
  pacific-6.30    3:108   0.60    0.60   WRONG: a diagonal crossing three rows
```

Refusing on the downward figure throws away most of what the counter gets right.
Refusing on the upward one costs two correct cells of forty-six and removes both
readings that put a number into a box whose own row holds no tally.

```
                          before        after
  cells clearing the gate    46            42
  right, by eye              42            40
  wrong                       4             2
  precision               91.3%         95.2%

  against the 27 sheets: 769 answers at 79.5%  ->  754 at 79.8%
```

**The bar is thin and it is tuned on 46 cells.** The nearest correct cell sits at
0.28 and the nearer target at 0.35 -- about one cell of margin. The two correct
cells it discards are rows whose neighbour above holds its own tally, touching
this one, which is the same overlap that costs `verticalRules` coverage. Re-sweep
`rowEscape` when there are more labels; `audit-prefills.mjs` plus the eye labels
make that an afternoon rather than a session.

#### Pre-filling is ON, and what is still wrong

`PREFILL_GATE` in `main.ts` is **0.8**. The chapter's owner asked for it after
being shown the figures below twice, which is their call to make; every
pre-filled box is tagged *counted: check it* in the list and exported as
`recognized` rather than `human`.

**Verified end to end in the browser, not only in the mirrors.** Dropping the
10.1 Ocean Beach scan into the running app fills exactly one box -- card 2,
Foam Cups, 2 -- tagged and marked, which matches the audit and the chapter's own
sheet. (The pane runs its tab hidden, so `requestAnimationFrame` has to be
shimmed first; see "Not a bug" below.)

**The scale is small and should not be oversold.** On the 58-card test scan the
review list is 453 cells and **5 of them arrive pre-filled**. The counter can
only ever touch the 66 tally-only cells; the other 387 are handwritten numbers,
and that is the digit recognizer's problem, which is still off.

**40 of 42 by eye, 95.2%** -- and the two failures are worth more than the
figure:

```
  pacific-3.22   14:21  said 3, is 1   a "1" inside a drawn circle; the two arcs
                                       pass as uprights and the ink comes out
                                       fully explained
  pacific-9.27   14:26  said 3, is 4   four strokes, two of them hanging below
                                       the band, and one of the four missed
```

**Neither is a number invented out of nothing any more**, which is the class the
gate was shut for. One is a count out by one on a cell that does hold a tally;
the other is a circled digit, where the reading is wrong by two. The chapter's
owner has said a count out by one or two is tolerable for aggregate debris data,
and both are marked in the list and in the export as machine readings nobody has
checked.

95.2% is still short of the ~99% this project set as the bar for a pre-fill, and
that gap is the honest reason to keep looking rather than a reason to distrust
what ships: on a 58-card event it is five boxes, of which the measurement says
about one in twenty is wrong.

**The circled digit is the one to take next**, and it is harder than what came
before. The circle's two arcs are near enough to vertical to pass as uprights,
the angle spread, baseline and length tolerances all pass, and the ink comes out
0.99 explained. Nothing cheap suggests itself. It is one cell in forty-six.

### Read all 44 pre-fills by eye. Three were wrong, and pre-filling was turned OFF

*(What follows is the previous session's audit, kept because the reasoning in it
is still right and the figures are what the section above is measured against.)*

Every cell the gate would fill across all 27 scans -- 44 of them -- was rendered
and counted by eye. Most were right. **At least three counted the printed border
of the TOTAL box as a stroke**, one of them returning a number for a strip with
no tally in it at all:

```
  imperial-3.15 card 2 row 33   said 1   "stroke" at 92% of the strip width
  imperial-3.15 card 20 row 51  said 2   "stroke" at 93%
```

Those marks are dense, full height and perfectly vertical: a flawless stroke by
every test in `tally.ts`. `verticalRules` is meant to strike them and does on
most scans; where it fails, nothing downstream can tell. The ink comes out fully
accounted for and **the reading scores at the top confidence this tool issues --
one of the three was 0.95.**

**So no threshold separates them, and raising the gate does not help.** That is
the whole point: a confidence gate can only rank readings the counter
understands, and this is a reading it misunderstands completely.

`PREFILL_GATE` in `main.ts` was therefore set to 1.1 -- above any confidence, so
nothing was pre-filled -- until a strip holding only the printed border is
refused. **That was done, and the gate is 0.8 now; see the two sections above.**
The border survived one more session than this paragraph expected, because the
cause was not the one it assumes.

**Fixed, at a cost.** Rendering the context crop answered it: the border on that
card is a DOTTED vertical rule that stops dead at each horizontal row rule, so it
never spans anything and no continuity test can see it. What does see it is
asking whether the column is inked ABOVE OR BELOW the row band at all -- a
printed rule appears in the neighbouring rows, a volunteer's stroke does not.
Both known-bad cells are now refused.

The cost is coverage: answers on the test scan fall from 49 to 34, because
tallies in adjacent rows sit at similar columns, so the test also catches some
genuine strokes. That trade is right while precision is the priority and
pre-filling is off, and it is the first thing to revisit when turning pre-fill
back on -- the test could be narrowed to columns whose ink above and below is
STRAIGHT and at the same angle, which a stacked tally's strokes are not.

**An earlier attempted fix, tried and reverted.** The obvious repair is to lower the
rule bar near the sides -- `verticalRules` demands a column run the whole height
of the context, and a border that fades or is broken where a row rule crosses it
will not clear that. Measured: both known-bad cells still counted their border,
and coverage on the test scan fell from 49 to 46. So the premise is wrong for
this scan. **That mark does NOT run through the rows above and below**, which is
the whole basis of the current test, and means it is either a border only
printed within the row or something else entirely.

Before writing more code, render those two cells with their CONTEXT crop -- the
taller slice -- and look at what that mark actually does above and below the
row. Everything built so far assumes an answer to that question which the
measurement says is wrong.

Worth noting how it was found, because none of the other instruments caught it:
the spreadsheet score is a lower bound and absorbed it, the offline diagnostics
agreed with the browser, and all 112 tests passed. It took listing every cell
that would actually reach a volunteer and looking at each one.

### What the gate would ship, and the one number that decides it

`PREFILL_GATE` in `main.ts`, currently **0.80**: counts of one to four whose ink
is fully accounted for. On the 58-card test scan that is **5 of 66 tally-only
cells pre-filled**, out of a review list of 453. Small, and honestly so.

It is below the ~99% this project set for a pre-fill, and that is a decision
rather than an oversight: the figures above are lower bounds, and a miscounted
tally is wrong by one stroke where the 99% bar was written for a digit
recognizer reading "2" as "21" and being wrong by nineteen. The chapter's owner
has said a count out by one or two is tolerable for aggregate debris data. Every
pre-filled box is marked in the list and exported as `recognized` rather than
`human`.

Set it to 0.95 to pre-fill only single strokes -- the one shape measured above
95%. Set it to 1.1 to turn pre-filling off and leave the tool as it was.

### Where the coverage goes, and one repair that did not work

Of 249 marked strips on the test scan the counter answers 49. The declines:

```
  80  runs off the strip        45  strokes not parallel
  37  unexplained ink           15  no strokes
   9  too dense                  7  no ink
   6  ragged groups              1  no common baseline
```

*(Measured before the border and neighbouring-row work. The same scan reads 34
answers today, and the shape of the declines has not changed: 66 run off the
strip, 53 hold unexplained ink, 51 are not parallel. The argument below is
unaffected -- the clipped-tally test is still the largest single cost, and it
is still not worth removing.)*

The clipped-tally test is the largest single cost, so it was worth attacking.
Rendered, those 80 are a mix: numbers written in the strip, the word "(string)",
a volunteer's "Waterboard", dense multi-row messes -- all correctly refused --
and a real minority of clean countable tallies whose first stroke simply sits
against the left edge of the crop.

**Restricting the test to the right edge looked obviously correct and bought
almost nothing.** The argument is sound -- a tally is written left to right so
it runs out of room on the right, while the left edge is just where the printed
caption ends and writing begins -- and the measurement did not agree: answered
went from 49 to 52 out of 249. The strips it released were then declined for
`strokes not parallel` (45 to 77) and `unexplained ink` (37 to 44) instead,
which says the left-edge ink really was a cut stroke rather than a whole one.
Three cells is not worth removing a guard in a tool whose entire design is about
not being confidently wrong, so it was reverted.

If someone wants that coverage, the thing to separate is a COMPLETE first stroke
sitting at the edge from a stroke CUT BY the edge. Ink position alone cannot do
it; stroke width and height against the strip's own typical stroke probably can.

### Where the next work should go

**Tallies that carry on onto the next row.** This is now the dominant error and
it is unsolved. `touchesSide` catches a tally overrunning the left or right of
its crop; nothing catches one that continues below. Every "said 5, sheet 19"
disagreement is this. Fixing it would both remove the errors and unlock the
counts above five, which is where most of the volume is.

```bash
npx vite-node scripts/diagnose-tally.mjs -- test-long --show     # look at them
npx vite-node scripts/diagnose-tally-sheets.mjs -- [--show]      # score them
npx vite-node scripts/diagnose-agreement.mjs --                  # two readers
npx vite-node scripts/diagnose-segmentation.mjs --               # digit cutting
```

## Digits: a real model was tried, and nearest neighbour still wins

The note in `train-digits.mjs` saying there is no ML toolchain on this machine
was stale -- `pip install --target scikit-learn` takes about a minute -- so the
honest next method was tried. `scripts/train_digits.py` trains an MLP with
augmentation (shifts, rotations, rescalings), measured leave-one-event-out over
the same 3,218 digits:

```
                              per digit   precision at its best gate   coverage
  nearest neighbour (shipped)    66.3%              84.2%                32%
  MLP + augmentation             66.3%              81.5%                14%
```

**Augmentation does what it was expected to do and it is not enough.** Recall on
the rare classes roughly doubles -- 8s from 13% to 42%, 9s from 22% to 44% --
which is the imbalance problem largely solved. Per-digit accuracy does not move,
and precision where it answers gets *worse*. The gate is the number the design
rests on, so the recognizer stays off.

**Two things worth knowing before trying again.**

*The first two attempts diverged and reported a confidence anyway.* numpy
reported overflow in the matmuls; a diverged network still returns a softmax
that looks exactly like a confidence, which is the worst possible failure for a
design that gates on confidence. What fixed it was standardizing the inputs:
these bitmaps are ink coverage, so most of the 784 inputs are zero for every
digit in the set. Any future attempt should check for that warning before
believing a number.

*The measured accuracy is conditional in a way that is easy to miss.*
`label-from-spreadsheet.mjs` only emits a cell when segmentation already found
exactly as many digit boxes as the sheet's number has digits. Every cell where
the CUTTING went wrong was dropped before a digit was labelled, so 66.3% and
83.5% are both measured on the subset where that step had already succeeded.
`scripts/diagnose-segmentation.mjs` measures that step on its own; it had never
been measured separately.

## Two readers on one cell

`src/lib/reading.ts` puts the tally count and the digit reading of the same cell
together. They share no code and fail for unrelated reasons, so agreement is
much better evidence than either alone. Measured across the 27 pairs:

```
  both readers answered                    184 cells
  they agreed on                           155
  where they agreed, and a sheet has it    91.4%  (of 81)
  digits alone at their 0.9 gate           74.1%  (of 750)
  tally alone                              79.8%  (of 436)
```

**When they disagree, do not average them.** The chapter's owner asked for the
midpoint, on the grounds that a count out by a couple is tolerable. On the 21
disagreements with a value in a sheet:

```
  the tally alone was right        10  (47.6%)
  the digits alone were right       8  (38.1%)
  halfway between was right         5  (23.8%)
```

In 18 of the 21, one of the two readings WAS the answer. The readers do not
drift either side of the truth, which is the situation an average is for; one of
them fails outright and the other is simply correct, so averaging a right answer
with a wrong one reliably produces a third number that is on neither the tally
nor the box. `reconcile` computes the midpoint, because it was asked for, and
gives it a confidence of 0.17 -- which leaves it below the pre-fill gate.

The midpoint's hit rate has moved from one in six to closer to one in four as
the counter improved, and `splitConfidence` has NOT been moved with it. That is
deliberate: 0.17 is a statement that the midpoint is the weakest of the three
answers available, which is still true at 23.8% against 47.6%, and raising it
past the gate would pre-fill a number that is on neither the tally nor the box.
Raising it is a one-line change if the chapter decides otherwise.

## What it would take to get a volunteer down to 20 numbers

The chapter's goal is a reviewer typing almost nothing. It is worth setting out
what stands between here and there, because the effort so far has gone into the
smaller half of the problem.

On the 58-card test scan the review list is 453 cells, about 329 of which hold
something a volunteer wrote. Of the 453:

```
  cells with a number written in the TOTAL box     387
  cells with tally marks and no number              66
```

**So counting tallies can only ever touch a fifth of it.** Everything else is a
handwritten number, and reading those is the 84%-precision problem this file has
described from the start. Leaving 20 for a person means the tool correctly
filling roughly 309 of 329 -- 94% coverage at essentially perfect precision --
and almost all of that has to come from the digits.

### Segmentation is the bottleneck, not the classifier. This is new, and measured

`scripts/diagnose-segmentation.mjs` asks a question nobody had asked
separately: how often is the number CUT into the right number of digits at all?
On 1.18 Imperial Beach, over 327 written cells with a value in the sheet:

```
  cut into the right number of digits    72.8%
  too many pieces                        45
  too few                                18
  none found at all                      26
```

**A perfect classifier would therefore still be wrong on a quarter of cells**,
because "2" and "21" are different numbers of debris and no amount of confidence
in each piece fixes having the wrong number of pieces. Gating on classifier
confidence cannot catch it either: the model is perfectly confident about each
of the two digits it was handed.

This also means every accuracy figure quoted for the recognizer is conditional.
`label-from-spreadsheet.mjs` only emits a cell when segmentation already found
as many boxes as the sheet's number has digits, so 66.3% per digit and 83.5% of
whole cells are both measured on the subset where this step had ALREADY
succeeded. End to end the whole-cell figure is bounded by roughly 0.73 times
that.

Rendered and looked at, the failures fall into a few kinds, and none of them is
mysterious:

- two-digit numbers whose digits touch -- "20" written with the nought joined to
  the two -- cut into one piece or three
- a digit written in two strokes, a 5 with a detached bar, taken as two digits
- the printed border of the box arriving as a component when the number is
  written over it
- numbers written in the tally space rather than the box, so the box holds
  marks and the strip holds the number

**Fixing the cutting is worth more than any classifier work, and it is ordinary
geometry rather than recognition** -- which is the same reason the tally counter
was worth doing.

A first pass at it: joining the pieces of a digit on a small GAP as well as on
overlap in x. A nought closed badly leaves two arcs side by side and a 5 is
drawn as a bar and a bowl; those sit adjacent rather than on top of each other,
so the overlap rule missed them. Measured:

```
                     1.18 Imperial   3.22 Pacific   8.23 Seaport
  before                 72.8%           --             --
  after                  75.8%          74.7%          81.5%
```

The threshold trades one failure for the other -- join more eagerly and cells
cut into too MANY pieces fall from 45 to 18 while cells cut into too few climb
from 18 to 38 -- and it is set at the bottom of that curve.

**Splitting a wide component into two digits was tried and made it worse**: 45
cells cut into too many became 65, and the total fell to 68.5%. Single digits
are wider than tall often enough that a width rule cuts more real digits than
joined pairs. Whatever fixes touching digits has to recognise the JOIN, not the
width.

**The 26 cells where nothing is found at all are not faint pencil.** Dropping
the ink threshold from 25 to 10 changes the figure by nothing.

**They have now been rendered and looked at, and they are two different things.**
`diagnose-segmentation.mjs --kind none --show` writes just that bucket out;
attributing each one to the filter that rejected it gives, on 1.18 Imperial:

```
   4  a digit wider than 75% of the crop     -- real numbers, thrown away
   6  only specks: no component of 12 pixels
   5  too hollow (< 12% of its own box)
   4  too short (h < 18% of the crop)
   3  the threshold passed, but every dark pixel is inside the 6% inset
   3  inkThreshold refused the cell outright
   1  a horizontal bar (w/h > 3.5)
```

The first line is a defect and is **fixed**: `w > img.width * 0.75` was meant to
catch a printed rule spanning the cell, and what it actually caught was a
volunteer writing "30" across the whole box -- one component 76 pixels wide in a
100-pixel crop, 33 tall, solid. Neither of the other two rule tests touches it.
The bar can only ever fire on handwriting, because `inkMask` insets the crop by
6% a side and no component can exceed 88% of it, so it is removed rather than
loosened:

```
  cut into the right number of digits   1.18 Imperial  3.22 Pacific  8.23 Seaport
    with the width test                     75.8%          74.7%        81.5%
    without it                              76.8%          74.9%        81.5%
```

Cells cut into too many pieces do not move (28, 37, 7). Small, and free.

**The rest are not a segmentation defect.** A box holding a wisp, a tick against
the border, or nothing at all, with a number in the spreadsheet that was worked
out somewhere else -- which is the thing this file says about every
spreadsheet-scored figure, showing up here as well. Two are worth a further look
and no more: the 3 whose only ink lies inside the inset are digits written hard
against the box border, and the 5 "too hollow" have not been examined
individually.

### Regenerating the training set was called the cheapest win. It is measured, and it is not one

The previous session's note predicted that regenerating the labels against the
improved cutting would qualify more cells and buy accuracy for nothing. Done,
for all 28 pairs:

```
                              digits   events   per digit   precision at >= 0.90
  the set as it was found       3218      27       66.3%           84.2%
  regenerated against the
    gap-join cutting            3215      26       64.4%           83.7%
  and again without the
    width filter                3228      26       64.2%           83.5%
```

**The set does not grow and the model gets slightly worse each time it is made
consistent with the code.** That is the finding, and it reframes the recognizer's
headline numbers rather than adding to them: 66.3% and 84.2% were measured on
labels produced by a segmentation the repository no longer contains. Once the
labels match the code that would actually cut digits at run time, it is 64% and
83.5%. The model did not get worse; the figure was flattering.

The per-scan counts
move a great deal -- 3.22 Pacific 464 to 487, 6.13 Seaport 12 to 0, 9.26 Mission
15 to 3 -- so joining more eagerly gains cells and loses cells in almost equal
measure. Losing an event entirely (6.13 Seaport now yields nothing) is why the
event count drops.

A hypothesis for the loss, unverified and worth checking before any more
classifier work: the emit filter only asks that the number of boxes MATCHES the
number of digits in the sheet's value, so a two-digit number whose pieces are
joined across the wrong boundary still emits two boxes and labels both wrongly.
More eager joining would produce more of exactly that.

**Regenerate the training set after any change here.**
`label-from-spreadsheet.mjs` only emits a cell when segmentation found as many
boxes as the sheet's number has digits, so a change to the cutting changes which
cells qualify. That regeneration has been done against the current cutting and
re-verified on 19 Aug 2026 -- all 28 pairs re-run, every event byte-identical,
3,228 digits from 26 events, zero change. There is no pending gain here.

### How the digits are COMPARED was the ceiling, not the labels or the poll

The training set is not the lever and neither is the voting; both were measured
and ruled out before anything was changed.

```
  voting rules, on the labels as they stand
    balanced by class frequency        accuracy 64.2% -> 53.6%   much worse
    margin instead of share-of-vote    no change to the ceiling
    more neighbours (K=15)             86.3% precision at 9% coverage
    absolute distance cutoff           changes nothing at any value tried
```

Class balancing is the interesting failure. The commonest digit is `1` at 1,134
of 3,228, and the confusion matrix is full of "read as 1", so dividing each
vote by how common the digit is looks obviously right. It costs eleven points.
The rare classes are rare AND badly drawn, and promoting them promotes noise.

What actually moved was the comparison itself. Straight L2 over raw pixels
punishes a stroke drawn one pixel over exactly as hard as a different digit,
and punishes a writer's slant harder than either.

```
                                      accuracy   precision at the top gate
  raw pixels (what was measured)        64.2%           83.5% @ 32%
  + deskew and recentre                 67.3%           84.7% @ 35%
  + 3x3 blur                            68.4%           85.4% @ 35%
  + nine one-pixel query offsets        70.0%           86.0% @ 37%
```

Coverage rose at every threshold as well, so this is not a precision-for-
coverage trade: at the 0.80 gate it is 49% -> 54% of digits answered. All three
steps are in `train-digits.mjs`; a query must get the same preparation as the
exemplars or the distances are meaningless, which is why the emitted model's
note now says so.

**What the targets actually cost, measured over K in {5,9,15,21,25} and both
confidence rules.** This is the table to quote when someone asks for a number:

```
  target precision    digits it can still answer      reachable
    80%                2408 of 3228  (74.6%)            yes
    85%                1681 of 3228  (52.1%)            yes
    90%                 470 of 3228  (14.6%)            yes
    95%                  --                             NO, at any setting
   100%                  --                             NO, at any setting
```

Precision above 90% is not a threshold that has not been found; it does not
exist on this data with this model. Even the digits where all twenty-five
nearest neighbours agree contain errors, so no confidence gate can isolate a
clean subset. **90% accuracy -- every digit right, nothing declined -- is 20
points away and is not reachable by tuning.** The honest routes are better
cutting first (item 2 of the brief) and then a convolutional net, in that
order, because a classifier cannot read a digit that was never cut out.

**None of this is in the shipping app.** `src/main.ts` calls
`reconcile(tally, null)`: the digit reader is passed as `null` and
`assets/reference/digit-model.json` is written by the trainer and read by
nothing. The recognizer is offline research, the README is right that the tool
does not read handwriting, and the five pre-filled cells on the test scan all
come from the tally counter. Improving these numbers changes what a volunteer
sees only after the model is emitted, shipped and wired in, which is a separate
piece of work with its own asset-size and `check-dist` consequences.


### The toolchain everyone assumed was absent

Both of these install on this machine in about a minute with
`pip install --target`, and the note in `train-digits.mjs` saying otherwise is
wrong:

```
  scikit-learn 1.6.1     tried; an MLP with augmentation does not beat
                         nearest neighbour at the gate (81.5% against 84.2%)
  torch 2.8.0            installs cleanly. A real convolutional net is
                         untried, and is the honest next attempt AFTER the
                         cutting is fixed -- not before, because a better
                         classifier cannot read a digit that was never cut out.
```

## What to do next

The shortest list of what is worth doing, in order:

1. **Digit SEGMENTATION**, measured at 72.8% and capping everything downstream.
   The largest single lever on how much a volunteer has to type, and it is
   geometry rather than recognition. See "What it would take" above.
2. **Ink that crosses a row boundary, in either direction** -- see "Counting the
   tallies" above. A tally continuing onto the next row is the dominant error in
   the counter and the thing standing between it and the counts above five,
   which is where most of the volume is. The pre-fill audit of 2026-08-13 found
   the mirror image of it and it is worse: another row's marks reaching INTO
   this one -- a diagonal crossing three rows, the descenders of a word written
   above -- put a number into a box whose own row holds no tally. Two of the
   three remaining wrong pre-fills are this. One mechanism answers both: follow
   each stroke's own line into the context above and below and refuse the
   reading where the ink carries on.
3. **The 131 cells the review list still offers with nothing in them** -- see
   "What is still on the list that should not be" below. Another quarter of a
   reviewer's time, and the remaining noise is a different kind from the ruling
   that has been dealt with.
4. **Memory**, under "Also outstanding". A 114-page scan peaks near 840MB
   because every page is kept at full resolution; cropping and discarding would
   make it a few MB. This is the thing most likely to make the tool fail on
   somebody else's laptop.
5. ~~**Counting tallies.**~~ Built; see above.

Digit recognition is NOT on that list, for the reasons immediately below.

**Recognition is built and measured, and is not good enough to ship.**
`scripts/label-from-spreadsheet.mjs` turns a matched pair into labelled digits
with no hand-labelling, and `scripts/train-digits.mjs` measures what they buy:

```bash
node scripts/label-from-spreadsheet.mjs out/pages/imperial-1.18 \
  assets/pairs/1.18.25_Imperial-Beach_Data.xlsx imperial-1.18
node scripts/train-digits.mjs
```

Twenty-eight pairs are in `assets/pairs/`; twenty-seven are usable, yielding
**3,218 digits**. Measured leave-one-EVENT-out (train on twenty-six events,
test on the twenty-seventh, rotate):

```
per-digit accuracy, all digits                66.3%

  confidence   answered      precision   whole cells right
  >= 0.50      2568 (80%)      74.3%       72.7%
  >= 0.70      1895 (59%)      80.3%       79.9%
  >= 0.90      1014 (32%)      84.2%       83.5%
```

**Those figures are the stale ones.** They were measured on a training set built
by a segmentation this repository no longer contains; regenerated against the
current cutting the same measurement gives 64.2% per digit and 83.5% at the 0.90
gate. See "Regenerating the training set" above.

### More scans have stopped helping. This is measured, and it is the finding

```
 7 scans, 1,183 digits    63.0% accuracy    81.7% precision at best confidence
18 scans, 2,463 digits    66.3%             84.3%
27 scans, 3,218 digits    66.3%             84.2%
```

Nine additional pairs -- 646 pages, four beaches never seen before -- moved the
number by nothing. Nearest-neighbour over raw pixels has saturated: every new
digit is close to one already in the set, so the poll it joins does not change.

**Do not respond to this by collecting more scans.** The chapter has none left
to give, and the curve says they would not help if it had.

### Deslanting was the suggested fix. It is measured, and it makes things worse

An earlier version of this section proposed "deskewing and thinning the strokes
before matching" as the way past 66%. Deslanting is the standard version of that
-- shear each digit upright by its own second moment, which is worth several
points to a nearest-neighbour model on MNIST. Measured here, leave-one-event-out
on all 3,218 digits:

```
                     per digit    precision at conf >= 0.90    cells fully right
baseline               66.3%              84.2%                     83.5%
blur                   68.6%              84.0%                     83.2%
deslant                64.5%              81.9%                     81.3%
deslant + blur         66.2%              83.5%                     83.2%
```

Blur buys 2.3 points of raw accuracy and nothing at the gate. Deslanting is
actively harmful, which in hindsight is not surprising: these are counts of
beach debris written in a hurry, so the class distribution is dominated by 1s,
and shearing makes a slanted 1 look more like an upright 1 AND more like a
7 -- it removes the very cue that was separating them.

**The number that decides the design is precision where the model answers, and
nothing tried has moved it off ~84%.** A CNN remains untried, but note what it
would have to do: a confidence-gated pre-fill needs about 99% precision, and it
would have to reach that while also roughly tripling coverage.

**Still not shipped.** The design is a pre-fill the human confirms, gated on
confidence, and that needs precision near 99% on the cells it chooses to
answer, because a wrong number invites agreement. 84% means one pre-filled cell
in six is wrong, which is worse than an empty box beside a picture of the
handwriting.

Recall remains lopsided -- 92% on 1s, 20% on 8s, 14% on 9s -- and nearly every
error is some digit read as a 1. There are 1,142 ones against 50 nines, and no
number of extra scans changes that ratio: it is how counts of beach debris are
distributed. Balanced digits would have to be written deliberately rather than
collected, and the chapter cannot ask volunteers to do anything extra.

### How the card-to-column mapping is settled, and two wrong turns on the way

Every card gets its own column. That is the chapter's rule, it holds for every
scan, and nothing here infers an offset from it. What varies is that a person
typing up thirty cards occasionally slips -- a card into the wrong column, one
entered twice. One here and there does not matter to the chapter's data; it
matters to a training set, because a mis-typed card labels every digit on it
with someone else's numbers.

So each card is checked against its own column and dropped on its own if it
disagrees, keeping the rest of the scan. 42 of 204 cards are dropped this way.
The check compares DIGIT COUNT -- where the card has ink and the sheet has a
number, "12" should segment into two pieces. It is blunt (most counts on a
beach card are one digit, so a wrong column still agrees about half the time by
chance) which is why the bar is low and cards are trusted by default.

Two earlier versions were wrong, both worth recording:

- **A per-card gate on ink presence, at 90%.** A volunteer who writes `0` in
  every box leaves ink where the sheet -- which omits zeros -- has nothing, so
  a perfectly typed card scored near zero. It dropped 150 of 204 cards, most of
  them good.
- **A fitted per-card column drift.** Several scans agree better one column
  over, and fitting that was tempting. The evidence was real but it was the
  wrong evidence: ink-presence agreement measures WHERE ink is, and two
  neighbouring volunteer columns are both sparse in similar rows, so a wrong
  column matches the pattern while every value on it is wrong. Training caught
  it -- drift-fitted scans classified at 26.7% against their own 36.4%
  guess-the-commonest baseline. There is no drift to fit.

The per-card check is what took the training set from 7 usable scans and 1,183
digits to all 18 and 2,463, and accuracy from 63.0% to 66.3% at the same time.
More data and better labels, which is the shape of a real fix rather than a
trade.

### A bug worth knowing about

`normalizeDigit` in `scripts/lib/cardvision.mjs` computed its sampling window
by mixing box-relative and absolute coordinates, so every digit bitmap averaged
in the paper to the right of the digit. 77% of training digits peaked below
half intensity. **Every accuracy figure recorded before this was measured
through that bug**, including the 43.8% the last handoff quoted.

### Ground truth re-keyed

The by-eye ground truth is now keyed `card:row`, which survives pipeline
changes; it was keyed by index into `out/crops/cells.json`, which is rebuilt
every run. Its 11 "bad crops" are resolved: re-cropped after the registration
fix, every one is an *empty* TOTAL box (ink 0.000-0.003 against 0.025 for a
written cell). The old registration had landed those boxes on a section banner,
so the reader saw the printed word TOTAL. They are listed under `resolvedEmpty`
so the count of 181 still reconciles.

## Shipping: what a first real event needs, and what it has

**The export is proven end to end, which it was not before.** Every other check
in this repository asserts that the writer produced a particular string, and
none of them could catch the failure that would actually corrupt the chapter's
data: a value landing in the wrong volunteer's column or against the wrong
debris item. That failure is uniform, it looks like ordinary data, and nothing
downstream of the export could ever detect it.

Two checks now close it, and they are deliberately independent of the writer:

- `tests/xlsx-export.test.ts` fills the real template with `card * 1000 + row`
  in every one of the 83 items across five cards -- including card 1, card 78
  (column BZ) and the gaps between -- then reads the bytes back with a parser
  that shares no code with the writer, so a misplaced number reports how far it
  moved. It also asserts the export adds numbers NOWHERE else, compared against
  the numeric cells the template already carries.
- The same property was then driven through the running app on a real scan:
  61 values typed into the boxes, the download button clicked, the resulting
  file unzipped in the page, all 61 in the right cell and the head count with
  them.

Two things about writing those are worth keeping. The card-to-column mapping is
by card NUMBER, not by position in the list -- writing it as "the third card I
was handed goes in the third column" is how a scan with a missing card silently
attributes every value after it to the wrong volunteer. And the first version of
the round-trip parser did not handle self-closing cells, so it ran past
`<c r="C18" s="10"/>` to the next closing tag and read a different cell's value
under this cell's reference: it reported 166 misplaced numbers that were all in
the right place. A test's own parser is code too.

**The app now says what it does not do**, above the drop zone and before anyone
has committed an afternoon to it. A volunteer arriving expecting the numbers to
be read for them meets 450 empty boxes and concludes the tool is broken; it is
not, and filling those boxes is the job. That sentence is cheaper than any
amount of accuracy work.

### Still wanted before it goes wider than a trial

- **Someone downstream opening a filled spreadsheet.** The format is verified
  against the template and the values are verified into the right cells, but
  nobody has confirmed the chapter's data person accepts a real one.
- **A second browser.** Safari private mode is handled explicitly (localStorage
  throws there, and the review page says so rather than letting an hour of
  typing vanish), but every click-through so far has been Chrome.
- **A real event with a real volunteer, watched.** Every serious bug in this
  project was found that way and not by measurement: three boxes holding numbers
  nobody typed, a pre-fill short by one stroke. The whole test suite passed
  through both.

## The review list: halved, and nothing written was dropped

The tool used to show a reviewer every cell with enough dark pixels in it. On
the 58-card test scan that was **730 cells, 12.6 a card**, and reading all 730
by eye found **277 holding writing and 450 holding nothing but printed ruling**.
Roughly two thirds of what a person was asked to look at needed no looking at.

`src/lib/marks.ts` now answers "did a person write here" instead, and
`extract.ts` offers a cell only when it says yes:

```
                          58-card test scan     all 28 scans, 592 cards
offered before                730  (12.6/card)     9,683  (16.4/card)
offered now                   453   (7.8/card)     7,180  (12.1/card)
cells with writing kept     277/277               see below
tally strips with marks      49/49
```

The gain is very uneven: 44% shorter on 3.22 Pacific Beach, 39% on 1.18
Imperial, and nothing at all on 9.26 Mission Beach. The scans that barely
improve are the dirty ones, where what the reviewer is being shown is not
printed ruling.

**Why an ink fraction cannot do this job**, which is the finding worth keeping:
a hairline pencil "3" covers less of its box than a sliver of the printed rule
above it. The band the ruling lives in also holds real numbers -- 2, 4, 15, 3
and a whole "52" were read out of it by eye. On quantity, the ruling wins at
every threshold. So the test is about shape and place instead; the head of
`marks.ts` sets out the four parts and the two guards, each of which was a real
failure on a real scan before it was written.

### What it was measured against, and in what order

1. **730 cells of the test scan, read by eye.** Every TOTAL box, and every tally
   strip belonging to a cell the box test drops. Recorded in
   `eye-labels/test-long*.json`, keyed to a frozen crop cache so a filter
   can be re-scored against the same pixels in a second. Re-reading those cells
   is a couple of hours; do not throw the labels away.
2. **A held-out scan.** The first version that scored perfectly on the test scan
   lost three real values on 1.18 Imperial Beach -- a dense tally struck out as
   ruling, and two handwritten "1"s struck out as the box's wall. Both guards in
   `marks.ts` come from that, and this is the reason to keep validating on a
   scan the thresholds were not chosen on.
3. **Every value the chapter ever typed up.** `diagnose-review.mjs --all` scores
   the mark test against all 28 matched spreadsheets: card N against column N,
   no offset inferred.

That third check needs reading carefully, and it is the trap this project keeps
falling into. Across all 28 sheets:

```
values typed up                                   9,526
of those, never offered even by the old rule      5,798
of the 3,728 that were, dropped by the mark test    229
```

**229 is not a failure rate, it is an upper bound**, and treating it as a rate
would be the same mistake as treating an ink threshold as ground truth. A column
typed one across, a number recorded on the other side of the card, a value
entered against the wrong item, a total the data-entry person worked out from a
tally -- each of those looks exactly like a dropped value and is not one. The
only way to tell is to look, so `--show` writes the dropped cells out as a
contact sheet.

**127 of the 229 were rendered and read, one at a time** -- every one on 1.18
Imperial, 7.5 Moonlight, 6.21 Imperial, 6.28 Seaport and 8.2 Ocean Beach, which
between them hold the five largest sets. All but one were empty cells: the
spreadsheet holds a number and the card does not. The one that was not is the
reason the height bar has a ceiling on it now -- a 24-pixel tick on a 99-pixel
row, which the bar as a pure fraction asked 25 pixels of. It is kept, and so is
everything that was already kept.

That leaves about 100 unlooked-at, a handful on each of the remaining scans.
Look at them before calling this finished; `--show` makes it ten minutes a scan.

Note the middle line too. On most scans the OLD rule already failed to offer the
majority of typed values, because the cell on the card is genuinely blank: the
number lives in the spreadsheet and was never written in the box. That is a fact
about how the chapter works, not a defect, and it is why the spreadsheets can
only ever bound this measurement rather than settle it.

```bash
# the review list for one scan, and its recall against the chapter's own sheet
node scripts/diagnose-review.mjs out/pages/<name> scans/<sheet>.xlsx --show
node scripts/diagnose-review.mjs --all          # every matched pair

# freeze a scan's cells to disk, then render any subset of them to look at
node scripts/review-cache.mjs out/pages/<name> <name>
node scripts/review-sheets.mjs <name> --region total --cols 10 --scale 1

# the same list, computed by the modules the BROWSER runs, not the mirrors
npx vite-node scripts/run-shipping-path.mjs -- out/pages/<name>
```

`run-shipping-path.mjs` is the guard against the one lie this project's
diagnostics can tell: everything else under `scripts/` measures through
`lib/cardvision.mjs`, the offline mirror of the browser's registration. If it
and `diagnose-review.mjs` ever disagree about a scan, the mirror has drifted.
They agree today -- 450 cells on 1.18 Imperial Beach from both.

### What is still on the list that should not be

Of the 453 cells the test scan now offers, **124 hold nothing** -- dirty crops,
smudges, ink bled through from the other side, and a neighbouring row's stroke
hanging over a boundary. Getting those out is worth perhaps another quarter of
the list and is where to look next, but note the shape of the remaining problem:
they are cells with real ink in them that belongs to something else, not cells
the detector misreads.

### Three approaches measured and rejected, worth not repeating

- *Raise the ink threshold.* The marginal band 0.008-0.025 is full of real faint
  numbers. This is why the floor is low in the first place.
- *Subtract the blank card's own ink.* The reference contributes essentially
  nothing at these rectangles (p50 0.0000), so it changes nothing. Note this is
  NOT the same as the local-paper subtraction `marks.ts` does, which works.
- *Reuse `segmentDigits` as the test.* It is tuned to extract CLEAN digits for
  training and rejects anything thin or touching a border; it threw away 35 of
  148 real cells while barely shortening the list.

### Careful with the arithmetic here

An earlier version of this section said 582 of the 730 were noise. That came
from treating "ink >= 0.025" as ground truth for "a person wrote something", and
it badly undercounts faint pencil. The real figure, from reading all 730, is
450. Any future measurement of this needs cells looked at by eye, not a
threshold standing in for truth.

## Losing an afternoon's typing: fixed

Typing up a 58-card event is 450 numbers read off 450 pictures. All of them used
to live in one in-memory `Map`, with no persistence and no warning on unload: a
reload, a stray Cmd-W or a tab crash took the lot. That was the worst outcome
this tool could produce short of wrong numbers, and it was one keystroke away.

`src/lib/draft.ts` now saves to localStorage on every edit, debounced, and
`beforeunload` asks before the tab goes. Three things it deliberately does not
do, each for a reason:

- **It never restores on its own.** The draft is offered with its age and how
  many values it holds, and the reviewer says yes. Putting numbers into boxes
  unasked is the failure the whole tool is built to avoid.
- **It never offers a draft for a different file.** Values are keyed by card
  number and taxonomy row, which mean one thing for one PDF and something else
  for another, so the draft carries a fingerprint -- file name, file size, card
  count, cell count -- and is only offered on an exact match.
- **It never leaves the machine.** Same origin, same browser, no network.

If the browser refuses to store anything -- Safari in private mode has the whole
localStorage API and throws on write -- the review page says so rather than
letting someone type for an hour believing it is being kept.

### The browser will fill boxes in by itself, and `autocomplete="off"` does not stop it

Chrome restores form state across a reload, matching fields by position. This
tool creates several hundred inputs from script, and which item each one stands
for depends on the PDF, so a restored value lands against whatever item happens
to sit at that index. It fires `input` when it does, so it writes itself into
`state.values` and would be exported as though a person had read it off the
card.

`autocomplete` governs autofill suggestions, not session restore. What actually
undoes it is `assertTypedValues` in `main.ts`: after the list renders, and again
when the page returns from the browser's cache, every box is set from
`state.values` and anything the browser put there is discarded. The deferral to
the next frame is load-bearing -- the restore happens after the elements are
inserted.

Worth knowing how this was found, because measurement would not have: it turned
up on the first real click-through, as three boxes holding numbers nobody had
typed.

## The built bundle: one bug fixed, one still open

Both were found the only way they can be -- by loading `dist/` in a browser and
reading a real card through it. Every test in this repository runs the SOURCE,
so neither is visible to any of them.

**Fixed: the PDF worker never loaded.** pdf.js builds its worker from
`workerSrc` with `new Worker(url)` -- a classic worker -- and the file it was
given is an ES module, so the first `export` was a syntax error, the worker died
before saying anything, and the app sat on "Reading the PDF…" for ever. `npm run
dev` was unaffected, which is how it survived. `src/lib/pdf.ts` now constructs
the worker itself with `type: "module"` and hands it over as `workerPort`.

Note for anyone tempted to tidy this: Vite's `?worker` import is the neater way
to write it and does NOT work here. It emitted `new Worker(url)` with no options
for this dependency even with `worker: { format: "es" }` in the config -- the
same classic worker, the same syntax error.

This was present before the tally work and is not a regression from it; verified
by stashing those changes, rebuilding, and reproducing it.

**Not a bug: `page.render()` appearing to hang under automation.** With the
worker fixed the document opened and then rendering never came back -- no error,
no rejection, the promise simply never settled, at every canvas size down to
306x396. The cause is that the automated browser pane runs its tab HIDDEN:
`document.visibilityState` is `"hidden"` and `requestAnimationFrame` never
fires, and pdf.js drives rendering through rAF. Fronting the tab made it
resolve immediately, one page per screenshot.

So there is nothing to fix in the app. Anything driving this tool from a hidden
or background tab needs `window.requestAnimationFrame = (cb) => setTimeout(cb, 0)`
as a harness shim; a person with the page in front of them needs nothing.

Worth knowing before spending an afternoon on it, because every symptom points
at the PDF pipeline and none of them is the PDF pipeline.

### What clicking through the built bundle actually found

The click-through was not ceremony. Both cells the tool pre-filled on the 10.1
Ocean Beach scan were WRONG, each short by the one stroke written hard against
the left edge of the strip, and both reported their ink fully accounted for.

The cause: `countTally` disabled the mark test's wall rule with `wallEdge: 0`,
which is the obvious way to write it and does not work. `marks.ts` floors the
edge at two columns, so a stroke landing within two pixels of the side after
trimming was struck out anyway -- and took up to six columns with it. Disabling
it properly needs `wallFrac: 2`, a bar no column can clear.

That one line is the difference between a reviewer being handed 1 and being
handed 2. Nothing else caught it: the offline diagnostics agreed with the
browser, the spreadsheet score moved by less than a point, and all 111 tests
passed throughout. It was found by rendering the two cells that reached the
screen and counting the strokes by eye.

## Also outstanding

- ~~**Tally marks are still not COUNTED.**~~ Counted now, behind a gate; see
  "Counting the tallies" above. The paragraph below is kept because its figures
  are what made the case for doing it.
- **Tally marks were not COUNTED, and they are the majority of the data.**
  Across eleven scans measured under the old card gate, 1,217 of the 1,611
  values on dropped cards had been tallied and never written as a number.
  Counting strokes is a different problem from reading digits and is where
  Claude vision did worst (64% detection, 28% false positives), so it is worth
  doing properly rather than as an afterthought. What IS handled: `stripMarked`
  decides whether a strip holds a tally at all, and the review UI shows those
  cells with the strip beside an empty box for the human to count. It finds
  every one of the 49 tallies on the test scan that the reviewer would otherwise
  have had to hunt for.
- ~~**Memory.**~~ Fixed. Was ~840MB of browser heap on a 116-page scan, because
  every page was held at full resolution twice over -- once rasterized, once
  registered. Now each page is rendered, aligned, cut into its cells and dropped
  before the next is read, and a cell keeps a crop of its own row rather than a
  reference to the page. Measured on the same scan: **26MB held, 33MB peak**,
  against 816MB of page data under the old shape.
- **The side classifier is wrong on every Imperial Beach front.** Its footer
  test assumes the donation footer is in the bottom 7% of the page, which is
  false when the card sits low and its foot is cropped off. It no longer
  matters -- alignment decides the side now, and the classifier only picks
  which reference to try first -- but the `classification` field it reports
  should not be trusted as a signal on its own.

## Ground truth for measuring

`eye-labels/test-long.json` and `test-long-tally.json` hold every cell of
the 58-card test scan's review list, read by eye: 277 TOTAL boxes with writing
against 450 without, and 49 tally strips with marks against 86 without. They are
keyed to the cell ids of a `review-cache.mjs` cache, so re-scoring a candidate
filter against exactly those pixels takes a second. They live under `/scans/`
with the volunteer data -- outside `assets/`, so `npm run build` cannot publish
them, and gitignored. Reproducing them is a couple of hours of looking; the
labels are the expensive part of this session, not the code.

Two entries there are marked `spillover` and `unsure` rather than blank. Those
are honest: one is the feet of the row above's tally hanging into the row below
(verified by rendering four consecutive rows together), and the others are
specks that could be a pencil tick or could be grit. Keeping them apart from the
blanks means neither can prop up a recall claim nor sink one.

`assets/reference/labels-pacific-beach.json` holds 181 cells of the 9.27.25
Pacific Beach event read by eye: 131 numeric, 30 tally, 9 unclear, and 11 that
were bad crops and are now known to be empty boxes. It is keyed `card:row`.
The 9 unclear ones are the ceiling -- no recognizer should be trusted to beat
what a person can read from the same pixels.

It is also the only labelling in this project that does not come from a
spreadsheet, which makes it the one independent check on the auto-labeller.
Worth using that way: the 9.27 scan has no matching spreadsheet, so it can be
held out as a clean test set the training pipeline cannot have contaminated.
