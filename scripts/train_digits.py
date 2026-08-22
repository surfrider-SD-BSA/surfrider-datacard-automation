"""Train and measure a digit classifier that can be shipped to the browser.

The nearest-neighbour model in ``train-digits.mjs`` saturated: 7, 18 and 27
events gave 63.0%, 66.3% and 66.3%, so more data stopped helping, and the
precision where it answers never moved off ~84%.  A note there says there is no
ML toolchain on this machine.  That is no longer true -- ``pip install --target``
puts scikit-learn on this laptop in about a minute -- so this is the honest next
method.

Two things are being tested at once, and the second matters more than the first:

*A model with a decision boundary* rather than a poll of neighbours.  Nearest
neighbour over raw pixels asks whether this digit looks like one it has seen,
which is a question about the training set; a fitted model asks what separates
the classes, which is a question about digits.

*Augmentation.*  There are 3,218 digits and they are wildly unbalanced -- 1,142
ones against 50 nines -- because that is how counts of beach debris are
distributed, and the chapter cannot be asked to write more nines.  What can be
done is to make more of the ones it already has: the same digit shifted a pixel,
turned a couple of degrees, or written slightly larger is a different bitmap and
the same number.  This is the one lever the earlier work did not pull, and on a
set this small it is usually worth more than the choice of model.

Measured leave-one-EVENT-out, like everything else here: train on 26 events,
test on the 27th, rotate.  Anything less flatters the result, because digits
from one event share a handful of volunteers, one pen each and one scanner
session.

The figure that decides the design is PRECISION WHERE IT ANSWERS, not accuracy.
A cell the model declines costs a keystroke the human was making anyway; a cell
it fills wrongly costs data integrity, because a confident wrong number invites
agreement.

Usage:
    PYTHONPATH=<dir-with-sklearn> python3 scripts/train_digits.py [--emit]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
TRAINING = ROOT / "out" / "training"
REF = ROOT / "assets" / "reference"

SIDE = 28


def load() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return bitmaps, labels, source event, and cell id for every digit."""
    bitmaps, labels, sources, cells = [], [], [], []
    for path in sorted(TRAINING.glob("*.json")):
        data = json.loads(path.read_text())
        for sample in data.get("samples", []):
            bitmaps.append(sample["bitmap"])
            labels.append(sample["label"])
            source = sample.get("source") or data.get("source") or path.stem
            sources.append(source)
            # A value stands or falls as a whole: "2" and "21" are different
            # numbers of debris, so a cell is only usable if every digit in it
            # was answered and answered right.
            cells.append(f"{source}:{sample['card']}:{sample['row']}")
    return (
        # float64, not float32. In float32 the optimiser's own accumulators
        # overflow -- numpy reports it in the matmuls -- and a diverged net still
        # returns a softmax that looks exactly like a confidence, which is the
        # worst possible failure for a design that gates on confidence.
        np.asarray(bitmaps, dtype=np.float64) / 255.0,
        np.asarray(labels, dtype=np.int64),
        np.asarray(sources),
        np.asarray(cells),
    )


def shift(img: np.ndarray, dx: int, dy: int) -> np.ndarray:
    out = np.zeros_like(img)
    xs = slice(max(0, dx), SIDE + min(0, dx))
    ys = slice(max(0, dy), SIDE + min(0, dy))
    xd = slice(max(0, -dx), SIDE + min(0, -dx))
    yd = slice(max(0, -dy), SIDE + min(0, -dy))
    out[ys, xs] = img[yd, xd]
    return out


def rotate(img: np.ndarray, degrees: float) -> np.ndarray:
    """Rotate about the centre with nearest-neighbour sampling.

    Nearest neighbour rather than anything smoother on purpose: these bitmaps
    are ink COVERAGE, already box-filtered down from the scan, and interpolating
    them again blurs away the thin strokes that separate a 1 from a 7.
    """
    theta = np.deg2rad(degrees)
    cos, sin = np.cos(theta), np.sin(theta)
    ys, xs = np.mgrid[0:SIDE, 0:SIDE]
    cx = cy = (SIDE - 1) / 2
    sx = (xs - cx) * cos + (ys - cy) * sin + cx
    sy = -(xs - cx) * sin + (ys - cy) * cos + cy
    sx = np.rint(sx).astype(int)
    sy = np.rint(sy).astype(int)
    ok = (sx >= 0) & (sx < SIDE) & (sy >= 0) & (sy < SIDE)
    out = np.zeros((SIDE, SIDE), dtype=img.dtype)
    out[ys[ok], xs[ok]] = img[sy[ok], sx[ok]]
    return out


def scale(img: np.ndarray, factor: float) -> np.ndarray:
    ys, xs = np.mgrid[0:SIDE, 0:SIDE]
    c = (SIDE - 1) / 2
    sx = np.rint((xs - c) / factor + c).astype(int)
    sy = np.rint((ys - c) / factor + c).astype(int)
    ok = (sx >= 0) & (sx < SIDE) & (sy >= 0) & (sy < SIDE)
    out = np.zeros((SIDE, SIDE), dtype=img.dtype)
    out[ys[ok], xs[ok]] = img[sy[ok], sx[ok]]
    return out


def augment(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Every digit, plus small shifts, rotations and rescalings of it.

    Deliberately small.  These are variations one hand produces writing the same
    digit twice, which is the variation the model has to survive; anything
    larger starts inventing digits nobody wrote.
    """
    imgs = x.reshape(-1, SIDE, SIDE)
    out = [imgs]
    out.append(np.stack([shift(i, 1, 0) for i in imgs]))
    out.append(np.stack([shift(i, -1, 0) for i in imgs]))
    out.append(np.stack([shift(i, 0, 1) for i in imgs]))
    out.append(np.stack([shift(i, 0, -1) for i in imgs]))
    out.append(np.stack([rotate(i, 8) for i in imgs]))
    out.append(np.stack([rotate(i, -8) for i in imgs]))
    out.append(np.stack([scale(i, 1.12) for i in imgs]))
    out.append(np.stack([scale(i, 0.89) for i in imgs]))
    xs = np.concatenate(out).reshape(-1, SIDE * SIDE)
    ys = np.tile(y, len(out))
    return xs, ys


def build(seed: int = 0):
    from sklearn.neural_network import MLPClassifier
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    # Trained gently and stopped early, on purpose. The first version ran at
    # 3e-3 for a fixed sixty epochs and diverged -- numpy reported overflow in
    # the matmuls -- and a diverged net still returns a softmax that looks like
    # a confidence, which is the worst possible failure for a design that gates
    # on confidence.
    # Standardized first, and that is not decoration. These bitmaps are ink
    # COVERAGE: most of the 784 inputs are zero for every digit in the set,
    # because no digit reaches the corners of its box. Feeding columns with no
    # variance straight into an optimiser is what made the first two attempts
    # diverge -- numpy reported overflow in the matmuls, and a diverged network
    # still returns a softmax that looks exactly like a confidence, which is the
    # worst possible failure for a design that gates on confidence.
    return make_pipeline(
        StandardScaler(),
        MLPClassifier(
            hidden_layer_sizes=(200,),
            alpha=1e-3,
            batch_size=128,
            learning_rate_init=3e-4,
            max_iter=300,
            early_stopping=True,
            n_iter_no_change=12,
            random_state=seed,
        ),
    )


def curve(pred: np.ndarray, conf: np.ndarray, truth: np.ndarray, cells: np.ndarray) -> None:
    print("\n  threshold   answered      precision   whole cells right")
    for t in (0.0, 0.5, 0.7, 0.9, 0.95, 0.99, 0.995):
        mask = conf >= t
        if not mask.any():
            continue
        precision = (pred[mask] == truth[mask]).mean()

        # A cell counts only when every digit in it was answered.
        whole = right = 0
        for cell in np.unique(cells):
            at = cells == cell
            if not mask[at].all():
                continue
            whole += 1
            right += bool((pred[at] == truth[at]).all())
        print(
            f"  >= {t:.3f}   {mask.sum():5d} ({mask.mean() * 100:3.0f}%)   "
            f"{precision * 100:7.1f}%   "
            f"{(right / whole * 100) if whole else 0:6.1f}% of {whole}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--emit", action="store_true", help="write the model for the browser")
    parser.add_argument("--no-augment", action="store_true")
    args = parser.parse_args()

    x, y, source, cells = load()
    events = np.unique(source)
    print(f"{len(y)} digits from {len(events)} events")
    print("per class: " + "  ".join(f"{d}:{(y == d).sum()}" for d in range(10)))

    pred = np.zeros_like(y)
    conf = np.zeros(len(y), dtype=np.float64)

    for i, held in enumerate(events, 1):
        train = source != held
        xt, yt = x[train], y[train]
        if not args.no_augment:
            xt, yt = augment(xt, yt)
        model = build()
        model.fit(xt, yt)
        probs = model.predict_proba(x[~train])
        pred[~train] = model.classes_[probs.argmax(axis=1)]
        conf[~train] = probs.max(axis=1)
        print(f"\r  fold {i}/{len(events)}  ({held})            ", end="", flush=True)
    print()

    print(f"\nper-digit accuracy, all digits: {(pred == y).mean() * 100:.1f}%")
    curve(pred, conf, y, cells)

    print("\nper class recall:")
    for d in range(10):
        at = y == d
        if at.any():
            hit, n = (pred[at] == d).sum(), at.sum()
            print(f"  {d}: {hit:4d}/{n:<4d} {hit / n * 100:3.0f}%")

    if args.emit:
        xt, yt = (x, y) if args.no_augment else augment(x, y)
        model = build()
        model.fit(xt, yt)
        blob = {
            "kind": "mlp-28x28",
            "note": (
                "Bitmaps are 28x28 ink coverage 0-255, scaled to fit 20x20 and "
                "centred by centre of mass. Inputs are divided by 255. Layers "
                "are dense with relu, then softmax."
            ),
            "layers": [
                {"w": w.tolist(), "b": b.tolist()}
                for w, b in zip(model[-1].coefs_, model[-1].intercepts_)
            ],
            "scaler": {
                "mean": model[0].mean_.tolist(),
                "scale": model[0].scale_.tolist(),
            },
            "classes": model[-1].classes_.tolist(),
        }
        path = REF / "digit-model.json"
        path.write_text(json.dumps(blob))
        print(f"\nwrote {path} ({path.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
