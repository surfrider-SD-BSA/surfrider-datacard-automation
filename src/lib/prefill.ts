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
 * LOWERED TO 0.20 ON 22 AUGUST 2026, on the chapter owner's instruction to
 * fill in as much as the tool can read. Measured with
 * `scripts/gate-coverage.mjs` over three real scans -- 164 cards, 1,535
 * cells -- rather than on one:
 *
 *   gate    test-long      pacific-3.22    imperial-1.18
 *           (453 cells)    (632 cells)     (450 cells)
 *   0.80    125  27.6%     361  57.1%      280  62.2%
 *   0.60    194  42.8%     396  62.7%      314  69.8%
 *   0.50    219  48.3%     412  65.2%      327  72.7%   <- was, until today
 *   0.30    269  59.4%     451  71.4%      376  83.6%   <- and then this
 *   0.20    278  61.4%     452  71.5%      380  84.4%   <- now
 *   0.15    278  61.4%     452  71.5%      380  84.4%   (tried; identical)
 *
 * 0.20 fills everything the readers ever offer, which is the instruction. It
 * is worth being clear that this is a small move and not a large one: it is
 * identical to 0.17 and to 0.15 on all three scans, and gains 9, 1 and 4
 * boxes over 0.30. Whatever a lower gate cannot reach is a cell where BOTH
 * readers declined outright, and no threshold reaches those -- the ceiling is
 * the readers, not the gate.
 *
 * 0.20 RATHER THAN LOWER, THOUGH LOWER WAS TRIED FIRST. This sat at 0.15 for
 * part of a day. 0.15 and 0.20 fill exactly the same boxes -- the same 278,
 * 452 and 380 on the three scans -- so nothing was gained by the lower
 * number, and one thing was given up.
 *
 * `splitConfidence` in reading.ts is 0.17, set deliberately below every gate
 * this project uses so that the midpoint taken when the two readers DISAGREE
 * is reported and never pre-filled: it is the weakest answer available, right
 * under a quarter of the time. 0.15 was underneath that floor and 0.20 is
 * above it, at no cost in coverage whatsoever.
 *
 * It is worth being precise about what the floor was worth in practice, so
 * that nobody reads more into this than is there. Across all 1,535 cells
 * measured, the reconciler produced **not one split reading** -- a split needs
 * both readers to answer the same cell, and the tally counter answers 11, 7
 * and 3 cells against the digit reader's 267, 445 and 377. So 0.15 was not
 * doing any harm that could be measured today.
 *
 * The argument for 0.20 is not that 0.15 was hurting. It is that 0.15 depended
 * on a property of today's tally counter -- that it almost never answers --
 * and 0.20 does not depend on anything. Make the counter less conservative and
 * a gate under 0.17 starts pre-filling midpoints with no signal that anything
 * changed. A free guarantee is worth taking when the alternative buys nothing.
 * `gate-coverage.mjs` prints a SPLIT column so the assumption stays visible.
 *
 * WHAT IT COSTS. The precision table above stops at 0.50 and was falling --
 * 86, 84, 83, 81, 78. **Precision below 0.50 is not measured.** The boxes
 * added between 0.50 and here are by definition the readings the recognizer
 * was least sure of, so they are the ones most likely to be wrong. Every one
 * is tagged "read: check it" and sits under a picture of the handwriting,
 * which remains the only reason any of this is defensible.
 *
 * The tally side is untouched, measured rather than assumed: audit-prefills at
 * --gate 0.25 fills the same 62 cells at the same 95.3% precision as at
 * --gate 0.5. Its confidences are quantised at 0.60/0.75/0.80 and it declines
 * everything else outright, so the gate never limited it.
 *
 * ---------------------------------------------------------------------------
 * TAKEN TO 0 ON 22 AUGUST 2026, on the chapter owner's instruction to fill in
 * everything the tool can read. There is no longer a floor: every reading
 * either reader offers goes into a box.
 *
 * Measured with `gate-coverage.mjs`, this buys almost nothing on top of 0.20 --
 * the same 278, 452 and 380 boxes on the three scans -- because the ceiling has
 * always been the readers rather than the gate, and both of them declining is
 * not something a threshold can reach past. What it does change is the SPLIT
 * reading, the midpoint taken when the two readers disagree, which sits at 0.17
 * and was deliberately kept under every gate this project has used. Those are
 * now filled too. They are the weakest answer available, right under a quarter
 * of the time.
 *
 * The guarantee that used to live here has moved to `AUTO_ACCEPT` below, and is
 * stronger for it: a split is filled, but 0.17 is nowhere near 0.75, so it is
 * always shown to a person beside the picture. The floor is no longer "which
 * boxes get a guess" -- every box gets one -- it is "which boxes a person still
 * sees", which is the line that was actually worth defending.
 * ---------------------------------------------------------------------------
 */
export const PREFILL_GATE = 0;

/**
 * Confidence at which a reading is taken as the answer and the cell is never
 * shown to anyone.
 *
 * THIS IS NOW THE NUMBER THAT DECIDES WHAT THIS TOOL RISKS, and it is a
 * different kind of number from `PREFILL_GATE` above. The gate decides which
 * boxes start with a guess in them; a reviewer still sees the guess, still sees
 * the picture of the handwriting beside it, and can still refuse it. This one
 * decides which cells are taken off the review list altogether. Above it, a
 * machine reading goes into the chapter's spreadsheet with nobody having looked
 * at the handwriting, ever.
 *
 * Set to 0.75 on 22 August 2026 on the chapter owner's instruction.
 *
 * WHAT IT HIDES, measured with `autoaccept-coverage.mjs` over the same three
 * real scans the gate was set on -- 164 cards, 1,535 cells:
 *
 *   thresh   test-long      pacific-3.22    imperial-1.18   what it is
 *            (453 cells)    (632 cells)     (450 cells)
 *   0.90       0   0.0%       0   0.0%        0   0.0%      nothing reaches it
 *   0.86      70  15.5%     339  53.6%      256  56.9%      digits at their cap
 *   0.80     125  27.6%     361  57.1%      280  62.2%
 *   0.75     158  34.9%     379  60.0%      296  65.8%   <- here
 *
 * The reviewer is left 295, 253 and 154 cells to check on those three scans,
 * down from 453, 632 and 450.
 *
 * WHAT IT COSTS, and this is the part to read before moving it further. Almost
 * everything hidden at 0.75 is the DIGIT reader on its own -- 149 of the 158,
 * 373 of the 379, 293 of the 296. Not one "agreed" reading clears the threshold
 * on any of the three scans, because agreement needs both readers to answer the
 * same cell and the tally counter answers 11, 7 and 3 of them. So this is not a
 * threshold that hides the readings two independent readers confirmed. It hides
 * the weakest reader working alone.
 *
 * That reader's measured precision, leave-one-event-out over 3,325 labelled
 * digits, is 86% where it is MOST confident and 84% in the band just below --
 * the table is in HANDOFF.md. Roughly one hidden number in six or seven is
 * wrong, which is about 25, 60 and 47 wrong values per scan, and each one now
 * reaches the spreadsheet unseen. They are still exported as `recognized` with
 * their confidence rather than as `human`, so the chapter's audit column can
 * find them afterwards; that is the only remaining defence, and it is an
 * after-the-fact one.
 *
 * Set it to 0.87 to put every digit-only reading back on the review list while
 * keeping the two-reader agreements off it. Set it above 1 to turn auto-accept
 * off entirely and show every cell, which is what this tool did until today.
 */
export const AUTO_ACCEPT = 0.75;


/** What the two readers make of one cell, reconciled. Null when both declined. */
export function readingFor(cell: ExtractedCell): Reading | null {
  return reconcile(
    cell.tallyCount === null ? null : { value: cell.tallyCount, confidence: cell.tallyConfidence },
    cell.digitValue === null ? null : { value: cell.digitValue, confidence: cell.digitConfidence },
  );
}

/**
 * What goes in the box when nothing was read.
 *
 * 1 rather than 0, and the choice is not arbitrary. A cell only reaches a
 * reviewer when the shape test says somebody wrote in it, so 0 would contradict
 * the one thing about the cell that IS known; 1 is the smallest count
 * consistent with the evidence and the least distorting if it survives into an
 * aggregate.
 */
export const PLACEHOLDER_VALUE = 1;

/**
 * The reading to put in the box. Never null: every box arrives with a number.
 *
 * The empty box is gone. It used to be the argument this file was built on --
 * an empty box beside a legible picture costs one keystroke, and a wrong number
 * costs the chapter's data, because a confident wrong number invites agreement
 * rather than correction. The chapter owner has asked three times for every box
 * to arrive filled in regardless, and this is that.
 *
 * What comes back is one of three quite different things, and the `source` on
 * it is the only way to tell them apart afterwards:
 *
 *   - A reading, where a reader answered. Most boxes.
 *   - A salvaged guess, where a reader declined but had something to count --
 *     see `salvageCount` in tally.ts. Confidence 0.1 or 0.3.
 *   - A PLACEHOLDER, where nothing was read at all: 146, 164 and 57 cells per
 *     scan on the three measured scans. Confidence 0, source "placeholder",
 *     tagged "nothing read: type it" in front of the reviewer, and exported as
 *     a machine value with confidence 0 so the chapter's audit column can find
 *     every one of them. It is a number the image did not produce.
 *
 * A placeholder is never auto-accepted -- 0 is as far below `AUTO_ACCEPT` as a
 * value can be -- so it is always in front of a person.
 *
 * NOTE for anyone raising `PREFILL_GATE` again: a reading that falls below the
 * gate is now REPLACED by a placeholder rather than leaving the box empty. A
 * real reading of 12 becomes a 1. Raising the gate without changing this is
 * almost certainly not what you want.
 */
export function prefillFor(cell: ExtractedCell): Reading {
  const reading = readingFor(cell);
  if (reading && reading.confidence >= PREFILL_GATE) return reading;
  return {
    value: PLACEHOLDER_VALUE,
    confidence: 0,
    source: "placeholder",
    tally: null,
    digits: null,
  };
}

/**
 * Whether this reading is taken as the answer, with nobody asked to check it.
 *
 * The one place the question is decided, for the same reason `PREFILL_GATE`
 * is: the desktop tool and the phone must take exactly the same cells off
 * exactly the same review list, or an export tells you a person looked at
 * something that depended on which device they happened to use.
 */
export function isAutoAccepted(reading: Reading | null | undefined): boolean {
  return reading != null && reading.confidence >= AUTO_ACCEPT;
}

/** The reading to accept outright for this cell, or null if a person should see it. */
export function autoAcceptFor(cell: ExtractedCell): Reading | null {
  const prefill = prefillFor(cell);
  return isAutoAccepted(prefill) ? prefill : null;
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
    case "placeholder":
      // Named for what happened rather than dressed up as a reading. Nothing
      // was read here; the 1 in the box is a starting point, not a claim.
      return "nothing read: type it";
    default:
      return "counted: check it";
  }
}
