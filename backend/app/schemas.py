# M1  ALL Pydantic wire models. Nothing else defines a wire model.

from __future__ import annotations

from typing import Literal

import regex
from pydantic import BaseModel, Field, field_validator


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


class RuleRequest(BaseModel):
    # Create/update body for the policy rules table -- see
    # backend/app/policy/rules.yaml's header comment for what each field
    # means to decide(). data_class and ai_tool_tier are deliberately plain
    # strings, not Literal-restricted: nothing in the engine hard-codes
    # either set, and locking them here would create a second source of
    # truth that drifts from rules.yaml/the engine's own tolerance for new
    # values.
    data_class: str
    ai_tool_tier: str
    user_role: str = "*"
    purpose: str = "*"
    decision: Literal["allow", "redact", "hold", "deny"]
    min_confidence: float = Field(0.0, ge=0.0, le=1.0)
    content_department: str = "*"
    require_purpose: bool = False
    detector: Literal["*", "embed", "deberta"] = "*"


class ToolVisitRequest(BaseModel):
    # The extension's shadow-AI detector: a hostname match against the
    # bundled AI_HOSTS list plus a completed network request on that origin
    # (see extension/src/background.ts). No prompt/content ever travels with
    # this call -- just the bare hostname.
    host: str


class RedactionClassRequest(BaseModel):
    # Create body for the redaction_classes table -- see RedactionRepo /
    # the REGEX FLOOR note in backend/app/policy/engine.py. Deliberately
    # one field: every row here only ever does one thing (get redacted).
    data_class: str


_MAX_PATTERN_LENGTH = 200


class DetectionPatternRequest(BaseModel):
    # Create/update body for the detection_patterns table -- see PatternRepo
    # / app/detect/rules.py. A pattern is evaluated against arbitrary prompt
    # content on every /v1/inspect call, so this is the ONLY place regex
    # input is accepted from -- validate here, not in RulesDetector, which
    # trusts whatever it's constructed with. The length cap and compile
    # check catch obvious mistakes; they are not a ReDoS guarantee on their
    # own -- the real protection is RulesDetector's runtime match timeout
    # (see DEFAULT_MATCH_TIMEOUT_SECONDS), which applies regardless of what
    # slips past this check.
    data_class: str
    pattern: str
    remark: str = ""    # free-text note -- why this pattern exists, what
                        # it's for. Never read by detection/policy logic.

    @field_validator("pattern")
    @classmethod
    def _validate_pattern(cls, value: str) -> str:
        if len(value) > _MAX_PATTERN_LENGTH:
            raise ValueError(f"pattern must be {_MAX_PATTERN_LENGTH} characters or fewer")
        try:
            regex.compile(value)
        except regex.error as exc:
            raise ValueError(f"invalid regex: {exc}") from exc
        return value


__all__ = [
    "Attachment",
    "DetectionDebug",
    "DetectionPatternRequest",
    "InternalDocChunkResponse",
    "InternalDocsPage",
    "InternalDocUploadRequest",
    "InternalDocUploadResponse",
    "InspectDebug",
    "InspectRequest",
    "InspectResponse",
    "RedactedAttachment",
    "RedactionClassRequest",
    "RuleRequest",
    "ToolVisitRequest",
]
