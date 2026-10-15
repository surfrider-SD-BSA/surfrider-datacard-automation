/**
 * One page of a scan, lined up with the blank card and read, off the main thread.
 *
 * The engine decodes the PDF page by page and hands each page to one of a few
 * of these (`readPagesInParallel` in engine.ts). Lining a page up and reading
 * its boxes is most of the time a scan takes -- about seven tenths reading,
 * two tenths registration, one tenth decoding, measured on 3.15 Imperial --
 * and each page is read on its own, so a phone's spare cores read the next
 * pages while the first is still going. Same functions, same answers: only
 * where they run changes.
 */
import type { CellMap } from "./cells";
import type { DigitModel } from "./digits";
import { cellsForSide } from "./extract";
import type { GrayImage } from "./image";
import { referenceTargets, registerAgainstBestSide } from "./register";

type Init = {
  type: "init";
  images: { front: GrayImage; back: GrayImage };
  maps: { front: CellMap; back: CellMap };
  digits: DigitModel | null;
};
type Page = { type: "page"; pageNumber: number; image: GrayImage };

let refs: { targets: ReturnType<typeof referenceTargets>; maps: Init["maps"]; digits: DigitModel | null } | null = null;

self.onmessage = (e: MessageEvent<Init | Page>) => {
  const msg = e.data;
  if (msg.type === "init") {
    refs = { targets: referenceTargets(msg.images, msg.maps), maps: msg.maps, digits: msg.digits };
    self.postMessage({ type: "ready" });
    return;
  }
  try {
    if (!refs) throw new Error("read worker used before init");
    const registered = registerAgainstBestSide(msg.image, refs.targets, msg.pageNumber);
    self.postMessage({
      type: "page",
      pageNumber: msg.pageNumber,
      page: {
        pageNumber: msg.pageNumber,
        side: registered.side,
        trusted: registered.trusted,
        bannerOverlap: registered.bannerOverlap,
        cells: registered.trusted
          ? cellsForSide(registered.image, msg.pageNumber, refs.maps[registered.side], registered.side, refs.digits)
          : [],
      },
    });
  } catch (err) {
    self.postMessage({ type: "error", pageNumber: msg.pageNumber, message: String((err as Error)?.message ?? err) });
  }
};
