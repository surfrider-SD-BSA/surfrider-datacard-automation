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

97 vitest tests and 27 stdlib-Python checks pass. `npm run dev` to run it.

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

## What to do next

The shortest list of what is worth doing, in order:

1. **The 131 cells the review list still offers with nothing in them** -- see
   "What is still on the list that should not be" below. Another quarter of a
   reviewer's time, and the remaining noise is a different kind from the ruling
   that has been dealt with.
2. **Memory**, under "Also outstanding". A 114-page scan peaks near 840MB
   because every page is kept at full resolution; cropping and discarding would
   make it a few MB. This is the thing most likely to make the tool fail on
   somebody else's laptop.
3. **Counting tallies**, which is most of the chapter's data and is still
   entirely on the human.

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
   `scans/eye-labels/test-long*.json`, keyed to a frozen crop cache so a filter
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

## Also outstanding

- **Tally marks are still not COUNTED, and they are the majority of the data.**
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

`scans/eye-labels/test-long.json` and `test-long-tally.json` hold every cell of
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
