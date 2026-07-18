import pytest

from ml.m9_data import DEPARTMENT_LABELS, split_records, validate_record


def test_m9_records_accept_department_and_sensitivity_labels() -> None:
    for department in DEPARTMENT_LABELS:
        validate_record({"text": "A realistic enterprise sentence.", "department": department, "is_confidential": department != "other"})


def test_m9_records_reject_missing_or_inconsistent_sensitivity_label() -> None:
    with pytest.raises(ValueError, match="boolean"):
        validate_record({"text": "A realistic enterprise sentence.", "department": "finance"})
    with pytest.raises(ValueError, match="cannot be confidential"):
        validate_record({"text": "Public content.", "department": "other", "is_confidential": True})


def test_m9_split_is_deterministic_and_keeps_source_groups_together() -> None:
    records = [
        {"text": f"Sentence {index}", "department": "other", "is_confidential": False, "source_group": f"source-{index // 2}"}
        for index in range(20)
    ]
    first, second = split_records(records), split_records(records)
    assert first == second
    source_to_split = {
        row["source_group"]: split_name
        for split_name, rows in first.items()
        for row in rows
    }
    assert len(source_to_split) == 10
