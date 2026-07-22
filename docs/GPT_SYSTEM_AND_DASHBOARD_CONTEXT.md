# AI Governance Gateway — System and Dashboard Context

## How to use this brief

This document gives product and data context for an AI-assisted UI redesign of
the **AI Governance Gateway employer dashboard**.

Please focus on improving the information experience, interaction model,
hierarchy and visual system. Do **not** assume the current page structure,
component arrangement or visual styling is a constraint. Preserve the product
meaning, the available data and the important user actions described below.

This is a browser-boundary governance product, not an AI chat application.
It does not replace ChatGPT, Gemini or Copilot. It helps an organisation
inspect employee requests before those requests are sent to external AI tools.

## Product in one sentence

AI Governance Gateway monitors AI usage in the browser, detects sensitive or
confidential information in prompts and attachments, applies policy, records
an audit trail, and gives compliance administrators a place to review held
requests, configure policy, manage internal reference documents and govern AI
tools.

## Primary users

### Employee

- Uses a supported web AI tool in Chrome, such as ChatGPT or Gemini.
- Writes a prompt and may attach a file.
- The extension checks the content before it is submitted.
- Receives an outcome: allow, redact, hold, deny, or a request to provide a
  business purpose/justification.

### Compliance administrator

- Uses the employer dashboard.
- Monitors organisation-wide AI risk and usage.
- Reviews and approves or rejects held requests.
- Investigates individual audit events and detector evidence.
- Maintains policy rules, structured-detection patterns and redaction classes.
- Uploads internal documents used for semantic similarity detection.
- Reviews discovered AI hosts, including potential shadow-AI usage.

## End-to-end system flow

```text
Employee in Chrome
  -> Chrome extension observes a supported AI-tool interaction
  -> FastAPI inspection service
  -> detectors and policy engine
  -> decision: allow | redact | hold | deny | require purpose
  -> audit record in PostgreSQL + pgvector
  -> employer dashboard polls live data

For a hold:
  administrator reviews it in the dashboard
  -> approve/release or deny
  -> extension receives the result and updates the employee flow
```

## Decision meanings

| Outcome | Meaning |
| --- | --- |
| **Allow** | The request can be sent without a content change. |
| **Redact** | Sensitive values are replaced with safe tokens before sending; the audit trail keeps audit-safe content. |
| **Hold** | The request is not sent. It waits for a compliance administrator decision. It can later be approved/released or denied. A hold can also auto-downgrade to a prepared redaction after a configured timeout. |
| **Deny** | The request is blocked and is not sent to the AI tool. |
| **Require purpose** | A lower-risk confidential request needs the employee to state a purpose and optional free-text justification before the policy can continue. |

## Core backend modules and what they contribute

| Module | Role | Data exposed to the dashboard |
| --- | --- | --- |
| M0 | PostgreSQL persistence layer | Audit events, policy configuration, AI tools, internal-document chunks. |
| M1 | FastAPI API | Dashboard data and administrator actions. |
| M2 | Deterministic/regex detector | Data classes such as MYKAD, EMAIL, PHONE, PERSON, BANK_ACCT, SALARY and API_KEY. |
| M3 | Table-driven policy engine | The rule that produced an outcome, including thresholds, purpose requirements and cross-department behaviour. |
| M4 | Chrome extension | Intercepts supported prompt/file flows and records AI-host visits. |
| M5 | File extraction and redaction | Extracts text from supported attachments; produces a redacted replacement where applicable. |
| M7 | Tokenisation vault | Supports reversible safe tokenisation for redacted content. |
| M8 | Semantic similarity detector | Compares a prompt/attachment with indexed internal-document chunks using embeddings and pgvector. |
| M9 | Optional DeBERTa classifier | Predicts content department and confidential sensitivity; it is optional and depends on local model artifacts. |

## Data and policy concepts

### Detection data classes

M2 can identify organisation-configured structured classes. Existing examples
include:

- MYKAD
- EMAIL
- PHONE
- PERSON
- BANK_ACCT
- SALARY
- API_KEY

Administrators can add, edit and remove the regex patterns that define these
classes. They can also choose which detected classes are always redacted.

### Confidential/internal-document detection

M8 compares submitted content against an indexed corpus of internal documents.
If a sufficiently similar internal document is found, the system can emit a
class such as `DEPT_CONFIDENTIAL`, provide the likely department and a
confidence score, then let policy decide the final outcome.

M9 can separately provide:

- a predicted content department and confidence; and
- a confidential-sensitivity confidence.

### Department risk

The system distinguishes:

- **User department**: the employee's home department.
- **Content department**: the department that the content appears to concern.
- **Department confidence**: confidence in the content-department attribution.
- **Cross-department event**: content department differs from user department
  with confidence above the configured threshold.

Cross-department activity is a higher-risk context and may cause stricter
policy outcomes.

### AI tools and shadow AI

Each AI host has:

- host/domain;
- tier: `PUBLIC_AI`, `ENTERPRISE_AI` or `INTERNAL_AI`;
- governance status: `approved`, `unapproved` or `blocked`;
- first-seen time;
- prompt-inspection usage count;
- extension-detected visit count;
- catalog status: known or unlisted/other.

The extension has real-time prompt enforcement on customised supported sites
(currently ChatGPT and Gemini). Other detected AI hosts can still be recorded
and governed for visibility, but an approval/block decision does not magically
enable deep prompt inspection on a non-integrated site. This distinction is
important to communicate clearly in the product.

### Attachment handling

- Prompts may include a single attachment in the current dashboard data model.
- Supported files can be extracted and inspected before submission.
- If redaction is needed, the extension can use a prepared redacted copy.
- Audit and approval views can download the stored attachment associated with
  an event (the redacted copy when redaction was applied, otherwise original).
- Internal-document upload is different: original corpus files are **not
  retained after indexing**. Only extracted chunks and embeddings are stored.

## Dashboard-wide behaviour

- The dashboard is a demo compliance login, currently represented as a
  compliance administrator.
- It polls backend data approximately every 3 seconds rather than using
  WebSockets.
- A health indicator reflects whether the backend is reachable and whether
  modules are mocked.
- Most areas should support empty, loading and API-error states because this
  is live operational data.
- The dashboard is expected to work with both low-volume demo data and a
  larger future audit history.

## Dashboard navigation and page inventory

The product has four top-level destinations:

1. Overview
2. Audit Log
3. Approval Queue
4. Policy & Tools

Policy & Tools has four functional sections:

1. Policy Rules
2. Redaction
3. Internal Documents
4. AI Tools

The following sections describe **what information and actions must be
available**, without prescribing any layout.

---

## 1. Overview

### Purpose

Give a compliance administrator a near-real-time picture of AI usage, policy
outcomes, active risk, tool governance and work needing attention.

### Data shown

#### Outcome totals

Counts and percentage share of all audit events for:

- Allow
- Redact
- Hold
- Deny

For Hold, also show the number of events currently pending administrator
review. Each outcome should explain its operational meaning: sent, protected,
waiting for review or blocked.

#### Verdict activity over time

For the latest seven days, show daily counts split by allow, redact, hold and
deny. This should make changes in risk volume and decision mix visible.

#### Attention required

Operational callouts for:

- number of pending reviews, with a route to the Approval Queue;
- number of unapproved AI tools, plus shadow-AI visit count, with a route to
  AI Tools;
- number of cross-department events, with a route to the Audit Log.

#### Top detected data classes

The most frequently detected sensitive data classes over the last seven days,
with counts. Examples can include API_KEY, MYKAD, SALARY, EMAIL or
DEPT_CONFIDENTIAL.

#### Top users by risk events

Users ranked by events with Redact, Hold or Deny outcomes. This is a risk
activity count, not a judgement of employee intent.

#### AI tool usage

Usage by host/domain across both:

- real prompt inspections; and
- detected shadow-AI visits.

The administrator can filter this view by tool governance status: all,
approved, unapproved or blocked.

#### Recent high-risk activity

Latest events with Hold, Redact or Deny outcomes. For every event the
available summary data is:

- timestamp;
- employee/user and department;
- target host and tool tier;
- detected data classes;
- prompt excerpt or attachment filename;
- verdict;
- review status.

The administrator needs a way to go from this summary to full audit detail.

---

## 2. Audit Log

### Purpose

Provide an evidence trail for every inspected AI request, regardless of
whether it was allowed, redacted, held or denied. It is the main investigation
surface.

### Summary data

Show aggregate counts and percentages for Allow, Redact, Hold and Deny.

### Search/filter needs

The administrator can filter audit events by:

- verdict: all, allow, redact, hold or deny;
- review status: all, auto, pending, approved or denied;
- cross-department only;
- page of results.

### Event-list data

Each audit record can provide:

- timestamp;
- event/log ID;
- user ID;
- user department;
- target host;
- AI tool tier;
- request type: prompt or attachment/file;
- short audit-safe prompt excerpt or attachment filename;
- prompt character count;
- detected data classes;
- user department → content department;
- cross-department state and confidence;
- M8 predicted department and confidence;
- M9 predicted department, department confidence and sensitivity confidence;
- employee purpose;
- final verdict;
- review status.

### Selected-event detail

Selecting an event should reveal the full compliance evidence. Data available
for a selected event:

#### Overview/basic information

- event ID;
- timestamp;
- employee/user;
- user department;
- target host;
- AI tool tier;
- request type;
- character count.

#### Full prompt

- Full audit-safe prompt text.
- For a redacted request, this is the redacted/audit-safe version rather than
  an unsafe raw copy.

#### Attachment

If present:

- filename;
- download action;
- the download is the redacted prepared copy if redaction occurred, otherwise
  the original attachment.

#### Policy decision

- final verdict;
- human-readable policy reason.

#### Purpose and justification

- employee-selected purpose category;
- employee free-text justification, when supplied.

#### Departments

- user department;
- content department and confidence;
- cross-department yes/no and confidence when applicable.

#### Detection evidence

- M2 structured detections/data-class list;
- M8 similarity department and confidence;
- M9 predicted department, confidence and sensitivity score.

#### Review information

- review status;
- reviewer identity;
- reviewed timestamp;
- reviewer remark.

### Audit actions

For an event still pending review, the dashboard can provide:

- optional reviewer remark (up to 500 characters);
- approve and release;
- deny.

Completed/automatic decisions remain visible for investigation but are not
normally re-decided.

---

## 3. Approval Queue

### Purpose

Provide a focused work queue for requests that are currently on Hold. A held
request has **not been sent to the AI tool**. The administrator's decision is
sent back to the employee browser by polling, typically within a few seconds.

### Queue controls

- pending item count;
- sort: oldest first or newest first;
- cross-department-only filter;
- clear filters;
- a placeholder Queue Settings control exists, but no advanced queue-settings
  behaviour is currently implemented.

### Queue item data

Every pending item can show:

- age/time since created;
- employee/user ID;
- user department → content department;
- cross-department marker and confidence, if applicable;
- target AI host and its tier;
- prompt excerpt or attachment filename;
- attachment indicator;
- detected data-class pills.

### Selected pending-request evidence

The selected item exposes:

#### Basic information

- time;
- employee;
- user department;
- target host;
- AI tool tier.

#### Full prompt

- complete audit-safe prompt text.

#### Attachment

- attachment filename;
- download action;
- note that a prepared redacted copy is released if approved.

#### Policy decision

- hold verdict;
- policy reason.

#### Purpose and justification

- employee purpose;
- employee free-text justification.

#### Detection evidence

- M2 structured detections;
- M8 similarity department and confidence;
- M9 department confidence and separate sensitivity confidence.

#### Review information

- current review status;
- reviewer;
- reviewed time;
- reviewer remark.

### Approval actions

- optional reviewer remark, recorded in the audit log;
- deny request;
- approve and release.

---

## 4. Policy & Tools

### Purpose

This is the administrator configuration and governance area. Changes to
policy, M2 detection patterns and redaction classes take effect on the next
inspection request; no redeploy/restart is intended for these changes.

### 4A. Policy Rules

#### Purpose

Maintain the table-driven M3 policy rules that map context and detector output
to a decision.

#### Rule data

Each rule contains:

- data class;
- AI tool tier;
- user role;
- employee purpose;
- decision/verdict;
- minimum confidence;
- content department condition: a wildcard, a literal department, or a
  cross-department condition;
- detector scope: any, M8/embed or M9/DeBERTa;
- whether a purpose is required before the rule can continue.

For clarity, a rule may show separate applicable M8 and M9 threshold values.

#### Rule actions

- search by data class;
- filter by verdict;
- add a policy rule;
- edit a policy rule;
- delete a policy rule, with a clear warning that it changes live decisions.

### 4B. Redaction

#### Purpose

Maintain the deterministic M2 detector configuration and choose which detected
classes are always masked.

#### Detection patterns

Each regex pattern contains:

- display ID;
- data class;
- regex pattern;
- sequence/order within its data class;
- optional administrator remark.

Actions:

- add a pattern, including a brand-new data class;
- search by data class or pattern ID;
- edit a pattern;
- delete a pattern.

#### Always-redact classes

This is a separate list of data classes which should always be masked whenever
M2 detects them. A class must already have at least one detection pattern
before it can be added here.

Actions:

- add an existing detectable data class to the redaction list;
- remove it from the redaction list;
- clearly explain the impact: removing it means matching content will no
  longer be masked or blocked by this redaction configuration.

### 4C. Internal Documents

#### Purpose

Manage the internal reference corpus used by M8 semantic similarity detection.
This corpus lets the product recognise content similar to confidential internal
documents even when the exact text is paraphrased.

#### Upload/index flow

Administrator provides:

- department: engineering, finance, HR or legal;
- document file.

Supported upload formats currently include PDF, DOCX, XLSX, PPTX and TXT.
The system extracts text, splits it into chunks and generates embeddings.
Uploading the same source is intended to replace its prior indexed source.

The user needs feedback that indexing succeeded, including source filename and
number of chunks created.

#### Important data-retention rule

The original file is **not retained after indexing**. The system stores only:

- source filename;
- department;
- text chunks;
- embeddings;
- creation/indexing timestamps.

#### Indexed-source list

Each indexed source can show:

- source filename and file type;
- department;
- number of chunks;
- latest indexed timestamp.

Actions and filters:

- select the whole source to inspect it;
- search by source filename;
- filter by department.

#### Source detail and chunks

For a selected source show:

- filename and detected file type;
- department;
- indexed timestamp;
- number of chunks created;
- file-size value represented as “not retained”;
- list of extracted chunks.

Each chunk has:

- chunk number;
- character count;
- extracted text;
- creation timestamp.

Chunk body text should be collapsed by default and expanded deliberately by the
administrator, since documents may contain long or sensitive material.

### 4D. AI Tools

#### Purpose

Govern all AI hosts seen by the gateway and make potential shadow-AI activity
visible.

#### Summary data

- total AI tools;
- number unapproved;
- number blocked;
- total shadow-AI visits;
- usage share by host using both inspection usage and visit counts.

#### Tool-list data

Each host exposes:

- host/domain;
- known vs unlisted catalog state;
- AI tool tier;
- governance status;
- first-seen timestamp;
- combined usage count (prompt inspections + detected visits);
- optional administrator remark when making a decision.

#### Tool actions

- search by host;
- filter by status: all, approved, unapproved, blocked;
- approve a host;
- block a host.

For a shadow/unintegrated host, the product should clearly state that the
decision updates governance/audit status only; it does not activate real-time
prompt inspection on that site.

## Important UX and safety constraints for a redesign

- This is a compliance and security product. Users need confidence about what
  has or has not been sent to an AI tool.
- Never present a held request as if it has already been released.
- Preserve the distinction between an employee's identity department and the
  department inferred from content.
- Treat confidence as supporting evidence, not as an unexplained final answer.
- Audit prompt text may already be redacted. Do not imply that administrators
  are always viewing original raw sensitive content.
- Clearly distinguish stored audit attachments from internal corpus sources,
  whose original files are deliberately not retained.
- AI-tool approval/blocking and deep real-time enforcement are different
  capabilities for non-integrated shadow hosts.
- Keep destructive configuration actions (delete rule, delete regex pattern,
  remove a redaction class, block a tool) understandable and confirmable.
- Design for empty states, loading, API failure, long prompts, long filenames,
  many data-class tags and potentially very long extracted document chunks.

## Suggested handoff prompt for a design model

> Using the system and dashboard context in this document, propose a coherent
> redesign for the AI Governance Gateway employer dashboard. Prioritise clear
> operational triage, trustworthy evidence review, understandable policy
> configuration and a strong distinction between AI usage visibility and
> enforcement. Preserve every information type and action described in the
> brief, but feel free to rethink the structure and visual design completely.

