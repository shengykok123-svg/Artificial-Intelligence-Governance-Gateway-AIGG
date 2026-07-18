# M9 review dataset workspace

`m9_annotation_candidates.csv` is a 225-row, privacy-safe **review queue**.
It contains 25 generated candidates for each of the following buckets:

```text
finance true / false
hr true / false
legal true / false
engineering true / false
other false
```

It is not ground truth and must not be used to replace `sample.jsonl` or train
the model directly. The generated rows exist to accelerate team review.

## Review procedure

1. Each reviewer independently sets `review_status` to `approved`, `rejected`,
   or `needs_revision`, and enters their name in `reviewer_1` / `reviewer_2`.
2. Correct the text, department, `is_confidential`, and rationale whenever the
   candidate does not follow `backend/docs/M9_ANNOTATION_GUIDE_ZH.md`.
3. Keep only records approved by two reviewers. Add public-source examples and
   team-approved, sanitised scenarios to improve wording diversity.
4. Export approved rows to JSONL with only `text`, `department`,
   `is_confidential`, `id`, and `source_group`, then replace the synthetic M9
   sample data and run `python scripts\split_m9_dataset.py`.

Do not put real employee data, client data, credentials, source code, or any
unapproved confidential content in this folder or repository.
