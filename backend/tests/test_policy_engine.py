# M3  Table-driven case per rule, strictest-wins tie-break, wildcard fallback.

from __future__ import annotations

from app.detect.base import Classification, Span
from app.policy.engine import PolicyContext, decide
from app.repo.base import RuleRow
from app.seed import load_rules_yaml

RULES = load_rules_yaml()

# decide()'s regex_redact_classes param -- passed at every call site below
# (mechanical, via bulk substitution) so these tests keep exercising today's
# default (all 7 M2 classes redact). Tests for the "an admin removed a
# class" behavior live separately, further down this file.
M2_CLASSES = frozenset({"MYKAD", "EMAIL", "PHONE", "BANK_ACCT", "SALARY", "API_KEY", "PERSON"})

CTX_PUBLIC = PolicyContext(user_role="staff", department="engineering",
                           ai_tool_tier="PUBLIC_AI", tool_status="approved",
                           purpose="GENERAL", target_host="chatgpt.com")


def _classification(data_class: str, confidence: float, *,
                    content_department: str | None = None,
                    department_confidence: float = 0.0,
                    detector: str = "rules") -> tuple[Classification, Span]:
    span = Span(start=0, end=10, data_class=data_class,
               detector=detector, confidence=confidence)
    # M11: embed/deberta are gated on the whole-document score, not the span
    # itself -- mirror `confidence` onto whichever axis `detector` names so
    # existing per-detector test cases still exercise the tier they say they
    # do. Non-semantic detectors (e.g. "rules") leave both at 0.0.
    m8_confidence = confidence if detector == "embed" else 0.0
    m9_sensitivity_confidence = confidence if detector == "deberta" else 0.0
    c = Classification(data_classes=[data_class], confidence=confidence,
                       spans=[span], content_department=content_department,
                       department_confidence=department_confidence,
                       m8_confidence=m8_confidence,
                       m9_sensitivity_confidence=m9_sensitivity_confidence)
    return c, span


# --------------------------------------------------------------------------
# 1. MYKAD @ PUBLIC_AI ⇒ redact, spans_to_redact == the MYKAD spans.
# --------------------------------------------------------------------------

def test_mykad_public_ai_redacts_and_returns_its_spans():
    c, span = _classification("MYKAD", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]
    assert verdict.require_purpose is False


# --------------------------------------------------------------------------
# 2. M2 has no policy voice: API_KEY and SALARY together just redact (via the
#    structural regex floor), never escalate, never gate on a purpose --
#    even API_KEY (a leaked credential) is silently redacted like any other
#    regex class now.
# --------------------------------------------------------------------------

def test_api_key_and_salary_together_just_redact_no_escalation_no_purpose():
    api_key_span = Span(start=0, end=5, data_class="API_KEY",
                       detector="rules", confidence=1.0)
    salary_span = Span(start=10, end=18, data_class="SALARY",
                       detector="rules", confidence=1.0)
    c = Classification(data_classes=["API_KEY", "SALARY"], confidence=1.0,
                       spans=[api_key_span, salary_span],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.0, m9_sensitivity_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is False
    assert set(verdict.spans_to_redact) == {api_key_span, salary_span}


def test_salary_public_ai_redacts_no_purpose_gate():
    c, span = _classification("SALARY", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is False
    assert verdict.spans_to_redact == [span]


# --------------------------------------------------------------------------
# 3. EMAIL + API_KEY ⇒ still just redact (strictest of two "no candidate ->
#    floor" outcomes is still redact; neither is DEPT_CONFIDENTIAL, so
#    nothing here can escalate past redact).
# --------------------------------------------------------------------------

def test_email_and_api_key_together_still_only_redact():
    email_span = Span(start=0, end=7, data_class="EMAIL",
                      detector="rules", confidence=1.0)
    api_key_span = Span(start=10, end=15, data_class="API_KEY",
                       detector="rules", confidence=1.0)
    c = Classification(data_classes=["EMAIL", "API_KEY"], confidence=1.0,
                       spans=[email_span, api_key_span],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.0, m9_sensitivity_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "redact"


def test_api_key_plus_dept_confidential_deny_band_denies_but_still_masks_api_key():
    # DEPT_CONFIDENTIAL is the only class that can still push past redact.
    # The overall decision stays deny (a human call is not weakened by M2
    # alone), but spans_to_redact still carries the API_KEY regex match --
    # nothing M2 found is ever left unmasked, even on deny.
    api_key_span = Span(start=0, end=5, data_class="API_KEY",
                       detector="rules", confidence=1.0)
    dept_span = Span(start=10, end=30, data_class="DEPT_CONFIDENTIAL",
                     detector="embed", confidence=0.93)
    c = Classification(data_classes=["API_KEY", "DEPT_CONFIDENTIAL"], confidence=1.0,
                       spans=[api_key_span, dept_span],
                       content_department=None, department_confidence=0.93,
                       m8_confidence=0.93, m9_sensitivity_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "deny"
    assert verdict.spans_to_redact == [api_key_span]


# --------------------------------------------------------------------------
# 4. DEPT_CONFIDENTIAL conf 0.74 ⇒ allow + require_purpose True.
# --------------------------------------------------------------------------

def test_dept_confidential_mid_confidence_state_and_allow():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.74,
                               content_department="engineering",
                               department_confidence=0.74, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
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
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "hold"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == []


# --------------------------------------------------------------------------
# 6. DEPT_CONFIDENTIAL conf 0.91 via embed, content finance, ctx.department
#    marketing ⇒ deny, one tier stricter than the same-department 0.91 case
#    (which only holds) -- M11's @cross rows escalate cross-department
#    mismatch past the same-department band at the SAME confidence, using
#    the more-specific @cross row (0.85 min_confidence, deny) over the
#    same-department "*" row (0.85 min_confidence, hold) it would otherwise
#    match. Also asserts the @cross rows exist in the seeded rules.
# --------------------------------------------------------------------------

def test_dept_confidential_cross_department_does_not_change_the_verdict():
    # @cross escalation rows are disabled for now (see rules.yaml): a
    # cross-department mismatch is display/log only, so the verdict at a
    # given confidence must be identical whether content_department matches
    # the requester's department or not.
    assert not any(r.content_department == "@cross" for r in RULES)

    ctx_cross = PolicyContext(user_role="staff", department="marketing",
                              ai_tool_tier="PUBLIC_AI", tool_status="approved",
                              purpose="GENERAL", target_host="chatgpt.com")
    ctx_same = PolicyContext(user_role="staff", department="finance",
                             ai_tool_tier="PUBLIC_AI", tool_status="approved",
                             purpose="GENERAL", target_host="chatgpt.com")

    for confidence in (0.60, 0.91):
        c, _span = _classification("DEPT_CONFIDENTIAL", confidence,
                                   content_department="finance",
                                   department_confidence=confidence, detector="embed")
        v_cross = decide(c, ctx_cross, RULES, M2_CLASSES)
        v_same = decide(c, ctx_same, RULES, M2_CLASSES)
        assert v_cross.decision == v_same.decision
        assert v_cross.require_purpose == v_same.require_purpose


# --------------------------------------------------------------------------
# 7. SALARY @ ENTERPRISE_AI, role hr ⇒ redact via the structural floor, no
#    purpose gate. M2 no longer has any policy rows at all, so role/tier
#    have no bearing on the outcome -- it always just redacts.
# --------------------------------------------------------------------------

def test_salary_enterprise_ai_hr_role_redacts_via_floor():
    c, span = _classification("SALARY", 1.0)
    ctx = PolicyContext(user_role="hr", department="hr",
                        ai_tool_tier="ENTERPRISE_AI", tool_status="approved",
                        purpose="GENERAL", target_host="enterprise.example")
    verdict = decide(c, ctx, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is False
    assert verdict.spans_to_redact == [span]


# --------------------------------------------------------------------------
# 8. No spans ⇒ allow, require_purpose False.
# --------------------------------------------------------------------------

def test_no_data_classes_allows():
    c = Classification(data_classes=[], confidence=0.0, spans=[],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.0, m9_sensitivity_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is False
    assert verdict.spans_to_redact == []
    assert verdict.reason == "No sensitive data class detected."


# --------------------------------------------------------------------------
# 9. Same inputs twice ⇒ identical Verdict (purity/determinism).
# --------------------------------------------------------------------------

def test_decide_is_pure_and_deterministic():
    c, _span = _classification("SALARY", 1.0)
    v1 = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    v2 = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
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
    verdict = decide(c, ctx, RULES, M2_CLASSES)
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
    verdict = decide(c, CTX_PUBLIC, rules, M2_CLASSES)
    assert verdict.decision == "redact"


def test_min_confidence_excludes_a_candidate_leaving_no_candidate_path():
    rules = [
        RuleRow(data_class="DEPT_CONFIDENTIAL", ai_tool_tier="*",
                user_role="*", purpose="*", decision="hold",
                min_confidence=0.9),
    ]
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.5, detector="embed")
    verdict = decide(c, CTX_PUBLIC, rules, M2_CLASSES)
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
    assert decide(matching, CTX_PUBLIC, rules, M2_CLASSES).decision == "hold"
    assert decide(mismatching, CTX_PUBLIC, rules, M2_CLASSES).decision == "allow"


def test_require_purpose_drops_once_a_purpose_is_attested():
    # "State & allow": pass 1 (purpose GENERAL) asks; pass 2 with any
    # attested purpose is satisfied and must not ask again -- otherwise a
    # purpose:"*" rule would demand one forever and pass 2 would always
    # look "misconfigured" to the caller. M2 classes no longer carry a
    # require_purpose gate, so this exercises DEPT_CONFIDENTIAL's
    # allow-band tier instead.
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.60, detector="embed")
    pass1 = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert pass1.decision == "allow"
    assert pass1.require_purpose is True

    ctx_pass2 = PolicyContext(user_role="staff", department="engineering",
                              ai_tool_tier="PUBLIC_AI", tool_status="approved",
                              purpose="drafting", target_host="chatgpt.com")
    pass2 = decide(c, ctx_pass2, RULES, M2_CLASSES)
    assert pass2.decision == "allow"
    assert pass2.require_purpose is False


def test_attachment_only_class_falls_back_to_overall_confidence():
    # No PROMPT span for this class -- Classification.spans stays empty and
    # best_conf must fall back to classification.confidence.
    rules = [
        RuleRow(data_class="SALARY", ai_tool_tier="*", user_role="*",
                purpose="*", decision="redact", min_confidence=0.5),
    ]
    c = Classification(data_classes=["SALARY"], confidence=0.9, spans=[],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.0, m9_sensitivity_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, rules, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == []  # never invents spans


# --------------------------------------------------------------------------
# M10: per-detector DEPT_CONFIDENTIAL tiers, PUBLIC_AI. RULES is the real
# seeded rules.yaml table.
# --------------------------------------------------------------------------

def test_embed_049_allows_with_no_purpose():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.49, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is False


def test_embed_050_allows_and_requires_purpose():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.50, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "allow"
    assert verdict.require_purpose is True


def test_embed_085_boundary_holds_the_stricter_band():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.85, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "hold"
    assert verdict.require_purpose is True


def test_embed_092_boundary_denies_and_clears_purpose():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.92, detector="embed")
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "deny"
    assert verdict.require_purpose is False


def test_deberta_093_holds_not_denies_own_scale():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.93, detector="deberta")
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "hold"


def test_deberta_095_boundary_denies():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.95, detector="deberta")
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "deny"


def test_embed_086_and_deberta_096_strictest_wins_deny():
    embed_span = Span(start=0, end=10, data_class="DEPT_CONFIDENTIAL",
                      detector="embed", confidence=0.86)
    deberta_span = Span(start=20, end=30, data_class="DEPT_CONFIDENTIAL",
                        detector="deberta", confidence=0.96)
    c = Classification(data_classes=["DEPT_CONFIDENTIAL"], confidence=0.96,
                       spans=[embed_span, deberta_span],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.86, m9_sensitivity_confidence=0.96)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "deny"


def test_deberta_066_purpose_already_attested_allows_without_asking_again():
    c, _span = _classification("DEPT_CONFIDENTIAL", 0.66, detector="deberta")
    ctx = PolicyContext(user_role="staff", department="engineering",
                        ai_tool_tier="PUBLIC_AI", tool_status="approved",
                        purpose="drafting", target_host="chatgpt.com")
    verdict = decide(c, ctx, RULES, M2_CLASSES)
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
    verdict = decide(c, ctx, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]


def test_salary_hr_enterprise_ai_redacts_no_purpose_gate():
    c, span = _classification("SALARY", 1.0)
    ctx = PolicyContext(user_role="hr", department="hr",
                        ai_tool_tier="ENTERPRISE_AI", tool_status="approved",
                        purpose="GENERAL", target_host="enterprise.example")
    verdict = decide(c, ctx, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is False
    assert verdict.spans_to_redact == [span]


def test_mykad_on_internal_ai_redacts():
    c, span = _classification("MYKAD", 1.0)
    ctx = PolicyContext(user_role="staff", department="engineering",
                        ai_tool_tier="INTERNAL_AI", tool_status="approved",
                        purpose="GENERAL", target_host="internal.example")
    verdict = decide(c, ctx, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]


def test_regex_email_plus_embed_060_redacts_with_purpose_and_email_span():
    email_span = Span(start=0, end=7, data_class="EMAIL",
                      detector="rules", confidence=1.0)
    dept_span = Span(start=20, end=40, data_class="DEPT_CONFIDENTIAL",
                     detector="embed", confidence=0.60)
    c = Classification(data_classes=["EMAIL", "DEPT_CONFIDENTIAL"], confidence=1.0,
                       spans=[email_span, dept_span],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.60, m9_sensitivity_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.require_purpose is True
    assert verdict.spans_to_redact == [email_span]


def test_regex_email_plus_embed_093_denies_but_still_masks_email():
    email_span = Span(start=0, end=7, data_class="EMAIL",
                      detector="rules", confidence=1.0)
    dept_span = Span(start=20, end=40, data_class="DEPT_CONFIDENTIAL",
                     detector="embed", confidence=0.93)
    c = Classification(data_classes=["EMAIL", "DEPT_CONFIDENTIAL"], confidence=1.0,
                       spans=[email_span, dept_span],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.93, m9_sensitivity_confidence=0.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "deny"
    assert verdict.spans_to_redact == [email_span]


def test_api_key_on_public_ai_redacts_not_denies():
    # M2 has no policy voice any more, not even for credentials: API_KEY is
    # redacted by the structural floor exactly like any other regex class.
    c, span = _classification("API_KEY", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]


# --------------------------------------------------------------------------
# New: regex_redact_classes is admin-editable, not hardcoded to "every M2
# span". An admin can remove a class from it (dashboard: Redaction tab).
# --------------------------------------------------------------------------

def test_regex_redact_classes_still_protects_a_listed_class():
    # Regression guard for the change itself: API_KEY is in M2_CLASSES, so
    # nothing about the default behavior moved.
    c, span = _classification("API_KEY", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES, M2_CLASSES)
    assert verdict.decision == "redact"
    assert verdict.spans_to_redact == [span]


def test_class_removed_from_regex_redact_classes_is_not_redacted_or_escalated():
    # An admin removed API_KEY from the Redaction list. M2 still finds it
    # (it's still in data_classes/spans -- classify()/detect() don't know
    # about this list at all), but the floor no longer touches it: no
    # redaction, no allow -> redact upgrade.
    c, span = _classification("API_KEY", 1.0)
    without_api_key = frozenset(M2_CLASSES - {"API_KEY"})
    verdict = decide(c, CTX_PUBLIC, RULES, without_api_key)
    assert verdict.decision == "allow"
    assert verdict.spans_to_redact == []
    assert "API_KEY" in c.data_classes  # still detected, just unprotected


def test_removing_one_class_does_not_affect_a_different_class():
    email_span = Span(start=0, end=7, data_class="EMAIL",
                      detector="rules", confidence=1.0)
    api_key_span = Span(start=10, end=15, data_class="API_KEY",
                       detector="rules", confidence=1.0)
    c = Classification(data_classes=["EMAIL", "API_KEY"], confidence=1.0,
                       spans=[email_span, api_key_span],
                       content_department=None, department_confidence=0.0,
                       m8_confidence=0.0, m9_sensitivity_confidence=0.0)
    without_api_key = frozenset(M2_CLASSES - {"API_KEY"})
    verdict = decide(c, CTX_PUBLIC, RULES, without_api_key)
    assert verdict.decision == "redact"  # EMAIL is still on the list
    assert verdict.spans_to_redact == [email_span]  # API_KEY is not masked


def test_empty_regex_redact_classes_never_redacts_or_escalates_m2():
    c, _span = _classification("MYKAD", 1.0)
    verdict = decide(c, CTX_PUBLIC, RULES, frozenset())
    assert verdict.decision == "allow"
    assert verdict.spans_to_redact == []
