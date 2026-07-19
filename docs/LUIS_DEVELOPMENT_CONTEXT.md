# Luis Development Context

This file preserves the reasoning and decisions behind Luis's work after
branching from the team `main` branch. It is meant for teammates and their
coding agents. If `docs/RUNBOOK.md` explains what commands to run, this file
explains why the branch looks the way it does.

Use this file when:

- a teammate does not understand why the runbook asks for a step;
- a coding agent needs context before continuing development;
- someone wants to separate teammate baseline work from Luis's additions;
- someone is about to change M5, file redaction, M8, policy behavior, or the
  Chrome extension flow.

## 1. Starting Point From `origin/main`

Luis did not start from an empty project. The team `main` branch already had
the AI Governance Gateway architecture:

```text
Chrome extension
  -> FastAPI backend
  -> detectors / policy
  -> audit log
  -> dashboard
```

Important baseline from `origin/main`:

- M2 deterministic detection existed.
- M7 tokenisation existed.
- M8/M9-related semantic work existed in some form.
- M4 Chrome extension existed.
- M6 dashboard existed.
- M5 real file extraction had already landed for core attachment text
  extraction.

The most important ownership clarification:

```text
Teammate/main: M5 file extraction foundation.
Luis branch: file redaction replacement + extra extraction coverage needed for
the redaction flow.
```

So this branch should not be described as "Luis built all of M5 from scratch".
That would be inaccurate. The correct description is that Luis continued from
the existing M5 extractor and built the redaction/replacement behavior on top.

## 2. Core Product Frame

The product is not an AI chatbot and not an AI workspace. It is a browser
boundary governance layer:

```text
User writes prompt or uploads file in ChatGPT/Gemini
  -> Chrome extension intercepts before send
  -> backend inspects prompt and attachments
  -> policy returns allow / redact / hold / deny
  -> extension either sends, replaces, waits, or blocks
```

The user experience target is:

- redact local/tokenisable sensitive values when safe;
- deny obvious hard violations such as API keys;
- hold high-risk internal-document similarity for admin review;
- avoid sending anything before a verdict is known.

This is why the branch focuses so heavily on browser behavior and live
acceptance testing, not only backend unit tests.

## 3. M5 Extraction vs File Redaction Replacement

These two ideas caused confusion and should stay separate.

M5 extraction means:

```text
attachment bytes -> extracted text -> detectors can inspect it
```

File redaction replacement means:

```text
attachment bytes -> extracted text -> sensitive spans detected
  -> backend generates redacted attachment copy
  -> extension injects/replaces uploaded file
  -> ChatGPT receives the redacted copy
```

The second flow is the Luis-side work. It depends on M5 extraction, but it is
not the same module responsibility.

Example:

```text
mykad.docx contains:
Employee IC 880412-08-5561 needs a reply.

Backend detects MYKAD.
Backend returns mykad.redacted.docx.
Extension replaces the original upload.
ChatGPT reads:
Employee IC [MYKAD_1] needs a reply.
```

The branch verifies this replacement idea across several file formats rather
than only checking that extraction can read text.

## 4. File Redaction Progression

The file work was developed incrementally. The order matters because each step
answered a different risk.

1. TXT/CSV redaction replacement

   The simplest case. Text could be extracted, tokenised, and returned as a
   `.redacted.txt` or `.redacted.csv` copy. This proved the backend contract
   and extension replacement concept.

2. DOCX redaction replacement

   Word documents needed real document rewriting, not just extracted text.
   Coverage expanded to body text, tables, headers, footers, comments, tracked
   changes, and embedded OOXML packages where inspectable.

3. PPTX redaction replacement

   PowerPoint needed slide text and speaker notes. Later comments and embedded
   OOXML packages were covered too.

4. PDF redaction replacement

   Current PDF redaction creates a new text-only PDF containing the redacted
   text. It does not preserve the original PDF layout, images, tables, or
   object structure.

   This was accepted as a practical MVP step because true layout-preserving PDF
   redaction is more complex and easy to get wrong.

5. XLSX redaction replacement

   Excel support was added for shared strings and inline worksheet strings.
   This covers useful workbook text cases without pretending to be a complete
   Excel rendering engine.

6. Image and scanned-PDF OCR redaction

   OCR uses local Tesseract. It can redact PNG/JPEG images by blacking out
   OCR-detected sensitive word boxes. Scanned PDFs use OCR fallback for text
   extraction and redacted text-only PDF output.

7. Legacy OLE fail-closed behavior

   Legacy OLE embedded objects such as `oleObject*.bin` are not parsed. The
   backend returns HTTP 415 instead of letting a file pass silently. This is a
   deliberate safety choice.

## 5. File Redaction Limitations

Known limitations should be stated honestly.

- PDF redaction is text-only output, not layout-preserving redaction.
- OCR quality depends on Tesseract and image quality.
- OCR is not deterministic like TXT/DOCX/XLSX text extraction.
- Legacy OLE embedded objects fail closed with HTTP 415.
- Macro/script inspection is not a production-grade DLP scanner.
- Redaction is based on detected spans. If detection misses a sensitive value,
  redaction cannot protect that missed value.

These limits do not invalidate the MVP, but they should be visible in demos and
handover notes.

## 6. OCR Decision and Alternatives

OCR was needed for images and scanned PDFs. The branch currently uses
Tesseract because it is local, free, and fits the hackathon/local-development
constraint.

Current choice:

```text
Tesseract OCR
```

Why:

- runs locally;
- no extra paid cloud service;
- no data leaves the machine for OCR;
- enough for proof-of-concept screenshots and simple test files.

Tradeoffs:

- teammate machines must install Tesseract or set `TESSERACT_EXE`;
- accuracy depends on image quality;
- OCR is slower than structured text extraction;
- it can miss blurred, rotated, handwritten, or complex-layout text.

Alternatives discussed for future consideration:

- cloud OCR APIs such as Google Vision, Azure Document Intelligence, or AWS
  Textract;
- local OCR models/libraries such as PaddleOCR or EasyOCR;
- document-specialized parsing/OCR pipelines for invoices/forms/scans.

These alternatives were not implemented because they add service setup,
credentials, cost, latency, privacy, and integration complexity. The current
rule is: use Tesseract for now, document alternatives for later.

See also:

```text
docs/OCR_OPTIONS.md
```

## 7. Extension Live-Acceptance Work

Backend tests are not enough for this project because the core value happens
inside existing AI websites. The extension must correctly intercept browser
events and modify the composer/upload state.

Important extension behaviors tested or fixed:

- popup health connects to backend;
- mock mode can be disabled;
- MyKad prompt is redacted before sending;
- API key prompt is denied and stays in composer;
- salary now denies under current policy;
- hold requests wait for approval;
- successful send banners auto-disappear;
- previous-message edit is re-inspected;
- previous-message edit deny blocks the edit;
- previous-message edit redact submits the redacted version;
- previous-message edit hold avoids stale auto-send after approval;
- attachment upload is inspected before upload;
- redacted attachment copies are injected into the file input;
- removing an attachment clears stale cached attachment state.

The stale attachment issue was important:

```text
Old bug:
User uploaded a file, removed it from composer, then sent text only.
Extension still included the removed file in the inspection request.

Fix:
Send-time refresh clears cached attachments when the filename is no longer
visible in the page composer.
```

This is why the acceptance checklist includes attachment-removal testing.

## 8. Previous-Message Edit Issue

ChatGPT allows users to edit an earlier sent message. That path is different
from typing into the normal composer.

The issue:

```text
Normal composer interception worked.
Editing a previous message could bypass the same redact/deny/hold behavior.
```

Expected current behavior:

- editing an old message to include an API key should be denied;
- editing an old message to include a MyKad should submit the redacted edit;
- editing an old message into a hold case should not auto-send a stale edit
  after approval.

This matters because otherwise a user could avoid the governance flow by
editing instead of sending a new prompt.

## 9. Policy Alignment From Meeting Notes

The policy frame changed during the work. Earlier demo behavior used salary as
a hold case. The meeting frame changed that.

Current policy expectations:

| Signal | Current decision |
| --- | --- |
| API key / `SECRET` | deny |
| salary / `SALARY` | deny |
| bank account / `BANK_ACCT` | deny |
| MyKad / `MYKAD` | redact |
| email / `EMAIL` | redact |
| phone / `PHONE` | redact |
| person / `PERSON` | redact |
| M8 confidential document similarity / `DEPT_CONFIDENTIAL` | hold |
| no sensitive signal | allow |

Important consequence:

```text
Do not use salary to test hold anymore.
Use M8 DEPT_CONFIDENTIAL to test hold.
```

Historical screenshots may still show salary hold because they were captured
before this policy alignment. Current docs should explain that those are
historical evidence, not current expected policy.

## 10. M3 Is Still Mocked

M3 is still not a real configurable policy engine in this branch.

The current decision behavior is a mock policy table. That is why health should
show:

```text
mocked: M3
```

This is acceptable for the current frame as long as the team does not claim M3
is production-ready.

Implication for future work:

- real M3 should eventually read policy rules properly;
- Justification Required should likely become a real policy obligation;
- admin review decisions should keep the original policy decision and record
  reviewer action separately.

## 11. Justification Required Discussion

Justification Required was discussed as a future UX/policy requirement.

The agreed product idea:

```text
For some medium-risk internal business information:
user clicks send
  -> system requires business purpose + responsibility acknowledgement
  -> after user confirms, request sends directly
```

Important design decision:

```text
Justification Required should not necessarily be a fifth final verdict.
It is better treated as a pre-send obligation attached to allow/redact.
```

Example final actions could be:

- `ALLOW_WITH_JUSTIFICATION`
- `REDACT_WITH_JUSTIFICATION`
- `HOLD`
- `DENY`

Luis's branch does not implement this flow yet.

## 12. Hold/Admin Review Discussion

Hold is for higher-risk content that should not be sent until reviewed.

Current expected hold source:

```text
M8 internal-document confidential similarity -> DEPT_CONFIDENTIAL -> hold
```

Approve behavior:

- normal composer hold can be released after approval;
- previous-message edit hold should ask the user to submit the edit again
  rather than auto-sending a stale edit target.

Still incomplete:

- full production admin review page;
- role-based reviewer permissions;
- richer reviewer workflows;
- production notifications.

## 13. M8 pgvector Decision

M8 is intended to catch semantic similarity to internal company documents:

```text
"This does not contain obvious PII, but it sounds very similar to our internal
finance roadmap / HR plan / engineering document."
```

The team wanted a real vector database implementation. The final decision for
this branch:

```text
Use PostgreSQL + pgvector only.
Do not add Pinecone, Qdrant, ChromaDB, Weaviate, Supabase, or another vector DB
service unless explicitly requested later.
```

Why PostgreSQL + pgvector:

- matches the existing PostgreSQL dependency;
- avoids adding another service;
- can store audit data and vector chunks in one database;
- acceptable for MVP and team handover;
- demonstrates a real vector search path.

Tradeoffs:

- local setup is harder than memory mode;
- teammate needs PostgreSQL with pgvector enabled;
- Docker Desktop may be useful but is not mandatory if local PostgreSQL has
  pgvector;
- if pgvector is missing, M8 should fail/disable rather than pretending to be
  a complete vector database implementation.

## 14. Supabase and Cloud PostgreSQL Discussion

Supabase was discussed because it provides hosted PostgreSQL and supports
pgvector. The branch does not use Supabase.

Reason:

```text
User explicitly requested PostgreSQL + pgvector only, with no extra vector DB
or hosted service such as Supabase unless explicitly requested.
```

If the team later chooses cloud PostgreSQL, that is still compatible if it is
plain PostgreSQL with pgvector enabled. But this branch should not add
Supabase-specific code, SDKs, auth, storage, or deployment assumptions.

## 15. Docker vs Local PostgreSQL

Docker Desktop was discussed as one setup option. It is not the only option.

Possible setup paths:

1. Docker container running PostgreSQL + pgvector.
2. Local Windows PostgreSQL with pgvector installed manually.
3. Cloud/server PostgreSQL with pgvector enabled.

The implementation should not care which one is used as long as
`DATABASE_URL` points to a PostgreSQL server with pgvector.

Memory mode still exists for quick backend and extension checks, but strict M8
validation needs PostgreSQL + pgvector.

## 16. M8 JSON Shape

The API does not return one separate JSON object per module. `/v1/inspect`
returns one combined response.

Example API key case:

```json
{
  "decision": "deny",
  "data_classes": ["SECRET"],
  "reason": "SECRET detected (mock policy).",
  "debug": {
    "policy_layer": "M3",
    "semantic_detector": "m8",
    "detections": [
      {
        "data_class": "SECRET",
        "detector": "rules",
        "confidence": 1.0,
        "source": "prompt"
      }
    ]
  }
}
```

Example M8 confidential case:

```json
{
  "decision": "hold",
  "data_classes": ["DEPT_CONFIDENTIAL"],
  "content_department": "hr",
  "department_confidence": 0.91,
  "debug": {
    "policy_layer": "M3",
    "semantic_detector": "m8",
    "detections": [
      {
        "data_class": "DEPT_CONFIDENTIAL",
        "detector": "embed",
        "confidence": 0.91,
        "source": "prompt"
      }
    ]
  }
}
```

The exact M8 confidence can vary with the indexed corpus and embedding model.

## 17. Dashboard M8 Upload Path

The dashboard `Policy & tools` page can upload internal documents into the M8
corpus.

Backend endpoint:

```text
POST /v1/internal-docs
```

The backend:

```text
extracts text with M5
chunks the text
embeds chunks with all-MiniLM-L6-v2
stores source_file, department, chunk_text, embedding in PostgreSQL pgvector
```

Chunk text is stored intentionally for debug/explain visibility. Raw source
files are not stored as full original documents in this implementation.

## 18. Testing Philosophy Used

The work was done step by step:

```text
1. Make one behavior work.
2. Test it through backend/API.
3. Test it through Chrome when browser behavior matters.
4. Record limits and evidence.
5. Commit locally.
```

This matters because many failures were not pure backend bugs. Some were
browser-state or UX-flow bugs, such as previous-message edit and attachment
removal stale state.

Do not claim "acceptance passed" from backend HTTP only. Browser acceptance
requires live Chrome/ChatGPT behavior.

## 19. Evidence and Docs Added

Important files:

```text
docs/FILE_REDACTION_STATUS.md
docs/OCR_OPTIONS.md
docs/M8_PGVECTOR_INTERNAL_DOCS.md
docs/EXTENSION_TEST_REPORT.md
docs/RUNBOOK.md
docs/LUIS_HANDOVER_SUMMARY.md
```

Use them as follows:

- `FILE_REDACTION_STATUS.md`: what file types work and what limits remain.
- `OCR_OPTIONS.md`: OCR alternatives discussed.
- `M8_PGVECTOR_INTERNAL_DOCS.md`: pgvector/M8 details.
- `EXTENSION_TEST_REPORT.md`: historical and current acceptance evidence.
- `RUNBOOK.md`: exact setup/run/test commands.
- `LUIS_HANDOVER_SUMMARY.md`: short teammate-facing overview.

This file is the deeper context for coding agents.

## 20. Known Remaining Work

Not solved by Luis's branch:

- real M3 policy engine;
- Justification Required modal and audit flow;
- full admin review workflow polish;
- production auth/identity/permissions;
- production deployment;
- M9 production-quality trained model;
- layout-preserving PDF redaction;
- perfect OCR;
- richer M8 corpus management and access controls.

## 21. Recommended Next Work

Suggested continuation order:

1. Decide who owns real M3.
2. Implement Justification Required if it remains part of the product frame.
3. Improve admin review UI for M8 holds.
4. Improve M8 internal document corpus management.
5. Add better test fixtures for file redaction edge cases.
6. Decide whether OCR should remain Tesseract-only or move to a better engine.
7. Re-run live Chrome acceptance after each extension behavior change.

## 22. Instructions for Future Coding Agents

If a teammate gives this file to a coding agent, the agent should follow these
rules:

- Do not assume Luis built all of M5. `origin/main` already had M5 extraction.
- Preserve teammate M5 extraction behavior while adding/redacting on top.
- Do not revert file redaction replacement unless explicitly asked.
- Do not introduce another vector database.
- Do not claim M3 is real while `MOCK_MODULES=M3`.
- Do not use salary as a hold test in the current policy frame.
- Use M8 `DEPT_CONFIDENTIAL` for hold tests.
- Treat OCR as best-effort and document uncertainty.
- Keep extension acceptance evidence separate from backend HTTP evidence.
- Keep generated/manual test files out of commits unless intentionally promoted
  to fixtures.

