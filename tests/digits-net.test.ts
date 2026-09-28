/**
 * The convolutional reader's arithmetic, on nets small enough to work out by hand.
 *
 * The trained net is checked against PyTorch by running both over the same
 * digits (see train_digits_cnn.py). What that cannot pin is WHY a mismatch
 * happens, and the two ways this goes wrong quietly are both orientation: a
 * convolution flipped (PyTorch's is a cross-correlation) or a flatten in the
 * wrong order. Either still returns ten numbers that look like logits.
 */
import { describe, expect, it } from "vitest";

import { classifyDigit, decodeModel, netLogits, type CnnModel } from "../src/lib/digits";

const b64 = (values: number[]) => {
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

/** A dense layer whose output o is the input at `pick[o]`. */
function picker(inputs: number, pick: number[]) {
  const w = new Array(10 * inputs).fill(0);
  pick.forEach((at, o) => (w[o * inputs + at] = 1));
  return { type: "dense", in: inputs, out: 10, w: b64(w), b: b64(new Array(10).fill(0)) };
}

const at = (y: number, x: number) => y * 28 + x;

describe("netLogits", () => {
  it("convolves the way PyTorch does, not flipped", () => {
    // Weight 1 at the kernel's top-left: output (y, x) takes input (y-1, x-1),
    // so ink moves down and right by one pixel.
    const kernel = [1, 0, 0, 0, 0, 0, 0, 0, 0];
    const model = decodeModel({
      kind: "cnn-28x28",
      temperature: 1,
      layers: [
        { type: "conv", in: 1, out: 1, k: 3, pad: 1, w: b64(kernel), b: b64([0]) },
        { type: "flatten" },
        picker(784, [at(6, 6), at(5, 5), at(4, 4), 0, 0, 0, 0, 0, 0, 0]),
      ],
    }) as CnnModel;

    const bitmap = new Uint8Array(784);
    bitmap[at(5, 5)] = 255;
    expect(Array.from(netLogits(bitmap, model)).slice(0, 3)).toEqual([1, 0, 0]);
  });

  it("pools, flattens channel-major, and reads the right cell", () => {
    // Two channels: the input and its negation, each ReLU'd and 2x2 pooled to
    // 14x14. Flattened channel-major, the second channel starts at 196.
    const model = decodeModel({
      kind: "cnn-28x28",
      temperature: 1,
      layers: [
        { type: "conv", in: 1, out: 2, k: 1, pad: 0, w: b64([1, -1]), b: b64([0, 1]) },
        { type: "relu" },
        { type: "maxpool", k: 2 },
        { type: "flatten" },
        picker(392, [3, 6, 196 + 3, 0, 0, 0, 0, 0, 0, 0]),
      ],
    }) as CnnModel;

    // Ink in the 2x2 block that pools into cell 3 of the top row.
    const bitmap = new Uint8Array(784);
    bitmap[at(1, 7)] = 255;
    const logits = netLogits(bitmap, model);
    expect(logits[0]).toBeCloseTo(1); // channel 0, cell 3: the ink
    // Channel 0, cell 6: blank. Flattened pixel-major instead, index 6 would be
    // cell 3's first channel -- the ink -- which is the mistake this catches.
    expect(logits[1]).toBeCloseTo(0);
    expect(logits[2]).toBeCloseTo(1); // channel 1, cell 3: 1 - 0 from the blank pixels beside the ink
  });
});

describe("classifyDigit with a net", () => {
  it("returns the top logit and its softmax at the model's temperature", () => {
    const model = decodeModel({
      kind: "cnn-28x28",
      temperature: 2,
      layers: [{ type: "flatten" }, picker(784, [0, 0, 0, at(10, 10), 0, 0, 0, 0, 0, 0])],
    });
    const bitmap = new Uint8Array(784);
    bitmap[at(10, 10)] = 255;

    const { label, confidence } = classifyDigit(bitmap, model);
    expect(label).toBe(3);
    // One logit of 1 among nine of 0, at temperature 2.
    expect(confidence).toBeCloseTo(1 / (1 + 9 * Math.exp(-1 / 2)), 6);
  });
});

describe("decodeModel for a net", () => {
  it("refuses a file whose layers do not fit together", () => {
    expect(() =>
      decodeModel({
        kind: "cnn-28x28",
        temperature: 1,
        layers: [{ type: "maxpool", k: 2 }, { type: "flatten" }, picker(784, new Array(10).fill(0))],
      }),
    ).toThrow(/expects 784 inputs, gets 196/);
  });

  it("refuses weights of the wrong length", () => {
    expect(() =>
      decodeModel({
        kind: "cnn-28x28",
        temperature: 1,
        layers: [
          { type: "conv", in: 1, out: 1, k: 3, pad: 1, w: b64([1, 2, 3]), b: b64([0]) },
          { type: "flatten" },
          picker(784, new Array(10).fill(0)),
        ],
      }),
    ).toThrow(/has 3 weights, expected 9/);
  });
});
