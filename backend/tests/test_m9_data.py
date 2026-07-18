import pytest

from ml.m9_data import DEPARTMENT_LABELS, split_records, validate_record


def test_m9_records_accept_expected_department_labels() -> None:
    for label in DEPARTMENT_LABELS:
        validate_record({"text": "A realistic enterprise sentence.", "label": label})


def test_m9_records_reject_unknown_labels() -> None:
    with pytest.raises(ValueError, match="expected one of"):
        validate_record({"text": "A realistic enterprise sentence.", "label": "confidential_financial"})


def test_m9_split_is_deterministic_and_keeps_texts_separate() -> None:
    records = [{"text": f"Sentence {index}", "label": "other"} for index in range(20)]
    first, second = split_records(records), split_records(records)
    assert first == second
    all_texts = [row["text"] for rows in first.values() for row in rows]
    assert len(all_texts) == len(set(all_texts)) == 20

