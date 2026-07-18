"""Generate review-only, privacy-safe M9 annotation candidates.

The output is deliberately *not* a training set. Every generated record is
marked ``needs_review`` and must be reviewed by two people before promotion.
"""
from __future__ import annotations

import csv
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = BACKEND_ROOT / "data" / "m9" / "review" / "m9_annotation_candidates.csv"
COUNT_PER_BUCKET = 25

BUCKETS: tuple[tuple[str, bool, tuple[str, ...], str], ...] = (
    ("finance", True, (
        "The unreleased {period} forecast projects a {amount} shortfall for {project}.",
        "Keep the {period} draft pricing model for {project} inside the finance leadership group.",
        "The board-only cash-flow scenario assumes a {amount} reduction in {period} revenue.",
        "Do not share the {period} unapproved acquisition valuation for {project} with external advisers.",
        "Treasury has not released the internal covenant headroom analysis for {period}.",
    ), "Internal or unreleased financial forecast, valuation, pricing, or decision."),
    ("finance", False, (
        "The company published {period} revenue in its investor report.",
        "The public earnings call explained the financial results for {project}.",
        "This article gives general advice about budgeting for {period}.",
        "The {period} annual report publicly describes the company financial position.",
        "The investor-relations page lists publicly released pricing information for {project}.",
    ), "Finance topic, but public or generic rather than internal."),
    ("hr", True, (
        "The manager recorded a private {period} performance rating for {person}.",
        "The hiring panel restricted the {period} interview feedback for {person}.",
        "Please update the confidential {period} salary adjustment for {person}.",
        "The {period} disciplinary outcome for {person} has not been communicated yet.",
        "HR is reviewing the {period} private leave accommodation request for {person}.",
    ), "Internal identifiable employee, performance, salary, hiring, or leave information."),
    ("hr", False, (
        "The public careers page describes the {period} interview process for applicants.",
        "The published {period} leave policy grants annual leave to eligible employees.",
        "This guide explains general preparation for a {period} job interview.",
        "The public recruitment page for {project} lists open roles and application steps.",
        "The employee handbook publicly explains the {period} workplace wellbeing programme.",
    ), "HR topic, but public policy or general guidance."),
    ("legal", True, (
        "Counsel is reviewing the {period} unexecuted {project} agreement before signature.",
        "The {period} confidential settlement strategy for {project} is not for distribution.",
        "The counterparty rejected a {period} draft indemnity clause in the ongoing negotiation.",
        "Legal advice on the {period} internal investigation remains privileged.",
        "The {period} proposed contract amendment has not been accepted by the customer.",
    ), "Unreleased contract, negotiation, legal advice, investigation, or strategy."),
    ("legal", False, (
        "The public {period} terms of service are available on the company website.",
        "This article explains the general purpose of an indemnity clause for {project}.",
        "The open-source {project} uses an MIT licence.",
        "The public policy for {project} explains how customers may submit a complaint.",
        "The {period} published agreement template is available for public download.",
    ), "Legal topic, but public or general explanatory content."),
    ("engineering", True, (
        "The {period} production {project} service uses a non-public token rotation design.",
        "Investigate the {period} private deployment script for the {project} environment.",
        "The {period} unreleased architecture diagram exposes internal network topology.",
        "The {period} internal incident report contains a security vulnerability reproduction path.",
        "Do not share the {period} staging credential rotation plan outside the engineering team.",
    ), "Non-public technical architecture, credential, vulnerability, incident, or roadmap detail."),
    ("engineering", False, (
        "The public API documentation for {project} describes how to authenticate a request.",
        "This open-source {project} repository explains how HTTPS encrypts traffic.",
        "The {period} published technical blog describes a general deployment pattern.",
        "The public product roadmap for {project} lists features planned for next year.",
        "This {period} tutorial explains how to write a unit test in Python.",
    ), "Engineering topic, but public documentation or generic guidance."),
    ("other", False, (
        "Rewrite the public {period} product launch announcement in a more direct tone.",
        "Create an agenda for an open {project} customer webinar next month.",
        "Summarise the {period} published sustainability report for a general audience.",
        "Explain the weather forecast for the {project} office event tomorrow.",
        "Turn this {period} approved customer testimonial into a short social media caption.",
    ), "No department-specific governance risk for this MVP."),
)

PERIODS = ("Q1", "Q2", "Q3", "Q4", "the next fiscal year")
AMOUNTS = ("RM 1 million", "RM 2 million", "12%", "18%", "25%")
PROJECTS = ("Project Atlas", "Project Cedar", "Project Delta", "Project Nimbus", "Project Orion")
PEOPLE = ("Employee A", "Employee B", "Candidate C", "Manager D", "Contractor E")


def render(template: str, index: int) -> str:
    template_index = index % 5
    period_index = (index // 5) % len(PERIODS)
    amount_index = (index // 25) % len(AMOUNTS)
    entity_index = (period_index * 2 + template_index + amount_index) % len(PROJECTS)
    return template.format(
        period=PERIODS[period_index],
        amount=AMOUNTS[amount_index],
        project=PROJECTS[entity_index],
        person=PEOPLE[entity_index],
    )


def build_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for department, is_confidential, templates, rationale in BUCKETS:
        sensitivity = "confidential" if is_confidential else "non_confidential"
        for index in range(COUNT_PER_BUCKET):
            rows.append({
                "id": f"candidate-{department}-{sensitivity}-{index + 1:03d}",
                "source_group": f"synthetic-{department}-{sensitivity}-batch-{(index // 5) + 1:02d}",
                "text": render(templates[index % len(templates)], index),
                "department": department,
                "is_confidential": str(is_confidential).lower(),
                "rationale": rationale,
                "source_type": "synthetic_team_scenario",
                "review_status": "needs_review",
                "reviewer_1": "",
                "reviewer_2": "",
                "notes": "Generated candidate: revise wording, labels, and rationale if needed.",
            })
    return rows


def main() -> None:
    rows = build_rows()
    texts = [row["text"] for row in rows]
    if len(texts) != len(set(texts)):
        raise RuntimeError("Candidate generator produced duplicate text; revise templates before review.")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} review-only candidates to {OUTPUT_PATH.relative_to(BACKEND_ROOT)}")


if __name__ == "__main__":
    main()
