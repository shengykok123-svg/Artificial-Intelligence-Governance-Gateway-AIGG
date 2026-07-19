import numpy as np

from app.detect.base import Document
from app.detect.embed import EmbedDetector
from app.repo.base import InternalDocMatch


class FakeEncoder:
    _VECTORS = {
        "finance": np.array([1.0, 0.0, 0.0, 0.0]),
        "hr": np.array([0.0, 1.0, 0.0, 0.0]),
        "legal": np.array([0.0, 0.0, 1.0, 0.0]),
        "engineering": np.array([0.0, 0.0, 0.0, 1.0]),
    }

    def encode(self, texts: list[str], *, normalize_embeddings: bool) -> np.ndarray:
        del normalize_embeddings
        vectors = []
        for text in texts:
            lower = text.lower()
            if any(word in lower for word in ("revenue", "forecast", "vendor", "bank", "payroll", "finance", "accounts", "cost variance")):
                vectors.append(self._VECTORS["finance"])
            elif any(word in lower for word in ("employee", "termination", "grievance", "performance", "recruitment", "leave")):
                vectors.append(self._VECTORS["hr"])
            elif any(word in lower for word in ("contract", "liability", "regulatory", "compliance", "legal", "litigation", "dispute")):
                vectors.append(self._VECTORS["legal"])
            elif any(word in lower for word in ("production", "deployment", "api", "engineering", "service outage", "source code", "system failure")):
                vectors.append(self._VECTORS["engineering"])
            else:
                vectors.append(np.zeros(4))
        return np.asarray(vectors)


class FakeInternalDocRepo:
    def __init__(self, matches: list[InternalDocMatch]) -> None:
        self.matches = matches

    def search_similar(self, embedding: list[float], *, limit: int) -> list[InternalDocMatch]:
        del embedding
        return self.matches[:limit]


def _doc(text: str) -> Document:
    return Document(text=text, source_filename=None, mime="text/plain")


def test_classifies_department_above_threshold() -> None:
    department, confidence = EmbedDetector(FakeEncoder()).classify(
        _doc("Our quarterly revenue is below forecast."),
    )
    assert department == "finance"
    assert confidence == 1.0


def test_classifies_from_internal_document_similarity_before_exemplars() -> None:
    detector = EmbedDetector(
        FakeEncoder(),
        internal_docs=FakeInternalDocRepo([
            InternalDocMatch(
                source_file="roadmap.docx",
                department="engineering",
                chunk_text="2027 Product Roadmap for unreleased platform features.",
                similarity=0.91,
            ),
        ]),
    )

    department, confidence = detector.classify(_doc("Our quarterly revenue is below forecast."))

    assert department == "engineering"
    assert confidence == 0.91


def test_low_internal_similarity_falls_back_to_exemplars() -> None:
    detector = EmbedDetector(
        FakeEncoder(),
        internal_docs=FakeInternalDocRepo([
            InternalDocMatch(
                source_file="unrelated.docx",
                department="legal",
                chunk_text="Unrelated public note.",
                similarity=0.12,
            ),
        ]),
    )

    department, confidence = detector.classify(_doc("Our quarterly revenue is below forecast."))

    assert department == "finance"
    assert confidence == 1.0


def test_returns_none_for_content_below_classification_threshold() -> None:
    assert EmbedDetector(FakeEncoder()).classify(_doc("Please improve this sentence.")) == (None, 0.0)


def test_detects_only_high_confidence_sentence_spans_with_real_offsets() -> None:
    text = "Quarterly revenue is below forecast. Please improve this sentence."
    spans = EmbedDetector(FakeEncoder()).detect(_doc(text))
    assert len(spans) == 1
    assert spans[0].data_class == "DEPT_CONFIDENTIAL"
    assert spans[0].detector == "embed"
    assert text[spans[0].start:spans[0].end] == "Quarterly revenue is below forecast."
    assert spans[0].confidence == 1.0


def test_empty_document_has_no_department_or_spans() -> None:
    detector = EmbedDetector(FakeEncoder())
    assert detector.classify(_doc("   ")) == (None, 0.0)
    assert detector.detect(_doc("   ")) == []
