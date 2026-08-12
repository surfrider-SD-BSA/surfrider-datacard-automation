/**
 * Runtime schemas for everything that crosses a trust boundary: values coming
 * out of the recognizer, job state restored from IndexedDB after a refresh, and
 * the completeness gate that guards export.
 */

import { z } from "zod";
import { MAX_VOLUNTEERS, TAXONOMY } from "./taxonomy";

const ITEM_ROWS = new Set<number>(TAXONOMY.map((i) => i.row));

/** A template row that actually corresponds to a printed item. */
export const itemRow = z
  .number()
  .int()
  .refine((r) => ITEM_ROWS.has(r), { message: "not a taxonomy item row" });

export const confidence = z.number().min(0).max(1);

export const cardSide = z.enum(["front", "back"]);
export const cardType = z.enum(["total", "tally"]);

/**
 * How a value reached its current state.
 * `recognized` -- straight from the model, untouched.
 * `accepted`   -- a human saw it in triage and agreed.
 * `corrected`  -- a human changed it.
 * `manual`     -- typed in with no usable prediction.
 */
export const valueSource = z.enum(["recognized", "accepted", "corrected", "manual"]);

export const cellPrediction = z.object({
  row: itemRow,
  /** Final value. Zero means the volunteer left the row blank. */
  value: z.number().int().min(0),
  confidence,
  source: valueSource,
  /** What the recognizer originally said, kept even after a correction. */
  rawPrediction: z.number().int().min(0).nullable(),
  /** Runner-up reading, shown in triage: "26 or 28". */
  alternative: z.number().int().min(0).nullable(),
  /** Crop of the cell, for the triage screen. Object URL or data URL. */
  cropRef: z.string().nullable(),
});
export type CellPrediction = z.infer<typeof cellPrediction>;

export const pageClassification = z.enum(["front", "back", "other", "unreadable"]);

export const scannedPage = z.object({
  /** 1-based page number in the source PDF. */
  pageNumber: z.number().int().min(1),
  classification: pageClassification,
  /** Cross-correlation score against the reference template. */
  registrationScore: z.number().min(0).max(1),
  /** Deskew angle applied, in degrees. */
  skewDegrees: z.number(),
});
export type ScannedPage = z.infer<typeof scannedPage>;

export const card = z
  .object({
    cardNumber: z.number().int().min(1).max(MAX_VOLUNTEERS),
    pages: z.array(z.number().int().min(1)).min(1).max(2),
    cardType,
    values: z.array(cellPrediction),
    /** Set when registration or page pairing failed for this card. */
    problem: z.string().nullable(),
  })
  .refine(
    (c) => new Set(c.values.map((v) => v.row)).size === c.values.length,
    { message: "duplicate item rows on one card" },
  );
export type Card = z.infer<typeof card>;

/**
 * Event metadata. The completeness gate lives here: date and shoreline are
 * required to export, everything else is optional because volunteers routinely
 * leave it blank -- including the head count, which is written on the leader's
 * card and often not on any of the others.
 */
export const eventMetadata = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  shoreline: z.string().min(1),
  volunteers: z.number().int().min(1).max(MAX_VOLUNTEERS).nullable(),
  pounds: z.number().min(0).nullable(),
  durationHours: z.number().min(0).nullable(),
  dataEntryVolunteer: z.string().nullable(),
  club: z.string().nullable(),
});
export type EventMetadata = z.infer<typeof eventMetadata>;

/** Metadata as it stands mid-triage, before the human has filled the gaps. */
export const partialEventMetadata = eventMetadata.partial();
export type PartialEventMetadata = z.infer<typeof partialEventMetadata>;

export const jobStatus = z.enum([
  "rasterizing",
  "registering",
  "recognizing",
  "needs-review",
  "ready",
  "failed",
]);

export const job = z.object({
  id: z.string(),
  sourcePdfName: z.string(),
  createdAt: z.string().datetime(),
  status: jobStatus,
  pages: z.array(scannedPage),
  cards: z.array(card),
  event: partialEventMetadata,
  /** Page-level problems that must be resolved before any value is shown. */
  alignmentProblems: z.array(z.string()),
});
export type Job = z.infer<typeof job>;

/** Anything below this is queued for human review. Tuned in Phase 3. */
export const REVIEW_THRESHOLD = 0.9;

export function needsReview(p: CellPrediction): boolean {
  if (p.source === "accepted" || p.source === "corrected" || p.source === "manual") {
    return false;
  }
  return p.confidence < REVIEW_THRESHOLD;
}

export interface GateResult {
  canExport: boolean;
  /** Must be resolved before export. */
  blockers: string[];
  /** Surfaced but non-blocking. */
  warnings: string[];
}

/**
 * The pre-export completeness gate.
 *
 * Blocks only on what makes the spreadsheet unusable; everything else is a
 * warning, because a warning the user can override beats a gate they route
 * around.
 */
export function checkExportGate(j: Job): GateResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (j.alignmentProblems.length > 0) {
    blockers.push(
      `${j.alignmentProblems.length} page alignment problem(s) must be resolved first`,
    );
  }

  const parsed = eventMetadata.safeParse(j.event);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      blockers.push(`Event ${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (j.cards.length === 0) {
    blockers.push("No cards were read from this PDF");
  }

  const stated = j.event.volunteers;
  if (stated != null && stated !== j.cards.length) {
    warnings.push(
      `Leader card says ${stated} volunteers but ${j.cards.length} cards were found`,
    );
  }

  if (j.event.pounds == null || j.event.pounds === 0) {
    warnings.push("Pounds of trash is missing or zero");
  }

  for (const c of j.cards) {
    const scored = c.values.filter((v) => v.source === "recognized");
    if (scored.length > 0 && scored.every((v) => v.confidence < REVIEW_THRESHOLD)) {
      warnings.push(
        `Card ${c.cardNumber} is low confidence throughout - usually a bad scan`,
      );
    }
  }

  const pending = j.cards.flatMap((c) => c.values.filter(needsReview));
  if (pending.length > 0) {
    warnings.push(`${pending.length} value(s) still flagged for review`);
  }

  return { canExport: blockers.length === 0, blockers, warnings };
}
