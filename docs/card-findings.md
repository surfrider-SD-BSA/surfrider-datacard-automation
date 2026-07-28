# What the physical card actually looks like

Measured from `assets/reference/sample-card.pdf` (Moonlight Beach, 2/21/26).
These supersede `data-card-layout.md`, which was written from the spreadsheet
rather than from the card, and got several things wrong.

## 1. The plan's highest-impact question, answered

> Does the card give each digit its own printed box, or is the number
> free-written in a cell?

**Free-written.** The TOTAL column is a single open cell per row with no digit
boxes and no comb lines.

This is the harder of the two answers. Digit segmentation is now a real failure
mode rather than a free one, and touching digits are a live risk. It moves the
Phase 3 expectation toward the middle-to-lower rows of the plan's accuracy
table, not the top.

## 2. Each page is TWO independent columns

The layout doc describes a single grid with one TOTAL column. The card is
laid out as two side-by-side blocks per page, **each with its own TOTAL
column** — four TOTAL columns across the two pages.

The template's shared-formula blocks line up with the printed blocks exactly,
which is why rows 34, 43, 52, ... are blank: they are column and section breaks
on paper.

| Side | Column | Section | Rows |
|---|---|---|---|
| front | left | Common & Priority Items | 18–33 |
| front | right | Food & Beverage Packaging | 35–42 |
| front | right | Personal Care | 44–51 |
| back | left | Smoking | 53–57 |
| back | left | Fishing | 59–69 |
| back | left | Other (Plastic / Foam) | 71–78 |
| back | right | Glass | 80–82 |
| back | right | Paper & Wood | 84–94 |
| back | right | Metal | 96–100 |
| back | right | Rubber & Latex | 102–105 |
| back | right | Other Materials | 107–110 |

## 3. Smoking is on the BACK

`CLAUDE.md` put Smoking/Tobacco (rows 53–57) on the front, presumably because
the row numbers sit next to Personal Care. On the card it is the first block on
the back, under the "PLASTIC & STYROFOAM CONT." banner.

Corrected split: **front = rows 18–51 (32 items), back = rows 53–110 (51
items)** — previously recorded as 37/46.

## 4. The pre-printed instructions box is a false-positive trap

Confirmed present in the upper right of the front page: a "COMMON & PRIORITY
ITEMS" example box pre-printed with realistic tally marks *and* totals
(74, 16, 3, 8) for Cigarette Butts, Plastic Bottles, Plastic Bags, and Plastic
Straws.

It looks exactly like real volunteer data and sits directly above the real
grid. Any recognizer that sweeps the page will read it as four items on every
single card.

It is in a fixed printed position, so the cell map should carry an explicit
exclusion rectangle and the pipeline should never sample inside it.

## 5. Resolution: this file is 72 DPI and that is a sharing artifact

The PDF is 613×793 px per page — **72 DPI**. Handwritten digits measure about
**7–9 px tall**. For scale, MNIST gives a *single* digit 28×28.

Recognition at this resolution is not realistic. But the file's own metadata
shows this is not what the scanner produced:

```
Producer     Skia/PDF m150
Creator      Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
Title        2.21.26_Moonlight-Beach_CH54 - Google Docs
```

Skia + Mozilla + "- Google Docs" means somebody opened the file in a browser
preview and used **Print → Save as PDF**. That path rasterizes the on-screen
preview at screen resolution and throws the original away.

**The original scan is still in Google Drive and is almost certainly much
higher resolution.** It needs to come across as the original file — downloaded,
not printed. This single step probably matters more to Phase 3 than any
modelling decision.

## 6. It is not a blank card

The sample has real data on it: `157 vol`, `Moonlight Beach`, `2/21/26`, and
about ten filled rows.

A near-empty card is still workable as a registration reference — registration
keys off the printed grid, and the few filled cells can be masked. But a truly
blank one is better and costs one trip to the scanner.

## Consequences for the build

- `taxonomy.ts` regenerated with corrected sides plus a new `column` field.
- `cells.ts` carries `column` per cell, and the overlap check now compares only
  within a column, since left and right rows legitimately share a vertical band.
- The cell map needs an exclusion rectangle for the instructions box.
- Phase 3's estimate should be revised down until we see a real-resolution
  scan of free-written digits.
