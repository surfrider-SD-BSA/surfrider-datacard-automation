/**
 * Where every value sits on the registered card.
 *
 * This is the file that replaces a vision model's understanding of the form:
 * once a scanned page is registered against the reference template, each cell's
 * location is a constant and no detection is needed.
 *
 * ---------------------------------------------------------------------------
 * Those constants are MEASURED, not written by hand.
 *
 * They are produced by the calibration tool (`src/ui/calibrate`) from a
 * high-resolution scan of a BLANK card, and stored in
 * `assets/reference/cells.front.json` / `cells.back.json`. Hand-typed pixel
 * guesses would be silently wrong in a way that looks correct in code review
 * and fails on every real scan, so this module refuses to invent them: if the
 * calibration files are absent, loading throws with instructions.
 *
 * Re-run calibration whenever the printed card changes -- that is the listed
 * risk "card layout changes break the cell map".
 * ---------------------------------------------------------------------------
 */

import { itemForRow, type CardColumn, type CardSide } from "./taxonomy";

/**
 * A rectangle in *reference-template space*: pixel coordinates on the blank
 * card scan, at the resolution recorded in `CellMap.referenceSize`. Registration
 * maps an incoming page onto this space, so these never change per scan.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellBoxes {
  /** Template row this cell belongs to. */
  row: number;
  /** Which of the side's two printed columns this row sits in. */
  column: CardColumn;
  /** The TOTAL column box, where a numeric total is written. */
  total: Rect;
  /** The tally area to the left of the TOTAL column. */
  tally: Rect;
}

export interface CellMap {
  side: CardSide;
  /** Size of the reference scan these coordinates were measured against. */
  referenceSize: { width: number; height: number };
  /** DPI of the reference scan, recorded so crops can be resampled sanely. */
  referenceDpi: number;
  /** Anchor marks used to register a page against this template. */
  anchors: Rect[];
  cells: CellBoxes[];
}

export class CellMapError extends Error {}

/**
 * Validate a calibration file.
 *
 * Checks the things that would otherwise surface as mystifying recognition
 * failures: unknown rows, boxes off the page, and overlapping TOTAL boxes
 * (which mean two adjacent rows would be cropped from the same pixels).
 */
export function validateCellMap(map: CellMap): void {
  const { width, height } = map.referenceSize;
  if (!(width > 0 && height > 0)) {
    throw new CellMapError("referenceSize must be positive");
  }
  if (map.anchors.length < 2) {
    throw new CellMapError(
      "at least 2 anchor marks are needed to register a page",
    );
  }
  if (map.cells.length === 0) {
    throw new CellMapError("cell map is empty");
  }

  const seen = new Set<number>();
  for (const cell of map.cells) {
    const item = itemForRow(cell.row);
    if (!item) {
      throw new CellMapError(`row ${cell.row} is not a taxonomy item row`);
    }
    if (item.side !== map.side) {
      throw new CellMapError(
        `row ${cell.row} (${item.name}) is printed on the ${item.side} of the ` +
          `card but appears in the ${map.side} cell map`,
      );
    }
    if (item.column !== cell.column) {
      throw new CellMapError(
        `row ${cell.row} (${item.name}) is printed in the ${item.column} column ` +
          `but was calibrated in the ${cell.column} one`,
      );
    }
    if (seen.has(cell.row)) {
      throw new CellMapError(`row ${cell.row} appears twice in the cell map`);
    }
    seen.add(cell.row);

    for (const [name, r] of [
      ["total", cell.total],
      ["tally", cell.tally],
    ] as const) {
      if (r.width <= 0 || r.height <= 0) {
        throw new CellMapError(`row ${cell.row} ${name} box has no area`);
      }
      if (r.x < 0 || r.y < 0 || r.x + r.width > width || r.y + r.height > height) {
        throw new CellMapError(
          `row ${cell.row} ${name} box falls outside the reference page`,
        );
      }
    }
  }

  // Only compare boxes within the same printed column: the card prints two
  // independent columns per side, so a left-column row and a right-column row
  // legitimately share a vertical band.
  for (const column of ["left", "right"] as const) {
    const byTop = map.cells
      .filter((c) => c.column === column)
      .sort((a, b) => a.total.y - b.total.y);

    for (let i = 1; i < byTop.length; i++) {
      const prev = byTop[i - 1];
      const cur = byTop[i];
      if (!prev || !cur) continue;
      if (cur.total.y < prev.total.y + prev.total.height * 0.5) {
        throw new CellMapError(
          `TOTAL boxes for rows ${prev.row} and ${cur.row} (${column} column) ` +
            `overlap by more than half a row height - recalibrate`,
        );
      }
    }
  }
}

/**
 * Load a calibrated cell map.
 *
 * @param side which side of the card
 * @param fetchJson injected so this works in a worker, the main thread, or a test
 */
export async function loadCellMap(
  side: CardSide,
  fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
): Promise<CellMap> {
  const url = `assets/reference/cells.${side}.json`;
  let raw: unknown;
  try {
    raw = await fetchJson(url);
  } catch (cause) {
    throw new CellMapError(
      `No cell map at ${url}. The ${side} of the card has not been calibrated ` +
        `yet.\n\nTo produce it: scan a BLANK data card at 300 DPI, open the ` +
        `calibration tool, and mark the TOTAL column and tally area for each ` +
        `row. See docs/calibration.md.`,
    );
  }

  const map = raw as CellMap;
  if (map?.side !== side) {
    throw new CellMapError(`${url} declares side "${map?.side}", expected "${side}"`);
  }
  validateCellMap(map);
  return map;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Rows expected on a side but missing from its calibration -- shown as a warning. */
export function missingRows(map: CellMap, expected: readonly number[]): number[] {
  const have = new Set(map.cells.map((c) => c.row));
  return expected.filter((r) => !have.has(r));
}
