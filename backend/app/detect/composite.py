"""SEMANTIC-BOTH: M8 (embedding similarity) and M9 (DeBERTa) run in parallel
behind the single semantic-detector protocol (Detector + DocumentClassifier).
Every inspect() call site takes ONE object satisfying that protocol, so this
is the whole integration -- zero call-site changes anywhere else.

M8 and M9 are complementary, not interchangeable: M8 answers "does this
resemble one of OUR documents" (specific-document leakage), M9 answers "is
this text confidential in nature" (even when it matches nothing in the
index). Both emit ONLY data_class="DEPT_CONFIDENTIAL" (see app/detect/base.py),
which is the only case this module's dedup logic needs to handle.
"""

from __future__ import annotations

import logging
import time
from typing import Protocol

from app.detect.base import Document, Span

logger = logging.getLogger(__name__)


class _SemanticSubDetector(Protocol):
    """What CompositeSemanticDetector actually needs from each half. Matches
    EmbedDetector, DebertaDetector, and any test stub with the same shape --
    duck typing, not an isinstance check, so tests never need real models."""

    def detect(self, doc: Document) -> list[Span]: ...
    def classify(self, doc: Document) -> tuple[str | None, float]: ...


def dedup_overlapping(spans: list[Span]) -> list[Span]:
    """Collapse overlapping same-data_class spans into one.

    Two spans overlap when `a.start < b.end and b.start < a.end`. Within an
    overlapping cluster the higher-confidence span wins; a confidence tie
    keeps the wider range. Spans of different data_class never merge, even
    if their character ranges overlap. Without this, M7 would tokenise the
    same sentence twice with two overlapping, mutually-corrupting
    replacements whenever both detectors fire on it.

    Pure and detector-agnostic: sort by start, sweep. Transitive -- if A
    overlaps B and B overlaps C, all three collapse into one span, since
    that is what "one merged range" means once A and C are both inside it.
    """
    by_class: dict[str, list[Span]] = {}
    for span in spans:
        by_class.setdefault(span.data_class, []).append(span)

    result: list[Span] = []
    for class_spans in by_class.values():
        ordered = sorted(class_spans, key=lambda s: (s.start, s.end))
        cluster: list[Span] = []
        cluster_end = -1
        for span in ordered:
            if cluster and span.start < cluster_end:
                cluster.append(span)
                cluster_end = max(cluster_end, span.end)
            else:
                if cluster:
                    result.append(_pick_winner(cluster))
                cluster = [span]
                cluster_end = span.end
        if cluster:
            result.append(_pick_winner(cluster))

    return sorted(result, key=lambda s: s.start)


def _pick_winner(cluster: list[Span]) -> Span:
    # Higher confidence first; a tie keeps the wider range. max() keeps the
    # first item on a full tie, which is deterministic given a stable sort.
    return max(cluster, key=lambda s: (s.confidence, s.end - s.start))


# classify() fusion no longer picks "whichever confidence is higher" -- M8's
# cosine similarity and M9's joint softmax probability are different scales,
# so a raw confidence race silently favours whichever detector happens to run
# hotter. Fusion is explainability-precedence instead: agreement -> the
# higher confidence of the two (they already agree, so take the stronger
# signal); disagreement -> M8 wins, because "this resembles indexed document
# X" points a reviewer at a concrete artefact while a bare softmax label does
# not; M8 null/general -> adopt M9 so a document with no indexed match can
# still be flagged confidential in nature.
_NULL_DEPARTMENTS = {None, "", "other", "general"}


def _normalize_department(department: str | None) -> str | None:
    return None if department in _NULL_DEPARTMENTS else department


class CompositeSemanticDetector:
    """M8 + M9 in parallel behind the single semantic-detector protocol.
    Union of spans with overlap dedup; classify() = explainability-precedence
    fusion (see classify_debug)."""

    def __init__(self, embed: _SemanticSubDetector, deberta: _SemanticSubDetector) -> None:
        self._embed = embed
        self._deberta = deberta

    def detect(self, doc: Document) -> list[Span]:
        t0 = time.perf_counter()
        embed_spans = self._embed.detect(doc)
        t1 = time.perf_counter()
        deberta_spans = self._deberta.detect(doc)
        t2 = time.perf_counter()

        deduped = dedup_overlapping(embed_spans + deberta_spans)

        logger.debug(
            "[semantic] embed=%dms deberta=%dms spans_embed=%d spans_deberta=%d deduped=%d",
            round((t1 - t0) * 1000), round((t2 - t1) * 1000),
            len(embed_spans), len(deberta_spans), len(deduped),
        )
        return deduped

    def classify(self, doc: Document) -> tuple[str | None, float]:
        fused, _m8_raw, _m9_raw = self.classify_debug(doc)
        return fused

    def classify_debug(
        self, doc: Document,
    ) -> tuple[
        tuple[str | None, float], tuple[str | None, float], tuple[str | None, float],
    ]:
        """(fused, m8_raw, m9_raw). Raw outputs are each sub-detector's
        classify() verbatim -- audit logging wants what M8 and M9 actually
        said, not the normalized view fusion uses to compare them. Runs each
        model exactly once so main.py never pays for a second inference just
        to log what the first one produced."""
        m8_raw = self._embed.classify(doc)
        m9_raw = self._deberta.classify(doc)

        m8_dept = _normalize_department(m8_raw[0])
        m9_dept = _normalize_department(m9_raw[0])

        if m8_dept is not None and m8_dept == m9_dept:
            fused = (m8_dept, max(m8_raw[1], m9_raw[1]))
        elif m8_dept is not None:
            fused = (m8_dept, m8_raw[1])
        elif m9_dept is not None:
            fused = (m9_dept, m9_raw[1])
        else:
            fused = (None, 0.0)

        return fused, m8_raw, m9_raw


__all__ = ["CompositeSemanticDetector", "dedup_overlapping"]
