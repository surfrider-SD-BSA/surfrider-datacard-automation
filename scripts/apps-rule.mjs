/**
 * What the apps would show and what they would take as read, scan by scan, and
 * how the boxes taken as read compare with the chapter's sheets.
 *
 * The apps show the least-sure `SHOW_SHARE` of each scan's boxes, "nothing
 * read" placeholders counted inside it (`autoAcceptedInScan` in prefill.ts),
 * not every box under `AUTO_ACCEPT`. reading-accuracy.mjs measures against the
 * fixed 0.45 line; this measures against the rule the apps actually use, which
 * is the one every change since 6 October 2026 has been judged by.
 *
 * Reads the cells `scripts/cell-cache.mjs` cut out, each scan with the CNN
 * trained without its event. As with every figure here, the sheet is not
 * ground truth: a disagreement is as often the sheet's (HANDOFF.md).
 *
 * Usage:
 *   CELL_CACHE=out/cells-app npx vite-node scripts/apps-rule.mjs
 *   ... -- --out after.json                     one row per offered box
 *   npx vite-node scripts/apps-rule.mjs -- --compare before.json after.json
 *   ... -- --jobs 4                             the scans split over 4 processes
 *
 * --compare needs no cache: it reads two --out files and lists every box that
 * left, arrived, or changed value, source, or shown/taken, with its sheet value.
 * FOLDS_DIR picks another set of trained folds (default out/models/cnn).
 * SECOND=file.json, {"scan:card:row": value}, gives the boxes the phone's own
 * text reader read, as iOS does (SECOND_DISAGREES_CONFIDENCE in prefill.ts).
 * OTHERS=file.json, {"scan:card:row": [value | null, ...]}, gives the open
 * readers' numbers, as iOS reads them (OTHER_READERS_DISAGREE in prefill.ts).
 * TUNED=file.json, {"scan:card:row": text}, gives the tuned reader's text where
 * iOS reads it, and fills those boxes as iOS does (tunedValue in prefill.ts).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args.slice(i + 1);
};

function summarise(rows) {
  const shown = rows.filter((r) => !r.taken);
  const taken = rows.filter((r) => r.taken && r.sheet !== null);
  return {
    offered: rows.length,
    shown: shown.length,
    "shown as nothing read": shown.filter((r) => r.source === "placeholder").length,
    "shown with a reading": shown.filter((r) => r.source !== "placeholder").length,
    "taken, equal to the sheet": taken.filter((r) => r.value === r.sheet).length,
    "taken, not equal to the sheet": taken.filter((r) => r.value !== r.sheet).length,
  };
}

const compare = flag("--compare");
if (compare) {
  const [a, b] = compare.map((p) => new Map(JSON.parse(readFileSync(p, "utf8")).map((r) => [r.key, r])));
  const said = (r) => `${r.value} ${r.source} ${r.taken ? "taken" : "shown"}`;
  const lines = [];
  for (const [k, r] of a) if (!b.has(k)) lines.push(`left     ${k}  ${said(r)}  sheet ${r.sheet}`);
  for (const [k, r] of b) {
    const o = a.get(k);
    if (!o) lines.push(`arrived  ${k}  ${said(r)}  sheet ${r.sheet}`);
    else if (said(o) !== said(r)) lines.push(`changed  ${k}  ${said(o)} -> ${said(r)}  sheet ${r.sheet}`);
  }
  console.log(lines.sort().join("\n"));
  console.log("\nbefore", summarise([...a.values()]));
  console.log("after ", summarise([...b.values()]));
  process.exit(0);
}

const { cachedScans, loadCells } = await import("./lib/cellcache.mjs");
const { cellsForSide } = await import("../src/lib/extract.ts");
const { decodeModel } = await import("../src/lib/digits.ts");
const { prefillFor, autoAcceptedInScan, tunedValue } = await import("../src/lib/prefill.ts");

const FOLDS = process.env.FOLDS_DIR ?? "out/models/cnn";
const modelFor = (scan) =>
  decodeModel(
    JSON.parse(readFileSync(existsSync(join(FOLDS, `${scan}.json`)) ? join(FOLDS, `${scan}.json`) : join(FOLDS, "_all.json"), "utf8")),
  );

// --jobs N: the same run split over N processes, a share of the scans each,
// merged in scan order. Every scan is scored on its own (the 20% is per
// scan), so the result is the same as one process gives, in a fraction of the time.
const jobs = flag("--jobs");
if (jobs && !process.env.SCANS) {
  const { spawn } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const scans = cachedScans();
  const n = Math.max(1, Math.min(scans.length, Number(jobs[0])));
  const groups = Array.from({ length: n }, (_, i) => scans.filter((_, k) => k % n === i));
  const parts = await Promise.all(
    groups.map(
      (group, i) =>
        new Promise((done, fail) => {
          const part = join(tmpdir(), `apps-rule-${process.pid}-${i}.json`);
          const child = spawn("npx", ["vite-node", "scripts/apps-rule.mjs", "--", "--out", part], {
            env: { ...process.env, SCANS: group.join(",") },
            stdio: ["ignore", "ignore", "inherit"],
          });
          child.on("exit", (code) => (code === 0 ? done(JSON.parse(readFileSync(part, "utf8"))) : fail(new Error(`job ${i} exited ${code}`))));
        }),
    ),
  );
  const byScan = new Map(parts.flat().map((r) => [r.key, r]));
  const merged = scans.flatMap((scan) => [...byScan.values()].filter((r) => r.scan === scan));
  const out = flag("--out");
  if (out) writeFileSync(out[0], JSON.stringify(merged));
  console.log(summarise(merged));
  process.exit(0);
}
const second = process.env.SECOND ? JSON.parse(readFileSync(process.env.SECOND, "utf8")) : {};
const others = process.env.OTHERS ? JSON.parse(readFileSync(process.env.OTHERS, "utf8")) : {};
const tuned = process.env.TUNED ? JSON.parse(readFileSync(process.env.TUNED, "utf8")) : {};
const only = process.env.SCANS ? new Set(process.env.SCANS.split(",")) : null;

const rows = [];
for (const scan of cachedScans()) {
  if (only && !only.has(scan)) continue;
  const model = modelFor(scan);
  const { records, page, map } = loadCells(scan);
  const cells = [];
  for (const r of records) {
    const [c] = cellsForSide(page(r), r.pageNumber, map(r), r.side, model);
    if (c) cells.push({ r, c, p: prefillFor(c) });
  }
  const taken = autoAcceptedInScan(
    cells.map((x) => x.p),
    cells.map((x) => (x.p?.source === "digits" ? second[x.r.key] : undefined)),
    cells.map((x) => x.r.row),
    cells.map((x) => (x.p?.source === "digits" ? others[x.r.key] : undefined)),
  );
  cells.forEach(({ r, c, p }, i) =>
    rows.push({
      scan,
      key: r.key,
      value: tunedValue(p, tuned[r.key], others[r.key], second[r.key]),
      confidence: +p.confidence.toFixed(3),
      source: p.source,
      taken: taken[i],
      sheet: r.typed ?? null,
      tallyOnly: c.tallyOnly,
    }),
  );
}

const out = flag("--out");
if (out) writeFileSync(out[0], JSON.stringify(rows));
console.log(summarise(rows));
