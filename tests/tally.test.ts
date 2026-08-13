import { describe, expect, it } from "vitest";
import { countTally, type TallyReading } from "../src/lib/tally";
import type { MarkImage } from "../src/lib/marks";

/**
 * Synthetic tally strips, drawn the way volunteers draw them.
 *
 * Synthetic for the same reasons as `marks.test.ts`: the scans are volunteer
 * data and stay off any repository, and each case here isolates ONE property of
 * the counter, which a real strip never does. The figures that decide whether
 * the counter is good enough are measured on real scans and recorded in
 * HANDOFF.md; these are the guards that stop its parts silently inverting.
 *
 * Nearly every case below is a real failure that was found on a real scan and
 * cost a measurement to diagnose.
 */

const PAPER = 248;

function blank(width = 460, height = 58): MarkImage {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(255, PAPER + ((i * 37) % 7) - 3);
  return { width, height, data };
}

/**
 * Space between two strokes of a tally, in pixels.
 *
 * Measured off the scans rather than picked: real strokes sit 11 to 20 pixels
 * apart at 200 DPI. An earlier version of this file drew them 11 apart with a
 * three-pixel brush, which leaves an eight-pixel channel between strokes --
 * tighter than anything on a real card, and tight enough that the strip
 * decomposes differently. A synthetic that is harder than reality is not a
 * stricter test, it is a test of a different thing.
 */
const PITCH = 14;

/** A pencil stroke from (x0,y0) to (x1,y1), three pixels wide. */
function stroke(img: MarkImage, x0: number, y0: number, x1: number, y1: number, ink = 90) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
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

/**
 * A group of five: four uprights and a fifth struck across them.
 *
 * The crossbar deliberately overhangs both ends, which is what it does on the
 * card and is why counting by the gaps between strokes does not work.
 */
function groupOfFive(img: MarkImage, x: number, top = 12, bottom = 46) {
  for (let i = 0; i < 4; i++) stroke(img, x + i * PITCH, top, x + i * PITCH - 3, bottom);
  stroke(img, x - 18, top + 24, x + 55, top + 6);
  return img;
}

/** N uprights in a row, no crossbar. */
function uprights(img: MarkImage, x: number, n: number, top = 12, bottom = 46) {
  for (let i = 0; i < n; i++) stroke(img, x + i * PITCH, top, x + i * PITCH - 3, bottom);
  return img;
}

const count = (img: MarkImage, options = {}): TallyReading => countTally(img, options);

describe("countTally", () => {
  it("counts a bare run of strokes", () => {
    expect(count(uprights(blank(), 40, 3)).count).toBe(3);
    expect(count(uprights(blank(), 40, 2)).count).toBe(2);
  });

  it("counts a crossed group of five as five, not four", () => {
    const r = count(groupOfFive(blank(), 40));
    expect(r.count).toBe(5);
    expect(r.strokes).toBe(4);
    expect(r.bars).toBe(1);
  });

  it("counts several groups and a remainder", () => {
    const img = blank(460);
    groupOfFive(img, 40);
    groupOfFive(img, 150);
    uprights(img, 260, 3);
    const r = count(img);
    expect(r.count).toBe(13);
    expect(r.groups).toEqual([5, 5, 3]);
  });

  it("declines a strip holding a written number instead of a tally", () => {
    // A "6": a bowl and a tail. Two of its arcs are straight enough to be
    // strokes, so what rules it out has to be the ink they cannot explain.
    const img = blank();
    stroke(img, 60, 14, 44, 34);
    stroke(img, 44, 34, 44, 40);
    stroke(img, 44, 40, 52, 46);
    stroke(img, 52, 46, 60, 40);
    stroke(img, 60, 40, 58, 33);
    stroke(img, 58, 33, 46, 32);
    expect(count(img).count).toBeNull();
  });

  it("declines a scribbled-out cell", () => {
    // Drawn as overlapping loops rather than a cross-hatch. A hatch of straight
    // lines is, honestly, a set of straight lines, and an early version of this
    // test failed for a good reason: the counter explained it perfectly. What a
    // volunteer actually does to a cell they want gone is scribble, and a
    // scribble is curves.
    const img = blank();
    for (let i = 0; i < 10; i++) {
      const cx = 44 + i * 5;
      for (let a = 0; a < 360; a += 12) {
        const r = ((a * Math.PI) / 180) * 1.2;
        const x = cx + Math.cos((a * Math.PI) / 180) * (9 + r);
        const y = 30 + Math.sin((a * Math.PI) / 180) * 13;
        stroke(img, Math.round(x), Math.round(y), Math.round(x), Math.round(y));
      }
    }
    expect(count(img).count).toBeNull();
  });

  it("declines strokes that are not parallel", () => {
    // The humps of a lower-case "m" decompose into perfectly straight segments
    // at unrelated angles. One such strip was read as a tally of four.
    const img = blank();
    stroke(img, 40, 12, 40, 46);
    stroke(img, 52, 46, 60, 14);
    stroke(img, 60, 14, 74, 44);
    expect(count(img).count).toBeNull();
  });

  it("declines a tally that runs off the end of the strip", () => {
    // The part outside the crop cannot be counted, and a clipped tally looks
    // exactly like a shorter one that happens to sit at the edge.
    const img = blank(200);
    uprights(img, 1, 5);
    expect(count(img).count).toBeNull();
    expect(count(img).reason).toBe("runs off the strip");
  });

  it("declines when a group in the middle does not hold five", () => {
    // Tallies are written in fives. A middle group of four means a crossbar was
    // missed, and the total cannot be trusted even though every stroke in it
    // may have been found.
    const img = blank(460);
    uprights(img, 40, 4);
    groupOfFive(img, 160);
    uprights(img, 280, 2);
    expect(count(img).count).toBeNull();
  });

  it("declines an empty strip", () => {
    expect(count(blank()).count).toBeNull();
  });

  describe("the printed rule between the tally space and the TOTAL box", () => {
    /** A rule down the page: it runs the full height of whatever is cropped. */
    function printedRule(img: MarkImage, x: number) {
      for (let y = 0; y < img.height; y++) {
        for (let dx = 0; dx < 2; dx++) img.data[y * img.width + x + dx] = 120;
      }
      return img;
    }

    it("is not counted as a stroke, given context above and below the row", () => {
      // Some card printings put the TOTAL box's left border INSIDE the tally
      // rectangle. Left in, it is dense, full-length and perfectly upright: a
      // flawless stroke by every other test here, added to every count on the
      // scan.
      const img = printedRule(uprights(blank(), 40, 3), 420);
      const context = printedRule(blank(460, 116), 420);
      expect(count(img, { context }).count).toBe(3);
    });

    it("does not take a real full-height stroke with it", () => {
      // The reason the test needs context at all: within one strip a volunteer's
      // tall upright stroke and a printed rule are the same column of pixels.
      // What separates them is that the rule carries on through the rows above
      // and below and the stroke stops at its own row.
      const img = blank();
      uprights(img, 40, 2);
      stroke(img, 300, 0, 300, img.height - 1);
      const context = blank(460, 116);
      expect(count(img, { context }).count).toBe(3);
    });
  });

  it("puts a stroke broken in the middle back together", () => {
    // A pencil lifts off the paper. Left alone the two halves are two strokes,
    // and a tally of three reads as a tally of four.
    const img = blank();
    stroke(img, 40, 12, 39, 26);
    stroke(img, 38, 33, 37, 46);
    stroke(img, 62, 12, 59, 46);
    expect(count(img).count).toBe(2);
  });

  it("does not join two strokes standing side by side", () => {
    // The guard on the rule above: pieces of a broken stroke are STACKED, where
    // two strokes of a tally span the same rows.
    const img = uprights(blank(), 40, 2);
    expect(count(img).count).toBe(2);
  });
});
