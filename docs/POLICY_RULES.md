# Policy Rules & Verdict Logic

How `POST /v1/inspect` turns a prompt (and its attachments) into a verdict:
`allow | redact | hold | deny`. This document describes the current,
as-shipped behaviour of `backend/app/policy/engine.py` (`decide()`) and
`backend/app/policy/rules.yaml` (the seed rows `decide()` is fed), plus every
detector and workflow that feeds into or comes out of it.

Source of truth: `backend/app/policy/engine.py`, `backend/app/policy/rules.yaml`,
`backend/app/main.py` (`inspect()`, `get_inspect_status()`). If this document
and the code ever disagree, the code wins — update this file to match.

---

## 1. Pipeline overview

```
prompt + attachments
        |
        v
  extract text from each attachment (M-extract: docx/pptx/xlsx/pdf/image/csv/txt)
        |
        v
  run every detector over EVERY document (prompt + each attachment)
        |
        +-- M2  RulesDetector       (regex, deterministic)
        +-- M8  EmbedDetector       (cosine similarity vs indexed internal docs)
        +-- M9  DebertaDetector     (fine-tuned two-head classifier)
        |
        v
  Classification (data_classes, spans, content_department, department_confidence)
        |
        v
  decide(classification, PolicyContext, rules.yaml rows)   <-- M3, pure function
        |
        v
  Verdict (decision, reason, spans_to_redact, require_purpose)
        |
        v
  redaction (M7, only if decision in {redact, hold, deny}) + audit log write
        |
        v
  response to caller: only "redact"/"allow" release content immediately;
  "hold" and "deny" withhold it (hold releases later via approval/timeout)
```

`decide()` itself never reads `rules.yaml`, calls a detector, or touches the
network/clock — it is a pure function of `(Classification, PolicyContext,
list[RuleRow])`. Everything detector- or I/O-shaped happens in
`backend/app/main.py` before/after that one call.

---

## 2. The three detectors

| # | Name | File | What it answers | Data classes it owns |
|---|------|------|------------------|-----------------------|
| M2 | `RulesDetector` | `app/detect/rules.py` | Deterministic pattern match | `MYKAD`, `EMAIL`, `PHONE`, `BANK_ACCT`, `SALARY`, `SECRET`, `PERSON` |
| M8 | `EmbedDetector` | `app/detect/embed.py` | "Does this resemble one of OUR indexed documents?" (cosine similarity) | `DEPT_CONFIDENTIAL` |
| M9 | `DebertaDetector` | `app/detect/deberta.py` | "Is this text confidential in nature?" (fine-tuned classifier, no corpus needed) | `DEPT_CONFIDENTIAL` |

M8 and M9 run behind one shared interface, `CompositeSemanticDetector`
(`app/detect/composite.py`), controlled by `SEMANTIC_DETECTOR` env var:
`m8` (default), `m9_deberta`, or `both` (both run in parallel, spans unioned
with overlap-dedup). **This repo's `.env` currently sets `SEMANTIC_DETECTOR=both`.**

Every span carries `detector` (`"rules" | "embed" | "deberta"`) so the policy
table can, per data class, judge M8's and M9's opinions on separate,
appropriately-scaled bands (see §4) instead of racing two differently-scaled
confidence numbers against one shared threshold.

### M9's two independent heads

M9 (`app/detect/deberta.py`) predicts, per sentence, **two unrelated things**
from one shared encoder:

- **Department head** — whose content this looks like (`finance`, `hr`,
  `legal`, `engineering`, `other`) + a confidence. Read via `classify()`.
  Never gates anything — always visible, even at low confidence.
- **Sensitivity head** — a boolean `is_confidential` + a confidence
  (`sensitivity_confidence`). This is the axis that actually produces
  `DEPT_CONFIDENTIAL` spans. Read via `classify_sensitivity()`.

`detect()` (the method that actually feeds `decide()`) only emits a span when
**both** are true: `is_confidential` AND `sensitivity_confidence >=
M9_CONFIDENCE_THRESHOLD` (env var, default `0.65`). Below that floor, M9 still
reports its raw score to the audit trail (`classify()`/`classify_sensitivity()`
are never gated) — it just doesn't get a policy vote.

M8 has no equivalent second axis: one cosine-similarity number serves both
"is this our document" and (via `content_department` on the matched chunk)
"whose document is it".

### Fusion for display (`content_department`)

`CompositeSemanticDetector.classify_debug()` combines M8's and M9's
department opinions into one `content_department` field shown in the
dashboard and audit log — **explainability-precedence, not "highest wins"**:
M8 and M9 agree → take the higher confidence of the two; disagree → M8 wins
(it points at a concrete matched document); M8 has no opinion (`null`/`other`/
`general`) → fall back to M9. This field is **display/log only** — see §5 for
whether it currently affects the verdict.

---

## 3. `Classification` → `decide()` inputs

Before `decide()` runs, `main.py` builds:

- **`data_classes`** — the set of `data_class` values across every span found
  in the prompt AND every attachment (so an attachment-only finding still
  reaches the policy table, even though only prompt spans are ever sliced
  back into `redacted_prompt`).
- **`spans`** — every span (prompt + attachment), each carrying its own
  `detector` and `confidence`.
- **`content_department` / `department_confidence`** — the fused M8/M9
  department opinion (§2), computed once from the *combined* prompt+attachment
  text, independent of `spans`.

And a `PolicyContext`:

| field | source | notes |
|---|---|---|
| `user_role` | `users` table, keyed by `user_id` | never trusts a client-supplied header |
| `department` | `users` table | |
| `ai_tool_tier` | `tools` table, keyed by `target_host` | `PUBLIC_AI \| ENTERPRISE_AI \| INTERNAL_AI` |
| `tool_status` | `tools` table | `approved \| unapproved`. Carried through but **no current rule matches on it** — reserved field |
| `purpose` | request body, default `"GENERAL"` | the "state & allow" attested category on a resubmit; every current rule row uses purpose `"*"`, so this doesn't yet discriminate a verdict either — reserved for future per-purpose rows |
| `target_host` | request body | e.g. `chatgpt.com`, `deepseek.com` |

An unrecognised `target_host` **auto-registers** on the fly as
`PUBLIC_AI` / `unapproved` (shadow-AI discovery, SD-7) and is never held on
that fact alone — only what `decide()` actually finds in the content matters.

---

## 4. `decide()` — how a verdict is picked

`backend/app/policy/engine.py`, pure, deterministic, no I/O.

### 4.1 Early exit

No `data_classes` at all → `allow`, unconditionally, before any rule is even
looked at.

### 4.2 Per-class, per-detector winner selection

For each `data_class` present:

1. Every rule whose `data_class`, `ai_tool_tier`, `user_role`, `purpose`, and
   `content_department` structurally match the request is a **candidate**
   (`"*"` wildcards match anything on that field).
2. Candidates are grouped by their `detector` field (`"*"`, `"embed"`,
   `"deberta"`).
3. **Within each group independently**: the group's own best span confidence
   for this class (from that detector only; a `"*"` rule falls back to the
   overall best confidence, including the `classification.confidence`
   fallback when there's no matching span at all) must clear a candidate's
   `min_confidence` to stay in play. Among survivors, the most specific rule
   wins (most non-wildcard fields; a detector-scoped rule counts as one more);
   a specificity tie breaks toward the higher `min_confidence`, then toward
   the stricter decision.
4. The class's **effective decision is the strictest** of every group's own
   winner. (This is why M8 and M9 each get an independent vote on the same
   class — see §4.4.)

A class with **no matching rule at all** defaults to `allow` and is reported
in the reason string as "defaulted to allow" — this is the mechanism that
gives M2 no policy voice at all (see §4.5).

### 4.3 Overall decision

The request's `final_decision` is the **strictest** decision across every
`data_class` present (`allow < redact < hold < deny`). `require_purpose` is
`True` if *any* winning rule across any class set it.

Two special cases:

- **`final_decision == "deny"`** → `require_purpose` is forced back to
  `False`. Never ask for a purpose on a request that's blocked regardless.
- **`ctx.purpose != "GENERAL"`** (a "state & allow" resubmit, §6) →
  `require_purpose` is forced to `False`. The purpose was already attested
  for this request; a `purpose: "*"` rule (which matches any attested value)
  must not ask again on the resubmit, or every such request would loop
  forever.

### 4.4 Why M8 and M9 each get an independent vote

M8's confidence is a cosine similarity; M9's is a softmax probability from a
different, differently-calibrated model. Blending them into one number would
let whichever detector happens to run "hotter" silently dominate. Instead,
`rules.yaml` carries **separate row-sets per detector** (see §5) on
different-looking bands (M8: 0.50/0.85/0.92, M9: 0.65/0.90/0.95), and the
class's outcome is whichever detector's own winner is stricter. In practice
this means: if either M8 *or* M9 independently clears a deny band, the
request is denied, even if the other detector found nothing at all.

### 4.5 The regex floor (M2's real protection)

M2 (`rules`-detector) spans have **no policy row of their own** — see §5.1 —
so on their own they'd default to `allow`. Instead, `decide()` applies a
structural floor **after** the table has decided everything else:

> Any span with `detector == "rules"` forces the decision from `allow` up to
> `redact`, unconditionally, regardless of tier, role, or purpose.

- On `allow` → upgraded to `redact`.
- On `hold` or `deny` → the decision is **left alone** (a human reviewer's
  call on DEPT_CONFIDENTIAL isn't weakened by an M2 hit alone), **but** the
  M2 spans are still merged into `spans_to_redact` regardless. This matters
  because hold's redaction is prepared *eagerly* (§6) — so if a hold is later
  approved or times out, whatever M2 found (a credential, a MyKad number) is
  already masked in what gets released. Nothing unredacted can ever leave
  once a hold clears, even though the M2 hit itself never escalated the
  decision.

Net effect: M2 always redacts what it finds; it never votes on hold/deny.
A leaked `SECRET` is redacted the same as a stray MyKad number — never
escalated — and carries no `require_purpose` gate (the floor doesn't set one).

### 4.6 `spans_to_redact`

Union of: every span whose class was decided `redact` by the table (§4.2),
plus every M2 (`rules`) span unconditionally (§4.5) — deduped by
`(start, end, data_class, detector, confidence)`, sorted by position.

---

## 5. `rules.yaml` — the seeded policy table

This file is **seed data, not runtime config**: it populates the
`policy_rules` table once via `reset_db.py`. After that, the table itself is
the source of truth, and `decide()` never reads the file directly — M1
fetches rows via `RuleRepo.all()` and hands them to `decide()` as plain data.
A compliance officer edits a **row**, not code, to change policy.

### 5.1 M2 classes: no policy voice, by design

`MYKAD`, `EMAIL`, `PHONE`, `PERSON`, `BANK_ACCT`, `SALARY`, `SECRET` have
**zero rows** in `rules.yaml`, on purpose. They rely entirely on the
structural regex floor (§4.5): always redacted, never escalated, no
`require_purpose`. `DEPT_CONFIDENTIAL` (M8/M9) is therefore the **only**
class with real policy rows, and the only thing that can push a request to
`hold` or `deny`.

### 5.2 The current bands

All rows below share `data_class: DEPT_CONFIDENTIAL`, `user_role: "*"`,
`purpose: "*"`. `min_confidence` is `>=` — an exact boundary value resolves to
the stricter band.

**PUBLIC_AI** (e.g. `chatgpt.com`, `gemini.google.com`, an auto-registered
shadow-AI host):

| detector | `>= min_confidence` | decision | `require_purpose` |
|---|---|---|---|
| `embed` (M8) | 0.50 | allow | ✅ (state & allow) |
| `embed` (M8) | 0.85 | hold | ✅ |
| `embed` (M8) | 0.92 | deny | — |
| `deberta` (M9) | 0.65 | allow | ✅ |
| `deberta` (M9) | 0.90 | hold | ✅ |
| `deberta` (M9) | 0.95 | deny | — |

Below 0.50 (M8) / 0.65 (M9): no row matches that detector's group at all →
that detector's own contribution defaults to allow.

**ENTERPRISE_AI** (a company-licensed/enterprise-tier AI tool) — one notch
looser: no hold/deny band at all, same-department. Only:

| detector | `>= min_confidence` | decision | `require_purpose` |
|---|---|---|---|
| `embed` (M8) | 0.50 | allow | ✅ |
| `deberta` (M9) | 0.65 | allow | ✅ |

**INTERNAL_AI** (the org's own internal assistant): no rows at all →
`DEPT_CONFIDENTIAL` always resolves to `allow` regardless of confidence. The
most-trusted tier is untouched by any of this.

### 5.3 Worked examples (PUBLIC_AI)

| Scenario | M8 conf. | M9 conf. | Per-detector winners | Verdict |
|---|---|---|---|---|
| Nothing resembles indexed docs, model says non-confidential | 0.10 | 0.20 | neither clears its floor | **allow** |
| Mild resemblance only | 0.60 | 0.30 | embed → allow+justify; deberta → no match | **allow**, `require_purpose=True` |
| M8 mid-high similarity | 0.88 | 0.40 | embed → hold+justify; deberta → no match | **hold**, `require_purpose=True` |
| M8 near-verbatim match | 0.94 | 0.50 | embed → deny; deberta → no match | **deny** |
| M8 quiet, M9 very confident it's confidential | 0.30 | 0.96 | embed → no match; deberta → deny | **deny** (M9 alone is enough) |
| M2 credential present, DEPT_CONFIDENTIAL clean | — | — | DEPT_CONFIDENTIAL → allow (no data class present) | regex floor still fires → **redact** (M2 span only) |
| M2 credential present AND M8 hold-band match | 0.88 | — | DEPT_CONFIDENTIAL → hold | **hold** (M2 span carried into the prepared redaction, released when the hold clears — see §4.5/§6) |

### 5.4 Cross-department mismatch: currently display-only

`content_department` (§2) is computed and shown on every request — dashboard
column, `GET /v1/logs?cross_department_only=true` filter — **but it currently
has no effect on the verdict**. The engine (`_content_department_matches` in
`engine.py`) still fully supports a `content_department: "@cross"` rule value
that would match whenever `Classification.content_department` is set and
differs from the requester's own department, and such a row would outrank a
same-department `"*"` row at the same confidence (one more non-wildcard
field) — escalating the tier by one notch (e.g. hold → deny). **No such rows
are seeded in `rules.yaml` right now.** This was deliberately turned off:
an engineer reading HR-indexed content today lands on exactly the same band
as an HR employee reading the same content, at the same confidence — only the
`content_department` field on the audit row differs. Re-adding `@cross` rows
(a short, documented block already exists as a comment in `rules.yaml`)
brings escalation back without any engine change.

---

## 6. What happens after the verdict

| Decision | Released to caller now? | Audit `status` | Notes |
|---|---|---|---|
| `allow` | yes, prompt as-is | `auto` | nothing detected, or nothing matched a rule |
| `redact` | yes, with `spans_to_redact` masked | `auto` | M2 floor and/or a `redact`-tier DEPT_CONFIDENTIAL rule (none currently seeded — redact only ever comes from the M2 floor today) |
| `hold` | **no** | `pending` | redaction is prepared eagerly (§4.5) but withheld; unblocked by human approval or lazy timeout (below) |
| `deny` | **no**, ever | `auto` | blocked outright; the audit row still stores the redacted (never raw) text, per SD-1 |

### Hold → release

- **Human review**: `POST /v1/logs/{log_id}/decision` with `approve: true`
  (optionally a `remark`) sets `status: approved`. From then on,
  `GET /v1/inspect/{log_id}` returns the prepared `redacted_prompt` — the
  *same* prepared redaction computed at inspect time, not a fresh M7 pass.
  `approve: false` sets `status: denied`; nothing is ever released.
- **Lazy timeout**: no scheduler. The next time anyone calls
  `GET /v1/inspect/{log_id}` on a still-`pending` record older than
  `HOLD_TIMEOUT_SECONDS` (env var, default `600`), it's auto-approved as
  `DASHBOARD_ADMIN` with remark `"auto: hold timeout -> redact"`, and the same
  prepared redaction is released. Both paths converge on the exact same code
  path in `get_inspect_status()` — a manual approval and a timeout release
  identical content.

### "State & allow" (`require_purpose`)

A rule with `require_purpose: true` doesn't block the request outright — the
client is expected to show a purpose picker (business-category dropdown +
free-text justification) and resubmit the *same* request with `purpose` set
to the attested category and `justification` filled in. `existing_log_id` on
the resubmit means the second pass **updates the same audit row**
(`AuditRepo.update_pending`) rather than creating a second one. Because a
resubmitted request has `ctx.purpose != "GENERAL"`, §4.3's second special
case suppresses `require_purpose` on the second pass, so the picker isn't
shown again for a rule matching `purpose: "*"`.

---

## 7. Known limitations / not-yet-calibrated

- **Thresholds are starting points, not a calibrated policy.** Every band in
  §5.2 reuses placeholder numbers; they have not been validated against a
  gold evaluation set. Recalibrate before relying on them in production (see
  `.env.example`).
- **M9 is occasionally confidently wrong.** The real fine-tuned DeBERTa
  artifact can report `sensitivity_confidence` well above 0.90 on genuinely
  harmless text. `M9_CONFIDENCE_THRESHOLD` (§2) only filters near-boundary
  noise — it cannot filter a high-confidence false positive, since raising
  the floor high enough to exclude it would also exclude legitimate
  high-confidence detections. This is model-calibration/training-data work,
  not a policy-table or engine defect.
- **`tool_status` and specific `purpose` values are wired through but
  currently inert** — no seeded rule discriminates on either field today.
  Both are reserved extension points for future rows (e.g. "hold only for
  `unapproved` tools", or a purpose-specific band).
- **Cross-department escalation is implemented but disabled** — see §5.4.
