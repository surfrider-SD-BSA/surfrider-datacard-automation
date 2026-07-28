# Calibration — producing the cell map

The pipeline never *detects* where a number is. Once a scanned page is
registered against a reference image of the blank card, every cell's location
is a constant. Those constants come from here.

This has to be done once per card design, and redone if the chapter reprints
the card with a different layout.

## Step 1 — scan a blank card

- **Blank**, not a filled-out one. Marks in the cells corrupt the reference.
- Front and back, as two pages.
- **300 DPI**, grayscale or colour, no auto-crop, no auto-rotate, no
  "enhance"/descreen. Scanner auto-correction is the enemy here: it changes
  geometry per page, which is exactly what registration is trying to undo.
- Flat on the platen. A skewed reference bakes the skew into every crop.

Save as `assets/reference/blank-card.pdf`.

## Step 2 — mark the cells

Open the calibration tool (`npm run dev`, then the Calibrate tab) and, for each
row on each side, drag two boxes:

- the **TOTAL** box — where a numeric total is written
- the **tally** area — the ruled space to its left

Then place at least **two anchor marks**: high-contrast printed features far
apart on the page, ideally near opposite corners. Registration uses these to
solve the perspective transform, so corners of the printed grid work well and
anything a volunteer might write over does not.

## Step 3 — export

The tool writes `assets/reference/cells.front.json` and `cells.back.json`, in
the shape of the `CellMap` interface in `src/lib/cells.ts`.

`validateCellMap` runs on load and rejects the mistakes that would otherwise
surface as mystifying recognition failures:

- a row that isn't a taxonomy item row
- a row calibrated on the wrong side of the card
- a box with no area, or one running off the page
- two TOTAL boxes overlapping by more than half a row height, which means
  adjacent rows would be cropped from the same pixels

## Note on the open layout question

While you have a blank card in hand, settle the question the plan flags as
moving the estimate more than anything else:

**Does each digit get its own printed box, or is the number free-written in the
cell?**

Boxed digits make segmentation nearly free and push per-digit accuracy toward
the top of the projected range. Free-written numbers make touching digits a
real failure mode. Write the answer down in this file — it determines how much
of `recognize.ts` needs to exist.
