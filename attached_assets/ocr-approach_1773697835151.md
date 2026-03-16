# OCR Pipeline Architecture — Developer Reference

This document describes the multi-layered OCR pipeline used to extract structured juror data from court strike list documents (PDFs, images, and plain text). It is written as a blueprint for reimplementing the same approach in another codebase.

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        File Upload (Multer)                      │
│          Accepts: images, PDFs, TXT/CSV — multi-file upload      │
└──────────────┬──────────────────┬──────────────────┬─────────────┘
               │                  │                  │
          Image file          PDF file          Text file
               │                  │                  │
               ▼                  ▼                  ▼
     ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
     │ Gemini Vision    │  │ PDF Pipeline │  │ Direct AI Parse  │
     │ (single image)   │  │ (see below)  │  │ (raw text→Gemini)│
     └─────────────────┘  └──────┬───────┘  └──────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       Strategy 1:         Strategy 2:        Strategy 3:
       Gemini Vision       Tesseract OCR      PDF text extraction
       (image batches)     (fallback)         (last resort)
              │                  │                  │
              └──────────────────┼──────────────────┘
                                 ▼
                      ┌────────────────────┐
                      │ JSON Normalization │
                      │ + needsReview flag │
                      └────────────────────┘
                                 ▼
                        Sorted juror array
```

---

## Step-by-Step Processing Flow

### 1. File Upload & Routing

The upload endpoint accepts one or more files via `multipart/form-data` (field: `files`) or raw text via `req.body.text`. Each file is classified by MIME type and extension:

| Category   | MIME types                                                                 | Extensions                                         |
|------------|---------------------------------------------------------------------------|-----------------------------------------------------|
| **Image**  | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/bmp`, `image/tiff`, `image/heic`, `image/heif`, `image/avif`, `image/svg+xml` | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.tiff`, `.tif`, `.heic`, `.heif`, `.avif`, `.svg` |
| **Document** | `application/pdf`, `text/plain`, `text/csv`, `text/tab-separated-values` | `.pdf`, `.txt`, `.csv`, `.tsv`                      |

Files are processed concurrently via `Promise.allSettled`. If a single file is uploaded and fails, the error propagates to the client. In multi-file mode, failures on individual files are logged but non-fatal.

### 2. Routing Logic

```
if (image file)  → parseStrikeListFromImage()
if (PDF file)    → parseStrikeListFromPdf()
if (text file)   → parseStrikeListWithAI(rawText)
```

---

## Three-Tier Extraction Strategy (PDF Pipeline)

PDFs go through a cascading strategy that falls back progressively:

### Strategy 1: Gemini Vision (Primary)

1. **Render PDF to images** using `pdftoppm` (poppler-utils).
2. **Compress** each page image if needed (see compression logic below).
3. **Batch** compressed images by total size.
4. **Send batches** to Gemini Vision API for structured extraction.

If Gemini returns results, they are used directly. In multi-batch scenarios, if one batch fails but others succeed, the pipeline continues with **partial results** from the successful batches rather than immediately falling back. The Tesseract fallback only triggers when a single-batch PDF fails entirely or when all batches collectively produce zero jurors.

### Strategy 2: Tesseract OCR (Fallback)

Triggered when:
- All page images are too large even after maximum compression.
- Gemini fails on a single-batch PDF.
- Gemini extracts zero jurors from all batches.

Process:
1. Run `Tesseract.recognize()` on each rendered page image (language: `eng`).
2. Concatenate all extracted text.
3. Send concatenated text to Gemini for structured parsing via `parseStrikeListWithAI()`.

### Strategy 3: PDF Text Extraction (Last Resort)

Triggered when:
- PDF rendering itself fails (`pdftoppm` error).
- No pages are rendered from the PDF.

Process:
1. Use `pdf-parse` to extract embedded text from the PDF.
2. Send extracted text to Gemini for structured parsing via `parseStrikeListWithAI()`.

---

## PDF-to-Image Rendering Pipeline

### DPI Selection by File Size

The render resolution is scaled down for large PDFs to keep memory and processing time manageable:

| PDF size         | DPI |
|------------------|-----|
| > 100 MB         | 150 |
| > 50 MB          | 200 |
| ≤ 50 MB          | 300 |

### pdftoppm Usage

```bash
pdftoppm -jpeg -r <dpi> "<input.pdf>" "<output-prefix>"
```

- Timeout: 120 seconds
- Max output buffer: 500 MB
- Runs synchronously via `execSync`
- Output files are read, then the temp directory is cleaned up in a `finally` block

### Image Compression (per page)

Each rendered page must fit within the **20 MB per-page limit** (`MAX_PAGE_SIZE`). Compression is applied progressively:

**Phase 1 — Quality reduction (original resolution):**

| Step | JPEG quality |
|------|-------------|
| 1    | 70          |
| 2    | 50          |
| 3    | 30          |

**Phase 2 — Resolution + quality reduction:**

| Step | Scale factor | JPEG quality |
|------|-------------|-------------|
| 1    | 0.75×       | 40          |
| 2    | 0.50×       | 40          |
| 3    | 0.25×       | 40          |

If the page still exceeds 20 MB after all steps, it is **skipped** (logged as a warning).

### Batching by Size

Compressed pages are grouped into batches with a maximum total size of **32 MB** (`MAX_BATCH_SIZE`). Each batch is sent as a single Gemini Vision request containing multiple inline images.

---

## Image File Handling

Single image uploads follow a simpler path:

1. **MIME resolution** — resolve the actual image type using both the declared MIME type and the file extension.
2. **Format conversion** — non-native formats (`bmp`, `tiff`, `heic`, `heif`, `avif`, `svg`) are converted to JPEG at quality 85 via `sharp`.
3. **Compression** — the same progressive compression pipeline is applied (quality reduction → resolution reduction).
4. **Gemini Vision** — the compressed image is sent as a single inline image.

Native Gemini formats (no conversion needed): `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

---

## AI Prompting Approach

### System Prompt Structure

The prompt instructs Gemini to act as a "legal document parsing assistant specializing in jury strike lists." Key elements:

1. **Role definition** — establishes the domain context (court strike lists, various formats).
2. **Field schema** — defines exactly 11 fields per juror: `number`, `name`, `address`, `cityStateZip`, `phone`, `sex`, `race`, `birthDate`, `occupation`, `employer`, `needsReview`.
3. **Juror numbering rules** — critical instruction to preserve original numbers from the document rather than renumbering sequentially. Sequential numbering (1-based) is only used when no numbers appear in the source.
4. **Garbled text handling** — detailed instructions for corrupted OCR text:
   - Characters like `~`, `§`, `¥`, `!`, random symbols → mark as `"Illegible"`, set `needsReview: true`.
   - Partial names visible within garbled text → include as `"NAME (partial)"`.
   - Never output raw garbled characters as field values.
5. **Default values** — `"Unknown"` for absent fields, `"Illegible"` for present but unreadable fields, `"U"` for unknown sex/race.
6. **Output format** — strict JSON: `{ "jurors": [ { ... } ] }`.

### Prompt Variants

| Input type      | Prompt suffix                                                                 |
|-----------------|-------------------------------------------------------------------------------|
| Image (single)  | `"Parse the following strike list image and extract all juror data. Return ONLY valid JSON."` |
| Image (batch)   | `"Parse the following strike list page image(s) and extract all juror data. Return ONLY valid JSON."` |
| Text            | `"Parse the following strike list document and extract all juror data:\n\n<text>"` |

### Generation Config

```json
{
  "temperature": 0.1,
  "responseMimeType": "application/json"
}
```

- **Low temperature (0.1)** minimizes creative/hallucinated output.
- **JSON response MIME type** forces Gemini to produce structured JSON.

---

## Retry & Model Fallback Logic

### Model Cascade

| Priority  | Model name                     |
|-----------|--------------------------------|
| Primary   | `gemini-3.1-flash-lite-preview` |
| Fallback  | `gemini-2.0-flash`              |

### Retry Behavior

For each model, up to **2 retries** (`GEMINI_MAX_RETRIES = 2`) are attempted on transient errors:

| Attempt | Delay before retry |
|---------|--------------------|
| 1st     | 3,000 ms           |
| 2nd     | 8,000 ms           |

**Retryable conditions** (any of):
- HTTP status `503` or `429`
- Error message contains `"high demand"`, `"overloaded"`, or `"Service Unavailable"`

**Non-retryable errors** are thrown immediately without using remaining retries or falling back.

**Flow:**
1. Try primary model with up to 2 retries.
2. If all retries exhausted on retryable errors → try fallback model with up to 2 retries.
3. If fallback also exhausted → throw the last error.

---

## JSON Normalization Layer

The `parseJurorJson()` function normalizes the AI's response into a consistent `ParsedJuror[]` array.

### JSON Parsing

1. Attempt `JSON.parse()` on the raw response text.
2. If that fails, extract the first `{...}` block via regex and parse that.
3. If both fail, throw an error.

### Array Extraction

The juror array is located by checking these keys in order:
- `parsed.jurors`
- `parsed.data`
- If `parsed` is itself an array, use it directly.

### Field Mapping

Each field is mapped from multiple possible AI response key names:

| Target field   | Accepted AI keys                                          | Default    |
|----------------|-----------------------------------------------------------|------------|
| `name`         | `name`                                                    | `"Unknown"`|
| `address`      | `address`                                                 | `"Unknown"`|
| `cityStateZip` | `cityStateZip`, `city_state_zip`, `cityState`             | `"Unknown"`|
| `phone`        | `phone`, `telephone`, `tel`, `phoneNumber`, `phone_number`| `"Unknown"`|
| `sex`          | `sex`, `gender` → first character, uppercased             | `"U"`      |
| `race`         | `race`, `ethnicity` → first character, uppercased         | `"U"`      |
| `birthDate`    | `birthDate`, `birth_date`, `dob`, `dateOfBirth`, or `age` (→ `"Age: N"`) | `"Unknown"` |
| `occupation`   | `occupation`, `job`                                       | `"Unknown"`|
| `employer`     | `employer`, `company`                                     | `"Unknown"`|

### Juror Number Assignment

```
rawNum = Number(j.number)
jurorNumber = isFinite(rawNum) && rawNum > 0 ? rawNum : index + 1
```

Uses the AI-provided number if valid and positive; otherwise falls back to 1-based index.

### Automatic `needsReview` Flagging

A juror is flagged `needsReview = true` if:
- The AI explicitly set `needsReview: true`, **OR**
- Any field value equals `"Illegible"` or contains `"(partial)"`.

---

## Dependencies

### npm Packages

| Package                    | Purpose                                      |
|----------------------------|----------------------------------------------|
| `@google/generative-ai`   | Google Gemini API client (Vision + text)      |
| `tesseract.js`             | Browser/Node OCR engine (fallback)            |
| `sharp`                    | Image conversion, compression, and resizing   |
| `pdf-parse`                | Extract embedded text from PDF files          |
| `multer`                   | Multipart file upload middleware (Express)     |

### System Dependencies

| Tool         | Package (apt/nix)   | Purpose                           |
|--------------|---------------------|-----------------------------------|
| `pdftoppm`   | `poppler-utils`     | Render PDF pages to JPEG images   |

### Environment Variables

| Variable         | Required | Purpose                        |
|------------------|----------|--------------------------------|
| `GEMINI_API_KEY` | Yes      | Google Generative AI API key   |

---

## Quick-Start Checklist

1. **Install system deps**: Ensure `pdftoppm` is available (`apt install poppler-utils` or equivalent).
2. **Install npm packages**: `npm install @google/generative-ai tesseract.js sharp pdf-parse multer`
3. **Set environment variable**: `GEMINI_API_KEY=<your-key>`
4. **Copy the core module**: Bring over the `parseStrikeList.ts` file (or reimplement based on this document).
5. **Wire up the upload route**: Accept `multipart/form-data` with a `files` field, classify by type, and call the appropriate parse function.
6. **Handle the response**: The pipeline returns `ParsedJuror[]` — sort by `number` and return to the client.
7. **Surface `needsReview`**: Flag jurors with `needsReview: true` in the UI for manual verification.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Three-tier fallback (Vision → Tesseract → text extraction) | Court PDFs vary wildly in quality; no single method works for all. Vision is most accurate but has size limits; Tesseract handles oversized images; text extraction works for digitally-generated PDFs. |
| Progressive compression before Gemini | Gemini has inline data size limits. Reducing quality before resolution preserves text readability. |
| Low temperature (0.1) | Structured data extraction requires deterministic output; creative variation causes field errors. |
| `needsReview` auto-flagging in normalization | The AI may not reliably flag uncertain data. Client-side detection of `"Illegible"` and `"(partial)"` values catches cases the AI missed. |
| Preserve original juror numbers | Court strike lists use specific numbering (e.g., 13–24 for a second panel). Sequential renumbering would lose this legally significant information. |
| Model cascade (flash-lite → flash) | The lite model is faster and cheaper for straightforward documents; the full model handles edge cases when the lite model is unavailable or overloaded. |
| Concurrent file processing with `Promise.allSettled` | Multi-file uploads are processed in parallel. Individual failures don't block other files from being parsed. |
