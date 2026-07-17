# M5  extract(filename, mime, content_b64) -> Document. Produces IF-4. Raises UnsupportedFile -> 415.
#
# UnsupportedFile is added by M1: mock_extract (app/mocks.py) and main.py's
# exception handler both need the SAME class, so it lives here -- the one
# place M5's real extract() will also raise it from. M1 does not implement
# extract() itself; that stays M5's job.

from __future__ import annotations


class UnsupportedFile(Exception):
    """Raised for a filename/mime extract() cannot handle. Mapped to 415."""
