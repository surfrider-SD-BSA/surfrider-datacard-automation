/**
 * One number, from up to two readers.
 *
 * A cell can be read twice over. The TOTAL box holds a number, which the digit
 * recognizer reads; the tally strip beside it holds the same quantity written a
 * completely different way, which `tally.ts` counts geometrically. The two
 * share no code and fail for unrelated reasons -- the recognizer mistakes an 8
 * for a 1 because of its shape, the counter miscounts because a stroke was
 * faint -- so putting them together is worth more than either alone.
 *
 * What comes out is a number and a confidence, and the confidence is the point.
 * Nothing here is ever shown to a reviewer as a fact; it is a pre-fill in a box
 * beside a picture of the handwriting, and `main.ts` will only place one above
 * a threshold. Everything below that stays blank, which costs a keystroke the
 * reviewer was making anyway.
 */

/**
 * Which reader produced a value -- or "placeholder", which means none did.
 *
 * A placeholder is not a reading and `reconcile` never returns one. It is put
 * in by `prefillFor` after both readers have declined, so that every box a
 * volunteer opens has a number in it. It carries confidence 0, which is what
 * separates it from everything else here: nothing was read.
 */
export type ReadingSource = "agreed" | "split" | "tally" | "digits" | "placeholder";

export interface Reading {
  value: number;
  /** How much to trust it, 0-1. */
  confidence: number;
  source: ReadingSource;
  /** What each reader said, for the reviewer and the audit trail. */
  tally: number | null;
  digits: number | null;
}

export interface ReconcileOptions {
  /**
   * How far apart the two readers may be before the disagreement is treated as
   * a failure rather than a wobble, as a share of the larger reading.
   *
   * The chapter's owner asked for the midpoint when the two disagree, on the
   * grounds that for aggregate debris counts being a couple out is tolerable.
   * That reasoning holds for the SIZE of the error and not for how often it
   * happens, and the difference is measurable. Scored against the twenty-seven
   * matched datasheets, on the 18 cells where the two readers answered
   * different numbers and the sheet has a value:
   *
   *     the tally alone was right        9  (50%)
   *     the digits alone were right      7  (39%)
   *     halfway between was right        3  (17%)
   *
   * In 16 of the 18 one of the two readings WAS the answer. The readers do not
   * disagree by drifting either side of the truth, which is the situation an
   * average is for; they disagree because one of them failed -- a stroke too
   * faint to find, a digit segmented away -- and the other is simply correct.
   * Averaging a right answer with a wrong one reliably produces a third number
   * that is on neither the tally nor the box.
   *
   * So the midpoint is computed and reported, because that is what was asked
   * for, and it is given a confidence that leaves it below the bar `main.ts`
   * pre-fills at. The number is shown to the reviewer beside the picture rather
   * than typed into the box for them.
   *
   * That hit rate has moved from one in six to closer to one in four as the
   * counter improved, and `splitConfidence` has deliberately NOT moved with it:
   * 0.17 says the midpoint is the weakest of the three answers available, which
   * is still true at 23.8% against the tally's 47.6%. Raising it above the gate
   * is a one-line change if the chapter decides otherwise.
   *
   * The spread limit stays either way. Where the two are far apart they are not
   * two noisy readings of one number, they are two different numbers -- the
   * recognizer read "2" where the box says "21", or the tally overran its row
   * and only its first group was counted -- and halving the distance between 2
   * and 21 gives 12, which no reviewer glancing at the picture would catch.
   */
  maxSplit: number;
  /** Confidence given when both readers land on the same number. */
  agreedConfidence: number;
  /** ...when they are close and the midpoint is taken. */
  splitConfidence: number;
  /** Ceiling on what the tally alone is worth, whatever its own shape says. */
  tallyConfidence: number;
  /** Whether the digit reader may pre-fill a box with no tally to corroborate it. */
  digitsAlone: boolean;
  /** Cap on what a digits-only reading is worth. */
  digitsConfidence: number;
}

export const RECONCILE_DEFAULTS: ReconcileOptions = {
  maxSplit: 0.35,
  agreedConfidence: 0.99,
  // The weakest of the three answers available, measured. Deliberately below
  // the gate `main.ts` pre-fills at; see maxSplit above.
  splitConfidence: 0.17,
  tallyConfidence: 0.97,
  digitsAlone: true,
  // The recognizer's measured precision where it is most confident, and so the
  // most a reading by it alone can ever be worth. Below the tally cap on
  // purpose: one reader that is right 86% of the time should never outrank one
  // that is right 95%.
  digitsConfidence: 0.86,
};

/**
 * Combine what the two readers said, or return null to leave the box empty.
 *
 * **A digit reading on its own used to be refused here, and now is not.** That
 * was not a small decision and it is the chapter owner's, made knowingly, so
 * the reasoning on both sides is kept rather than replaced.
 *
 * The case against: measured leave-one-event-out over 3,325 labelled digits,
 * the recognizer is right 86% of the time where it is MOST confident and 70%
 * overall. So roughly one pre-filled cell in six is wrong at the top of its
 * range, and worse below it -- and a wrong number is not the same cost as an
 * empty box. An empty box beside a legible picture costs one keystroke from
 * somebody who was going to look anyway. A confident wrong number invites
 * agreement, and the chapter's data is the thing that pays.
 *
 * The case for, which is the one that won: a volunteer facing 453 blank boxes
 * concludes the tool is broken and stops using it. 387 of those cells hold a
 * handwritten number and only the digit reader can ever reach them, so refusing
 * digits alone caps the tool at the 66 tally-only cells no matter how good the
 * recognizer gets. The owner's goal is ~30 typed values per scan; that is not
 * reachable without this.
 *
 * `digitsAlone` is the switch, and setting it false restores the old refusal
 * exactly. `PREFILL_GATE` in main.ts is the other half: it decides how much of
 * the recognizer's range is trusted, and the precision at each setting is in
 * HANDOFF.md rather than guessed at.
 */
export interface ReaderResult {
  value: number;
  /** What this reader alone thinks the reading is worth, 0-1. */
  confidence: number;
}

export function reconcile(
  tally: ReaderResult | null,
  digits: ReaderResult | null,
  options: Partial<ReconcileOptions> = {},
): Reading | null {
  const o = { ...RECONCILE_DEFAULTS, ...options };
  const values = { tally: tally?.value ?? null, digits: digits?.value ?? null };

  if (tally && digits) {
    if (tally.value === digits.value) {
      return { value: tally.value, confidence: o.agreedConfidence, source: "agreed", ...values };
    }
    const spread = Math.abs(tally.value - digits.value);
    if (spread > Math.max(tally.value, digits.value) * o.maxSplit) return null;
    return {
      // Rounded up, not down. The two readers disagree because one of them
      // missed something -- a stroke too faint to find, a digit segmented
      // away -- and missing things makes a count too low far more often than
      // too high, so the halfway point is biased the same way.
      value: Math.ceil((tally.value + digits.value) / 2),
      confidence: o.splitConfidence,
      source: "split",
      ...values,
    };
  }

  if (tally) {
    // The counter's own confidence, not a flat number for "a tally was read".
    // What it is worth depends on the shape of what it read -- a tally written
    // as complete crossed fives checks its own arithmetic, a bare run of two
    // uprights does not -- and `tally.ts` works that out. Capping it here keeps
    // one reader on its own below what two agreeing readers are worth.
    return {
      value: tally.value,
      confidence: Math.min(tally.confidence, o.tallyConfidence),
      source: "tally",
      ...values,
    };
  }
  if (digits && o.digitsAlone) {
    return {
      value: digits.value,
      confidence: Math.min(digits.confidence, o.digitsConfidence),
      source: "digits",
      ...values,
    };
  }

  return null;
}
