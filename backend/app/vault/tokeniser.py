# M7  tokenise/detokenise. Consumes IF-6, exposes IF-8. VaultRepo injected by M1 - never construct one.
#
# M7: raise Forbidden from detokenise() when requester_role != "admin".
# It is DEFINED in app/errors.py and only re-exported here -- main.py's auth
# path raises the same class, so it must not live in a file you rewrite.

from app.errors import Forbidden

__all__ = ["Forbidden"]
