/**
 * Did anyone write in this row? Each box and tally strip is compared with the
 * blank form for its row (`reference/ink-blank.bin`: the median of that row over
 * the chapter's cards, so printed labels and rules vanish whatever the scanner
 * did to them). A reading of a box where nobody added anything is a reading of
 * nothing: a speck or a rule read as a 1.
 *
 * Measured 6 November 2026 with nobody checking, 3 runs over 402 cards: total off
 * about 9,173 -> 9,142, all boxes right 91.71% -> 92.04%, written numbers right
 * 93.96% -> 93.88% (very faint pencil is sometimes missed).
 */
import type { Rect } from "./cells";
import type { GrayImage } from "./image";

export interface BlankForms {
  tallyWidth: number;
  boxWidth: number;
  height: number;
  rows: number[];
  data: Uint8Array;
}

/** How much darker than the blank form counts as ink, 0-255. */
const INK_DIFFERENCE = 28;
/** A mark smaller than this many pixels, or shorter than this share of the box, is a speck. */
const MIN_PIXELS = 8;
const MIN_HEIGHT = 0.18;

/**
 * The crop at (w, h): area average when shrinking both ways, else straight-line
 * blending, as the measurement that set the thresholds above did.
 */
export function resizeCrop(src: GrayImage, rect: Rect, w: number, h: number): Uint8Array {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(src.width, rect.x + rect.width);
  const y1 = Math.min(src.height, rect.y + rect.height);
  const sw = x1 - x0;
  const sh = y1 - y0;
  const out = new Uint8Array(w * h).fill(255);
  if (sw <= 0 || sh <= 0) return out;
  const at = (x: number, y: number) => src.data[(y0 + y) * src.width + x0 + x]!;
  const fx = sw / w;
  const fy = sh / h;
  if (fx >= 1 && fy >= 1) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const xa = x * fx;
        const xb = (x + 1) * fx;
        const ya = y * fy;
        const yb = (y + 1) * fy;
        let sum = 0;
        for (let sy = Math.floor(ya); sy < Math.min(sh, Math.ceil(yb)); sy++) {
          const wy = Math.min(sy + 1, yb) - Math.max(sy, ya);
          for (let sx = Math.floor(xa); sx < Math.min(sw, Math.ceil(xb)); sx++) {
            sum += at(sx, sy) * wy * (Math.min(sx + 1, xb) - Math.max(sx, xa));
          }
        }
        out[y * w + x] = Math.round(sum / (fx * fy));
      }
    }
    return out;
  }
  for (let y = 0; y < h; y++) {
    const v = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const v0 = Math.floor(v);
    const v1 = Math.min(sh - 1, v0 + 1);
    for (let x = 0; x < w; x++) {
      const u = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const u0 = Math.floor(u);
      const u1 = Math.min(sw - 1, u0 + 1);
      const top = at(u0, v0) + (at(u1, v0) - at(u0, v0)) * (u - u0);
      const bottom = at(u0, v1) + (at(u1, v1) - at(u0, v1)) * (u - u0);
      out[y * w + x] = Math.round(top + (bottom - top) * (v - v0));
    }
  }
  return out;
}

/** True when `crop` holds a mark tall enough to be writing that `blank` does not. */
export function hasInk(crop: Uint8Array, blank: Uint8Array, offset: number, w: number, h: number): boolean {
  const on = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      if (blank[offset + y * w + x]! - crop[y * w + x]! > INK_DIFFERENCE) on[y * w + x] = 1;
    }
  }
  const stack: number[] = [];
  for (let start = 0; start < on.length; start++) {
    if (!on[start]) continue;
    on[start] = 0;
    stack.push(start);
    let pixels = 0;
    let top = h;
    let bottom = -1;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p - px) / w;
      pixels++;
      if (py < top) top = py;
      if (py > bottom) bottom = py;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (on[n]) {
            on[n] = 0;
            stack.push(n);
          }
        }
      }
    }
    if (pixels >= MIN_PIXELS && bottom - top + 1 >= MIN_HEIGHT * h) return true;
  }
  return false;
}

/** True when neither the box nor the strip of `row` holds anything the blank form does not. False without a form for the row. */
export function noInk(image: GrayImage, row: number, total: Rect, tally: Rect, forms: BlankForms | null): boolean {
  const index = forms ? forms.rows.indexOf(row) : -1;
  if (!forms || index < 0) return false;
  const { tallyWidth: tw, boxWidth: bw, height: h, data } = forms;
  const start = index * (tw + bw) * h;
  return (
    !hasInk(resizeCrop(image, total, bw, h), data, start + tw * h, bw, h) &&
    !hasInk(resizeCrop(image, tally, tw, h), data, start, tw, h)
  );
}
