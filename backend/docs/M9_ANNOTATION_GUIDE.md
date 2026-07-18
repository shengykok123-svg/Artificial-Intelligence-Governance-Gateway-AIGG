# M9 Data Annotation Guide and Training Flow

## Purpose

M9 helps the gateway identify **unreleased or internal department-specific
content** in English text. It does not decide the final policy outcome. The
existing M3 policy engine decides whether the gateway should allow, redact,
hold, or deny a prompt after M9 reports a `DEPT_CONFIDENTIAL` span.

This guide proposes the target labels and defines the human review process
for a small, high-quality ("gold") dataset. A gold dataset means every example
has been reviewed and assigned using these rules; it is not an automatically
labelled web scrape.

## Important: target schema versus current scaffold

The current M9 code scaffold accepts the earlier labels
`finance | hr | legal | engineering | other`. That schema detects a topic, but
cannot distinguish public finance text from an internal financial forecast.

**Do not create a production dataset using the old four department labels.**
The target schema below must be implemented in the M9 data validator, trainer,
and detector before production training. Until that migration is completed, the
included synthetic dataset is for wiring tests only.

## Annotation unit and record format

Use a complete English sentence or a short, self-contained paragraph (normally
one to three sentences) as one example. Preserve punctuation but remove or
replace real personal data, account numbers, secrets, and client names before
committing anything to Git.

```json
{"id":"fin-001","source_group":"synthetic-finance-01","text":"The unreleased Q4 forecast projects a RM 2 million shortfall.","label":"finance_confidential","rationale":"Unreleased internal financial forecast."}
```

- `id`: stable unique identifier.
- `source_group`: the source document or generation batch. All records from one
  source group must remain in one train/validation/test split.
- `text`: the redacted/de-identified text given to the model.
- `label`: exactly one target label below.
- `rationale`: short human explanation; retain it in the private annotation
  source, but it need not be passed to the model trainer.

## Target labels

| Label | Apply when | Positive example | Do not apply when |
| --- | --- | --- | --- |
| `finance_confidential` | Non-public budgets, forecasts, revenue/margin figures, pricing, fundraising, M&A valuation, or internal financial decisions. | "The draft acquisition budget caps the offer at RM 4.2 million." | A publicly released annual report or generic finance advice. |
| `hr_confidential` | Identifiable employee/contractor information, salary, performance, hiring decision, disciplinary, medical, leave, or workforce plan not made public. | "Aisha's performance review recommends a below-expectations rating." | A public leave-policy page or general recruitment advice. |
| `legal_confidential` | Unreleased contract terms, negotiations, legal advice, disputes, investigations, or privileged strategy. | "Counsel recommends settling before the draft claim is filed." | Public terms of service or a general explanation of contract law. |
| `engineering_confidential` | Non-public source code, system architecture, credentials, security vulnerabilities, unreleased roadmap, or internal technical incident details. | "The production API key is stored in the legacy payment service." | Public API documentation or open-source code that is intentionally public. |
| `other` | Public, generic, hypothetical, already-approved-for-public-release, or insufficiently specific text. This includes public material about finance, HR, legal, or engineering. | "The company published its annual revenue in the investor report." | Text that clearly contains one of the confidential categories above. |

`confidential` means the content is internal/unreleased under the team policy;
it does **not** mean that a sentence merely mentions a department.

## Decision rules for annotators

1. Read the full example and its source context, if available.
2. First decide: is it non-public or internal content that the gateway should
   flag? If no, label `other`.
3. If yes, choose the department most directly responsible for the content.
4. Use only one label. If two departments appear, choose the main risk in the
   exact sentence; split the text into two examples if they are independently
   meaningful.
5. Do not infer secrecy from a company name, a finance word, or a technical
   term alone. Use `other` when the text does not establish internal/unreleased
   status.
6. If it is genuinely ambiguous, mark it `needs_review` in the private
   annotation sheet. Do not add it to the training JSONL until two reviewers
   resolve it.

### Boundary examples

| Text | Label | Why |
| --- | --- | --- |
| "The CFO will present the unreleased cash-flow forecast on Friday." | `finance_confidential` | Internal forecast. |
| "The CFO presented annual results in a public earnings call." | `other` | Public disclosure. |
| "Please update Jia Wei's salary adjustment in the payroll system." | `hr_confidential` | Identifiable compensation information. |
| "Our public careers page describes the interview process." | `other` | Public generic HR content. |
| "The counterparty rejected clause 7 in the unexecuted supplier agreement." | `legal_confidential` | Unreleased negotiation. |
| "This open-source repository uses an MIT licence." | `other` | Public technical/legal content. |
| "The staging database password is in the incident channel." | `engineering_confidential` | Credential/security information. |
| "Use HTTPS to encrypt traffic." | `other` | Generic public guidance. |

## Data collection and review workflow

```text
Approved sources / carefully written synthetic scenarios
  -> remove real identifiers, secrets, and client data
  -> annotator labels with this guide + writes rationale
  -> second annotator independently reviews
  -> resolve disagreements and remove unresolved examples
  -> assign whole source_groups to train / validation / test
  -> validate JSONL schema
  -> fine-tune DeBERTa
  -> evaluate on untouched test set and inspect errors
  -> calibrate threshold, save model and metrics
  -> enable M9 in the gateway only after acceptance checks
```

### Recommended first dataset

Aim for at least 100 reviewed examples per label for a first demo (500 total),
then grow toward 200--500 per label. Keep `other` diverse: public finance,
public HR policy, public contracts, public documentation, normal chat, and
near-miss examples. A smaller reviewed dataset is more useful than thousands
of weakly or automatically labelled records.

Public sources can supply language style only. Do not label public SEC filings,
public contracts, public policies, or open-source code as confidential merely
because of their topic. They are usually useful `other` or controlled
near-miss examples.

## Split, train, evaluate, and deploy

1. **Freeze the annotation set.** Keep a private source/rationale sheet and
   commit only sanitised data approved for the repository.
2. **Split by `source_group`, not by random sentence.** Suggested ratio:
   70% train, 15% validation, 15% test. Never tune against the test set.
3. **Train.** Fine-tune `microsoft/deberta-v3-small` on the training split.
   Use validation loss and per-label precision/recall/F1 to select a checkpoint.
4. **Evaluate.** Run the final selected model once on the untouched test set.
   Review false negatives for confidential text and false positives on public
   material; both are important for a governance gateway.
5. **Calibrate.** Choose the runtime confidence threshold using validation data
   and the team's acceptable false-positive/false-negative trade-off. Do not
   assume the initial `0.65` threshold is correct.
6. **Integrate.** Map a predicted `*_confidential` label to
   `DEPT_CONFIDENTIAL` and strip the suffix for `content_department`. Return
   sentence offsets through `detect()`; M3 remains the policy decision-maker.
7. **Acceptance test.** Test text prompts and extracted attachment text. PDF
   support additionally depends on M5 extraction; scanned PDFs require OCR and
   are out of scope until M5 adds it.

## Team responsibilities

| Role | Responsibility |
| --- | --- |
| Data owner | Approves sources and confirms that no real confidential content is committed. |
| Annotators | Apply this guide independently and record rationale. |
| M9 engineer | Validates data, trains/evaluates model, tracks metrics and error examples. |
| M1/M3 integration owner | Confirms output follows frozen contracts and policy remains outside M9. |
| Demo owner | States clearly whether M9 is trained, what data it used, and its measured limitations. |

## Before training checklist

- [ ] Target `*_confidential` schema has been migrated into the M9 code.
- [ ] All text is English, sanitised, and approved for repository use.
- [ ] Each record has a label, rationale, and source group in the private
      annotation source.
- [ ] Two reviewers have resolved disagreements.
- [ ] No source group appears in more than one split.
- [ ] `other` includes public department-related near misses.
- [ ] The test split remains untouched until final evaluation.
