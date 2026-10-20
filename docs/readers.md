# The phone's readers

How the iOS app reads a written TOTAL box, as of 19 October 2026 (#163–#168).

## What runs, in order

For every box our own digit reader (`src/lib/digits.ts`) read as written digits:

1. **Our digit reader** reads it first (in the web bundle, as before). Its number and confidence are the starting point.
2. **Apple's Vision text reader** reads the boxes tiled 3 by 12 (`Engine.swift`, `appleReadings`).
3. **Our tuned reader** — TrOCR-small fine-tuned on the chapter's own boxes — reads every written box (`OtherReaders.readMain`, budget `mainBudget`). Where it reads a different number than ours, its number is filled in at confidence 0.4 (`mainReading`, `TUNED_DISAGREES` in `src/lib/prefill.ts`).
4. **Eight open readers** vote on that number (`OtherReaders.read`, budget `budget`): PP-OCRv5, EasyOCR, docTR CRNN, ViTSTR and PARSeq (PARSeq fine-tuned on our boxes) read every box; TrOCR small, base and large only boxes still undecided.
5. **Ranking** (`autoAcceptedInScan` in `prefill.ts`): a box Apple disagrees with, or at least 4 readers do (`OTHER_READERS_DISAGREE`), counts as flagged; the more readers disagree, the higher it ranks (`OTHER_READERS_WEIGHT`). The top 20% of each scan (`SHOW_SHARE`) is shown to a person; the rest is taken as read.

For every **tally-only box** (strokes in the strip, no number in the TOTAL box), the app's own stroke counter (`src/lib/tally.ts`) counts it first. Then **our two tally readers** — TrOCR-small taught to read a strip as its count, first on drawn tallies and then on the chapter's own, from two random starts — read the strip (`OtherReaders.readTally`, budget `tallyBudget`). Where at least one gives one clean count, the average of their clean counts goes in at the box's own confidence (`tallyFromReaders` in `prefill.ts`); otherwise the counter's number stands.

Swift reads the boxes and sends **text**; the engine turns text into numbers (`numberFromReader`) so the phone and the scorer share one rule.

## Measured

"Total off": the sum of how far the numbers taken unseen are from the chapter's typed sheets, on 25 scans (`scripts/apps-rule.mjs` with `SECOND=`, `OTHERS=`, `TUNED=`), for the shipped digit reader and two others trained the same way. Before any of this: 7,606. Now: about 5,570 (−27%). The steps and every number are in the comments of `prefill.ts` and the PRs.

## Rebuilding the models

The models (≈2.7 GB) are not in git. In a Python environment with torch, transformers, python-doctr, easyocr, rapidocr-onnxruntime, onnx, onnxruntime and onnxconverter-common:

```
CELL_CACHE=out/cells-app npx vite-node scripts/box-crops.mjs   # our boxes and sheet values -> out/boxes
python scripts/train-trocr.py                                   # tuned reader -> out/models/trocr-ours (~25 min, GPU)
python scripts/train-parseq.py                                  # tuned PARSeq -> out/models/parseq-ours.pt (~1 h, CPU)
python scripts/export-readers.py                                # everything -> ios/SurfriderDataCards/readers
```

The tally readers (`readers/tally-a`, `tally-b`):

```
CELL_CACHE=out/cells-app FOLDS_DIR=out/models/cnn-w4s1 npx vite-node scripts/tally-strips.mjs   # strips and sheet counts -> out/tally
python scripts/train-tally.py synth                             # drawn tallies -> out/models/tally-synth (~80 min, GPU)
python scripts/train-tally.py real --seed 0 --name tally-a      # ~15 min each
python scripts/train-tally.py real --seed 1 --name tally-b
python scripts/export-readers.py --tally                        # just these two
```

Retraining is a new roll of the dice: two random starts held out on the same scans differed by 590 in total off. Keep the pair that was measured unless the new one is measured too.

Without them the app builds and runs as it did before #163: Apple is the only second opinion and our number is filled in.

## Things to know

- **Time**: about 2.5–3 minutes of reading on an M-series Mac for an average scan (244 written boxes). The owner prefers a scan under about 3.5 minutes (a preference, not a limit). Both budgets cap the time; what is not read keeps fewer votes.
- **Not yet checked on a real iPhone**: speed and memory (TrOCR-large's encoder is 1.2 GB).
- **Precision**: each model is stored at the smallest size that reads the same: half precision for docTR CRNN/PARSeq and EasyOCR, full for ViTSTR (half reads NaN) and the TrOCR encoders (half is 2.4× slower on a CPU), 8-bit for the TrOCR decoders.
- **Scoring trap**: give every reader readings on every box the phone reads. A simulation with tuned readings only for sheet-known boxes showed ~5,100 for what is really ~5,570.
- **Training trap**: with this transformers version, passing `labels=` to TrOCR shifts the targets twice. `scripts/train-trocr.py` keeps the tokenizer's leading `<s>`, which lines the two shifts up; dropping it makes the model write nothing.
