# SEMANTIC-BOTH  Pure tests for CompositeSemanticDetector / dedup_overlapping.
# No model, no DB -- stub detectors implementing the Detector +
# DocumentClassifier protocol duck-typed shape.

from __future__ import annotations

from app.detect.base import Document, Span
from app.detect.composite import CompositeSemanticDetector, dedup_overlapping


class StubDetector:
    def __init__(self, spans=None, classification=(None, 0.0)):
        self._spans = spans or []
        self._classification = classification

    def detect(self, doc: Document):
        return self._spans

    def classify(self, doc: Document):
        return self._classification


_DOC = Document(text="x" * 100, source_filename=None, mime="text/plain")


# --------------------------------------------------------------------------
# 1. Union: disjoint spans from both detectors all appear, sorted.
# --------------------------------------------------------------------------

def test_union_of_disjoint_spans_from_both_detectors():
    embed_span = Span(start=50, end=60, data_class="DEPT_CONFIDENTIAL", detector="embed", confidence=0.80)
    deberta_span = Span(start=0, end=10, data_class="DEPT_CONFIDENTIAL", detector="deberta", confidence=0.90)
    composite = CompositeSemanticDetector(
        embed=StubDetector(spans=[embed_span]),
        deberta=StubDetector(spans=[deberta_span]),
    )
    assert composite.detect(_DOC) == [deberta_span, embed_span]


# --------------------------------------------------------------------------
# 2. Dedup keeps higher confidence.
# --------------------------------------------------------------------------

def test_dedup_keeps_higher_confidence():
    embed_span = Span(start=0, end=20, data_class="DEPT_CONFIDENTIAL", detector="embed", confidence=0.74)
    deberta_span = Span(start=5, end=25, data_class="DEPT_CONFIDENTIAL", detector="deberta", confidence=0.91)
    composite = CompositeSemanticDetector(
        embed=StubDetector(spans=[embed_span]),
        deberta=StubDetector(spans=[deberta_span]),
    )
    spans = composite.detect(_DOC)
    assert len(spans) == 1
    assert spans[0].confidence == 0.91
    assert spans[0].detector == "deberta"


# --------------------------------------------------------------------------
# 3. Dedup tie keeps the wider range.
# --------------------------------------------------------------------------

def test_dedup_tie_keeps_wider_span():
    narrow = Span(start=0, end=10, data_class="DEPT_CONFIDENTIAL", detector="embed", confidence=0.80)
    wide = Span(start=0, end=20, data_class="DEPT_CONFIDENTIAL", detector="deberta", confidence=0.80)
    composite = CompositeSemanticDetector(
        embed=StubDetector(spans=[narrow]),
        deberta=StubDetector(spans=[wide]),
    )
    spans = composite.detect(_DOC)
    assert spans == [wide]


# --------------------------------------------------------------------------
# 4. Non-overlapping same-class spans are NOT merged.
# --------------------------------------------------------------------------

def test_non_overlapping_same_class_spans_are_not_merged():
    a = Span(start=0, end=10, data_class="DEPT_CONFIDENTIAL", detector="embed", confidence=0.80)
    b = Span(start=20, end=30, data_class="DEPT_CONFIDENTIAL", detector="deberta", confidence=0.80)
    composite = CompositeSemanticDetector(
        embed=StubDetector(spans=[a]),
        deberta=StubDetector(spans=[b]),
    )
    assert composite.detect(_DOC) == [a, b]


def test_different_data_class_spans_never_merge_even_if_overlapping():
    # Both detectors only ever emit DEPT_CONFIDENTIAL in this codebase, but
    # dedup_overlapping itself must not assume that -- cross-class overlap
    # is never a merge candidate.
    a = Span(start=0, end=20, data_class="DEPT_CONFIDENTIAL", detector="embed", confidence=0.90)
    b = Span(start=5, end=15, data_class="SECRET", detector="rules", confidence=1.0)
    assert dedup_overlapping([a, b]) == [a, b]


# --------------------------------------------------------------------------
# 5. classify(): higher confidence wins; (None, 0.0) loses to any real dept.
# --------------------------------------------------------------------------

def test_classify_picks_higher_confidence_department():
    composite = CompositeSemanticDetector(
        embed=StubDetector(classification=("finance", 0.55)),
        deberta=StubDetector(classification=("hr", 0.80)),
    )
    assert composite.classify(_DOC) == ("hr", 0.80)


def test_classify_none_loses_to_any_real_department():
    composite = CompositeSemanticDetector(
        embed=StubDetector(classification=(None, 0.0)),
        deberta=StubDetector(classification=("legal", 0.45)),
    )
    assert composite.classify(_DOC) == ("legal", 0.45)


# --------------------------------------------------------------------------
# 6. A deduped span still lands in the correct M3 policy tier -- wiring one
#    existing engine test case (see test_policy_engine.py) through the
#    composite path end to end.
# --------------------------------------------------------------------------

def test_deduped_span_still_lands_in_the_correct_policy_tier():
    from app.detect.base import Classification
    from app.policy.engine import PolicyContext, decide
    from app.seed import load_rules_yaml

    embed_span = Span(start=0, end=10, data_class="DEPT_CONFIDENTIAL", detector="embed", confidence=0.70)
    deberta_span = Span(start=0, end=10, data_class="DEPT_CONFIDENTIAL", detector="deberta", confidence=0.91)
    composite = CompositeSemanticDetector(
        embed=StubDetector(spans=[embed_span]),
        deberta=StubDetector(spans=[deberta_span]),
    )
    doc = Document(text="x" * 10, source_filename=None, mime="text/plain")
    spans = composite.detect(doc)
    assert len(spans) == 1
    assert spans[0].confidence == 0.91

    classification = Classification(
        data_classes=["DEPT_CONFIDENTIAL"], confidence=0.91, spans=spans,
        content_department="engineering", department_confidence=0.91,
    )
    ctx = PolicyContext(user_role="staff", department="engineering", ai_tool_tier="PUBLIC_AI",
                        tool_status="approved", purpose="GENERAL", target_host="chatgpt.com")
    verdict = decide(classification, ctx, load_rules_yaml())
    # 0.91 >= the 0.85 tier: redact + require_purpose, not the 0.65 allow tier.
    assert verdict.decision == "redact"
    assert verdict.require_purpose is True
