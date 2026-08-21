/**
 * Rasterize a scanned PDF into grayscale page images, in the browser.
 *
 * The file is read from a local File object and never leaves the machine.
 */

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { toGray, type GrayImage } from "./image";

/**
 * Hand pdf.js a worker we constructed, rather than a URL for it to construct
 * one from.
 *
 * This looks like a stylistic choice and is not. pdf.js builds its worker from
 * `workerSrc` with `new Worker(url)` -- a CLASSIC worker -- while the file it is
 * given is an ES module. In a classic worker the first `export` in that file is
 * a syntax error, the worker dies before it says anything, and the app sits on
 * "Reading the PDF…" for ever. It fails only in the BUILT bundle, which is why
 * it survived: `npm run dev` resolves the same import to something a classic
 * worker can run.
 *
 * The worker is constructed here, by hand, with `type: "module"` written out.
 * Vite's `?worker` import is the tidier-looking way to do it and does not work:
 * it emitted `new Worker(url)` with no options for this dependency even with
 * `worker: { format: "es" }` set in the config, which is the same classic worker
 * and the same syntax error. `workerPort` is the pdf.js entry point that takes
 * an instance rather than a URL, so the one place the type is decided is here.
 *
 * Verified by loading the BUILT bundle and reading a real card through it. The
 * failure is invisible to every test in this repository, because they all run
 * the source rather than the bundle.
 */
pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: "module" });

/**
 * Render at the resolution the reference was measured at.
 *
 * The chapter's ScanSnap produces 200 DPI, and the cell map's coordinates are
 * in that space. pdf.js scale 1 is 72 DPI, so 200/72 reproduces it.
 */
export const REFERENCE_DPI = 200;
const SCALE = REFERENCE_DPI / 72;

export interface RasterPage {
  /** 1-based page number in the source PDF. */
  pageNumber: number;
  image: GrayImage;
  /** Pages in the document, known from the first page onward. */
  total: number;
}

/**
 * Rasterize a PDF, handing each page to `onPage` as it is rendered.
 *
 * A callback rather than an array of pages, which is what this returned until a
 * 116-page scan was measured at 840MB of browser heap. A letter page at 200 DPI
 * is 3.7MB of grayscale; accumulating them held 430MB before a single cell had
 * been cropped, and the caller then held the registered copies as well. Handing
 * each page over and forgetting it lets the caller keep only what it needs.
 *
 * `onPage` may be async; the page is not released until it resolves.
 */
export async function rasterizePdf(
  file: File,
  onPage: (page: RasterPage) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<number> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal?.aborted) throw new DOMException("cancelled", "AbortError");

      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      // White background: scans are opaque, but a PDF page need not be, and a
      // transparent backdrop would read as black ink.
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const image = toGray(rgba, canvas.width, canvas.height);
      page.cleanup();

      await onPage({ pageNumber: n, image, total: doc.numPages });

      // Yield so the progress bar can paint.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    // Release the last canvas backing store rather than leaving a full page of
    // pixels attached to a detached element.
    canvas.width = 0;
    canvas.height = 0;
    await doc.destroy();
  }

  return doc.numPages;
}

/**
 * The same thing for a photograph, or any image the browser can decode.
 *
 * A phone is the obvious way to get a card into this tool when there is no
 * flatbed scanner, and a native app wrapping this page has nothing else to hand
 * it. The pipeline downstream does not care where the pixels came from: it
 * wants a `GrayImage` at roughly `REFERENCE_DPI`, and `registerAgainstBestSide`
 * finds the card within it.
 *
 * **A photograph is not a scan, and this does not pretend otherwise.** Every
 * figure in HANDOFF.md was measured on flatbed scans, which are square to the
 * page, evenly lit and at a known DPI. A phone held over a card is none of
 * those, and registration is the step that will feel it first: it corrects
 * rotation and scale, not the keystoning you get from holding a camera at an
 * angle. Expect a photo taken square, flat and in even light to work, and
 * expect one taken at 30 degrees not to. Nothing here has been measured on
 * real photographs yet, so treat the first ones as an experiment.
 *
 * Rescaled so the long edge matches what a letter page at REFERENCE_DPI would
 * be, because the registration searches a scale window rather than any scale.
 */
export async function rasterizeImage(
  file: File,
  onPage: (page: RasterPage) => void | Promise<void>,
): Promise<number> {
  const bitmap = await createImageBitmap(await file.arrayBuffer().then((b) => new Blob([b])));

  // A US Letter page at REFERENCE_DPI, long edge. Photographs arrive at
  // whatever the phone's sensor is, which is usually much larger.
  const longEdge = 11 * REFERENCE_DPI;
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, width, height);
  await onPage({ pageNumber: 1, image: toGray(data, width, height), total: 1 });
  return 1;
}
