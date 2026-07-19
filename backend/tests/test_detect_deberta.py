from app.detect.base import Document
from app.detect.deberta import DebertaDetector, SentencePrediction


def test_deberta_detector_returns_real_sentence_offsets_for_confidential_content() -> None:
    text = "Public webinar details are available. The board forecast is not public."
    detector = DebertaDetector(
        threshold=0.65,
        predictor=lambda sentence: SentencePrediction("finance", 0.91, True, 0.93)
        if "forecast" in sentence else SentencePrediction("engineering", 0.98, False, 0.99),
    )
    spans = detector.detect(Document(text=text, source_filename=None, mime="text/plain"))
    assert len(spans) == 1
    assert text[spans[0].start:spans[0].end] == "The board forecast is not public."
    assert spans[0].data_class == "DEPT_CONFIDENTIAL"


def test_public_finance_is_not_marked_confidential() -> None:
    detector = DebertaDetector(
        threshold=0.65,
        predictor=lambda _sentence: SentencePrediction("finance", 0.95, False, 0.98),
    )
    doc = Document(text="Revenue was published in the annual report.", source_filename=None, mime="text/plain")
    assert detector.detect(doc) == []
    assert detector.classify(doc) == (None, 0.0)


def test_deberta_classifier_uses_joint_confidence() -> None:
    detector = DebertaDetector(
        threshold=0.65,
        predictor=lambda sentence: SentencePrediction("hr", 0.74, True, 0.90)
        if "grievance" in sentence else SentencePrediction("finance", 0.89, True, 0.83),
    )
    doc = Document(text="The grievance is open. The forecast is restricted.", source_filename=None, mime="text/plain")
    assert detector.classify(doc) == ("finance", 0.83)


def test_main_wires_m9_only_when_explicitly_selected(monkeypatch) -> None:
    from app import main
    from app.detect import deberta

    class FakeDebertaDetector:
        def detect(self, _doc: Document):
            return []

        def classify(self, _doc: Document):
            return None, 0.0

    monkeypatch.setattr(main, "SEMANTIC_DETECTOR", "m9_deberta")
    monkeypatch.setattr(deberta, "DebertaDetector", FakeDebertaDetector)
    assert isinstance(main.get_embed_detector(), FakeDebertaDetector)


def test_health_reports_the_selected_semantic_detector(monkeypatch) -> None:
    from app import main

    monkeypatch.setattr(main, "SEMANTIC_DETECTOR", "m9_deberta")
    assert main.health()["semantic_detector"] == "m9_deberta"
