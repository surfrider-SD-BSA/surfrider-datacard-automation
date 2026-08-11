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
}

export interface RasterProgress {
  done: number;
  total: number;
}

export async function rasterizePdf(
  file: File,
  onProgress?: (p: RasterProgress) => void,
  signal?: AbortSignal,
): Promise<RasterPage[]> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pages: RasterPage[] = [];
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

      pages.push({
        pageNumber: n,
        image: toGray(rgba, canvas.width, canvas.height),
      });
      page.cleanup();

      onProgress?.({ done: n, total: doc.numPages });

      // Yield so the progress bar can paint.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    await doc.destroy();
  }

  return pages;
}
