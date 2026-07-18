"""M5 file text extraction.

extract(filename, mime, content_b64) -> Document. Produces IF-4. Raises
UnsupportedFile -> 415.
"""

from __future__ import annotations

import base64
import binascii
import io
from collections.abc import Callable

import pdfplumber
from docx import Document as DocxDocument
from pptx import Presentation

from app.detect.base import Document

MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024


class UnsupportedFile(Exception):
    """Raised for a filename/mime extract() cannot handle. Mapped to 415."""


def extract(filename: str, mime: str, content_b64: str) -> Document:
    raw = _decode_content(filename, content_b64)
    extractor = _extractor_for(filename, mime)
    text = extractor(raw)
    return Document(text=text, source_filename=filename, mime=mime)


def _decode_content(filename: str, content_b64: str) -> bytes:
    try:
        raw = base64.b64decode(content_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise UnsupportedFile(f"invalid base64 (filename={filename!r})") from exc

    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise UnsupportedFile(f"file too large (filename={filename!r})")
    return raw


def _extractor_for(filename: str, mime: str) -> Callable[[bytes], str]:
    normalised_mime = mime.lower().split(";")[0].strip()
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if normalised_mime in {"text/plain", "text/csv"} or ext in {"txt", "csv"}:
        return _extract_text
    if normalised_mime == "application/pdf" or ext == "pdf":
        return _extract_pdf
    if (
        normalised_mime
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or ext == "docx"
    ):
        return _extract_docx
    if (
        normalised_mime
        == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        or ext == "pptx"
    ):
        return _extract_pptx

    raise UnsupportedFile(f"{mime} (filename={filename!r})")


def _extract_text(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UnsupportedFile("text attachment is not valid UTF-8") from exc


def _extract_pdf(raw: bytes) -> str:
    try:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages)
    except Exception as exc:
        raise UnsupportedFile("PDF text could not be extracted") from exc


def _extract_docx(raw: bytes) -> str:
    try:
        doc = DocxDocument(io.BytesIO(raw))
    except Exception as exc:
        raise UnsupportedFile("DOCX text could not be extracted") from exc

    parts = [p.text for p in doc.paragraphs if p.text]
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append("\t".join(cells))
    return "\n".join(parts)


def _extract_pptx(raw: bytes) -> str:
    try:
        deck = Presentation(io.BytesIO(raw))
    except Exception as exc:
        raise UnsupportedFile("PPTX text could not be extracted") from exc

    parts: list[str] = []
    for slide in deck.slides:
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text:
                parts.append(shape.text)
    return "\n".join(parts)


__all__ = ["MAX_ATTACHMENT_BYTES", "UnsupportedFile", "extract"]
