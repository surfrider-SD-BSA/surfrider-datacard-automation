# Tally: handoff

The iOS app, as it stands on 22 August 2026. What it is, what is proven, what is
assumed, and what the next person should do first.

Read [`ios/README.md`](README.md) for how to build and sign it. This document is
about the decisions and the evidence behind them.

## Status

**It runs on a phone and reads nothing yet.** The app builds, signs, installs and
launches on a physical iPhone 16, and every screen has been driven by hand. What
has *not* happened is a card going in one end and a spreadsheet coming out the
other, inside the app, start to finish. The reading pipeline is proven on the web
side against 1,606 pages; the app drives that same pipeline through a bridge that
has been exercised on its own. The two have never been run together on real
handwriting.

**So the first thing to do is read a card.** Not a demo, not a screenshot — a real
scan, all the way to a downloaded spreadsheet. Everything below is written on the
assumption that nobody has done that yet.

## The one architectural decision

**The reading is not implemented in Swift, and must never be.**

Registration, tally counting and digit recognition are measured in
[`HANDOFF.md`](../HANDOFF.md) against the TypeScript in `src/`, on 1,606 pages
across 28 scans and 10 beaches. A Swift port would be a second implementation to
keep in step with a set of figures that took months to establish, and the second
implementation is always the one that quietly drifts.

So the app is native where the interface is, and runs the original pipeline
everywhere else:

```
SwiftUI (ios/SurfriderDataCards/Tally/)
        │
        │  JSON over evaluateJavaScript / WKScriptMessageHandler
        ▼
Engine.swift  ←→  src/engine.ts   (engine.html, no interface attached)
                        │
                        ▼
                  src/lib/*.ts    ← the measured code, untouched
```

`engine.html` is a second Vite entry point beside `index.html`. It has an empty
`<body>` on purpose. It is loaded into a 1×1, zero-opacity `WKWebView` that lives
in the view hierarchy — attached deliberately, because WebKit throttles timers in
a web view that is not in a window, and `rasterizePdf` yields between pages.

**A fix to the reading is a change to `src/`, followed by `ios/sync-web.sh`. It is
never a change to anything under `Tally/`.**

### What does not cross the bridge

Page images. A letter page at 200 DPI is 3.7MB of grayscale and a 116-page scan is
430MB of them. Pages are cut into row crops in the engine and dropped, exactly as
`processFile` does on the web; Swift asks for one cell picture at a time by card
and row. The PDF travels the other way for the same reason — Swift stages it in
`WebAssetSchemeHandler`'s inbox under a one-shot token and the page `fetch`es it,
rather than arriving as a base64 string the size of the scan.

## The screens

Eight, a push stack, no tab bar. Each maps to code on the web side, and the
mapping is the point — the copy and the thresholds come from there, not from
invention.

| # | Screen | Built from |
| --- | --- | --- |
| 1 | Cleanups | `lib/draft.ts`, plus a real record of exported events |
| 2 | The event | `lib/schema.ts` (`eventMetadata`), `taxonomy.ts` (`HEADER_ROWS`) |
| 3 | The cards | `docs/card-findings.md` (resolution), `pdf.ts` |
| 4 | Reading the cards | `main.ts` (`processFile`), `pdf.ts`, `register.ts` |
| 5 | A page refused | `register.ts` (`registerAgainstBestSide`, banner overlap) |
| 6 | Checking a number | `main.ts` (`renderCell`), `marks.ts`, `extract.ts` |
| 7 | Everything typed | `main.ts` (`renderCard`), `taxonomy.ts` |
| 8 | Before it goes | `lib/schema.ts` (`checkExportGate`), `lib/xlsx/` |

Screen 6 is the one that matters. It is where the hours go, and it is the whole
argument for building this on a phone at all: one cell at a time on a thumb-sized
keypad, rather than hunting a 453-row list with a trackpad.

## Settings, and what they are worth

| Setting | Value | Where |
| --- | --- | --- |
| `PREFILL_GATE` | **0.20** | `src/lib/prefill.ts` |
| `minExplained` (tally) | **0.9** | `src/lib/tally.ts` |
| `splitConfidence` | **0.17** | `src/lib/reading.ts` |
| `digitsAlone` | **true** | `src/lib/reading.ts` |

### PREFILL_GATE moved from 0.50 to 0.20 in this session

On the chapter owner's instruction to fill in as much as the tool can read.
Measured with `scripts/gate-coverage.mjs` over three real scans — 164 cards,
1,535 cells:

| gate | test-long (453) | pacific-3.22 (632) | imperial-1.18 (450) |
| --- | --- | --- | --- |
| 0.80 | 125 · 27.6% | 361 · 57.1% | 280 · 62.2% |
| 0.50 | 219 · 48.3% | 412 · 65.2% | 327 · 72.7% |
| 0.30 | 269 · 59.4% | 451 · 71.4% | 376 · 83.6% |
| **0.20** | **278 · 61.4%** | **452 · 71.5%** | **380 · 84.4%** |
| 0.15 | 278 · 61.4% | 452 · 71.5% | 380 · 84.4% |

**0.20 is the end of the road, not a midpoint.** The readers only ever *offer* 278,
452 and 380 readings on those scans, so those percentages are the ceiling however
far the gate falls. 0.15 and 0.17 fill exactly the same boxes. What no gate reaches
is a cell where both readers declined outright — to fill more than this, improve a
reader, not the threshold.

**Keep the gate above 0.17.** `splitConfidence` sits there so the midpoint taken
when the two readers disagree is reported and never pre-filled: it is the weakest
answer available, right under a quarter of the time. The gate spent part of a day
at 0.15, below that floor, and it did no measurable harm — across all 1,535 cells
the reconciler produced *not one* split reading, because a split needs both readers
on the same cell and the tally counter answers 11, 7 and 3 cells against the digit
reader's 267, 445 and 377. But that is a property of today's counter, not of the
design. `gate-coverage.mjs` prints a SPLIT column; if it stops being zero, the gate
must go back above 0.17.

### The cost, said plainly

The precision figures stop at 0.50 and they were falling: 86, 84, 83, 81, 78.
**Precision below 0.50 has not been measured.** Everything filled between 0.50 and
0.20 is by definition what the recognizer was least sure of. Expect something
nearer three in four right than four in five.

Every filled box is tagged `read: check it` / `counted: check it` / `counted twice:
check it`, is drawn in the accent on the card list, and sits directly under a
picture of the handwriting. That is the only reason any of it is defensible, and
it is why the tag is not decoration.

### Do not loosen the tally counter

`minExplained` was swept and left alone. It is the share of a strip's ink that
straight segments must account for, and it is what separates a tally from a number
or a scribbled word.

| minExplained | cells filled | precision |
| --- | --- | --- |
| **0.90** (kept) | 62 | **95.3%** (41/43 by eye) |
| 0.85 | 65 | 93.2% (41/44) |

Three extra cells across 29 scans, one of them a new wrong answer. The tally
counter is the one reader in this tool that can be leaned on — 95.3% against
handwriting's 78%-and-falling — and loosening it trades the part that works for a
rounding error in the part that does not. The 0.80 and 0.70 runs were killed by
timeouts and never finished; if anyone wants to revisit this, finish that sweep
first and label the newly-admitted cells by eye. Coverage alone will not answer it.

## Where the design was not followed

The design lives in the `design_handoff_mobile_companion` Claude Design project.
Three deliberate departures, all recorded here so nobody has to guess whether they
were oversights.

**Pre-fill is kept.** The design states as its first rule: *"Never guess a number.
No pre-fill, no OCR suggestion."* The shipping tool does pre-fill, on the chapter
owner's explicit instruction against the measurements. The app follows the product,
not the design, because a phone build that behaved differently from the laptop
build on the single most consequential question would be worse than either.

**Capture is a document scanner, not a camera.** The design draws a live viewfinder
and a shutter. A plain camera was refused before, correctly — *"a photograph held
at an angle keystones, and registration corrects rotation and scale but not that."*
`VNDocumentCameraViewController` rectifies the perspective before the image reaches
the pipeline, which answers the objection rather than ignoring it. Captured pages
are bound into a PDF laid out at `pixels × 72/200` so that rasterizing at 200 DPI
returns exactly the pixels the camera captured.

**Screen 5 cannot retake one page.** The design offers *"Retake page 7"*. Per-page
retake does not exist, so the screen offers a better scan instead, and says the
real banner-overlap figure rather than a generic failure.

Also worth knowing: the "Finished" list on screen 1 is a real record of exported
events rather than the prototype's sample rows, and screen 6's keypad replaces a
pre-filled value on the first digit rather than appending to it — the desktop tool
gets that for free from a text field.

## Traps

Things that have already cost time here. All of them are one-line fixes and none
of them announce themselves.

**A control must not display a value the model does not have.** `EventForm.date`
started as `""`, and the date picker's binding falls back to `Date()` when the
string will not parse — so screen 2 showed today's date while the model held
nothing, and the setter only fires when the date *changes*. "Scan the cards" stayed
disabled with the field looking filled in. The app was unusable and the cause was
invisible. It now defaults to today, and the caption names the field that is
actually missing rather than listing both.

**Two presentation modifiers on one view.** `.fileImporter` and `.fullScreenCover`
were attached to the same view, and one of them was silently ignored — a dead
button with nothing in the log. The picker now lives on its own `.sheet`, hung off
the button.

**A `.fit` image inside a horizontal `ScrollView` resolves to nothing.** It is
proposed an unbounded width. The row strip on screen 6 shipped once as an empty
white card because of this. Compute the width from the image's own aspect ratio
against a fixed height.

**The MIME type on the PDF worker.** `pdf.worker.min.mjs` served as anything but a
JavaScript type is rejected by the module loader, and the app hangs on "Reading the
cards" with nothing in the console, because the failure is inside a worker nobody
is watching. `WebAssetSchemeHandler` sets it explicitly. If reading ever hangs at
zero, look there first.

**A stale web bundle looks exactly like a reading regression.** Run
`ios/sync-web.sh` after any change to `src/`. It takes under a second.

**Derived data is not all called `build/`.** 102.7MB of Clang module cache reached
`main` through `ios/build-sim/`, which `build/` does not match. The ignore is now
`ios/build*/`. **Those blobs are still in history** — removing them needs a rewrite
and a force-push over a protected branch, which is a maintainers' decision.

**Sweeping `tally.ts` patches it in place.** Two killed sweeps left `minExplained`
modified in the working tree. If it ever reads anything but `0.9`, that is a dead
sweep, not a change.

## What is proven, and how

| | |
| --- | --- |
| Reading pipeline | 1,606 pages, 28 scans, 10 beaches — see `HANDOFF.md` |
| `src/lib/` after the refactor | 128 tests; real pages through `run-shipping-path.mjs` |
| Engine bridge | replies, errors, unknown methods, failures inside the pipeline |
| Reference loading in the engine | reference card, cell maps, 3.4MB digit model |
| Build | typechecks, both entry points, `check-dist` clean, 5 CI checks |
| Device | builds, signs, installs, launches on a physical iPhone 16 |
| Screens 1–3 | driven by hand in the simulator |

**Not proven:** a card read end to end inside the app; any screen after 3 with real
data in it; the export reaching the share sheet; the draft surviving a real
backgrounding; capture resolution on a real card.

## What to do next, in order

1. **Read a card in the app.** Everything else is speculation until this happens.
   If it hangs at zero, see the MIME-type trap.
2. **Measure capture resolution.** The pipeline expects 200 DPI on the card's short
   edge. Whether a handheld capture clears that in beach light is unmeasured and is
   the largest risk in the whole concept. Photograph a real card, run it, and look
   at whether pages register — screen 5 shows the real overlap figure, which is the
   measurement.
3. **Check the export against a real datasheet.** Card *n* is always spreadsheet
   column *n*. Never infer the mapping from where the ink is.
4. **Decide about the history rewrite** for the 102.7MB of build cache.
5. **Sign it properly.** Development signing expires seven days after each install.
   TestFlight needs a paid membership, a bundle identifier the chapter owns, and an
   App Store Connect key — every blocker there is an account, not a line of code.

## Inventory

Added or changed in this session. 3,198 lines of Swift, 704 of TypeScript and
tooling.

| Path | |
| --- | --- |
| `ios/SurfriderDataCards/Tally/` | the app: 8 screens, model, engine bridge, theme, stores |
| `src/engine.ts` | the pipeline with no interface, driven from Swift |
| `engine.html` | its entry point; empty body on purpose |
| `src/lib/prefill.ts` | `PREFILL_GATE` and the "check it" tag, lifted out of `main.ts` so both front ends read one number |
| `scripts/gate-coverage.mjs` | how many boxes each gate fills, with both readers on |

Merged as #22, #23, #24, #25, #26, #27, #28, #29, #30.
