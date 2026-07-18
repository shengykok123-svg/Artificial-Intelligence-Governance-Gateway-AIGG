"""Unit tests for the M1 mock plane itself, independent of the API."""

from __future__ import annotations

import base64

import pytest

from app.detect.base import Classification, Document, Span
from app.mocks import (
    MockEmbedDetector,
    MockRulesDetector,
    MockTokeniser,
    mock_decide,
)
from app.policy.engine import PolicyContext
from app.repo.memory import InMemoryVaultRepo
from app.vault.tokeniser import Forbidden

CTX = PolicyContext(user_role="staff", department="hr", ai_tool_tier="PUBLIC_AI",
                    tool_status="approved", purpose="GENERAL",
                    target_host="chatgpt.com")


def test_rules_detector_finds_real_offsets() -> None:
    text = "prefix 880412-08-5561 suffix"
    doc = Document(text=text, source_filename=None, mime="text/plain")
    spans = MockRulesDetector().detect(doc)
    assert len(spans) == 1
    span = spans[0]
    assert span.data_class == "MYKAD"
    assert text[span.start:span.end] == "880412-08-5561"


def test_embed_detector_is_honestly_empty() -> None:
    doc = Document(text="anything", source_filename=None, mime="text/plain")
    assert MockEmbedDetector().detect(doc) == []
    assert MockEmbedDetector().classify(doc) == (None, 0.0)


def test_decide_strictest_wins_and_ignores_rules() -> None:
    c = Classification(data_classes=["SALARY", "MYKAD"], confidence=1.0,
                       spans=[], content_department=None,
                       department_confidence=0.0)
    verdict = mock_decide(c, CTX, rules=[])
    assert verdict.decision == "hold"   # SALARY (hold) outranks MYKAD (redact)


def test_tokeniser_right_to_left_preserves_earlier_spans() -> None:
    vault = InMemoryVaultRepo()
    text = "A 880412-08-5561 and B RM 8,500 end."
    a_start = text.index("880412-08-5561")
    b_start = text.index("RM 8,500")
    spans = [
        Span(start=a_start, end=a_start + len("880412-08-5561"),
             data_class="MYKAD", detector="rules", confidence=1.0),
        Span(start=b_start, end=b_start + len("RM 8,500"),
             data_class="SALARY", detector="rules", confidence=1.0),
    ]
    tokeniser = MockTokeniser(vault)
    redacted, map_id = tokeniser.tokenise(text, spans)

    assert redacted == "A [MYKAD_1] and B [SALARY_1] end."
    assert "880412-08-5561" not in redacted
    assert "RM 8,500" not in redacted

    restored = tokeniser.detokenise(map_id, redacted, requester_role="admin")
    assert restored == text


def test_tokeniser_numbers_per_label_from_one() -> None:
    vault = InMemoryVaultRepo()
    text = "x@a.com and y@b.com"
    spans = [
        Span(start=0, end=7, data_class="EMAIL", detector="rules", confidence=1.0),
        Span(start=12, end=19, data_class="EMAIL", detector="rules", confidence=1.0),
    ]
    redacted, _ = MockTokeniser(vault).tokenise(text, spans)
    assert redacted == "[EMAIL_1] and [EMAIL_2]"


def test_detokenise_forbidden_for_non_admin() -> None:
    vault = InMemoryVaultRepo()
    tokeniser = MockTokeniser(vault)
    redacted, map_id = tokeniser.tokenise(
        "IC 880412-08-5561",
        [Span(start=3, end=17, data_class="MYKAD", detector="rules", confidence=1.0)],
    )
    with pytest.raises(Forbidden):
        tokeniser.detokenise(map_id, redacted, requester_role="staff")
