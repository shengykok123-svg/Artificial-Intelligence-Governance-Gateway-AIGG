"""Validation and splitting helpers for M9's two-head sentence dataset."""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Iterable

DEPARTMENT_LABELS = ("finance", "hr", "legal", "engineering", "other")
SENSITIVITY_LABELS = ("non_confidential", "confidential")
DEPARTMENT_TO_ID = {label: index for index, label in enumerate(DEPARTMENT_LABELS)}
SENSITIVITY_TO_ID = {label: index for index, label in enumerate(SENSITIVITY_LABELS)}


def validate_record(record: dict[str, Any], line_number: int | None = None) -> None:
    """Check one M9 JSONL record and fail with an actionable message."""
    location = f" on line {line_number}" if line_number is not None else ""
    if not isinstance(record.get("text"), str) or not record["text"].strip():
        raise ValueError(f"M9 record{location} needs a non-empty string field 'text'.")
    if record.get("department") not in DEPARTMENT_LABELS:
        allowed = ", ".join(DEPARTMENT_LABELS)
        raise ValueError(f"M9 record{location} has an invalid department; expected one of: {allowed}.")
    if not isinstance(record.get("is_confidential"), bool):
        raise ValueError(f"M9 record{location} needs a boolean field 'is_confidential'.")
    if record["department"] == "other" and record["is_confidential"]:
        raise ValueError(f"M9 record{location} cannot be confidential with department 'other'.")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Read a non-empty, validated M9 JSONL file."""
    if not path.exists():
        raise FileNotFoundError(f"M9 dataset was not found: {path}")
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, start=1):
            if not raw.strip():
                continue
            try:
                record = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Malformed JSON in {path} on line {line_number}: {exc.msg}") from exc
            if not isinstance(record, dict):
                raise ValueError(f"M9 record on line {line_number} must be a JSON object.")
            validate_record(record, line_number)
            records.append(record)
    if not records:
        raise ValueError(f"M9 dataset is empty: {path}")
    return records


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    """Write validated JSONL records without discarding audit metadata."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            validate_record(record)
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def split_records(records: list[dict[str, Any]], seed: int = 42) -> dict[str, list[dict[str, Any]]]:
    """Deterministically split complete source groups approximately 70/15/15."""
    if len(records) < 10:
        raise ValueError("At least 10 M9 examples are required for train/validation/test splits.")
    groups: dict[str, list[dict[str, Any]]] = {}
    for index, record in enumerate(records):
        group = str(record.get("source_group") or f"record-{index}")
        groups.setdefault(group, []).append(record)
    grouped = list(groups.items())
    random.Random(seed).shuffle(grouped)
    targets = {"train": len(records) * 0.70, "validation": len(records) * 0.15, "test": len(records) * 0.15}
    splits: dict[str, list[dict[str, Any]]] = {name: [] for name in targets}
    for _group, grouped_records in grouped:
        destination = min(targets, key=lambda name: len(splits[name]) / targets[name])
        splits[destination].extend(grouped_records)
    if any(not rows for rows in splits.values()):
        raise ValueError("One M9 split is empty; add more source groups.")
    return splits
