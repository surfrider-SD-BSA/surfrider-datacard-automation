import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { scannedPage, type PdfLib } from "../src/lib/scanpage";

const SCALE = 200 / 72;

/** Every pixel different, so a page turned or mirrored the wrong way cannot pass. */
const rgb = (i: number, j: number): [number, number, number] => [
  (i * 7 + 3) % 256,
  (j * 5 + 11) % 256,
  (i * 3 + j * 2) % 256,
];
const grey = ([r, g, b]: [number, number, number]) => Math.trunc((r * 299 + g * 587 + b * 114) / 1000);

/**
 * A one-page PDF holding a raw RGB image -- no compression, so the pixels pdf.js
 * hands back are exactly these -- drawn over `width` x `height` pixels of a page
 * at 200 DPI. `extra` is more page content after the image.
 */
function pdf(w: number, h: number, opts: { rotate?: number; dpi?: number; extra?: string } = {}) {
  const dpi = opts.dpi ?? 200;
  const pw = (w * 72) / dpi;
  const ph = (h * 72) / dpi;
  const pixels = new Uint8Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pixels.set(rgb(i, j), (j * w + i) * 3);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q\n${opts.extra ?? ""}`;

  const parts: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (p: string | Uint8Array) => {
    parts.push(p);
    length += typeof p === "string" ? p.length : p.byteLength;
  };
  const obj = (n: number, body: (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Rotate ${opts.rotate ?? 0} ` +
      "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  ]);
  obj(4, [
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Length ${pixels.byteLength} >>\nstream\n`,
    pixels,
    "\nendstream",
  ]);
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    const bytes = typeof p === "string" ? new TextEncoder().encode(p) : p;
    out.set(bytes, at);
    at += bytes.byteLength;
  }
  return out;
}

async function read(data: Uint8Array) {
  const doc = await pdfjs.getDocument({
    data,
    verbosity: 0,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
  }).promise;
  const page = await doc.getPage(1);
  const image = await scannedPage(page, page.getViewport({ scale: SCALE }), pdfjs as unknown as PdfLib);
  await doc.destroy();
  return image;
}

describe("scannedPage", () => {
  const w = 36;
  const h = 54;

  it("takes a full-page scan pixel for pixel, the right way up", async () => {
    const image = await read(pdf(w, h));
    expect(image).not.toBeNull();
    expect([image!.width, image!.height]).toEqual([w, h]);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) expect(image!.data[j * w + i]).toBe(grey(rgb(i, j)));
    }
  });

  it("turns a page the PDF says to show rotated, clockwise as the format says", async () => {
    const image = await read(pdf(w, h, { rotate: 90 }));
    expect(image).not.toBeNull();
    expect([image!.width, image!.height]).toEqual([h, w]);
    // The image's top row becomes the right-hand column, its left column the top row.
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) expect(image!.data[i * h + (h - 1 - j)]).toBe(grey(rgb(i, j)));
    }
  });

  it("leaves a page with anything drawn besides the scan to the canvas", async () => {
    expect(await read(pdf(w, h, { extra: "0 0 5 5 re f" }))).toBeNull();
  });

  it("leaves a scan far from 200 DPI to the canvas, which scales it", async () => {
    expect(await read(pdf(w, h, { dpi: 72 }))).toBeNull();
  });
});
