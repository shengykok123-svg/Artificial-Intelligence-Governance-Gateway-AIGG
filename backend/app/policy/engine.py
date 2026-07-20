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
#
# M10: DEPT_CONFIDENTIAL (and any future class) can be judged by more than
# one semantic detector, and M8's cosine similarity is not on the same scale
# as M9's joint softmax probability. A rule now carries an optional
# `detector` dimension ("*" | "embed" | "deberta"). Per data_class, matching
# candidates are partitioned by that field and a winner is picked
# independently within each detector's group (own best-confidence, own
# min_confidence gate); the class's effective outcome is the strictest of
# those per-detector winners. A "*" rule is detector-agnostic, exactly as
# before, and keeps falling back to classification.confidence when this
# class has no prompt span.
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


def _detector_confidence(
    data_class: str, detector: str, classification: Classification,
) -> float:
    """Per-detector best confidence for a `detector != "*"` rule: the max
    confidence of spans of this class THAT DETECTOR emitted, or 0.0 if it
    emitted none (the rule then fails min_confidence and simply does not
    match -- the classification.confidence fallback is a "*"-rule-only
    behaviour)."""
    if detector == "*":
        return _best_confidence(data_class, classification)
    class_confidences = [
        s.confidence for s in classification.spans
        if s.data_class == data_class and s.detector == detector
    ]
    return max(class_confidences) if class_confidences else 0.0


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


def _structurally_matches(
    rule: RuleRow, data_class: str, ctx: PolicyContext, classification: Classification,
) -> bool:
    """Everything about a rule except its detector/min_confidence gate --
    those are evaluated per detector-group by the caller."""
    if rule.data_class != data_class:
        return False
    if rule.ai_tool_tier != "*" and rule.ai_tool_tier != ctx.ai_tool_tier:
        return False
    if rule.user_role != "*" and rule.user_role != ctx.user_role:
        return False
    if rule.purpose != "*" and rule.purpose != ctx.purpose:
        return False
    return _content_department_matches(rule.content_department, classification, ctx)


def _specificity(rule: RuleRow) -> int:
    """Count of non-wildcard fields. @cross/a literal content_department
    counts as non-wildcard, and so does a detector-scoped rule; data_class
    is always an exact match and is not counted (every candidate already
    matches it)."""
    return (
        (rule.ai_tool_tier != "*")
        + (rule.user_role != "*")
        + (rule.purpose != "*")
        + (rule.content_department != "*")
        + (rule.detector != "*")
    )


def _pick_winner(candidates: list[RuleRow]) -> RuleRow:
    """Most specific wins; a higher min_confidence breaks a specificity tie;
    the stricter decision breaks whatever tie remains."""
    return max(
        candidates,
        key=lambda r: (_specificity(r), r.min_confidence, _STRICTNESS[r.decision]),
    )


def _per_class_winners(
    data_class: str, ctx: PolicyContext, classification: Classification,
    rules: list[RuleRow],
) -> tuple[list[RuleRow], float]:
    """Group structurally-matching rules by detector, pick a winner
    independently in each group (subject to that group's own min_confidence
    gate), and return every group's winner plus the best confidence seen
    across all of them (for the reason string). Empty list -> no candidate,
    the class defaults to allow."""
    structural = [
        rule for rule in rules
        if _structurally_matches(rule, data_class, ctx, classification)
    ]
    groups: dict[str, list[RuleRow]] = {}
    for rule in structural:
        groups.setdefault(rule.detector, []).append(rule)

    winners: list[RuleRow] = []
    best_conf_overall = 0.0
    for detector, group_rules in groups.items():
        best_conf = _detector_confidence(data_class, detector, classification)
        satisfying = [r for r in group_rules if best_conf >= r.min_confidence]
        if not satisfying:
            continue
        winners.append(_pick_winner(satisfying))
        best_conf_overall = max(best_conf_overall, best_conf)

    return winners, best_conf_overall


def _build_reason(
    per_class_winners: dict[str, list[RuleRow]],
    best_confs: dict[str, float],
    classification: Classification,
    final_decision: str,
    require_purpose: bool,
    unmatched_classes: list[str],
    pre_floor_decision: str,
    floor_upgraded: bool,
) -> str:
    deciding_classes: list[str] = []
    deciding_detectors: set[str] = set()
    for data_class, winners in per_class_winners.items():
        deciding = [w for w in winners if w.decision == pre_floor_decision]
        if not deciding:
            continue
        deciding_classes.append(data_class)
        deciding_detectors.update(w.detector for w in deciding if w.detector != "*")

    # per_class_winners always has at least one key here -- decide() only
    # calls _build_reason when classification.data_classes is non-empty.
    deciding_classes = sorted(deciding_classes or per_class_winners.keys())

    if deciding_detectors:
        detector_str = "/".join(sorted(deciding_detectors))
    else:
        detectors = sorted({
            span.detector for span in classification.spans
            if span.data_class in deciding_classes
        })
        detector_str = "/".join(detectors) if detectors else "document-level"

    confidence = max((best_confs[c] for c in deciding_classes), default=0.0)

    sentence = (
        f"{', '.join(deciding_classes)} detected via {detector_str} "
        f"(confidence {confidence:.2f}) -> {pre_floor_decision}."
    )
    parts = [sentence]
    if unmatched_classes:
        parts.append(
            f"No policy rule matched {', '.join(sorted(unmatched_classes))}; "
            "defaulted to allow."
        )
    if floor_upgraded:
        parts.append(
            f"{pre_floor_decision} -> {final_decision}; regex floor upgraded to redact."
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

    per_class_winners: dict[str, list[RuleRow]] = {}
    best_confs: dict[str, float] = {}
    unmatched_classes: list[str] = []

    for data_class in classification.data_classes:
        winners, best_conf = _per_class_winners(data_class, ctx, classification, rules)
        per_class_winners[data_class] = winners
        best_confs[data_class] = best_conf if winners else _best_confidence(data_class, classification)
        if not winners:
            unmatched_classes.append(data_class)

    final_decision = "allow"
    require_purpose = False
    redact_classes: set[str] = set()

    for data_class, winners in per_class_winners.items():
        decision_for_class = "allow"
        for winner in winners:
            if _STRICTNESS[winner.decision] > _STRICTNESS[decision_for_class]:
                decision_for_class = winner.decision
            if winner.require_purpose:
                require_purpose = True
        if decision_for_class == "redact":
            redact_classes.add(data_class)
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

    pre_floor_decision = final_decision

    # REGEX FLOOR: whatever the table decided, a regex (M2) span is never
    # forwarded to the outgoing document unredacted. This is a structural
    # backstop -- rules.yaml's regex rows already redact at every tier, so
    # this only bites when no row matched (e.g. an unlisted class/tier
    # combination) yet M2 still fired.
    regex_spans = [span for span in classification.spans if span.detector == "rules"]
    floor_upgraded = bool(regex_spans) and final_decision == "allow"
    if floor_upgraded:
        final_decision = "redact"

    if final_decision == "redact":
        redact_spans = [
            span for span in classification.spans if span.data_class in redact_classes
        ]
        seen: set[tuple[int, int, str, str, float]] = set()
        spans_to_redact: list[Span] = []
        for span in redact_spans + regex_spans:
            key = (span.start, span.end, span.data_class, span.detector, span.confidence)
            if key in seen:
                continue
            seen.add(key)
            spans_to_redact.append(span)
        spans_to_redact.sort(key=lambda s: (s.start, s.end))
    else:
        # hold and deny: nothing is forwarded on those verdicts, so there is
        # nothing to mask.
        spans_to_redact = []

    reason = _build_reason(
        per_class_winners, best_confs, classification,
        final_decision, require_purpose, unmatched_classes,
        pre_floor_decision, floor_upgraded,
    )

    return Verdict(
        decision=final_decision,
        reason=reason,
        spans_to_redact=spans_to_redact,
        require_purpose=require_purpose,
    )
