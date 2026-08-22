/**
 * Where should `rowEscape` sit, and does it still separate anything?
 *
 * `tally.ts` refuses a reading when a stroke's ink carries on ABOVE the row it
 * was found in -- a diagonal crossing the card, or the descender of a word
 * written in the row above. The bar it refuses at is not a judgement call: it
 * comes from this sweep, over every cell in the pre-fill audit, against counts
 * read by eye.
 *
 * IT IS TUNED ON 46 CELLS AND THE MARGIN IS ABOUT ONE OF THEM. That is why this
 * script exists rather than a note saying what the number was: the moment more
 * strips have been counted by eye, the bar should be re-derived and not
 * inherited. Run it, read the two columns, and move `rowEscape` to sit between
 * them with as much room on each side as the labels allow.
 *
 * Two things it also guards, both of which were wrong when the test was first
 * written and neither of which is obvious from the code:
 *
 *   - The ink must be TRACED, not extrapolated along the segment's angle. That
 *     angle is fitted to the straightest part of a mark and handwriting curves.
 *   - TOTAL overrun does not separate the populations at any tolerance -- marks
 *     from another row reach 0.60 of the strip's height and so do cells the
 *     counter reads correctly. Only the direction does, because a volunteer
 *     writes downward. `--both` prints the down column too, which is what makes
 *     that visible rather than asserted.
 *
 * Usage:
 *   npx vite-node scripts/sweep-row-escape.mjs -- [--both] [--slack N] [--gap N]
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { inkMask, insetRows } from "../src/lib/marks.ts";
import { TALLY_DEFAULTS, _debugSegments, _rowOverrun, countTally } from "../src/lib/tally.ts";
import { scan } from "./diagnose-review.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Where the counted band sits inside the context.
 *
 * Mirrors `prepare` in tally.ts, and has to: three coordinate systems meet
 * here, both insets decline to trim when what would be left is too small, and
 * getting it wrong is silent -- the trace simply walks up an empty column and
 * reports that nothing carries on.
 */
function frameFor(img, whole, o) {
  const band = insetRows(img, o.rowInset);
  const margin = Math.round((whole.height - img.height) / 2);
  return {
    left: o.insetLeft,
    top: margin + Math.round((img.height - band.height) / 2),
    stripTop: margin,
    stripBottom: margin + img.height,
  };
}

function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => (args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d);
  const both = args.includes("--both");
  const o = {
    ...TALLY_DEFAULTS,
    escapeSlack: opt("--slack", TALLY_DEFAULTS.escapeSlack),
    escapeGap: opt("--gap", TALLY_DEFAULTS.escapeGap),
  };

  const labels = join(ROOT, "eye-labels", "prefill-audit.json");
  if (!existsSync(labels)) {
    console.error(
      `no ${labels}\n` +
        "This sweep is scored against counts read by eye, not against the\n" +
        "spreadsheets -- a value in a sheet is not proof of what is on the card.\n" +
        "Produce the labels with scripts/audit-prefills.mjs and read the tiles.",
    );
    process.exit(1);
  }
  const truth = JSON.parse(readFileSync(labels, "utf8")).counts ?? {};

  const rows = [];
  for (const name of [...new Set(Object.keys(truth).map((k) => k.split(":")[0]))].sort()) {
    const dir = join(ROOT, "out", "pages", name);
    if (!existsSync(dir)) continue;
    const s = scan(dir);
    for (const c of s.cells) {
      const key = `${name}:${c.card}:${c.row}`;
      if (!(key in truth)) continue;

      const img = { width: c.tally.width, height: c.tally.height, data: c.tally.gray };
      const ctx = { width: c.tallyCtx.width, height: c.tallyCtx.height, data: c.tallyCtx.gray };
      const whole = inkMask(ctx, { wallFrac: 2, ruleFrac: 2 });
      const frame = frameFor(img, whole, o);

      const uprights = _debugSegments(img, { context: ctx }).segments.filter(
        (g) => Math.abs(Math.abs(g.angle) - 90) <= o.uprightDegrees,
      );
      if (!uprights.length) continue;

      const reach = (f) => Math.max(...uprights.map((g) => _rowOverrun(g, whole, f, o))) / img.height;
      // Scored with the test OFF, so "right" means right for reasons that have
      // nothing to do with the bar being swept.
      const said = countTally(img, { context: ctx, rowEscape: 9 }).count;
      rows.push({
        key,
        said,
        is: truth[key],
        up: reach(frame),
        down: both ? reach({ ...frame, stripTop: -1e9 }) : null,
      });
    }
  }

  const right = rows.filter((r) => r.said !== null && r.said === r.is);
  const wrong = rows.filter((r) => r.said !== null && r.said !== r.is);

  console.log(`\ntrace slack ${o.escapeSlack}, gap ${o.escapeGap}; ${rows.length} audited cells\n`);
  rows.sort((a, b) => b.up - a.up);
  console.log(`  ${"up".padStart(5)}${both ? "  down" : ""}  cell                        read`);
  for (const r of rows) {
    const verdict = r.said === null ? "declined" : r.said === r.is ? "right" : `WRONG (said ${r.said}, is ${r.is})`;
    console.log(
      `  ${r.up.toFixed(2).padStart(5)}${both ? "  " + r.down.toFixed(2) : ""}  ${r.key.padEnd(26)}  ${verdict}`,
    );
  }

  // Deliberately NOT "the lowest among the cells read wrong". Most wrong
  // readings are wrong for reasons this test cannot reach -- a digit inside a
  // drawn circle, a stroke never found -- and their overrun is zero, so that
  // figure reads as "no bar can work" when the truth is that no bar should.
  // What the bar has to clear is the correct cells; what it has to catch is
  // whatever the table below says it catches.
  console.log(
    `\n  highest overrun among cells read RIGHT   ${Math.max(...right.map((r) => r.up)).toFixed(2)}` +
      `  (the bar costs coverage above this)` +
      `\n  cells read wrong                         ${wrong.length}` +
      `\n  rowEscape is currently ${TALLY_DEFAULTS.rowEscape}`,
  );

  // What each candidate bar would actually cost and buy, which is the number to
  // decide on -- the gap between the two columns above says nothing about how
  // many cells sit near it.
  console.log("\n  bar   cells kept   right   wrong   precision");
  for (const bar of [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 9]) {
    const kept = rows.filter((r) => r.said !== null && r.up < bar);
    const ok = kept.filter((r) => r.said === r.is).length;
    console.log(
      `  ${String(bar === 9 ? "off" : bar).padEnd(5)} ${String(kept.length).padStart(10)}` +
        `${String(ok).padStart(8)}${String(kept.length - ok).padStart(8)}` +
        `${(kept.length ? ((ok / kept.length) * 100).toFixed(1) + "%" : "-").padStart(12)}`,
    );
  }
}

main();
