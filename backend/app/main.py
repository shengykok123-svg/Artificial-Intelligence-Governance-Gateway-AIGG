# M1  FastAPI app and routers. Consumes IF-9 (audit, vault, rules, tools, users). Produces IF-2, IF-3, IF-7, IF-10.

from __future__ import annotations

import base64
import binascii
import io
import os
import sys
import textwrap
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any, Callable

from dotenv import load_dotenv
from docx import Document as DocxDocument
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pptx import Presentation

from app.detect.base import Classification, Detector, DocumentClassifier, Document, Span
from app.errors import Forbidden
from app.extract.files import UnsupportedFile
from app.extract.xlsx import XlsxTextTarget, iter_xlsx_text_targets, redact_xlsx_bytes
from app.policy.engine import PolicyContext, Verdict
from app.repo import Repos, get_repos
from app.repo.base import AuditRecord
from app.schemas import Attachment, InspectRequest, InspectResponse, RedactedAttachment

load_dotenv()

ENV = os.getenv("ENV", "dev")
API_KEY = os.getenv("API_KEY", "dev-key-change-me")
MOCK_MODULES: set[str] = {
    m.strip() for m in os.getenv("MOCK_MODULES", "M2,M3,M5,M7,M8").split(",")
    if m.strip()
}

# The default admin identity behind the dashboard's hardcoded login. Neither
# POST /v1/logs/{id}/decision nor POST /v1/tools/{host}/decision carries a
# reviewer/actor field on the wire (see schemas.py) -- there is exactly one
# login, and this is it. A real IdP-backed identity is future work.
DASHBOARD_ADMIN = "admin@acme.my"


def _check_demo_guard(env: str, mock_modules: set[str]) -> None:
    """A demo video recorded against mock detection would show redaction
    that never happened. That is not a bug, it is a false claim about the
    product -- refuse to start rather than let it happen by accident."""
    if env == "demo" and mock_modules:
        raise RuntimeError(
            f"ENV=demo refuses to start with MOCK_MODULES={sorted(mock_modules)} "
            "still active. Remove every landed module from MOCK_MODULES "
            "before recording a demo."
        )


_check_demo_guard(ENV, MOCK_MODULES)

print(
    f"[startup] ENV={ENV} MOCK_MODULES={sorted(MOCK_MODULES) or ['none']}",
    file=sys.stderr,
)


# --------------------------------------------------------------------------
# Loaders. Each reads MOCK_MODULES exactly once per call. This is the seam:
# when a module lands, its owner removes the ID here and the mock import
# disappears. Explicit selection, never a try/except ImportError fallback --
# a broken real module must fail loudly, not silently serve a mock.
# --------------------------------------------------------------------------


def get_rules_detector() -> Detector:
    if "M2" in MOCK_MODULES:
        from app.mocks import MockRulesDetector
        return MockRulesDetector()
    from app.detect.rules import RulesDetector
    return RulesDetector()


def get_embed_detector() -> Detector | DocumentClassifier:
    if "M8" in MOCK_MODULES:
        from app.mocks import MockEmbedDetector
        return MockEmbedDetector()
    from app.detect.embed import EmbedDetector
    return EmbedDetector()


def get_extractor() -> Callable[[str, str, str], Document]:
    if "M5" in MOCK_MODULES:
        from app.mocks import mock_extract
        return mock_extract
    from app.extract.files import extract
    return extract


def get_decider() -> Callable[[Classification, PolicyContext, list], Verdict]:
    if "M3" in MOCK_MODULES:
        from app.mocks import mock_decide
        return mock_decide
    from app.policy.engine import decide
    return decide


def get_tokeniser(vault: Any) -> Any:
    if "M7" in MOCK_MODULES:
        from app.mocks import MockTokeniser
        return MockTokeniser(vault)
    from app.vault.tokeniser import Tokeniser
    return Tokeniser(vault)


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
PDF_MIME = "application/pdf"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _can_redact_text_attachment(att: Attachment) -> bool:
    normalised_mime = att.mime.lower().split(";")[0].strip()
    filename = att.filename.lower()
    return (
        normalised_mime in {"text/plain", "text/csv"}
        or filename.endswith(".txt")
        or filename.endswith(".csv")
    )


def _can_redact_docx_attachment(att: Attachment) -> bool:
    normalised_mime = att.mime.lower().split(";")[0].strip()
    return normalised_mime == DOCX_MIME or att.filename.lower().endswith(".docx")


def _can_redact_pptx_attachment(att: Attachment) -> bool:
    normalised_mime = att.mime.lower().split(";")[0].strip()
    return normalised_mime == PPTX_MIME or att.filename.lower().endswith(".pptx")


def _can_redact_pdf_attachment(att: Attachment) -> bool:
    normalised_mime = att.mime.lower().split(";")[0].strip()
    return normalised_mime == PDF_MIME or att.filename.lower().endswith(".pdf")


def _can_redact_xlsx_attachment(att: Attachment) -> bool:
    normalised_mime = att.mime.lower().split(";")[0].strip()
    return normalised_mime == XLSX_MIME or att.filename.lower().endswith(".xlsx")


def _redacted_filename(filename: str) -> str:
    if "." not in filename:
        return f"{filename}.redacted.txt"
    stem, ext = filename.rsplit(".", 1)
    return f"{stem}.redacted.{ext}"


def _redacted_attachment(att: Attachment, redacted_text: str) -> RedactedAttachment:
    return RedactedAttachment(
        filename=_redacted_filename(att.filename),
        mime=att.mime,
        content_b64=base64.b64encode(redacted_text.encode("utf-8")).decode("ascii"),
    )


def _decode_attachment_bytes(att: Attachment) -> bytes:
    try:
        return base64.b64decode(att.content_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise UnsupportedFile(f"invalid base64 (filename={att.filename!r})") from exc


def _iter_docx_text_targets(docx: Any) -> list[Any]:
    targets: list[Any] = []
    for container in _iter_docx_story_containers(docx):
        targets.extend(p for p in container.paragraphs if p.text)
        for table in container.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text:
                        targets.append(cell)
    return targets


def _iter_docx_story_containers(docx: Any) -> list[Any]:
    containers: list[Any] = [docx]
    seen = {id(docx._element)}
    for section in docx.sections:
        for attr in (
            "header",
            "first_page_header",
            "even_page_header",
            "footer",
            "first_page_footer",
            "even_page_footer",
        ):
            container = getattr(section, attr)
            marker = id(container._element)
            if marker in seen:
                continue
            seen.add(marker)
            containers.append(container)
    return containers


def _redacted_docx_attachment(att: Attachment, docx: Any) -> RedactedAttachment:
    buf = io.BytesIO()
    docx.save(buf)
    return RedactedAttachment(
        filename=_redacted_filename(att.filename),
        mime=att.mime or DOCX_MIME,
        content_b64=base64.b64encode(buf.getvalue()).decode("ascii"),
    )


def _iter_pptx_text_targets(deck: Any) -> list[Any]:
    targets: list[Any] = []
    for slide in deck.slides:
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False):
                continue
            text_frame = shape.text_frame
            if text_frame.text:
                targets.append(text_frame)
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame.text:
            targets.append(slide.notes_slide.notes_text_frame)
    return targets


def _redacted_pptx_attachment(att: Attachment, deck: Any) -> RedactedAttachment:
    buf = io.BytesIO()
    deck.save(buf)
    return RedactedAttachment(
        filename=_redacted_filename(att.filename),
        mime=att.mime or PPTX_MIME,
        content_b64=base64.b64encode(buf.getvalue()).decode("ascii"),
    )


def _pdf_literal_string(text: str) -> bytes:
    raw = text.encode("latin-1", errors="replace")
    escaped = bytearray()
    for byte in raw:
        if byte in {0x28, 0x29, 0x5C}:  # (, ), backslash
            escaped.append(0x5C)
            escaped.append(byte)
        elif byte == 0x0D:
            escaped.extend(b"\\r")
        elif byte == 0x0A:
            escaped.extend(b"\\n")
        elif byte == 0x09:
            escaped.extend(b"\\t")
        else:
            escaped.append(byte)
    return b"(" + bytes(escaped) + b")"


def _pdf_bytes_from_text(text: str) -> bytes:
    wrapped: list[str] = []
    for raw_line in text.splitlines() or [""]:
        wrapped.extend(textwrap.wrap(raw_line, width=86) or [""])

    lines_per_page = 42
    pages = [wrapped[i:i + lines_per_page] for i in range(0, len(wrapped), lines_per_page)] or [[""]]

    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    page_ids: list[int] = []

    for page_lines in pages:
        page_id = len(objects) + 1
        content_id = page_id + 1
        page_ids.append(page_id)

        content_lines = [b"BT", b"/F1 11 Tf", b"72 740 Td", b"14 TL"]
        for idx, line in enumerate(page_lines):
            if idx:
                content_lines.append(b"T*")
            content_lines.append(_pdf_literal_string(line) + b" Tj")
        content_lines.append(b"ET")
        content = b"\n".join(content_lines)

        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>".encode("ascii")
        )
        objects.append(
            b"<< /Length " + str(len(content)).encode("ascii") + b" >>\nstream\n" + content + b"\nendstream"
        )

    kids = b" ".join(f"{page_id} 0 R".encode("ascii") for page_id in page_ids)
    objects[1] = b"<< /Type /Pages /Count " + str(len(page_ids)).encode("ascii") + b" /Kids [" + kids + b"] >>"

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for obj_id, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{obj_id} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")

    xref_offset = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(pdf)


def _redacted_pdf_attachment(att: Attachment, redacted_text: str) -> RedactedAttachment:
    return RedactedAttachment(
        filename=_redacted_filename(att.filename),
        mime=att.mime or PDF_MIME,
        content_b64=base64.b64encode(_pdf_bytes_from_text(redacted_text)).decode("ascii"),
    )


def _redacted_xlsx_attachment(att: Attachment, replacements: dict[XlsxTextTarget, str]) -> RedactedAttachment:
    redacted_bytes = redact_xlsx_bytes(_decode_attachment_bytes(att), replacements)
    return RedactedAttachment(
        filename=_redacted_filename(att.filename),
        mime=att.mime or XLSX_MIME,
        content_b64=base64.b64encode(redacted_bytes).decode("ascii"),
    )


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------


def require_api_key(x_api_key: str | None = Header(None)) -> None:
    if x_api_key != API_KEY:
        raise HTTPException(status_code=403, detail="invalid API key")


app = FastAPI(title="AI Governance Gateway",
              dependencies=[Depends(require_api_key)])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(UnsupportedFile)
def _unsupported_file_handler(request: Request, exc: UnsupportedFile) -> JSONResponse:
    return JSONResponse(status_code=415, content={"detail": str(exc)})


@app.exception_handler(Forbidden)
def _forbidden_handler(request: Request, exc: Forbidden) -> JSONResponse:
    return JSONResponse(status_code=403, content={"detail": str(exc) or "forbidden"})


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------


@app.post("/v1/inspect", response_model=InspectResponse)
def inspect(req: InspectRequest, repos: Repos = Depends(get_repos)) -> InspectResponse:
    # SD-2: role and department come from the users table, keyed by user_id.
    # Never a header -- a self-asserted role is a self-issued permission.
    user = repos.users.by_id(req.user_id)
    if user is None:
        raise Forbidden(f"unknown user_id {req.user_id!r}")

    # SD-7: an unknown host auto-registers as PUBLIC_AI/unapproved and is
    # never held on that account alone -- this is the shadow-AI story.
    tool = repos.tools.by_host(req.target_host)
    if tool is None:
        tool = repos.tools.register(req.target_host)

    extract = get_extractor()
    documents: list[Document] = [
        Document(text=req.prompt, source_filename=None, mime="text/plain")
    ]
    attachment_docs: list[tuple[Attachment, Document]] = []
    for att in req.attachments:
        doc = extract(att.filename, att.mime, att.content_b64)
        documents.append(doc)
        attachment_docs.append((att, doc))

    rules_detector = get_rules_detector()
    embed_detector = get_embed_detector()

    # Span.start/end are offsets into ONE Document's text. The prompt's own
    # spans are what get redacted back into the response (redacted_prompt is
    # a single field, and so is AuditRecord.prompt_text); attachment spans
    # still count toward the verdict via data_classes, but are never used to
    # slice the prompt string.
    prompt_doc = documents[0]
    prompt_spans = rules_detector.detect(prompt_doc) + embed_detector.detect(prompt_doc)

    all_spans: list[Span] = list(prompt_spans)
    attachment_spans: list[tuple[Attachment, Document, list[Span]]] = []
    for att, doc in attachment_docs:
        spans = rules_detector.detect(doc) + embed_detector.detect(doc)
        all_spans += spans
        attachment_spans.append((att, doc, spans))

    data_classes = sorted({span.data_class for span in all_spans})
    confidence = max((s.confidence for s in all_spans), default=0.0)

    combined_text = "\n".join(doc.text for doc in documents)
    content_department, department_confidence = embed_detector.classify(
        Document(text=combined_text, source_filename=None, mime="text/plain")
    )

    classification = Classification(
        data_classes=data_classes,
        confidence=confidence,
        spans=prompt_spans,
        content_department=content_department,
        department_confidence=department_confidence,
    )

    ctx = PolicyContext(
        user_role=user.role,
        department=user.department,
        ai_tool_tier=tool.tier,
        tool_status=tool.status,
        purpose=req.purpose,
        target_host=req.target_host,
    )

    decide = get_decider()
    verdict = decide(classification, ctx, repos.rules.all())

    redacted_prompt: str | None = None
    redacted_attachments: list[RedactedAttachment] = []
    map_id: str | None = None
    prompt_text_for_audit = req.prompt

    if verdict.decision == "redact":
        tokeniser = get_tokeniser(repos.vault)
        tokenise_inputs: list[tuple[str, list[Span]]] = [(req.prompt, verdict.spans_to_redact)]
        attachment_redaction_inputs: list[tuple[Attachment, int]] = []
        docx_redaction_inputs: list[tuple[Attachment, Any, list[tuple[Any, int]]]] = []
        pptx_redaction_inputs: list[tuple[Attachment, Any, list[tuple[Any, int]]]] = []
        pdf_redaction_inputs: list[tuple[Attachment, int]] = []
        xlsx_redaction_inputs: list[tuple[Attachment, list[tuple[XlsxTextTarget, int]]]] = []
        for att, doc, spans in attachment_spans:
            if not spans:
                continue
            if _can_redact_text_attachment(att):
                attachment_redaction_inputs.append((att, len(tokenise_inputs)))
                tokenise_inputs.append((doc.text, spans))
                continue

            if _can_redact_docx_attachment(att):
                docx = DocxDocument(io.BytesIO(_decode_attachment_bytes(att)))
                targets: list[tuple[Any, int]] = []
                for target in _iter_docx_text_targets(docx):
                    target_doc = Document(text=target.text, source_filename=att.filename, mime=att.mime)
                    target_spans = rules_detector.detect(target_doc) + embed_detector.detect(target_doc)
                    if not target_spans:
                        continue
                    targets.append((target, len(tokenise_inputs)))
                    tokenise_inputs.append((target.text, target_spans))
                if targets:
                    docx_redaction_inputs.append((att, docx, targets))
                continue

            if _can_redact_pptx_attachment(att):
                deck = Presentation(io.BytesIO(_decode_attachment_bytes(att)))
                targets: list[tuple[Any, int]] = []
                for target in _iter_pptx_text_targets(deck):
                    target_doc = Document(text=target.text, source_filename=att.filename, mime=att.mime)
                    target_spans = rules_detector.detect(target_doc) + embed_detector.detect(target_doc)
                    if not target_spans:
                        continue
                    targets.append((target, len(tokenise_inputs)))
                    tokenise_inputs.append((target.text, target_spans))
                if targets:
                    pptx_redaction_inputs.append((att, deck, targets))
                continue

            if _can_redact_pdf_attachment(att):
                pdf_redaction_inputs.append((att, len(tokenise_inputs)))
                tokenise_inputs.append((doc.text, spans))
                continue

            if _can_redact_xlsx_attachment(att):
                targets: list[tuple[XlsxTextTarget, int]] = []
                for target in iter_xlsx_text_targets(_decode_attachment_bytes(att)):
                    target_doc = Document(text=target.text, source_filename=att.filename, mime=att.mime)
                    target_spans = rules_detector.detect(target_doc) + embed_detector.detect(target_doc)
                    if not target_spans:
                        continue
                    targets.append((target, len(tokenise_inputs)))
                    tokenise_inputs.append((target.text, target_spans))
                if targets:
                    xlsx_redaction_inputs.append((att, targets))

        redacted_items, map_id = tokeniser.tokenise_many(tokenise_inputs)
        redacted_prompt = redacted_items[0]
        for att, redacted_index in attachment_redaction_inputs:
            redacted_attachments.append(_redacted_attachment(att, redacted_items[redacted_index]))
        for att, docx, targets in docx_redaction_inputs:
            for target, redacted_index in targets:
                target.text = redacted_items[redacted_index]
            redacted_attachments.append(_redacted_docx_attachment(att, docx))
        for att, deck, targets in pptx_redaction_inputs:
            for target, redacted_index in targets:
                target.text = redacted_items[redacted_index]
            redacted_attachments.append(_redacted_pptx_attachment(att, deck))
        for att, redacted_index in pdf_redaction_inputs:
            redacted_attachments.append(_redacted_pdf_attachment(att, redacted_items[redacted_index]))
        for att, targets in xlsx_redaction_inputs:
            replacements = {target: redacted_items[redacted_index] for target, redacted_index in targets}
            redacted_attachments.append(_redacted_xlsx_attachment(att, replacements))

        # SD-1: the audit row holds the REDACTED text; the original lives
        # only in the vault.
        prompt_text_for_audit = redacted_prompt

    status = "pending" if verdict.decision == "hold" else "auto"

    log_id = repos.audit.create(AuditRecord(
        log_id="",
        user_id=req.user_id,
        ts=datetime.now(timezone.utc),
        target_host=req.target_host,
        prompt_text=prompt_text_for_audit,
        filename=req.attachments[0].filename if req.attachments else None,
        data_classes=list(data_classes),
        decision=verdict.decision,
        reason=verdict.reason,
        status=status,
        reviewer=None,
        reviewed_at=None,
        remark=None,
        map_id=map_id,
        user_department=user.department,
        content_department=content_department,
        department_confidence=department_confidence,
    ))

    return InspectResponse(
        decision=verdict.decision,       # type: ignore[arg-type]
        log_id=log_id,
        data_classes=list(data_classes),
        redacted_prompt=redacted_prompt,
        redacted_attachments=redacted_attachments,
        reason=verdict.reason,
    )


# --------------------------------------------------------------------------
# Audit / approval loop
# --------------------------------------------------------------------------


@app.get("/v1/inspect/{log_id}")
def get_inspect_status(log_id: str, repos: Repos = Depends(get_repos)) -> dict:
    rec = repos.audit.get(log_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="unknown log_id")
    return {"decision": rec.decision, "status": rec.status}


@app.get("/v1/logs")
def list_logs(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = None,
    decision: str | None = None,
    cross_department_only: bool = Query(False),
    repos: Repos = Depends(get_repos),
) -> dict:
    rows, total = repos.audit.list(limit=limit, offset=offset,
                                   status=status, decision=decision,
                                   cross_department_only=cross_department_only)
    return {"items": rows, "total": total, "limit": limit, "offset": offset}


@app.post("/v1/logs/{log_id}/decision")
def decide_log(
    log_id: str,
    approve: bool = Body(...),
    remark: str = Body(...),
    repos: Repos = Depends(get_repos),
) -> AuditRecord:
    try:
        return repos.audit.set_decision(
            log_id, approve=approve, reviewer=DASHBOARD_ADMIN, remark=remark,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="unknown log_id")


@app.get("/v1/stats")
def stats(repos: Repos = Depends(get_repos)):
    return repos.audit.stats()


# --------------------------------------------------------------------------
# Policy and tools (IF-10)
# --------------------------------------------------------------------------


@app.get("/v1/rules")
def list_rules(repos: Repos = Depends(get_repos)):
    return repos.rules.all()


@app.get("/v1/tools")
def list_tools(repos: Repos = Depends(get_repos)) -> list[dict]:
    # TODO(team decision): no repo method returns a usage count. Stopgap --
    # page repos.audit.list() and count target_host in Python. At 30 seed
    # rows this is free; it will not be at 30,000.
    all_rows, _total = repos.audit.list(limit=10_000, offset=0)
    usage = Counter(row.target_host for row in all_rows)
    return [
        {**asdict(tool), "usage_count": usage.get(tool.host, 0)}
        for tool in repos.tools.all()
    ]


@app.post("/v1/tools/{host}/decision")
def decide_tool(
    host: str,
    status: str = Body(...),
    remark: str = Body(...),
    repos: Repos = Depends(get_repos),
):
    if repos.tools.by_host(host) is None:
        raise HTTPException(status_code=404, detail="unknown host")
    # _set_status is not on the ToolRepo protocol yet -- see the note in
    # app/repo/memory.py. Both backends implement it; M1 wires it here until
    # the team promotes it to IF-9. AiTool has no remark column (open
    # question, see docs/prompts/M1.md notes) -- accepted on the wire,
    # nowhere to persist it yet.
    del remark
    return repos.tools._set_status(host, status, DASHBOARD_ADMIN)  # type: ignore[attr-defined]


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------


@app.get("/v1/health")
def health() -> dict:
    return {"status": "ok", "mocked": sorted(MOCK_MODULES)}
