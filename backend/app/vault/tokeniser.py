"""M7 reversible, encrypted prompt redaction."""

from __future__ import annotations

import os
import uuid

from cryptography.fernet import Fernet

from app.detect.base import Span
from app.errors import Forbidden
from app.repo.base import TokenEntry, VaultRepo


class Tokeniser:
    """Replace non-overlapping spans with encrypted, reversible tokens."""

    def __init__(self, vault: VaultRepo, key: bytes | None = None) -> None:
        self._vault = vault
        configured_key = key or os.getenv("VAULT_FERNET_KEY", "").encode()
        if not configured_key:
            raise RuntimeError("VAULT_FERNET_KEY is required when M7 is enabled")
        self._fernet = Fernet(configured_key)

    def tokenise(self, text: str, spans: list[Span]) -> tuple[str, str]:
        redacted_items, map_id = self.tokenise_many([(text, spans)])
        return redacted_items[0], map_id

    def tokenise_many(self, items: list[tuple[str, list[Span]]]) -> tuple[list[str], str]:
        counters: dict[str, int] = {}
        entries: list[TokenEntry] = []
        redacted_items: list[str] = []

        for text, spans in items:
            normalised = self._normalise(text, spans)
            replacements: list[tuple[Span, str]] = []

            for span in normalised:
                counters[span.data_class] = counters.get(span.data_class, 0) + 1
                token = f"[{span.data_class}_{counters[span.data_class]}]"
                original = text[span.start:span.end]
                entries.append(TokenEntry(
                    token=token,
                    ciphertext=self._fernet.encrypt(original.encode("utf-8")),
                ))
                replacements.append((span, token))

            redacted = text
            for span, token in reversed(replacements):
                redacted = redacted[:span.start] + token + redacted[span.end:]
            redacted_items.append(redacted)

        map_id = str(uuid.uuid4())
        self._vault.put_map(map_id, entries)
        return redacted_items, map_id

    def detokenise(self, map_id: str, text: str, requester_role: str) -> str:
        if requester_role != "admin":
            raise Forbidden(f"role={requester_role!r} may not detokenise")

        result = text
        for entry in self._vault.get_map(map_id):
            original = self._fernet.decrypt(entry.ciphertext).decode("utf-8")
            result = result.replace(entry.token, original)
        return result

    @staticmethod
    def _normalise(text: str, spans: list[Span]) -> list[Span]:
        """Pick one deterministic winner for every overlapping character range."""
        for span in spans:
            if not (0 <= span.start < span.end <= len(text)):
                raise ValueError("span is outside the source text")

        def priority(span: Span) -> tuple[int, float, int, int, str]:
            return (
                1 if span.detector == "rules" else 0,
                span.confidence,
                -(span.end - span.start),
                -span.start,
                span.data_class,
            )

        chosen: list[Span] = []
        for candidate in sorted(spans, key=priority, reverse=True):
            if all(candidate.end <= current.start or candidate.start >= current.end
                   for current in chosen):
                chosen.append(candidate)
        return sorted(chosen, key=lambda span: (span.start, span.end, span.data_class))


__all__ = ["Tokeniser", "Forbidden"]
