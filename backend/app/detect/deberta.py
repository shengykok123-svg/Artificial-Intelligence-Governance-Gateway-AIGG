"""Optional M9 two-head DeBERTa semantic detector.

The frozen contracts stay untouched. A sentence becomes a `DEPT_CONFIDENTIAL`
span only when the sensitivity head says confidential and the department head
identifies its responsible department.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

from app.detect.base import Document, Span

DEPARTMENT_LABELS = frozenset({"finance", "hr", "legal", "engineering", "other"})
SENSITIVITY_LABELS = frozenset({"confidential", "non_confidential"})
_SENTENCE_BREAK = re.compile(r"(?:\r?\n)+|(?<=[.!?])\s+")


@dataclass(frozen=True)
class SentencePrediction:
    department: str
    department_confidence: float
    is_confidential: bool
    sensitivity_confidence: float

    @property
    def joint_confidence(self) -> float:
        return min(self.department_confidence, self.sensitivity_confidence)


SentencePredictor = Callable[[str], SentencePrediction]


def _read_threshold(value: str | None) -> float:
    threshold = float(value or "0.65")
    if not 0.0 < threshold < 1.0:
        raise ValueError("M9_CONFIDENCE_THRESHOLD must be between 0 and 1.")
    return threshold


class DebertaDetector:
    """Run one shared-encoder, two-head saved M9 model over document sentences."""

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
        self.threshold = threshold if threshold is not None else _read_threshold(os.getenv("M9_CONFIDENCE_THRESHOLD"))
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
        self._department_labels: tuple[str, ...] = ()
        self._sensitivity_labels: tuple[str, ...] = ()
        if predictor is None:
            self._load_model()

    def _load_model(self) -> None:
        if not self.model_path.exists():
            raise FileNotFoundError(
                f"M9 model artifacts are missing at {self.model_path}. Run 'python -m ml.m9_train' from backend first."
            )
        try:
            import torch
            from transformers import AutoTokenizer
            from ml.m9_model import DebertaM9MultiTaskModel
        except ImportError as exc:
            raise RuntimeError("M9 requires torch and transformers. Install backend/requirements.txt.") from exc
        self._torch = torch
        self._device = self._device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._tokenizer = self._tokenizer or AutoTokenizer.from_pretrained(self.model_path)
        self._model = self._model or DebertaM9MultiTaskModel.from_pretrained(self.model_path)
        self._model.to(self._device)
        self._model.eval()
        self._department_labels = tuple(str(label).lower() for label in self._model.config.m9_department_labels)
        self._sensitivity_labels = tuple(str(label).lower() for label in self._model.config.m9_sensitivity_labels)
        if set(self._department_labels) != DEPARTMENT_LABELS or set(self._sensitivity_labels) != SENSITIVITY_LABELS:
            raise ValueError("M9 model labels must contain the expected department and sensitivity labels.")

    @staticmethod
    def _sentences(text: str) -> Iterator[tuple[int, int, str]]:
        start = 0
        for separator in _SENTENCE_BREAK.finditer(text):
            yield from DebertaDetector._trimmed_sentence(text, start, separator.start())
            start = separator.end()
        yield from DebertaDetector._trimmed_sentence(text, start, len(text))

    @staticmethod
    def _trimmed_sentence(text: str, start: int, end: int) -> Iterator[tuple[int, int, str]]:
        fragment = text[start:end]
        sentence_start = start + len(fragment) - len(fragment.lstrip())
        sentence_end = start + len(fragment.rstrip())
        if sentence_start < sentence_end:
            yield sentence_start, sentence_end, text[sentence_start:sentence_end]

    def _predict(self, sentence: str) -> SentencePrediction:
        if self._predictor is not None:
            prediction = self._predictor(sentence)
        else:
            assert self._torch is not None and self._tokenizer is not None and self._model is not None
            encoded = self._tokenizer(sentence, return_tensors="pt", truncation=True, max_length=256)
            encoded = {key: value.to(self._device) for key, value in encoded.items()}
            with self._torch.inference_mode():
                output = self._model(**encoded)
                # Artifacts trained with GPU mixed precision can emit float16
                # logits. Compute probabilities in float32: half-precision
                # softmax may round a value slightly above 1.0 and trip the
                # confidence contract below.
                department_probabilities = self._torch.softmax(output.department_logits[0].float(), dim=-1)
                sensitivity_probabilities = self._torch.softmax(output.sensitivity_logits[0].float(), dim=-1)
            department_confidence, department_id = self._torch.max(department_probabilities, dim=-1)
            sensitivity_confidence, sensitivity_id = self._torch.max(sensitivity_probabilities, dim=-1)
            prediction = SentencePrediction(
                department=self._department_labels[int(department_id.item())],
                department_confidence=float(department_confidence.item()),
                is_confidential=self._sensitivity_labels[int(sensitivity_id.item())] == "confidential",
                sensitivity_confidence=float(sensitivity_confidence.item()),
            )
        if prediction.department not in DEPARTMENT_LABELS:
            raise ValueError(f"M9 predictor returned unsupported department {prediction.department!r}.")
        if not 0.0 <= prediction.department_confidence <= 1.0 or not 0.0 <= prediction.sensitivity_confidence <= 1.0:
            raise RuntimeError(
                "M9 model produced non-finite confidence values. Retrain the artifact in fp32; "
                "do not use this model for inspection."
            )
        return prediction

    def _is_confident_confidential(self, prediction: SentencePrediction) -> bool:
        return (
            prediction.is_confidential
            and prediction.department != "other"
            and prediction.joint_confidence >= self.threshold
        )

    def classify(self, doc: Document) -> tuple[str | None, float]:
        """Return the department of the highest joint-confidence sentence,
        with no confidentiality or threshold gate -- unlike detect(), which
        only emits a span once a sentence clears _is_confident_confidential(),
        classify() always reports M9's raw top opinion so the score is
        visible even when it never clears that bar."""
        best_label: str | None = None
        best_confidence = 0.0
        for _start, _end, sentence in self._sentences(doc.text):
            prediction = self._predict(sentence)
            if prediction.joint_confidence > best_confidence:
                best_label, best_confidence = prediction.department, prediction.joint_confidence
        return best_label, best_confidence

    def detect(self, doc: Document) -> list[Span]:
        """Convert confidential sentence predictions into offset-correct policy spans."""
        spans: list[Span] = []
        for start, end, sentence in self._sentences(doc.text):
            prediction = self._predict(sentence)
            if self._is_confident_confidential(prediction):
                spans.append(Span(
                    start=start,
                    end=end,
                    data_class="DEPT_CONFIDENTIAL",
                    detector="deberta",
                    confidence=prediction.joint_confidence,
                ))
        return spans
