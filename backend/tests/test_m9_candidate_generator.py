from scripts.generate_m9_annotation_candidates import build_rows


def test_candidate_generator_creates_balanced_unique_review_rows() -> None:
    rows = build_rows()
    assert len(rows) == 225
    assert len({row["text"] for row in rows}) == 225
    assert {row["review_status"] for row in rows} == {"needs_review"}
    buckets = {(row["department"], row["is_confidential"]) for row in rows}
    assert buckets == {
        ("finance", "true"), ("finance", "false"),
        ("hr", "true"), ("hr", "false"),
        ("legal", "true"), ("legal", "false"),
        ("engineering", "true"), ("engineering", "false"),
        ("other", "false"),
    }
