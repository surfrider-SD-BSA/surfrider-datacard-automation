"""Teach TrOCR-small to read a tally strip as its count: our tally readers.

The phone runs two of them on every tally-only box (strokes, no number in the
TOTAL box) and averages their clean counts (`tallyFromReaders` in
src/lib/prefill.ts). Measured 20 October 2026 held out by halves of the scans:
on the 299 such boxes with a sheet number the app's counter was exactly right
on 77 and off by 2,220; the pair averaged, 108 and 1,653.

There are only 299 labelled strips, so each reader learns first on drawn ones
(`synth`: pencil strokes in groups of five, four upright and the fifth across,
on a pale ruled strip, sometimes a real handwritten number pasted in instead),
then on the chapter's strips with drawn ones mixed into every batch (`real`).
Pictures are prepared exactly as the phone prepares them (OtherReaders.swift,
`Pixels.trocr`): stretched to 384 x 384 by half-pixel bilinear resizing, -1..1.

    CELL_CACHE=out/cells-app FOLDS_DIR=out/models/cnn-w4s1 npx vite-node scripts/tally-strips.mjs
    CELL_CACHE=out/cells-app npx vite-node scripts/box-crops.mjs     (the pasted numbers)
    python scripts/train-tally.py synth                      about 80 minutes on an M-series Mac
    python scripts/train-tally.py real --seed 0 --name tally-a        about 15 minutes
    python scripts/train-tally.py real --seed 1 --name tally-b
    python scripts/export-readers.py --ours                  converts them with our tuned reader

`real --half N` trains on the other half of the scans and reads this one, as
measured. Each run writes out/models/<name>.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import random
import re
import time

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter
from transformers import TrOCRProcessor, VisionEncoderDecoderModel

ROOT = pathlib.Path(__file__).resolve().parent.parent
TALLY = ROOT / "out" / "tally"
BOXES = ROOT / "out" / "boxes"
MODELS = ROOT / "out" / "models"
BASE = "microsoft/trocr-small-handwritten"
_written: list[dict] | None = None


def written() -> list[dict]:
    """Handwritten TOTAL boxes with their numbers, to paste into some drawn strips."""
    global _written
    if _written is None:
        index = json.loads((BOXES / "index.json").read_text())
        _written = [e for e in index if isinstance(e.get("sheet"), int) and 1 <= e["sheet"] <= 99]
    return _written


def drawn_count(rng: random.Random) -> int:
    r = rng.random()
    if r < 0.04:
        return 0
    if r < 0.50:
        return rng.randint(1, 5)
    if r < 0.70:
        return rng.randint(6, 10)
    if r < 0.85:
        return rng.randint(11, 20)
    if r < 0.95:
        return rng.randint(21, 40)
    return rng.randint(41, 70)


def drawn(rng: random.Random) -> tuple[np.ndarray, int]:
    """A drawn tally strip (H x W x 3 uint8) and its count."""
    H, W, S = rng.randint(50, 110), rng.randint(260, 650), 3  # S: drawn 3x, then shrunk
    im = Image.new("L", (W * S, H * S), int(rng.uniform(222, 250)))
    d = ImageDraw.Draw(im)
    # The printed rules: the row's top and bottom, sometimes the TOTAL box's left edge.
    rule, rw = int(rng.uniform(110, 190)), rng.choice([1, 2, 2, 3]) * S
    for y in (rng.uniform(0, 0.08) * H, H - rng.uniform(0, 0.08) * H):
        d.line([(0, y * S), (W * S, y * S)], fill=rule, width=rw)
    if rng.random() < 0.3:
        x = W - rng.uniform(0, 6)
        d.line([(x * S, 0), (x * S, H * S)], fill=rule, width=rw)

    n = drawn_count(rng)
    if rng.random() < 0.08 and written():
        # A number written in the strip instead of strokes.
        e = rng.choice(written())
        n = e["sheet"]
        b = Image.open(BOXES / "png" / e["file"]).convert("L")
        h = int(H * rng.uniform(0.7, 1.0))
        w = max(8, int(b.width * h / b.height))
        b = b.resize((w * S, h * S))
        x = int(rng.uniform(0.05, 0.6) * W) * S
        under = np.asarray(im.crop((x, 0, x + b.width, b.height)))
        im.paste(Image.fromarray(np.minimum(under, np.asarray(b))), (x, 0))
    elif n > 0:
        L = H * rng.uniform(0.45, 0.8)
        gap = L * rng.uniform(0.12, 0.32)
        ggap = gap * rng.uniform(1.3, 3.0)
        slant = math.radians(rng.uniform(-14, 14))
        grouped = rng.random() < 0.82
        groups = ([5] * (n // 5) + ([n % 5] if n % 5 else [])) if grouped else [n]
        width = sum((g - 1 if grouped and g == 5 else g) * gap for g in groups) + ggap * len(groups)
        rows, avail = 1, W * rng.uniform(0.7, 0.97)
        if width > avail:
            if rng.random() < 0.5 and H > 70:
                rows, L, gap, ggap = 2, L * 0.5, gap * 0.6, ggap * 0.6
            else:
                gap, ggap = gap * avail / width, ggap * avail / width
        dark, thick = rng.uniform(40, 150), rng.uniform(1.4, 3.6) * S
        x, row = rng.uniform(0.01, 0.15) * W, 0
        base = H * (0.5 + L / H / 2) if rows == 1 else H * 0.47
        for g in groups:
            strokes = []
            for _ in range(4 if grouped and g == 5 else g):
                a = slant + math.radians(rng.uniform(-5, 5))
                length = L * rng.uniform(0.85, 1.12)
                y0 = base + rng.uniform(-0.06, 0.06) * L
                x0 = x + rng.uniform(-0.1, 0.1) * gap
                x1, y1 = x0 + math.sin(a) * length, y0 - math.cos(a) * length
                shade = int(dark + rng.uniform(-15, 15))
                d.line([(x0 * S, y0 * S), (x1 * S, y1 * S)], fill=shade, width=int(thick))
                strokes.append((x0, y0, x1, y1))
                x += gap
            if grouped and g == 5:
                (ax, ay, _, _), (_, _, bx1, by1) = strokes[0], strokes[-1]
                d.line(
                    [
                        ((ax - gap * 0.6) * S, (ay - L * rng.uniform(0.1, 0.3)) * S),
                        ((bx1 + gap * 0.6) * S, (by1 + L * rng.uniform(0.1, 0.3)) * S),
                    ],
                    fill=int(dark),
                    width=int(thick),
                )
            x += ggap
            if rows == 2 and row == 0 and x > W * 0.9:
                x, base, row = rng.uniform(0.01, 0.1) * W, H * 0.95, 1
    im = im.resize((W, H), Image.BILINEAR)
    if rng.random() < 0.3:
        im = im.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 0.9)))
    a = np.asarray(im, np.float32) + np.random.normal(0, rng.uniform(1, 6), (H, W))
    a = np.clip(a, 0, 255).astype(np.uint8)
    return np.stack([a] * 3, -1), n


def bilinear(a: np.ndarray, oh: int, ow: int) -> np.ndarray:
    h, w = a.shape[:2]
    ys = np.clip((np.arange(oh) + 0.5) * h / oh - 0.5, 0, h - 1)
    xs = np.clip((np.arange(ow) + 0.5) * w / ow - 0.5, 0, w - 1)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, h - 1), np.minimum(x0 + 1, w - 1)
    fy, fx = (ys - y0)[:, None, None], (xs - x0)[None, :, None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bottom = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return top * (1 - fy) + bottom * fy


def tensor(a: np.ndarray) -> torch.Tensor:
    """The phone's TrOCR input for an H x W x 3 uint8 picture."""
    planar = ((bilinear(a.astype(np.float32) / 255, 384, 384) - 0.5) / 0.5).transpose(2, 0, 1)
    return torch.tensor(planar.copy(), dtype=torch.float32)


def strip(e: dict, augment: bool) -> np.ndarray:
    a = np.asarray(Image.open(TALLY / "png" / e["file"]).convert("RGB"), np.float32) / 255
    if augment:
        h, w = a.shape[:2]

        def cut(n: int) -> int:
            return random.randint(0, max(1, n // 20))

        a = a[cut(h) : h - cut(h), cut(w) : w - cut(w)]
        a = (a - 0.5) * random.uniform(0.8, 1.3) + 0.5 + random.uniform(-0.08, 0.08)
        a = np.clip(a, 0, 1)
    return (a * 255).astype(np.uint8)


def count(text: str) -> int | None:
    """`tallyNumber` in src/lib/prefill.ts."""
    m = re.fullmatch(r"(\d{1,2})(?: \1)*", text.strip())
    return int(m.group(1)) if m else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["synth", "real"])
    parser.add_argument("--steps", type=int)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--name", default="tally-a")
    parser.add_argument("--half", type=int, default=-1, help="hold out this half of the scans")
    args = parser.parse_args()
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    dev = "mps" if torch.backends.mps.is_available() else "cpu"

    proc = TrOCRProcessor.from_pretrained(BASE)
    tok = proc.tokenizer
    source = BASE if args.phase == "synth" else str(MODELS / "tally-synth")
    model = VisionEncoderDecoderModel.from_pretrained(source).to(dev)
    start = model.config.decoder_start_token_id or model.generation_config.decoder_start_token_id
    model.config.decoder_start_token_id = start
    model.config.pad_token_id = tok.pad_token_id

    train: list[dict] = []
    test: list[dict] = []
    if args.phase == "real":
        index = json.loads((TALLY / "index.json").read_text())
        index = [e for e in index if e["sheet"] is not None]
        scans = sorted({e["scan"] for e in index})
        train = [e for e in index if scans.index(e["scan"]) % 2 != args.half]
        test = [e for e in index if scans.index(e["scan"]) % 2 == args.half]
    steps = args.steps or (4000 if args.phase == "synth" else 800)
    lr = 3e-5 if args.phase == "synth" else 2e-5
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.1)
    print(f"{args.phase}: {len(train)} real strips, {steps} steps on {dev}", flush=True)

    model.train()
    began, running, batch = time.time(), 0.0, 16
    for step in range(steps):
        # Half of each real batch is the chapter's strips, the rest drawn ones.
        items = []
        for k in range(batch):
            if train and k < batch // 2:
                e = random.choice(train)
                items.append((strip(e, True), e["sheet"]))
            else:
                items.append(drawn(random))
        px = torch.stack([tensor(a) for a, _ in items]).to(dev)
        labels = tok([str(n) for _, n in items], padding=True, return_tensors="pt").input_ids
        labels[labels == tok.pad_token_id] = -100
        loss = model(pixel_values=px, labels=labels.to(dev)).loss
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        running += loss.item()
        if (step + 1) % 200 == 0:
            took = time.time() - began
            print(f"step {step + 1}: loss {running / 200:.3f}, {took:.0f} s", flush=True)
            running = 0.0

    name = "tally-synth" if args.phase == "synth" else args.name
    out = MODELS / (name if args.half < 0 else f"{name}-h{args.half}")
    model.save_pretrained(out)
    proc.save_pretrained(out)
    if test:
        model.eval()
        readings = []
        with torch.no_grad():
            for i in range(0, len(test), 32):
                chunk = test[i : i + 32]
                px = torch.stack([tensor(strip(e, False)) for e in chunk]).to(dev)
                made = model.generate(px, max_new_tokens=6, num_beams=1)
                for e, text in zip(chunk, tok.batch_decode(made, skip_special_tokens=True)):
                    text = text.strip()
                    readings.append(
                        {"key": e["key"], "text": text, "sheet": e["sheet"], "app": e["app"]}
                    )
        (out / "held-out.json").write_text(json.dumps(readings))
        # Where it gives no clean count, the app's count stands.
        right = sum(
            1
            for r in readings
            if (count(r["text"]) if count(r["text"]) is not None else r["app"]) == r["sheet"]
        )
        print(f"held-out half {args.half}: {right} of {len(readings)} exactly right")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
