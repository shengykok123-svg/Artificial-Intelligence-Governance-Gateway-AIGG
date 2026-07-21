# M1  Mocks for modules not yet built (M2/M7/M8). Selected by MOCK_MODULES env. DELETE each mock as its module lands.
#
# Each mock below carries its own "DELETE WHEN <module> LANDS" header. When a
# module lands, its owner removes the ID from MOCK_MODULES and deletes the
# mock -- nothing else in this file moves.

from __future__ import annotations

import base64
import uuid

from app.detect.base import DataClass, Document, Span
from app.errors import Forbidden
from app.repo.base import TokenEntry, VaultRepo

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
        "sk-proj-9f2b1c8e4a7d3f6b0e5c2a9d": "API_KEY",
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
        redacted_items, map_id = self.tokenise_many([(text, spans)])
        return redacted_items[0], map_id

    def tokenise_many(self, items: list[tuple[str, list[Span]]]) -> tuple[list[str], str]:
        counters: dict[str, int] = {}
        entries: list[TokenEntry] = []
        redacted_items: list[str] = []

        for text, spans in items:
            tokens: list[tuple[Span, str]] = []
            for span in sorted(spans, key=lambda s: s.start):
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
            redacted_items.append(redacted)

        map_id = str(uuid.uuid4())
        self._vault.put_map(map_id, entries)
        return redacted_items, map_id

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
    "MockRulesDetector", "MockEmbedDetector",
    "MockTokeniser",
]
