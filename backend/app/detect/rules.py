"""M2 deterministic detection for high-confidence, structured data."""

from __future__ import annotations

import re

from app.detect.base import DataClass, Document, Span


class RulesDetector:
    """Find deterministic sensitive-data patterns with source-text offsets.

    The detector deliberately does not assign an allow/redact/hold/deny
    decision. That remains M3's policy responsibility.
    """

    _PATTERNS: tuple[tuple[DataClass, re.Pattern[str]], ...] = (
        ("MYKAD", re.compile(r"\b\d{6}-\d{2}-\d{4}\b")),
        ("EMAIL", re.compile(r"\b[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
                             r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
                             r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}"
                             r"[A-Za-z0-9])?)+\b")),
        ("PHONE", re.compile(r"\b01\d[-\s]?\d{7,8}\b")),
        ("BANK_ACCT", re.compile(
            r"\b(?:account|acct|a/c)\s*(?:no\.?|number)?\s*(?:is\s+)?[:#-]?\s*"
            r"(?P<value>\d(?:[\d -]{6,22})\d)\b",
            re.IGNORECASE,
        )),
        ("SALARY", re.compile(r"\bRM\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b",
                              re.IGNORECASE)),
        ("SECRET", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b")),
        ("SECRET", re.compile(
            r"\b(?:OPENAI|ANTHROPIC|AWS)_API_KEY\s*=\s*"
            r"(?P<value>[A-Za-z0-9_./+=-]{16,})\b"
        )),
        ("PERSON", re.compile(
            r"\b(?:Encik|Puan|Mr|Mrs|Ms|Dr)\.?\s+"
            r"[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2}\b"
        )),
    )

    def detect(self, doc: Document) -> list[Span]:
        spans: list[Span] = []
        for data_class, pattern in self._PATTERNS:
            for match in pattern.finditer(doc.text):
                start, end = match.span("value") if "value" in match.groupdict() else match.span()
                spans.append(Span(
                    start=start,
                    end=end,
                    data_class=data_class,
                    detector="rules",
                    confidence=1.0,
                ))
        return sorted(spans, key=lambda span: (span.start, span.end, span.data_class))


__all__ = ["RulesDetector"]
