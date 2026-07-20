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
    # "State & allow" pass 2: the log_id of the pass-1 submission this one
    # resubmits with an attested purpose. When set and that record is still
    # "pending", the pass-1 row is updated in place instead of a sibling row
    # being created -- one interaction, one pending row, not two.
    existing_log_id: str | None = None
    # The employee's free-text explanation from the justification picker --
    # distinct from `purpose` (the business-category dropdown). Shown to the
    # reviewer in the approval queue; never used by decide() itself.
    justification: str | None = None


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
    require_purpose: bool = False  # "state & allow": ask, then resubmit with purpose
    # Explainability metadata. These do not affect the policy verdict.
    content_department: str | None    # fused: M8 > M9 > null precedence
    department_confidence: float
    m8_department: str | None = None  # raw EmbedDetector.classify() output
    m8_confidence: float = 0.0
    m9_department: str | None = None  # raw DebertaDetector.classify() output
    m9_confidence: float = 0.0        # department-attribution axis only
    m9_sensitivity_confidence: float = 0.0  # confidentiality-severity axis; no M8 equivalent
    debug: InspectDebug


class InternalDocUploadRequest(BaseModel):
    department: str
    attachment: Attachment
    replace_source: bool = True


class InternalDocUploadResponse(BaseModel):
    source_file: str
    department: str
    chunk_count: int
    total: int


class InternalDocChunkResponse(BaseModel):
    id: str
    source_file: str
    department: str
    chunk_text: str
    created_at: str


class InternalDocsPage(BaseModel):
    items: list[InternalDocChunkResponse]
    total: int
    limit: int
    offset: int

__all__ = [
    "Attachment",
    "DetectionDebug",
    "InternalDocChunkResponse",
    "InternalDocsPage",
    "InternalDocUploadRequest",
    "InternalDocUploadResponse",
    "InspectDebug",
    "InspectRequest",
    "InspectResponse",
    "RedactedAttachment",
]
