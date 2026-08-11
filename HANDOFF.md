# Handoff

State of the project, what is proven, and the one thing blocking progress.

## What works and is verified

| Piece | Status |
|---|---|
| `src/lib/taxonomy.ts` | Generated from the chapter's template. 83 items, 11 sections. |
| `assets/reference/blank-{front,back}.png` | Blank card synthesized by median-compositing 41 real cards. |
| `assets/reference/cells.{front,back}.json` | All 83 TOTAL boxes located, verified against the debug overlay. |
| `src/lib/xlsx/` | Export. Verified against the chapter's real completed datasheet format. |
| The web app | Runs end to end: drop a PDF, review crops, download the spreadsheet. |

29 vitest tests and 27 stdlib-Python checks pass. `npm run dev` to run it.

## The blocker: registration does not generalize across scans

This is the single thing to fix next. Everything downstream is already built.

The blank reference was composited from the **9.27.25 Pacific Beach** scan, and
alignment works beautifully on that scan and only that scan:

```
Pacific Beach fronts   best shift 0 to 7px      correlation 0.95 - 0.98
Imperial Beach fronts  best shift pinned at 80  correlation 0.55, one page 0.12
```

80px is the search limit, so the true offset is beyond it -- and a correlation
of 0.55 means it is not merely shifted, the row profile genuinely does not
match. Cropped cells land on section banners and row boundaries instead of TOTAL
boxes. Symptom to recognise: ~20 "inked" cells per card instead of ~3, and
contact sheets full of crops showing the word "TOTAL".

Reproduce:

```bash
node scripts/diagnose-shift.mjs <dir-of-page-jpegs>
```

Ideas worth trying, roughly in order:

1. **Widen the shift search and check for aliasing.** The card is a periodic
   grid, so row-profile correlation has near-equal optima one row apart. A
   coarse-to-fine search, or restricting correlation to the non-periodic parts
   of the page (the masthead and section banners), should be more stable.
2. **Estimate scale, not just translation.** Pages vary 1678-1700 x 2172-2416.
   Two of 62 Imperial Beach pages are ~2410 tall against a 2185 reference --
   that is a different paper size, and no translation fixes it.
3. **Anchor on the section banners.** They are the most unambiguous marks on the
   card (they ink ~90% of a block's width where a caption inks ~10%) and they
   are not periodic, so they cannot alias. `bannerBands()` in
   `scripts/detect-cells.mjs` already finds them reliably.
4. **Verify per page rather than trusting.** Any page whose correlation after
   alignment is below ~0.85 should be refused and surfaced, not processed. A
   misregistered page silently produces plausible-looking wrong numbers, which
   is the worst failure this project can have.

## Recognition: built, measured, not good enough yet

`scripts/train-digits.mjs` reports, leave-one-cell-out:

```
segmentation   91.6% of numeric cells split into the right digit count
per-digit      43.8%
needed         ~93% per digit for ~87% value accuracy
```

Not shipped, deliberately -- a 43.8% reader would put a wrong number in the
spreadsheet every other digit, which is worse than the tool asking a human.

The cause was 144 training digits from one event with hopeless class balance
(37 twos, one nine). **That constraint is now removed** -- see below.

## Training data is available and no longer the constraint

Five matched (PDF, completed spreadsheet) pairs are on the Desktop:

```
1.18.25_Imperial-Beach_CH54.pdf   1.18.25_Imperial-Beach_Data.xlsx
3.15.25_Imperial-Beach_CH54.pdf   3.15.25_ImperialBeach_DataEntry.xlsx
3.22.25_Pacific-Beach_CH54.pdf    3.22.25_PacificBeach_Data.xlsx
4.16.25_Imperial-Beach_CH54.pdf   4.16.25_Imperial-beach_data.xlsx
5.21.25_Pacific-Beach_5.21.25.pdf 5.21.25_PacificBeach_Data.xlsx
```

`scripts/label-from-spreadsheet.mjs` turns a pair into labelled digits with no
hand-labelling: card N of the scan is volunteer column N of the sheet, so every
non-zero sheet cell labels a specific TOTAL box. Roughly 30 cards and 400
digits per pair, so ~2,000 digits once registration works.

Two things already learned about that mapping, both worth keeping:

- **The card-to-column mapping is correct**, confirmed by sweeping offsets
  -3..+3 and seeing offset 0 win clearly (38% against ~22% for every other).
- **Only score the mapping in one direction.** Where there is ink in a TOTAL
  box, the sheet should have a number. The reverse is *not* a fault: a volunteer
  who only tallied leaves the TOTAL box empty while the person entering the data
  counted the marks and typed a number anyway. Scoring both directions rejected
  all 31 cards of a correctly-mapped scan at a suspiciously uniform 70-85%.

## Also outstanding

- **Tally marks are not handled at all.** A real fraction of cells are tallies
  rather than numbers -- 30 of 181 on Pacific Beach, and many more on Imperial
  Beach. Counting strokes is a different problem from reading digits and is
  where Claude vision did worst (64% detection, 28% false positives), so it is
  worth doing properly rather than as an afterthought.
- **Memory.** A 114-page scan peaks around 840MB of browser heap because every
  page is kept at full resolution. Cropping each page and discarding the full
  image would cut that to a few MB.
- **6% of cells landed on the wrong page region** even on the good scan --
  the same registration problem, at lower severity.

## Ground truth for measuring

`assets/reference/labels-pacific-beach.json` holds 181 cells of the 9.27.25
Pacific Beach event read by eye: 131 numeric, 30 tally, 11 bad crops, 9 unclear.
The 9 unclear ones are the ceiling -- no recognizer should be trusted to beat
what a person can read from the same pixels.
