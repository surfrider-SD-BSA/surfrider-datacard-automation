/**
 * The digit reader's comparison, which had no tests at all.
 *
 * `matchVariants` is the whole of what makes a near miss score as a near miss,
 * and it is now the most expensive thing the reader does -- 45 forms of every
 * query against every exemplar in the poll. Its properties are cheap to state
 * and were previously only ever checked by whether the accuracy figure moved,
 * which is a slow and ambiguous test: a variant generated wrongly makes the
 * model slightly worse and nothing says why.
 */
import { describe, expect, it } from "vitest";

import { classifyDigit, matchVariants, prepare, unitNorm } from "../src/lib/digits";

/** A crude 28x28 stroke, so there is something with a shape to move around. */
function stroke(x0: number, y0: number, x1: number, y1: number, thickness = 1): Uint8Array {
  const b = new Uint8Array(28 * 28);
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    for (let dy = -thickness; dy <= thickness; dy++) {
      for (let dx = -thickness; dx <= thickness; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && py >= 0 && px < 28 && py < 28) b[py * 28 + px] = 255;
      }
    }
  }
  return b;
}

const norm = (v: Float32Array) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const l2 = (a: Float32Array, b: Float32Array) =>
  Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]!) ** 2, 0));

describe("matchVariants", () => {
  const q = prepare(stroke(14, 6, 14, 21));

  it("offers every warp at every offset", () => {
    expect(matchVariants(q)).toHaveLength(45);
  });

  it("gives unit vectors, because the exemplars are unit vectors", () => {
    // A distance between differently-scaled vectors measures the scaling.
    for (const v of matchVariants(q)) expect(norm(v)).toBeCloseTo(1, 5);
  });

  it("includes the query itself, so a warp can never lose to no warp", () => {
    const closest = Math.min(...matchVariants(q).map((v) => l2(v, unitNorm(Float32Array.from(q)))));
    expect(closest).toBeCloseTo(0, 5);
  });

  it("reaches forms the offsets alone cannot", () => {
    // The point of the warps. If every warped form were within rounding of
    // some plain offset, the 45 comparisons would be 9 comparisons and 5x the
    // cost for nothing.
    const all = matchVariants(q);
    const offsetsOnly = all.slice(0, 9);
    const furthest = Math.max(...all.map((v) => Math.min(...offsetsOnly.map((o) => l2(v, o)))));
    expect(furthest).toBeGreaterThan(0.2);
  });

  it("closes the gap on a digit written smaller", () => {
    // Size is what `prepare` does NOT normalize away, and it is where most of
    // the measured gain came from: +1.0 point for size against +0.3 for tilt.
    const small = prepare(stroke(14, 9, 14, 18));
    const best = Math.min(...matchVariants(small).map((v) => l2(v, q)));
    expect(best).toBeLessThan(l2(small, q));
  });

  it("closes the gap on a heavier pencil", () => {
    // Not a transformation the family was chosen for -- a scale warp thickens
    // a stroke as a side effect, and pencil weight varies more across
    // volunteers than anything else on these cards.
    const heavy = prepare(stroke(14, 6, 14, 21, 2));
    const best = Math.min(...matchVariants(heavy).map((v) => l2(v, q)));
    expect(best).toBeLessThan(l2(heavy, q));
  });

  it("leaves alone what prepare has already normalized", () => {
    // Documenting the limit rather than the promise. `prepare` recentres the
    // ink and shears out the writer's slant, so a straight stroke moved a
    // pixel or leaned over is ALREADY on top of its upright twin before any
    // variant is tried, and no warp can improve on a distance of zero. The
    // warps earn their cost on real handwriting, where recentring by centre of
    // mass is approximate because the shape itself differs.
    const moved = prepare(stroke(15, 6, 15, 21));
    expect(l2(moved, q)).toBeCloseTo(0, 5);
  });

});

describe("classifyDigit", () => {
  const upright = stroke(14, 6, 14, 21);
  const model = {
    k: 3,
    exemplars: [
      { label: 1, v: prepare(upright) },
      { label: 1, v: prepare(stroke(13, 6, 13, 21)) },
      { label: 1, v: prepare(stroke(15, 6, 15, 21)) },
      { label: 0, v: prepare(stroke(8, 6, 8, 21)) },
      { label: 0, v: prepare(stroke(20, 6, 20, 21)) },
    ],
  };

  it("reads a digit its exemplars agree on, and says so", () => {
    const { label, confidence } = classifyDigit(upright, model);
    expect(label).toBe(1);
    expect(confidence).toBe(1);
  });

  it("declines when there is nothing to compare against", () => {
    expect(classifyDigit(upright, { k: 3, exemplars: [] })).toEqual({ label: null, confidence: 0 });
  });
});
