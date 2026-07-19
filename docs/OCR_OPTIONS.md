# OCR backend options

Current default: Tesseract OCR through the local `tesseract.exe` CLI.

Why Tesseract is the default now:

- It runs locally and offline, which matches the privacy-gateway goal.
- It is already available on the current Windows machine at
  `C:\Program Files\Tesseract-OCR\tesseract.exe`.
- It avoids adding a large PyTorch-based OCR stack to the demo path.

Current preprocessing before Tesseract:

- Apply EXIF orientation correction.
- Try the original RGB image, an autocontrasted grayscale image, and a
  thresholded black/white image.
- Run Tesseract with page segmentation modes `6`, `11` and `12`.
- Pick the candidate with the strongest confidence/text score.

Configuration:

```powershell
$env:TESSERACT_EXE = "C:\Program Files\Tesseract-OCR\tesseract.exe"
```

Alternatives to revisit later:

| Backend | Pros | Cons | Fit |
| --- | --- | --- | --- |
| Tesseract OCR | Local, offline, free, simple dependency story | Weaker on blurry images, complex layouts and handwriting | Current default |
| EasyOCR | Better on natural images and multilingual cases | Pulls in PyTorch and heavier runtime dependencies | Possible local upgrade |
| PaddleOCR | Stronger on Asian-language documents and layout-heavy pages | Heavy setup, especially on Windows | Possible later upgrade |
| Azure AI Vision OCR | High accuracy and managed deployment | Cloud key, cost, network dependency, file leaves local boundary | Enterprise optional |
| Google Cloud Vision OCR | High accuracy | Cloud key, cost, network dependency, file leaves local boundary | Enterprise optional |
| AWS Textract | Strong forms and table extraction | Cloud key, cost, setup overhead | Enterprise document option |
| OpenAI vision model | Strong visual understanding | Not a good default for a privacy gateway because the sensitive image is sent out before local screening | Avoid for pre-send OCR |

Preferred future design:

```text
OCR_BACKEND=tesseract | disabled | azure | google | aws
TESSERACT_EXE=C:\Program Files\Tesseract-OCR\tesseract.exe
```

Default behavior should remain local-first:

- Tesseract present: OCR enabled.
- Tesseract missing: image/scanned-PDF OCR should be disabled or return
  unsupported, while ordinary text PDF extraction still works.
- Cloud OCR should be opt-in and clearly documented as sending document content
  to a third-party OCR provider.
