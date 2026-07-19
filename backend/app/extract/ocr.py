from __future__ import annotations

import csv
import io
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image, ImageDraw

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


def ocr_image_bytes(raw: bytes) -> OcrResult:
    with Image.open(io.BytesIO(raw)) as image:
        return _ocr_image(image.convert("RGB"))


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
        output = image.convert("RGB")
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

    with tempfile.TemporaryDirectory() as tmp:
        image_path = Path(tmp) / "input.png"
        image.save(image_path)
        proc = subprocess.run(
            [tesseract_exe, str(image_path), "stdout", "--psm", "6", "tsv"],
            check=True,
            capture_output=True,
            text=True,
        )

    words: list[OcrWord] = []
    cursor = 0
    for row in csv.DictReader(io.StringIO(proc.stdout), delimiter="\t"):
        text = (row.get("text") or "").strip()
        if not text:
            continue
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

    return OcrResult(text=" ".join(word.text for word in words), words=words)


def _overlaps_any(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(start < span_end and span_start < end for span_start, span_end in spans)


__all__ = ["DEFAULT_TESSERACT_EXE", "OcrResult", "OcrWord", "ocr_image_bytes", "ocr_pdf_bytes", "redact_image_bytes"]
