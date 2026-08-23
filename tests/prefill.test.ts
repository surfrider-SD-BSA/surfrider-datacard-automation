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
  AUTO_ACCEPT,
  PLACEHOLDER_VALUE,
  PREFILL_GATE,
  autoAcceptFor,
  isAutoAccepted,
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
  it("never clear the auto-accept threshold", () => {
    expect(SALVAGE_CONFIDENCE).toBeLessThan(AUTO_ACCEPT);
    expect(OVERSEGMENTED_CONFIDENCE).toBeLessThan(AUTO_ACCEPT);
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
