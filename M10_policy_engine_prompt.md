# M10 — paste-ready prompt (per-detector policy tiers, M8-precedence fusion, regex redaction floor)

Fresh session. Paste **Part 1** (context block), then **Part 2** (task).

After this lands: DEPT_CONFIDENTIAL is decided per-detector (M8 and M9 each
have their own calibrated ≥-threshold table, strictest action wins),
department fusion follows the explainability-first rule (M8 > M9 > null),
regex-detected sensitive data is ALWAYS redacted in the outgoing document
regardless of tier, cross-department mismatch carries NO policy action
(display/log only), and the audit record carries both raw M8 and M9
classify outputs.

---

## Part 1 — CONTEXT BLOCK

```
PROJECT
AI Governance Gateway. A Chrome extension plus a FastAPI policy plane that
inspects prompts and file attachments before they reach ChatGPT, Gemini or
Copilot. Verdicts: allow | redact | hold | deny, plus a require_purpose
flag ("justification required"). Every event lands in an auditable log.

CURRENT STATE
M0-M9 are built and real. M3 (backend/app/policy/engine.py) is a pure,
table-driven decide(classification, ctx, rules) -> Verdict. Rules live in
the policy_rules table (seeded once from backend/app/policy/rules.yaml).
M8 (EmbedDetector, cosine similarity vs pgvector internal-doc chunks) and
M9 (DebertaDetector, two-head sensitivity+department probabilities) run
behind CompositeSemanticDetector, which unions spans with overlap dedup and
currently fuses classify() by picking the higher-confidence opinion.

WHY THIS CHANGE
(a) M8's confidence is a cosine similarity; M9's is a joint softmax
probability. They are NOT on the same scale, so one detector-agnostic
min_confidence tier silently miscalibrates one of them (an M9 span at 0.93
currently satisfies rules meant for M8's >=0.92 band). Rules gain an
optional `detector` dimension; decide() evaluates DEPT_CONFIDENTIAL once
per detector present and takes the strictest outcome.
(b) classify() fusion switches from "higher confidence wins" to the
explainability-precedence rule (agreement -> max conf; disagreement ->
M8; M8 null -> M9; both null -> null).
(c) Regex (M2) becomes an unconditional redaction floor: whatever the
final verdict is, regex-detected structured data never leaves unredacted.
(d) Cross-department mismatch is demoted from a hold rule to a logged
display value only.
(e) Audit records gain the raw M8 and M9 classify outputs.

REPO LAYOUT (only touch the marked files)
  backend/app/policy/engine.py     per-detector eval + regex floor <- YOU (main)
  backend/app/policy/rules.yaml    rewritten rule set              <- YOU
  backend/app/detect/composite.py  classify() fusion rule          <- YOU
  backend/app/models.py            PolicyRule.detector, AuditLog   <- YOU
  backend/app/repo/base.py         RuleRow.detector, AuditRecord   <- YOU
  backend/app/repo/memory.py       mirror the field changes        <- YOU
  backend/app/repo/postgres.py     mirror + migration              <- YOU
  backend/app/schemas.py           M8/M9 raw outputs in response   <- YOU
  backend/app/seed.py              yaml loader for detector col    <- YOU
  backend/app/main.py              log both classify outputs       <- YOU
  backend/tests/test_policy_engine.py  new tier/fusion/floor tests <- YOU
  dashboard/src/                   show M8/M9 columns              <- YOU (minor)

FROZEN CONTRACTS — never change these shapes
  backend/app/detect/base.py  Span, Document, Classification, Detector,
                              DocumentClassifier. Span.start/end are real
                              offsets into ONE Document.text.
  PolicyContext(user_role, department, ai_tool_tier, tool_status,
                purpose, target_host)   # frozen dataclass, keep as is
  Verdict(decision, reason, spans_to_redact, require_purpose)

PIPELINE ORDER — DELIBERATE DECISION, DO NOT "FIX"
  All detectors (M2 regex, M8, M9) run on the ORIGINAL raw text in
  parallel. M8/M9 must see unredacted text: the pgvector index was
  embedded from raw internal documents, so tokenised input would lower
  similarity to exactly the documents we must catch. Regex is the "top
  layer" in OUTPUT terms only: its spans are always redacted in the
  final outgoing document, regardless of tier or verdict (see REGEX
  FLOOR below). The raw text never leaves the gateway either way.

BOUNDARY CONVENTION (applies to every threshold in this task)
  All tiers are ">=" thresholds. An exact boundary value resolves to the
  STRICTER band: M8 0.85 is hold-band, M8 0.92 is deny-band, M9 0.90 is
  hold-band, M9 0.95 is deny-band. Below the lowest threshold of a table
  the class simply matches no row -> allow (existing no-candidate
  default). Do NOT add explicit allow-at-0.0 rows.
```

---

## Part 2 — TASK

### 1. Department fusion (composite.py)

Replace `CompositeSemanticDetector.classify()`'s max-by-confidence pick
with the precedence rule:

```
m8_dept, m8_conf = embed.classify(doc)
m9_dept, m9_conf = deberta.classify(doc)

if m8_dept == m9_dept and m8_dept is not None:
    -> (m8_dept, max(m8_conf, m9_conf))     # agreement: max confidence
elif m8_dept is not None:
    -> (m8_dept, m8_conf)                    # disagreement: M8 wins
                                             # (similarity to a concrete
                                             # indexed doc is explainable;
                                             # a softmax label is not)
elif m9_dept is not None:
    -> (m9_dept, m9_conf)                    # M8 null/general: adopt M9
else:
    -> (None, 0.0)                           # both null
```

Treat an M8 result of `""`, `"other"`, or `"general"` the same as None.
Add `classify_debug(doc)` returning `(fused, m8_raw, m9_raw)` so main.py
logs raw outputs without running the models twice. `classify()` keeps
returning only the fused tuple — the DocumentClassifier protocol is
untouched.

### 2. Rule schema: optional `detector` dimension

Add `detector: str = "*"` to RuleRow / PolicyRule / seed loader /
memory + postgres repos (default `"*"` = detector-agnostic; every
existing `"*"` row keeps its exact current semantics). Valid values:
`"*" | "embed" | "deberta"`.

### 3. decide(): per-detector evaluation + regex redaction floor

Per-detector evaluation, for each data_class:

- Partition matching candidates by their `detector` field.
- For a candidate with `detector != "*"`, best_conf is the max confidence
  of spans of that class emitted by THAT detector only (0.0 if that
  detector emitted none — the rule then fails min_confidence and does not
  match). The `classification.confidence` fallback applies only to
  `detector: "*"` rules, as today.
- Pick a winner independently per detector value present (`embed`,
  `deberta`, `"*"`), then the class's effective outcome is the STRICTEST
  decision among those winners (deny > hold > redact > allow);
  require_purpose is OR'd across them.
- Cross-class strictness max, purpose clearing on deny, and clearing on
  already-attested purpose are unchanged.

REGEX FLOOR (new, after the final decision is computed):

- Let regex_spans = every span in classification.spans with
  detector == "rules".
- If regex_spans is non-empty and final_decision == "allow", upgrade
  final_decision to "redact".
- Whenever final_decision == "redact", spans_to_redact = the union of
  (spans of classes whose winning rule said redact) and regex_spans,
  deduped. hold and deny keep spans_to_redact == [] as today (nothing
  is forwarded on those verdicts, so there is nothing to mask).
- Reflect the floor in the reason string when it changed the outcome,
  e.g. "... -> allow; regex floor upgraded to redact."

`_specificity` counts `detector != "*"` as one more non-wildcard field.
`_build_reason`: a detector-scoped deciding rule names its detector,
e.g. `DEPT_CONFIDENTIAL detected via embed (similarity 0.94) -> deny.`

Delete `_content_department_matches`'s `@cross` branch and the
content_department match dimension entirely ONLY IF no seed row uses it
after step 4; otherwise leave the mechanism in place but unused (safer —
a compliance officer can re-add a cross row later without a release,
which is the whole point of the row-driven design). Prefer: keep the
mechanism, remove the row.

### 4. rules.yaml: full rewrite of the rule set

Replace the current rules with the set below. Update the header comment:
deny now also covers >=0.92 M8 similarity (near-verbatim internal-document
exfiltration — redaction cannot fix that) and regex classes are a
redaction floor at every tier, enforced by the engine. Note in the PR
description that live systems need the row edits applied to the
policy_rules table (seed is not runtime config).

```yaml
rules:
  # ---------- REGEX CLASSES: redaction floor at EVERY tier -------------
  # The engine also enforces this floor structurally (any "rules"-detector
  # span forces at least redact); these rows make the table read as the
  # complete intended policy.
  - {data_class: MYKAD,     ai_tool_tier: "*", user_role: "*", purpose: "*", decision: redact}
  - {data_class: EMAIL,     ai_tool_tier: "*", user_role: "*", purpose: "*", decision: redact}
  - {data_class: PHONE,     ai_tool_tier: "*", user_role: "*", purpose: "*", decision: redact}
  - {data_class: PERSON,    ai_tool_tier: "*", user_role: "*", purpose: "*", decision: redact}
  - {data_class: BANK_ACCT, ai_tool_tier: "*", user_role: "*", purpose: "*", decision: redact}
  - {data_class: SALARY,    ai_tool_tier: "*", user_role: "*", purpose: "*",
     decision: redact, require_purpose: true}

  # SECRET: deny on the external boundary (leaked credential = incident,
  # rotate the key); redact inside the tenant / internal boundary.
  - {data_class: SECRET, ai_tool_tier: PUBLIC_AI,     user_role: "*", purpose: "*", decision: deny}
  - {data_class: SECRET, ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*", decision: redact}
  - {data_class: SECRET, ai_tool_tier: INTERNAL_AI,   user_role: "*", purpose: "*", decision: redact}

  # ---------- DEPT_CONFIDENTIAL, PUBLIC_AI: per-detector tiers ---------
  # M8 = cosine similarity vs indexed internal docs ("is this OUR doc?")
  #   < 0.50 allow (no row) | >=0.50 allow+justify | >=0.85 hold+justify
  #   | >=0.92 deny
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     detector: embed, min_confidence: 0.50, decision: allow, require_purpose: true}
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     detector: embed, min_confidence: 0.85, decision: hold,  require_purpose: true}
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     detector: embed, min_confidence: 0.92, decision: deny}

  # M9 = joint sensitivity+department probability ("confidential in nature?")
  #   < 0.65 allow (no row) | >=0.65 allow+justify | >=0.90 hold+justify
  #   | >=0.95 deny
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     detector: deberta, min_confidence: 0.65, decision: allow, require_purpose: true}
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     detector: deberta, min_confidence: 0.90, decision: hold,  require_purpose: true}
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: PUBLIC_AI, user_role: "*", purpose: "*",
     detector: deberta, min_confidence: 0.95, decision: deny}

  # ---------- DEPT_CONFIDENTIAL, ENTERPRISE_AI: one notch looser -------
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*",
     detector: embed,   min_confidence: 0.50, decision: allow, require_purpose: true}
  - {data_class: DEPT_CONFIDENTIAL, ai_tool_tier: ENTERPRISE_AI, user_role: "*", purpose: "*",
     detector: deberta, min_confidence: 0.65, decision: allow, require_purpose: true}

  # NO cross-department rule: cross-dept mismatch is display/log only.
  # The @cross mechanism stays in the engine so a row can re-enable it
  # without a release.
  # INTERNAL_AI DEPT_CONFIDENTIAL: allow (no row needed).
```

NOTE (deliberate behaviour changes vs the old table — confirm in review):
- ENTERPRISE_AI previously ALLOWED raw MYKAD/EMAIL/PHONE/PERSON and gave
  hr/finance raw SALARY and finance raw BANK_ACCT. The regex floor removes
  those exemptions: those values are now tokenised on every tier. The
  vault (M7) redaction is reversible, so no information is destroyed.
- DEPT_CONFIDENTIAL can now DENY on PUBLIC_AI (M8 >= 0.92 / M9 >= 0.95).

### 5. Audit record + response + dashboard

- AuditRecord / AuditLog / InspectResponse gain nullable fields:
  `m8_department: str | None`, `m8_confidence: float`,
  `m9_department: str | None`, `m9_confidence: float`,
  populated from `classify_debug()` in main.py. Postgres: additive
  migration, nullable columns, no backfill.
- Keep the fused `content_department` / `department_confidence` fields
  exactly as they are.
- When fused content_department is set and != the requester's department,
  also log `cross_department_confidence = max(m8_confidence,
  m9_confidence)` (display/analytics only — it drives NO decision).
- Dashboard: audit detail view shows two extra columns
  (M8 dept@conf, M9 dept@conf) and the cross-dept badge when
  cross_department_confidence is present. Minor change only.

### 6. Tests (backend/tests/test_policy_engine.py + composite tests)

Table-driven; stub sub-detectors via the _SemanticSubDetector protocol —
never load real models.

fusion:
  agree(finance,0.6 / finance,0.9)        -> (finance, 0.9)
  disagree(finance,0.55 / hr,0.99)        -> (finance, 0.55)   # M8 wins
  m8 None, m9 (hr,0.8)                    -> (hr, 0.8)
  m8 ("other",0.7), m9 (legal,0.66)       -> (legal, 0.66)
  both None                               -> (None, 0.0)

tiers (PUBLIC_AI, spans carry detector):
  embed 0.49                              -> allow, no purpose
  embed 0.50                              -> allow + require_purpose
  embed 0.85                              -> hold + require_purpose      # boundary -> stricter
  embed 0.92                              -> deny (purpose flag cleared) # boundary -> stricter
  deberta 0.93                            -> hold (NOT deny — own scale)
  deberta 0.95                            -> deny                        # boundary -> stricter
  embed 0.86 AND deberta 0.96             -> deny (strictest wins)
  deberta 0.66, purpose already attested  -> allow, require_purpose False
  content_department != user's dept, embed 0.86
                                          -> hold (from the tier row, NOT
                                             from any cross rule; assert no
                                             @cross row exists)

regex floor:
  MYKAD span on ENTERPRISE_AI            -> redact (was allow before)
  SALARY span, role=hr, ENTERPRISE_AI    -> redact + require_purpose
  MYKAD span on INTERNAL_AI              -> redact
  regex EMAIL + embed 0.60 on PUBLIC_AI  -> redact, require_purpose True,
                                            spans_to_redact includes the
                                            EMAIL span
  regex EMAIL + embed 0.93 on PUBLIC_AI  -> deny, spans_to_redact == []
  SECRET on PUBLIC_AI                    -> deny (unchanged)

audit:
  inspect response + audit row carry m8_/m9_ fields matching the stub
  outputs; cross_department_confidence == max(m8,m9) when depts mismatch,
  absent otherwise.

Run the full suite; the ONLY expected regressions are the deleted
ENTERPRISE_AI allow-row tests, which must be updated to expect redact.
```
