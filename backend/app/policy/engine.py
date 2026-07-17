# M3  decide(classification, ctx, rules) -> verdict. Pure. Rules arrive as an argument; M3 NEVER reads rules.yaml.
#
# The two dataclasses below are frozen contract, added by M1 so the rest of
# the backend can construct a PolicyContext and receive a Verdict before M3
# exists. M3's author adds decide() beneath them and does not touch these.

from __future__ import annotations

from dataclasses import dataclass

from app.detect.base import Span


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


__all__ = ["PolicyContext", "Verdict"]
