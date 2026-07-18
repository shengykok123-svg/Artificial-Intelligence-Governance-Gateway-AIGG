"""Generate a deterministic 1,000-row synthetic baseline dataset for M9.

This is trainable synthetic data for pipeline learning and a demo baseline. It
is not a replacement for expert-reviewed enterprise data or a basis for a
production-accuracy claim.
"""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from ml.m9_data import split_records, write_jsonl  # noqa: E402

OUTPUT_DIR = BACKEND_ROOT / "data" / "m9" / "synthetic_baseline"
ENTITIES = (
    "Atlas", "Cedar", "Delta", "Ember", "Falcon", "Harbour", "Iris", "Juniper", "Keystone", "Lumen", "Meridian",
)
PERIODS = ("Q1", "Q2", "Q3", "Q4", "the next fiscal year")
CONTEXTS = (
    "regional operations review", "customer-services planning cycle", "product-planning session",
    "quarterly leadership meeting", "annual planning workshop", "business-continuity exercise",
    "supplier-management review", "cross-functional steering group", "internal knowledge-sharing session",
    "operations improvement programme", "corporate planning calendar",
)

TEMPLATES: dict[tuple[str, bool], tuple[str, ...]] = {
    ("finance", True): (
        "The unreleased {period} forecast for {entity} projects a material revenue shortfall.",
        "Keep the internal {entity} pricing model confidential until the {period} board review.",
        "The draft cash-flow scenario for {entity} has not been shared outside finance.",
        "Do not send the unapproved {period} acquisition valuation for {entity} to external advisers.",
        "Treasury restricted the {entity} covenant headroom analysis for {period}.",
        "The finance leadership group is reviewing a private margin outlook for {entity}.",
        "The {period} budget variance for {entity} remains internal pending approval.",
        "The proposed funding allocation for {entity} is confidential until signed off.",
        "The board-only {period} profitability scenario relates to {entity}.",
        "The private financial model for {entity} includes unreleased operating assumptions.",
    ),
    ("finance", False): (
        "The {period} investor report publicly described revenue for {entity}.",
        "The public earnings call explained the financial results for {entity}.",
        "This public article gives general budgeting guidance using {entity} as an example.",
        "The published {period} annual report describes the financial position of {entity}.",
        "The investor-relations page lists public pricing information for {entity}.",
        "A public market summary discusses the reported performance of {entity}.",
        "The public financial FAQ explains how {entity} reports quarterly results.",
        "The approved press release announces a public funding milestone for {entity}.",
        "The public webinar explains the {period} financial outlook already released by {entity}.",
        "The published shareholder letter summarises public figures for {entity}.",
    ),
    ("hr", True): (
        "The manager recorded a private {period} performance rating for Employee {entity}.",
        "The hiring panel restricted the {period} interview feedback for Candidate {entity}.",
        "Please update the confidential salary adjustment for Employee {entity}.",
        "The disciplinary outcome for Employee {entity} has not been communicated yet.",
        "HR is reviewing a private leave accommodation request for Employee {entity}.",
        "The internal succession plan identifies Employee {entity} for a leadership role.",
        "The confidential payroll correction for Employee {entity} is pending approval.",
        "The {period} workforce plan contains a non-public headcount decision for {entity}.",
        "The employee grievance file for Employee {entity} is restricted to HR.",
        "The private manager notes discuss a performance-improvement plan for Employee {entity}.",
    ),
    ("hr", False): (
        "The public careers page for {entity} describes the interview process for applicants.",
        "The published {period} leave policy grants annual leave to eligible employees.",
        "This public guide explains general preparation for a job interview at {entity}.",
        "The public recruitment page for {entity} lists open roles and application steps.",
        "The employee handbook publicly explains the workplace wellbeing programme for {entity}.",
        "The public diversity statement describes the equal-opportunity policy for {entity}.",
        "A public HR FAQ explains how candidates may contact the recruitment team.",
        "The published training catalogue lists optional learning courses at {entity}.",
        "The public careers webinar explains general onboarding at {entity}.",
        "The public policy explains the annual leave process without naming employees.",
    ),
    ("legal", True): (
        "Counsel is reviewing the unexecuted {entity} agreement before the {period} signature deadline.",
        "The confidential settlement strategy for {entity} is not for distribution.",
        "The counterparty rejected a draft indemnity clause in the {entity} negotiation.",
        "Legal advice on the internal {entity} investigation remains privileged.",
        "The proposed {period} contract amendment for {entity} has not been accepted.",
        "The legal team is analysing private liability exposure for {entity}.",
        "The draft data-processing addendum for {entity} is restricted to counsel.",
        "The unreleased dispute assessment for {entity} contains legal strategy.",
        "Do not circulate the confidential negotiation notes for {entity}.",
        "The legal review of the {period} termination clause for {entity} is internal.",
    ),
    ("legal", False): (
        "The public {period} terms of service for {entity} are available on the website.",
        "This public article explains the general purpose of an indemnity clause for {entity}.",
        "The open-source {entity} project uses an MIT licence.",
        "The public policy for {entity} explains how customers may submit a complaint.",
        "The published {period} agreement template for {entity} is available for public download.",
        "A public legal FAQ explains the standard contract review process.",
        "The website publishes the privacy notice applicable to {entity}.",
        "The public compliance page summarises regulatory obligations for {entity}.",
        "The public announcement describes a completed legal filing by {entity}.",
        "This general guide explains how a public contract may be signed.",
    ),
    ("engineering", True): (
        "The {period} production {entity} service uses a non-public token rotation design.",
        "Investigate the private deployment script for the {entity} environment.",
        "The unreleased {entity} architecture diagram exposes internal network topology.",
        "The internal incident report for {entity} contains a vulnerability reproduction path.",
        "Do not share the {period} staging credential rotation plan for {entity}.",
        "The proprietary {entity} feature store design is restricted to engineering.",
        "The confidential {period} roadmap for {entity} includes unreleased security work.",
        "The private source module for {entity} contains the production scoring logic.",
        "The internal {entity} postmortem describes a non-public service failure.",
        "The engineering team restricted the {period} infrastructure configuration for {entity}.",
    ),
    ("engineering", False): (
        "The public API documentation for {entity} describes how to authenticate a request.",
        "This open-source {entity} repository explains how HTTPS encrypts traffic.",
        "The {period} published technical blog describes a general deployment pattern.",
        "The public product roadmap for {entity} lists features planned for next year.",
        "This {period} tutorial explains how to write a unit test in Python.",
        "The public developer guide for {entity} documents a standard webhook integration.",
        "The open-source {entity} example demonstrates a common API client pattern.",
        "The published engineering talk explains general cloud scaling concepts.",
        "The public status page for {entity} explains how users view service availability.",
        "This public documentation describes a general database migration process.",
    ),
    ("other", False): (
        "Rewrite the public {period} product launch announcement for {entity} in a more direct tone.",
        "Create an agenda for an open {entity} customer webinar next month.",
        "Summarise the {period} published sustainability report for a general audience.",
        "Explain the weather forecast for the {entity} office event tomorrow.",
        "Turn this {period} approved customer testimonial for {entity} into a social media caption.",
        "Suggest a title for a public blog post about workplace wellbeing at {entity}.",
        "Draft a friendly public welcome message for visitors to the {entity} event.",
        "Summarise a public museum opening announcement for the {period} newsletter.",
        "Create a short public checklist for planning a community event at {entity}.",
        "Rewrite a generic public FAQ answer about office opening hours for {entity}.",
        "Suggest a public social-media caption for the {period} volunteer event at {entity}.",
        "Create a neutral public summary of a community partnership involving {entity}.",
    ),
}


def _records_for(department: str, is_confidential: bool, count: int) -> list[dict[str, object]]:
    templates = TEMPLATES[(department, is_confidential)]
    rows: list[dict[str, object]] = []
    for index in range(count):
        template = templates[index % len(templates)]
        entity = ENTITIES[(index // len(templates)) % len(ENTITIES)]
        period = PERIODS[(index // (len(templates) * len(ENTITIES))) % len(PERIODS)]
        context = CONTEXTS[(index // len(templates)) % len(CONTEXTS)]
        sensitivity = "confidential" if is_confidential else "non_confidential"
        rows.append({
            "id": f"synthetic-{department}-{sensitivity}-{index + 1:03d}",
            "source_group": f"synthetic-{department}-{sensitivity}-scenario-{(index // 5) + 1:03d}",
            "text": f"{template.format(entity=entity, period=period)} It relates to the {context}.",
            "department": department,
            "is_confidential": is_confidential,
        })
    return rows


def build_records() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for department in ("finance", "hr", "legal", "engineering"):
        rows += _records_for(department, True, 110)
        rows += _records_for(department, False, 110)
    rows += _records_for("other", False, 120)
    if len(rows) != 1000 or len({row["text"] for row in rows}) != 1000:
        raise RuntimeError("Synthetic baseline must contain 1,000 unique records.")
    return rows


def main() -> None:
    records = build_records()
    for split_name, rows in split_records(records).items():
        write_jsonl(OUTPUT_DIR / f"{split_name}.jsonl", rows)
        print(f"Wrote {len(rows)} examples to {OUTPUT_DIR.relative_to(BACKEND_ROOT) / f'{split_name}.jsonl'}")


if __name__ == "__main__":
    main()
