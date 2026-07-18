"""Validation and splitting helpers for M9's sentence-level dataset."""
from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Iterable

DEPARTMENT_LABELS = ("finance", "hr", "legal", "engineering", "other")
LABEL_TO_ID = {label: index for index, label in enumerate(DEPARTMENT_LABELS)}
ID_TO_LABEL = {index: label for label, index in LABEL_TO_ID.items()}


def validate_record(record: dict[str, Any], line_number: int | None = None) -> None:
    """Check one M9 JSONL record and fail with an actionable message."""
    location = f" on line {line_number}" if line_number is not None else ""
    text = record.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f"M9 record{location} needs a non-empty string field 'text'.")
    label = record.get("label")
    if label not in DEPARTMENT_LABELS:
        allowed = ", ".join(DEPARTMENT_LABELS)
        raise ValueError(f"M9 record{location} has label {label!r}; expected one of: {allowed}.")


def read_jsonl(path: Path) -> list[dict[str, str]]:
    """Read a non-empty, validated sentence-classification JSONL file."""
    if not path.exists():
        raise FileNotFoundError(f"M9 dataset was not found: {path}")
    records: list[dict[str, str]] = []
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
            records.append({"text": record["text"].strip(), "label": record["label"]})
    if not records:
        raise ValueError(f"M9 dataset is empty: {path}")
    return records


def write_jsonl(path: Path, records: Iterable[dict[str, str]]) -> None:
    """Write validated JSONL records."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            validate_record(record)
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def split_records(records: list[dict[str, str]], seed: int = 42) -> dict[str, list[dict[str, str]]]:
    """Return a deterministic approximately 70/15/15 split.

    The source records are sentence-level: no text is duplicated across a
    split. Production data should be split by source document before sentence
    extraction to avoid leakage between paraphrased sentences.
    """
    if len(records) < 10:
        raise ValueError("At least 10 M9 examples are required for train/validation/test splits.")
    shuffled = list(records)
    random.Random(seed).shuffle(shuffled)
    train_end = round(len(shuffled) * 0.70)
    validation_end = train_end + round(len(shuffled) * 0.15)
    splits = {
        "train": shuffled[:train_end],
        "validation": shuffled[train_end:validation_end],
        "test": shuffled[validation_end:],
    }
    if any(not rows for rows in splits.values()):
        raise ValueError("One M9 split is empty; add more examples.")
    return splits

