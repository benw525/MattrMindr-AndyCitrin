# Feature Replication Prompt — Plaintiff Case Management System

You are building features for a plaintiff law firm case management system. This document describes every feature that needs to be implemented. Build each feature in order, as some later features depend on earlier ones. The application uses a Node.js/Express backend with PostgreSQL, and a React frontend. Media storage uses Cloudflare R2. AI features use OpenAI (with optional multi-model support via a proxy).

Throughout this document, all terminology is oriented toward a **plaintiff litigation firm** — cases represent clients who are plaintiffs, attorneys represent plaintiffs, and the system is designed to support civil litigation workflows (personal injury, medical malpractice, mass torts, etc.).

---

## FEATURE 1: Voicemail Tab in Correspondence

### Overview
Add a "Voicemails" sub-tab inside the Correspondence section of a case. This tab filters incoming emails that are flagged as voicemails (e.g., from services like RingCentral, Google Voice, or Vonage that email voicemail recordings).

### Database Changes
Add a boolean column to the correspondence/emails table:
```sql
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS is_voicemail BOOLEAN DEFAULT false;
```

### Backend
- In the inbound email processing route, detect voicemails by checking if the email subject contains "Voice Message" (case-insensitive). Set `is_voicemail = true` for matching emails.
- No new API routes needed — the existing correspondence fetch endpoint returns the `is_voicemail` field.

### Frontend
- Add a "Voicemails" sub-tab button in the Correspondence section, showing a count badge: `Voicemails (N)`.
- Filter the correspondence array for items where `is_voicemail === true`.
- Display each voicemail with sender, date, and body preview.
- Expanded view shows the full body and allows downloading/previewing audio attachments.

---

## FEATURE 2: AI Transcript Name Suggestion

### Overview
When viewing a transcript, provide an AI-powered button that suggests a descriptive filename based on the transcript content (e.g., "Client Deposition — Accident Description" or "Expert Witness — Medical Opinion").

### Backend
Add a new route:
```
GET /api/transcripts/:id/suggest-name
```
- Fetch the transcript segments from the database.
- Send the first 2,000 characters of text to OpenAI's GPT-4o-mini.
- System prompt: "You are an assistant for a plaintiff litigation firm. Based on the following transcript, suggest a short, descriptive name (5-8 words max). Return only the suggested name, nothing else."
- Return `{ suggestedName: "..." }`.

### Frontend
- Add a "Suggest" button with a sparkle/magic icon next to the transcript filename input field.
- On click, call the suggest-name endpoint and populate the filename input with the result.
- The user can review, modify, and save the suggested name.

---

## FEATURE 3: Runtime Database Migration Pattern

### Overview
Ensure all required database columns exist before the server starts accepting requests. This prevents crashes when new columns are added in code but haven't been manually migrated in the database.

### Implementation
In `server/index.js` (or your main server file), before starting the Express listener, run a series of migration statements for any tables/columns added by recent features. Example pattern:

```javascript
async function ensureColumns() {
  const migrations = [
    // Transcript video support
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS is_video BOOLEAN DEFAULT false`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS video_data BYTEA`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS video_content_type TEXT`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS r2_audio_key TEXT`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS r2_video_key TEXT`,
    // Voicemail detection
    `ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS is_voicemail BOOLEAN DEFAULT false`,
    // Document annotations
    `ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '[]'`,
    // Custom agent instruction documents
    `ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS instruction_file BYTEA`,
    `ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS instruction_filename TEXT`,
    `ALTER TABLE custom_agents ADD COLUMN IF NOT EXISTS instruction_text TEXT`,
    // Jury analysis Daubert challenge
    `ALTER TABLE jury_analyses ADD COLUMN IF NOT EXISTS daubert_challenge TEXT`,
  ];

  // Create tables that may not exist yet
  const tableCreations = [
    `CREATE TABLE IF NOT EXISTS transcript_history (
      id SERIAL PRIMARY KEY,
      transcript_id INTEGER REFERENCES case_transcripts(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL,
      change_description TEXT,
      previous_state JSONB,
      changed_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS custom_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      data_source TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      visibility TEXT DEFAULT 'private',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  for (const sql of tableCreations) {
    await pool.query(sql).catch(() => {});
  }
  for (const sql of migrations) {
    await pool.query(sql).catch(() => {});
  }
  console.log("Runtime schema migrations applied.");
}

// Call before server.listen()
await ensureColumns();
```

This pattern is critical — it makes deployments seamless without requiring manual database migrations. Every new table and column introduced by the features below should be added to this migration list.

---

## FEATURE 4: Transcript History and Revert

### Overview
Track every edit made to a transcript so users can view version history and revert to any previous version. This is essential for maintaining an accurate record of depositions, witness statements, and expert testimony.

### Database Schema
Create a `transcript_history` table:
```sql
CREATE TABLE IF NOT EXISTS transcript_history (
  id SERIAL PRIMARY KEY,
  transcript_id INTEGER REFERENCES case_transcripts(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL,
  change_description TEXT,
  previous_state JSONB,
  changed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

`change_type` values: `text_edit`, `speaker_change`, `merge`, `revert`.

### Backend Routes
Mount under `/api/transcripts`:

1. **GET `/:id/history`** — Return up to 200 history entries for a transcript, ordered by most recent first.
2. **POST `/:id/history`** — Save one or more history entries. Expects `{ changes: [{ changeType, changeDescription, previousState, changedBy }] }`.
3. **POST `/:id/revert/:historyId`** — Revert a transcript to a previous version:
   - Fetch the `previous_state` from the specified history entry.
   - Save the *current* transcript state as a new history entry (type: `revert`) before overwriting — this ensures no data is ever permanently lost.
   - Update the transcript's content with the `previous_state`.
   - Return the restored transcript.

### Frontend
- **Auto-save with history**: Use a `useEffect` with a 2-second debounce. When transcript edits change, compare against the previous state, identify the change type (`text_edit`, `speaker_change`, or `merge`), save the update, and log the change to history.
- **Version History UI**: Add a "Version History" button in the transcript editor. Clicking it opens a dropdown/panel showing:
  - A chronological list of changes with color-coded labels (orange for reverts, purple for merges, indigo for edits).
  - Each entry shows: description, who made the change, relative timestamp.
  - A "Revert" button on each entry that has a `previousState`.

---

## FEATURE 5: Document Viewer and Editor

### Overview
Build a comprehensive in-app document viewer that supports multiple file formats with editing capabilities. This eliminates the need to download files to view or annotate them.

### Supported File Types

#### PDF Viewer and Annotator
Create a dedicated `PdfViewer` component using `pdfjs-dist`:
- Render PDF pages to HTML canvases.
- Annotation toolbar with tools:
  - **Highlight** — Yellow semi-transparent overlay on selected areas.
  - **Draw** — Freehand drawing (pen tool).
  - **Shapes** — Rectangle, Circle, Arrow, Underline.
  - **Text** — Insert custom text annotations.
  - **Stamps** — Predefined stamps: "CONFIDENTIAL", "APPROVED", "EXHIBIT", "DRAFT", "PRIVILEGE".
  - **Eraser** — Remove individual annotations.
  - **Undo** — Revert the last annotation action.
  - **Search** — Find text within the PDF (highlight matches on canvas, fallback to extracted text).
- Save annotations as JSON via `PUT /api/case-documents/:id/annotations`.
- Annotations are stored in a JSONB column on the `case_documents` table:
  ```sql
  ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '[]';
  ```

#### Word Document (DOCX) Editor
- Backend route: `GET /api/case-documents/:id/html` — converts DOCX to HTML using `mammoth`.
- Frontend: Display the HTML in a `contentEditable` div.
- Editing toolbar: Bold, Italic, Underline, Strikethrough, Font Size, Text Color, Background Color, Ordered/Unordered Lists, Indentation, Alignment.
- Save: `PUT /api/case-documents/:id/content` — sends updated HTML back to server. The server stores the HTML string in a `content_html TEXT` column on `case_documents`. When downloading the original file, the system serves the original DOCX. The HTML representation is used only for in-app viewing and editing. Add this column to the runtime migrations:
  ```sql
  ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS content_html TEXT;
  ```

#### Excel (XLSX) Viewer/Editor
- Backend route: `GET /api/case-documents/:id/xlsx-data` — parses XLSX using `xlsx` (SheetJS) and returns JSON structure: `{ sheets: [{ name, rows: [[cell, cell, ...]] }] }`.
- Frontend: Render as interactive table with cell-level editing.
- Cell styling: Bold, Italic, Underline, Color, Background, Alignment, Number Formatting.
- Save: `PUT /api/case-documents/:id/xlsx-data` — sends updated JSON structure back.

#### PowerPoint (PPTX) Viewer/Editor
- Backend route: `GET /api/case-documents/:id/pptx-slides` — parses PPTX using the `pptx-parser` npm package (or manually via `jszip` by extracting XML from the PPTX archive and parsing slide XML for text runs and positions). Returns JSON structure: `{ slides: [{ texts: [{ text, x, y, width, height, bold, italic, color, fontSize }] }] }`.
- Frontend: Render slides as positioned containers with absolute-positioned text blocks. Each block is editable (contentEditable or input).
- Text styling: Bold, Italic, Color, Font Size.
- Save: `PUT /api/case-documents/:id/pptx-slides` — stores the updated JSON structure. As with DOCX, the original PPTX is preserved for download; the JSON is for in-app editing.

#### Image Viewer
- Display images (PNG, JPG, GIF, SVG, WebP) via Blob URL.
- No editing — view only.

#### Plain Text Viewer
- Display extracted text content in a basic viewer.

### Backend Routes Summary
Add to `server/routes/case-documents.js`:
```
GET  /:id/html          — DOCX to HTML conversion
PUT  /:id/content       — Save edited document content
GET  /:id/xlsx-data     — XLSX to JSON
PUT  /:id/xlsx-data     — Save edited XLSX data
GET  /:id/pptx-slides   — PPTX to JSON
PUT  /:id/pptx-slides   — Save edited PPTX data
PUT  /:id/annotations   — Save PDF annotations
GET  /:id/annotations   — Get PDF annotations
```

### Required Packages
- `pdfjs-dist` — PDF rendering
- `mammoth` — DOCX to HTML
- `xlsx` — Excel parsing
- `pptx-parser` or equivalent — PowerPoint parsing

---

## FEATURE 6: Exhibit Selection from Existing Documents

### Overview
When adding exhibits to a trial session, allow users to select from documents already uploaded to the case instead of requiring a new file upload every time.

### Frontend Changes
- In the "Add Exhibit" form, add a "Select from Case Documents" option alongside the file upload.
- Show a searchable/filterable list of existing case documents.
- When a document is selected, link the exhibit to the existing document record instead of creating a duplicate.

### Backend Changes
- The exhibit creation endpoint should accept an optional `document_id` field.
- If `document_id` is provided, link to the existing document rather than expecting a file upload.
- The exhibit fetch endpoints should JOIN with case_documents to return the linked document's metadata.

---

## FEATURE 7: Clickable Documents — Open in Viewer

### Overview
Everywhere documents appear in the UI (case files, trial exhibits, pinned docs), clicking on a document should open it in the in-app document viewer (Feature 5) instead of triggering a browser download.

### Implementation
- Replace all `<a href="..." download>` patterns with click handlers that open the document viewer modal/overlay.
- The viewer determines the appropriate rendering mode based on MIME type / file extension.
- Keep a "Download" button available inside the viewer for users who need the raw file.

---

## FEATURE 8: Custom Report Builder with AI Assistance

### Overview
Allow users to create custom data reports across various modules (cases, tasks, contacts, calendar events, etc.) with AI-powered configuration assistance.

### Database Schema
```sql
CREATE TABLE IF NOT EXISTS custom_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  data_source TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  visibility TEXT DEFAULT 'private',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

`config` structure:
```json
{
  "columns": ["case_number", "client_name", "status", "assigned_attorney"],
  "filters": [
    { "field": "status", "operator": "equals", "value": "Active" }
  ],
  "sortBy": "created_at",
  "sortDir": "desc",
  "groupBy": "assigned_attorney"
}
```

`visibility`: `private` or `shared`.

### Backend Routes
Mount at `/api/custom-reports`:

1. **GET `/`** — List reports owned by user or shared with the office.
2. **POST `/`** — Create a new report.
3. **PUT `/:id`** — Update a report (owner only).
4. **DELETE `/:id`** — Delete a report (owner only).
5. **POST `/run`** — Execute a report configuration:
   - Dynamically build a SQL query based on a `SCHEMA_MAP` that defines available columns, joins, and computed fields for each data source.
   - Support operators: `equals`, `not_equals`, `contains`, `starts_with`, `greater_than`, `less_than`, `is_empty`, `is_not_empty`, `date_before`, `date_after`, `date_between`.
   - Return the result set as JSON.
6. **POST `/ai-assist`** — AI-powered report configuration:
   - Accept a natural language prompt (e.g., "Show all active cases with trial dates in the next 60 days grouped by attorney").
   - Send to GPT-4o-mini with the schema definition.
   - Return a JSON configuration matching the system's format.

### Frontend
- **Report Builder Form**: Data source selector, column checklist, filter rows (field + operator + value), sort/group options.
- **"Build with AI" Section**: Text input for natural language prompts. Results auto-populate the form fields.
- **Visibility Toggle**: Private vs. Shared with Office (shared reports show a "Shared" badge).
- **Actions**: Run (display results table), Export CSV, Print.
- **Saved Reports List**: Show user's reports and shared reports with edit/delete/run buttons.

---

## FEATURE 9: Custom AI Agents with Multi-Model Support

### Overview
Allow users to create custom AI agents tailored to specific litigation tasks (e.g., "Medical Records Analyzer", "Damages Calculator", "Deposition Prep Assistant"). Agents can use different LLM models and be grounded in uploaded instruction documents.

### Database Schema
```sql
CREATE TABLE IF NOT EXISTS custom_agents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  context_sources JSONB DEFAULT '[]',
  needs_case BOOLEAN DEFAULT true,
  interaction_mode TEXT DEFAULT 'single',
  model TEXT DEFAULT 'gpt-4o-mini',
  visibility TEXT DEFAULT 'private',
  shared_with INTEGER[] DEFAULT '{}',
  instruction_file BYTEA,
  instruction_filename TEXT,
  instruction_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Field explanations:
- `context_sources`: Array of case data sources the agent can access (e.g., `["notes", "filings", "documents", "medical_records"]`).
- `needs_case`: Whether the agent requires a case context to run.
- `interaction_mode`: `single` (one-off prompt/response) or `chat` (conversational with message history).
- `model`: The LLM model to use.
- `visibility`: `private`, `shared_office`, or `shared_users`.
- `shared_with`: User IDs for `shared_users` visibility.
- `instruction_file/filename/text`: Uploaded instruction document storage.

### Multi-Model Support
Implement two helper functions:

```javascript
const VALID_MODELS = ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet", "gemini-2.0-flash"];

function resolveModel(model) {
  if (!VALID_MODELS.includes(model)) return "gpt-4o-mini";
  if (!model.startsWith("gpt-") && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) return "gpt-4o-mini";
  return model;
}

function getClientForModel(model) {
  if (model.startsWith("gpt-")) return standardOpenAIClient;
  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL
    });
  }
  return standardOpenAIClient; // fallback
}
```

Non-OpenAI models (Claude, Gemini) route through the Replit AI integration proxy using OpenAI-compatible API format.

### Backend Routes
Mount at `/api/custom-agents`:

1. **GET `/`** — List agents accessible to the current user.
2. **POST `/`** — Create a new agent.
3. **PUT `/:id`** — Update an agent (owner only).
4. **DELETE `/:id`** — Delete an agent (owner only).
5. **POST `/:id/run`** — Execute in "single" mode with a prompt and optional `caseId`.
6. **POST `/:id/chat`** — Execute in "chat" mode with message history.
7. **POST `/preview`** — Test an agent configuration before saving.
8. **POST `/:id/upload-instructions`** — Upload an instruction document (DOCX, PDF, TXT; 10MB limit via multer). Extract text using mammoth (DOCX) or pdf-parse (PDF). Store raw file in `instruction_file`, filename in `instruction_filename`, extracted text in `instruction_text`.
9. **GET `/:id/download-instructions`** — Download the original instruction file.
10. **DELETE `/:id/clear-instructions`** — Remove instruction file and extracted text.
11. **GET `/available-models`** — Return list of valid models and whether integrations are configured.

### Agent Execution Logic
When executing an agent:
1. Resolve the model using `resolveModel()`.
2. Get the appropriate client using `getClientForModel()`.
3. Build the system prompt from the agent's `system_prompt`.
4. If `instruction_text` exists, append it to the system prompt under a `=== UPLOADED INSTRUCTION DOCUMENT ===` header (truncate at 30,000 characters).
5. If `needs_case` and a `caseId` is provided, fetch the requested `context_sources` data and include it in the prompt.
6. Send to the LLM and return the response.

### Frontend
- **Agent List**: Show cards for each agent with name, model badge, and visibility indicator.
- **Agent Form**: Name, system prompt (textarea), model selector (dropdown with optgroups: "OpenAI" and "Other Providers"), context sources (checkboxes), interaction mode toggle, visibility selector.
- **Model Selector**: Show an amber warning note when non-OpenAI models are selected ("Requires AI integration to be configured").
- **Instructions Section**: Upload button, download link, remove button. Show filename when a document is uploaded.
- **Agent Runner**: Prompt input + case selector (if `needs_case`). Chat mode shows a message thread.

---

## FEATURE 10: Video Transcription Support

### Overview
Extend the transcription system to handle video files in addition to audio. Video files are processed by extracting the audio track using ffmpeg before sending to the Whisper API.

### Supported Video Formats
MP4, WebM, MOV, AVI (MIME types: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`).

### Database Changes
```sql
ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS is_video BOOLEAN DEFAULT false;
ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS video_data BYTEA;
ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS video_content_type TEXT;
ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS r2_video_key TEXT;
```

### Backend Changes
- **Upload**: Detect video MIME types and set `is_video = true`. Store video data in `video_data` column (or R2 with key suffix `/video`).
- **Processing**: In the `processTranscription` function:
  1. Download the source file (video or audio).
  2. Use ffmpeg to extract audio: `ffmpeg -i input -vn -ar 16000 -ac 1 -f wav output.wav`
  3. Use `ffprobe` to determine duration.
  4. If audio > 24MB, split into chunks (each under 24MB).
  5. Send chunks to OpenAI Whisper API (`audio/transcriptions` endpoint with `response_format: "verbose_json"` to get word-level timestamps).
  6. Stitch chunk results together, adjusting timestamps based on chunk offsets. Note: Whisper does not provide speaker diarization. Speaker labels should be set to a default "Speaker" and the user can manually edit speaker names in the transcript editor after transcription completes.
- **Streaming**: For video playback, support HTTP Range requests via R2's `streamFromR2(key, range)` function.

### Frontend Changes
- Accept video file types in the upload input: `.mp4,.webm,.mov,.avi` in addition to audio formats.
- Display a video player icon for video transcripts in the list.
- When viewing a video transcript, show an embedded `<video>` player alongside the transcript text.

---

## FEATURE 11: Drag-and-Drop File Upload

### Overview
Create a reusable `DragDropZone` component and integrate it across all file upload areas in the application.

### DragDropZone Component
```jsx
// Props: onFileSelect, accept (MIME types/extensions), multiple, children
// Features:
// - Visual feedback: border and background color change on drag-over
// - Uses dragCounter ref to handle nested element drag events correctly
// - File validation against accept prop
// - Falls back to hidden <input type="file"> for click-to-browse
// - Calls onFileSelect(files) with validated files
```

Visual states:
- **Default**: Dashed border, muted text "Drag files here or click to browse".
- **Drag active**: Indigo border, light indigo background, "Drop files here" text.

### Integration Points
- Case Documents upload area
- Transcript upload area
- Trial exhibit upload
- Any other file upload form in the application

---

## FEATURE 12: Background Upload Manager

### Overview
Allow users to start file uploads and continue navigating the app while uploads complete in the background. A floating indicator shows progress.

### Implementation

#### `startBackgroundUpload` Function (in App.js or top-level component)
```javascript
function startBackgroundUpload({ file, caseId, type, onComplete }) {
  const uploadId = generateUniqueId();
  setActiveUploads(prev => [...prev, { id: uploadId, filename: file.name, status: "uploading", progress: 0 }]);

  (async () => {
    try {
      if (type === "document") {
        await apiUploadCaseDocument(caseId, file);
      } else if (type === "transcript") {
        if (file.size > 20 * 1024 * 1024) {
          await apiUploadTranscriptChunked(caseId, file, (progress) => {
            setActiveUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress } : u));
          });
        } else {
          await apiUploadTranscript(caseId, file);
        }
      }
      setActiveUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: "complete" } : u));
      if (onComplete) onComplete();
      setTimeout(() => removeUpload(uploadId), 8000); // auto-dismiss after 8s
    } catch (err) {
      setActiveUploads(prev => prev.map(u => u.id === uploadId ? { ...u, status: "error", error: err.message } : u));
      setTimeout(() => removeUpload(uploadId), 15000); // longer dismiss for errors
    }
  })();
}
```

#### `UploadIndicator` Component
- Fixed position, bottom-right corner of the viewport.
- Shows a list of active uploads with:
  - Filename
  - Progress bar (for chunked uploads)
  - Status icon (spinner for uploading, checkmark for complete, X for error)
  - Dismiss button for completed/failed uploads
- Auto-dismisses successful uploads after 8 seconds, errors after 15 seconds.

#### Thread Through Components
Pass `onStartBackgroundUpload` as a prop through the component tree to any view that handles file uploads (case detail views, reports, AI center, etc.).

---

## FEATURE 13: Cloudflare R2 Cloud Storage

### Overview
Store large media files (audio, video) in Cloudflare R2 instead of PostgreSQL BYTEA columns. This prevents database bloat and enables streaming.

### Environment Variables
```
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
```

### R2 Utility Module (`server/r2.js`)
Uses `@aws-sdk/client-s3` (Cloudflare R2 is S3-compatible):

```javascript
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
        CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
        AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");

// Functions:
// uploadToR2(key, buffer, contentType) — single file upload
// downloadFromR2(key) — returns Buffer
// streamFromR2(key, range) — returns stream + metadata (for video Range requests)
// deleteFromR2(key) — remove object
// createMultipartUpload(key, contentType) — start chunked upload, returns uploadId
// uploadPart(key, uploadId, partNumber, buffer) — upload one chunk
// completeMultipartUpload(key, uploadId, parts) — finalize
// abortMultipartUpload(key, uploadId) — cancel
// isR2Configured() — returns boolean based on env vars
```

### Hybrid Storage Model
- **R2 configured**: Audio → `r2_audio_key`, Video → `r2_video_key`. Database stores only the key strings.
- **R2 not configured** (fallback): Store binary data in `audio_data` / `video_data` BYTEA columns.
- **Retrieval**: Always try R2 first, fall back to database BYTEA.
- **Deletion**: Soft-delete only marks `deleted_at`. Hard purge (in deleted data management) also calls `deleteFromR2(key)`.

---

## FEATURE 14: Large File Chunked Upload

### Overview
Support uploading large audio/video files by splitting them into chunks on the client side. Files under 20MB upload in a single request; larger files use chunked uploading.

### Backend Routes
Add to transcript routes:
```
POST /api/transcripts/upload/init     — Initialize chunked upload. Returns { uploadId, transcriptId }.
POST /api/transcripts/upload/chunk    — Upload one chunk. Body: { uploadId, chunkIndex, totalChunks } + file data.
POST /api/transcripts/upload/complete — Finalize upload. Body: { uploadId }. Triggers transcription processing.
```

- If R2 is configured, use S3 Multipart Upload (chunks go directly to R2).
- If R2 is NOT configured, collect chunks in an in-memory Map and combine into a single buffer on completion.
- Each chunk should be ~20MB.

### Frontend
```javascript
async function apiUploadTranscriptChunked(caseId, file, onProgress) {
  const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // 1. Initialize
  const { uploadId, transcriptId } = await apiPost(`/api/transcripts/upload/init`, {
    caseId, filename: file.name, contentType: file.type, totalChunks
  });

  // 2. Upload chunks sequentially
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, start + CHUNK_SIZE);
    const formData = new FormData();
    formData.append("file", chunk);
    formData.append("uploadId", uploadId);
    formData.append("chunkIndex", i);
    formData.append("totalChunks", totalChunks);
    await apiPostForm(`/api/transcripts/upload/chunk`, formData);
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  // 3. Complete
  await apiPost(`/api/transcripts/upload/complete`, { uploadId });
  return transcriptId;
}
```

---

## FEATURE 15: Dedicated Transcript Reading View

### Overview
Create a polished transcript viewer optimized for reading depositions, expert testimony, and client interviews.

### Features
- **Segment List**: Display transcript as chronological segments. Each segment shows:
  - Timestamp (monospaced font, formatted as `MM:SS`)
  - Speaker name (color-coded)
  - Transcribed text
- **Speaker Color Legend**: Auto-identify unique speakers and assign colors from a palette (Indigo, Amber, Emerald, Rose, Sky, Violet, Orange, Teal). Display a legend at the top of the transcript.
- **Present Mode**: A "Present" button opens a new browser window with a clean, dark-themed view (`background: #0f172a`, `color: #e2e8f0`) optimized for courtroom projection:
  - Larger font (18px for text)
  - High-contrast speaker colors
  - Speaker legend
  - No editing controls — read-only display
  - Suitable for display on courtroom monitors during trial

---

## FEATURE 16: AI Search Enhancement — Document and Transcript Names

### Overview
Include document filenames and transcript filenames in AI-powered search results so users can find cases by the names of files attached to them.

### Backend Changes (in AI search route)
1. **SQL Pre-filter Stage**: Add queries against `case_documents` and `case_transcripts` tables to find cases where `filename ILIKE` any search term. Weight these matches at `2` (between core case fields at `3` and minor fields at `1`).

2. **Data Preparation Stage**: When building the case summary text sent to the AI:
   - Fetch up to 10 document filenames per candidate case.
   - Fetch up to 10 transcript filenames per candidate case.
   - Append them to the case summary: `Documents: [file1.pdf, file2.docx, ...]` and `Transcripts: [deposition.mp3, ...]`.

3. **AI Ranking Stage**: The LLM now has filename context and can explain matches like "This case matched because the document 'expert_report.pdf' was found."

---

## FEATURE 17: Bulk SMS Message Selection and Deletion

### Overview
Allow users to select multiple text messages and delete them in bulk, with soft-delete support.

### Backend
Add a batch delete route:
```
POST /api/sms/messages/batch-delete
Body: { ids: [1, 2, 3, ...] }
```
- Sets `deleted_at = NOW()` and `deleted_by = username` for all specified message IDs.
- Uses soft-delete (messages go to the Deleted Data view for 30-day retention).

### Frontend
- Add a "Select" toggle button in the SMS conversation view.
- When active, show checkboxes next to each message.
- "Select All" / "Deselect All" buttons.
- "Delete Selected (N)" button that calls the batch delete endpoint.
- Confirmation dialog before deletion.

---

## FEATURE 18: Deleted Data View Improvements

### Overview
Improve the deleted data management interface with better search functionality and layout.

### Search Improvements
- Add a real-time search bar that filters deleted records across all categories.
- Search matches against: `description`, `caseNumber`, `clientName`, `deletedBy`, and `label` fields.
- Fix search icon positioning (use `paddingLeft: 38` on input with `left: 14` on the search icon).

### Layout Fixes
- Ensure the deleted data list scrolls independently within its container.
- Fix any overflow issues with long descriptions.

### Batch Operations
- Checkbox selection for multiple deleted records.
- "Batch Restore" button — restores selected items (clears `deleted_at`).
- "Batch Purge" button — permanently deletes selected items (removes from database; also deletes R2 objects for transcripts with `r2_audio_key` or `r2_video_key`).

---

## FEATURE 19: Daubert Challenge Analysis Section (Trial Center)

### Overview
In the Trial Center's Jury tab, add a collapsible section for **Daubert Challenge Analysis** — analysis of expert witness admissibility challenges. This is the plaintiff-side equivalent of tracking challenges to expert testimony and evidence reliability.

*Context: Plaintiff firms also conduct jury selection (voir dire) in civil trials. This section tracks Daubert Challenges — motions to exclude unreliable expert testimony or junk science under Daubert v. Merrell Dow. The jury analysis module in the Trial Center is shared functionality for any firm doing trials. The `jury_analyses` table and jury tab already exist in the system; this feature adds a new text field to that existing infrastructure.*

### Database Changes
```sql
ALTER TABLE jury_analyses ADD COLUMN IF NOT EXISTS daubert_challenge TEXT;
```

### Backend Changes
- **External import endpoint** (`POST /api/external/cases/:id/jury-analysis`): Accept an optional `daubertChallenge` field (string, max 10,000 characters). Sanitize and store in the `daubert_challenge` column on both INSERT and UPDATE.
- **GET endpoint** (`GET /api/jury-analysis/:caseId`): Include `daubertChallenge` in the response (mapped from `daubert_challenge` column).

### Frontend
- Add a collapsible section titled **"DAUBERT CHALLENGE ANALYSIS"** in the jury analysis display area.
- Uses a Shield icon with indigo color scheme to distinguish from other sections.
- Collapsed by default (`daubertChallengeOpen` state, default `false`).
- Toggle shows chevron right (collapsed) or chevron down (expanded).
- When expanded, show the analysis text in an indigo-tinted box with `whiteSpace: pre-wrap`.
- Only render the section when `juryAnalysis.daubertChallenge` has content.

---

## FEATURE 20: Collapsible Strategy Notes

### Overview
Make the "Strategy Notes" section in the jury analysis area collapsible to reduce visual clutter when not actively reviewing strategy.

### Implementation
- Add a `strategyNotesOpen` state variable (default `false` — collapsed).
- Replace the static strategy notes display with a collapsible header:
  - Chevron icon (right when collapsed, down when expanded).
  - Scale/balance icon.
  - "STRATEGY NOTES" label in uppercase, small font, tracking-wide.
- When expanded, show the strategy notes content in its original styled box.
- Apply the same collapsible pattern used elsewhere in the application for consistency.

---

## FEATURE 21: Trial Center File Type Expansion

### Overview
Enhance the Trial Center's document handling to support the full range of file types from the document viewer (Feature 5).

### Changes
- Update exhibit and pinned document viewers in the Trial Center to open files in the universal document viewer instead of downloading them.
- Support PDF, DOCX, XLSX, PPTX, images, and text files directly within the Trial Center interface.
- Ensure the Present Mode (courtroom display) works with all document types, not just PDFs.

---

## FEATURE 22: AI Panel Styling Updates

### Overview
Update the AI assistant panel's styling to match the document tab's visual design for consistency across the application.

### Changes
- Match background colors, borders, and spacing with the case detail documents tab.
- Ensure consistent hover states, active states, and typography.
- Use the application's color system: amber for AI-related actions, indigo for drag-active states, slate for neutral elements.

---

## GENERAL IMPLEMENTATION NOTES

### Color System
- **AI/Smart features**: Amber (`amber-500` for buttons, `amber-50` backgrounds)
- **Sidebar active state**: Amber-500
- **Drag-and-drop active**: Indigo borders/backgrounds
- **Primary actions**: Indigo or blue
- **Neutral elements**: Slate palette
- **Destructive actions**: Red

### Terminology Mapping (Source → This System)
| Source (Criminal Defense) | This System (Plaintiff Firm) |
|---|---|
| Defendant | Client / Plaintiff |
| Public Defender | Plaintiff Attorney |
| Criminal defense | Plaintiff litigation / Civil litigation |
| Batson Challenge | Daubert Challenge |
| Public Defender's Office | The Firm |
| Arraignment | Initial Filing |
| Charges | Claims |
| Plea | Settlement Posture |
| Sentencing | Damages Assessment |

### Package Dependencies to Install
```
pdfjs-dist        — PDF rendering
mammoth           — DOCX text/HTML extraction
xlsx              — Excel parsing
@aws-sdk/client-s3 — Cloudflare R2 (S3-compatible)
pdf-parse         — PDF text extraction
multer            — File upload handling
ffmpeg            — Audio extraction from video (system dependency)
```

### Architecture Patterns
- **Soft delete**: All deletions set `deleted_at = NOW()` and `deleted_by = username`. Hard purge happens after 30 days or manual purge from the Deleted Data view.
- **Runtime migrations**: Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at server startup to ensure schema consistency.
- **Background processing**: Long-running tasks (transcription, AI analysis) run asynchronously. The frontend polls for status updates.
- **Hybrid storage**: Use R2 for large binary files when configured, fall back to PostgreSQL BYTEA when not.
- **Role-based access**: Attorney+ roles required for destructive operations (delete, purge). Standard users can view and edit.

### Build Order Recommendation
1. Features 3, 11 (runtime migrations, drag-drop component — foundational)
2. Features 13, 14 (R2 storage, chunked upload — infrastructure)
3. Features 10, 1, 2 (video transcription, voicemail tab, name suggestion — transcription enhancements)
4. Feature 4 (transcript history)
5. Feature 15 (transcript reading view)
6. Feature 5 (document viewer/editor — large feature)
7. Features 6, 7, 21 (exhibit selection, clickable docs, trial center file types)
8. Feature 12 (background upload manager)
9. Feature 8 (custom report builder)
10. Feature 9 (custom AI agents)
11. Feature 16 (AI search enhancement)
12. Features 17, 18 (bulk SMS delete, deleted data improvements)
13. Features 19, 20 (Daubert challenge, collapsible strategy notes)
14. Feature 22 (AI panel styling)
