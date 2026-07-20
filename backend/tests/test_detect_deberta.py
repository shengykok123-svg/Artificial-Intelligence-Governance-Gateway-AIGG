from app.detect.base import Document
from app.detect.deberta import DebertaDetector, SentencePrediction


def test_deberta_detector_returns_real_sentence_offsets_for_confidential_content() -> None:
    text = "Public webinar details are available. The board forecast is not public."
    detector = DebertaDetector(
        predictor=lambda sentence: SentencePrediction("finance", 0.91, True, 0.93)
        if "forecast" in sentence else SentencePrediction("engineering", 0.98, False, 0.99),
    )
    spans = detector.detect(Document(text=text, source_filename=None, mime="text/plain"))
    assert len(spans) == 1
    assert text[spans[0].start:spans[0].end] == "The board forecast is not public."
    assert spans[0].data_class == "DEPT_CONFIDENTIAL"
    # Span confidence is the sensitivity head's own score (severity axis),
    # not the department head's -- 0.93, not the 0.91 department_confidence.
    assert spans[0].confidence == 0.93


def test_public_finance_is_not_marked_confidential() -> None:
    detector = DebertaDetector(
        predictor=lambda _sentence: SentencePrediction("finance", 0.95, False, 0.98),
    )
    doc = Document(text="Revenue was published in the annual report.", source_filename=None, mime="text/plain")
    # detect() still gates on the categorical is_confidential call -- no
    # span, no redaction impact.
    assert detector.detect(doc) == []
    # classify() (department axis) has no confidentiality or threshold gate
    # -- it always reports M9's raw top department opinion.
    assert detector.classify(doc) == ("finance", 0.95)
    # classify_sensitivity() (severity axis) is 0.0 when nothing is
    # predicted confidential, regardless of department confidence.
    assert detector.classify_sensitivity(doc) == 0.0


def test_department_and_sensitivity_axes_can_disagree_on_which_sentence_wins() -> None:
    # The two heads are ranked independently: department picks whichever
    # sentence M9 is most sure ABOUT THE DEPARTMENT (finance, 0.89); severity
    # picks whichever sentence M9 is most sure IS CONFIDENTIAL (the hr
    # sentence's sensitivity_confidence, 0.90) -- different sentences, on
    # purpose, because the two questions are independent.
    detector = DebertaDetector(
        predictor=lambda sentence: SentencePrediction("hr", 0.74, True, 0.90)
        if "grievance" in sentence else SentencePrediction("finance", 0.89, True, 0.83),
    )
    doc = Document(text="The grievance is open. The forecast is restricted.", source_filename=None, mime="text/plain")
    assert detector.classify(doc) == ("finance", 0.89)
    assert detector.classify_sensitivity(doc) == 0.90


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
