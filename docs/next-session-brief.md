# Brief for the next session

Paste this, or point at it, to start a fresh chat on this project.

Project: `~/surfrider-datacard-web`. Browser-only tool that turns a scanned PDF
of Surfrider beach cleanup data cards into the chapter's Excel datasheet. No
server, no API keys; the scan never leaves the laptop. **It is open source.**

**Read `HANDOFF.md` first.** It has the measurements behind everything below.

---

## State

Working and verified end to end: drop a PDF, review crops, download the
spreadsheet. Verified on a real 116-page scan — 58 cards, 73 seconds, 869MB
peak browser heap, no page refused.

- **Registration is solved.** 1,606 pages, 28 scans, 10 beaches, nothing
  refused. Fits scale + offset per axis on the grid window, coarse to fine,
  and verifies against the printed section banners rather than against the
  correlation that placed the page. A sideways-fed card is recovered by
  retrying at 90/180/270°.
- **Digit recognition is built, measured at 66.3% per digit / 84% precision,
  and deliberately not shipped.** A confidence-gated pre-fill needs ~99%
  precision because a wrong number invites agreement. It has also stopped
  improving: 7 scans → 18 → 27 gave 63.0% → 66.3% → 66.3%. More scans are not
  the lever. Do not go collecting more.
- **The review list is halved.** `src/lib/marks.ts` decides whether a person
  wrote in a cell by shape rather than by how much ink is there. 730 → 453
  on the 58-card test scan, 9,683 → 7,180 across all 28
  scans, and nothing that was written has been shown to be dropped.
- **Memory is fixed.** 26MB held on a 116-page scan, against ~840MB before.
  Pages are cropped into cells and dropped as they are read.
- **Typed work survives a closed tab.** `src/lib/draft.ts` saves to localStorage
  and offers the draft back; it never restores unasked, and never across files.
- **The browser fills boxes in by itself and `autocomplete="off"` does not stop
  it.** `assertTypedValues` in `main.ts` undoes it. Found by clicking through the
  real app, not by measuring.
- Volunteer head count is optional — it is on the leader's card and often on no
  other, so requiring it blocked exports over a number that is not on the paper.
- 97 vitest tests and 27 stdlib-Python checks pass. `npm run build` is clean.

**Everything is uncommitted** — ~25 modified files, 4 new. The user has not
asked for a commit yet. Ask before committing.

## The next task: the rest of the review list

The user's standard is *"humans should only correct 20 things MAX not
hundreds."* The list is half what it was and still well above that, so the
question is what is left on it.

On the 58-card test scan, 453 cells are offered and **124 of them
hold nothing at all** — read by eye, one at a time. They are not printed ruling
any more; they are dirty crops, smudges, ink bled through from the other side,
and a neighbouring row's stroke hanging over a boundary. That is a different
problem from the one just solved and probably needs a different handle on it.

Two things to know before starting:

- The gain is very uneven — 44% shorter on 3.22 Pacific Beach, nothing at all
  on 9.26 Mission Beach. The scans that barely improve are the dirty ones, so
  that is where to look.
- **The floor of what is achievable is around 5 cells a card**, because that is
  roughly how many a volunteer actually fills in. Getting to twenty per SCAN
  would mean reading the numbers, and recognition is measured at 84% precision
  against the ~99% a pre-fill needs. Say so plainly rather than chasing it.

## Traps. Every one of these was hit and cost real time

1. **Do not use an ink threshold as ground truth for "someone wrote here."**
   Faint pencil does not clear it. Treating `ink >= 0.025` as truth produced a
   confident, wrong claim that 80% of shown cells were noise. Render the cells
   and look at them. Looking settled every question this session that
   measurement alone got wrong.
2. **Do not infer a card-to-column offset from where the ink is.** Two
   neighbouring volunteer columns are both sparse in similar rows, so a wrong
   column matches the ink pattern while every value on it is wrong. Fitting
   this produced training labels that scored *below* the guess-the-commonest
   baseline. Card N is column N; scans that fail that check are refused.
3. **Do not gate registration on profile correlation.** It falls with how much
   a volunteer wrote, not with how far the page is out, so it throws away the
   densest cards. Banner overlap is the check.
4. **Anything under `assets/` is published by `npm run build`** —
   `vite.config.ts` sets `publicDir: "assets"`, gitignore is irrelevant to it.
   Scans live in `/scans/`, outside that tree. `scripts/check-dist.mjs` fails
   the build if data reappears; do not weaken it to make a build pass.
5. **`assets/reference/labels-pacific-beach.json` is not trustworthy as ground
   truth.** Its `card:row` keys came from an older run's card numbering and do
   not line up with the scan. Re-read cells by eye before relying on it. The
   labels in `scans/eye-labels/` ARE trustworthy — they were read this session
   against a frozen crop cache — and cost hours to make. Do not throw them away.
7. **A value in the spreadsheet does not mean the card has writing in that
   cell.** Across 28 sheets, 5,798 of 9,526 typed values sit on cells that are
   blank on the card: the number was worked out from a tally, recorded on the
   other side, or typed against the wrong item. So a count of "values the filter
   dropped" is an UPPER BOUND, never a failure rate. Render them and look.
8. **Do not judge a mark by a bar that scales with the crop.** The rows are 29
   to 113 pixels tall; handwriting is the same size in all of them. A pure
   fraction asks four times as much of a mark on a wrapped-caption row, and it
   lost a real tick that way.
6. **The PDF page counts shown when a file is attached to chat are wrong** for
   these scans — often by 2-3x. Trust `pdfjs` / PDFKit, not the notice.

## How to measure anything here

```bash
swift scripts/render-pdf.swift <scan.pdf> out/pages/<name>   # PDF -> page JPEGs
node scripts/diagnose-registration.mjs out/pages/<name> --overlay 1,2
node scripts/diagnose-review.mjs out/pages/<name> scans/<sheet>.xlsx --show
node scripts/diagnose-review.mjs --all
node scripts/review-cache.mjs out/pages/<name> <name>   # freeze cells to disk
node scripts/review-sheets.mjs <name> --region total --cols 10 --scale 1
npx vite-node scripts/run-shipping-path.mjs -- out/pages/<name>
node scripts/label-from-spreadsheet.mjs out/pages/<name> scans/<sheet>.xlsx <name>
node scripts/train-digits.mjs
```

The overlay is the thing to look at: it draws every TOTAL box on the registered
page, red where the tool would read a number. The boxes must sit on the boxes.
`review-sheets.mjs` is the other one — it renders any set of cells as a contact
sheet, which is how every question about the review list actually got settled.

28 matched (PDF, spreadsheet) pairs are in `/scans/` — volunteer data, gitignored,
local only.

## What the user has said about the domain

- Volunteers are unpaid and leave things blank. That is normal, not an error.
- Data entry is one column per card, always. Mistakes happen occasionally and
  should be dropped, not modelled.
- The cards themselves cannot be changed, and volunteers cannot be asked to do
  anything extra. Rule out any fix that depends on either.
