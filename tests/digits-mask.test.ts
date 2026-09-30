/**
 * The printed box, struck out of a TOTAL crop, and the handwriting beside it kept.
 *
 * `inkMask` used to blank a margin of 6% of the width on every side, and the
 * first digit of a number written hard against the left rule went with it.
 * These pin the two halves of what replaced it: a rule is removed wherever
 * registration landed it, and a stroke that is merely NEAR the rule is not.
 */
import { describe, expect, it } from "vitest";

import {
  decodeModel,
  inkMask,
  LIGHT_PENCIL,
  normalizeDigit,
  OVERSEGMENTED_CONFIDENCE,
  readDigits,
  segmentDigits,
} from "../src/lib/digits";

/** A blank 100x60 crop, paper at 230, with ink drawn in at 20. */
function crop(draw: (set: (x: number, y: number) => void) => void) {
  const width = 100;
  const height = 60;
  const data = new Uint8Array(width * height).fill(230);
  draw((x, y) => {
    if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = 20;
  });
  return { width, height, data };
}

const inkAt = (mask: Uint8Array, x: number, y: number) => mask[y * 100 + x] === 1;

/** A printed rule: straight, three pixels thick, the full height of the crop. */
const rule = (set: (x: number, y: number) => void, x0: number) => {
  for (let y = 0; y < 60; y++) for (let x = x0; x < x0 + 3; x++) set(x, y);
};

/** A handwritten "1": leaning, two pixels thick, well short of the box. */
const one = (set: (x: number, y: number) => void, x0: number) => {
  for (let y = 12; y < 48; y++) {
    const x = x0 + Math.round((48 - y) * 0.15);
    set(x, y);
    set(x + 1, y);
  }
};

/** A "0" as a thick ring, so there is a second digit to count. */
const nought = (set: (x: number, y: number) => void, cx: number) => {
  for (let a = 0; a < 360; a += 2) {
    const r = (a * Math.PI) / 180;
    for (let t = 0; t < 3; t++) set(Math.round(cx + (9 - t) * Math.cos(r)), Math.round(30 + (16 - t) * Math.sin(r)));
  }
};

describe("inkMask", () => {
  it("strikes a rule that registration landed inside the crop", () => {
    const mask = inkMask(crop((set) => {
      rule(set, 7); // inside what the old 6% margin covered
      nought(set, 50);
    }));
    for (let y = 10; y < 50; y++) expect(inkAt(mask, 8, y)).toBe(false);
    expect(inkAt(mask, 50 + 9, 30)).toBe(true);
  });

  it("strikes a rule on the far side too", () => {
    const mask = inkMask(crop((set) => {
      rule(set, 92);
      nought(set, 50);
    }));
    for (let y = 10; y < 50; y++) expect(inkAt(mask, 93, y)).toBe(false);
  });

  it("keeps a 1 written hard against the left edge, where the old margin ate it", () => {
    const boxes = segmentDigits(crop((set) => {
      one(set, 1); // leaning from x=1 to x=6: all but its top inside the old 6px margin
      nought(set, 40);
    }));
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.minX).toBeLessThan(10);
  });

  it("keeps that 1 when the rule is right beside it", () => {
    const boxes = segmentDigits(crop((set) => {
      rule(set, 0);
      one(set, 6);
      nought(set, 40);
    }));
    expect(boxes).toHaveLength(2);
  });
});

describe("readDigits on a number made only of 1s", () => {
  // A stand-in reader that calls every digit a 1, with near-total confidence.
  const b64 = (values: number[]) => {
    let out = "";
    for (const b of new Uint8Array(new Float32Array(values).buffer)) out += String.fromCharCode(b);
    return btoa(out);
  };
  const alwaysOne = decodeModel({
    kind: "cnn-28x28",
    temperature: 1,
    layers: [
      { type: "flatten" },
      { type: "dense", in: 784, out: 10, w: b64(new Array(7840).fill(0)), b: b64([0, 20, 0, 0, 0, 0, 0, 0, 0, 0]) },
    ],
  });

  it("is always shown, because two uprights in the box are as often a tally", () => {
    const reading = readDigits(crop((set) => {
      one(set, 30);
      one(set, 55);
    }), alwaysOne);
    expect(reading?.value).toBe(11);
    expect(reading?.confidence).toBe(OVERSEGMENTED_CONFIDENCE);
  });

  it("leaves a single 1 at the reader's own confidence", () => {
    // Drawn twice over, a pixel apart: a lone 2px stroke is under the 2% of
    // the box that inkThreshold wants before it calls anything written.
    const reading = readDigits(crop((set) => {
      one(set, 40);
      one(set, 42);
    }), alwaysOne);
    expect(reading?.value).toBe(1);
    expect(reading?.confidence).toBeGreaterThan(0.99);
  });
});

describe("readDigits on a number in light pencil", () => {
  // Paper at 250 and pencil at 215: well clear of the paper, and lighter than
  // the 200 the first look counts as ink. Read by eye this is a plain "1".
  function light(draw: (set: (x: number, y: number) => void) => void) {
    const width = 100;
    const height = 60;
    const data = new Uint8Array(width * height).fill(250);
    draw((x, y) => {
      if (x >= 0 && y >= 0 && x < width && y < height) data[y * width + x] = 215;
    });
    return { width, height, data };
  }
  const b64 = (values: number[]) => {
    let out = "";
    for (const b of new Uint8Array(new Float32Array(values).buffer)) out += String.fromCharCode(b);
    return btoa(out);
  };
  const readsOnes = decodeModel({
    kind: "cnn-28x28",
    temperature: 1,
    layers: [
      { type: "flatten" },
      { type: "dense", in: 784, out: 10, w: b64(new Array(7840).fill(0)), b: b64([0, 20, 0, 0, 0, 0, 0, 0, 0, 0]) },
    ],
  });
  const faintOne = light((set) => {
    one(set, 40);
    one(set, 42);
  });

  it("is invisible to the first look", () => {
    expect(segmentDigits(faintOne)).toHaveLength(0);
  });

  it("is read on the second, and always shown", () => {
    const reading = readDigits(faintOne, readsOnes);
    expect(reading?.value).toBe(1);
    expect(reading?.confidence).toBeLessThanOrEqual(OVERSEGMENTED_CONFIDENCE);
  });

  it("is sampled for the net with the threshold it was cut with", () => {
    // Sampled at the ordinary threshold the piece is paper, and the net is
    // handed a blank square.
    const paper = 250;
    const [piece] = segmentDigits(faintOne, undefined, paper - LIGHT_PENCIL.depth);
    const ink = (b: Uint8Array) => b.reduce((a, v) => a + v, 0);
    expect(ink(normalizeDigit(faintOne, piece!, paper - LIGHT_PENCIL.depth))).toBeGreaterThan(0);
    expect(ink(normalizeDigit(faintOne, piece!))).toBe(0);
  });

  it("refuses three pieces or more, which at this threshold is paper grain", () => {
    const three = light((set) => {
      for (const x of [20, 45, 70]) {
        one(set, x);
        one(set, x + 2);
      }
    });
    expect(readDigits(three, readsOnes)).toBeNull();
  });
});

describe("segmentDigits with room around the box", () => {
  // The same 100x60 crop, read as holding a printed box from x=20 to 90 and
  // y=12 to 48: room to the left, a little to the right, some above and below.
  const box = { x: 20, y: 12, width: 70, height: 36 };

  it("keeps a digit started on the box's left edge, which the bare box cut in half", () => {
    const boxes = segmentDigits(crop((set) => {
      // A 1 two thirds of the box tall, leaning from x=16 across the edge at 20.
      // (One the full height of the box, straight, on its edge, IS a rule.)
      for (let y = 18; y < 42; y++) {
        const x = 16 + Math.round((42 - y) * 0.2);
        set(x, y);
        set(x + 1, y);
      }
      nought(set, 55);
    }), box);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.minX).toBeLessThan(box.x);
  });

  it("leaves out the tally strip's last strokes, which are all outside the box", () => {
    const boxes = segmentDigits(crop((set) => {
      one(set, 2);
      one(set, 9);
      nought(set, 55);
    }), box);
    expect(boxes).toHaveLength(1);
  });

  it("leaves out a number from the row above", () => {
    const boxes = segmentDigits(crop((set) => {
      nought(set, 55);
      // A short stroke whose middle sits above the box.
      for (let y = 0; y < 14; y++) set(40, y);
      for (let y = 0; y < 14; y++) set(41, y);
    }), box);
    expect(boxes).toHaveLength(1);
  });
});

describe("segmentDigits on a 1 written close to the next digit", () => {
  it("keeps a whole 1 apart, where the fragment merge used to weld '10' into one digit", () => {
    const boxes = segmentDigits(crop((set) => {
      one(set, 30); // x 30..37
      nought(set, 52); // x 43..61: a 5px gap, and the pair still narrower than it is tall
    }));
    expect(boxes).toHaveLength(2);
  });

  it("still joins the two halves of a nought closed badly", () => {
    const boxes = segmentDigits(crop((set) => {
      for (let a = 100; a < 260; a += 2) {
        const r = (a * Math.PI) / 180;
        for (let t = 0; t < 3; t++) set(Math.round(50 + (9 - t) * Math.cos(r)), Math.round(30 + (16 - t) * Math.sin(r)));
      }
      for (let a = -70; a < 70; a += 2) {
        const r = (a * Math.PI) / 180;
        for (let t = 0; t < 3; t++) set(Math.round(53 + (9 - t) * Math.cos(r)), Math.round(30 + (16 - t) * Math.sin(r)));
      }
    }));
    expect(boxes).toHaveLength(1);
  });
});
