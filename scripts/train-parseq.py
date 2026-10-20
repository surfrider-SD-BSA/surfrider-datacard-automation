"""Fine-tune docTR's PARSeq on the chapter's own TOTAL boxes.

The phone's vote uses PARSeq as one of its five fast readers (OtherReaders.swift).
Fine-tuned on our boxes it reads better than our own digit reader on almost every
box: held out by halves of the scans (`--half 0` / `--half 1` train on the other
half and read this one), right on 68.8% where ours is on 67.2%, total off 19,029
against ours 41,036. In the vote, with the tuned TrOCR's fill-in, total off on the
boxes taken unseen went 6,431 -> 6,200 (OTHER_READERS_DISAGREE in prefill.ts).

Pictures and labels come from scripts/box-crops.mjs, each prepared exactly as the
phone prepares it for docTR (OtherReaders.swift, `Pixels.doctr`): fitted into
32 x 128 keeping its shape, zeros right and below, docTR's mean and std. Training
adds a small random crop and contrast change. CPU only: about an hour.

    CELL_CACHE=out/cells-app npx vite-node scripts/box-crops.mjs
    python scripts/train-parseq.py              -> out/models/parseq-ours.pt
    python scripts/export-readers.py            exports PARSeq with these weights
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import time

import numpy as np
import torch
from doctr.models import parseq
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOXES = ROOT / "out" / "boxes"
MEAN = np.array([0.694, 0.695, 0.693], np.float32)
STD = np.array([0.299, 0.296, 0.301], np.float32)


def bilinear(a: np.ndarray, oh: int, ow: int) -> np.ndarray:
    """Half-pixel-centre bilinear resize, no antialiasing (as on the phone)."""
    h, w = a.shape[:2]
    ys = np.clip((np.arange(oh) + 0.5) * h / oh - 0.5, 0, h - 1)
    xs = np.clip((np.arange(ow) + 0.5) * w / ow - 0.5, 0, w - 1)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, h - 1), np.minimum(x0 + 1, w - 1)
    fy, fx = (ys - y0)[:, None, None], (xs - x0)[None, :, None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bottom = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return top * (1 - fy) + bottom * fy


def picture(file: str, augment: bool) -> torch.Tensor:
    a = np.asarray(Image.open(BOXES / "png" / file).convert("RGB"), np.float32) / 255
    if augment:
        h, w = a.shape[:2]

        def cut(n: int) -> int:
            return random.randint(0, max(1, n // 12))

        a = a[cut(h) : h - cut(h), cut(w) : w - cut(w)]
        a = (a - 0.5) * random.uniform(0.8, 1.3) + 0.5 + random.uniform(-0.08, 0.08)
        a = np.clip(a, 0, 1)
    h, w = a.shape[:2]
    s = min(32 / h, 128 / w)
    oh, ow = max(1, round(h * s)), max(1, round(w * s))
    out = np.zeros((32, 128, 3), np.float32)
    out[:oh, :ow] = bilinear(a, oh, ow)
    return torch.tensor(((out - MEAN) / STD).transpose(2, 0, 1).copy())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--half", type=int, default=-1, help="hold out this half of the scans")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    torch.manual_seed(0)
    random.seed(0)
    torch.set_num_threads(args.threads)

    index = json.loads((BOXES / "index.json").read_text())
    scans = sorted({e["key"].split(":")[0] for e in index})

    def side(e: dict) -> int:
        return scans.index(e["key"].split(":")[0]) % 2

    train = [e for e in index if args.half < 0 or side(e) != args.half]
    test = [e for e in index if side(e) == args.half]

    model = parseq(pretrained=True)
    batch, lr = 32, 5e-4
    steps = args.epochs * (len(train) // batch)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.1)
    print(f"training on {len(train)} boxes, {steps} steps", flush=True)
    began = time.time()
    for epoch in range(args.epochs):
        model.train()
        random.shuffle(train)
        total = 0.0
        for i in range(0, len(train) - batch + 1, batch):
            chunk = train[i : i + batch]
            px = torch.stack([picture(e["file"], True) for e in chunk])
            loss = model(px, target=[str(e["sheet"]) for e in chunk])["loss"]
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item()
        print(
            f"epoch {epoch + 1}: loss {total / (len(train) // batch):.3f}, "
            f"{time.time() - began:.0f} s",
            flush=True,
        )

    name = "parseq-ours.pt" if args.half < 0 else f"parseq-ours-h{args.half}.pt"
    out = ROOT / "out" / "models" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out)
    if test:
        model.eval()
        right = 0
        with torch.no_grad():
            for i in range(0, len(test), 64):
                chunk = test[i : i + 64]
                px = torch.stack([picture(e["file"], False) for e in chunk])
                preds = model(px, return_preds=True)["preds"]
                right += sum(1 for e, (text, _) in zip(chunk, preds) if text == str(e["sheet"]))
        print(f"held-out half {args.half}: {right} of {len(test)} exactly right")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
