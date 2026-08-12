/**
 * Rasterize a scanned PDF into grayscale page images, in the browser.
 *
 * The file is read from a local File object and never leaves the machine.
 */

import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { toGray, type GrayImage } from "./image";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

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
