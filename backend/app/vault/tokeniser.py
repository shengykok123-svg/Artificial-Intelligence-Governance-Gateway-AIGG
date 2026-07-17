# M7  tokenise/detokenise. Consumes IF-6, exposes IF-8. VaultRepo injected by M1 - never construct one.
#
# Forbidden is added by M1: MockTokeniser (app/mocks.py) and main.py's
# exception handler both need the SAME class, so it lives here -- the one
# place M7's real Tokeniser.detokenise() will also raise it from. M1 does
# not implement the Tokeniser class itself; that stays M7's job.

from __future__ import annotations


class Forbidden(Exception):
    """Raised by detokenise() when requester_role != "admin". Mapped to 403."""
