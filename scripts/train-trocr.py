"""Fine-tune TrOCR-base on the chapter's own TOTAL boxes: our tuned reader.

The phone runs it on every written box (`OtherReaders.readMain`); where it reads
another number than our digit reader, its number goes in (`mainReading` in
src/lib/prefill.ts). It is TrOCR-base since 21 October 2026 (TrOCR-small
before): held out by halves of the scans (`--half 0` / `--half 1` train on the
other half and read this one), exactly right on 1,281 of 1,772 and 2,080 of
2,677 boxes against small's 1,259 and 1,846, and over every box the app takes
or misses (out/exp/fake/complete.mjs) total off 9,166 / 9,040 / 8,971 with
small, 8,857 / 8,776 / 8,606 with base, both halves better on all three seeds.
It is about 2.5x slower to run and its encoder is 1.3 GB.

Pictures and labels come from scripts/box-crops.mjs (the wide crop). Each
picture is prepared exactly as the phone prepares it (OtherReaders.swift,
`Pixels.trocr`): stretched to 384 x 384 by half-pixel bilinear resizing, scaled
to -1..1. Training adds a small random crop and contrast change; reading does
not. The targets are fed by hand (teacher forcing): with this transformers
version, `labels=` shifts them twice, and TrOCR-base then learns nothing.

    CELL_CACHE=out/cells npx vite-node scripts/box-crops.mjs
    python scripts/train-trocr.py               about 90 minutes on an M-series Mac
    python scripts/export-readers.py --ours     converts it with the tally readers

Writes out/models/trocr-ours (the model to ship), or with --half N
out/models/trocr-ours-hN and its readings of the held-out half.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import time

import numpy as np
import torch
from PIL import Image
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOXES = ROOT / "out" / "boxes"
BASE = "microsoft/trocr-base-handwritten"


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
    planar = ((bilinear(a, 384, 384) - 0.5) / 0.5).transpose(2, 0, 1).copy()
    return torch.tensor(planar, dtype=torch.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--half", type=int, default=-1, help="hold out this half of the scans")
    parser.add_argument("--epochs", type=int, default=6)
    args = parser.parse_args()
    torch.manual_seed(0)
    random.seed(0)
    dev = "mps" if torch.backends.mps.is_available() else "cpu"

    index = json.loads((BOXES / "index.json").read_text())
    scans = sorted({e["key"].split(":")[0] for e in index})

    def side(e: dict) -> int:
        return scans.index(e["key"].split(":")[0]) % 2

    train = [e for e in index if args.half < 0 or side(e) != args.half]
    test = [e for e in index if side(e) == args.half]

    proc = TrOCRProcessor.from_pretrained(BASE)
    model = VisionEncoderDecoderModel.from_pretrained(BASE).to(dev)
    tok = proc.tokenizer
    start = model.config.decoder_start_token_id
    if start is None:
        start = model.generation_config.decoder_start_token_id
    model.config.decoder_start_token_id = start
    model.config.pad_token_id = tok.pad_token_id

    batch = 8
    steps = args.epochs * (len(train) // batch)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-5, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-5, total_steps=steps, pct_start=0.1)
    print(f"training on {len(train)} boxes, {steps} steps, on {dev}", flush=True)
    began = time.time()
    model.train()
    for epoch in range(args.epochs):
        random.shuffle(train)
        total = 0.0
        for i in range(0, len(train) - batch + 1, batch):
            chunk = train[i : i + batch]
            px = torch.stack([picture(e["file"], True) for e in chunk]).to(dev)
            # Decoder input [start, t1..tn], target [t1..tn, </s>], without the leading <s>.
            ids = tok([str(e["sheet"]) for e in chunk], padding=True, return_tensors="pt").input_ids
            if tok.bos_token_id is not None and (ids[:, 0] == tok.bos_token_id).all():
                ids = ids[:, 1:]
            dec_in = torch.cat([torch.full((ids.shape[0], 1), start), ids[:, :-1]], 1)
            target = ids.clone()
            target[target == tok.pad_token_id] = -100
            logits = model(pixel_values=px, decoder_input_ids=dec_in.to(dev)).logits
            loss = torch.nn.functional.cross_entropy(
                logits.reshape(-1, logits.shape[-1]), target.to(dev).reshape(-1), ignore_index=-100
            )
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

    name = "trocr-ours" if args.half < 0 else f"trocr-ours-h{args.half}"
    out = ROOT / "out" / "models" / name
    model.save_pretrained(out)
    proc.save_pretrained(out)
    if test:
        model.eval()
        readings = []
        with torch.no_grad():
            for i in range(0, len(test), 32):
                chunk = test[i : i + 32]
                px = torch.stack([picture(e["file"], False) for e in chunk]).to(dev)
                made = model.generate(px, max_new_tokens=8, num_beams=1)
                for e, text in zip(chunk, tok.batch_decode(made, skip_special_tokens=True)):
                    readings.append({"key": e["key"], "text": text.strip(), "sheet": e["sheet"]})
        (out / "held-out.json").write_text(json.dumps(readings))
        right = sum(1 for r in readings if r["text"] == str(r["sheet"]))
        print(f"held-out half {args.half}: {right} of {len(readings)} exactly right")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
