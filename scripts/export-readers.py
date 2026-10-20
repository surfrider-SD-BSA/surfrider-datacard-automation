"""Build the open handwriting readers the iOS app runs beside its own
(OtherReaders.swift), as ONNX files in ios/SurfriderDataCards/readers/.

Eight readers, all free and open, downloaded from their publishers:

    doctr-crnn, doctr-parseq, doctr-vitstr   docTR (Mindee), recognition models; PARSeq with
                                             our fine-tuned weights if scripts/train-parseq.py ran
    paddle-v5                                PaddleOCR PP-OCRv5 server recognizer
    easyocr-rec                              EasyOCR's English recognizer
    trocr-small, trocr-base, trocr-large     Microsoft TrOCR, handwritten
    trocr-ours                               TrOCR-small fine-tuned on the chapter's boxes,
                                             if scripts/train-trocr.py has run

Stored small enough for the App Store's 4 GB limit (2.6 GB in all): docTR's
CRNN and PARSeq and EasyOCR at half precision; ViTSTR and the TrOCR encoders
at full (at half ViTSTR reads NaN, and the encoders run 2.4x slower on a
CPU); the TrOCR decoders as 8-bit weights (half precision breaks their
attention mask); PP-OCRv5 as published (96 MB). Measured 18 October 2026
against the full-size readers: see OTHER_READERS_DISAGREE in src/lib/prefill.ts.

Needs Python with torch, transformers, python-doctr, easyocr,
rapidocr-onnxruntime, onnx, onnxruntime and onnxconverter-common:

    python scripts/export-readers.py            about 10 minutes, ~5 GB of downloads
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import tempfile

import onnx
import torch
from onnxconverter_common import float16
from onnxruntime.quantization import QuantType, quantize_dynamic

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(os.environ.get("READERS_OUT", ROOT / "ios" / "SurfriderDataCards" / "readers"))


def half(src: pathlib.Path, dst: pathlib.Path) -> None:
    model = float16.convert_float_to_float16(
        onnx.load(str(src)), keep_io_types=True, disable_shape_infer=True
    )
    onnx.save(model, str(dst))


def doctr(tmp: pathlib.Path) -> None:
    from doctr.models import crnn_vgg16_bn, parseq, vitstr_base

    for name, build in [("crnn", crnn_vgg16_bn), ("parseq", parseq), ("vitstr", vitstr_base)]:
        model = build(pretrained=True, exportable=True)
        tuned = ROOT / "out" / "models" / f"{name}-ours.pt"
        if tuned.exists():  # fine-tuned on the chapter's boxes (scripts/train-parseq.py)
            model.load_state_dict(torch.load(tuned, map_location="cpu"))
        elif name == "parseq":
            print(f"no {tuned}: PARSeq is exported as published (scripts/train-parseq.py tunes it)")
        model.eval()
        x = torch.rand(1, 3, 32, 128)
        full = tmp / f"doctr-{name}.onnx"
        torch.onnx.export(
            model,
            x,
            str(full),
            input_names=["input"],
            output_names=["logits"],
            dynamic_axes={"input": {0: "b"}, "logits": {0: "b"}},
            opset_version=17,
            dynamo=False,
        )
        if name == "vitstr":  # at half precision it reads nothing but NaN (10.7% right)
            shutil.copy(full, OUT / f"doctr-{name}.onnx")
        else:
            half(full, OUT / f"doctr-{name}.onnx")
        (OUT / f"doctr-{name}.vocab.json").write_text(json.dumps(model.cfg["vocab"]))


# PaddleOCR's PP-OCRv5 server recognizer, as RapidOCR publishes it. It replaced
# v3 on 18 October 2026: alone it is right on 79% of the boxes it reads (ours
# 74% on the same), and in the vote it took total off 7,036 -> 6,884.
PADDLE_URL = (
    "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/"
    "onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_server.onnx"
)
PADDLE_SHA256 = "e09385400eaaaef34ceff54aeb7c4f0f1fe014c27fa8b9905d4709b65746562a"


def paddle() -> None:
    import hashlib
    import urllib.request

    import onnxruntime as ort

    dst = OUT / "paddle-v5.onnx"
    urllib.request.urlretrieve(PADDLE_URL, dst)
    if hashlib.sha256(dst.read_bytes()).hexdigest() != PADDLE_SHA256:
        dst.unlink()
        raise SystemExit(f"{PADDLE_URL} is not the model that was measured")
    meta = ort.InferenceSession(str(dst)).get_modelmeta().custom_metadata_map
    chars = meta["character"].splitlines()
    (OUT / "paddle-v5.vocab.json").write_text(
        json.dumps(["blank", *chars, " "], ensure_ascii=False)
    )


def easyocr(tmp: pathlib.Path) -> None:
    import easyocr as eo

    reader = eo.Reader(["en"], gpu=False, verbose=False, quantize=False)
    model = reader.recognizer.module if hasattr(reader.recognizer, "module") else reader.recognizer
    model.eval()

    class Mean(torch.nn.Module):  # its adaptive pooling, which ONNX cannot export with a free width
        def forward(self, x):
            return x.mean(dim=3, keepdim=True)

    model.AdaptiveAvgPool = Mean()

    class Wrap(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, x):
            return self.m(x, None)

    full = tmp / "easyocr-rec.onnx"
    torch.onnx.export(
        Wrap(model),
        torch.rand(1, 1, 64, 160),
        str(full),
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "b", 3: "w"}, "logits": {0: "b", 1: "t"}},
        opset_version=17,
        dynamo=False,
    )
    half(full, OUT / "easyocr-rec.onnx")
    (OUT / "easyocr-rec.vocab.json").write_text(json.dumps(list(reader.converter.character)))


def trocr(tmp: pathlib.Path) -> None:
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel

    models = [
        (f"microsoft/trocr-{s}-handwritten", f"trocr-{s}") for s in ["small", "base", "large"]
    ]
    # Our tuned reader, if scripts/train-trocr.py has made it here.
    ours = ROOT / "out" / "models" / "trocr-ours"
    if ours.exists():
        models.append((str(ours), "trocr-ours"))
    else:
        print(f"no {ours}: the tuned reader is left out (scripts/train-trocr.py makes it)")
    for name, folder in models:
        proc = TrOCRProcessor.from_pretrained(name)
        model = VisionEncoderDecoderModel.from_pretrained(name).eval()
        start = model.config.decoder_start_token_id
        if start is None:
            start = model.generation_config.decoder_start_token_id
        eos = model.generation_config.eos_token_id
        if eos is None:
            eos = proc.tokenizer.eos_token_id

        class Enc(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.m = m

            def forward(self, px):
                return self.m.encoder(pixel_values=px).last_hidden_state

        class Dec(torch.nn.Module):
            def __init__(self, m):
                super().__init__()
                self.m = m

            def forward(self, ids, enc):
                return self.m.decoder(
                    input_ids=ids, encoder_hidden_states=enc, use_cache=False
                ).logits

        dst = OUT / folder
        dst.mkdir(exist_ok=True)
        px = torch.rand(1, 3, 384, 384)
        with torch.no_grad():
            hidden = Enc(model)(px)
        enc, dec = tmp / f"{folder}-encoder.onnx", tmp / f"{folder}-decoder.onnx"
        torch.onnx.export(
            Enc(model),
            px,
            str(enc),
            input_names=["pixel_values"],
            output_names=["hidden"],
            dynamic_axes={"pixel_values": {0: "b"}, "hidden": {0: "b"}},
            opset_version=17,
            dynamo=False,
        )
        torch.onnx.export(
            Dec(model),
            (torch.tensor([[start, 20]]), hidden),
            str(dec),
            input_names=["input_ids", "hidden"],
            output_names=["logits"],
            opset_version=17,
            dynamo=False,
            dynamic_axes={
                "input_ids": {0: "b", 1: "t"},
                "hidden": {0: "b"},
                "logits": {0: "b", 1: "t"},
            },
        )
        shutil.copy(enc, dst / "encoder.onnx")  # at half precision the CPU runs it 2.4x slower
        quantize_dynamic(str(dec), str(dst / "decoder.onnx"), weight_type=QuantType.QInt8)
        tokens = proc.tokenizer.convert_ids_to_tokens(list(range(len(proc.tokenizer))))
        (dst / "vocab.json").write_text(json.dumps({"tokens": tokens, "start": start, "eos": eos}))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        tmp = pathlib.Path(t)
        doctr(tmp)
        paddle()
        easyocr(tmp)
        trocr(tmp)
    total = sum(f.stat().st_size for f in OUT.rglob("*.onnx"))
    print(f"wrote {OUT} ({total / 1e9:.1f} GB)")


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    main()
