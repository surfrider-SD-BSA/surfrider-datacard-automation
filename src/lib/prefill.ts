/**
 * Whether a machine reading is good enough to be put in a box, and what to
 * call it when it is.
 *
 * Lifted out of `main.ts` when the iOS app arrived. Both front ends decide the
 * same thing about the same cell, and the whole argument below is about ONE
 * NUMBER; two copies of it is exactly the drift this repository keeps warning
 * about. The desktop tool and the phone read it from here.
 */

import { TENS_SHARE } from "./row-prior";
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
 * Set to 0.75 on 22 August 2026 on the chapter owner's instruction. Lowered to
 * 0.45 on 5 September 2026 on the owner's instruction, to take about half of a
 * scan's cells off the review list. "About half" is the test-long figure. On
 * the other two measured scans the same threshold hides two thirds and three
 * quarters, because what a threshold hides depends on how much the digit reader
 * answers on that scan, and not on the number alone.
 *
 * WHAT IT HIDES, measured with `autoaccept-coverage.mjs` over the same three
 * real scans the gate was set on -- 164 cards, 1,535 cells:
 *
 *   thresh   test-long      pacific-3.22    imperial-1.18   what it is
 *            (453 cells)    (632 cells)     (450 cells)
 *   0.90       0   0.0%       0   0.0%        0   0.0%      nothing reaches it
 *   0.86      71  15.7%     335  53.0%      257  57.1%      digits at their cap
 *   0.80     127  28.0%     358  56.6%      274  60.9%
 *   0.75     162  35.8%     378  59.8%      297  66.0%      the previous setting
 *   0.45     219  48.3%     410  64.9%      331  73.6%   <- here
 *
 * The reviewer is left 234, 222 and 119 cells to check on those three scans,
 * down from 453, 632 and 450, and down from the 291, 254 and 153 that 0.75 left.
 *
 * WHAT IT COSTS, and this is the part to read before moving it further. Almost
 * everything hidden is the DIGIT reader on its own -- 208 of the 219, 403 of the
 * 410, 328 of the 331. Not one "agreed" reading clears the threshold on any of
 * the three scans, because agreement needs both readers to answer the same cell
 * and the tally counter answers 11, 7 and 3 of them. So this is not a threshold
 * that hides the readings two independent readers confirmed. It hides the
 * weakest reader working alone, and at 0.45 it hides that reader's weakest
 * answers along with its best ones.
 *
 * That reader's measured precision, leave-one-event-out over 3,325 labelled
 * digits, is 86% where it is MOST confident and 84% in the band just below --
 * the table is in HANDOFF.md. At 0.75 that came to roughly one hidden number in
 * six or seven wrong: about 26, 60 and 47 wrong values per scan, each reaching
 * the spreadsheet unseen.
 *
 * THE CELLS THIS THRESHOLD ADDS SIT BELOW BOTH MEASURED BANDS, so that table
 * says nothing about them. They have since been counted two ways, and the two
 * bound the answer from either side (28 September 2026).
 *
 * Against the spreadsheets the chapter typed from the same scans, with
 * `hidden-accuracy.mjs` and each scan read by a model rebuilt WITHOUT its own
 * digits (HOLDOUT=knn). The shipped model cannot be used for this: it holds the
 * labelled digits of these very scans, finds each one at distance zero, and
 * scores 24% where the honest figure is 40%.
 *
 *   thresh   hidden cells the     disagree with      leaving out cards that
 *            sheet has a number   the typed value    look column-mismatched
 *   0.75        2,005             675  33.7%         383 of 1,678  22.8%
 *   0.45        2,772           1,109  40.0%         583 of 2,168  26.9%
 *
 * The 0.75 cells are a subset of the 0.45 ones, so the cells this setting added
 * are the difference: 767, of which 434 disagree with the sheet -- more than half.
 * That is an UPPER bound, because the sheets are not ground truth. Read by eye,
 * a random 300 of the training digits -- labelled from the same sheets -- had
 * the wrong label about one time in five: a typing slip, a card in the wrong
 * column, or a crop that was never one digit.
 *
 * By eye, on those 300 digits, this reader is wrong on 19 of the 232 it answers
 * above 0.45 and 5 of the 184 above 0.75: 14 of the 48 between them, about
 * THREE IN TEN. That is a LOWER bound, because it only sees digits that were cut
 * out cleanly, and a cell cut wrong reads wrong whatever the reader does.
 *
 * So somewhere between three in ten and more than half of what this setting
 * added goes into the chapter's spreadsheet wrong and unseen. That band is the
 * thing to weigh before a chapter files a spreadsheet from this setting.
 *
 * EVERY FIGURE ABOVE IS THE NEAREST-NEIGHBOUR READER'S. The digit reader is now
 * a small convolutional net (`scripts/train_digits_cnn.py`), and this threshold
 * was deliberately left where it was when it changed. What 0.45 means with it:
 *
 *                                  nearest neighbour      convolutional net
 *   hides, on the three scans      219 / 410 / 331        196 / 336 / 264
 *   ... of which (share of scan)   48% / 65% / 74%        43% / 53% / 59%
 *   held out, disagree with sheet  1,109 of 2,772  40%    939 of 2,623  36%
 *   ... leaving out mismatches     26.9%                  23.9%
 *   by eye, digits wrong           19 of 232              8 of 228
 *
 * Two of the three scans are in both readers' training data, which is what
 * made the old reader hide three quarters of one: it finds its own exemplars at
 * distance zero. test-long, which neither has seen, is the fair column --
 * 48% against 43%. So the net hides a little less, and what it hides is wrong
 * less than half as often by eye; a reviewer gets somewhat more of each scan
 * back. Whether to spend that on a lower threshold is the owner's call, and
 * hidden-accuracy.mjs with HOLDOUT=cnn is the instrument for it.
 *
 * Then the cutting was fixed under it (`inkMask`, `segmentDigits` and
 * `readDigits` in digits.ts, `READ_MARGIN` in extract.ts): 192 / 334 / 274
 * hidden on the three scans, and held out, 770 of 2,656 hidden cells disagree
 * with the sheet -- 29%, and 16.5% leaving out the mismatched cards. That is
 * 160 fewer wrong numbers taken off the list than the net alone, with 64 more
 * cells taken off it across all 28 scans.
 *
 * They are still exported as `recognized` with their confidence rather than as
 * `human`, so the chapter's audit column can find them afterwards; that is the
 * only remaining defence, and it is an after-the-fact one.
 *
 * Set it back to 0.75 for the 22 August behaviour. Set it to 0.87 to put every
 * digit-only reading back on the review list while keeping the two-reader
 * agreements off it. Set it above 1 to turn auto-accept off entirely and show
 * every cell.
 */
export const AUTO_ACCEPT = 0.45;


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
 *
 * **0 was measured on 30 September 2026, and 1 stays.** The premise above is
 * often false: on the 58-card test scan, read by eye, 103 of the 126 boxes
 * shown as "nothing read" are empty -- the printed rules passed the shape test
 * -- so a volunteer who taps Next on one records a 1 for debris that is not
 * there. That looked like the case for 0, and across every scan it is not.
 * Over the 28 matched scans, 1,006 boxes reach a volunteer as a placeholder;
 * the chapter's sheet holds a number for 634 of them and nothing for 372. So 0
 * would be exactly right more often (372 against the 78 where the number is 1),
 * but 1 is closer in total, because most of these rows do hold a count -- and
 * the total is what the chapter's data is for. The test scan was the exception,
 * which is why the question was asked of every scan before anything moved.
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
/**
 * No count on a card reaches four digits that the reader can be trusted with.
 * One box in 3,821 with a sheet value is over 999, and the reader cuts at most
 * three digits today; a longer reading would be strokes and stray marks read as
 * digits, and one of them would swamp a scan's total. So it is never put in the
 * box: the box comes up "nothing read" for a person to type.
 */
export const MAX_READ = 999;

export function prefillFor(cell: ExtractedCell): Reading {
  const reading = readingFor(cell);
  if (reading && reading.confidence >= PREFILL_GATE && Math.abs(reading.value) <= MAX_READ) return reading;
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

/**
 * Share of a scan's boxes a person is shown: the least sure, by confidence.
 *
 * The owner's decision (6 October 2026): show only the least-confident 20% and
 * take the rest as read, rather than everything under a fixed `AUTO_ACCEPT`,
 * which showed about 36%. Measured on the 28 scans against the typed sheets
 * (HANDOFF.md), that takes roughly 440 more wrong numbers into the spreadsheet
 * unseen in exchange for about half the checking. A box with nothing read is
 * always shown, whatever the share, because there is no number to take.
 */
export const SHOW_SHARE = 0.2;

/**
 * How far off a reading is likely to be, for choosing which to show.
 *
 * The owner's measure, 14 October 2026: what matters is how far the numbers
 * taken unseen are from the truth, not how many are not exactly right -- "I
 * would rather have 2000 wrong but they are all only off by 1 than 1000 wrong
 * but they are all wrong by 5". So the share a person sees goes to the boxes
 * likely to be furthest off, not the ones likeliest to be wrong at all.
 *
 * `EXPECTED_ERROR` is the mean |reading - sheet| of the readings of each kind
 * across the scans (the two with unreliable sheets left out), by source,
 * number of digits and confidence band. It is what moved the ranking: a
 * one-digit reading at 0.3-0.5 is off by 7.8 on average, because it is often
 * a two-digit number with a digit lost, while a tally count under 0.3 is off
 * by 5.8 -- so it is the digits a person should see first.
 *
 * Against the old ranking (least confident first, longer numbers sooner), under
 * the apps' rule: total absolute error of the boxes taken unseen 11,558 ->
 * 10,147, misses of 10 or more 283 -> 263. Exactly right falls 2,264 -> 2,238;
 * that is the trade asked for.
 */
/** "11" is two strokes, a tally of two as often as eleven: its expected error is doubled (#137). */
const ONES_RANK = 0.5;

/** A three-digit reading with two or more 1s is nearly always tally strokes read as digits (#140). */
const THREE_DIGIT_ONES = 2;

const EXPECTED_ERROR = {
  //       conf < 0.3   0.3-0.5   0.5-0.7   0.7-0.85   >= 0.85
  digits: [
    [13.9, 7.8, 3.1, 2.2, 1.8], // one digit
    [23.9, 12.2, 7.6, 4.2, 4.9], // two
    [300, 200, 60, 60, 2], // three
  ],
  tally: [
    [5.8, 3.0, 3.0, 2.9, 2.9],
    [7.6, 5, 5, 5, 5],
    [50, 50, 50, 50, 50],
  ],
};

function rowWeighted(e: number, r: Reading, row: number | null | undefined): number {
  if (row == null || r.source === "agreed" || String(Math.abs(Math.round(r.value))).length !== 1) return e;
  return e * (1 + TENS_WEIGHT * (TENS_SHARE[row] ?? 0.2));
}

function expectedError(r: Reading): number {
  const text = String(Math.abs(Math.round(r.value)));
  const c = r.confidence;
  const band = c < 0.3 ? 0 : c < 0.5 ? 1 : c < 0.7 ? 2 : c < 0.85 ? 3 : 4;
  const table = r.source === "tally" ? EXPECTED_ERROR.tally : EXPECTED_ERROR.digits;
  let e = table[Math.min(3, text.length) - 1]![band]!;
  // "11" is "||" as often as eleven (ONES_RANK), and a three-digit number made
  // of 1s is nearly always tally strokes read as digits (THREE_DIGIT_ONES).
  if (text.length >= 2 && /^1+$/.test(text)) e /= ONES_RANK;
  if (text.length >= 3 && (text.match(/1/g) ?? []).length >= THREE_DIGIT_ONES) e *= 10;
  // Both readers on the same number: right 88% of the time (TWO_READERS).
  if (r.source === "agreed") e = Math.min(e, 1);
  return e;
}

/**
 * A written number the phone's own text reader saw differently is ranked as if
 * read at the lowest confidence, so it is among the first shown.
 *
 * On iOS, Apple's Vision text reader looks at each box our reader read as
 * digits (`secondOpinionBoxes` in engine.ts). It gives a number on only one box
 * in five and is further off than ours where it does (20,080 against 16,447 on
 * the same 714 boxes), so it is no reader to fill boxes with. But where it does
 * answer and disagrees, ours is usually the one wrong, and by a lot -- it sees
 * the digit ours lost ("10" for 100, "0" for 90, "2" for 20). The 77 taken
 * boxes it disagreed on were off by 1,283 in all; the next 77 by our own
 * ranking, by 229.
 *
 * The phone reads 36 boxes at a time, tiled 3 by 12 on one picture: ten times
 * faster than one by one and as good (6.28 Seaport reads in 12 s, not 41 s,
 * against 10 s without it). Under the apps' rule, same share shown, with the
 * tiled readings (`SECOND=` in scripts/apps-rule.mjs): total off 9,461 ->
 * 8,356, misses of 10 or more 247 -> 215, exactly right 2,258 -> 2,252.
 * Android has no second opinion and is unchanged.
 *
 * Tried, not kept: trusting a shown box the phone agrees with (8,356 -> 8,689).
 */
const SECOND_DISAGREES_CONFIDENCE = 0.01;

/**
 * A one-digit reading ranks higher the more often its row is counted in tens
 * (`TENS_SHARE`): its expected error is multiplied by 1 + TENS_WEIGHT x share.
 *
 * The commonest big miss taken unseen is a two-digit number read as one digit,
 * and those cluster on the rows that are usually two digits. Fitted on half the
 * scans and scored on the other, both halves improve (3,843 -> 3,779 and
 * 4,514 -> 4,318 total off); 0.5 to 1 all help, past that it hurts. Not on
 * readings both readers agreed on.
 */
const TENS_WEIGHT = 0.5;

/**
 * Which of a scan's readings are taken as read: all but the least confident
 * `SHOW_SHARE` of them. Same order in as out. Ties at the line are broken by
 * order on the card, so the share is exact and the answer the same everywhere.
 * `second` holds the phone's own reading of each box where it has one
 * (SECOND_DISAGREES_CONFIDENCE), and `rows` each box's card row (TENS_WEIGHT).
 */
/**
 * On iOS, open handwriting readers also read every box our reader read as
 * digits (`OtherReaders.swift`): docTR's CRNN, PARSeq and ViTSTR, PaddleOCR's
 * PP-OCRv5 server recognizer, EasyOCR's recognizer, and TrOCR small, base and
 * large. A box where at least this many of them read another number than ours
 * is ranked as if Apple had disagreed.
 *
 * Taking their number instead of ours is worse -- when four agree it fixes
 * about as many taken boxes as it breaks (33 for 30), and even PP-OCRv5 alone,
 * right on 79% of the boxes it reads where ours is on 74%, takes total off
 * 7,606 -> 8,512 -- but they make different mistakes from ours and from each
 * other, so when several disagree at once, ours is usually the one wrong.
 *
 * Measured 18 October 2026 under the apps' rule with Apple's opinion (SECOND=
 * and OTHERS= in scripts/apps-rule.mjs), total off on the boxes taken unseen,
 * with the readers exactly as the phone runs them, for the shipped digit reader
 * and two others trained the same way on other seeds:
 *
 *                 today   with the readers     half A           half B
 *     seed 1      7,606       6,884            3,600 -> 2,977   4,006 -> 3,907
 *     seed 3      7,775       6,874            3,682 -> 3,129   4,093 -> 3,745
 *     seed 0      7,910       6,838            3,833 -> 3,099   4,077 -> 3,739
 *
 * 4 of 8 beat 3 and 5. PP-OCRv5 replaced PaddleOCR v3 (7,036 / 7,019 / 6,840
 * with v3). Not kept: more docTR readers (SAR, MASTER, mobile CRNN, ViPTR) and
 * PP-OCRv6 small/medium or v5 English, added or in place of EasyOCR -- all
 * worse; EasyOCR is weak alone but its mistakes are its own. The phone reads
 * only until a box is settled (OtherReaders.swift), about 1 min 45 s for a
 * scan's 244 written boxes on an M-series Mac.
 */
export const OTHER_READERS_DISAGREE = 4;

/**
 * How much each open reader that disagrees moves a box up, beyond the line:
 * a flagged box ranks x(1 + this x every reader past `OTHER_READERS_DISAGREE`),
 * an unflagged one x(1 + this x every reader that disagrees). Eight against
 * ours is likelier wrong than four, three likelier than none.
 *
 * Measured 18 October 2026 with the counts the phone has (the five fast
 * readers on every box, the TrOCRs only while a box is undecided): total off
 * 6,884 -> 6,673, 6,878 -> 6,665, 6,838 -> 6,691 (seeds 1, 3, 0); halves A
 * 2,977 -> 2,908, 3,129 -> 3,119, 3,099 -> 3,135; B 3,907 -> 3,765,
 * 3,749 -> 3,546, 3,739 -> 3,556. 0.1 for either side was worse on two seeds.
 */
const OTHER_READERS_WEIGHT = 0.05;

/**
 * How many of the other readers (the open readers and Apple's) must read the
 * same number as our own tuned reader before its number replaces ours.
 *
 * The tuned reader is TrOCR-small fine-tuned on the chapter's own TOTAL boxes
 * and sheet values (scripts/train-trocr.py). Held out by halves of the scans
 * it is right on 71.8% of boxes where ours is on 66.9%, and off by 25,969 in
 * all against ours 41,442 -- the first reader better than ours on every box.
 * Taking its number everywhere is still worse (7,606 -> 9,415: where ours is
 * sure, ours is right), but where it disagrees with ours and two others read
 * what it read, ours is the one wrong: total off on the boxes taken unseen
 * 6,673 -> 6,431, 6,662 -> 6,409, 6,691 -> 6,407 for the shipped digit reader
 * and two others (fixed 39-45 boxes, broke 7-9; every half better). One was
 * worse (24 broken on every seed), three fixed fewer.
 */
export const TUNED_AGREE = 2;

/**
 * The number to fill a box with, given what the tuned reader read: its number
 * where it differs from ours and `TUNED_AGREE` of the others read it too;
 * otherwise ours. Only for digit readings.
 */
export function tunedValue(
  r: Reading,
  tuned: string | null | undefined,
  others: (number | null)[] | null | undefined,
  second: number | null | undefined,
): number {
  const t = numberFromReader(tuned);
  if (r.source !== "digits" || t === null || t === r.value) return r.value;
  return [...(others ?? []), second].filter((v) => v === t).length >= TUNED_AGREE ? t : r.value;
}

/** Letters the open readers write for handwritten digits, as Apple's are read (Engine.swift). */
const LOOKALIKE: Record<string, string> = {
  l: "1", I: "1", "|": "1", i: "1", "!": "1", O: "0", o: "0", D: "0", Q: "0", S: "5", s: "5",
  Z: "2", z: "2", B: "8", g: "9", q: "9", G: "6", b: "6", T: "7", A: "4",
};

/**
 * An open reader's text as a number: the first run of digits after lookalike
 * letters are read as digits, at most 999. The first run, not all digits: the
 * readers often add a stroke of the box's printed edge after the number
 * ("14 1", "7_1"), and the first run scored better (out/exp/wa/parse.cjs).
 */
export function numberFromReader(text: string | null | undefined): number | null {
  if (!text) return null;
  const run = [...text].map((c) => LOOKALIKE[c] ?? c).join("").match(/\d+/);
  return run ? Math.min(Number(run[0]), 999) : null;
}

export function autoAcceptedInScan(
  readings: (Reading | null | undefined)[],
  second: (number | null | undefined)[] = [],
  rows: (number | null | undefined)[] = [],
  others: ((number | null)[] | null | undefined)[] = [],
): boolean[] {
  const empty = (r: Reading | null | undefined) => r == null || r.source === "placeholder";
  const show = Math.ceil(readings.length * SHOW_SHARE);
  const against = (r: Reading, o: (number | null)[] | null | undefined) =>
    (o ?? []).filter((v) => v != null && v !== r.value).length;
  const flagged = (r: Reading, s: number | null | undefined, d: number) =>
    (s != null && s !== r.value) || d >= OTHER_READERS_DISAGREE;
  const score = (r: Reading, s: number | null | undefined, o: (number | null)[] | null | undefined, row: number | null | undefined) => {
    const d = against(r, o);
    const f = flagged(r, s, d);
    const e = rowWeighted(expectedError(f ? { ...r, confidence: SECOND_DISAGREES_CONFIDENCE } : r), r, row);
    return e * (1 + OTHER_READERS_WEIGHT * (f ? Math.max(0, d - OTHER_READERS_DISAGREE) : d));
  };
  const ranked = readings
    .map((r, i) => ({ i, c: empty(r) ? -Infinity : -score(r!, second[i], others[i], rows[i]) }))
    .sort((a, b) => a.c - b.c || a.i - b.i);
  const accepted = readings.map((r) => !empty(r));
  let shown = readings.filter(empty).length;
  for (const { i } of ranked) {
    if (!accepted[i]) continue;
    if (shown >= show) break;
    accepted[i] = false;
    shown++;
  }
  return accepted;
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
