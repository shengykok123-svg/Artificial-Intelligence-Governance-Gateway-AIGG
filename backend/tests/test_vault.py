import pytest
from cryptography.fernet import Fernet

from app.detect.base import Span
from app.errors import Forbidden
from app.repo.memory import InMemoryVaultRepo
from app.vault.tokeniser import Tokeniser


KEY = Fernet.generate_key()


def _span(text: str, value: str, data_class: str, *, detector: str = "rules",
          confidence: float = 1.0) -> Span:
    start = text.index(value)
    return Span(start=start, end=start + len(value), data_class=data_class,
                detector=detector, confidence=confidence)


def test_tokenise_encrypts_values_and_round_trips_for_admin() -> None:
    text = "IC 880412-08-5561, email siti@acme.my"
    vault = InMemoryVaultRepo()
    tokeniser = Tokeniser(vault, key=KEY)

    redacted, map_id = tokeniser.tokenise(text, [
        _span(text, "880412-08-5561", "MYKAD"),
        _span(text, "siti@acme.my", "EMAIL"),
    ])

    assert redacted == "IC [MYKAD_1], email [EMAIL_1]"
    assert all(entry.ciphertext != text.encode() for entry in vault.get_map(map_id))
    assert tokeniser.detokenise(map_id, redacted, requester_role="admin") == text


def test_tokenise_numbers_repeated_classes_and_replaces_right_to_left() -> None:
    text = "a@acme.my and b@acme.my"
    vault = InMemoryVaultRepo()
    tokeniser = Tokeniser(vault, key=KEY)
    first = _span(text, "a@acme.my", "EMAIL")
    second_start = text.rindex("b@acme.my")
    second = Span(second_start, second_start + len("b@acme.my"), "EMAIL", "rules", 1.0)

    redacted, map_id = tokeniser.tokenise(text, [first, second])
    assert redacted == "[EMAIL_1] and [EMAIL_2]"
    assert tokeniser.detokenise(map_id, redacted, requester_role="admin") == text


def test_tokenise_prefers_exact_rules_span_when_embed_span_overlaps() -> None:
    text = "The MyKad is 880412-08-5561 for payroll."
    exact = _span(text, "880412-08-5561", "MYKAD")
    semantic = Span(0, len(text) - 1, "DEPT_CONFIDENTIAL", "embed", 0.95)

    redacted, map_id = Tokeniser(InMemoryVaultRepo(), key=KEY).tokenise(
        text, [semantic, exact],
    )

    assert redacted == "The MyKad is [MYKAD_1] for payroll."
    assert map_id


def test_tokenise_rejects_spans_outside_the_source_text() -> None:
    invalid = Span(0, 99, "MYKAD", "rules", 1.0)
    with pytest.raises(ValueError, match="outside"):
        Tokeniser(InMemoryVaultRepo(), key=KEY).tokenise("short", [invalid])


def test_detokenise_rejects_non_admin_and_requires_a_configured_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    vault = InMemoryVaultRepo()
    tokeniser = Tokeniser(vault, key=KEY)
    redacted, map_id = tokeniser.tokenise(
        "IC 880412-08-5561", [_span("IC 880412-08-5561", "880412-08-5561", "MYKAD")],
    )
    with pytest.raises(Forbidden):
        tokeniser.detokenise(map_id, redacted, requester_role="staff")

    monkeypatch.delenv("VAULT_FERNET_KEY", raising=False)
    with pytest.raises(RuntimeError, match="VAULT_FERNET_KEY"):
        Tokeniser(vault)
