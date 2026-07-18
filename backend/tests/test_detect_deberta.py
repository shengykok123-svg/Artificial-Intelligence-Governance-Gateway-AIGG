from app.detect.base import Document
from app.detect.deberta import DebertaDetector


def test_deberta_detector_returns_real_sentence_offsets() -> None:
    text = "Public webinar details are available. The board forecast is not public."
    detector = DebertaDetector(
        threshold=0.65,
        predictor=lambda sentence: ("finance", 0.91) if "forecast" in sentence else ("other", 0.98),
    )
    spans = detector.detect(Document(text=text, source_filename=None, mime="text/plain"))
    assert len(spans) == 1
    assert text[spans[0].start:spans[0].end] == "The board forecast is not public."
    assert spans[0].data_class == "DEPT_CONFIDENTIAL"
    assert spans[0].detector == "deberta"


def test_deberta_classifier_returns_highest_confident_department() -> None:
    detector = DebertaDetector(
        threshold=0.65,
        predictor=lambda sentence: ("hr", 0.74) if "grievance" in sentence else ("finance", 0.89),
    )
    doc = Document(text="The grievance is open. The forecast is restricted.", source_filename=None, mime="text/plain")
    assert detector.classify(doc) == ("finance", 0.89)


def test_deberta_detector_does_not_emit_other_or_low_confidence_spans() -> None:
    detector = DebertaDetector(threshold=0.65, predictor=lambda _sentence: ("other", 0.99))
    doc = Document(text="This is an approved public announcement.", source_filename=None, mime="text/plain")
    assert detector.detect(doc) == []
    assert detector.classify(doc) == (None, 0.0)


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
