# M3  decide(classification, ctx, rules) -> verdict. Pure. Rules arrive as an argument; M3 NEVER reads rules.yaml.
#
# The two dataclasses below are frozen contract, added by M1 so the rest of
# the backend can construct a PolicyContext and receive a Verdict before M3
# exists. M3's author adds decide() beneath them and does not touch these.

from __future__ import annotations

from dataclasses import dataclass

from app.detect.base import Classification, Span
from app.repo.base import RuleRow


@dataclass(frozen=True)
class PolicyContext:
    user_role: str
    department: str
    ai_tool_tier: str
    tool_status: str
    purpose: str
    target_host: str


@dataclass(frozen=True)
class Verdict:
    decision: str                        # allow | redact | hold | deny
    reason: str
    spans_to_redact: list[Span]
    require_purpose: bool = False        # "state & allow" flag


__all__ = ["PolicyContext", "Verdict", "decide"]


# --------------------------------------------------------------------------
# decide() -- table-driven, deterministic, pure. No I/O, no yaml read, no env
# read, no clock read except through arguments.
# --------------------------------------------------------------------------

_STRICTNESS = {"allow": 1, "redact": 2, "hold": 3, "deny": 4}


def _best_confidence(data_class: str, classification: Classification) -> float:
    """Max confidence of PROMPT spans for this class; attachment-only
    classes (no prompt span) fall back to the overall max span confidence."""
    class_confidences = [
        s.confidence for s in classification.spans if s.data_class == data_class
    ]
    if class_confidences:
        return max(class_confidences)
    return classification.confidence


def _content_department_matches(
    rule_content_department: str, classification: Classification, ctx: PolicyContext,
) -> bool:
    if rule_content_department == "*":
        return True
    if rule_content_department == "@cross":
        return (
            classification.content_department is not None
            and classification.content_department != ctx.department
        )
    return classification.content_department == rule_content_department


def _rule_matches(
    rule: RuleRow, data_class: str, ctx: PolicyContext,
    classification: Classification, best_conf: float,
) -> bool:
    if rule.data_class != data_class:
        return False
    if rule.ai_tool_tier != "*" and rule.ai_tool_tier != ctx.ai_tool_tier:
        return False
    if rule.user_role != "*" and rule.user_role != ctx.user_role:
        return False
    if rule.purpose != "*" and rule.purpose != ctx.purpose:
        return False
    if best_conf < rule.min_confidence:
        return False
    return _content_department_matches(rule.content_department, classification, ctx)


def _specificity(rule: RuleRow) -> int:
    """Count of non-wildcard fields. @cross/a literal content_department
    counts as non-wildcard; data_class is always an exact match and is not
    counted (every candidate already matches it)."""
    return (
        (rule.ai_tool_tier != "*")
        + (rule.user_role != "*")
        + (rule.purpose != "*")
        + (rule.content_department != "*")
    )


def _pick_winner(candidates: list[RuleRow]) -> RuleRow:
    """Most specific wins; a higher min_confidence breaks a specificity tie;
    the stricter decision breaks whatever tie remains."""
    return max(
        candidates,
        key=lambda r: (_specificity(r), r.min_confidence, _STRICTNESS[r.decision]),
    )


def _build_reason(
    per_class_winners: dict[str, RuleRow | None],
    best_confs: dict[str, float],
    classification: Classification,
    final_decision: str,
    require_purpose: bool,
    unmatched_classes: list[str],
) -> str:
    deciding = sorted(
        data_class
        for data_class, rule in per_class_winners.items()
        if (rule.decision if rule is not None else "allow") == final_decision
    )
    if not deciding:
        deciding = sorted(per_class_winners.keys())

    detectors = sorted({
        span.detector for span in classification.spans if span.data_class in deciding
    })
    detector_str = "/".join(detectors) if detectors else "document-level"
    confidence = max((best_confs[c] for c in deciding), default=0.0)

    sentence = (
        f"{', '.join(deciding)} detected via {detector_str} "
        f"(confidence {confidence:.2f}) -> {final_decision}."
    )
    parts = [sentence]
    if unmatched_classes:
        parts.append(
            f"No policy rule matched {', '.join(sorted(unmatched_classes))}; "
            "defaulted to allow."
        )
    if require_purpose:
        parts.append("purpose attestation required.")
    return " ".join(parts)


def decide(
    classification: Classification, ctx: PolicyContext, rules: list[RuleRow],
) -> Verdict:
    if not classification.data_classes:
        return Verdict(
            decision="allow",
            reason="No sensitive data class detected.",
            spans_to_redact=[],
            require_purpose=False,
        )

    per_class_winners: dict[str, RuleRow | None] = {}
    best_confs: dict[str, float] = {}
    unmatched_classes: list[str] = []

    for data_class in classification.data_classes:
        best_conf = _best_confidence(data_class, classification)
        best_confs[data_class] = best_conf
        candidates = [
            rule for rule in rules
            if _rule_matches(rule, data_class, ctx, classification, best_conf)
        ]
        if candidates:
            per_class_winners[data_class] = _pick_winner(candidates)
        else:
            per_class_winners[data_class] = None
            unmatched_classes.append(data_class)

    final_decision = "allow"
    require_purpose = False
    redact_classes: set[str] = set()

    for data_class, rule in per_class_winners.items():
        decision_for_class = rule.decision if rule is not None else "allow"
        if decision_for_class == "redact":
            redact_classes.add(data_class)
        if rule is not None and rule.require_purpose:
            require_purpose = True
        if _STRICTNESS[decision_for_class] > _STRICTNESS[final_decision]:
            final_decision = decision_for_class

    if final_decision == "deny":
        # Never ask for a purpose on a request that will be blocked
        # regardless.
        require_purpose = False
    elif ctx.purpose != "GENERAL":
        # "State & allow": the state has already been attested for this
        # request. A require_purpose rule asks once, not on every purpose
        # value forever -- without this, a rule with purpose: "*" (matches
        # any attested purpose) would demand one again on pass 2, denying
        # every such request outright regardless of what was just stated.
        require_purpose = False

    spans_to_redact = (
        [span for span in classification.spans if span.data_class in redact_classes]
        if final_decision == "redact"
        else []
    )

    reason = _build_reason(
        per_class_winners, best_confs, classification,
        final_decision, require_purpose, unmatched_classes,
    )

    return Verdict(
        decision=final_decision,
        reason=reason,
        spans_to_redact=spans_to_redact,
        require_purpose=require_purpose,
    )
