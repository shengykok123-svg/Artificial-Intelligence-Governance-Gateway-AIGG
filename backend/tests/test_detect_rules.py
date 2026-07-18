from pathlib import Path

import pytest

from app.detect.base import Document
from app.detect.rules import RulesDetector


def _doc(text: str) -> Document:
    return Document(text=text, source_filename=None, mime="text/plain")


@pytest.mark.parametrize(("text", "data_class", "value"), [
    ("MyKad 880412-08-5561", "MYKAD", "880412-08-5561"),
    ("Email siti.abdullah@acme.my", "EMAIL", "siti.abdullah@acme.my"),
    ("Call 012-3456789", "PHONE", "012-3456789"),
    ("Maybank account no. 5142 8890 3312", "BANK_ACCT", "5142 8890 3312"),
    ("Gaji bulanan RM 8,500", "SALARY", "RM 8,500"),
    ("OPENAI_API_KEY=sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d", "SECRET",
     "sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d"),
    ("Draft a reply for Puan Nurul", "PERSON", "Puan Nurul"),
])
def test_detects_each_structured_class_with_real_offsets(
    text: str, data_class: str, value: str,
) -> None:
    span = next(s for s in RulesDetector().detect(_doc(text)) if s.data_class == data_class)
    assert text[span.start:span.end] == value
    assert span.detector == "rules"
    assert span.confidence == 1.0


@pytest.mark.parametrize("text", [
    "Reference 880412085561 has no MyKad separators.",
    "Please send a draft to name@localhost.",
    "The budget is RM eight thousand five hundred.",
])
def test_does_not_flag_near_misses(text: str) -> None:
    assert RulesDetector().detect(_doc(text)) == []


def test_detects_repeated_values_and_keeps_offsets_stable() -> None:
    text = "Email a@acme.my, then a@acme.my again."
    spans = RulesDetector().detect(_doc(text))
    assert [text[s.start:s.end] for s in spans] == ["a@acme.my", "a@acme.my"]


def test_realistic_malaysian_fixture_has_expected_classes_and_offsets() -> None:
    fixture = Path(__file__).parent / "fixtures" / "malaysian_enterprise_text.txt"
    text = fixture.read_text()
    spans = RulesDetector().detect(_doc(text))
    found = {(span.data_class, text[span.start:span.end]) for span in spans}
    assert {
        ("PERSON", "Encik Rahman"),
        ("EMAIL", "rahman@acme.my"),
        ("PHONE", "012-3456789"),
        ("MYKAD", "880412-08-5561"),
        ("BANK_ACCT", "5142 8890 3312"),
        ("SALARY", "RM 8,500"),
        ("SECRET", "sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d"),
    }.issubset(found)
