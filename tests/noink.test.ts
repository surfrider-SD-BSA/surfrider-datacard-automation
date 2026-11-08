import { describe, expect, it } from "vitest";
import { noInk, type BlankForms } from "../src/lib/noink";
import { emptyWhereNoInk, restoredHundreds } from "../src/lib/prefill";
import type { Reading } from "../src/lib/reading";

const tw = 50;
const bw = 20;
const h = 48;
const forms: BlankForms = { tallyWidth: tw, boxWidth: bw, height: h, rows: [18], data: new Uint8Array((tw + bw) * h).fill(240) };
const total = { x: 50, y: 0, width: bw, height: h };
const tally = { x: 0, y: 0, width: tw, height: h };
const page = () => ({ width: 70, height: h, data: new Uint8Array(70 * h).fill(240) });

describe("noInk", () => {
  it("finds nothing on a page that matches the blank form", () => {
    expect(noInk(page(), 18, total, tally, forms)).toBe(true);
  });
  it("finds a stroke in the box", () => {
    const p = page();
    for (let y = 10; y < 30; y++) p.data[y * 70 + 60] = 40;
    expect(noInk(p, 18, total, tally, forms)).toBe(false);
  });
  it("finds a stroke in the tally strip", () => {
    const p = page();
    for (let y = 10; y < 30; y++) p.data[y * 70 + 25] = 40;
    expect(noInk(p, 18, total, tally, forms)).toBe(false);
  });
  it("ignores a speck", () => {
    const p = page();
    p.data[20 * 70 + 60] = 40;
    p.data[20 * 70 + 61] = 40;
    expect(noInk(p, 18, total, tally, forms)).toBe(true);
  });
  it("says nothing without a form for the row or without forms", () => {
    expect(noInk(page(), 99, total, tally, forms)).toBe(false);
    expect(noInk(page(), 18, total, tally, null)).toBe(false);
  });
});

describe("emptyWhereNoInk", () => {
  const r = { value: 1, confidence: 0.3, source: "digits" } as Reading;
  it("empties a reading of a box nobody wrote in", () => {
    expect(emptyWhereNoInk(r, true).value).toBe(0);
  });
  it("leaves the rest alone", () => {
    expect(emptyWhereNoInk(r, false)).toBe(r);
    expect(emptyWhereNoInk(r, undefined)).toBe(r);
  });
});

describe("restoredHundreds", () => {
  const r = { value: 28, confidence: 0.4, source: "digits" } as Reading;
  it("takes the 3-digit number two readers agree on", () => {
    expect(restoredHundreds(r, ["128", "12", "128", null]).value).toBe(128);
  });
  it("needs two readers to agree", () => {
    expect(restoredHundreds(r, ["128", "228", "12"])).toBe(r);
  });
  it("needs the number to end in ours", () => {
    expect(restoredHundreds(r, ["132", "132"])).toBe(r);
  });
  it("leaves sure readings, and empty ones, alone", () => {
    expect(restoredHundreds({ ...r, confidence: 0.9 }, ["128", "128"]).value).toBe(28);
    expect(restoredHundreds({ ...r, value: 0 }, ["100", "100"]).value).toBe(0);
  });
});
