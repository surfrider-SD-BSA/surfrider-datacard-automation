"""Train and measure a small convolutional net as the digit reader.

The nearest-neighbour reader in src/lib/digits.ts has been tuned as far as it
goes: precision where it is most confident never moved off 84-86%, and
HANDOFF.md names a convolutional net as the honest next attempt, untried until
now. This is that attempt, measured the same way as everything else here and
against the same numbers.

Four things are different from the nearest-neighbour model, each for a reason:

*Convolutions.*  A nearest-neighbour poll asks whether this digit looks like
one it has seen; a net learns strokes and how they join, which is a question
about digits rather than about the training set.

*Pretraining on MNIST.*  70,000 handwritten digits, public, and normalized by
the same convention `normalizeDigit` follows -- fitted to 20x20 and centred by
centre of mass in 28x28. It supplies the one thing the chapter cannot: about
7,000 of every digit, where the chapter's cards hold 51 nines and 103 eights,
because that is how counts of beach debris are distributed. The net learns
digits from MNIST and then learns the chapter's pencils from the chapter.

*Thinned first.*  Pencil on a cleanup card is not pen on a form. The chapter's
digits carry about 40% fewer inked pixels than MNIST's of the same class (a 7
is 75 against 120), and a 2x2 erosion brings MNIST to within a few pixels on
every class (7: 75 against 75). A net pretrained on the thick strokes would
spend its fine-tuning unlearning them.

*Calibrated confidence.*  AUTO_ACCEPT and the pre-fill gate are thresholds on
this number, so it has to mean something: a softmax is usually overconfident,
and one temperature, fitted on the out-of-fold predictions, rescales it so that
readings at 0.9 are right about nine times in ten. The temperature is one
number fitted on 3,325 predictions, which is as little leakage as a
calibration can have; the per-fold models below share it.

Measured leave-one-EVENT-out, like everything else here: fine-tune on 25
events, test on the 26th, rotate. MNIST is in every fold, which is fair -- it
is not the chapter's data and the shipped model would have it too.

What it measured, 28 September 2026, against the nearest-neighbour reader on
the same 3,325 digits and the same folds:

                                      nearest neighbour      this net
    right, against the typed labels        71.4%              72.4%
    its most confident band            1,261 at 86.0%      634 at 90.1% (>= 0.9)
    right, read by eye (270 digits)        83.7%              86.7%
    wrong by eye, confidence >= 0.45     19 of 232           8 of 228
    wrong by eye, confidence >= 0.75      5 of 184           0 of 157

THE TYPED LABELS ARE THE CEILING, NOT EITHER READER. The net's most confident
"mistakes" were read by eye and nearly every one was the label's -- a 5 typed
as 2, a 6 as 7, whole events of cards typed into the wrong column. About one
label in five is wrong for the crop it is attached to, which is why precision
against them stops near 90% however sure the net is, and why the by-eye rows
are the ones to decide on. The by-eye sample is 300 digits drawn at random
(numpy seed 20260928); the 102 where either reader disagreed with the label
were read blind, without the label or either reading, and the 30 too ambiguous
for a person to call are left out.

Tried and dropped, each measured the same way (typed labels / wrong by eye of
those above 0.45), against this net's 72.4% / 8 of 228:

    leaving out the 141 labels a held-out net contradicted at >= 0.8,
      and training again                              72.8% / 15 of 237
    three nets averaged (seeds 0-2)                   73.1% / 10 of 232
    twice the width (--width 2), 4x the arithmetic    74.5% / 12 of 235
    forty epochs instead of twenty                    73.3% / 10 of 232

A second seed of this net alone scores 72.9% / 8 of 227, so half a point either
way is noise. None of them is worth its cost, and the reason is the finding in
HANDOFF.md: most hidden numbers that are wrong were CUT wrong before this net
ever saw them, so the gains are in segmentDigits, not here.

Usage:
    PYTHONPATH=<dir with torch, numpy> python3 scripts/train_digits_cnn.py \\
        --mnist <dir>              measure
        ... --folds                also write one model per held-out event to
                                   out/models/cnn/, for hidden-accuracy.mjs
        ... --emit                 also write assets/reference/digit-model.json,
                                   trained on every event

MNIST is the four idx .gz files, e.g. from
https://ossci-datasets.s3.amazonaws.com/mnist/ -- it is not in the repository.
"""

from __future__ import annotations

import argparse
import base64
import copy
import gzip
import json
import math
import os
import pathlib
import sys
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = pathlib.Path(__file__).resolve().parent.parent
# TRAINING_DIR and FOLDS_DIR train a second set beside the first, to compare the two.
TRAINING = ROOT / os.environ.get("TRAINING_DIR", "out/training")
FOLDS = ROOT / os.environ.get("FOLDS_DIR", "out/models/cnn")
REF = ROOT / "assets" / "reference"

SIDE = 28


def load_chapter():
    """Bitmaps (N,1,28,28) in 0-1, labels, source event, and cell id per digit."""
    bitmaps, labels, sources, cells = [], [], [], []
    for path in sorted(TRAINING.glob("*.json")):
        data = json.loads(path.read_text())
        for sample in data.get("samples", []):
            source = sample.get("source") or data.get("source") or path.stem
            bitmaps.append(sample["bitmap"])
            labels.append(sample["label"])
            sources.append(source)
            # A value stands or falls as a whole: "2" and "21" are different
            # numbers of debris, so a cell is right only if every digit is.
            cells.append(f"{source}:{sample['card']}:{sample['row']}")
    x = np.asarray(bitmaps, dtype=np.float32).reshape(-1, 1, SIDE, SIDE) / 255.0
    return torch.tensor(x), torch.tensor(labels), np.asarray(sources), np.asarray(cells)


def thin(x: torch.Tensor) -> torch.Tensor:
    """2x2 erosion, padded back to 28x28. See the module note on pencil."""
    return F.pad(-F.max_pool2d(-x, 2, stride=1), (0, 1, 0, 1))


def load_mnist(directory: pathlib.Path):
    def idx(name: str, offset: int) -> np.ndarray:
        with gzip.open(directory / name) as f:
            return np.frombuffer(f.read(), np.uint8, offset=offset)

    xs, ys = [], []
    for split in ("train", "t10k"):
        xs.append(idx(f"{split}-images-idx3-ubyte.gz", 16).reshape(-1, 1, SIDE, SIDE))
        ys.append(idx(f"{split}-labels-idx1-ubyte.gz", 8))
    x = torch.tensor(np.concatenate(xs).astype(np.float32) / 255.0)
    y = torch.tensor(np.concatenate(ys).astype(np.int64))
    return thin(x), y


class Net(nn.Module):
    """Three convolutions and two dense layers: about 257,000 weights.

    Sized for the phone rather than the benchmark. It is about 6 million
    multiply-adds a digit, which is the same order as the nearest-neighbour
    search it replaces, and every layer is one `src/lib/digits.ts` can run in a
    few lines -- no batch norm, nothing that needs a runtime.
    """

    def __init__(self, width: float = 1.0) -> None:
        super().__init__()
        a, b, d = int(32 * width), int(64 * width), int(64 * width)
        self.c1 = nn.Conv2d(1, a, 3, padding=1)
        self.c2 = nn.Conv2d(a, b, 3, padding=1)
        self.c3 = nn.Conv2d(b, b, 3, padding=1)
        self.d1 = nn.Linear(b * 7 * 7, d)
        self.d2 = nn.Linear(d, 10)
        self.drop = nn.Dropout(0.3)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = F.max_pool2d(F.relu(self.c1(x)), 2)  # 32 x 14 x 14
        x = F.max_pool2d(F.relu(self.c2(x)), 2)  # 64 x 7 x 7
        x = F.relu(self.c3(x))
        x = self.drop(F.relu(self.d1(x.flatten(1))))
        return self.d2(x)


def augment(x: torch.Tensor) -> torch.Tensor:
    """A random small rotation, slant, size and offset for every digit.

    The variations one hand makes writing the same digit twice -- the same
    ranges the nearest-neighbour reader tries at read time (+/-8 degrees,
    +/-10% size, a pixel either way), a little wider because a net learns them
    rather than being handed them, and a slant because the net can learn that a
    slanted 1 is still a 1 without, as deslanting did, erasing what separates
    it from a 7.
    """
    n = x.shape[0]
    dev = x.device

    def u(scale: float) -> torch.Tensor:
        return (torch.rand(n, device=dev) * 2 - 1) * scale

    ang, size, slant = u(math.radians(10)), 1 + u(0.1), u(0.15)
    pixel = 2 / SIDE  # one pixel in affine_grid's -1..1 coordinates
    cos, sin = torch.cos(ang) / size, torch.sin(ang) / size
    theta = torch.stack(
        [
            torch.stack([cos, -sin + cos * slant, u(1.5 * pixel)], 1),
            torch.stack([sin, cos + sin * slant, u(1.5 * pixel)], 1),
        ],
        1,
    )
    grid = F.affine_grid(theta, list(x.shape), align_corners=False)
    return F.grid_sample(x, grid, mode="bilinear", padding_mode="zeros", align_corners=False)


def fit(
    net: Net,
    x: torch.Tensor,
    y: torch.Tensor,
    *,
    epochs: int,
    lr: float,
    extra: tuple[torch.Tensor, torch.Tensor] | None = None,
    mix: float = 0.0,
    batch: int = 128,
) -> Net:
    """Adam with a one-cycle schedule.

    `mix` adds that many MNIST digits per chapter digit, drawn fresh each epoch.
    """
    dev = next(net.parameters()).device
    per_epoch = len(x) + (int(mix * len(x)) if extra is not None else 0)
    steps = epochs * math.ceil(per_epoch / batch)
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.15)
    net.train()
    for _ in range(epochs):
        xs, ys = x, y
        if extra is not None and mix > 0:
            pick = torch.randint(len(extra[0]), (int(mix * len(x)),))
            xs, ys = torch.cat([x, extra[0][pick]]), torch.cat([y, extra[1][pick]])
        order = torch.randperm(len(xs))
        for i in range(0, len(xs), batch):
            at = order[i : i + batch]
            xb, yb = augment(xs[at].to(dev)), ys[at].to(dev)
            loss = F.cross_entropy(net(xb), yb)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
    return net


@torch.no_grad()
def logits_of(net: Net, x: torch.Tensor) -> torch.Tensor:
    dev = next(net.parameters()).device
    net.eval()
    return torch.cat([net(x[i : i + 1024].to(dev)).cpu() for i in range(0, len(x), 1024)])


def fit_temperature(logits: torch.Tensor, y: torch.Tensor) -> float:
    """The one temperature that makes the out-of-fold softmax honest (minimum NLL)."""
    best = (math.inf, 1.0)
    for t in np.exp(np.linspace(np.log(0.25), np.log(8), 400)):
        nll = F.cross_entropy(logits / float(t), y).item()
        best = min(best, (nll, float(t)))
    return best[1]


def report(
    pred: np.ndarray, conf: np.ndarray, truth: np.ndarray, cells: np.ndarray, sources: np.ndarray
) -> None:
    right = pred == truth
    print(f"\nper-digit accuracy, all digits: {right.mean() * 100:.1f}%")

    print("\nprecision/coverage by confidence threshold:")
    print("  threshold   answered   precision   cells fully right")
    ids, inverse = np.unique(cells, return_inverse=True)
    for t in (0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99):
        mask = conf >= t
        if not mask.any():
            continue
        cell_all = np.ones(len(ids), bool)
        cell_ok = np.ones(len(ids), bool)
        np.logical_and.at(cell_all, inverse, mask)
        np.logical_and.at(cell_ok, inverse, right)
        whole = cell_all.sum()
        full = (cell_all & cell_ok).sum()
        print(
            f"  >= {t:.2f}    {mask.sum():5d} ({mask.mean() * 100:3.0f}%)   "
            f"{right[mask].mean() * 100:5.1f}%      "
            f"{(full / whole * 100) if whole else 0:.1f}% of {whole} cells"
        )

    # The table HANDOFF.md keeps for the nearest-neighbour reader: the most
    # digits that can be answered while holding a precision, taking them in
    # order of confidence.
    order = np.argsort(-conf, kind="stable")
    running = np.cumsum(right[order]) / np.arange(1, len(order) + 1)
    print("\nmost digits answerable at a target precision:")
    for target in (0.80, 0.90, 0.95, 0.98, 0.99):
        ok = np.nonzero(running >= target)[0]
        # Only prefixes long enough to mean anything.
        ok = ok[ok >= 49]
        n = int(ok[-1]) + 1 if len(ok) else 0
        shown = f"{n:5d}  ({n / len(order) * 100:4.1f}%)" if n else "  not reachable"
        print(f"  {target * 100:3.0f}%   {shown}")

    print("\ncalibration (is a confidence of c right c of the time?):")
    for lo, hi in (
        (0.0, 0.5),
        (0.5, 0.7),
        (0.7, 0.8),
        (0.8, 0.9),
        (0.9, 0.95),
        (0.95, 0.99),
        (0.99, 1.01),
    ):
        m = (conf >= lo) & (conf < hi)
        if m.any():
            print(
                f"  {lo:.2f}-{min(hi, 1):.2f}   {m.sum():5d} digits   "
                f"right {right[m].mean() * 100:5.1f}%"
            )

    print("\nper class recall:")
    for d in range(10):
        at = truth == d
        if at.any():
            print(f"  {d}: {right[at].sum():4d}/{at.sum():<4d} {right[at].mean() * 100:3.0f}%")

    pairs = {}
    for t, p in zip(truth[~right], pred[~right]):
        pairs[(t, p)] = pairs.get((t, p), 0) + 1
    print("\nworst confusions:")
    for (t, p), n in sorted(pairs.items(), key=lambda kv: -kv[1])[:8]:
        print(f"  {t} read as {p}: {n}")

    print("\nper event (a whole unseen event each time):")
    for s in np.unique(sources):
        at = sources == s
        print(f"  {s:16s} {right[at].sum():4d}/{at.sum():<4d} {right[at].mean() * 100:3.0f}%")


def encode(net: Net, temperature: float, trained_on: list[str]) -> dict:
    def b64(t: torch.Tensor) -> str:
        return base64.b64encode(
            t.detach().cpu().contiguous().numpy().astype("<f4").tobytes()
        ).decode()

    def conv(c: nn.Conv2d) -> dict:
        return {
            "type": "conv",
            "in": c.in_channels,
            "out": c.out_channels,
            "k": c.kernel_size[0],
            "pad": c.padding[0],
            "w": b64(c.weight),
            "b": b64(c.bias),
        }

    def dense(d: nn.Linear) -> dict:
        return {
            "type": "dense",
            "in": d.in_features,
            "out": d.out_features,
            "w": b64(d.weight),
            "b": b64(d.bias),
        }

    return {
        "kind": "cnn-28x28",
        "note": (
            "Convolutional digit reader, from scripts/train_digits_cnn.py. Input is the "
            "28x28 bitmap normalizeDigit() gives (ink 0-255, fitted to 20x20 and centred "
            "by centre of mass), divided by 255, as one channel. Layers run in order; "
            "weights are little-endian float32, base64, conv as [out][in][k][k] with "
            "zero padding, dense as [out][in], and flatten is channel-major. The output "
            "is ten logits: divide by `temperature` before the softmax, or the confidence "
            "is not calibrated."
        ),
        "temperature": round(temperature, 4),
        "classes": list(range(10)),
        "layers": [
            conv(net.c1),
            {"type": "relu"},
            {"type": "maxpool", "k": 2},
            conv(net.c2),
            {"type": "relu"},
            {"type": "maxpool", "k": 2},
            conv(net.c3),
            {"type": "relu"},
            {"type": "flatten"},
            dense(net.d1),
            {"type": "relu"},
            dense(net.d2),
        ],
        "trainedOn": trained_on,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mnist", type=pathlib.Path, help="directory holding the four MNIST idx .gz files"
    )
    parser.add_argument("--pretrain-epochs", type=int, default=3)
    parser.add_argument(
        "--epochs", type=int, default=20, help="fine-tuning epochs on the chapter's digits"
    )
    parser.add_argument(
        "--mix",
        type=float,
        default=1.0,
        help="MNIST digits mixed in per chapter digit while fine-tuning",
    )
    parser.add_argument(
        "--save",
        type=pathlib.Path,
        help="write the held-out predictions here (.npz), for scoring by eye",
    )
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--width", type=float, default=1.0, help="channel multiplier for the net")
    parser.add_argument(
        "--folds", action="store_true", help="write a model per held-out event to out/models/cnn/"
    )
    parser.add_argument(
        "--emit", action="store_true", help="write assets/reference/digit-model.json"
    )
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

    x, y, sources, cells = load_chapter()
    events = sorted(set(sources))
    print(f"{len(y)} digits from {len(events)} events, on {dev}")
    print("per class: " + "  ".join(f"{d}:{(y == d).sum().item()}" for d in range(10)))

    mnist = load_mnist(args.mnist) if args.mnist else None
    base = Net(args.width).to(dev)
    if mnist is not None:
        began = time.time()
        fit(base, *mnist, epochs=args.pretrain_epochs, lr=1e-3, batch=256)
        print(f"pretrained on {len(mnist[1])} MNIST digits in {time.time() - began:.0f}s")

    lr = 3e-4 if mnist is not None else 1e-3
    fold_nets: dict[str, dict] = {}

    def held_out() -> torch.Tensor:
        """Leave-one-event-out logits for every digit."""
        logits = torch.zeros(len(y), 10)
        began = time.time()
        for i, held in enumerate(events, 1):
            test = torch.tensor(sources == held)
            train = ~test
            net = copy.deepcopy(base)
            fit(net, x[train], y[train], epochs=args.epochs, lr=lr, extra=mnist, mix=args.mix)
            logits[test] = logits_of(net, x[test])
            if args.folds:
                fold_nets[held] = copy.deepcopy(net.state_dict())
            print(
                f"\r  fold {i}/{len(events)}  ({held})  {time.time() - began:.0f}s      ",
                end="",
                flush=True,
            )
        print()
        return logits

    logits = held_out()

    temperature = fit_temperature(logits, y)
    probs = F.softmax(logits / temperature, dim=1)
    conf, pred = probs.max(1)
    print(f"temperature {temperature:.3f}")
    report(pred.numpy(), conf.numpy(), y.numpy(), cells, sources)
    if args.save:
        np.savez(
            args.save,
            pred=pred.numpy(),
            conf=conf.numpy(),
            logits=logits.numpy(),
            y=y.numpy(),
            src=sources,
            cells=cells,
        )

    if args.folds or args.emit:
        FOLDS.mkdir(parents=True, exist_ok=True)
        full = copy.deepcopy(base)
        fit(full, x, y, epochs=args.epochs, lr=lr, extra=mnist, mix=args.mix)
        blob = encode(full, temperature, events)
        if args.folds:
            for held, state in fold_nets.items():
                net = Net(args.width)
                net.load_state_dict(state)
                path = FOLDS / f"{held}.json"
                path.write_text(
                    json.dumps(encode(net, temperature, [e for e in events if e != held]))
                )
            # For a scan no event was trained on, the full model is already unseen.
            (FOLDS / "_all.json").write_text(json.dumps(blob))
            print(f"\nwrote {len(fold_nets)} held-out models and _all.json to {FOLDS}")
        if args.emit:
            path = REF / "digit-model.json"
            path.write_text(json.dumps(blob))
            print(f"\nwrote {path} ({path.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
