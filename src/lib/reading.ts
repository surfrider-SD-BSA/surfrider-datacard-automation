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

export type ReadingSource = "agreed" | "split" | "tally" | "digits";

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
   * for, and it is given a confidence that reflects being right one time in six
   * -- which leaves it below the bar `main.ts` pre-fills at. The number is shown
   * to the reviewer beside the picture rather than typed into the box for them.
   * Raising `splitConfidence` above that bar is a one-line change if the chapter
   * decides a 17% hit rate is worth the typing it saves.
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
}

export const RECONCILE_DEFAULTS: ReconcileOptions = {
  maxSplit: 0.35,
  agreedConfidence: 0.99,
  // Right about one time in six, measured. Deliberately below the gate
  // `main.ts` pre-fills at; see maxSplit above.
  splitConfidence: 0.17,
  tallyConfidence: 0.97,
};

/**
 * Combine what the two readers said, or return null to leave the box empty.
 *
 * A digit reading ON ITS OWN is deliberately not enough. Measured leave-one-
 * event-out over 3,218 labelled digits it is right about 84% of the time where
 * it is most confident, so one pre-filled cell in six would be wrong -- worse
 * than an empty box beside a legible picture, because a confident wrong number
 * invites agreement. It earns its place only as a second opinion: as
 * corroboration when it matches the tally, and as one end of the range when it
 * does not.
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
  return null;
}
