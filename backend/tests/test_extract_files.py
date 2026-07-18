from __future__ import annotations

import base64
import io

import pytest
from docx import Document as DocxDocument
from pptx import Presentation

from app.extract.files import MAX_ATTACHMENT_BYTES, UnsupportedFile, extract


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def test_extract_text_plain() -> None:
    doc = extract("note.txt", "text/plain", b64(b"My IC is 880412-08-5561"))
    assert doc.text == "My IC is 880412-08-5561"
    assert doc.source_filename == "note.txt"
    assert doc.mime == "text/plain"


def test_extract_csv_as_utf8_text() -> None:
    doc = extract("payroll.csv", "text/csv", b64(b"name,salary\nAli,RM 8,500"))
    assert "RM 8,500" in doc.text


def test_extract_docx_paragraphs_and_tables() -> None:
    source = DocxDocument()
    source.add_paragraph("Employee IC 880412-08-5561")
    table = source.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "salary"
    table.cell(0, 1).text = "RM 8,500"
    buf = io.BytesIO()
    source.save(buf)

    doc = extract(
        "employee.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        b64(buf.getvalue()),
    )

    assert "Employee IC 880412-08-5561" in doc.text
    assert "salary\tRM 8,500" in doc.text


def test_extract_pptx_text_shapes() -> None:
    deck = Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[5])
    slide.shapes.title.text = "Quarterly revenue is below forecast."
    buf = io.BytesIO()
    deck.save(buf)

    doc = extract(
        "finance.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        b64(buf.getvalue()),
    )

    assert "Quarterly revenue is below forecast." in doc.text


def test_extract_pdf_rejects_invalid_pdf() -> None:
    with pytest.raises(UnsupportedFile):
        extract("broken.pdf", "application/pdf", b64(b"not a pdf"))


def test_unsupported_file_type() -> None:
    with pytest.raises(UnsupportedFile):
        extract("image.png", "image/png", b64(b"whatever"))


def test_invalid_base64() -> None:
    with pytest.raises(UnsupportedFile):
        extract("note.txt", "text/plain", "not-base64")


def test_size_limit() -> None:
    too_large = b64(b"x" * (MAX_ATTACHMENT_BYTES + 1))
    with pytest.raises(UnsupportedFile):
        extract("large.txt", "text/plain", too_large)
