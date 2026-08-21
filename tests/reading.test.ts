/**
 * `reconcile` decides what, if anything, is put in a box for a reviewer.
 *
 * It had no tests, which was survivable while it only ever passed the tally
 * through and refused everything else. It is not survivable now: the digit
 * reader is on, so this function is what stands between a 70%-accurate
 * recognizer and the chapter's data.
 */
import { describe, expect, it } from "vitest";

import { reconcile, RECONCILE_DEFAULTS } from "../src/lib/reading";

const tally = (value: number, confidence = 0.9) => ({ value, confidence });
const digits = (value: number, confidence = 0.9) => ({ value, confidence });

describe("reconcile", () => {
  it("gives nothing when neither reader spoke", () => {
    expect(reconcile(null, null)).toBeNull();
  });

  it("passes the tally through, capped", () => {
    const r = reconcile(tally(3, 0.8), null);
    expect(r).toMatchObject({ value: 3, source: "tally", tally: 3, digits: null });
    expect(r!.confidence).toBeCloseTo(0.8);

    // The cap keeps one reader alone below two that agree.
    expect(reconcile(tally(3, 1)!, null)!.confidence).toBe(RECONCILE_DEFAULTS.tallyConfidence);
  });

  it("treats two readers that agree as the strongest answer there is", () => {
    const r = reconcile(tally(4), digits(4));
    expect(r).toMatchObject({ value: 4, source: "agreed", tally: 4, digits: 4 });
    expect(r!.confidence).toBe(RECONCILE_DEFAULTS.agreedConfidence);
    expect(r!.confidence).toBeGreaterThan(RECONCILE_DEFAULTS.tallyConfidence);
  });

  it("splits a near disagreement upward, and scores it below any gate", () => {
    // 5 and 6 -> 5.5 -> 6, because missing a stroke is the common failure and
    // it biases a count low.
    const r = reconcile(tally(5), digits(6));
    expect(r).toMatchObject({ value: 6, source: "split", tally: 5, digits: 6 });
    expect(r!.confidence).toBe(RECONCILE_DEFAULTS.splitConfidence);
    expect(r!.confidence).toBeLessThan(0.5);
  });

  it("refuses a wide disagreement outright rather than averaging it", () => {
    // "2" read where the card says "21" is wrong by nineteen; there is no
    // halfway point worth offering.
    expect(reconcile(tally(2), digits(21))).toBeNull();
  });

  describe("a digit reading on its own", () => {
    it("is offered, capped at what the recognizer is measured to be worth", () => {
      const r = reconcile(null, digits(7, 0.99));
      expect(r).toMatchObject({ value: 7, source: "digits", tally: null, digits: 7 });
      expect(r!.confidence).toBe(RECONCILE_DEFAULTS.digitsConfidence);
    });

    it("never outranks the tally, which is the better-measured reader", () => {
      expect(RECONCILE_DEFAULTS.digitsConfidence).toBeLessThan(
        RECONCILE_DEFAULTS.tallyConfidence,
      );
    });

    it("carries its own confidence through when that is the lower of the two", () => {
      expect(reconcile(null, digits(7, 0.4))!.confidence).toBeCloseTo(0.4);
    });

    it("is refused again when digitsAlone is off", () => {
      expect(reconcile(null, digits(7, 0.99), { digitsAlone: false })).toBeNull();
      // ...and turning it off must not disturb the tally path.
      expect(reconcile(tally(3), null, { digitsAlone: false })).toMatchObject({ source: "tally" });
    });
  });
});
