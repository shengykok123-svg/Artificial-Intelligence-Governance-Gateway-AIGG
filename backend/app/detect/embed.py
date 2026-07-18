"""M8 embedding similarity for department and confidential-content signals."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

import numpy as np
import yaml

from app.detect.base import Document, Span

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
CLASSIFY_THRESHOLD = 0.40
SPAN_THRESHOLD = 0.72
_EXEMPLARS_PATH = Path(__file__).with_name("exemplars.yaml")
_SENTENCE_RE = re.compile(r"[^.!?\n]+(?:[.!?]+|$)")


class Encoder(Protocol):
    def encode(self, texts: list[str], *, normalize_embeddings: bool) -> np.ndarray: ...


class EmbedDetector:
    """Classify department content and flag only high-confidence sentences.

    M8 complements, but never replaces, M2. Structured personal data remains
    M2's job; M8 only emits DEPT_CONFIDENTIAL for semantic content.
    """

    def __init__(self, encoder: Encoder | None = None) -> None:
        self._examples = self._load_examples()
        self._labels = [department for department, _ in self._examples]
        self._encoder = encoder or self._load_default_encoder()
        self._example_vectors = np.asarray(
            self._encoder.encode(
                [text for _, text in self._examples], normalize_embeddings=True,
            ),
            dtype=float,
        )

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
        if not doc.text.strip():
            return None, 0.0
        department, score = self._best(doc.text)
        if score < CLASSIFY_THRESHOLD:
            return None, 0.0
        return department, score

    def _best(self, text: str) -> tuple[str, float]:
        vector = np.asarray(
            self._encoder.encode([text], normalize_embeddings=True)[0], dtype=float,
        )
        scores = self._example_vectors @ vector
        index = int(np.argmax(scores))
        return self._labels[index], float(scores[index])

    @staticmethod
    def _load_examples() -> list[tuple[str, str]]:
        data = yaml.safe_load(_EXEMPLARS_PATH.read_text(encoding="utf-8"))
        departments = data["departments"]
        return [
            (department, example)
            for department, examples in departments.items()
            for example in examples
        ]

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
