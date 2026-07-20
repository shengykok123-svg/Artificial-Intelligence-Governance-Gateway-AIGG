"""M8 embedding similarity for department and confidential-content signals."""

from __future__ import annotations

import os
import re
from typing import Protocol

import numpy as np

from app.detect.base import Document, Span
from app.repo.base import InternalDocRepo

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
PGVECTOR_TOP_K = 5
_SENTENCE_RE = re.compile(r"[^.!?\n]+(?:[.!?]+|$)")


def _read_threshold(value: str | None, default: float, name: str) -> float:
    threshold = float(value) if value else default
    if not 0.0 < threshold < 1.0:
        raise ValueError(f"{name} must be between 0 and 1.")
    return threshold


# M8's confidence is a cosine similarity -- NOT the same scale as M9's joint
# head probability. SPAN_THRESHOLD calibrates when M8 emits a redaction span;
# classify() itself carries no threshold, so the rule table's min_confidence
# tiers are what decide whether a reported score turns into a verdict.
SPAN_THRESHOLD = _read_threshold(os.getenv("M8_SPAN_THRESHOLD"), 0.72, "M8_SPAN_THRESHOLD")


class Encoder(Protocol):
    def encode(self, texts: list[str], *, normalize_embeddings: bool) -> np.ndarray: ...


class EmbedDetector:
    """Classify department content against indexed internal-document chunks.

    M8 complements, but never replaces, M2. Structured personal data remains
    M2's job; M8 only emits DEPT_CONFIDENTIAL for semantic content.
    """

    def __init__(
        self,
        encoder: Encoder | None = None,
        internal_docs: InternalDocRepo | None = None,
    ) -> None:
        self._encoder = encoder or self._load_default_encoder()
        self._internal_docs = internal_docs
        if self._internal_docs is None:
            raise RuntimeError("M8 requires a PostgreSQL pgvector internal document repository.")

    def detect(self, doc: Document) -> list[Span]:
        spans: list[Span] = []
        for match in _SENTENCE_RE.finditer(doc.text):
            text = match.group().strip()
            if not text:
                continue
            left = match.start() + len(match.group()) - len(match.group().lstrip())
            score = self._best(text)[1]
            if score >= SPAN_THRESHOLD:
                spans.append(Span(
                    start=left,
                    end=left + len(text),
                    data_class="DEPT_CONFIDENTIAL",
                    detector="embed",
                    confidence=score,
                ))
        return spans

    def classify(self, doc: Document) -> tuple[str | None, float]:
        """Return the closest indexed chunk's department and raw cosine
        similarity, with no threshold gate -- unlike detect(), which only
        emits a span once a sentence clears SPAN_THRESHOLD, classify() always
        reports M8's exact score so it is visible even when it never clears
        that bar. None only when there is no indexed chunk to compare against
        at all (empty corpus or empty text)."""
        if not doc.text.strip():
            return None, 0.0
        department, score = self._best(doc.text)
        return (department or None), score

    def _best(self, text: str) -> tuple[str, float]:
        vector = np.asarray(
            self._encoder.encode([text], normalize_embeddings=True)[0], dtype=float,
        )
        match = self._best_internal_chunk(vector)
        if match is None:
            return "", 0.0
        return match

    def _best_internal_chunk(self, vector: np.ndarray) -> tuple[str, float] | None:
        matches = self._internal_docs.search_similar(
            [float(value) for value in vector.tolist()],
            limit=PGVECTOR_TOP_K,
        )
        if not matches:
            return None
        best = matches[0]
        return best.department, best.similarity

    @staticmethod
    def _load_default_encoder() -> Encoder:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "sentence-transformers is required when M8 is enabled"
            ) from exc
        return SentenceTransformer(MODEL_NAME, local_files_only=True)


__all__ = ["EmbedDetector"]
