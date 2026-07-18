"""Optional M9 DeBERTa semantic detector.

It keeps the frozen detector contracts untouched: documents receive a single
department classification while individual confident sentences become real
``DEPT_CONFIDENTIAL`` spans for the existing policy engine and vault.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Callable, Iterator

from app.detect.base import Document, Span

MODEL_NAME = "microsoft/deberta-v3-small"
DEPARTMENT_LABELS = frozenset({"finance", "hr", "legal", "engineering", "other"})
_SENTENCE_BREAK = re.compile(r"(?:\r?\n)+|(?<=[.!?])\s+")
SentencePredictor = Callable[[str], tuple[str, float]]


def _read_threshold(value: str | None) -> float:
    threshold = float(value or "0.65")
    if not 0.0 < threshold < 1.0:
        raise ValueError("M9_CONFIDENCE_THRESHOLD must be between 0 and 1.")
    return threshold


class DebertaDetector:
    """Classify document sentences with a saved fine-tuned DeBERTa model.

    ``predictor`` exists only as a dependency-injection seam for fast unit
    tests; production creates this class without it and loads artifacts once.
    """

    def __init__(
        self,
        model_path: Path | None = None,
        threshold: float | None = None,
        predictor: SentencePredictor | None = None,
        tokenizer: Any | None = None,
        model: Any | None = None,
        torch_module: Any | None = None,
        device: Any | None = None,
    ) -> None:
        self.threshold = threshold if threshold is not None else _read_threshold(
            os.getenv("M9_CONFIDENCE_THRESHOLD")
        )
        if not 0.0 < self.threshold < 1.0:
            raise ValueError("M9 confidence threshold must be between 0 and 1.")
        self.model_path = model_path or Path(
            os.getenv("M9_MODEL_DIR", str(Path(__file__).resolve().parents[2] / "artifacts" / "deberta-m9-detector"))
        )
        self._predictor = predictor
        self._tokenizer = tokenizer
        self._model = model
        self._torch = torch_module
        self._device = device
        self._id_to_label: dict[int, str] = {}

        if predictor is None:
            self._load_model()

    def _load_model(self) -> None:
        if not self.model_path.exists():
            raise FileNotFoundError(
                f"M9 model artifacts are missing at {self.model_path}. "
                "Run 'python -m ml.m9_train' from backend first."
            )
        try:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError("M9 requires torch and transformers. Install backend/requirements.txt.") from exc

        self._torch = torch
        self._device = self._device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._tokenizer = self._tokenizer or AutoTokenizer.from_pretrained(self.model_path)
        self._model = self._model or AutoModelForSequenceClassification.from_pretrained(self.model_path)
        self._model.to(self._device)
        self._model.eval()
        self._id_to_label = {
            int(index): str(label).lower() for index, label in self._model.config.id2label.items()
        }
        if set(self._id_to_label.values()) != DEPARTMENT_LABELS:
            raise ValueError(
                "M9 model label mapping must exactly contain finance, hr, legal, engineering and other."
            )

    @staticmethod
    def _sentences(text: str) -> Iterator[tuple[int, int, str]]:
        """Yield non-empty, trimmed sentences and their original offsets."""
        start = 0
        for separator in _SENTENCE_BREAK.finditer(text):
            yield from DebertaDetector._trimmed_sentence(text, start, separator.start())
            start = separator.end()
        yield from DebertaDetector._trimmed_sentence(text, start, len(text))

    @staticmethod
    def _trimmed_sentence(text: str, start: int, end: int) -> Iterator[tuple[int, int, str]]:
        fragment = text[start:end]
        left_trimmed = len(fragment) - len(fragment.lstrip())
        right_trimmed = len(fragment.rstrip())
        sentence_start, sentence_end = start + left_trimmed, start + right_trimmed
        if sentence_start < sentence_end:
            yield sentence_start, sentence_end, text[sentence_start:sentence_end]

    def _predict(self, sentence: str) -> tuple[str, float]:
        if self._predictor is not None:
            label, confidence = self._predictor(sentence)
        else:
            assert self._torch is not None and self._tokenizer is not None and self._model is not None
            encoded = self._tokenizer(sentence, return_tensors="pt", truncation=True, max_length=256)
            encoded = {key: value.to(self._device) for key, value in encoded.items()}
            with self._torch.inference_mode():
                probabilities = self._torch.softmax(self._model(**encoded).logits[0], dim=-1)
            confidence, label_id = self._torch.max(probabilities, dim=-1)
            label = self._id_to_label[int(label_id.item())]
            confidence = float(confidence.item())
        normalized = label.lower().strip()
        if normalized not in DEPARTMENT_LABELS:
            raise ValueError(f"M9 predictor returned unsupported label {label!r}.")
        return normalized, float(confidence)

    def classify(self, doc: Document) -> tuple[str | None, float]:
        """Return the highest-confidence confidential department in a document."""
        best_label: str | None = None
        best_confidence = 0.0
        for _start, _end, sentence in self._sentences(doc.text):
            label, confidence = self._predict(sentence)
            if label != "other" and confidence >= self.threshold and confidence > best_confidence:
                best_label, best_confidence = label, confidence
        return best_label, best_confidence

    def detect(self, doc: Document) -> list[Span]:
        """Convert confident sensitive sentences into offset-correct policy spans."""
        spans: list[Span] = []
        for start, end, sentence in self._sentences(doc.text):
            label, confidence = self._predict(sentence)
            if label != "other" and confidence >= self.threshold:
                spans.append(Span(
                    start=start, end=end, data_class="DEPT_CONFIDENTIAL",
                    detector="deberta", confidence=confidence,
                ))
        return spans

