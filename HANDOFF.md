# AI Governance Gateway - Engineering Handoff

## Read this first

This is a hackathon MVP for governing **data at the browser boundary**, not
governing whether employees may use AI at all. The desired user experience is
"redact and allow" where policy permits it, rather than a blanket block.

The project is deliberately **not**:

- an AI workspace or chat application;
- an OpenAI-compatible reverse proxy;
- a replacement for ChatGPT, Gemini, Copilot, or another AI provider;
- a production identity, SIEM, CASB, or enterprise DLP platform.

The browser extension observes a compose action on an existing web AI tool and
calls the FastAPI backend. The backend classifies the submitted text, applies
policy, tokenises values when redaction is required, writes an audit record,
and returns a verdict to the extension.

## System flow

```text
Existing web AI page
  -> Chrome MV3 extension
  -> POST /v1/inspect
  -> M2 rules detector + selected semantic detector (M8 or opt-in M9)
  -> M3 policy decision: allow | redact | hold | deny
  -> M7 tokenisation vault when decision == redact
  -> audit record + dashboard / approval workflow
  -> extension either submits the original/redacted prompt or blocks it
```

`/v1/inspect` is the composition root. The extension and dashboard communicate
with the backend API only; they do not access the database or detector modules
directly.

## Current implementation state

| Module | Status | Notes |
| --- | --- | --- |
| M0 persistence | Implemented | Memory and PostgreSQL repository implementations. |
| M1 API skeleton | Implemented | `/v1/inspect`, audit, tools, stats, and API-key guard. |
| M2 deterministic detection | Mocked | `MockRulesDetector` is selected by default. |
| M3 policy engine | Mocked | Default mock uses a small hardcoded demo table. |
| M4 Chrome extension | Implemented | MV3 extension, separate `extension/` project. |
| M5 file extraction | Mocked | Mock supports text/plain and text/csv only. |
| M6 dashboard | Implemented | Separate React/Vite project. |
| M7 tokenisation vault | Mocked | Demo-safe mock, not production encryption. |
| M8 embedding similarity | Mocked | Empty result unless M8 is implemented. |
| M9 DeBERTa semantic detector | Scaffolded | Correct contract, starter data, tests; no trained artifact yet. |

Before recording a demo, call `GET /v1/health` and inspect `mocked` plus
`semantic_detector`. `ENV=demo` refuses to start when `MOCK_MODULES` is not
empty; do not represent mock results as a real detector or policy decision.

## Frozen contracts - do not change casually

`backend/app/detect/base.py` defines shared interfaces. Existing modules rely
on them. New detectors must implement them rather than changing their shape:

```python
class Detector(Protocol):
    def detect(self, doc: Document) -> list[Span]: ...

class DocumentClassifier(Protocol):
    def classify(self, doc: Document) -> tuple[str | None, float]: ...
```

`Span.start` and `Span.end` are offsets into `Document.text`; M7 uses these
offsets for tokenisation. Do not calculate spans with a later `str.find()` and
do not change `backend/app/detect/base.py` for M9 work.

Similarly, only `backend/app/repo/` may import `app/models.py`, open a database
session, or write SQL. Keep policy data in repositories and do not hardcode
runtime policy in detector code.

## M9: DeBERTa-v3-small confidential-department detector

M9 is an opt-in semantic detector built around `microsoft/deberta-v3-small`.
It is intentionally separate from the earlier standalone six-label prototype.

### M9 model task

The committed M9 scaffold currently has an earlier wiring-only topic schema:

```text
finance | hr | legal | engineering | other
```

It must be migrated before real training because topic alone does not establish
confidentiality. The proposed target schema is:

```text
finance_confidential | hr_confidential | legal_confidential |
engineering_confidential | other
```

The complete annotation rules and training flow are in
[`backend/docs/M9_ANNOTATION_GUIDE.md`](backend/docs/M9_ANNOTATION_GUIDE.md).

At runtime:

- `classify(doc)` returns the highest-confidence confidential department, or
  `(None, 0.0)` if no `*_confidential` sentence crosses the threshold.
- `detect(doc)` emits a `DEPT_CONFIDENTIAL` `Span` for every confident
  `*_confidential` sentence.
- Existing M3 policy decides what `DEPT_CONFIDENTIAL` means for a selected AI
  tool tier. M9 must not directly decide allow/redact/hold/deny.

Relevant files:

```text
backend/app/detect/deberta.py       Runtime detector and sentence offsets
backend/ml/m9_data.py               JSONL validation and fixed-seed split
backend/ml/m9_train.py              Fine-tuning entry point
backend/data/m9/sample.jsonl        Synthetic wiring-only starter data
backend/scripts/split_m9_dataset.py Dataset split command
backend/tests/test_detect_deberta.py Contract and integration-seam tests
backend/tests/test_m9_data.py       Dataset validation/split tests
backend/README_M9.md                Focused M9 usage guide
backend/docs/M9_ANNOTATION_GUIDE.md Labelling rules and end-to-end data flow
```

### M9 data requirements

The included data is synthetic and only proves that the pipeline has the right
shape. Do not claim accuracy from it. Follow the annotation guide and migrate
to `*_confidential` labels before training. Include public/benign `other`
examples and near misses. Keep all sentences derived from one source document
in the same train/validation/test split to prevent leakage.

One JSONL record is:

```json
{"text":"The board forecast is not public.","label":"finance_confidential"}
```

## Local commands (Windows)

```powershell
# Backend setup
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

# Existing backend test suite
python -m pytest -q

# M9 data and targeted tests
python scripts\split_m9_dataset.py
python -m pytest -q tests\test_m9_data.py tests\test_detect_deberta.py

# Train only after replacing the synthetic data
python -m ml.m9_train --epochs 3 --train-batch-size 8 --eval-batch-size 8
```

To select M9 at runtime, create a root `.env` from `.env.example` and set:

```text
SEMANTIC_DETECTOR=m9_deberta
M9_MODEL_DIR=artifacts/deberta-m9-detector
M9_CONFIDENCE_THRESHOLD=0.65
```

Then run from `backend`:

```powershell
uvicorn app.main:app --reload
```

Leave `SEMANTIC_DETECTOR=m8` until model artifacts exist. A selected M9 model
fails loudly when artifacts are absent; it never silently falls back to a mock.

## Next AI / engineer checklist

1. Read this file, `README.md`, `backend/README_M9.md`, and
   `backend/app/detect/base.py` before modifying code.
2. Do not add an AI workspace or OpenAI-compatible reverse proxy.
3. Do not change frozen detector or repository contracts without an explicit
   team decision.
4. Implement the target M9 label migration, then replace synthetic data with
   reviewed labelled data before training.
5. Run the M9 targeted tests after every detector change.
6. Calibrate `M9_CONFIDENCE_THRESHOLD` against held-out data; do not choose it
   based only on a few hand-written prompts.
7. Validate latency on the intended demo machine before enabling M9 in a demo.
8. Do not commit `.env`, model artifacts, credentials, real enterprise text,
   or training data without explicit approval.
