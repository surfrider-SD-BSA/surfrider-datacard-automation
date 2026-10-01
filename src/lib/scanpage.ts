/**
 * A scanned page as the pixels the scanner wrote, with no browser in between.
 *
 * WHY THIS EXISTS. The iOS and Android apps read the same PDF with the same code
 * and did not cut the same cells from it: 48 on one and 50 on the other for a
 * 10-page scan, 349 against 346 for a 52-page one, and so a different list of
 * boxes to check. Drawing a page through a canvas leaves two things to the web
 * engine. pdf.js hands JPEG decoding to the browser's own decoder wherever the
 * engine offers one (WebCodecs `ImageDecoder`), and the canvas then scales the
 * image to 200 DPI with its own filter, which it always has to: a scan's pixels
 * are never exactly the page's size at 200 DPI (1699 against 1697 across). Either
 * is enough to put the two apps' pixels a little apart, and a box near a
 * threshold then falls the other way. With both taken out of the engines' hands,
 * the two apps offer the same boxes from the same scan (HANDOFF.md, "The two apps
 * read the same pixels").
 *
 * Every page of every chapter scan is one JPEG at about 200 DPI, laid over the
 * whole page. So for such a page the image is not drawn at all: pdf.js decodes it
 * in its own JavaScript (`isImageDecoderSupported: false` in pdf.ts), the pixels
 * are taken as they are, turned the way the page shows them, and converted to
 * grey here. The same arithmetic on every engine, so the same page everywhere --
 * in each app, in a desktop browser, and in Node.
 *
 * Anything else -- an image at some other resolution, a page with text or
 * drawing on it, a bitmap mask -- returns null, and pdf.ts draws it on a canvas
 * as before.
 */

import type { GrayImage } from "./image";

/** The parts of pdf.js this needs, passed in so Node can hand over its own build. */
export interface PdfLib {
  OPS: Record<string, number>;
  Util: {
    transform(m1: number[], m2: number[]): number[];
    applyTransform(p: number[], m: number[]): number[];
  };
}

/** The parts of a pdf.js page this needs. */
export interface ScanSource {
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get(objId: string, callback: (data: unknown) => void): unknown };
  /** Where pdf.js keeps an image used on more than one page: ids that start "g_". */
  commonObjs: { get(objId: string, callback: (data: unknown) => void): unknown };
}

/** A decoded image as pdf.js's worker sends it when it is not allowed to make bitmaps. */
interface DecodedImage {
  width: number;
  height: number;
  /** pdf.js `ImageKind`: 1 is one bit grey, 2 is RGB, 3 is RGBA. */
  kind: number;
  data: Uint8ClampedArray | null;
}

const RGB_24BPP = 2;
const RGBA_32BPP = 3;

/**
 * How far a scan's resolution may be from 200 DPI and still be taken pixel for
 * pixel. The chapter's scans sit within 0.4%; registration corrects the rest, as
 * it already corrects every scan's slightly different page size.
 */
const NATIVE_TOLERANCE = 0.03;

/**
 * The page as a grey image, if it is one scanned image laid over the whole page.
 *
 * `viewport` is the 200 DPI viewport pdf.ts would draw with; it decides which way
 * up the result is, including a page's own /Rotate.
 */
export async function scannedPage(
  page: ScanSource,
  viewport: { width: number; height: number; transform: number[] },
  lib: PdfLib,
): Promise<GrayImage | null> {
  const { OPS, Util } = lib;
  const ops = await page.getOperatorList();

  // One image, and nothing drawn but it. Clipping and state changes paint
  // nothing; anything that does, and the page goes to the canvas.
  const quiet = new Set([
    OPS.dependency,
    OPS.setRenderingIntent,
    OPS.constructPath,
    OPS.clip,
    OPS.eoClip,
    OPS.endPath,
  ]);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let image: { objId: string; ctm: number[] } | null = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]!;
    const args = ops.argsArray[i]!;
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args as number[]);
    else if (fn === OPS.paintImageXObject && !image) image = { objId: args[0] as string, ctm };
    else if (!quiet.has(fn)) return null;
  }
  if (!image) return null;

  // Where the image's corners land on the page at 200 DPI. pdf.js puts the
  // image's first row at the top of its unit square, y = 1.
  const m = Util.transform(viewport.transform, image.ctm);
  const [tlx, tly] = Util.applyTransform([0, 1], m) as [number, number];
  const [trx, try_] = Util.applyTransform([1, 1], m) as [number, number];
  const [blx, bly] = Util.applyTransform([0, 0], m) as [number, number];
  const across = { x: trx - tlx, y: try_ - tly };
  const down = { x: blx - tlx, y: bly - tly };

  // Square to the page, one way or the other.
  const flat = (v: { x: number; y: number }) => Math.min(Math.abs(v.x), Math.abs(v.y)) < 0.5;
  if (!flat(across) || !flat(down)) return null;
  const turned = Math.abs(across.x) < Math.abs(across.y);

  const { objId } = image;
  const store = objId.startsWith("g_") ? page.commonObjs : page.objs;
  const decoded = await new Promise<unknown>((resolve) => store.get(objId, resolve));
  const img = decoded as DecodedImage | null;
  if (!img || !img.data || (img.kind !== RGB_24BPP && img.kind !== RGBA_32BPP)) return null;
  const { width: w, height: h } = img;

  // At the scan's own resolution, and covering the page.
  const near = (a: number, b: number) => Math.abs(a / b - 1) <= NATIVE_TOLERANCE;
  const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
  if (!near(len(across), w) || !near(len(down), h)) return null;
  const outW = turned ? h : w;
  const outH = turned ? w : h;
  if (!near(outW, viewport.width) || !near(outH, viewport.height)) return null;

  // Grey exactly as image.ts's toGray computes it from a canvas, with any
  // transparency laid over white as the canvas's white backdrop would.
  const step = img.kind === RGBA_32BPP ? 4 : 3;
  const src = img.data;
  const out = new Uint8Array(outW * outH);
  const right = turned ? across.y > 0 : across.x > 0;
  const downward = turned ? down.x > 0 : down.y > 0;
  for (let j = 0; j < h; j++) {
    const jj = downward ? j : h - 1 - j;
    for (let i = 0; i < w; i++) {
      const p = (j * w + i) * step;
      let r = src[p]!;
      let g = src[p + 1]!;
      let b = src[p + 2]!;
      if (step === 4) {
        const a = src[p + 3]!;
        r = (r * a + 255 * (255 - a)) / 255;
        g = (g * a + 255 * (255 - a)) / 255;
        b = (b * a + 255 * (255 - a)) / 255;
      }
      const ii = right ? i : w - 1 - i;
      // Unturned, the image's columns run across the page; turned, down it.
      const x = turned ? jj : ii;
      const y = turned ? ii : jj;
      out[y * outW + x] = (r * 299 + g * 587 + b * 114) / 1000;
    }
  }
  return { width: outW, height: outH, data: out };
}
