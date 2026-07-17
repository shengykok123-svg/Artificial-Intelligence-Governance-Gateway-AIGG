class Forbidden(Exception):
    """Raised for an unknown user (SD-2) and by detokenise() when
    requester_role != "admin". Mapped to 403 by main.py."""
