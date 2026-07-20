# M5 — paste-ready prompt

Fresh session. One module, one session, one branch. Paste **Part 1** (your
standard context block — the same one every module session gets), then **Part
2** (this task), then send. Part 1 is unchanged from the canonical block; it is
what keeps this session aligned with the M2 and M8 sessions that consume M5's
output. Do not skip it.

---

## Part 2 — M5 TASK

```
TASK: build M5, the file extractor. Turn an uploaded attachment into a flat
text Document for the detection layer. Nothing more.

OWNERSHIP — read this first.
M5 is P1 and stands alone. You produce IF-4 (Document). It is consumed by M2
(rules detector) and M8 (embedding detector), in other sessions, against the
frozen Document contract. You do NOT build detection, policy, the vault, the
API, or storage. You never open a Session, never import app/models.py, never
touch the network or the database. Backend-as-black-box does not apply to you
either way: you are a pure function over bytes.

THE SEAM — already in place, do not move it.
backend/app/extract/files.py ALREADY EXISTS and already defines:

    class UnsupportedFile(Exception): ...      # M1 put it here; -> 415

M1 placed UnsupportedFile in this file on purpose: main.py's 415 handler and
the mock both import it from here, and this is where your real extract() will
also raise it. DO NOT redefine it, move it, or change its name. You ADD
extract() beneath it and change nothing else in the file's existing lines.

    def extract(filename: str, mime: str, content_b64: str) -> Document

Import Document from app/detect/base.py. DO NOT edit base.py — it is frozen:

    @dataclass(frozen=True)
    class Document:
        text: str
        source_filename: str | None   # the attachment's filename here
        mime: str                     # echo the incoming mime

THE CALL SITE — so you know landing M5 is a one-line swap.
main.py builds the extractor via get_extractor() and calls it once per
attachment:

    extract = get_extractor()
    documents.append(extract(att.filename, att.mime, att.content_b64))

When M5 lands: remove M5 from MOCK_MODULES in .env, and delete mock_extract
from app/mocks.py (its "DELETE WHEN M5 LANDS" block). get_extractor() then
returns your real extract(). Nothing else in the pipeline moves.

DISPATCH — decide on the EXTENSION, not the mime.
Lowercase the filename suffix and switch on it. Treat `mime` as an advisory
hint only, never the primary key: browsers routinely send
application/octet-stream (or nothing) for .docx and .pptx, and mime-first
dispatch would 415 perfectly valid files. Echo the incoming mime back into
Document.mime unchanged; the detectors do not read it.

IMPLEMENT — text extraction only, flat string out.

  .pdf   pdfplumber. Concatenate page text with a single blank line between
         pages. page.extract_text() returns None for an image-only page —
         treat that as "" (you do NOT OCR).
  .docx  python-docx. Every paragraph, plus every table cell. Join with
         newlines; order is not important, the detectors want a flat string.
  .pptx  python-pptx. Every shape's text frame across every slide, PLUS
         speaker notes (guard: a slide's notes_slide can be absent).
  .csv   pandas. Read every cell as text (dtype=str, keep_default_na=False)
         so "NA"/"0123" are not coerced or dropped. Emit the header row plus
         every cell, whitespace-joined.
  .txt   decode the bytes as UTF-8 with errors="replace". No parsing.

Anything else → raise UnsupportedFile(f"...{ext}...").

HOSTILE-FILE RULES — assume every uploaded file is an attack.
  - Parse from IN-MEMORY bytes only (io.BytesIO / io.StringIO). Never write
    the upload to disk. Never pass a path or a URL to any parser — pass bytes.
    This closes path-traversal and parser-side SSRF in one move.
  - Extract text and nothing else: no OCR, no image extraction, no layout,
    no macros, no hyperlink resolution, no remote images, no external
    references followed. Pull the visible text, drop everything else.
  - SIZE CAP FIRST. Reject before parsing if the DECODED content exceeds
    5 MB (5 * 1024 * 1024 bytes). Check the decoded length, not the base64
    string. This is also your main defence against zip-bomb / XML entity
    expansion in the OOXML (.docx/.pptx) and PDF paths; note in a comment
    that heavier XXE hardening is post-MVP and the size cap bounds the risk.
  - DEGRADE, don't explode. Wrap base64-decode failures and every parser
    exception and re-raise as UnsupportedFile with a short message. A
    malformed upload must become a clean 415, never a 500 stack trace. The
    pipeline maps ONLY UnsupportedFile to a status code; anything else you
    let escape becomes an unhandled 500.
  - An empty-but-valid file (a 0-byte .txt, a blank .csv) is NOT an error:
    return Document(text="", ...). The detectors handle empty text.

WIRING: you produce IF-4 (Document), consumed by M2 and M8. You consume
nothing from other modules. Dependencies are already in
backend/requirements.txt (pdfplumber, python-docx, python-pptx, pandas,
python-multipart) — do not add or pin new ones.

DELIVER:
  - One small fixture per format in backend/tests/fixtures/ (.pdf .docx
    .pptx .csv .txt), each containing a known string you assert on.
  - pytest in backend/tests/test_extract_files.py:
      * one round-trip per format (fixture -> extract -> known text present),
      * the 5 MB size-limit rejection,
      * an unsupported extension -> UnsupportedFile,
      * a truncated/corrupt file of a supported type -> UnsupportedFile
        (NOT a 500-style crash),
      * a bad base64 payload -> UnsupportedFile,
      * an empty .txt -> Document(text="").
  - A __main__ block that reads a path from argv, base64-encodes the bytes,
    calls extract(), and prints the resulting text, so M5 is demoable from the
    command line before the API is running:
        python -m app.extract.files samples/report.pdf

GROUND RULES (still binding):
1. The contracts are law. If M5 seems to need a change to Document or
   UnsupportedFile, STOP and say so — do not change them locally.
2. Build ONLY M5. Do not "helpfully" implement a detector or the pipeline.
3. Python 3.11, full type hints. No new external services, no new deps.
4. Every module ships with a way to prove it works from the command line.
```
