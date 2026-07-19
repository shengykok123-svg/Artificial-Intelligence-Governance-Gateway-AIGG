from scripts.generate_m9_synthetic_baseline import build_records


def test_synthetic_baseline_has_1000_unique_balanced_records() -> None:
    rows = build_records()
    assert len(rows) == len({row["text"] for row in rows}) == 1000
    assert sum(row["department"] == "other" and not row["is_confidential"] for row in rows) == 120
    assert sum(row["department"] == "finance" and row["is_confidential"] for row in rows) == 110
