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


class CompositeSemanticDetector:
    """M8 + M9 in parallel behind the single semantic-detector protocol.
    Union of spans with overlap dedup; classify() = the opinion with the
    higher confidence."""

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
        embed_result = self._embed.classify(doc)
        deberta_result = self._deberta.classify(doc)
        # (None, 0.0) always loses to any real department: 0.0 is the floor
        # of the confidence range, so max() by confidence alone is enough.
        return max(embed_result, deberta_result, key=lambda t: t[1])


__all__ = ["CompositeSemanticDetector", "dedup_overlapping"]
