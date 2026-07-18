# M5  One fixture per format + size-limit test.

from __future__ import annotations

import base64
from pathlib import Path

import pytest

from app.extract.files import UnsupportedFile, extract

FIXTURES = Path(__file__).parent / "fixtures"


def _b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


@pytest.mark.parametrize(("fixture_name", "mime", "expected"), [
    ("m5_sample.pdf", "application/pdf", "M5_PDF_FIXTURE_TOKEN_9d1c44"),
    ("m5_sample.docx",
     "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
     "M5_DOCX_FIXTURE_TOKEN_5a2b17"),
    ("m5_sample.pptx",
     "application/vnd.openxmlformats-officedocument.presentationml.presentation",
     "M5_PPTX_FIXTURE_TOKEN_3c7a82"),
    ("m5_sample.csv", "text/csv", "M5_CSV_FIXTURE_TOKEN_2b6e1d"),
    ("m5_sample.txt", "text/plain", "M5_TXT_FIXTURE_TOKEN_7f3a9c"),
])
def test_roundtrip_per_format(fixture_name: str, mime: str, expected: str) -> None:
    path = FIXTURES / fixture_name
    doc = extract(path.name, mime, _b64(path))
    assert expected in doc.text
    assert doc.source_filename == path.name
    assert doc.mime == mime


def test_docx_includes_table_cells() -> None:
    path = FIXTURES / "m5_sample.docx"
    doc = extract(path.name, "application/octet-stream", _b64(path))
    assert "M5_DOCX_TABLE_TOKEN_e91c3f" in doc.text


def test_pptx_includes_speaker_notes() -> None:
    path = FIXTURES / "m5_sample.pptx"
    doc = extract(path.name, "application/octet-stream", _b64(path))
    assert "M5_PPTX_NOTES_TOKEN_b48f01" in doc.text


def test_csv_preserves_na_string_and_leading_zeros() -> None:
    path = FIXTURES / "m5_sample.csv"
    doc = extract(path.name, "text/csv", _b64(path))
    assert "NA" in doc.text
    assert "0123" in doc.text


def test_dispatch_is_on_extension_not_mime() -> None:
    """A browser sending octet-stream for a .docx must still work."""
    path = FIXTURES / "m5_sample.docx"
    doc = extract(path.name, "application/octet-stream", _b64(path))
    assert "M5_DOCX_FIXTURE_TOKEN_5a2b17" in doc.text
    assert doc.mime == "application/octet-stream"  # echoed, not corrected


def test_empty_txt_is_not_an_error() -> None:
    doc = extract("empty.txt", "text/plain", base64.b64encode(b"").decode())
    assert doc.text == ""


def test_size_cap_rejects_oversized_content() -> None:
    too_big = b"x" * (5 * 1024 * 1024 + 1)
    b64 = base64.b64encode(too_big).decode()
    with pytest.raises(UnsupportedFile):
        extract("big.txt", "text/plain", b64)


def test_size_cap_allows_content_at_exactly_the_limit() -> None:
    exactly = b"x" * (5 * 1024 * 1024)
    b64 = base64.b64encode(exactly).decode()
    doc = extract("exact.txt", "text/plain", b64)
    assert len(doc.text) == 5 * 1024 * 1024


def test_unsupported_extension_raises() -> None:
    with pytest.raises(UnsupportedFile):
        extract("archive.zip", "application/zip", base64.b64encode(b"PK").decode())


def test_no_extension_raises() -> None:
    with pytest.raises(UnsupportedFile):
        extract("README", "text/plain", base64.b64encode(b"hi").decode())


def test_bad_base64_raises_unsupported_not_crash() -> None:
    with pytest.raises(UnsupportedFile):
        extract("a.txt", "text/plain", "not-valid-base64!!!")


@pytest.mark.parametrize("fixture_name", ["m5_sample.pdf", "m5_sample.docx", "m5_sample.pptx"])
def test_truncated_binary_file_degrades_to_unsupported(fixture_name: str) -> None:
    path = FIXTURES / fixture_name
    truncated = path.read_bytes()[: len(path.read_bytes()) // 2]
    b64 = base64.b64encode(truncated).decode()
    with pytest.raises(UnsupportedFile):
        extract(fixture_name, "application/octet-stream", b64)
