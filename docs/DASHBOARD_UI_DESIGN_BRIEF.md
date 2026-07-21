# AI Governance Gateway — Dashboard UI Design Brief

> **Purpose:** Give this document to a UI/UX or frontend-design assistant before discussing a redesign of the existing administrator dashboard. It describes the system as it actually works today, the Dashboard's current capabilities and data, and the boundaries a design must respect.

## 1. Product in one sentence

**AI Governance Gateway** is an enterprise compliance layer that checks an employee's prompt and attachments *before* they are sent to public AI websites such as ChatGPT, Gemini, or Copilot.

It is not an AI-chat product and does not replace ChatGPT/Gemini/Copilot. It controls the browser boundary around them.

## 2. The problem it solves

Employees can accidentally paste personal data, credentials, salaries, bank details, or confidential internal information into public AI tools. The gateway inspects the content before it leaves the organisation and produces one of four policy outcomes:

| Verdict | Meaning | Employee experience |
| --- | --- | --- |
| `allow` | No policy concern | Prompt is sent normally. |
| `redact` | Sensitive spans were found but a safe version can be sent | Sensitive values are replaced before send. |
| `hold` | Risk needs a compliance decision | Sending pauses; an administrator approves or denies it. |
| `deny` | The content must not be sent | Sending is blocked. |

Every inspection becomes an audit record. The administrator Dashboard is the control room for reviewing those records and managing the policy-adjacent data.

## 3. Whole-system architecture

```text
Employee on ChatGPT / Gemini / Copilot
        |
        | Chrome extension intercepts prompt + attachment before send
        v
FastAPI policy backend
  - file extraction and redaction
  - deterministic sensitive-data detection (M2)
  - policy engine (M3)
  - encrypted tokenisation vault (M7)
  - M8 internal-document similarity
  - M9 confidential-content classifier
        |
        +--> PostgreSQL + pgvector
        |      audit logs, tools, rules, token maps,
        |      internal-document chunks and embeddings
        |
        +--> Employer / compliance Dashboard
               review, reporting, approval, tool governance,
               M8 corpus upload and inspection
```

### Main components

| Component | Technology | Responsibility |
| --- | --- | --- |
| Browser extension | Chrome Manifest V3, TypeScript, Vite | Intercepts supported AI sites and applies the backend verdict before the original site receives the content. |
| Backend | Python FastAPI | Inspection API, policy decision, redaction, audit records, approval APIs, document indexing. |
| Database | PostgreSQL 16 + pgvector in Docker | Persistent operational data and M8 vector search. |
| Dashboard | React, TypeScript, Vite, Tailwind, Recharts | Compliance administrator interface. |
| M8 | `sentence-transformers/all-MiniLM-L6-v2` + pgvector | Finds content semantically similar to uploaded internal documents. |
| M9 | Fine-tuned DeBERTa-v3-small artifacts | Predicts content department and confidentiality severity. |

## 4. Detection and policy concepts

### M2 — deterministic sensitive-data detection

M2 detects structured sensitive values using rules/patterns. Important classes include:

- `MYKAD`
- `EMAIL`
- `PHONE`
- `PERSON`
- `BANK_ACCT`
- `SALARY`
- `SECRET` (for example, API credentials)

These are primarily a redaction floor: detected spans must be masked in redacted prompts, audit records and prepared release copies.

### M8 — internal-document similarity

An administrator uploads internal documents and chooses a department: `engineering`, `finance`, `hr`, or `legal`.

The backend extracts the document text, splits it into chunks, produces a 384-dimensional MiniLM embedding for each chunk, and stores the chunks plus embeddings in PostgreSQL pgvector. When an employee sends content, M8 compares it with those internal chunks. Relevant confidential similarity can produce `DEPT_CONFIDENTIAL`.

The original internal file is **not** stored by the M8 corpus; extracted chunks, source filename, department and embeddings are stored for explainability and retrieval.

### M9 — department and confidentiality classifier

M9 has two independent model outputs:

1. **Department attribution** — finance, HR, legal, engineering, or other.
2. **Confidentiality severity** — how likely the content is confidential.

The Dashboard must not collapse these into one ambiguous score. A reviewer needs to see both the predicted department and the confidentiality/sensitivity confidence.

### Cross-department risk

Each audit event may include:

- **User department:** the employee's department.
- **Content department:** the department the content appears to belong to.

When those differ and department confidence is above `0.60`, the event is cross-department. This escalates the policy by one tier and should be visually identifiable as a higher-risk context.

### Policy is configuration, not code

Policy rules map contextual inputs to a verdict, including:

- data class,
- target AI-tool tier (`PUBLIC_AI`, `ENTERPRISE_AI`, `INTERNAL_AI`),
- user role,
- stated purpose,
- detector source (`regex`, `embed`/M8, `deberta`/M9),
- verdict.

The current Dashboard **displays** policy rules but does not edit them. Do not design a policy editing workflow as if it already exists.

## 5. Users and primary workflows

### Employee

The employee uses the extension while working in ChatGPT, Gemini, or Copilot. The employee may be asked for a purpose and justification. The employee does not use the administrator Dashboard.

### Compliance administrator

The Dashboard user is a compliance officer or administrator. Current login is cosmetic/demo-only; there is no real identity or role-management feature. Every review decision is recorded as the demo administrator account.

The administrator needs to:

1. Understand current risk activity and trends.
2. Review and decide held prompts quickly.
3. Investigate past activity without exposing unnecessary sensitive content.
4. See which AI tools are being used, including unapproved “shadow AI”.
5. Approve or block a discovered AI host.
6. Upload and inspect the internal-document corpus used by M8.
7. Understand why a model/policy made a decision.

## 6. Current Dashboard behaviour

- The Dashboard polls backend endpoints every **3 seconds**; it does not use WebSockets or server-sent events.
- The global footer/health chip shows whether the backend is live, unreachable, or running any mocked modules.
- Current full-system health should show `semantic_detector: both` and `mocked: []`.
- Use a desktop-first operations-console layout. It should remain responsive but dense tables are valid because this is an administrator product.
- Current UI language is English.

## 7. Existing Dashboard pages and functions

### 7.1 Audit log

**Purpose:** The evidence trail for every prompt inspected by the gateway.

#### Existing functions

- Filters:
  - verdict: all / allow / redact / hold / deny;
  - review status: all / auto / pending / approved / denied;
  - cross-department-only toggle.
- Server-side pagination, 20 records per page.
- Click a row to expand it.
- Download the stored attachment from a record where one is available.
- Automatic refresh every 3 seconds.

#### Existing table data

| Field | Meaning |
| --- | --- |
| User | Employee identifier, for example `wei.eng@acme.my`. |
| Time | Inspection timestamp. |
| Target host | The AI site, e.g. `chatgpt.com`, `gemini.google.com`. |
| Prompt | An excerpt. If redaction happened, the record shows redacted text; original values belong in the encrypted vault. |
| Filename | Submitted attachment, when present; downloadable. |
| Data classes | Detected labels such as `MYKAD`, `SECRET`, `DEPT_CONFIDENTIAL`. |
| User department | The sender's department. |
| Content department | The model's department attribution plus confidence. |
| M8 | Raw M8 department and confidence. |
| M9 | M9 department confidence plus a separate confidentiality/sensitivity confidence. |
| Purpose | The employee's stated business purpose. |
| Verdict | `allow`, `redact`, `hold`, or `deny`. |
| Status | `auto`, `pending`, `approved`, or `denied`. |

#### Expanded-row data

- The policy reason, shown verbatim.
- Purpose.
- Cross-department confidence, when present.
- Reviewer, review time and reviewer remark, when a human decision has happened.

### 7.2 Approval queue

**Purpose:** Make a prompt-level decision for records currently in `pending` status.

#### Existing functions

- Shows only pending records, refreshed every 3 seconds.
- Administrator can enter an optional remark.
- Administrator can `Approve` or `Deny` each record.
- The employee's browser polls for this decision and is unblocked within approximately 3 seconds after approval.
- Approval releases the prepared redacted copy where needed; a human approval must not release a raw credential or PII value.

#### Data shown per pending item

- employee, target host and time;
- prompt text;
- data classes;
- current verdict and policy reason;
- employee's selected purpose;
- employee's free-text justification;
- reviewer remark input;
- approve/deny action.

### 7.3 Overview

**Purpose:** A fast compliance/risk overview.

#### Existing functions and visualisations

- Four KPI cards: Allow, Redact, Hold, Deny.
- Stacked bar chart: verdict volume by day.
- Horizontal bar chart: top detected data classes.
- Horizontal bar chart: top users by **risk events only**. Allowed prompts do not make a user riskier.

### 7.4 Policy & tools

This page has three independent areas.

#### A. Policy rules — read-only

The table shows:

- data class;
- AI tool tier;
- user role;
- purpose;
- detector;
- resulting verdict.

The design should make policy understandable and auditable. It must not imply that the current UI permits in-place policy editing.

#### B. Internal document corpus — M8

Existing functions:

- Choose a department: engineering, finance, HR or legal.
- Upload a document.
- Send it for extraction, chunking and indexing in pgvector.
- Show a success message with the indexed chunk count.
- Show indexed chunks grouped by source file.
- Expand a source file to inspect its chunk text.

Existing data per source:

- source filename;
- department;
- number of chunks;
- latest indexed date;
- individual chunk text and creation date in the expanded view.

#### C. AI tools / Shadow AI discovery

The gateway records every host it sees, including hosts not explicitly configured before an employee tries them.

Existing table data:

- host;
- tier;
- status: `approved`, `unapproved`, `blocked`;
- first seen timestamp;
- usage count;
- optional reviewer remark;
- `Approve` and `Block` actions.

Unapproved and blocked tools are intentionally sorted before approved tools. The UI should make their risk and action state obvious.

## 8. Core data model

### Audit record

```ts
type Decision = "allow" | "redact" | "hold" | "deny";
type LogStatus = "auto" | "pending" | "approved" | "denied";

interface AuditRecord {
  log_id: string;
  user_id: string;
  ts: string;
  target_host: string;
  prompt_text: string;
  filename: string | null;
  data_classes: string[];
  decision: Decision;
  reason: string;
  status: LogStatus;
  reviewer: string | null;
  reviewed_at: string | null;
  remark: string | null;
  user_department: string | null;
  content_department: string | null;
  department_confidence: number;
  purpose: string;
  justification: string | null;
  m8_department: string | null;
  m8_confidence: number;
  m9_department: string | null;
  m9_confidence: number;
  m9_sensitivity_confidence: number;
  cross_department_confidence: number | null;
}
```

### Other core types

```ts
interface RuleRow {
  data_class: string;
  ai_tool_tier: string;
  user_role: string;
  purpose: string;
  detector: string;
  decision: string;
}

interface AiTool {
  host: string;
  tier: "PUBLIC_AI" | "ENTERPRISE_AI" | "INTERNAL_AI";
  status: "approved" | "unapproved" | "blocked";
  approved_by: string | null;
  approved_at: string | null;
  first_seen: string;
  usage_count: number;
}

interface InternalDocChunk {
  id: string;
  source_file: string;
  department: string;
  chunk_text: string;
  created_at: string;
}
```

## 9. Current demo dataset snapshot

The currently running full system contains representative test/demo data. This is useful for realistic UI mockups, but must not be presented as live production telemetry.

| Metric | Current value |
| --- | --- |
| Audit events | 35 |
| Allow | 9 |
| Redact | 9 |
| Hold | 3 |
| Deny | 14 |
| Policy rules | 14 |
| Indexed M8 chunks | 10 |
| Example AI hosts | `chatgpt.com`, `gemini.google.com`, `copilot.microsoft.com` |
| Frequent data classes | `DEPT_CONFIDENTIAL`, `PERSON`, `MYKAD`, `SALARY`, `BANK_ACCT`, `EMAIL`, `PHONE`, `SECRET` |

Current internal-document source examples:

- `Fictional_HR_Internal_Employee_Salary_Register_June_2026.docx`
- `legal/settlement-strategy.docx`
- `hr/succession-plan.docx`
- `finance/fy2027-operating-forecast.xlsx`
- `engineering/2027-product-roadmap.docx`

## 10. UI design direction

### Desired character

- Professional enterprise governance and compliance tool.
- Calm, trustworthy and readable rather than “cybersecurity hacker” themed.
- Dense enough for operational work, with excellent hierarchy and progressive disclosure.
- Make actions, risk and explanation clear without requiring an administrator to interpret raw model internals.

### Suggested hierarchy

- Persistent left sidebar: brand, four pages, backend-live state.
- Top-level page header with concise operational description and page-specific actions.
- KPI and status cards for high-level risk orientation.
- Tables for evidence and management; tables must work well with many columns.
- A detail drawer, side panel, or expanded row for investigation rather than forcing all model details into the default table view.
- Clear empty, loading, backend-unreachable and mutation-success states.

### Risk colour semantics

| Meaning | Suggested colour |
| --- | --- |
| Allow | Green |
| Redact | Amber / orange |
| Hold | Purple or blue |
| Deny | Red |
| Cross-department escalation | Indigo |
| Backend unavailable | Neutral grey / clear error treatment |

### Information-security principles for the UI

- Do not surface raw values that the gateway redacted.
- Use excerpts in dense lists; show details only after deliberate expansion.
- Explain *why* something was classified without rendering raw embeddings or full ML internals by default.
- Make attachment downloads intentional and traceable in the experience.

## 11. Non-goals for this redesign

Do not assume or design these as current capabilities:

- real authentication, SSO, role management or employee administration;
- editing policy rules in the Dashboard;
- creating policy rules from scratch;
- billing, subscriptions or tenant management;
- chat, prompt authoring or an in-dashboard AI assistant;
- real-time push/WebSocket infrastructure;
- a separate vector database or model-management console;
- production claims about data quality, M9 calibration or identity security.

## 12. Suggested prompt for a UI design assistant

> Design a polished desktop-first React/Tailwind UI concept for the existing AI Governance Gateway administrator Dashboard. Preserve the four existing pages—Audit log, Approval queue, Overview, and Policy & tools—and the specific data/actions described in this document. Do not invent unbuilt functionality such as SSO, policy editing, user management, chat, or billing. Make it feel like a credible compliance operations console: clear risk severity, explainable M8/M9 signals, efficient approval decisions, dense but readable tables, and calm enterprise styling. First propose the information architecture and design system; then create page-by-page component layouts using realistic seeded mock data from this document.

