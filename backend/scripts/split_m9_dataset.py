"""Create deterministic M9 train/validation/test JSONL files."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from ml.m9_data import read_jsonl, split_records, write_jsonl  # noqa: E402


def main() -> None:
    data_dir = BACKEND_ROOT / "data" / "m9"
    records = read_jsonl(data_dir / "sample.jsonl")
    for split_name, split_records_ in split_records(records).items():
        destination = data_dir / f"{split_name}.jsonl"
        write_jsonl(destination, split_records_)
        print(f"Wrote {len(split_records_)} examples to {destination.relative_to(BACKEND_ROOT)}")


if __name__ == "__main__":
    main()
