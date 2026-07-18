# M1  ALL Pydantic wire models. Nothing else defines a wire model.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class Attachment(BaseModel):
    filename: str
    mime: str
    content_b64: str


class RedactedAttachment(BaseModel):
    filename: str
    mime: str
    content_b64: str


class InspectRequest(BaseModel):
    user_id: str
    target_host: str        # "chatgpt.com" | "gemini.google.com"
    prompt: str
    purpose: str = "GENERAL"
    attachments: list[Attachment] = []


class InspectResponse(BaseModel):
    decision: Literal["allow", "redact", "hold", "deny"]
    log_id: str
    data_classes: list[str]
    redacted_prompt: str | None   # populated only when decision == "redact"
    redacted_attachments: list[RedactedAttachment] = []
    reason: str                   # one human-readable sentence


__all__ = ["Attachment", "InspectRequest", "InspectResponse", "RedactedAttachment"]
