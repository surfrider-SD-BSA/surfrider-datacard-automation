/**
 * Whether a machine reading is good enough to be put in a box, and what to
 * call it when it is.
 *
 * Lifted out of `main.ts` when the iOS app arrived. Both front ends decide the
 * same thing about the same cell, and the whole argument below is about ONE
 * NUMBER; two copies of it is exactly the drift this repository keeps warning
 * about. The desktop tool and the phone read it from here.
 */

import { reconcile, type Reading } from "./reading";
import type { ExtractedCell } from "./extract";

/**
 * Confidence a reading needs before it is put in a box.
 *
 * ONE NUMBER DECIDES HOW MUCH THIS TOOL RISKS, and it is this one. Raising it
 * pre-fills fewer boxes and gets more of them right; lowering it pre-fills more
 * and gets more of them wrong. The measured cost of each setting is in
 * HANDOFF.md, per bucket, so the chapter can move it on evidence.
 *
 * At 0.80 the tool pre-fills counts of one to four whose ink is fully accounted
 * for -- five boxes of the 453 on the 58-card test scan. The counter only ever
 * sees the 66 cells with tally marks and no number; the other 387 hold
 * handwriting, and reading those is the recognizer's problem.
 *
 * **What the setting is worth, measured the only way that means anything.**
 * `scripts/audit-prefills.mjs` lists every cell this gate would fill across all
 * twenty-nine page directories and renders it beside its context; all 46 were
 * counted by eye and are kept in `eye-labels/prefill-audit.json`. At 0.80
 * the tool fills 42 of them and **40 are right**. Nothing here is scored on the
 * chapter's spreadsheets, which agree 79.8% and are a lower bound rather than a
 * precision -- a value in a sheet is not proof of what is on the card.
 *
 * That is 95.2%, and it is short of the ~99% this project set as the bar for a
 * pre-fill. It ships at 0.80 because the chapter's owner asked for it after
 * being shown these figures, and because the shortfall is no longer the kind
 * the bar was written for:
 *
 *   - Neither remaining error invents a number out of nothing. Both readings
 *     that returned a count for a row holding no tally at all -- a diagonal
 *     crossing three rows, and the descenders of a word written in the row
 *     above -- are refused now; see `rowEscape` in tally.ts.
 *   - What is left is a count out by one, and a digit written inside a drawn
 *     circle read as three. The 99% bar exists because a recognizer reading
 *     "2" where the card says "21" is wrong by nineteen; the chapter's owner
 *     has said a count out by one or two is tolerable for aggregate debris.
 *   - Every pre-filled box is tagged "counted: check it" in the list and
 *     exported as `recognized` rather than `human`, so a reviewer who trusts it
 *     and a reviewer who corrects it are told apart in the chapter's own audit
 *     column.
 *
 * Set it to 0.95 to pre-fill only single strokes. Set it to 1.1 to turn
 * pre-filling off entirely. Re-run the audit after ANY change to the counter:
 * it is the only instrument here that has ever caught the failure it exists
 * for, and every other one -- the spreadsheet score, both offline diagnostics,
 * the whole test suite -- passed clean through it twice.
 *
 * ---------------------------------------------------------------------------
 * THE HANDWRITING READER IS ON, AND THIS NUMBER IS NOW ALSO ITS GATE.
 *
 * Everything above was written when the tally counter was the only reader, and
 * it still describes the tally side exactly. The digit reader is weaker and the
 * gate is shared, so what this number buys is no longer one thing:
 *
 *   gate   digits answered   right, of those        the tally side
 *   0.90        36%               86%           unchanged from 0.8
 *   0.80        53%               84%           as measured in the audit
 *   0.70        64%               83%
 *   0.60        74%               81%
 *   0.50        82%               78%
 *
 * Set at 0.50 on the chapter owner's instruction, which was to fill as many
 * boxes as possible. That is a deliberate purchase of coverage with accuracy:
 * around one pre-filled number in five is wrong at this setting, against about
 * one in seven at 0.8. Every one of them is tagged "check it" and sits beside a
 * picture of the handwriting, which is the only reason it is defensible.
 *
 * Raise it to 0.8 to go back to roughly one in seven, or set `digitsAlone`
 * false in reading.ts to return to tally-only pre-filling.
 * ---------------------------------------------------------------------------
 *
 * LOWERED TO 0.30 ON 22 AUGUST 2026, on the chapter owner's instruction to
 * fill more boxes automatically. What that buys, measured on the 58-card
 * test-long scan by `scripts/gate-coverage.mjs`:
 *
 *   gate   boxes filled   of 453 cells
 *   0.80        125           27.6%
 *   0.70        160           35.3%
 *   0.60        194           42.8%
 *   0.50        219           48.3%     <- previous setting
 *   0.40        243           53.6%
 *   0.30        269           59.4%     <- now
 *   0.20        278           61.4%
 *
 * 0.30 rather than lower because of the shape of that curve, not a feeling
 * about risk. The readers only ever OFFER 278 readings on this scan -- 267
 * from the digits, 11 from the tally -- so 61.4% is the ceiling however far
 * the gate falls, and 0.30 already takes 269 of the 278. The last nine cost
 * a third of the remaining headroom above `splitConfidence`, which is 0.17
 * and must stay below the gate: at or under it the midpoint taken when the
 * two readers disagree starts being pre-filled, and that is the weakest
 * answer available -- right under a quarter of the time. Buying nine boxes
 * by opening that door is a bad trade.
 *
 * WHAT THIS COSTS, SAID PLAINLY. The precision figures in the table above
 * this one stop at 0.50, and they were falling steadily -- 86, 84, 83, 81,
 * 78. **Precision below 0.50 has not been measured**, and on that trend
 * something nearer three in four right than four in five is the honest
 * expectation for a filled box. Every one is still tagged "read: check it"
 * and still sits under a picture of the handwriting, which remains the only
 * reason any of this is defensible.
 *
 * The tally side is untouched by the change, and that is measured rather
 * than assumed: `audit-prefills.mjs --gate 0.25` fills the same 62 cells at
 * the same 95.3% precision as `--gate 0.5`. The counter's own confidences
 * are quantised at 0.60/0.75/0.80 and it declines everything else outright,
 * so the gate was never what limited it.
 */
export const PREFILL_GATE = 0.3;

/** What the two readers make of one cell, reconciled. Null when both declined. */
export function readingFor(cell: ExtractedCell): Reading | null {
  return reconcile(
    cell.tallyCount === null ? null : { value: cell.tallyCount, confidence: cell.tallyConfidence },
    cell.digitValue === null ? null : { value: cell.digitValue, confidence: cell.digitConfidence },
  );
}

/**
 * The reading to put in the box, or null to leave it empty.
 *
 * Below the gate the box stays EMPTY rather than showing a guess: an empty box
 * next to a legible picture costs one keystroke, and a wrong number costs the
 * chapter's data, because a confident wrong number invites agreement rather
 * than correction.
 */
export function prefillFor(cell: ExtractedCell): Reading | null {
  const reading = readingFor(cell);
  return reading && reading.confidence >= PREFILL_GATE ? reading : null;
}

/**
 * What to call a pre-filled box, in the reviewer's words.
 *
 * Say WHICH reader spoke, because they are not worth the same and the reviewer
 * is entitled to know which claim they are being asked to check. "read" is the
 * weakest of the three and is named differently on purpose.
 */
export function prefillTag(source: Reading["source"]): string {
  switch (source) {
    case "digits":
      return "read: check it";
    case "agreed":
      return "counted twice: check it";
    default:
      return "counted: check it";
  }
}
