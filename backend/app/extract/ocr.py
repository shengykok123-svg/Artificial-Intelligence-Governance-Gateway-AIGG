from __future__ import annotations

import csv
import io
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageFilter, ImageOps

DEFAULT_TESSERACT_EXE = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


@dataclass(frozen=True)
class OcrWord:
    text: str
    start: int
    end: int
    left: int
    top: int
    width: int
    height: int


@dataclass(frozen=True)
class OcrResult:
    text: str
    words: list[OcrWord]


@dataclass(frozen=True)
class _CandidateResult:
    result: OcrResult
    score: float


def ocr_image_bytes(raw: bytes) -> OcrResult:
    with Image.open(io.BytesIO(raw)) as image:
        return _ocr_image(ImageOps.exif_transpose(image).convert("RGB"))


def ocr_pdf_bytes(raw: bytes) -> str:
    parts: list[str] = []
    pdf = pdfium.PdfDocument(raw)
    try:
        for page in pdf:
            bitmap = page.render(scale=2)
            image = bitmap.to_pil().convert("RGB")
            text = _ocr_image(image).text
            if text:
                parts.append(text)
    finally:
        pdf.close()
    return "\n".join(parts)


def redact_image_bytes(raw: bytes, result: OcrResult, spans: list[tuple[int, int]]) -> bytes:
    with Image.open(io.BytesIO(raw)) as image:
        output = ImageOps.exif_transpose(image).convert("RGB")
    draw = ImageDraw.Draw(output)
    for word in result.words:
        if not _overlaps_any(word.start, word.end, spans):
            continue
        pad = 3
        draw.rectangle(
            [
                max(0, word.left - pad),
                max(0, word.top - pad),
                word.left + word.width + pad,
                word.top + word.height + pad,
            ],
            fill="black",
        )
    buf = io.BytesIO()
    output.save(buf, format="PNG")
    return buf.getvalue()


def _ocr_image(image: Image.Image) -> OcrResult:
    tesseract_exe = os.getenv("TESSERACT_EXE", DEFAULT_TESSERACT_EXE)
    if not Path(tesseract_exe).exists():
        raise RuntimeError(f"Tesseract executable was not found at {tesseract_exe!r}")

    candidates: list[_CandidateResult] = []
    for idx, candidate in enumerate(_preprocess_candidates(image)):
        for psm in ("6", "11", "12"):
            try:
                candidates.append(_run_tesseract(tesseract_exe, candidate, idx, psm))
            except subprocess.CalledProcessError:
                continue

    if not candidates:
        return OcrResult(text="", words=[])
    return max(candidates, key=lambda item: item.score).result


def _preprocess_candidates(image: Image.Image) -> list[Image.Image]:
    gray = ImageOps.grayscale(image)
    enhanced = ImageOps.autocontrast(gray).filter(ImageFilter.SHARPEN)
    threshold = enhanced.point(lambda pixel: 255 if pixel > 175 else 0, mode="1").convert("L")
    return [image.convert("RGB"), enhanced.convert("RGB"), threshold.convert("RGB")]


def _run_tesseract(tesseract_exe: str, image: Image.Image, idx: int, psm: str) -> _CandidateResult:
    with tempfile.TemporaryDirectory() as tmp:
        image_path = Path(tmp) / f"input-{idx}-{psm}.png"
        image.save(image_path)
        proc = subprocess.run(
            [tesseract_exe, str(image_path), "stdout", "--psm", psm, "tsv"],
            check=True,
            capture_output=True,
            text=True,
        )
    result, avg_conf = _parse_tsv(proc.stdout)
    text_weight = sum(1 for char in result.text if char.isalnum())
    return _CandidateResult(result=result, score=(avg_conf * 2.0) + text_weight)


def _parse_tsv(tsv: str) -> tuple[OcrResult, float]:
    words: list[OcrWord] = []
    confidences: list[float] = []
    cursor = 0
    for row in csv.DictReader(io.StringIO(tsv), delimiter="\t"):
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            conf = float(row.get("conf") or -1)
        except ValueError:
            conf = -1
        if conf >= 0:
            confidences.append(conf)
        start = cursor
        end = start + len(text)
        words.append(
            OcrWord(
                text=text,
                start=start,
                end=end,
                left=int(row["left"]),
                top=int(row["top"]),
                width=int(row["width"]),
                height=int(row["height"]),
            )
        )
        cursor = end + 1

    result = OcrResult(text=" ".join(word.text for word in words), words=words)
    avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
    return result, avg_conf


def _overlaps_any(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(start < span_end and span_start < end for span_start, span_end in spans)


__all__ = ["DEFAULT_TESSERACT_EXE", "OcrResult", "OcrWord", "ocr_image_bytes", "ocr_pdf_bytes", "redact_image_bytes"]
