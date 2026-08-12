/**
 * Refuse to ship a build that contains volunteer data.
 *
 * This exists because the build once did. `vite.config.ts` sets
 * publicDir: "assets" so the reference card and the chapter's template are
 * served at runtime, and Vite copies that entire tree into dist/ verbatim.
 * Scans were being kept in `assets/pairs/` -- gitignored, so safe from the
 * repository, and copied straight into dist/ regardless. A build carried 332MB
 * of scanned handwriting and completed datasheets, ready to be published to
 * GitHub Pages by a tool whose first promise is that the scan never leaves the
 * laptop.
 *
 * The scans now live in `/scans/`, outside publicDir, which fixes it. This
 * check is here so it cannot come back: it is easy to drop a folder under
 * assets/ without knowing that publishes it, and this is an open-source tool,
 * so the next person to do it will not be someone who can be warned.
 *
 * Allowlist by exact path, not by file extension. The first version of this
 * check allowed any .png, on the reasoning that the blank reference card is a
 * PNG -- and it passed `sample-card-front.png`, a photographed card from
 * Moonlight Beach covered in a volunteer's handwriting. A file type tells you
 * nothing about whether the contents are somebody's data. Only the exact list
 * below may ship, so a file nobody anticipated fails the build instead of
 * being published.
 *
 * Usage: node scripts/check-dist.mjs [dist-dir]
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.argv[2] ?? join(ROOT, "dist");

/**
 * Vite's own output: `index.html` plus hashed bundles under `assets/`. These
 * are compiled from source, so they carry no data of their own.
 */
const BUILD_OUTPUT = /^(index\.html|assets\/[^/]+\.(js|mjs|css|map))$/;

/**
 * Everything else the published site may contain, by exact path.
 *
 * The first four are fetched at runtime -- see `loadReferenceImage` and
 * `loadCellMap` in the app, and the exporter's template. The rest are
 * development artifacts that happen to live under `assets/` and are harmless
 * (all derived from the composited BLANK card, so no handwriting): the debug
 * overlays the calibration doc tells you to eyeball, and the by-eye ground
 * truth, which is debris counts with no names or personal detail in it.
 *
 * Adding to this list should be a deliberate act. If a build fails here, the
 * question to ask is "should the public internet have this?", not "how do I
 * make the check pass?".
 */
const ALLOWED_FILES = new Set([
  "reference/blank-front.png",
  "reference/blank-back.png",
  "reference/cells.front.json",
  "reference/cells.back.json",
  "template/data-entry-template.xlsx",

  "reference/cells-overrides.json",
  "reference/debug-grid-front.png",
  "reference/debug-grid-back.png",
  "reference/lines-front.png",
  "reference/lines-back.png",
  "reference/labels-pacific-beach.json",
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = walk(dist);
} catch {
  console.error(`check-dist: no build at ${dist} -- run \`npm run build\` first.`);
  process.exit(1);
}

const offenders = files
  .map((f) => relative(dist, f).split(sep).join("/"))
  .filter((rel) => !ALLOWED_FILES.has(rel) && !BUILD_OUTPUT.test(rel));

if (offenders.length > 0) {
  console.error(
    `\ncheck-dist: REFUSING this build -- ${offenders.length} file(s) that must not be published:\n`,
  );
  for (const f of offenders.slice(0, 15)) console.error(`    dist/${f}`);
  if (offenders.length > 15) console.error(`    ...and ${offenders.length - 15} more`);
  console.error(
    `\nAnything under assets/ is copied into the build by vite.config.ts's\n` +
      `publicDir setting, whether or not git ignores it. Scanned cards and\n` +
      `completed datasheets belong in /scans/, which is outside that tree.\n` +
      `Move them there and rebuild.\n`,
  );
  process.exit(1);
}

console.log(`check-dist: ${files.length} files, nothing that should not be published.`);
