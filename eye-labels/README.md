# Cells read by eye

What a person saw when they looked at a cell, as against what the tool said.
These are the only ground truth this project has that does not come from a
spreadsheet, and every threshold that decides whether a number is put in front
of a volunteer is set against them.

They are tracked, and the scans they were read from are not. That distinction is
the point of this directory, so it is worth being exact about it.

## What is in here

| File | What it holds |
|---|---|
| `prefill-audit.json` | 46 cells the tool would PRE-FILL, across every scan the chapter has, each counted by eye. Produced by `scripts/audit-prefills.mjs`, scored by it and by `scripts/sweep-row-escape.mjs`. |
| `test-long.json` | All 730 cells of the 58-card test scan's old review list: 277 with writing, 450 without. |
| `test-long-tally.json` | The tally strips of the same scan: 49 with marks, 86 without. |

Each entry is a key and a small integer or a word — `delmar-6.20:5:18: 4`,
`"48": "marked"`. There are no images here, no names, and no handwriting: only
what somebody counted, and which cell they counted it in.

## Why these are tracked when `/scans/` is not

`/scans/` holds the PDFs and the chapter's completed datasheets — volunteer
handwriting, in full. It is gitignored, `.github/workflows/ci.yml` fails the
build if anything under it is ever committed, and `SECURITY.md` says what to do
if something slips through. None of that changes.

These files were originally kept there too, which meant the evidence behind two
shipped thresholds existed as a single copy on one laptop. Reproducing them is
hours of looking; losing them would leave numbers in `tally.ts` that nobody
could justify or re-derive. Tracking them is the fix, and they are here rather
than under `assets/` because `vite.config.ts` sets `publicDir: "assets"` and
copies that whole tree into `dist/` verbatim — anything parked there is
published by a build whether it is gitignored or not.

## Adding to them

Keys are `scan:card:row` (`prefill-audit.json`) or the cell ids of a
`review-cache.mjs` cache (`test-long*.json`). Prefer the first: it survives the
pipeline being re-run, which is exactly how the first version of the pre-fill
audit went stale and had to be redone from scratch.

**Record what you saw, not what the spreadsheet says.** Four of the 46 cells in
`prefill-audit.json` disagree with the chapter's own datasheet, and in all four
the sheet is wrong. A value in a spreadsheet is not proof of what is on the
card; that trap is the one this project keeps falling into, and it is written up
at length in `HANDOFF.md`.
