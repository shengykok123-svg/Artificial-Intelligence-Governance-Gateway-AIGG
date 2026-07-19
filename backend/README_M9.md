# M9: DeBERTa-v3-small department detector

M9 is an optional semantic detector for the AI Governance Gateway. It is
compatible with the frozen `Detector` and `DocumentClassifier` contracts and
does not change the `/v1/inspect` request schema. The response additionally
includes `content_department` and `department_confidence` as explainability
metadata; M3 still makes its decision from `data_classes`.

M9 uses one shared DeBERTa encoder with two output heads: a department head
(`finance`, `hr`, `legal`, `engineering`, `other`) and a sensitivity head
(`confidential`, `non_confidential`). A public financial report can therefore
remain `department=finance` while producing no confidential span. Only a
confident confidential prediction from a non-`other` department becomes a
`DEPT_CONFIDENTIAL` span.

Read [the annotation guide](docs/M9_ANNOTATION_GUIDE.md) before collecting or
labelling data; a [Chinese version](docs/M9_ANNOTATION_GUIDE_ZH.md) is also
available. It defines how confident department and sensitivity outputs map to
the existing `DEPT_CONFIDENTIAL` span and `content_department` contract.

## Prepare data

Run from `backend`:

```powershell
python scripts\split_m9_dataset.py
```

The data schema is `text`, `department`, and boolean `is_confidential`;
optional `id` and `source_group` fields are retained for traceability and safe
splitting. The committed examples are synthetic wiring data only. Follow the
annotation guide: keep source documents separate across train, validation, and
test; sentence-level random splits alone can leak paraphrases.

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
