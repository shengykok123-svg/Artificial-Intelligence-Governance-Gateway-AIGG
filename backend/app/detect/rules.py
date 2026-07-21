"""M2 deterministic detection for high-confidence, structured data."""

from __future__ import annotations

import logging

import regex

from app.detect.base import Document, Span

logger = logging.getLogger(__name__)

# The 7 built-in classes' patterns, as plain (data_class, pattern) strings --
# not pre-compiled -- so seed.py can load the exact same source into
# PatternRepo without duplicating them. RulesDetector() with no args falls
# back to these, so every existing test that constructs it bare keeps
# working unmodified; the real /v1/inspect path always passes the DB-backed
# list explicitly (see app/main.py), which is byte-for-byte this list until
# an admin edits or adds something.
#
# BANK_ACCT and SALARY were case-insensitive via a separate re.IGNORECASE
# flag; migrating to a single pattern string bakes that into an inline
# `(?i)` prefix instead -- same behaviour, no separate flags column needed.
DEFAULT_PATTERNS: tuple[tuple[str, str], ...] = (
    ("MYKAD", r"\b\d{6}-\d{2}-\d{4}\b"),
    ("EMAIL", r"\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
              r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
              r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}"
              r"[A-Za-z0-9])?)+\b"),
    ("PHONE", r"\b01\d[-\s]?\d{7,8}\b"),
    ("BANK_ACCT", r"(?i)\b(?:account|acct|a/c)\s*(?:no\.?|number)?\s*(?:is\s+)?[:#-]?\s*"
                  r"(?P<value>\d(?:[\d -]{6,22})\d)\b"),
    ("SALARY", r"(?i)\bRM\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b"),
    ("API_KEY", r"\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b"),
    ("API_KEY", r"\b(?:OPENAI|ANTHROPIC|AWS)_API_KEY\s*=\s*"
               r"(?P<value>[A-Za-z0-9_./+=-]{16,})\b"),
    ("PERSON", r"\b(?:Encik|Puan|Mr|Mrs|Ms|Dr)\.?\s+"
               r"[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2}\b"),
)

# Every pattern (built-in or admin-added) is evaluated against arbitrary
# prompt content on every request. A catastrophic-backtracking pattern
# could otherwise hang detection entirely -- stdlib re has no timeout, the
# `regex` module does. A slow pattern is skipped (logged), not fatal: one
# bad pattern must never take down detection for every other class.
DEFAULT_MATCH_TIMEOUT_SECONDS = 0.5


class RulesDetector:
    """Find deterministic sensitive-data patterns with source-text offsets.

    The detector deliberately does not assign an allow/redact/hold/deny
    decision. That remains M3's policy responsibility.
    """

    def __init__(
        self,
        patterns: list[tuple[str, str]] | None = None,
        timeout_seconds: float = DEFAULT_MATCH_TIMEOUT_SECONDS,
    ) -> None:
        raw = patterns if patterns is not None else DEFAULT_PATTERNS
        self._compiled = [(data_class, regex.compile(pattern)) for data_class, pattern in raw]
        self._timeout = timeout_seconds

    def detect(self, doc: Document) -> list[Span]:
        spans: list[Span] = []
        for data_class, pattern in self._compiled:
            try:
                matches = list(pattern.finditer(doc.text, timeout=self._timeout))
            except TimeoutError:
                logger.warning(
                    "[M2] pattern for data_class=%s timed out after %.2fs -- skipped",
                    data_class, self._timeout,
                )
                continue
            for match in matches:
                start, end = match.span("value") if "value" in match.groupdict() else match.span()
                spans.append(Span(
                    start=start,
                    end=end,
                    data_class=data_class,
                    detector="rules",
                    confidence=1.0,
                ))
        return sorted(spans, key=lambda span: (span.start, span.end, span.data_class))


__all__ = ["RulesDetector", "DEFAULT_PATTERNS", "DEFAULT_MATCH_TIMEOUT_SECONDS"]
