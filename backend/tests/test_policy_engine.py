# M3  Table-driven case per rule, strictest-wins tie-break, wildcard fallback.

from __future__ import annotations

from app.detect.base import Classification, Span
from app.policy.engine import PolicyContext, decide
from app.repo.base import RuleRow
from app.seed import load_rules_yaml

RULES = load_rules_yaml()

CTX_PUBLIC = PolicyContext(user_role="staff", department="engineering",
                           ai_tool_tier="PUBLIC_AI", tool_status="approved",
                           purpose="GENERAL", target_host="chatgpt.com")


def _classification(data_class: str, confidence: float, *,
                    content_department: str | None = None,
                    department_confidence: float = 0.0,
                    detector: str = "rules") -> tuple[Classification, Span]:
    span = Span(start=0, end=10, data_class=data_class,
               detector=detector, confidence=confidence)
    c = Classification(data_classes=[data_class], confidence=confidence,
                       spans=[span], content_department=content_department,
                       department_confidence=department_confidence)
    return c, span


# --------------------------------------------------------------------------
# 1. MYKAD @ PUBLIC_AI ⇒ redact, spans_to_redact == the MYKAD spans.
# --------------------------------------------------------------------------

def test_mykad_public_ai_redacts_and_returns_its_spans():
    c, span = _classification("MYKAD", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]
    assert verdict.require_purpose is False


# --------------------------------------------------------------------------
# 2. SECRET @ PUBLIC_AI ⇒ deny, require_purpose False even if another
#    matched rule set it, spans_to_redact empty.
#    SALARY @ PUBLIC_AI ⇒ redact + require_purpose True.
# --------------------------------------------------------------------------

def test_secret_denies_and_forces_require_purpose_false_even_with_salary():
    secret_span = Span(start=0, end=5, data_class="SECRET",
                       detector="rules", confidence=1.0)
    salary_span = Span(start=10, end=18, data_class="SALARY",
                       detector="rules", confidence=1.0)
    c = Classification(data_classes=["SECRET", "SALARY"], confidence=1.0,
                       spans=[secret_span, salary_span],
                       content_department=None, department_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "deny"
    assert verdict.require_purpose is False   # SALARY's row sets it; deny wins
    assert verdict.spans_to_redact == []


def test_salary_public_ai_redacts_with_require_purpose():
    c, span = _classification("SALARY", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == [span]


# --------------------------------------------------------------------------
# 3. EMAIL + SECRET ⇒ deny (strictest wins).
# --------------------------------------------------------------------------

def test_email_and_secret_strictest_wins_deny():
    email_span = Span(start=0, end=7, data_class="EMAIL",
                      detector="rules", confidence=1.0)
    secret_span = Span(start=10, end=15, data_class="SECRET",
                       detector="rules", confidence=1.0)
    c = Classification(data_classes=["EMAIL", "SECRET"], confidence=1.0,
                       spans=[email_span, secret_span],
                       content_department=None, department_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "deny"


# --------------------------------------------------------------------------
# 4. DEPT_CONFIDENTIAL conf 0.74 ⇒ allow + require_purpose True.
# --------------------------------------------------------------------------

def test_dept_confidential_mid_confidence_state_and_allow():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.74,
                               content_department="engineering",
                               department_confidence=0.74, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is True


# --------------------------------------------------------------------------
# 5. DEPT_CONFIDENTIAL conf 0.91, content_department == ctx.department ⇒
#    redact + require_purpose True (0.85 tier out-ranks 0.65 tier).
# --------------------------------------------------------------------------

def test_dept_confidential_high_confidence_same_department_redacts():
    c, span = _classification("DEPT_CONFIDENTIAL", 0.91,
                              content_department="engineering",
                              department_confidence=0.91, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == [span]


# --------------------------------------------------------------------------
# 6. DEPT_CONFIDENTIAL conf 0.91, content finance, ctx.department marketing
#    ⇒ hold (@cross beats the redact row on specificity).
# --------------------------------------------------------------------------

def test_dept_confidential_high_confidence_cross_department_holds():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.91,
                               content_department="finance",
                               department_confidence=0.91, detector="embed")
    ctx = PolicyContext(user_role="staff", department="marketing",
                        ai_tool_tier="PUBLIC_AI", tool_status="approved",
                        purpose="GENERAL", target_host="chatgpt.com")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "hold"
    assert verdict.require_purpose is False
    assert verdict.spans_to_redact == []


# --------------------------------------------------------------------------
# 7. SALARY @ ENTERPRISE_AI, role hr ⇒ allow (specific beats wildcard).
# --------------------------------------------------------------------------

def test_salary_enterprise_ai_hr_role_allows():
    c, _span = _classification("SALARY", 1.0)
    ctx = PolicyContext(user_role="hr", department="hr",
                        ai_tool_tier="ENTERPRISE_AI", tool_status="approved",
                        purpose="GENERAL", target_host="enterprise.example")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "allow"


# --------------------------------------------------------------------------
# 8. No spans ⇒ allow, require_purpose False.
# --------------------------------------------------------------------------

def test_no_data_classes_allows():
    c = Classification(data_classes=[], confidence=0.0, spans=[],
                       content_department=None, department_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is False
    assert verdict.spans_to_redact == []
    assert verdict.reason == "No sensitive data class detected."


# --------------------------------------------------------------------------
# 9. Same inputs twice ⇒ identical Verdict (purity/determinism).
# --------------------------------------------------------------------------

def test_decide_is_pure_and_deterministic():
    c, _span = _classification("SALARY", 1.0)
    v1 = decide(c, CTX_PUBLIC, RULES)
    v2 = decide(c, CTX_PUBLIC, RULES)
    assert v1 == v2


# --------------------------------------------------------------------------
# 10. Unknown data_class with no rule ⇒ allow, reason mentions it.
# --------------------------------------------------------------------------

def test_unknown_class_for_tier_allows_and_mentions_it():
    # INTERNAL_AI has no PERSON row -- "everything else: allow, no row
    # needed" per rules.yaml. This is the no-candidate path, not a match.
    c, _span = _classification("PERSON", 1.0)
    ctx = PolicyContext(user_role="staff", department="engineering",
                        ai_tool_tier="INTERNAL_AI", tool_status="approved",
                        purpose="GENERAL", target_host="internal.example")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "allow"
    assert "PERSON" in verdict.reason


# --------------------------------------------------------------------------
# Extra: the matching/specificity/tie-break algorithm in isolation, so this
# suite does not depend entirely on rules.yaml's exact current shape.
# --------------------------------------------------------------------------

def test_specificity_more_non_wildcard_fields_wins():
    rules = [
        RuleRow(data_class="MYKAD", ai_tool_tier="*", user_role="*",
                purpose="*", decision="allow"),
        RuleRow(data_class="MYKAD", ai_tool_tier="PUBLIC_AI", user_role="*",
                purpose="*", decision="redact"),
    ]
    c, _span = _classification("MYKAD", 1.0)
    verdict = decide(c, CTX_PUBLIC, rules)
    assert verdict.decision == "redact"


def test_min_confidence_excludes_a_candidate_leaving_no_candidate_path():
    rules = [
        RuleRow(data_class="DEPT_CONFIDENTIAL", ai_tool_tier="*",
                user_role="*", purpose="*", decision="hold",
                min_confidence=0.9),
    ]
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.5, detector="embed")
    verdict = decide(c, CTX_PUBLIC, rules)
    assert verdict.decision == "allow"


def test_literal_content_department_must_equal_exactly():
    rules = [
        RuleRow(data_class="DEPT_CONFIDENTIAL", ai_tool_tier="*",
                user_role="*", purpose="*", decision="hold",
                content_department="finance"),
    ]
    matching, _span = _classification("DEPT_CONFIDENTIAL", 0.9,
                                      content_department="finance",
                                      detector="embed")
    mismatching, _span2 = _classification("DEPT_CONFIDENTIAL", 0.9,
                                          content_department="hr",
                                          detector="embed")
    assert decide(matching, CTX_PUBLIC, rules).decision == "hold"
    assert decide(mismatching, CTX_PUBLIC, rules).decision == "allow"


def test_require_purpose_drops_once_a_purpose_is_attested():
    # "State & allow": pass 1 (purpose GENERAL) asks; pass 2 with any
    # attested purpose is satisfied and must not ask again -- otherwise a
    # purpose:"*" rule would demand one forever and pass 2 would always
    # look "misconfigured" to the caller.
    c, _span = _classification("SALARY", 1.0)
    pass1 = decide(c, CTX_PUBLIC, RULES)
    assert pass1.require_purpose is True

    ctx_pass2 = PolicyContext(user_role="staff", department="engineering",
                              ai_tool_tier="PUBLIC_AI", tool_status="approved",
                              purpose="drafting", target_host="chatgpt.com")
    pass2 = decide(c, ctx_pass2, RULES)
    assert pass2.decision == "redact"
    assert pass2.require_purpose is False


def test_attachment_only_class_falls_back_to_overall_confidence():
    # No PROMPT span for this class -- Classification.spans stays empty and
    # best_conf must fall back to classification.confidence.
    rules = [
        RuleRow(data_class="SALARY", ai_tool_tier="*", user_role="*",
                purpose="*", decision="redact", min_confidence=0.5),
    ]
    c = Classification(data_classes=["SALARY"], confidence=0.9, spans=[],
                       content_department=None, department_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, rules)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == []  # never invents spans
