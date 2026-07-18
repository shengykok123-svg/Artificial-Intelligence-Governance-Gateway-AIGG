# M5  extract(filename, mime, content_b64) -> Document. Produces IF-4. Raises UnsupportedFile -> 415.
#
# UnsupportedFile is added by M1: mock_extract (app/mocks.py) and main.py's
# exception handler both need the SAME class, so it lives here -- the one
# place M5's real extract() will also raise it from. M1 does not implement
# extract() itself; that stays M5's job.

from __future__ import annotations


class UnsupportedFile(Exception):
    """Raised for a filename/mime extract() cannot handle. Mapped to 415."""


import base64
import io

from app.detect.base import Document

_MAX_BYTES = 5 * 1024 * 1024  # 5 MB, checked on the DECODED content


def extract(filename: str, mime: str, content_b64: str) -> Document:
    """Turn an uploaded attachment into a flat-text Document (IF-4).

    Dispatch is on the filename EXTENSION, not `mime`: browsers routinely
    send application/octet-stream (or nothing) for .docx/.pptx, and
    mime-first dispatch would 415 perfectly valid files. `mime` is only
    echoed back into Document.mime -- detectors never read it.

    Every uploaded file is treated as hostile: parsing happens on in-memory
    bytes only (never written to disk, never handed a path or URL), only
    visible text is pulled (no OCR, no macros, no remote references), and
    any failure -- bad base64, a truncated/corrupt file, an unhandled
    parser error -- degrades to UnsupportedFile (-> clean 415) instead of
    an unhandled 500.
    """
    try:
        content = base64.b64decode(content_b64, validate=True)
    except Exception as exc:
        raise UnsupportedFile(
            f"invalid base64 payload (filename={filename!r})"
        ) from exc

    # Size cap is checked BEFORE any parsing. It is also the main defence
    # against zip-bomb / XML entity expansion in the OOXML (.docx/.pptx)
    # and PDF paths -- proper XXE/zip-bomb hardening (e.g. disabling
    # external entity resolution explicitly) is post-MVP; bounding the
    # decoded size bounds the blast radius in the meantime.
    if len(content) > _MAX_BYTES:
        raise UnsupportedFile(
            f"{filename!r} is {len(content)} bytes, exceeds the "
            f"{_MAX_BYTES}-byte extraction cap"
        )

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    try:
        if ext == "pdf":
            text = _extract_pdf(content)
        elif ext == "docx":
            text = _extract_docx(content)
        elif ext == "pptx":
            text = _extract_pptx(content)
        elif ext == "csv":
            text = _extract_csv(content)
        elif ext == "txt":
            text = content.decode("utf-8", errors="replace")
        else:
            raise UnsupportedFile(
                f"unsupported file extension {ext!r} (filename={filename!r})"
            )
    except UnsupportedFile:
        raise
    except Exception as exc:
        raise UnsupportedFile(
            f"could not parse {filename!r} as .{ext}: {exc}"
        ) from exc

    return Document(text=text, source_filename=filename, mime=mime)


def _extract_pdf(content: bytes) -> str:
    import pdfplumber

    pages: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            # extract_text() returns None for an image-only page -- we do
            # not OCR, so that page contributes no text.
            pages.append(page.extract_text() or "")
    return "\n\n".join(pages)


def _extract_docx(content: bytes) -> str:
    import docx

    document = docx.Document(io.BytesIO(content))
    parts: list[str] = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)


def _extract_pptx(content: bytes) -> str:
    from pptx import Presentation

    presentation = Presentation(io.BytesIO(content))
    parts: list[str] = []
    for slide in presentation.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                parts.append(shape.text_frame.text)
        if slide.has_notes_slide:
            parts.append(slide.notes_slide.notes_text_frame.text)
    return "\n".join(parts)


def _extract_csv(content: bytes) -> str:
    import pandas as pd

    df = pd.read_csv(
        io.StringIO(content.decode("utf-8", errors="replace")),
        dtype=str, keep_default_na=False,
    )
    parts: list[str] = list(df.columns)
    for row in df.itertuples(index=False):
        parts.extend(str(value) for value in row)
    return " ".join(parts)


if __name__ == "__main__":
    import mimetypes
    import sys
    from pathlib import Path

    path = Path(sys.argv[1])
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    guessed_mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    print(extract(path.name, guessed_mime, encoded).text)
