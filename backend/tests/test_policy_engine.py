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
# 5. DEPT_CONFIDENTIAL conf 0.91 via embed ⇒ M8's own tier table applies
#    (>=0.85 hold+justify, below the >=0.92 deny band) -- regardless of
#    content_department, which no longer drives DEPT_CONFIDENTIAL's decision
#    (M10: cross-department mismatch is display/log only).
# --------------------------------------------------------------------------

def test_dept_confidential_high_confidence_embed_holds_same_department():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.91,
                               content_department="engineering",
                               department_confidence=0.91, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "hold"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == []


# --------------------------------------------------------------------------
# 6. DEPT_CONFIDENTIAL conf 0.91 via embed, content finance, ctx.department
#    marketing ⇒ still hold, from the SAME tier row as above, not from any
#    @cross rule -- M10 deleted the cross-department policy row. Also
#    asserts no @cross row survives in the seeded rules.
# --------------------------------------------------------------------------

def test_dept_confidential_high_confidence_cross_department_holds_from_tier_row():
    assert not any(r.content_department == "@cross" for r in RULES)

    c, _span = _classification("DEPT_CONFIDENTIAL", 0.91,
                               content_department="finance",
                               department_confidence=0.91, detector="embed")
    ctx = PolicyContext(user_role="staff", department="marketing",
                        ai_tool_tier="PUBLIC_AI", tool_status="approved",
                        purpose="GENERAL", target_host="chatgpt.com")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "hold"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == []


# --------------------------------------------------------------------------
# 7. SALARY @ ENTERPRISE_AI, role hr ⇒ redact (M10: the regex floor removed
#    the hr/finance ENTERPRISE_AI exemptions -- SALARY is now a universal
#    ai_tool_tier: "*" redact+justify row. Was allow before M10.)
# --------------------------------------------------------------------------

def test_salary_enterprise_ai_hr_role_now_redacts():
    c, span = _classification("SALARY", 1.0)
    ctx = PolicyContext(user_role="hr", department="hr",
                        ai_tool_tier="ENTERPRISE_AI", tool_status="approved",
                        purpose="GENERAL", target_host="enterprise.example")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == [span]


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
    # INTERNAL_AI has no DEPT_CONFIDENTIAL row -- "allow, no row needed" per
    # rules.yaml. This is the no-candidate path, not a match. (M10: PERSON is
    # no longer usable for this case -- it is now a universal ai_tool_tier:
    # "*" regex-floor row that matches every tier, INTERNAL_AI included.)
    c, _span = _classification("DEPT_CONFIDENTIAL", 1.0, detector="embed")
    ctx = PolicyContext(user_role="staff", department="engineering",
                        ai_tool_tier="INTERNAL_AI", tool_status="approved",
                        purpose="GENERAL", target_host="internal.example")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "allow"
    assert "DEPT_CONFIDENTIAL" in verdict.reason


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


# --------------------------------------------------------------------------
# M10: per-detector DEPT_CONFIDENTIAL tiers, PUBLIC_AI. RULES is the real
# seeded rules.yaml table.
# --------------------------------------------------------------------------

def test_embed_049_allows_with_no_purpose():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.49, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is False


def test_embed_050_allows_and_requires_purpose():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.50, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is True


def test_embed_085_boundary_holds_the_stricter_band():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.85, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "hold"
    assert verdict.require_purpose is True


def test_embed_092_boundary_denies_and_clears_purpose():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.92, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "deny"
    assert verdict.require_purpose is False


def test_deberta_093_holds_not_denies_own_scale():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.93, detector="deberta")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "hold"


def test_deberta_095_boundary_denies():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.95, detector="deberta")
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "deny"


def test_embed_086_and_deberta_096_strictest_wins_deny():
    embed_span = Span(start=0, end=10, data_class="DEPT_CONFIDENTIAL",
                      detector="embed", confidence=0.86)
    deberta_span = Span(start=20, end=30, data_class="DEPT_CONFIDENTIAL",
                        detector="deberta", confidence=0.96)
    c = Classification(data_classes=["DEPT_CONFIDENTIAL"], confidence=0.96,
                       spans=[embed_span, deberta_span],
                       content_department=None, department_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "deny"


def test_deberta_066_purpose_already_attested_allows_without_asking_again():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.66, detector="deberta")
    ctx = PolicyContext(user_role="staff", department="engineering",
                        ai_tool_tier="PUBLIC_AI", tool_status="approved",
                        purpose="drafting", target_host="chatgpt.com")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is False


# --------------------------------------------------------------------------
# M10: regex redaction floor.
# --------------------------------------------------------------------------

def test_mykad_on_enterprise_ai_now_redacts_was_allow_before():
    c, span = _classification("MYKAD", 1.0)   # default detector="rules"
    ctx = PolicyContext(user_role="staff", department="engineering",
                        ai_tool_tier="ENTERPRISE_AI", tool_status="approved",
                        purpose="GENERAL", target_host="enterprise.example")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]


def test_salary_hr_enterprise_ai_redacts_with_purpose():
    c, span = _classification("SALARY", 1.0)
    ctx = PolicyContext(user_role="hr", department="hr",
                        ai_tool_tier="ENTERPRISE_AI", tool_status="approved",
                        purpose="GENERAL", target_host="enterprise.example")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == [span]


def test_mykad_on_internal_ai_redacts():
    c, span = _classification("MYKAD", 1.0)
    ctx = PolicyContext(user_role="staff", department="engineering",
                        ai_tool_tier="INTERNAL_AI", tool_status="approved",
                        purpose="GENERAL", target_host="internal.example")
    verdict = decide(c, ctx, RULES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]


def test_regex_email_plus_embed_060_redacts_with_purpose_and_email_span():
    email_span = Span(start=0, end=7, data_class="EMAIL",
                      detector="rules", confidence=1.0)
    dept_span = Span(start=20, end=40, data_class="DEPT_CONFIDENTIAL",
                     detector="embed", confidence=0.60)
    c = Classification(data_classes=["EMAIL", "DEPT_CONFIDENTIAL"], confidence=1.0,
                       spans=[email_span, dept_span],
                       content_department=None, department_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == [email_span]


def test_regex_email_plus_embed_093_denies_with_no_spans_to_redact():
    email_span = Span(start=0, end=7, data_class="EMAIL",
                      detector="rules", confidence=1.0)
    dept_span = Span(start=20, end=40, data_class="DEPT_CONFIDENTIAL",
                     detector="embed", confidence=0.93)
    c = Classification(data_classes=["EMAIL", "DEPT_CONFIDENTIAL"], confidence=1.0,
                       spans=[email_span, dept_span],
                       content_department=None, department_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "deny"
    assert verdict.spans_to_redact == []


def test_secret_on_public_ai_still_denies():
    c, _span = _classification("SECRET", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES)
    assert verdict.decision == "deny"
