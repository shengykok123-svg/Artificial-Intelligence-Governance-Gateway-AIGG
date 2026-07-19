# File extraction and redaction status

This document records the current local file extraction/redaction scope and the
remaining limitations.

## Current local support

The local branch supports pre-upload inspection and replacement for:

| Type | Extraction | Redaction replacement |
| --- | --- | --- |
| TXT | UTF-8 text | `*.redacted.txt` |
| CSV | UTF-8 text | `*.redacted.csv` |
| PDF with text | `pdfplumber` text extraction | New text-only `*.redacted.pdf` |
| Scanned PDF | Tesseract OCR fallback | New text-only `*.redacted.pdf` |
| DOCX | Body, tables, headers, footers, comments, tracked changes | `*.redacted.docx` |
| PPTX | Slide text, speaker notes, comments | `*.redacted.pptx` |
| XLSX | Shared strings and inline worksheet strings | `*.redacted.xlsx` |
| PNG/JPEG | Tesseract OCR | `*.redacted.png` with sensitive OCR word boxes blacked out |
| DOCX/PPTX embedded OOXML packages | Embedded `.docx`, `.pptx`, `.xlsx` zip packages | Redacted inside the embedded package and written back into the outer file |

## Fail-closed behavior

Legacy OLE embedded objects such as:

```text
word/embeddings/oleObject*.bin
ppt/embeddings/oleObject*.bin
```

are not parsed. They return HTTP 415 (`UnsupportedFile`) so the extension does
not attach the file silently. This is intentional because the content cannot be
locally inspected with the current dependency set.

## OCR notes

Current OCR backend: local Tesseract CLI.

Configuration:

```powershell
$env:TESSERACT_EXE = "C:\Program Files\Tesseract-OCR\tesseract.exe"
```

OCR preprocessing currently:

- applies EXIF orientation correction;
- tries original RGB, autocontrasted grayscale, and thresholded black/white
  variants;
- runs Tesseract with page segmentation modes `6`, `11`, and `12`;
- chooses the candidate with the best confidence/text score.

OCR limitations remain:

- blurry, low-resolution, handwritten, rotated, or complex-layout images can
  still be missed;
- OCR is slower than deterministic text extraction;
- teammate machines need Tesseract installed or `TESSERACT_EXE` set.

Alternatives are recorded in `docs/OCR_OPTIONS.md`.

## Integration note after fetching teammate main

`origin/main` currently contains teammate M5 extraction work plus M9/debug-panel
changes. The local redaction work is being merged on top of `origin/main`, not
pushed directly from the older local `main`.

Expected conflict areas:

- `.env.example`
- `README.md`
- `backend/app/extract/files.py`
- `backend/app/main.py`
- `backend/app/schemas.py`
- `backend/tests/test_extract_files.py`
- `backend/tests/test_main.py`

Important merge direction:

- Keep teammate's real M5 extraction foundation where it overlaps.
- Add the local redaction contract on top:
  `RedactedAttachment`, `InspectResponse.redacted_attachments`, and extension
  `redacted_attachments` handling.
- Preserve teammate M9/debug metadata:
  `DetectionDebug`, `InspectDebug`, `InspectResponse.debug`,
  `content_department`, and `department_confidence`.
- Preserve extension debug-panel additions while keeping upload pre-processing
  and redacted-file injection.
