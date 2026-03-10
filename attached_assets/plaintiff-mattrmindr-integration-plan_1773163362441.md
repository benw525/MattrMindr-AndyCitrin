# Plaintiff MattrMindr — Integration Plan

This document is a self-contained implementation blueprint for adding seven feature integrations to the Plaintiff version of MattrMindr. Each section includes an overview, database schema changes, backend route definitions, frontend component specifications, required environment variables, and step-by-step implementation instructions.

All code references below are based on the Defense-side MattrMindr codebase and should be adapted for the Plaintiff application's naming conventions, table structures, and case model (e.g., replace `case_documents` with whatever document table exists in the Plaintiff version, and adjust role/permission checks accordingly).

---

## Table of Contents

1. [Microsoft Office Viewer](#1-microsoft-office-viewer)
2. [Presenter View](#2-presenter-view)
3. [Multi-Document Window Interface (Minimize & Multiple Documents)](#3-multi-document-window-interface)
4. [Microsoft Office Integration for Document Editing](#4-microsoft-office-integration-for-document-editing)
5. [ONLYOFFICE DocSpace Integration](#5-onlyoffice-docspace-integration)
6. [MattrMindrScribe Integration](#6-mattrmindrscribe-integration)
7. [Profile Pictures](#7-profile-pictures)

---

## 1. Microsoft Office Viewer

### Overview

Replace all built-in document viewers for Office file types (DOCX, XLSX, PPTX) with Microsoft Office Online's read-only iframe viewer. This provides a high-fidelity rendering of Office documents without requiring any local conversion or parsing. The user can toggle between "Office" (iframe) and "Built-in" (local HTML/table rendering) modes.

### How It Works

When a document is opened for viewing, the backend generates a temporary Office Online embed URL using the document's public download link. The frontend loads that URL in an `<iframe>`. No Microsoft account is required for viewing — only for editing (see Section 4).

### Backend

#### Route: `GET /api/case-documents/:id/office-view-url`

This endpoint generates an Office Online viewer URL for a given document.

```
GET /api/case-documents/:id/office-view-url
Auth: requireAuth
```

**Logic:**
1. Query the document from the database by ID.
2. Generate a publicly-accessible (or time-limited signed) download URL for the file. This is required because Office Online fetches the file from a URL.
3. Construct the Office Online embed URL:
   ```
   https://view.officeapps.live.com/op/embed.aspx?src=<encoded-download-url>
   ```
4. Return `{ viewUrl: "<embed-url>" }`.

**Important considerations:**
- The download URL must be publicly accessible (no auth cookies) for Office Online to fetch it.
- If using Cloudflare R2 or S3, generate a pre-signed URL with a short expiry (e.g., 1 hour).
- If files are stored in PostgreSQL BYTEA, you will need a public/token-based download endpoint:
  ```
  GET /api/case-documents/:id/public-download?token=<one-time-token>
  ```
- Supported types: `.docx`, `.xlsx`, `.pptx`, `.doc`, `.xls`, `.ppt`

#### API Function (Frontend)

```javascript
export const apiGetOfficeViewUrl = (docId) =>
  apiFetch(`/api/case-documents/${docId}/office-view-url`);
```

### Frontend

#### When Opening a Document

In the `openDocViewer` function (wherever documents are opened), after detecting the file is DOCX/XLSX/PPTX:

```javascript
let officeViewUrl = null;
if (isPptx || isXlsx || isDocx) {
  try {
    const ovRes = await apiGetOfficeViewUrl(docId);
    officeViewUrl = ovRes?.viewUrl || null;
  } catch {}
}
```

Store `officeViewUrl` in the viewer object so the `DocViewerWindow` component can access it.

#### Office/Built-in Toggle

In the `DocViewerWindow` component header bar, when `officeViewUrl` exists:

```jsx
{viewer.officeViewUrl && (
  <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #e2e8f0" }}>
    <button onClick={() => setOfficeViewMode(true)}
      style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600,
               background: officeViewMode ? "#6366f1" : "transparent",
               color: officeViewMode ? "#fff" : "#64748b",
               border: "none", cursor: "pointer" }}>
      Office
    </button>
    <button onClick={() => setOfficeViewMode(false)}
      style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600,
               background: !officeViewMode ? "#6366f1" : "transparent",
               color: !officeViewMode ? "#fff" : "#64748b",
               border: "none", cursor: "pointer" }}>
      Built-in
    </button>
  </div>
)}
```

#### Rendering the Office Iframe

When `officeViewMode` is true:

```jsx
{officeViewMode && viewer.officeViewUrl ? (
  <iframe
    src={viewer.officeViewUrl}
    style={{ width: "100%", height: "100%", border: "none" }}
    title="Office Viewer"
  />
) : (
  /* Built-in viewer rendering (HTML for docx, table for xlsx, slides for pptx) */
)}
```

#### State

```javascript
const [officeViewMode, setOfficeViewMode] = useState(!!viewer.officeViewUrl);
```

Default to Office view mode when a view URL is available.

### Implementation Steps

1. Create a public/token-based download endpoint for documents if one doesn't exist.
2. Add the `GET /api/case-documents/:id/office-view-url` route that builds the Office Online embed URL.
3. Add `apiGetOfficeViewUrl` to the frontend API module.
4. Modify `openDocViewer` to fetch the Office view URL for DOCX/XLSX/PPTX files.
5. Store `officeViewUrl` in each viewer object.
6. Add the Office/Built-in toggle buttons to the `DocViewerWindow` header.
7. Render the iframe when Office mode is active.
8. Test with each file type: `.docx`, `.xlsx`, `.pptx`.

---

## 2. Presenter View

### Overview

A "Present" button in the document viewer toolbar opens the document in a new browser window optimized for external display or screen sharing. This works for all file types: Office documents (via Office Online iframe), PDFs (via embedded viewer), images, videos, and DOCX (via rendered HTML).

### Frontend Implementation

#### Present Button

Add a Present button (using the `MonitorPlay` icon from Lucide) to the document viewer toolbar:

```jsx
import { MonitorPlay } from "lucide-react";

<button onClick={handlePresent} title="Present"
  style={{ padding: "3px 8px", background: "transparent",
           border: "1px solid #cbd5e1", borderRadius: 4,
           cursor: "pointer", color: "#64748b",
           display: "inline-flex", alignItems: "center" }}>
  <MonitorPlay size={13} />
</button>
```

#### `handlePresent` Function

```javascript
const handlePresent = () => {
  const t = viewer.type;

  // Office documents with Office Online URL
  if (viewer.officeViewUrl && officeViewMode && (t === "docx" || t === "xlsx" || t === "pptx")) {
    const pw = window.open("", "_blank", "width=1280,height=720,menubar=no,toolbar=no,location=no,status=no");
    if (!pw) return;
    pw.document.write(`<!DOCTYPE html><html><head>
      <title>Presenting: ${viewer.filename}</title>
      <style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#000;display:flex;flex-direction:column;height:100vh;overflow:hidden;}#viewer{flex:1;border:none;width:100%;height:100%;}</style>
    </head><body>
      <iframe id="viewer" src="${viewer.officeViewUrl}" allowfullscreen></iframe>
      <script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script>
    </body></html>`);
    pw.document.close();
    return;
  }

  // Fallback for other types
  const pw = window.open("", "_blank", "width=1280,height=720,menubar=no,toolbar=no,location=no,status=no");
  if (!pw) return;

  if (t === "pdf") {
    pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title>
      <style>*{margin:0;padding:0;}body{background:#000;height:100vh;display:flex;justify-content:center;align-items:center;}</style></head><body>
      <embed src="${viewer.blobUrl}#toolbar=0&navpanes=0" type="application/pdf" width="100%" height="100%"/>
      <script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script>
    </body></html>`);
  } else if (t === "image") {
    pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title>
      <style>*{margin:0;}body{background:#000;height:100vh;display:flex;justify-content:center;align-items:center;}</style></head><body>
      <img src="${viewer.blobUrl}" style="max-width:100%;max-height:100vh;object-fit:contain;"/>
      <script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script>
    </body></html>`);
  } else if (t === "video") {
    pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title>
      <style>*{margin:0;}body{background:#000;height:100vh;display:flex;justify-content:center;align-items:center;}</style></head><body>
      <video src="${viewer.blobUrl}" controls autoplay style="max-width:100%;max-height:100vh;"/>
      <script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script>
    </body></html>`);
  } else if (t === "docx") {
    pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title>
      <style>body{background:#1e293b;min-height:100vh;display:flex;justify-content:center;padding:40px 20px;}
      #doc{background:#fff;max-width:850px;width:100%;padding:64px 72px;font-family:'Times New Roman',Georgia,serif;font-size:15px;line-height:1.8;color:#1e293b;border-radius:8px;}</style></head><body>
      <div id="doc">${viewer.docxHtml || ""}</div>
      <script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script>
    </body></html>`);
  }

  pw.document.close();
};
```

#### Key Behaviors

- **Window size**: 1280x720 (standard presentation resolution)
- **Chrome hidden**: `menubar=no,toolbar=no,location=no,status=no`
- **Escape to close**: All presenter windows listen for the Escape key to close
- **Black background**: Creates a clean look for presentations
- **Office iframe fullscreen**: Uses `allowfullscreen` attribute for native fullscreen support

### Implementation Steps

1. Import the `MonitorPlay` icon from Lucide React.
2. Add the Present button to the document viewer toolbar.
3. Implement the `handlePresent` function with type-specific presentation logic.
4. Test with each file type: Office docs, PDFs, images, videos, DOCX.

---

## 3. Multi-Document Window Interface

### Overview

Users can open multiple documents simultaneously in independent, floating windows. Each window is draggable, resizable, and can be minimized to a taskbar at the bottom of the screen. Windows layer with z-index management (click-to-front).

### State Architecture

In the main `App` component:

```javascript
const [openDocViewers, setOpenDocViewers] = useState([]);
const topZIndexRef = useRef(10001);
const nextViewerIdRef = useRef(1);
```

Each viewer object in the array:

```javascript
{
  id: number,           // unique incrementing ID
  docId: number|null,   // database document ID (null for blob-based viewers)
  filename: string,
  type: string,         // "pdf" | "docx" | "xlsx" | "pptx" | "image" | "video" | "text"
  officeViewUrl: string|null,
  blobUrl: string|null,
  minimized: boolean,
  position: { x: number, y: number } | null,
  size: { width: number, height: number } | null,
  zIndex: number,
  caseContext: object|null,
  // Type-specific fields:
  pdfData: Uint8Array,        // for PDF
  docxHtml: string,           // for DOCX
  xlsxData: array,            // for XLSX
  slides: array,              // for PPTX
  extractedText: string,      // for searchable text
  annotations: array,         // for PDF annotations
}
```

### Window Management Functions

```javascript
const openDocViewer = async (docId, filename, contentType, caseContext) => {
  // If already open, restore and bring to front
  const existing = openDocViewers.find(v => v.docId === docId);
  if (existing) {
    setOpenDocViewers(prev => prev.map(v =>
      v.id === existing.id ? { ...v, minimized: false, zIndex: topZIndexRef.current++ } : v
    ));
    return;
  }

  // On mobile, close all existing viewers (single-window mode)
  if (window.innerWidth < 768) {
    setOpenDocViewers(prev => {
      prev.forEach(v => { if (v.blobUrl) URL.revokeObjectURL(v.blobUrl); });
      return [];
    });
  }

  // Cascade offset: each new window shifts 30px down and right
  const offset = openDocViewers.filter(v => !v.minimized).length * 30;
  const baseViewer = {
    id: nextViewerIdRef.current++,
    docId,
    filename,
    caseContext: caseContext || null,
    officeViewUrl: null,
    minimized: false,
    position: offset > 0 ? { x: 80 + offset, y: 60 + offset } : null,
    size: null,
    zIndex: topZIndexRef.current++,
  };

  // Fetch document blob, detect type, add to state...
};

const closeDocViewer = (id) => {
  setOpenDocViewers(prev => {
    const v = prev.find(v => v.id === id);
    if (v?.blobUrl) URL.revokeObjectURL(v.blobUrl);
    return prev.filter(v => v.id !== id);
  });
};

const minimizeDocViewer = (id) => {
  setOpenDocViewers(prev => prev.map(v =>
    v.id === id ? { ...v, minimized: true } : v
  ));
};

const restoreDocViewer = (id) => {
  setOpenDocViewers(prev => prev.map(v =>
    v.id === id ? { ...v, minimized: false, zIndex: topZIndexRef.current++ } : v
  ));
};

const bringDocViewerToFront = (id) => {
  setOpenDocViewers(prev => prev.map(v =>
    v.id === id ? { ...v, zIndex: topZIndexRef.current++ } : v
  ));
};

const updateDocViewer = (id, updates) => {
  setOpenDocViewers(prev => prev.map(v =>
    v.id === id ? { ...v, ...updates } : v
  ));
};
```

### DocViewerWindow Component

This is a separate component file (`DocViewerWindow.js`) that renders each floating window.

**Props:**

```javascript
export default function DocViewerWindow({
  viewer,       // the viewer object from state
  position,     // { x, y } or null
  size,         // { width, height } or null
  zIndex,
  ooStatus,     // ONLYOFFICE configuration status
  onClose,
  onMinimize,
  onBringToFront,
  onPositionChange,  // (pos) => void
  onSizeChange,      // (sz) => void
  onViewerUpdate,    // (id, updates) => void
})
```

**Window container styling (desktop):**

```jsx
<div
  data-docviewer-window
  onClick={onBringToFront}
  style={{
    position: "fixed",
    top: position?.y ?? 60,
    left: position?.x ?? 80,
    width: size?.width ?? "80vw",
    height: size?.height ?? "80vh",
    maxWidth: "95vw",
    maxHeight: "90vh",
    minWidth: 480,
    minHeight: 320,
    zIndex,
    display: "flex",
    flexDirection: "column",
    background: "var(--c-bg, #fff)",
    borderRadius: 10,
    boxShadow: "0 8px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)",
    border: "1px solid var(--c-border, #e2e8f0)",
    overflow: "hidden",
  }}
>
```

**Mobile styling**: Full screen overlay (`position: fixed; inset: 0; z-index: 10002`).

#### Title Bar with Drag, Minimize, Close

```jsx
<div onMouseDown={handleDragStart} style={{
  display: "flex", alignItems: "center", padding: "8px 12px",
  borderBottom: "1px solid var(--c-border, #e2e8f0)",
  cursor: "move", flexShrink: 0, userSelect: "none",
}}>
  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden",
                 textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
    {viewer.filename || "Document"}
  </span>
  {/* Toolbar buttons: Print, Present, Download, etc. */}
  <button onClick={onMinimize} title="Minimize"><Minus size={14} /></button>
  <button onClick={handleClose} title="Close"><X size={14} /></button>
</div>
```

#### Dragging

```javascript
const handleDragStart = (e) => {
  if (e.target.closest("button") || e.target.closest("input")) return;
  e.preventDefault();
  const el = e.currentTarget.closest("[data-docviewer-window]");
  const rect = el.getBoundingClientRect();
  draggingRef.current = true;
  dragStartRef.current = { mx: e.clientX, my: e.clientY, ex: rect.left, ey: rect.top };
  document.body.style.cursor = "move";
  document.body.style.userSelect = "none";

  const onMove = (ev) => {
    if (!draggingRef.current) return;
    ev.preventDefault();
    const dx = ev.clientX - dragStartRef.current.mx;
    const dy = ev.clientY - dragStartRef.current.my;
    onPositionChange({ x: dragStartRef.current.ex + dx, y: dragStartRef.current.ey + dy });
  };
  const onUp = () => {
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
};
```

#### Resizing (bottom-right corner handle)

```javascript
const handleResizeStart = (e) => {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget.closest("[data-docviewer-window]");
  const rect = el.getBoundingClientRect();
  document.body.style.cursor = "nwse-resize";
  document.body.style.userSelect = "none";
  const startX = e.clientX, startY = e.clientY;
  const startW = rect.width, startH = rect.height;

  const onMove = (ev) => {
    ev.preventDefault();
    const nw = Math.max(480, startW + (ev.clientX - startX));
    const nh = Math.max(320, startH + (ev.clientY - startY));
    onSizeChange({ width: nw, height: nh });
  };
  const onUp = () => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
};
```

Add a resize handle at the bottom-right corner of the window:

```jsx
<div onMouseDown={handleResizeStart}
  style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16,
           cursor: "nwse-resize", zIndex: 1 }} />
```

### Taskbar (Minimized Documents)

Rendered at the bottom of the main App component, below all other content:

```jsx
{openDocViewers.filter(v => !v.minimized).map(v => (
  <DocViewerWindow key={v.id} viewer={v} /* ...all props... */ />
))}

{openDocViewers.some(v => v.minimized) && window.innerWidth >= 768 && (
  <div style={{
    position: "fixed", bottom: 0, left: 0, right: 0,
    display: "flex", gap: 4, padding: "8px 12px",
    zIndex: 10000, pointerEvents: "none",
  }}>
    {openDocViewers.filter(v => v.minimized).map(v => (
      <div key={v.id} style={{
        pointerEvents: "auto",
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--c-bg, #fff)", borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
        padding: "8px 14px",
        border: "1px solid var(--c-border, #e2e8f0)",
        maxWidth: 280,
      }}>
        <FileText size={14} style={{ color: "#64748b", flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500,
                       overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {v.filename || "Document"}
        </span>
        <button onClick={() => restoreDocViewer(v.id)} title="Restore">
          <Maximize2 size={14} />
        </button>
        <button onClick={() => closeDocViewer(v.id)} title="Close">
          <X size={14} />
        </button>
      </div>
    ))}
  </div>
)}
```

### Implementation Steps

1. Add `openDocViewers` state array, `topZIndexRef`, and `nextViewerIdRef` to the main App.
2. Implement all window management functions: `openDocViewer`, `openDocViewerFromBlob`, `closeDocViewer`, `minimizeDocViewer`, `restoreDocViewer`, `bringDocViewerToFront`, `updateDocViewer`.
3. Create the `DocViewerWindow` component with dragging, resizing, minimize, close, and content rendering.
4. Add the taskbar rendering to the main App layout.
5. Pass `openDocViewer` and `openDocViewerFromBlob` as props to all views/components that display documents.
6. On mobile (`< 768px`), render as full-screen overlays instead of floating windows and disable minimize.

---

## 4. Microsoft Office Integration for Document Editing

### Overview

Users connect their Microsoft account via OAuth2, then edit DOCX/XLSX/PPTX files directly in Microsoft Office Online. The workflow: upload to the user's OneDrive -> open in browser for editing -> sync changes back to the database -> clean up the OneDrive copy.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MS_CLIENT_ID` | Azure AD app registration client ID |
| `MS_CLIENT_SECRET` | Azure AD app registration client secret |
| `MS_REDIRECT_URI` | (Optional) Override for the OAuth callback URL. Auto-detected if not set. |

### Azure AD App Registration

1. Go to [Azure Portal](https://portal.azure.com) > Azure Active Directory > App registrations > New registration.
2. Set redirect URI to `https://<your-domain>/api/microsoft/callback`.
3. Under API permissions, add:
   - `User.Read` (delegated)
   - `Files.ReadWrite` (delegated)
4. Under Certificates & secrets, create a client secret.
5. Set `MS_CLIENT_ID` and `MS_CLIENT_SECRET` environment variables.

### Database Schema Changes

Add the following columns to the `users` table:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_token_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_account_email TEXT;
```

### Backend Routes (`server/routes/microsoft.js`)

Mount at `/api/microsoft`.

#### Constants

```javascript
const MS_CLIENT_ID = process.env.MS_CLIENT_ID || "";
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET || "";
const MS_AUTHORITY = "https://login.microsoftonline.com/common";
const MS_GRAPH_URL = "https://graph.microsoft.com/v1.0";
const SCOPES = "User.Read Files.ReadWrite offline_access";
```

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/configured` | None | Returns `{ configured: boolean }` indicating if MS env vars are set |
| `GET` | `/status` | requireAuth | Returns `{ connected: boolean, email: string\|null }` for current user |
| `GET` | `/auth-url` | requireAuth | Generates OAuth2 authorization URL with a random state nonce (for CSRF protection), returns `{ url }` |
| `GET` | `/callback` | None | OAuth2 callback — exchanges code for tokens, stores in DB, shows success/error page |
| `POST` | `/disconnect` | requireAuth | Clears all MS tokens for current user |
| `POST` | `/upload-for-edit` | requireAuth | Uploads document to user's OneDrive `/MattrMindr/` folder, returns `{ driveItemId, editUrl, webUrl }` |
| `POST` | `/sync-back` | requireAuth | Downloads edited file from OneDrive back to database, deletes OneDrive copy |
| `DELETE` | `/cleanup/:driveItemId` | requireAuth | Deletes a OneDrive file (used for cancel/cleanup) |

#### Token Refresh

Implement `refreshTokenIfNeeded(userId)` that checks `ms_token_expiry` and refreshes via `POST /oauth2/v2.0/token` with `grant_type=refresh_token` if within 5 minutes of expiry. On failure, clear all MS columns for that user.

#### OAuth Callback Page

The callback renders a self-closing HTML page that posts a `window.opener.postMessage({ type: "ms-auth-complete", success: boolean }, "<your-app-origin>")` message back to the parent window, so the frontend can detect connection completion.

**Security**: Always set the target origin explicitly (not `"*"`) when calling `postMessage`. On the receiving side, validate `event.origin` matches your application's domain before processing the message:

```javascript
window.addEventListener("message", (e) => {
  if (e.origin !== window.location.origin) return; // reject messages from other origins
  if (e.data?.type === "ms-auth-complete") { /* handle */ }
});
```

#### Upload-for-Edit Workflow

1. Validate `documentId`, refresh MS token.
2. Query document from database (filename, content_type, file_data).
3. `PUT` to `https://graph.microsoft.com/v1.0/me/drive/root:/MattrMindr/<filename>:/content`.
4. Return the `driveItem.webUrl` as the edit URL.

#### Sync-Back Workflow

1. Validate `documentId` and `driveItemId`, refresh MS token.
2. `GET` `https://graph.microsoft.com/v1.0/me/drive/items/<driveItemId>/content`.
3. Update `file_data` in the database with the downloaded buffer.
4. `DELETE` the OneDrive item to clean up.

### Frontend Integration

#### Settings UI — Microsoft Connection

In the Settings modal/page, add a Microsoft Office section:

```jsx
{msConfigured && (
  <div>
    <h3>Microsoft Office</h3>
    {msConnected ? (
      <div>
        <span>Connected as {msEmail}</span>
        <button onClick={handleMsDisconnect}>Disconnect</button>
      </div>
    ) : (
      <button onClick={handleMsConnect}>Connect Microsoft Account</button>
    )}
  </div>
)}
```

**Connect handler:**

```javascript
const handleMsConnect = async () => {
  const { url } = await apiFetch("/api/microsoft/auth-url");
  const popup = window.open(url, "ms-auth", "width=600,height=700");
  const listener = (e) => {
    if (e.data?.type === "ms-auth-complete") {
      window.removeEventListener("message", listener);
      if (e.data.success) refreshMsStatus();
    }
  };
  window.addEventListener("message", listener);
};
```

#### Edit Button in DocViewerWindow

When Microsoft is connected and the document is DOCX/XLSX/PPTX, show an "Edit in Office" button:

```jsx
{msConnected && viewer.docId && isEditableOfficeType && (
  <button onClick={handleMsEdit}>Edit in Office</button>
)}
```

**Edit handler:**

```javascript
const handleMsEdit = async () => {
  const result = await apiFetch("/api/microsoft/upload-for-edit", {
    method: "POST",
    body: { documentId: viewer.docId },
  });
  // Open edit URL in a new tab
  window.open(result.editUrl, "_blank");
  // Store driveItemId for later sync-back
  setMsEditSession({ driveItemId: result.driveItemId, documentId: viewer.docId });
};
```

**Sync-back handler (called when user clicks "Save Changes"):**

```javascript
const handleMsSyncBack = async () => {
  await apiFetch("/api/microsoft/sync-back", {
    method: "POST",
    body: { documentId: msEditSession.documentId, driveItemId: msEditSession.driveItemId },
  });
  setMsEditSession(null);
  await refreshViewer();
};
```

### Implementation Steps

1. Register an Azure AD application and obtain client ID/secret.
2. Set `MS_CLIENT_ID`, `MS_CLIENT_SECRET` environment variables.
3. Add the 4 MS columns to the `users` table.
4. Create `server/routes/microsoft.js` with all endpoints listed above.
5. Mount the router: `app.use("/api/microsoft", microsoftRouter)`.
6. Add frontend API functions for all MS endpoints.
7. Add the Microsoft connection UI to Settings.
8. Add the "Edit in Office" button to DocViewerWindow for eligible file types.
9. Implement the sync-back flow with a "Save Changes" button.
10. Test the full OAuth flow, upload, edit, sync-back, and cleanup.

---

## 5. ONLYOFFICE DocSpace Integration

### Overview

ONLYOFFICE DocSpace provides in-browser document editing when Microsoft Office is not connected. Documents are uploaded to a DocSpace collaboration room, an editing session is opened, and the ONLYOFFICE editor loads in an iframe within the DocViewerWindow. After editing, changes are synced back and the DocSpace copy is cleaned up.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ONLYOFFICE_URL` | Base URL of your ONLYOFFICE DocSpace instance (e.g., `https://docspace.example.com`) |
| `ONLYOFFICE_PASSWORD` | Password for the DocSpace service account |
| `ONLYOFFICE_USER` | Email/username for the DocSpace service account |
| `ONLYOFFICE_ROOM_ID` | ID of the DocSpace collaboration room for temporary editing files |

### Backend Routes (`server/routes/onlyoffice.js`)

Mount at `/api/onlyoffice`.

#### Constants

```javascript
const ONLYOFFICE_URL = () => (process.env.ONLYOFFICE_URL || "").replace(/\/+$/, "");
const ONLYOFFICE_PASSWORD = () => process.env.ONLYOFFICE_PASSWORD || "";
const ONLYOFFICE_USER = process.env.ONLYOFFICE_USER || "service-account@yourdomain.com";
const COLLAB_ROOM_ID = parseInt(process.env.ONLYOFFICE_ROOM_ID || "0"); // ID of the DocSpace room for temporary editing files
```

#### Authentication

DocSpace uses session-based authentication. Implement a cached session token:

```javascript
let cachedSessionToken = null;
let sessionTokenExpiry = 0;

async function getSessionToken() {
  if (cachedSessionToken && Date.now() < sessionTokenExpiry) return cachedSessionToken;
  const resp = await fetch(`${ONLYOFFICE_URL()}/api/2.0/authentication`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: ONLYOFFICE_USER, password: ONLYOFFICE_PASSWORD() }),
  });
  if (!resp.ok) throw new Error("DocSpace authentication failed");
  const data = await resp.json();
  cachedSessionToken = data.response?.token;
  sessionTokenExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  return cachedSessionToken;
}
```

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/status` | requireAuth | Returns `{ configured: boolean, url: string\|null }` |
| `POST` | `/upload-for-edit` | requireAuth | Uploads doc to DocSpace room, gets editor config, returns `{ fileId, documentId, editorUrl, editorConfig }` |
| `POST` | `/sync-back` | requireAuth | Downloads edited file from DocSpace, updates database, cleans up DocSpace copy |
| `DELETE` | `/cleanup/:fileId` | requireAuth | Deletes a DocSpace file (cancel/cleanup) |

#### Upload-for-Edit Workflow

1. Query document from database.
2. Authenticate with DocSpace via session token.
3. Upload file to the collaboration room via `POST /api/2.0/files/<COLLAB_ROOM_ID>/upload` (multipart/form-data).
4. Request editor config via `GET /api/2.0/files/file/<fileId>/openedit`.
5. Customize the editor config (remove branding, disable navigation):
   ```javascript
   cfg.editorConfig.customization = {
     goback: false, close: false, feedback: false,
     about: false, logo: { visible: false },
   };
   cfg.editorConfig.embedded = { toolbar: false };
   ```
6. Return the editor config to the frontend.

#### Sync-Back Workflow

1. Download file from DocSpace via `GET /api/2.0/files/file/<fileId>/download`.
2. Handle JSON redirect responses (DocSpace sometimes returns a download URL instead of file data).
3. Update `file_data` in the database.
4. Delete the DocSpace file asynchronously.

#### File Cleanup

Implement retry logic for DocSpace file deletion (files may be locked during editing):

```javascript
async function deleteDocSpaceFile(fileId, headers, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(`${ONLYOFFICE_URL()}/api/2.0/files/file/${fileId}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ deleteAfter: false, immediately: true }),
      });
      // Verify deletion
      const checkResp = await fetch(`${ONLYOFFICE_URL()}/api/2.0/files/file/${fileId}`, { headers });
      if (checkResp.status === 404 || !checkResp.ok) return true;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 5000));
    } catch (err) { /* retry */ }
  }
  return false;
}
```

### Frontend Integration

#### API Functions

```javascript
export const apiUploadForOnlyOfficeEdit = (documentId) =>
  apiFetch("/api/onlyoffice/upload-for-edit", { method: "POST", body: { documentId } });

export const apiSyncBackFromOnlyOffice = (documentId, fileId) =>
  apiFetch("/api/onlyoffice/sync-back", { method: "POST", body: { documentId, fileId } });

export const apiCleanupOnlyOfficeFile = (fileId) =>
  apiFetch(`/api/onlyoffice/cleanup/${fileId}`, { method: "DELETE" });
```

#### DocViewerWindow — DocSpace Edit Button

Show the "DocSpace" edit button when ONLYOFFICE is configured and the file is DOCX/XLSX/PPTX:

```jsx
{ooStatus?.configured && viewer.docId && isEditableType && (
  <button disabled={ooEditLoading} onClick={startOoEdit}>
    <Pencil size={11} /> {ooEditLoading ? "Opening..." : "DocSpace"}
  </button>
)}
```

#### Initializing the ONLYOFFICE Editor

After receiving the editor config from the backend, load the ONLYOFFICE editor in an iframe:

```javascript
const startOoEdit = async () => {
  if (!ooStatus?.configured || !viewer.docId) return;
  setOoEditLoading(true);
  try {
    const result = await apiUploadForOnlyOfficeEdit(viewer.docId);
    setOoEditSession(result);
  } catch (err) {
    alert("Failed to open in ONLYOFFICE: " + err.message);
  }
  setOoEditLoading(false);
};
```

When `ooEditSession` is set, render the editor container:

```jsx
{ooEditSession && (
  <div style={{ flex: 1, position: "relative" }}>
    <div style={{ position: "absolute", top: 0, right: 0, zIndex: 10, display: "flex", gap: 4, padding: 8 }}>
      <button onClick={syncBackOoEdit}>Save & Close</button>
      <button onClick={cancelOoEdit}>Cancel</button>
    </div>
    <div id={editorFrameId} style={{ width: "100%", height: "100%" }} />
  </div>
)}
```

Initialize the editor with a script tag pointing to DocSpace's API JS:

```javascript
useEffect(() => {
  if (!ooEditSession) return;
  const el = document.getElementById(editorFrameId);
  if (!el || el.dataset.initialized) return;
  el.dataset.initialized = "true";
  const script = document.createElement("script");
  script.src = `${ooEditSession.editorUrl}`;
  script.onload = () => {
    if (window.DocsAPI) {
      new window.DocsAPI.DocEditor(editorFrameId, ooEditSession.editorConfig);
    }
  };
  el._ooScript = script;
  document.head.appendChild(script);
}, [ooEditSession]);
```

#### Sync Back and Cancel

```javascript
const syncBackOoEdit = async () => {
  if (!ooEditSession) return;
  setOoEditLoading(true);
  try {
    cleanupOoFrame(editorFrameId);
    await new Promise(r => setTimeout(r, 2000)); // wait for DocSpace to finalize
    await apiSyncBackFromOnlyOffice(ooEditSession.documentId, ooEditSession.fileId);
    setOoEditSession(null);
    await refreshViewer();
  } catch (err) { alert("Failed to sync changes: " + err.message); }
  setOoEditLoading(false);
};

const cancelOoEdit = async () => {
  cleanupOoFrame(editorFrameId);
  const fileId = ooEditSession?.fileId;
  setOoEditSession(null);
  if (fileId) {
    await new Promise(r => setTimeout(r, 2000));
    try { await apiCleanupOnlyOfficeFile(fileId); } catch {}
  }
};
```

#### Cleanup Utility

```javascript
function cleanupOoFrame(frameId) {
  const el = document.getElementById(frameId);
  if (el) {
    if (el._ooScript) { try { el._ooScript.remove(); } catch {} el._ooScript = null; }
    while (el.firstChild) { try { el.removeChild(el.firstChild); } catch { break; } }
    el.innerHTML = "";
    delete el.dataset.initialized;
  }
}
```

### Implementation Steps

1. Set up an ONLYOFFICE DocSpace instance and create a collaboration room.
2. Set `ONLYOFFICE_URL`, `ONLYOFFICE_API_KEY`, `ONLYOFFICE_PASSWORD` environment variables.
3. Update `ONLYOFFICE_USER` and `COLLAB_ROOM_ID` constants.
4. Create `server/routes/onlyoffice.js` with all endpoints.
5. Mount the router: `app.use("/api/onlyoffice", onlyofficeRouter)`.
6. Add frontend API functions.
7. Fetch ONLYOFFICE status on app load (`appOoStatus` state).
8. Pass `ooStatus` to DocViewerWindow.
9. Implement the DocSpace edit button, editor initialization, sync-back, and cancel flows.
10. Implement `cleanupOoFrame` utility for proper iframe teardown.
11. Clean up DocSpace files on window close (in the `handleClose` function and component unmount effect).

---

## 6. MattrMindrScribe Integration

### Overview

MattrMindrScribe is an external legal transcription tool. This integration is two-way:
- **Outbound**: Users connect their Scribe account, send audio/video transcripts to Scribe for transcription, and import completed results back.
- **Inbound**: Scribe can push completed transcriptions directly into cases via an external API contract.

### Database Schema Changes

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_token TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_user_email TEXT DEFAULT '';

ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS scribe_transcript_id TEXT DEFAULT '';
ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS scribe_status TEXT DEFAULT '';
```

### Backend Routes — Outbound (`server/routes/scribe.js`)

Mount at `/api/scribe`.

#### Constants

```javascript
const SCRIBE_BASE_URL = process.env.SCRIBE_BASE_URL || "https://scribe.mattrmindr.com/app";
```

#### Temporary Download Tokens

For serving audio/video files to the Scribe server when R2 is not available:

```javascript
const tempDownloadTokens = new Map();

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, data] of tempDownloadTokens) {
    if (data.expiresAt < now) tempDownloadTokens.delete(token);
  }
}
setInterval(cleanupExpiredTokens, 60000);
```

#### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/status` | requireAuth | Returns `{ connected, url, email }` for current user's Scribe connection |
| `POST` | `/connect` | requireAuth | Authenticates with Scribe server, stores token in DB. Body: `{ email, password }` |
| `POST` | `/disconnect` | requireAuth | Clears Scribe credentials from DB |
| `POST` | `/send/:transcriptId` | requireAuth | Sends a transcript's audio/video to Scribe for processing |
| `GET` | `/download/:token` | None | Public endpoint for Scribe to download audio/video via temporary token |
| `GET` | `/transcript-status/:scribeTranscriptId` | requireAuth | Proxies status check to Scribe server |
| `POST` | `/import/:transcriptId` | requireAuth | Pulls completed transcription from Scribe into local database |

#### Connect Flow

1. Accept `{ email, password }` from the user.
2. POST to `${SCRIBE_BASE_URL}/api/external/auth` with credentials.
3. If successful, store the returned token, URL, and email in the `users` table.

#### Send-to-Scribe Flow

1. Query the transcript from the database with case info.
2. Check permissions (confidential case access control).
3. Generate a file download URL:
   - If R2 is configured and the file has an R2 key: generate a pre-signed URL (1 hour expiry).
   - Otherwise: create a temporary download token and construct a URL pointing to `/api/scribe/download/:token`.
4. POST to `${SCRIBE_BASE_URL}/api/external/receive` with:
   ```json
   {
     "filename": "recording.mp3",
     "fileUrl": "https://...",
     "contentType": "audio/mpeg",
     "fileSize": 12345678,
     "description": "Client interview",
     "caseId": "123",
     "caseName": "Smith v. Jones",
     "expectedSpeakers": 2
   }
   ```
5. Store the returned `scribeTranscriptId` and set `scribe_status = 'pending'`.

#### Import-from-Scribe Flow

1. Query the transcript to get its `scribe_transcript_id`.
2. Fetch status from Scribe: `GET ${SCRIBE_BASE_URL}/api/external/transcripts/:id/status`.
3. If status is `completed`, parse the segments array.
4. Update the local transcript with the segments, set `status = 'completed'`, `scribe_status = 'completed'`.
5. Log the import in `transcript_history` table.

### Backend Routes — Inbound (`server/routes/external.js`)

Mount at `/api/external`. These endpoints implement the contract that allows Scribe to push data into MattrMindr.

#### Endpoints (Scribe calls these)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth` | None | Validate MattrMindr user credentials, return integration token |
| `GET` | `/cases` | Bearer token | Search cases for the authenticated user. Query param: `q` |
| `GET` | `/cases/:caseId/files` | Bearer token | Check if a file exists in a case (conflict detection) |
| `POST` | `/cases/:caseId/files` | Bearer token | Upload a completed transcription file to a case |

#### External Auth

Accept `{ email, password }`, validate against the users table, and return a long-lived JWT or session token.

#### Case Search

Return cases where the user is on the team (assigned attorney, paralegal, etc.), filtered by query parameter `q`. Sort pinned cases first.

#### File Upload

Accept a POST with either multipart form data or JSON containing the transcription results. Depending on what Scribe sends, this may include:
- A completed transcription file (audio/video or document)
- Transcript segments (JSON array of timestamped text)
- A summary and technical metadata (`pipelineLog`)

Create the appropriate record in the database — this could be a `case_documents` entry for file attachments or an update to `case_transcripts` for transcript data. Adapt to your data model accordingly.

### Frontend Integration

#### Settings UI — Scribe Connection

```jsx
<div>
  <h3>MattrMindrScribe</h3>
  {scribeConnected ? (
    <div>
      <span>Connected as {scribeEmail}</span>
      <button onClick={handleScribeDisconnect}>Disconnect</button>
    </div>
  ) : (
    <div>
      <input type="email" placeholder="Scribe Email" value={scribeEmail} onChange={...} />
      <input type="password" placeholder="Scribe Password" value={scribePw} onChange={...} />
      <button onClick={handleScribeConnect}>Connect</button>
    </div>
  )}
</div>
```

#### Transcript Actions

In the transcript viewer/list, add "Send to Scribe" and "Import from Scribe" buttons:

```jsx
{scribeConnected && !transcript.scribe_transcript_id && (
  <button onClick={() => sendToScribe(transcript.id)}>Send to Scribe</button>
)}
{transcript.scribe_status === 'pending' && (
  <button onClick={() => importFromScribe(transcript.id)}>Import Results</button>
)}
```

### Implementation Steps

1. Add Scribe columns to `users` and `case_transcripts` tables.
2. Create `server/routes/scribe.js` with connect, disconnect, send, download, status, and import endpoints.
3. Create `server/routes/external.js` with auth, case search, and file upload endpoints for Scribe to call.
4. Mount both routers.
5. Add frontend API functions for all Scribe operations.
6. Add the Scribe connection UI to Settings.
7. Add "Send to Scribe" and "Import from Scribe" buttons to transcript views.
8. Fetch Scribe connection status on app load.
9. Test the full round-trip: connect, send file, wait for completion, import results.

---

## 7. Profile Pictures

### Overview

Users can upload a profile picture that displays wherever their avatar appears in the application (sidebar, user lists, chat/collaboration views, case team assignments). When no picture is set, a colored circle with the user's initials is shown as a fallback.

### Database Schema Changes

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_type TEXT NOT NULL DEFAULT '';
```

The existing `avatar` column (default `#4C7AC9`) provides the background color for the initials fallback.

### Backend Routes (`server/routes/users.js`)

Add these endpoints alongside existing user routes.

#### Upload Profile Picture

```
POST /api/users/:id/profile-picture
Auth: requireAuth (own profile or App Admin)
Content-Type: multipart/form-data
Field name: "picture"
```

**Configuration:**
```javascript
const multer = require("multer");
const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
});
```

**Validation:**
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Max file size: 5MB
- Permission: users can edit their own picture; App Admin can edit any user's picture

**Logic:**
```javascript
router.post("/:id/profile-picture", requireAuth, (req, res, next) => {
  profileUpload.single("picture")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large. Maximum size is 5 MB." });
      return res.status(400).json({ error: err.message || "Upload error" });
    }
    next();
  });
}, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.session.userId !== targetId && !isAppAdmin(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowed.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "Only JPEG, PNG, WebP, and GIF images are allowed" });
  }
  await pool.query(
    "UPDATE users SET profile_picture = $1, profile_picture_type = $2 WHERE id = $3",
    [req.file.buffer, req.file.mimetype, targetId]
  );
  return res.json({ ok: true });
});
```

#### Fetch Profile Picture

```
GET /api/users/:id/profile-picture
Auth: requireAuth
```

```javascript
router.get("/:id/profile-picture", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT profile_picture, profile_picture_type FROM users WHERE id = $1",
    [req.params.id]
  );
  if (rows.length === 0 || !rows[0].profile_picture) {
    return res.status(404).json({ error: "No profile picture" });
  }
  res.setHeader("Content-Type", rows[0].profile_picture_type || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.send(rows[0].profile_picture);
});
```

#### Delete Profile Picture

```
DELETE /api/users/:id/profile-picture
Auth: requireAuth (own profile or App Admin)
```

```javascript
router.delete("/:id/profile-picture", requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.id);
  if (req.session.userId !== targetId && !isAppAdmin(req)) {
    return res.status(403).json({ error: "Not authorized" });
  }
  await pool.query(
    "UPDATE users SET profile_picture = NULL, profile_picture_type = '' WHERE id = $1",
    [targetId]
  );
  return res.json({ ok: true });
});
```

### User List Query

When querying users, include a computed `hasProfilePicture` field:

```sql
SELECT id, name, role, roles, email, initials, phone, cell, ext, avatar, offices, deleted_at,
       (profile_picture IS NOT NULL AND profile_picture_type != '') AS has_profile_picture
FROM users
WHERE deleted_at IS NULL
ORDER BY name
```

Normalize the result:

```javascript
function normalizeUser(r) {
  return {
    ...r,
    hasProfilePicture: !!r.has_profile_picture,
  };
}
```

### Frontend — Avatar Component

Create a reusable `Avatar` component used throughout the application:

```jsx
const Avatar = ({ userId, size = 28 }) => {
  const u = getUserById(userId);
  if (!u) return null;

  if (u.hasProfilePicture) {
    return (
      <img
        src={`/api/users/${u.id}/profile-picture`}
        alt={u.name}
        title={`${u.name} (${u.role})`}
        style={{
          width: size, height: size,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      title={`${u.name} (${u.role})`}
      style={{
        width: size, height: size,
        borderRadius: "50%",
        background: u.avatar,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.32,
        fontWeight: 700,
        color: "#fff",
        fontFamily: "'Inter', sans-serif",
        flexShrink: 0,
      }}
    >
      {u.initials}
    </div>
  );
};
```

### Frontend — Settings UI (Upload/Remove)

In the Settings modal/page, in the profile section:

```jsx
<div>
  <h3>Profile Picture</h3>
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <Avatar userId={currentUser.id} size={64} />
    <div>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleProfilePictureUpload}
      />
      <button onClick={() => fileInputRef.current?.click()}>
        {currentUser.hasProfilePicture ? "Change Picture" : "Upload Picture"}
      </button>
      {currentUser.hasProfilePicture && (
        <button onClick={handleRemoveProfilePicture}>Remove</button>
      )}
    </div>
  </div>
</div>
```

**Upload handler:**

```javascript
const handleProfilePictureUpload = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("picture", file);
  await fetch(`/api/users/${currentUser.id}/profile-picture`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  // Refresh user data to update hasProfilePicture flag
  await refreshCurrentUser();
};
```

**Remove handler:**

```javascript
const handleRemoveProfilePicture = async () => {
  await fetch(`/api/users/${currentUser.id}/profile-picture`, {
    method: "DELETE",
    credentials: "include",
  });
  await refreshCurrentUser();
};
```

### Where to Use the Avatar Component

Replace all instances of initials-only avatars with the `Avatar` component:
- Sidebar user section
- User list / staff directory
- Case team assignments
- Collaboration / chat views
- Activity logs
- Comment authors
- Any other location showing user identity

### Implementation Steps

1. Add `profile_picture` (BYTEA) and `profile_picture_type` (TEXT) columns to the `users` table.
2. Add the upload, fetch, and delete endpoints to `server/routes/users.js`.
3. Update user queries to include the `has_profile_picture` computed field.
4. Normalize user objects to include `hasProfilePicture: boolean`.
5. Create the `Avatar` component.
6. Add the profile picture upload/remove UI to Settings.
7. Replace all initials-only avatar renderings throughout the app with the `Avatar` component.
8. Test upload (JPEG, PNG, WebP, GIF), display, and removal.
9. Verify the 5MB limit and invalid-type rejection work correctly.

---

## Summary of Environment Variables

| Variable | Integration | Required |
|----------|------------|----------|
| `MS_CLIENT_ID` | Microsoft Office (Section 4) | For MS editing |
| `MS_CLIENT_SECRET` | Microsoft Office (Section 4) | For MS editing |
| `MS_REDIRECT_URI` | Microsoft Office (Section 4) | Optional (auto-detected) |
| `ONLYOFFICE_URL` | ONLYOFFICE DocSpace (Section 5) | For DocSpace editing |
| `ONLYOFFICE_PASSWORD` | ONLYOFFICE DocSpace (Section 5) | For DocSpace editing |
| `ONLYOFFICE_USER` | ONLYOFFICE DocSpace (Section 5) | For DocSpace editing (service account email) |
| `ONLYOFFICE_ROOM_ID` | ONLYOFFICE DocSpace (Section 5) | For DocSpace editing (collaboration room ID) |
| `SCRIBE_BASE_URL` | MattrMindrScribe (Section 6) | Optional (defaults to `https://scribe.mattrmindr.com/app`) |

Profile Pictures do not require additional environment variables — profile pictures use the existing database. MattrMindrScribe credentials are stored per-user in the database; the optional `SCRIBE_BASE_URL` variable allows overriding the default Scribe server URL.

## Summary of Database Schema Changes

```sql
-- Microsoft Office (Section 4)
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_access_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_refresh_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_token_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_account_email TEXT;

-- MattrMindrScribe (Section 6)
ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_url TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_token TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_user_email TEXT DEFAULT '';
ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS scribe_transcript_id TEXT DEFAULT '';
ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS scribe_status TEXT DEFAULT '';

-- Profile Pictures (Section 7)
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture BYTEA;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_type TEXT NOT NULL DEFAULT '';
```

## New Files to Create

| File | Description |
|------|-------------|
| `server/routes/microsoft.js` | Microsoft Office OAuth2 and OneDrive integration |
| `server/routes/onlyoffice.js` | ONLYOFFICE DocSpace editing integration |
| `server/routes/scribe.js` | MattrMindrScribe outbound integration |
| `server/routes/external.js` | External API contract (Scribe inbound) |
| `src/DocViewerWindow.js` | Floating document viewer window component |
| `src/PdfViewer.js` | PDF viewer with annotations (if not already present) |

## Route Mounting (in `server/index.js` or equivalent)

```javascript
const microsoftRouter = require("./routes/microsoft");
const onlyofficeRouter = require("./routes/onlyoffice");
const scribeRouter = require("./routes/scribe");
const externalRouter = require("./routes/external");

app.use("/api/microsoft", microsoftRouter);
app.use("/api/onlyoffice", onlyofficeRouter);
app.use("/api/scribe", scribeRouter);
app.use("/api/external", externalRouter);
```

## Security & Authorization Requirements

These cross-cutting concerns apply to all integrations above:

### Route-Level Access Control

Every authenticated endpoint must verify the requesting user has permission to access the specific resource:

- **Document endpoints**: Verify the user is on the case team (assigned attorney, paralegal, investigator, etc.) for the document's parent case before allowing view, edit, upload, or sync operations. Do not rely solely on `requireAuth`.
- **Profile picture endpoints**: Users can only modify their own profile picture unless they are an App Admin.
- **Scribe send/import**: Check case team membership and respect confidential case flags before allowing transcript operations.
- **External API endpoints** (`/api/external/*`): Validate the Bearer token on every request and scope case access to the token holder's team assignments.

### OAuth postMessage Security

When using `window.opener.postMessage` for the Microsoft OAuth callback:
- **Sender (callback page)**: Always specify the target origin explicitly: `window.opener.postMessage(data, "https://your-app-domain.com")` — never use `"*"`.
- **Receiver (frontend)**: Always check `event.origin` matches your application's domain before processing the message.

### Token Storage

- Microsoft OAuth tokens (`ms_access_token`, `ms_refresh_token`) and Scribe tokens (`scribe_token`) are stored in the database. Ensure your database connection uses TLS and these columns are not exposed in any user-facing API response.
- Temporary download tokens (for Scribe file serving) must have short TTLs (1 hour max) and be single-use or automatically cleaned up.

### ONLYOFFICE Session Tokens

- DocSpace session tokens are cached in memory with a 10-minute TTL. On 401 responses, invalidate the cache and re-authenticate automatically.
- The collaboration room should be configured with restricted access in DocSpace — only the service account should have write permissions.

## Recommended Implementation Order

1. **Profile Pictures** (Section 7) — Standalone, no external dependencies
2. **Multi-Document Window Interface** (Section 3) — Foundation for viewer features
3. **Microsoft Office Viewer** (Section 1) — Read-only viewing, no auth required
4. **Presenter View** (Section 2) — Small addition on top of the viewer
5. **ONLYOFFICE DocSpace Integration** (Section 5) — Editing fallback
6. **Microsoft Office Integration for Editing** (Section 4) — Primary editing
7. **MattrMindrScribe Integration** (Section 6) — Independent feature, can be done in parallel
