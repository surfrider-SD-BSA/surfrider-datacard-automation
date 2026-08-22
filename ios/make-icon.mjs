/**
 * Draw the app icon.
 *
 * Committed as a script rather than a checked-in binary so it can be changed
 * without a design tool, and so the thing in the repository is the reasoning
 * rather than 4MB of pixels. Xcode only needs the 1024 for a modern target.
 *
 * The mark is four tally strokes and a fifth struck through them, which is what
 * the tool is actually for and is legible at 40 pixels. Colours are the card
 * stock and the blue the page already uses.
 *
 * Usage: node ios/make-icon.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { PNG } from "pngjs";

const S = 1024;
const png = new PNG({ width: S, height: S });

const BG = [15, 23, 34];
const INK = [232, 238, 245];
const ACCENT = [96, 165, 250];

const put = (x, y, [r, g, b]) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) << 2;
  png.data[i] = r;
  png.data[i + 1] = g;
  png.data[i + 2] = b;
  png.data[i + 3] = 255;
};

for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) put(x, y, BG);

/** A stroke with rounded ends, drawn thick enough to survive downscaling. */
function stroke(x0, y0, x1, y1, width, colour) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  const r = width / 2;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) put(Math.round(cx + dx), Math.round(cy + dy), colour);
      }
    }
  }
}

// Four uprights and the fifth struck across them: one complete group of five.
const top = 330;
const bottom = 694;
const first = 250;
const gap = 138;
for (let i = 0; i < 4; i++) {
  const x = first + i * gap;
  // A little lean, because nobody rules these with a straightedge.
  stroke(x + 10, top, x - 10, bottom, 42, INK);
}
stroke(first - 60, bottom - 40, first + 3 * gap + 60, top + 40, 42, ACCENT);

mkdirSync("ios/SurfriderDataCards/Assets.xcassets/AppIcon.appiconset", { recursive: true });
writeFileSync("ios/SurfriderDataCards/Assets.xcassets/AppIcon.appiconset/icon-1024.png", PNG.sync.write(png));
console.log("wrote ios/SurfriderDataCards/Assets.xcassets/AppIcon.appiconset/icon-1024.png");
