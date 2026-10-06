/**
 * A scan's pages as the apps see them.
 *
 * The apps render a page with pdf.js and, for a scanned page, take the scanner's
 * own pixels (`scannedPage` in src/lib/scanpage.ts). This does the same in Node,
 * straight from the PDF in scans/, so that what the offline tools measure is what
 * a volunteer's phone reads.
 *
 * Until 30 September 2026 every offline figure was measured on out/pages
 * instead: PDFKit renders, resampled to 200 DPI and saved as JPEG, which no app
 * has ever read. On those pages 234 fewer boxes holding a typed number were found
 * across the 28 scans, and delmar-6.20's first page lay on its side (HANDOFF.md,
 * "The two apps read the same pixels"). `PAGES=pdfkit` reads them again, to
 * compare with figures measured that way.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { scannedPage } from "../../src/lib/scanpage.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCALE = 200 / 72;

export const PAGES = process.env.PAGES === "pdfkit" ? "pdfkit" : "app";

const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The PDF in scans/ for a scan named as in out/pages ("seaport-6.13"), by beach
 * and date as the chapter names its files ("6.13.25_Seaport-Village_CH54.pdf").
 */
export function scanPdf(name) {
  const dir = join(ROOT, "scans");
  if (existsSync(join(dir, `${name}.pdf`))) return join(dir, `${name}.pdf`);
  const [place, date] = name.split("-");
  const [m, d] = (date ?? "").split(".").map(Number);
  const hit = readdirSync(dir).find(
    (f) => f.toLowerCase().endsWith(".pdf") && key(f).includes(key(place)) && key(f).startsWith(`${m}${d}25`),
  );
  if (!hit) throw new Error(`no PDF in scans/ for ${name}`);
  return join(dir, hit);
}

const luma = (rgba, n) => {
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  return out;
};

/**
 * Every page of the scan, in order, as `{ pageNumber, image }` with a grey
 * image. One at a time: a 150-page scan does not fit in memory as a list.
 */
export async function* scanPages(name) {
  if (PAGES === "pdfkit") {
    const dir = join(ROOT, "out", "pages", name);
    const files = readdirSync(dir)
      .filter((f) => /\.jpe?g$/i.test(f))
      .sort((a, b) => (parseInt(a.replace(/\D/g, ""), 10) || 0) - (parseInt(b.replace(/\D/g, ""), 10) || 0));
    for (let i = 0; i < files.length; i++) {
      const { width, height, data } = jpeg.decode(readFileSync(join(dir, files[i])), {
        useTArray: true,
        formatAsRGBA: true,
      });
      yield { pageNumber: i + 1, image: { width, height, data: luma(data, width * height) } };
    }
    return;
  }

  // The options src/lib/pdf.ts opens a scan with, so pdf.js decodes the same way.
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(scanPdf(name))),
    verbosity: 0,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
  }).promise;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const image = await scannedPage(page, page.getViewport({ scale: SCALE }), pdfjs);
      page.cleanup();
      // The apps would draw such a page on a canvas, which Node does not have.
      if (!image) throw new Error(`${name} page ${n} is not a single scanned image`);
      yield { pageNumber: n, image };
    }
  } finally {
    await doc.destroy();
  }
}
