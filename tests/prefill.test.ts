/**
 * The two numbers that decide what this tool risks.
 *
 * `PREFILL_GATE` decides which boxes start with a guess in them, and
 * `AUTO_ACCEPT` decides which cells a person is never shown. The second is the
 * expensive one and the boundary is what is worth pinning: a reading a
 * hundredth under the threshold has to reach the review list, because that is
 * the only thing standing between a wrong reading and the chapter's data.
 */
import { describe, expect, it } from "vitest";

import {
  autoAcceptedInScan,
  AUTO_ACCEPT,
  PLACEHOLDER_VALUE,
  PREFILL_GATE,
  autoAcceptFor,
  isAutoAccepted,
  OTHER_READERS_DISAGREE,
  mainReading,
  tallyFromReaders,
  tallyNumber,
  TUNED_DISAGREES,
  prefillFor,
  prefillTag,
} from "../src/lib/prefill";
import { OVERSEGMENTED_CONFIDENCE } from "../src/lib/digits";
import { SALVAGE_CONFIDENCE } from "../src/lib/tally";
import { RECONCILE_DEFAULTS, type Reading } from "../src/lib/reading";
import type { ExtractedCell } from "../src/lib/extract";

const reading = (confidence: number, source: Reading["source"] = "digits"): Reading => ({
  value: 4,
  confidence,
  source,
  tally: null,
  digits: 4,
});

/** A cell carrying whatever the two readers said, and nothing else that matters here. */
const cell = (o: Partial<ExtractedCell>): ExtractedCell =>
  ({
    row: 1,
    itemName: "Bottle caps",
    section: "Plastic",
    side: "front",
    ink: 0.2,
    tallyInk: 0,
    hasValue: true,
    tallyOnly: false,
    digitValue: null,
    digitConfidence: 0,
    tallyCount: null,
    tallyConfidence: 0,
    ...o,
  }) as ExtractedCell;

describe("isAutoAccepted", () => {
  it("takes a reading at the threshold", () => {
    expect(isAutoAccepted(reading(AUTO_ACCEPT))).toBe(true);
  });

  it("shows a reading a hundredth below it", () => {
    expect(isAutoAccepted(reading(AUTO_ACCEPT - 0.01))).toBe(false);
  });

  it("shows a cell no reader answered", () => {
    expect(isAutoAccepted(null)).toBe(false);
    expect(isAutoAccepted(undefined)).toBe(false);
  });

  it("never hides a split, whatever the gate does", () => {
    // The midpoint taken when the two readers DISAGREE is the weakest answer
    // available -- right under a quarter of the time. The gate no longer keeps
    // it out of the box; this is what keeps it in front of a person.
    expect(RECONCILE_DEFAULTS.splitConfidence).toBeLessThan(AUTO_ACCEPT);
    expect(isAutoAccepted(reading(RECONCILE_DEFAULTS.splitConfidence, "split"))).toBe(false);
  });

  it("hides the digit reader working alone, which is what it is mostly hiding", () => {
    // Deliberately pinned rather than left implicit: on three real scans, 149
    // of 158, 373 of 379 and 293 of 296 auto-accepted cells are digits-only,
    // and that reader is right 86% of the time at its best. If a change to
    // `digitsConfidence` or `AUTO_ACCEPT` ever puts it back on the review
    // list, that is a large change in what the tool claims and this should
    // fail rather than pass quietly.
    expect(isAutoAccepted(reading(RECONCILE_DEFAULTS.digitsConfidence))).toBe(true);
  });
});

describe("the guessed readings", () => {
  // Both were added to fill boxes the readers used to leave empty, and neither
  // has been scored against eye labels. Whatever else moves, they must stay
  // under the threshold that decides who sees a cell.
  it("never clear the auto-accept threshold, or the surest band", () => {
    expect(SALVAGE_CONFIDENCE).toBeLessThan(AUTO_ACCEPT);
    // Capped, not always shown: they rank by expected error like any reading
    // (OVERSEGMENTED_CONFIDENCE in digits.ts), but never with the surest ones.
    expect(OVERSEGMENTED_CONFIDENCE).toBeLessThan(0.85);
  });

  it("still clear the gate, which is what puts them in a box", () => {
    expect(SALVAGE_CONFIDENCE).toBeGreaterThan(PREFILL_GATE);
    expect(OVERSEGMENTED_CONFIDENCE).toBeGreaterThan(PREFILL_GATE);
  });
});

describe("prefillFor", () => {
  it("fills every reading either reader offers", () => {
    expect(PREFILL_GATE).toBe(0);
    const weak = prefillFor(cell({ digitValue: 3, digitConfidence: 0.01 }));
    expect(weak?.value).toBe(3);
  });

  it("puts a placeholder in the box when neither reader answered", () => {
    // The empty box is gone: every cell a reviewer opens has a number in it.
    // What separates this from a reading is the source and the confidence, and
    // the export carries both.
    const none = prefillFor(cell({}));
    expect(none.value).toBe(PLACEHOLDER_VALUE);
    expect(none.source).toBe("placeholder");
    expect(none.confidence).toBe(0);
    expect(none.tally).toBeNull();
    expect(none.digits).toBeNull();
  });

  it("never hides a placeholder from the reviewer", () => {
    expect(isAutoAccepted(prefillFor(cell({})))).toBe(false);
  });

  it("says what a placeholder is, in the reviewer's words", () => {
    expect(prefillTag("placeholder")).toBe("nothing read: type it");
  });

  it("never puts a four-digit number in the box", () => {
    expect(prefillFor(cell({ digitValue: 999, digitConfidence: 0.9 })).value).toBe(999);
    const long = prefillFor(cell({ digitValue: 1112, digitConfidence: 0.9 }));
    expect(long.source).toBe("placeholder");
    expect(long.value).toBe(PLACEHOLDER_VALUE);
  });
});

describe("autoAcceptFor", () => {
  it("returns the reading for a cell nobody will be shown", () => {
    const strong = autoAcceptFor(cell({ digitValue: 7, digitConfidence: 0.99 }));
    // Capped at what one reader alone is worth, which is still over the line.
    expect(strong?.value).toBe(7);
    expect(strong?.confidence).toBe(RECONCILE_DEFAULTS.digitsConfidence);
  });

  it("returns null for a cell that stays on the review list", () => {
    expect(autoAcceptFor(cell({ digitValue: 7, digitConfidence: 0.4 }))).toBeNull();
  });
});

describe("autoAcceptedInScan", () => {
  const r = (confidence: number, source = "digits") =>
    ({ value: 1, confidence, source, tally: null, digits: 1 }) as Parameters<typeof autoAcceptedInScan>[0][number];

  it("shows the least confident fifth and takes the rest", () => {
    const confs = [0.9, 0.1, 0.8, 0.7, 0.2, 0.95, 0.6, 0.85, 0.5, 0.99];
    expect(autoAcceptedInScan(confs.map((c) => r(c)))).toEqual(confs.map((c) => c > 0.1 && c !== 0.2));
  });

  it("always shows a box with nothing read, even past the share", () => {
    const got = autoAcceptedInScan([r(0, "placeholder"), r(0, "placeholder"), r(0.1), null, r(0.9)]);
    expect(got).toEqual([false, false, true, false, true]);
  });
});

describe("autoAcceptedInScan ranking", () => {
  it("shows a long number before a short one of the same confidence", () => {
    const at = (value: number) => ({ value, confidence: 0.7, source: "digits", tally: null, digits: value }) as Reading;
    expect(autoAcceptedInScan([at(4), at(4), at(4), at(4), at(123)])).toEqual([true, true, true, true, false]);
  });

  it("shows an 11 before another two-digit number of the same confidence", () => {
    const at = (value: number) => ({ value, confidence: 0.3, source: "digits", tally: null, digits: value }) as Reading;
    // Last on the card, where the old tie-break took it as read.
    expect(autoAcceptedInScan([at(12), at(12), at(12), at(12), at(11)])).toEqual([true, true, true, true, false]);
  });
});

describe("autoAcceptedInScan with a second opinion", () => {
  const at = (value: number, confidence: number) =>
    ({ value, confidence, source: "digits", tally: null, digits: value }) as Reading;
  const five = [at(4, 0.6), at(4, 0.6), at(4, 0.6), at(4, 0.6), at(7, 0.99)];

  it("shows a sure reading the phone read differently", () => {
    expect(autoAcceptedInScan(five)).toEqual([false, true, true, true, true]);
    expect(autoAcceptedInScan(five, [null, null, null, null, 70])).toEqual([true, true, true, true, false]);
  });

  it("changes nothing where the phone agrees or has no reading", () => {
    expect(autoAcceptedInScan(five, [4, undefined, null, 4, 7])).toEqual(autoAcceptedInScan(five));
  });
});

describe("autoAcceptedInScan with the open readers", () => {
  const at = (value: number, confidence: number) =>
    ({ value, confidence, source: "digits", tally: null, digits: value }) as Reading;
  const five = [at(4, 0.6), at(4, 0.6), at(4, 0.6), at(4, 0.6), at(7, 0.99)];
  const votes = (n: number) => [...Array(n).fill(1), ...Array(8 - n).fill(7)] as (number | null)[];

  it(`shows a sure reading ${OTHER_READERS_DISAGREE} of them read differently`, () => {
    expect(autoAcceptedInScan(five, [], [], [null, null, null, null, votes(OTHER_READERS_DISAGREE)])).toEqual([
      true, true, true, true, false,
    ]);
  });

  it("shows first the flagged box more of them read differently", () => {
    const sure = Array.from({ length: 5 }, () => at(7, 0.99));
    // Two flagged, one shown (a fifth of five): the one eight disagree with.
    const got = autoAcceptedInScan(sure, [], [], [votes(4), votes(8), null, null, null]);
    expect(got).toEqual([true, false, true, true, true]);
  });

  it("changes nothing where fewer disagree, or they have no reading", () => {
    const fewer = votes(OTHER_READERS_DISAGREE - 1);
    const silent = Array(8).fill(null) as (number | null)[];
    expect(autoAcceptedInScan(five, [], [], [null, null, null, null, fewer])).toEqual(autoAcceptedInScan(five));
    expect(autoAcceptedInScan(five, [], [], [null, null, null, null, silent])).toEqual(autoAcceptedInScan(five));
  });
});

describe("autoAcceptedInScan by row", () => {
  const at = (value: number) => ({ value, confidence: 0.6, source: "digits", tally: null, digits: value }) as Reading;

  it("shows a one-digit reading on a row usually counted in tens first", () => {
    // Row 18, cigarette butts, is 10 or more on two cards in three; row 26 rarely.
    expect(autoAcceptedInScan([at(4), at(4), at(4), at(4), at(4)], [], [26, 26, 18, 26, 26])).toEqual([
      true,
      true,
      false,
      true,
      true,
    ]);
  });
});

describe("autoAcceptedInScan on three-digit readings", () => {
  const at = (value: number, confidence: number) =>
    ({ value, confidence, source: "digits", tally: null, digits: value }) as Reading;

  it("shows one made of 1s however sure the reader was", () => {
    // 112 is "|| 2" or a tally read as digits far more often than a hundred and twelve.
    expect(autoAcceptedInScan([at(4, 0.3), at(4, 0.3), at(4, 0.3), at(4, 0.3), at(112, 0.99)])).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("shows a confident hundred before an unsure single digit", () => {
    // A three-digit reading is off by 39-230 on average in every confidence band
    // measured; the one sure-looking pair had a miss of 220 (EXPECTED_ERROR).
    // A four at 0.3 is off by about 8. The hundred is the one to look at.
    expect(autoAcceptedInScan([at(4, 0.3), at(4, 0.3), at(4, 0.3), at(4, 0.3), at(100, 0.99)])).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("tallyFromReaders", () => {
  const counted = { value: 3, confidence: 0.3, source: "tally", tally: 3, digits: null } as Reading;

  it("reads only one clean count, or the same count repeated", () => {
    expect(tallyNumber("12")).toBe(12);
    expect(tallyNumber(" 7 ")).toBe(7);
    expect(tallyNumber("22 22")).toBe(22);
    expect(tallyNumber("28233")).toBeNull();
    expect(tallyNumber("45 8")).toBeNull();
    expect(tallyNumber("1 3 1")).toBeNull();
    expect(tallyNumber("")).toBeNull();
    expect(tallyNumber(null)).toBeNull();
  });

  it("puts in the average of the clean counts, rounded, at the box's own confidence", () => {
    expect(tallyFromReaders(counted, ["8", "11"])).toMatchObject({ value: 10, confidence: 0.3, source: "tally" });
    expect(tallyFromReaders(counted, ["8", "28233"])).toMatchObject({ value: 8, confidence: 0.3 });
  });

  it("keeps the app's count where neither reader gives a clean one", () => {
    expect(tallyFromReaders(counted, ["45 8", null])).toBe(counted);
    expect(tallyFromReaders(counted, undefined)).toBe(counted);
    expect(tallyFromReaders(counted, ["3", "3"])).toBe(counted);
  });

  it("counts a box first read as a number in the strip as a tally", () => {
    const written = { ...counted, source: "digits" } as Reading;
    expect(tallyFromReaders(written, ["3"])).toMatchObject({ value: 3, source: "tally" });
  });
});

describe("mainReading", () => {
  const digits = { value: 5, confidence: 0.6, source: "digits", tally: null, digits: 5 } as Reading;

  it("fills a written box with the tuned reader's number, unsure where ours read another", () => {
    expect(mainReading(digits, "15")).toMatchObject({ value: 15, confidence: TUNED_DISAGREES });
  });

  it("leaves the reading as it was where ours read the same", () => {
    expect(mainReading(digits, "5 ,")).toBe(digits);
  });

  it("keeps ours without a reading, and for counted tallies", () => {
    expect(mainReading(digits, null)).toBe(digits);
    expect(mainReading(digits, "—")).toBe(digits);
    expect(mainReading({ ...digits, source: "tally" }, "15").value).toBe(5);
  });

  it("keeps ours, doubted, where the tuned reader jumps to a hundred or more", () => {
    expect(mainReading({ ...digits, value: 12, digits: 12 }, "112")).toMatchObject({ value: 12, confidence: TUNED_DISAGREES });
    expect(mainReading({ ...digits, value: 120, digits: 120 }, "112")).toMatchObject({ value: 112 });
  });

  it("takes the tuned hundred where Apple read it too, or where ours is its start", () => {
    expect(mainReading({ ...digits, value: 2, digits: 2 }, "200", 200)).toMatchObject({ value: 200 });
    expect(mainReading({ ...digits, value: 20, digits: 20 }, "200")).toMatchObject({ value: 200 });
    expect(mainReading({ ...digits, value: 2, digits: 2 }, "200")).toMatchObject({ value: 2 });
  });

  it("keeps ours, at its own confidence, where Apple read what ours read", () => {
    const ours = { ...digits, value: 7, digits: 7, confidence: 0.8 };
    expect(mainReading(ours, "1", 7)).toMatchObject({ value: 7, confidence: 0.8 });
    expect(mainReading(ours, "1", 1)).toMatchObject({ value: 1, confidence: TUNED_DISAGREES });
    expect(mainReading(ours, "1", null)).toMatchObject({ value: 1, confidence: TUNED_DISAGREES });
  });
});
