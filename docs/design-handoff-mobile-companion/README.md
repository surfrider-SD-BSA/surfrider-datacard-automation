# Handoff: Mobile companion for the data-card tool ("Tally")

## Overview

An iOS companion to `surfrider-datacard-automation`. It does on a phone what the browser
tool does on a laptop: turn photographed beach-cleanup data cards into the chapter's
Excel datasheet, without ever reading the handwriting. The volunteer photographs the
cards, the app locates the cells someone wrote in, shows a picture of each one, and the
person types what they see.

Eight screens, a push/stack navigation, no tab bar.

**The product rules this inherits from the existing tool, and must not break:**

1. **Never guess a number.** The app decides *whether* a box has writing in it — easy and
   reliable — and never what it says. A confidently wrong number is worse than no number,
   because it invites agreement. No pre-fill, no OCR suggestion, no "26 or 28".
2. **Refuse a page rather than crop from it.** A misregistered page yields ordinary-looking
   numbers attached to the wrong debris items, and nothing downstream can catch that.
   Registration is verified against the card's printed section banners, not against the
   correlation that placed the page.
3. **Nothing leaves the device.** The scans carry volunteer handwriting. Only the finished
   spreadsheet is shared.
4. **Typed work survives, and is never restored unasked.** A draft is offered with its age
   and value count; the user chooses.
5. **Blank is normal.** Volunteers are unpaid and leave things blank. Required fields are
   date and beach only.

## About the design files

`tally-mobile-concept.html` and `Tally.dc.html` are **design references written in HTML**.
They are prototypes of look and behavior — not production code to lift. Nothing in them
reads a PDF, registers a page, or writes a spreadsheet; the card crops are drawn
placeholders.

The task is to **recreate these designs in a real mobile environment**. Two viable targets;
pick with the maintainer before starting:

- **SwiftUI (recommended for "iOS app").** Native camera capture, native numeric keypad,
  Vision framework for page rectangle detection. The pipeline (`register.ts`, `cells.ts`,
  `marks.ts`, `extract.ts`, `xlsx/`) would need porting to Swift, or running in a
  `WKWebView` as a headless worker.
- **The existing Vite app, made mobile.** Reuses every algorithm already proven on 1,606
  pages and keeps one codebase. Capture becomes `<input type="file" capture="environment">`
  or `getUserMedia`. This is far less work and loses only native polish.

Either way, use the target's own conventions — SwiftUI's `NavigationStack` and system
controls, or the repo's existing DOM-render pattern in `src/main.ts`. Do not port the
inline styles from these HTML files verbatim.

## Fidelity

**High fidelity.** Colors, type, spacing, radii and copy are final and are listed exactly
below. Recreate them faithfully. Two deliberate exceptions:

- The **card crops** (white paper with a handwritten digit) are placeholders. Real
  implementation renders the actual cell bitmap. Keep them on white — see Design tokens.
- The **camera viewfinder** is a drawn stand-in for a live preview.

## Screens / views

Device frame throughout: 402 × 874 pt (iPhone 16 Pro). Status bar overlays the content, so
every screen starts with 56 pt of top padding; every screen ends with 46 pt of bottom
padding to clear the home indicator. Horizontal page margin is 22 pt everywhere.

Back affordance is a leading caret + destination word in accent, 16 pt, at the top of a
44 pt bar. Not a title bar — screen titles are large and flush-left in the content.

---

### 1 — Cleanups (root)

**Purpose:** resume interrupted work, or start a new cleanup.

**Layout:** column. Kicker + large title; draft card; "Finished" list; spacer; pinned
primary action over a bottom fade.

| Element | Spec |
| --- | --- |
| Kicker | 11 pt, letter-spacing .12em, uppercase, `#9184d9`. Text: chapter name, e.g. "Surfrider San Diego · CH54" |
| Title | Inter 500, 30 pt, line-height 1.1, letter-spacing −.01em. "Cleanups" |
| Draft card | 1 pt border `#5d5294`, fill `#2b2741`, radius 10. Padding 14/15. Contains: beach + date (15 pt, 500) left / "saved 2 hours ago" (11 pt, `#d2cefd`) right; body 13 pt, line-height 1.5, text at 68% opacity — "12 of 41 cells checked. Your typing is on this phone — nothing has been put back until you say so."; then two buttons, gap 9 |
| Draft buttons | "Pick up where I left off" (primary outline, flex 1, min-height 44) and "Start fresh" (secondary, min-height 44), both 14 pt |
| Section label | "Finished" — 11 pt, .1em, uppercase, text at 45% |
| Event row | 14 pt vertical padding, 1 pt bottom divider. Beach 15 pt/500; meta 12 pt at 52% ("21 Feb · 58 cards · sent"). Trailing `caret-right` 16 pt at 40% |
| Primary action | "Start a cleanup" with `plus` icon, full width, min-height 52, 16 pt. Sits on `linear-gradient(to top, #161826 72%, transparent)` |

Sample rows: Moonlight Beach · 21 Feb · 58 cards · sent; Ocean Beach · 17 Jan · 22 cards;
Mission Beach · 26 Sep · 31 cards.

---

### 2 — Event details

**Purpose:** the header fields that appear only on the leader's card.

Title "The event" (Inter 500, 28 pt). Body 13 pt at 60%: *"Only the date and the beach are
needed to finish. The rest is written on the leader's card and often on no other, so it is
never held against you."*

Fields, gap 16, each label 12 pt at 70%, input min-height 46, 16 pt, radius 8, 1 pt
divider border, fill `#232532`:

| Field | Type | Required |
| --- | --- | --- |
| Date | date | yes |
| Beach | text, placeholder "Pacific Beach" | yes |
| Volunteers | number, side by side with Pounds | no |
| Pounds | number | no |
| Your name | text, "Who is doing the entry" | no |

Optional labels carry a 55%-opacity "optional" suffix. Footer button "Scan the cards"
(`camera` icon), disabled until date and beach are non-empty; caption below, centered,
12 pt at 45%: "A date and a beach, and you can start." → "Everything needed is here."

Maps to `eventMetadata` in `src/lib/schema.ts` and `HEADER_ROWS` in `taxonomy.ts`. Duration
defaults to 2 hours and club defaults to the chapter string; both are off-screen defaults,
editable in settings.

---

### 3 — Capture

**Purpose:** replace the flatbed scanner — and the Print-to-PDF step that was destroying
resolution (`docs/card-findings.md` §5).

Screen background darkens to `#0e0f18`. Top bar: "Cancel" (accent) left, "8 pages · 4
cards" (13 pt at 60%) right.

Centered heading "Card 4 · front" (Inter 500, 22 pt) with a live hint under it in
`#d2cefd`, 13 pt: "Start with the front of the first card" → "Looks sharp — keep going".

**Viewfinder:** 3:4 aspect, radius 12, inset 22 pt from the margins. Background
`radial-gradient(120% 80% at 50% 20%, #1d2030, #0b0c14)`. Inside: a 22 pt inset dashed
accent rectangle (55% mix) as the card guide, four 34 pt L-brackets in solid accent at the
corners (2 pt), faint horizontal ruling to suggest paper. A bottom scrim carries the
guidance, 12 pt, centered: *"All four corners inside the frame. Flat paper, no shadow
across the totals column."*

**Thumbnail strip:** 38 × 50 pt, radius 4, paper white `#e9e9ed` with grey ruling and a
page number bottom-right.

**Controls row:** "Now the back" / "Next card" (accent text, toggles side) · 70 pt shutter
(3 pt accent ring, 18% accent fill, 40% on press) · "Done" (secondary, disabled at zero
pages).

Real implementation: detect the card rectangle live and only enable the shutter when all
four corners are in frame and the page is roughly flat. Target ≥ 200 DPI on the card's
short edge — measure this early, it is the biggest open risk in the whole concept.

---

### 4 — Reading the pages

**Purpose:** honest progress, and the privacy promise where it counts.

Title "Reading the cards" (26 pt). Body: *"Nothing is uploaded. This all happens on the
phone, and stops if you close the app."*

Progress bar 6 pt, radius 999, track `#292b31`, fill accent, `transition: width .35s ease`.
Caption under it: "Page 7 of 12 — nothing leaves the phone." → "Done."

Four steps below, gap 14, 14 pt. Each: a 16 pt leading mark (`·` pending → `✓` accent
done), label (45% opacity pending, full white done), and a trailing note at 45% that only
appears once complete.

1. Photographs read — 12 pages
2. Pages squared up and aligned — 11 of 12
3. Fronts and backs paired into cards — 6 cards
4. Looking for handwriting — 41 cells

On completion a footer appears: *"6 cards, 41 cells with something written in them. One
page would not line up."* + primary "Look at that page first".

Mirrors the one-page-at-a-time loop in `processFile` (`src/main.ts`) — pages are
rasterized, registered, cut into cells and dropped before the next is read. Memory
discipline matters more on a phone than it did in the browser.

---

### 5 — A page refused

**Purpose:** explain a refusal in the volunteer's language and offer the fix.

Kicker: `warning-circle` icon + "1 page refused", accent, 11 pt uppercase.
Title "Page 7 would not line up" (26 pt).

Body, 13 pt at 65%: *"The printed section banners did not land where they should, so we do
not know which row is which. A page that is a little off gives ordinary-looking numbers
attached to the wrong items, and nothing later would catch it. So it is refused rather than
cropped from."*

Then a 96 × 126 pt page thumbnail, rotated −3°, with a diagonal shadow gradient across it,
beside two lines of 13 pt detail: "Card 4, back. Banner overlap 0.41 — below the 0.72 we
trust." / "Likely a shadow across the left third. Retaking it in flatter light usually
fixes it."

Actions: "Retake page 7" (primary, `camera`) and "Leave it out and carry on" (secondary).
Footnote at 42%: "Leaving it out means card 4's back is blank in the spreadsheet. You can
add it later from the card list."

The threshold and wording come from `registerAgainstBestSide` in `src/lib/register.ts`.
Surface the real overlap figure, not a generic failure.

---

### 6 — Checking a number  ← the screen that matters

**Purpose:** read one cell picture, type one number. This is where the hours go.

Top bar: back "Back", trailing "All cards".

**Progress block:** a row of 12 pt text at 52% — "Cell 15 of 41" left, "Card 4 → column E"
right — over a 4 pt accent progress bar.

**Item:** name in Inter 500, 21 pt, line-height 1.25, `text-wrap: pretty` (names run long —
"Plastic Food Wrappers (candy, chip bags)"). Section under it, 12 pt, `#d2cefd`.

**The crop:** 118 pt tall, full width, background **`#fff`**, 1 pt border `#c8ccd6`, radius
8. Faint vertical column ruling every 62 pt and 1 pt horizontal rules top and bottom. The
number sits centered, rotated −2.5°, 58 pt, in a handwriting face
(`'Bradley Hand','Segoe Script','Snell Roundhand',cursive`) — **placeholder only**; real
builds draw the cell bitmap at ~2.4× as `cropToCanvas` does in `renderCell`.

Caption row under it, 11 pt at 40%: "The TOTAL box, enlarged 2.4×" left, "Show the whole
row" (accent, tappable) right.

**Tally variant** (`tallyOnly` cells): an accent-tinted panel appears between crop and
keypad — border `#5d5294`, fill `#2b2741`, radius 8 — headed "Tally marks, no total
written. Count them." over a white strip showing the marks at 1×.

**Entry display:** centered, Inter, 40 pt, tabular numerals. Shows an em-dash at 45%
opacity when empty.

**Keypad:** 3-column grid, gap 8, 16 pt side padding. Keys min-height 54, radius 9, fill
`#232532`, 1 pt divider border, 23 pt. Bottom row is `C` / `0` / `⌫`. Pressed state:
22% accent fill, accent border. Max 4 digits.

**Footer:** "Nothing there" (secondary, flex 1 — records a true zero) and "Next" (primary,
flex 2, `arrow-right`, disabled while empty; label becomes "Done" on the last cell).

Nothing is ever pre-filled. Advancing writes the value and moves to the next cell; the last
cell pushes screen 7.

---

### 7 — Everything typed

**Purpose:** see the whole event, jump back to any picture.

Top bar: back "Checking", trailing "Finish". Title = beach name (26 pt), sub 13 pt at 55%:
"12 of 41 checked · tap a row to look at the picture again".

Rows: leading card tag ("C4", 11 pt monospace at 38%), item name 14 pt + section 11 pt at
45%, trailing value in Inter 19 pt tabular numerals — em-dash at 45% when unchecked. Tap
pushes screen 6 at that cell. 1 pt divider between rows.

Footer primary: "Make the spreadsheet".

---

### 8 — Finish and send

**Purpose:** the export gate — warnings, not walls.

Title "Before it goes" (28 pt). Body: *"Warnings, not walls. You can send it anyway — you
are the one who saw the paper."*

Check rows: 1 pt divider border, radius 8, padding 12/13, leading Phosphor icon 17 pt, text
13 pt at 78%. Icon and tone by kind: `check-circle` accent for pass, `warning` `#b5abfc`
for warning, `x-circle` `#d2cefd` for a blocker.

Real gate content, from `checkExportGate` in `src/lib/schema.ts`:

- volunteer count vs. card count mismatch → *"The leader's card says 12 volunteers, but 6
  cards were scanned. Worth a look — it is usually a card that never made it into the pile."*
- pounds missing → *"Pounds of trash is blank. The sheet still works without it."*
- refused page → *"Card 4's back was left out — page 7 never lined up. Those rows will be empty."*
- always → *"The photographs stay on this phone. Only the spreadsheet leaves."*

Primary: "Make the spreadsheet" (`file-xls`).

**Success state** replaces the screen: a 64 pt accent-outlined circle with a `check`, ringed
by a 10 pt accent glow at 9%; "Ready to send" (26 pt); the filename
`3.22.26_Pacific-Beach_CH54.xlsx` (14 pt at 65%); "41 values, 6 cards, in the chapter's
template" (12 pt at 42%). Then "Share" (primary, `share-network`) and "Back to cleanups".

Filename convention comes from `suggestFilename`; the workbook is filled by
`fillTemplate` in `src/lib/xlsx/`.

## Interactions & behavior

- **Navigation:** a push stack. Back pops; the screen-jump list in the prototype's side
  panel is a prototype affordance only and should not ship.
- **Transitions:** progress bars `width .35s ease` (reading) and `.3s ease` (review).
  Everything else is the platform default push.
- **Pressed states:** every control tints from the accent ramp — outlined buttons to a 22%
  accent mix, keypad keys to 22% fill + accent border. No browser defaults.
- **Focus:** 2 pt accent outline, 2 pt offset (`:focus-visible`).
- **Disabled:** 45% opacity. Used on "Scan the cards" (no date/beach), "Done" (no pages),
  "Next" (empty entry).
- **Validation:** only date and beach are required, and only to leave screen 2. Everything
  else is a warning at screen 8.
- **Reading simulation:** the prototype ticks 4% every 90 ms. Real progress is per page.
- **Hit targets:** nothing below 44 pt. Keypad keys are 54.

### Guard the phone equivalent of the autofill bug

`assertTypedValues` in `src/main.ts` exists because Chrome restored form state into boxes
that had become different items after a refresh — three cells came back pre-filled against
items nobody had typed for. Treat the typed-value store as the only truth and reconcile the
UI from it after any restore. On iOS the analogue is state restoration and keyboard
autofill; verify by hand, not by assumption.

## State management

| State | Shape | Notes |
| --- | --- | --- |
| `stack` | screen ids | push/pop navigation |
| `event` | date, beach, volunteers, pounds, hours, name, club | strings; only date + beach gate |
| `pages` | captured page records | side, image, page number |
| `cards` | card → cells | from pairing; a card is one volunteer, one spreadsheet column |
| `values` | `Map<cardNumber, Map<row, number>>` | **the only truth**; row is the taxonomy/Excel row |
| `idx`, `entry` | review cursor, keypad buffer | `entry` clears on advance |
| `problems` | refused pages with reason + overlap | |
| `exported` | boolean | drives the success state |

Persist `values` + `event` on a debounce (~400 ms) and flush on background. Offer the draft
back with its age and count; never apply it unasked, and never across a different file.

Card *n* is always spreadsheet column *n* — card 1 → column C. Never infer the mapping from
where the ink is (trap 2 in `docs/next-session-brief.md`).

## Design tokens

From the Nocturne system. Do not introduce values outside it.

```
Ground        #161826   page background
Surface       #232532   cards, inputs, keypad keys
Text          #e9e9ed   never pure white
Divider       color-mix(in srgb, #e9e9ed 16%, transparent)
Accent        #9184d9   lines, marks, outlines — never a flood
  300         #d2cefd   accent text at body size (contrast)
  400         #b5abfc   warnings
  700         #5d5294   tinted borders
  800         #423a6a   tag fills
  900         #2b2741   tinted panel fills
Neutral 800   #292b31   progress track
Paper         #ffffff   scanned crops ONLY — see below
Paper border  #c8ccd6
Paper ruling  #e4e7ee / #d5d9e2
Paper ink     #26303c
```

**The crops stay on white on purpose.** They are photographs of paper and the job is
reading faint pencil; inverting or dimming them costs contrast exactly where it is
scarcest, and misrepresents the card. Frame them so they read as pictures rather than
glare. This is carried over verbatim from the note at the top of `src/style.css`.

**Type:** Inter throughout. Headings 500 — never heavier; hierarchy is size and space.
Scale in use: 30 / 28 / 26 (screen titles) · 21 (item name) · 19 / 16 / 15 (values,
buttons, rows) · 14 / 13 (body) · 12 / 11 (meta, kickers). Numerals are tabular wherever a
count is shown. Kickers: uppercase, .1–.12em tracking.

**Spacing:** 22 page margin · 56 top / 46 bottom safe padding · 44 nav bar · gaps 8/9/10/
12/14/16.

**Radii:** 12 viewfinder · 10 draft card · 9 keypad key · 8 default (inputs, buttons,
panels, crop) · 4–6 thumbnails · 999 pills and progress tracks.

**Elevation:** an edge plus ambient darkness. No stacked shadows.

**Rules:** horizontal rules fade to transparent over their outer 48 px rather than stopping
cleanly.

## Assets

- **Icons:** [Phosphor](https://phosphoricons.com), regular weight. Used: `plus`,
  `caret-left`, `caret-right`, `camera`, `warning`, `warning-circle`, `check`,
  `check-circle`, `x-circle`, `lock-simple`, `arrow-right`, `file-xls`, `share-network`.
  On iOS, substitute the matching SF Symbol rather than bundling a web font.
- **Device frame:** prototype scaffolding only. Do not port.
- **Card crops and the viewfinder:** placeholders, as stated above.
- **No photographs or logos** are used. Chapter branding is a text string.

## Files

| File | What it is |
| --- | --- |
| `tally-mobile-concept.html` | The prototype, self-contained. Open it first — it is tappable end to end |
| `Tally.dc.html` | Source of the same prototype: markup at the top, state logic in the script below it |
| `ios-frame.jsx` | The device bezel and status bar. Scaffolding — do not port |
| `nocturne-styles.css` | The design system's token sheet and component classes; every value above resolves here |

Repo files the design was built from, worth reading before implementing:
`src/lib/taxonomy.ts` (item names, sections, card→column), `src/main.ts` (the whole flow
and the autofill defence), `src/lib/schema.ts` (`checkExportGate`), `src/lib/register.ts`
(refusal), `src/lib/marks.ts` (which cells get shown at all), `src/lib/draft.ts`
(persistence), `docs/card-findings.md` and `docs/next-session-brief.md` (the traps).

## Open questions for the maintainer

1. **Target environment** — SwiftUI, or the existing Vite app made mobile? This decides
   everything else.
2. **Capture resolution.** The pipeline expects 200 DPI. Whether a phone camera clears that
   on a full card, handheld, in beach light, is unmeasured and is the largest risk here.
   Measure before building anything else.
3. **Screen 6's shape.** One cell at a time with a keypad, as designed — or a scrollable
   card-at-a-time list closer to the desktop tool? Worth settling before code.
