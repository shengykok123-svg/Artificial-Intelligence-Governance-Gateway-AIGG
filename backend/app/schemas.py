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


class DetectionDebug(BaseModel):
    """Safe per-match diagnostic metadata; never includes matched text."""

    data_class: str
    detector: str
    confidence: float
    source: Literal["prompt", "attachment"]


class InspectDebug(BaseModel):
    """Developer-facing inspection trace for the browser debug panel."""

    policy_layer: str
    semantic_detector: str
    detections: list[DetectionDebug]


class InspectResponse(BaseModel):
    decision: Literal["allow", "redact", "hold", "deny"]
    log_id: str
    data_classes: list[str]
    redacted_prompt: str | None   # populated only when decision == "redact"
    redacted_attachments: list[RedactedAttachment] = []
    reason: str                   # one human-readable sentence
    # M9 explainability metadata. These do not affect the policy verdict.
    content_department: str | None
    department_confidence: float
    debug: InspectDebug

__all__ = [
    "Attachment",
    "DetectionDebug",
    "InspectDebug",
    "InspectRequest",
    "InspectResponse",
    "RedactedAttachment",
]
