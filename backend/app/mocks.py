# M1  Mocks for modules not yet built (M2/M3/M5/M7/M8). Selected by MOCK_MODULES env. DELETE each mock as its module lands.
#
# Each mock below carries its own "DELETE WHEN <module> LANDS" header. When a
# module lands, its owner removes the ID from MOCK_MODULES and deletes the
# mock -- nothing else in this file moves.

from __future__ import annotations

import base64
import uuid

from app.detect.base import Classification, DataClass, Document, Span
from app.errors import Forbidden
from app.extract.files import UnsupportedFile
from app.policy.engine import PolicyContext, Verdict
from app.repo.base import RuleRow, TokenEntry, VaultRepo

# --------------------------------------------------------------------------
# DELETE WHEN M2 LANDS
# --------------------------------------------------------------------------


class MockRulesDetector:
    """Stand-in for app/detect/rules.py. A dict of LITERAL trigger strings,
    not regex -- regex is M2's entire job and a half-good copy invites
    someone to keep it. str.find in a loop, so offsets are real offsets into
    doc.text: M7 redacts in place and M4 highlights from them, so fake
    offsets would poison two other modules.

    These match M0's seed rows (app/seed.py), so the same strings work in
    curl and in the dashboard.
    """

    _TRIGGERS: dict[str, DataClass] = {
        "880412-08-5561": "MYKAD",
        "sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d": "SECRET",
        "RM 8,500": "SALARY",
    }

    def detect(self, doc: Document) -> list[Span]:
        spans: list[Span] = []
        for trigger, data_class in self._TRIGGERS.items():
            start = 0
            while True:
                idx = doc.text.find(trigger, start)
                if idx == -1:
                    break
                spans.append(Span(
                    start=idx, end=idx + len(trigger),
                    data_class=data_class, detector="rules", confidence=1.0,
                ))
                start = idx + len(trigger)
        return spans


# --------------------------------------------------------------------------
# DELETE WHEN M8 LANDS
# --------------------------------------------------------------------------


class MockEmbedDetector:
    """Stand-in for app/detect/embed.py. The honest empty result: M8 is P2
    and may never ship. M6 renders classify()'s None as an em dash."""

    def detect(self, doc: Document) -> list[Span]:
        return []

    def classify(self, doc: Document) -> tuple[str | None, float]:
        return None, 0.0


# --------------------------------------------------------------------------
# DELETE WHEN M5 LANDS
# --------------------------------------------------------------------------


def mock_extract(filename: str, mime: str, content_b64: str) -> Document:
    """Stand-in for app/extract/files.py:extract(). text/plain and text/csv
    only, decoded as UTF-8. Does not import pdfplumber, python-docx or
    python-pptx -- those are M5's dependencies."""
    if mime not in ("text/plain", "text/csv"):
        raise UnsupportedFile(f"{mime} (filename={filename!r})")
    text = base64.b64decode(content_b64).decode("utf-8")
    return Document(text=text, source_filename=filename, mime=mime)


# --------------------------------------------------------------------------
# DELETE WHEN M3 LANDS
# --------------------------------------------------------------------------

# Strictest-wins over a hardcoded data_class -> decision table.
_MOCK_TABLE: dict[DataClass, str] = {
    "SECRET": "deny",
    "SALARY": "hold",
    "DEPT_CONFIDENTIAL": "hold",
    "MYKAD": "redact",
    "BANK_ACCT": "redact",
    "EMAIL": "redact",
    "PHONE": "redact",
    "PERSON": "redact",
}
_STRICTNESS = {"deny": 3, "hold": 2, "redact": 1, "allow": 0}


def mock_decide(c: Classification, ctx: PolicyContext,
                 rules: list[RuleRow]) -> Verdict:
    """Stand-in for app/policy/engine.py:decide(). Strictest-wins over a
    hardcoded data_class -> decision table. IGNORES rules, tier, role and
    purpose. This is deliberately NOT M3's logic -- M3 resolves the rule
    table, which is the whole "policy is data" claim. `rules` is still a
    real parameter, fetched by the caller from repos.rules.all(), so the
    call site is finished and M3 is a one-line import swap.
    """
    del rules  # deliberately unused -- see docstring

    decision = "allow"
    for data_class in c.data_classes:
        candidate = _MOCK_TABLE.get(data_class, "allow")
        if _STRICTNESS[candidate] > _STRICTNESS[decision]:
            decision = candidate

    if decision == "allow":
        return Verdict(decision="allow",
                       reason="No sensitive data class detected.",
                       spans_to_redact=[])

    reason = f"{', '.join(sorted(c.data_classes))} detected (mock policy)."
    spans_to_redact = list(c.spans) if decision == "redact" else []
    return Verdict(decision=decision, reason=reason,
                   spans_to_redact=spans_to_redact)


# --------------------------------------------------------------------------
# DELETE WHEN M7 LANDS
# --------------------------------------------------------------------------


class MockTokeniser:
    """Stand-in for app/vault/tokeniser.py:Tokeniser. Same class shape:
    __init__(vault: VaultRepo).

    tokenise() replaces spans right-to-left with "[CLASS_n]" placeholders and
    stores base64 of the original via vault.put_map(). Base64, not Fernet,
    and not plaintext: obviously not encryption, so no one ships it by
    accident. Right-to-left because left-to-right corrupts every span after
    the first -- M4 would be debugging this mock instead of its own code.
    """

    def __init__(self, vault: VaultRepo) -> None:
        self._vault = vault

    def tokenise(self, text: str, spans: list[Span]) -> tuple[str, str]:
        ordered = sorted(spans, key=lambda s: s.start)

        counters: dict[str, int] = {}
        entries: list[TokenEntry] = []
        tokens: list[tuple[Span, str]] = []
        for span in ordered:
            counters[span.data_class] = counters.get(span.data_class, 0) + 1
            token = f"[{span.data_class}_{counters[span.data_class]}]"
            tokens.append((span, token))
            original = text[span.start:span.end]
            entries.append(TokenEntry(
                token=token,
                ciphertext=base64.b64encode(original.encode("utf-8")),
            ))

        redacted = text
        for span, token in sorted(tokens, key=lambda t: t[0].start,
                                   reverse=True):
            redacted = redacted[:span.start] + token + redacted[span.end:]

        map_id = str(uuid.uuid4())
        self._vault.put_map(map_id, entries)
        return redacted, map_id

    def detokenise(self, map_id: str, text: str,
                   requester_role: str) -> str:
        if requester_role != "admin":
            raise Forbidden(f"role={requester_role!r} may not detokenise")
        result = text
        for entry in self._vault.get_map(map_id):
            original = base64.b64decode(entry.ciphertext).decode("utf-8")
            result = result.replace(entry.token, original)
        return result


__all__ = [
    "MockRulesDetector", "MockEmbedDetector", "mock_extract", "mock_decide",
    "MockTokeniser",
]
