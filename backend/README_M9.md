# M9: DeBERTa-v3-small department detector

M9 is an optional semantic detector for the AI Governance Gateway. It is
compatible with the frozen `Detector` and `DocumentClassifier` contracts and
does not change the `/v1/inspect` request or response schema.

The committed scaffold currently predicts sentence labels `finance`, `hr`,
`legal`, `engineering`, or `other`. It is wiring-only and must be migrated
before real training: topic labels alone cannot distinguish a public financial
report from an internal financial forecast. The target production schema is
`finance_confidential`, `hr_confidential`, `legal_confidential`,
`engineering_confidential`, and `other`.

Read [the annotation guide](docs/M9_ANNOTATION_GUIDE.md) before collecting or
labelling data. It defines how a predicted `*_confidential` label maps to the
existing `DEPT_CONFIDENTIAL` span and `content_department` contract.

## Prepare data

Run from `backend`:

```powershell
python scripts\split_m9_dataset.py
```

Replace `data/m9/sample.jsonl` only after the target label migration has been
implemented. Follow the annotation guide: keep source documents separate
across train, validation, and test; sentence-level random splits alone can leak
paraphrases.

## Train and select M9

```powershell
python -m ml.m9_train --epochs 3 --train-batch-size 8 --eval-batch-size 8
```

The base model downloads on the first run. The selected model and tokenizer are
saved to `backend/artifacts/deberta-m9-detector/`; training metrics are saved to
`backend/artifacts/m9_training_metrics.json`.

## Run the gateway with M9

Set these in `.env` at the repository root:

```text
SEMANTIC_DETECTOR=m9_deberta
M9_MODEL_DIR=artifacts/deberta-m9-detector
M9_CONFIDENCE_THRESHOLD=0.65
```

Then start the normal backend from `backend`:

```powershell
uvicorn app.main:app --reload
```

Keep `SEMANTIC_DETECTOR=m8` until artifacts exist. M9 is deliberately opt-in:
a missing or broken selected model fails loudly instead of silently falling back
to an empty mock detector.
