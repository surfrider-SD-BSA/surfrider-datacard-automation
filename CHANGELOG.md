# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Changes to the output spreadsheet
layout, the output file naming scheme, the extraction JSON schema, or the minimum Python version
count as breaking.

## [Unreleased]

### Changed

- **Two readings the readers used to throw away are now offered as guesses**, on
  the chapter owner's instruction that every box arrive filled in. Readings
  offered per scan go from 278 to 307, 452 to 468, and 380 to 393; both are
  worth far too little to clear auto-accept, so every one is put in front of a
  person.
  - A tally strip the counter refused **after** finding strokes -- not parallel,
    unexplained ink, ragged groups -- is counted as strokes plus crossbars at
    0.1. `salvageCount` in tally.ts. Two declines are not salvaged: anything
    with no strokes at all, where there is nothing to count, and "ink continues
    past the row", where the count belongs to a different debris item and a
    reviewer looking at the picture could not tell.
  - A TOTAL box that segments into more than three pieces used to be refused;
    it is now read as the three tallest, left to right, capped at 0.3. Rare --
    2 cells of 450 on 1.18 Imperial, none on the 58-card scan.
  - **What is still blank cannot be guessed at**: 146, 164 and 57 cells per scan
    where the box holds ink but nothing digit-shaped segments out of it, or the
    strip has no strokes. Filling those means inventing a number, which is a
    different thing from reading one wrongly.

- **Most cells are no longer shown to anyone.** On the chapter owner's
  instruction, a reading of 0.75 confidence or better is taken as the answer
  and its cell is dropped from the review list — there is no control anywhere
  in either front end that will show it. Measured with the new
  `scripts/autoaccept-coverage.mjs` over the three scans the pre-fill gate was
  set on, this is 158 of 453, 379 of 632 and 296 of 450 cells. The threshold is
  `AUTO_ACCEPT` in `src/lib/prefill.ts`; above 1 turns it off.

  What it hides is almost entirely the digit reader working alone — 149 of
  those 158, 373 of the 379, 293 of the 296 — because agreement between the two
  readers needs the tally counter to have answered the same cell and it answers
  11, 7 and 3 of them. That reader is right 86% of the time where it is most
  confident, so on the order of 25, 60 and 47 values per scan now reach the
  spreadsheet wrong and unseen. They are still exported as `recognized` with
  their confidence rather than as `human`, which is the only remaining way to
  find them, and it is an after-the-fact one.
- **`PREFILL_GATE` is 0.** Every reading either reader offers goes into a box,
  including the midpoint taken when the two disagree, which was previously kept
  out by the gate's floor and is right under a quarter of the time. Those are
  still always shown: 0.17 is well below the auto-accept threshold, which is
  where the floor now lives.
- The desktop tool and the iOS app take the same cells off the same list, from
  the same constant — the engine now reports `autoAccepted` per cell rather
  than leaving each front end to compare confidences for itself.

### Added

- **Tally — an iOS app, and the interface the phone now shows.** Eight screens
  in SwiftUI, built from the design handoff in
  `design_handoff_mobile_companion`: pick up a draft, the event's header
  fields, choose a scan, watch it read, look at a page it refused, check one
  cell at a time on a thumb-sized keypad, see everything typed, and make the
  spreadsheet. It replaces the WKWebView that used to show the desktop tool
  inside the app.
- **Photographing the cards, as its own button.** Capture goes through
  VisionKit's document scanner, which rectifies the page's perspective before
  the image reaches the pipeline — which is what answers the keystoning
  objection that kept image input out of the app until now. The captured pages
  are bound into a PDF laid out so that rasterizing at 200 DPI returns exactly
  the pixels the camera captured. Choosing a scanned PDF is the second button
  and is unchanged. `NSCameraUsageDescription` is back; the photo-library key
  is still deliberately absent. **The resolution a real card lands at is still
  unmeasured**, and the screen says the scanner is the surer route.
- **The reading pipeline runs headless, and is unchanged.** `src/engine.ts`
  builds as a second entry point (`engine.html`) with no interface attached,
  and SwiftUI drives it over a small JSON bridge. There is no Swift port of
  registration, tally counting or digit recognition, and there should never
  be one: every figure in HANDOFF.md was measured against the TypeScript, and
  a second implementation would be a second set of numbers to keep in step.
  A fix to the reading is still a change to `src/` followed by
  `ios/sync-web.sh`.
- **The implementation.** A browser-only tool: drop a scanned PDF, check each
  cell against a picture of it, download the chapter's spreadsheet. No server,
  no account, no API key; the scan never leaves the machine.
- Page alignment that generalizes across chapters' scanners — 1,606 pages, 28
  scans, 10 beaches, nothing refused — verified against the card's printed
  section banners, so a page that will not line up is surfaced rather than
  read from the wrong place.
- Handwriting detection by shape rather than ink volume, which is what makes
  the review list short enough to work through: 730 cells to 453 on a 58-card
  event, with every written value kept.
- Typed values are saved as you go and offered back if the tab closes.
- A digit recognizer, measured and deliberately **not** switched on: 64% per
  digit and 83.5% precision where it is most confident, against the ~99% a
  pre-filled box needs before it stops being a liability. See `HANDOFF.md`.
- **Tally marks are counted, and the count is pre-filled into the box for you to
  check.** It reads a run of pencil strokes geometrically rather than as
  handwriting, which is why it works where digit recognition does not. Every
  cell it would fill was rendered and counted by eye — 46 of them, across every
  scan the chapter has — and it is right on 40 of the 42 it fills. Each one is
  tagged *counted: check it* in the list and recorded as a machine reading in
  the exported audit column, so a number nobody checked can always be told from
  one a person typed. It is a small share of the work: five boxes of 453 on a
  58-card event, because only the cells with tally marks and no written total
  can be read this way. See `HANDOFF.md` for the measurement.
- CI job for the browser tool: typecheck, tests, and a build that fails if
  anything data-shaped reaches the bundle.
- The front page says what the tool does **not** do — you still type the
  numbers — so a first-time reviewer is not waiting for handwriting to be read.
- Contribution guide, code of conduct, and security/privacy policy.
- Issue and pull request templates.
- Continuous integration: ruff lint and format checks, pytest, shellcheck.
- Pre-commit hooks, including a check that blocks committing volunteer data.
- Dependabot for pip and GitHub Actions updates.
- Branch protection runbook at `docs/repo-setup.md`.

### Changed

- `PREFILL_GATE` and the "check it" tag moved out of `src/main.ts` into
  `src/lib/prefill.ts`. Two front ends now decide the same thing about the
  same cell, and the whole argument is about one number; two copies of it is
  exactly the drift this repository keeps warning about. Behaviour on the web
  is unchanged.

### Fixed

- Nothing verified that a number typed against one volunteer's card came back
  out of the downloaded spreadsheet in that volunteer's column. Every export
  check asserted the writer had produced a particular string, which cannot catch
  a value landing one column across — a failure that looks like ordinary data
  and that nothing downstream could detect. Both halves are now pinned: in CI,
  every one of the 83 items across five cards read back with an independent
  parser, and by hand, 61 values typed into the running app on a real scan and
  found in the right cell of the real download.
- The built bundle could not start: it requested the cell maps from a path
  `publicDir` does not produce, so the tool worked under the dev server and
  404ed for anyone who ran `npm run build`.
- Builds no longer carry 7.5MB of calibration debug renders, and the dev
  server's dependency cache is no longer tracked. Bundle: 16MB to 6.1MB.
- The volunteer head count is optional. It appears on the leader's card and
  often on no other, so requiring it blocked exports over a number that was
  never written down.
- The CI guard for Python tests looked for `tests/**/*.py`, a git pathspec that
  skips `tests/test_foo.py`, so a Python suite added in the conventional place
  would have been silently skipped.

### Changed

- Pinned the pre-commit ruff hook to v0.16.2 so it matches the ruff version CI installs.

[Unreleased]: https://github.com/surfrider-SD-BSA/surfrider-datacard-automation/commits/main
