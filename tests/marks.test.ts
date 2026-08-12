import { describe, expect, it } from "vitest";
import { boxMarked, cropGray, findMarks, stripMarked, type MarkImage } from "../src/lib/marks";

/**
 * Synthetic cells, drawn the way the card is printed and the way volunteers
 * write on it.
 *
 * Synthetic rather than sampled from a scan for two reasons. The scans are
 * volunteer data and stay off this machine's repository, so a test built on
 * them could not run anywhere else; and each case here isolates ONE property of
 * the detector, which a real crop never does. The measurements that decide
 * whether the detector is good enough are in HANDOFF.md and come from real
 * scans; these are the guards that keep its parts from silently inverting.
 */

const PAPER = 248;

function blank(width = 100, height = 58, paper = PAPER): MarkImage {
  const data = new Uint8Array(width * height).fill(paper);
  // Scanner grain: a real crop is never flat, and a detector tuned on flat
  // paper finds marks in every real one.
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, paper + ((i * 37) % 7) - 3);
  return { width, height, data };
}

function hLine(img: MarkImage, y: number, thickness = 2, value = 90, from = 0, to = img.width) {
  for (let dy = 0; dy < thickness; dy++) {
    for (let x = from; x < to; x++) {
      const row = y + dy;
      if (row >= 0 && row < img.height) img.data[row * img.width + x] = value;
    }
  }
  return img;
}

function vLine(img: MarkImage, x: number, thickness = 2, value = 90, from = 0, to = img.height) {
  for (let dx = 0; dx < thickness; dx++) {
    for (let y = from; y < to; y++) {
      const col = x + dx;
      if (col >= 0 && col < img.width) img.data[y * img.width + col] = value;
    }
  }
  return img;
}

/** A pencil stroke: a slanted line of a given darkness below the paper. */
function stroke(img: MarkImage, x0: number, y0: number, x1: number, y1: number, ink = 60) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps);
    const y = Math.round(y0 + ((y1 - y0) * i) / steps);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < img.width && py >= 0 && py < img.height) {
          img.data[py * img.width + px] = PAPER - ink;
        }
      }
    }
  }
  return img;
}

describe("boxMarked: the printed card is not handwriting", () => {
  it("finds nothing in an empty box", () => {
    expect(boxMarked(blank())).toBe(false);
  });

  it("finds nothing in a box holding only its own rules", () => {
    const img = blank();
    hLine(img, 0);
    hLine(img, 56);
    vLine(img, 0);
    vLine(img, 97);
    expect(boxMarked(img)).toBe(false);
  });

  it("finds nothing when a rule lands in the middle of the crop", () => {
    // Registration is never exact to the pixel, so the neighbouring row's rule
    // often lands inside the box rather than along its edge. Rejecting ruling by
    // the shape of its component missed exactly this case.
    expect(boxMarked(hLine(blank(), 24))).toBe(false);
  });

  it("finds nothing in the corner where a rule meets a wall", () => {
    // These arrive as one component as wide as the box and half as tall, which
    // passes any bar on the height of a component.
    const img = blank();
    hLine(img, 1);
    vLine(img, 1, 2, 90, 0, 40);
    expect(boxMarked(img)).toBe(false);
  });
});

describe("boxMarked: handwriting is handwriting", () => {
  it("finds a plain digit", () => {
    expect(boxMarked(stroke(blank(), 40, 8, 40, 48))).toBe(true);
  });

  it("finds faint pencil a fixed threshold would miss", () => {
    // Ink 30 levels below paper: above the 170 the old ink measure used, so an
    // ink fraction sees nothing here at all.
    const img = stroke(blank(), 40, 8, 40, 48, 30);
    expect(Math.min(...img.data)).toBeGreaterThan(170);
    expect(boxMarked(img)).toBe(true);
  });

  it("finds a digit written across a rule", () => {
    const img = blank();
    hLine(img, 28);
    stroke(img, 45, 8, 45, 48);
    expect(boxMarked(img)).toBe(true);
  });

  it("finds a digit standing where the wall would be", () => {
    // A "1" is a narrow full-height stroke -- the column profile of the box's
    // own border. What separates them is that a volunteer writes inside it.
    const img = blank();
    vLine(img, 1);
    vLine(img, 97);
    stroke(img, 50, 2, 50, 55);
    expect(boxMarked(img)).toBe(true);
  });

  it("finds a dense tally written into the box", () => {
    // Dark across most rows of the crop. Striking every dark row as ruling
    // emptied this one and reported a blank box.
    const img = blank();
    for (let i = 0; i < 6; i++) stroke(img, 10 + i * 12, 6, 14 + i * 12, 50);
    expect(boxMarked(img)).toBe(true);
  });

  it("asks no more of a mark on a tall row than on a short one", () => {
    // The rows with wrapped captions are twice the height of the rest, and a
    // 22px tick is a 22px tick in both. Judged purely as a fraction of the crop
    // it would clear the bar on the short row and miss on the tall one.
    const short = stroke(blank(100, 45), 40, 10, 40, 32);
    const tall = stroke(blank(100, 99), 40, 20, 40, 42);
    expect(boxMarked(short)).toBe(true);
    expect(boxMarked(tall)).toBe(true);
  });

  it("survives a crop with no paper margin at all", () => {
    const img = blank(12, 10);
    expect(() => boxMarked(img)).not.toThrow();
    expect(boxMarked(img)).toBe(false);
  });
});

describe("stripMarked: the tally strip", () => {
  const strip = () => blank(530, 58);

  it("finds nothing in an empty strip", () => {
    expect(stripMarked(strip())).toBe(false);
  });

  it("finds nothing in a strip holding only ruling", () => {
    const img = strip();
    hLine(img, 0);
    hLine(img, 56);
    vLine(img, 527);
    expect(stripMarked(img)).toBe(false);
  });

  it("finds a run of tally strokes", () => {
    const img = strip();
    for (let i = 0; i < 5; i++) stroke(img, 30 + i * 14, 12, 34 + i * 14, 44);
    expect(stripMarked(img)).toBe(true);
  });

  it("finds a number written in the strip instead of the box", () => {
    const img = strip();
    stroke(img, 60, 10, 90, 46);
    stroke(img, 90, 10, 60, 46);
    stroke(img, 60, 10, 90, 10);
    expect(stripMarked(img)).toBe(true);
  });

  it("ignores a neighbouring row's ink hanging into the edge", () => {
    // The feet of the row above's strokes, and the tops of the printed caption
    // below. Both sit hard against an edge; neither is this row's data.
    const img = strip();
    for (let i = 0; i < 4; i++) stroke(img, 20 + i * 14, 0, 22 + i * 14, 4);
    for (let i = 0; i < 6; i++) stroke(img, 100 + i * 9, 55, 100 + i * 9, 57);
    expect(stripMarked(img)).toBe(false);
  });

  it("does not call one speck a tally", () => {
    expect(stripMarked(stroke(strip(), 200, 26, 203, 29))).toBe(false);
  });
});

describe("findMarks and cropGray", () => {
  it("reports the mark's own ink, not the closing that joined it up", () => {
    const img = stroke(blank(), 40, 10, 40, 46);
    const [mark] = findMarks(img);
    expect(mark).toBeDefined();
    // Three pixels wide by 37 tall, so a few hundred; the dilated component
    // covers far more and must not be what is counted.
    expect(mark!.count).toBeLessThan(mark!.width * mark!.height);
    expect(mark!.count).toBeGreaterThan(50);
  });

  it("clamps a crop to the page", () => {
    const page = blank(60, 40);
    const c = cropGray(page, { x: -10, y: -10, width: 100, height: 100 });
    expect(c.width).toBe(60);
    expect(c.height).toBe(40);
  });

  it("crops the rectangle asked for", () => {
    const page = blank(60, 40);
    page.data[21 * 60 + 31] = 0;
    const c = cropGray(page, { x: 30, y: 20, width: 10, height: 10 });
    expect(c.width).toBe(10);
    expect(c.height).toBe(10);
    expect(c.data[1 * 10 + 1]).toBe(0);
  });
});
