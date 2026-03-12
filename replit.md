# MattrMindr — Personal Injury Case Management System

## Overview
A case management system for personal injury law firms. Tracks PI cases, manages deadlines and statutes of limitations, assigns tasks, tracks medical treatments/insurance/damages/liens/negotiations, performs conflict checks, and generates office-wide reports. Supports multi-state jurisdiction-aware AI agents.

## Stack
- **Frontend**: React 19 (Create React App), port 5000
- **Backend**: Node.js + Express 4, port 3001
- **Database**: PostgreSQL (Replit-provisioned), accessed via `DATABASE_URL`
- **Auth**: express-session with bcrypt password hashing; session restore on page refresh via `/api/auth/me`; temporary password emails via SendGrid
- **Email**: SendGrid (Replit integration) for auth emails; SendGrid Inbound Parse for case correspondence
- **Styling**: Tailwind CSS v3 + CSS-in-JS template literal; Inter font, slate/amber color palette, lucide-react icons
- **Icons**: All AI Center agent cards and Reports page cards use lucide-react Icon components with colored rounded-lg background containers
- **OCR**: Tiered Gemini OCR pipeline via `@google/generative-ai`: 1) `gemini-3.1-flash-lite-preview` sends PDF directly (fastest), 2) falls back to `gemini-2.0-flash` with image-based extraction (converts pages to JPEG, auto-splits into size-based batches under 45MB, compresses oversized images with `sharp`, reduces DPI for PDFs >50MB), 3) falls back to tesseract.js; no page limit
- **System Dependencies**: ffmpeg (Nix package, required for audio transcription), pdftoppm (for PDF-to-image conversion during OCR)
- **Design Packages**: tailwindcss@3.4.19, postcss, autoprefixer, lucide-react (in lextrack/package.json devDependencies)

## Running the App
Workflow: `npm start` (root) — runs both Express API and React app via `concurrently`
Login: email + password (existing users default: `1234`, new users get temp password via email)

## Deployment
- **Target**: autoscale
- **Build**: `npm install && cd server && npm install && cd ../lextrack && npm install && CI=false npm run build`
- **Run**: `NODE_ENV=production node server/index.js` (serves API + React build on port 5000)
- **Note**: `CI=false` is required because Replit's deployment sets `CI=true`, which causes `react-scripts build` to treat ESLint warnings as errors

## Project Structure
```
server/
  index.js          — Express entry point, session middleware, CORS, prod static serving
  db.js             — pg Pool configured from DATABASE_URL
  schema.js         — Creates all DB tables (run once)
  seed.js           — Seeds USERS from firmData.js + imports all table data from seed-data.json
  email.js          — SendGrid email utility
  sms.js            — Twilio SMS utility
  sms-scheduler.js  — SMS scheduler for appointment/treatment reminders
  r2.js             — Cloudflare R2 storage module (S3-compatible, hybrid fallback)
  routes/
    auth.js         — login, logout, me, change-password, forgot/reset-password
    case-documents.js — CRUD /api/case-documents; PUT /:docId/move for folder drag-and-drop
    cases.js        — CRUD /api/cases with PI fields, conflict check
    tasks.js        — CRUD /api/tasks (bulk create, complete)
    deadlines.js    — GET/POST/PUT /api/deadlines
    notes.js        — GET/POST/PUT/DELETE /api/notes
    links.js        — GET/POST/DELETE /api/links
    activity.js     — GET/POST /api/activity
    contacts.js     — CRUD /api/contacts (soft-delete/restore)
    insurance.js    — CRUD /api/insurance (case insurance policies, partial-update PUT)
    medical-treatments.js — CRUD /api/medical-treatments (partial-update PUT)
    liens.js        — CRUD /api/liens (with reduction_value/reduction_is_percent, partial-update PUT)
    damages.js      — CRUD /api/damages (with billed/owed/reduction/client_paid/firm_paid, partial-update PUT)
    negotiations.js — CRUD /api/negotiations (with policy_id linking, partial-update PUT)
    expenses.js     — CRUD /api/expenses (partial-update PUT)
    voicemails.js   — CRUD /api/voicemails
    ai-agents.js    — All AI agent endpoints (with AI search enhancement)
    trial-center.js — Trial Center CRUD (with Daubert challenge)
    trial-center-ai.js — Trial Center AI agents (civil PI context)
    custom-reports.js — Custom Report Builder with AI assist
    custom-agents-builder.js — Custom AI Agents with multi-model support
    task-flows.js     — Custom Task Flows CRUD + condition evaluation engine
    custom-dashboard-widgets.js — Custom Dashboard Widgets CRUD + run/execute
    portal-auth.js  — Client portal auth (login/logout/me/change-password)
    portal-case.js  — Client portal data (case info, messages, documents)
    portal-admin.js — Firm-side portal management (settings, clients, messaging)
    permissions.js  — Permissions CRUD (role/user-based, optional expiry)
    batch-cases.js  — Batch case operations
    deleted-data.js — Deleted data view with batch restore/purge
    ...
  middleware/
    auth.js         — Firm user authentication middleware
    clientAuth.js   — Client portal authentication middleware
    external-auth.js — JWT generation + requireExternalAuth middleware for external API

lextrack/
  src/
    App.js          — All UI components and business logic (~15,800 lines)
    portal/
      PortalApp.js  — Client portal UI (login, dashboard, messages, documents)
      portalApi.js  — Portal API fetch wrapper
    CollaborateView.js — Internal chat feature
    TrialCenterView.js — Trial Center (civil PI trial context)
    api.js          — Thin fetch wrapper for all API calls
    firmData.js     — Static reference data: PI firm staff (avatars, names, roles)
```

## Key Features

### Case Management
- **Case Types**: Auto Accident, Truck Accident, Motorcycle Accident, Slip & Fall, Medical Malpractice, Product Liability, Wrongful Death, Workers' Compensation, Dog Bite, Premises Liability, Nursing Home Abuse, Other
- **Case Stages**: Intake, Investigation, Treatment, Pre-Litigation Demand, Negotiation, Suit Filed, Discovery, Mediation, Trial Preparation, Trial, Settlement/Verdict, Closed
- **Case Statuses**: Active, Pre-Litigation, In Litigation, Settled, Closed, Referred Out
- **PI-Specific Fields**: Client name, accident date, incident description/location, injury type/description, state jurisdiction (all 50 US states + DC), statute of limitations date, case value estimate, settlement amount/date, demand amount/date, demand response due, contingency fee %, case expenses, liability assessment, comparative fault %, police report number, weather conditions, property damage amount
- **Client Detail Fields**: DOB, SSN, address, phone numbers (JSONB array with label+number), email, emergency contact, bankruptcy checkbox
- **Litigation Checkbox**: Header checkbox for marking cases as in litigation; auto-reassigns CM call tasks to Paralegal when toggled on
- **SOL Warning**: Red badge when ≤60 days, amber badge when ≤180 days — shown in case detail and case list rows
- **Staff Roles**: Managing Partner, Senior Partner, Partner, Associate Attorney, Of Counsel, Paralegal, Legal Assistant, Case Manager, Medical Records Coordinator, Intake Specialist, Office Administrator, IT Specialist, Investigator, App Admin

### PI-Specific Tables & Tabs
- **Insurance Policies** (`case_insurance_policies`): Policy type (Liability/UM/UIM/MedPay/PIP/Homeowner/Commercial/Umbrella/Health Insurance), carrier, policy number, limits, adjuster details, claim number — displayed in its own Insurance tab with collapsible Negotiations under each policy
- **Medical Treatments** (`case_medical_treatments`): Provider name/type (ER/Hospital/Orthopedic/Chiropractor/PT/etc.), visit dates, billing totals, treatment status — collapsible cards with medical record upload
- **Medical Records** (`medical_records`): Per-treatment uploaded records with AI-parsed visit entries (provider, date, pages, summary) from PDF uploads
- **Liens** (`case_liens`): Lien type (Medical/Medicare/Medicaid/ERISA/etc.), lienholder, amount, negotiated amount, status, reduction (value + %/$) — displayed under the Damages tab
- **Damages** (`case_damages`): Category (Medical Bills/Lost Wages/Future Medical/Pain & Suffering/etc.), documentation status, billed, owed (auto-calculated: billed - reduction - insurance paid - write-off), reduction (value + %/$), insurance paid, write-off, client paid, firm paid
- **Expenses** (`case_expenses`): Category (Filing Fees/Expert Fees/Court Reporter/Medical Records/etc.), amount, date, vendor, status — standalone Expenses tab
- **Negotiations** (`case_negotiations`): Date, direction (Demand/Offer/Counter-Demand/Counter-Offer), amount, from party, policy_id (links to insurance policy) — displayed as collapsible sections under each insurance policy in the Insurance tab, with Gross/Net calculations
- **Voicemails** (`case_voicemails`): Caller name/number, duration, transcript, notes, audio — sub-tab under Correspondence; inbound voicemail emails route audio to this table (not transcripts); on-demand Whisper transcription via `POST /api/voicemails/:id/transcribe`

### AI Agents (server/routes/ai-agents.js)
All agents use OpenAI (`gpt-4o-mini`) via existing integration. Jurisdiction-aware using case's `stateJurisdiction`:
1. **Liability Analysis** — Assess fault, comparative negligence, applicable state law
2. **Deadline Generator** — SOL deadlines, discovery deadlines, mediation, IME dates (jurisdiction-aware)
3. **Case Valuation & Strategy** — Estimate case value, litigation strategy, settlement recommendations
4. **Document Drafting** — Demand letters, motions, general document drafting for PI
5. **Case Triage** — Rank by SOL proximity, case value, treatment status, pending deadlines
6. **Client Communication Summary** — Treatment status, claim progress, next steps
7. **Medical Record Summarizer** — Focus on medical records, accident reports, expert reports
8. **Task Suggestions** — PI-specific tasks (order records, preservation letter, schedule IME, file suit, etc.)
9. **Filing Classifier** — PI filing types (complaints, answers, discovery, motions, medical records)
10. **Advocate AI** — Global conversational assistant with PI practice knowledge base
11. **Batch Case Manager** — Bulk operations (staff reassignment, status changes, stage advancement, jurisdiction changes)

### Reports
- Cases by Trial Date, Cases by Attorney, Next Court Date, Cases by Upcoming Dates
- Cases with Specific Open Task, Active Cases Without Trial Date, Overdue Tasks
- Attorney Workload Summary, Upcoming Deadlines by Window
- **SOL Tracker** — Active cases sorted by SOL date with urgency coloring
- **Case Value Pipeline** — Active cases by estimated value with demand/settlement comparison
- **Settlement Report** — Settled cases with amounts, contingency fees, time-to-settlement
- **Custom Report Builder** — Dynamic SQL-based reports from any data source, AI-assisted configuration, saved reports, CSV export

### Customization Section (App Admin Only)
- **Navigation**: "Customization" nav item visible to App Admin users, located after Staff and before Deleted Data
- **Sub-tabs**: Custom Agents, Custom Reports, Dashboard Widgets, Task Flows
- Consolidates previously-scattered custom builders into one location

### Custom AI Agents
- Multi-model support: GPT-4o, GPT-4o Mini, Claude 3.5 Sonnet, Gemini 2.0 Flash
- Run mode and Chat mode with case context injection
- Instruction file upload, temperature/max_tokens control
- Context sources: notes, filings, documents, medical_records
- Located under Customization > Custom Agents tab (also accessible from AI Center)

### Custom Task Flows
- **Tables**: `custom_task_flows`, `custom_task_flow_steps` (with `conditions JSONB`), `task_flow_executions`
- **Route**: `server/routes/task-flows.js` — CRUD + `evaluateFlowsForCase()` engine
- **Trigger conditions**: field-based conditions (status, stage, caseType, inLitigation, clientBankruptcy, stateJurisdiction, county, dispositionType, injuryType) with operators (equals, not_equals, contains, is_true, is_false, changed_to)
- **Trigger timing**: on case create, update, or both
- **Steps**: Each flow has ordered steps with title, assigned role or specific user, due-in-days, priority, recurrence, and auto-escalation settings
- **Step Conditions**: Each step can have multiple conditions (all must be met, AND logic) stored as JSONB:
  - `prior_step` — another step in this flow must have been created first (stepIndex reference)
  - `case_field` — case field must match a condition (field/operator/value, same operators as trigger)
  - `task_status` — existing task matching title pattern must be in specified status (Completed/In Progress/Not Started)
  - `role_assigned` — a specific role (Attorney, Case Manager, etc.) must be filled on the case
  - `case_age` — case must be at least X days old
  - `has_document` — document matching filename pattern must exist on the case
  - `priority_level` — count of open tasks at a priority level must meet threshold (greater_than/equals/less_than)
- **Execution**: When a case create/update triggers a flow condition, tasks are auto-created for steps whose conditions are met; steps with unmet conditions are skipped; duplicate execution prevented via `task_flow_executions` table
- **Integration**: `evaluateFlowsForCase()` called from `server/routes/cases.js` POST and PUT endpoints
- `tasks.source_flow_id` column tracks which flow created each task
- Located under Customization > Task Flows tab

### Custom Dashboard Widgets
- **Table**: `custom_dashboard_widgets` (user_id, name, widget_type, data_source, config, size, visibility)
- **Route**: `server/routes/custom-dashboard-widgets.js` — CRUD + `/run` endpoint
- **Widget types**: Metric (count/sum/average), List (filtered records table), Chart (bar/pie)
- **Data sources**: cases, tasks, deadlines, contacts, correspondence, expenses, staff_assigned (special: joins cases with users by role column, chart-only)
- **Staff Assigned**: chart widget showing case distribution by staff member; config keys: `staff_role` (Lead Attorney/Second Attorney/Case Manager/Investigator/Paralegal), `case_status_filter` (Active/All/etc.); maps role to DB column (lead_attorney, second_attorney, case_manager, investigator, paralegal)
- **Filters**: field/operator/value conditions per widget
- **Dashboard integration**: Custom widgets appear in Customize Dashboard modal alongside built-in widgets; rendered via `CustomDashboardWidgetRenderer` component
- **Visibility**: private (only creator) or public (all users)
- Located under Customization > Dashboard Widgets tab

### Document Viewer
- **DOCX/DOC**: mammoth HTML conversion, read-only rendered view
- **XLSX/XLS**: SheetJS parsing, interactive table display with sheet tabs
- **PPTX/PPT**: jszip XML parsing, slide cards with positioned text
- **PDF**: iframe-based viewer
- **Images**: blob URL display
- **Audio/Video**: HTML5 media player
- All document clicks open in-app viewer (T008)
- PDF annotations stored in database (annotations JSONB column)

### Transcript Enhancements
- **History & Revert**: Version history with auto-save, color-coded change types, revert to any version
- **Reading View**: Clean read-only with speaker colors and timestamps
- **Present Mode**: Dark theme window (18px font) for courtroom presentation
- **Video Transcription**: Video upload/playback with HTTP Range streaming, R2 hybrid storage
- **AI Name Suggestion**: GPT-powered transcript naming from content
- **AI Summaries at Top**: Imported Scribe AI summaries displayed at top of transcript (collapsible, collapsed by default)
- **Transcript Summarize**: Non-Scribe transcripts have a "Summarize" button that generates AI summary via `POST /api/transcripts/:id/summarize` using PI-focused transcript analysis prompt; summaries stored in `case_transcripts.summaries` JSONB column

### Cloud Storage (R2)
- Cloudflare R2 via S3-compatible API (`server/r2.js`)
- Hybrid model: R2 when configured (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME), BYTEA fallback
- Chunked uploads use S3 multipart when R2 available
- Supports audio, video, and document storage

### Trial Center
- Civil PI trial context (plaintiff/client terminology, civil jury options, PI-relevant motions)
- 10 tabs: Witnesses, Exhibits, Jury, Motions, Outlines, Jury Instructions, Demonstratives, Quick Docs, Trial Log, AI Agents
- 7 embedded AI agents adapted for civil PI litigation
- **Daubert Challenge Analysis**: collapsible section in jury analysis with Shield icon
- **Universal Document Viewer**: all file types viewable in Trial Center with Present Mode
- **Exhibit Selection from Documents**: select existing case documents as exhibits

### Unmatched Section
- **Navigation**: "Unmatched" nav item with Inbox icon, located between Contacts and Staff
- **Tabs**: Emails tab (unmatched filings emails) and Texts tab (unmatched SMS)
- **Unmatched Filings Emails**: Emails sent to `filings@plaintiff.mattrmindr.com` that can't be matched to a case (no court number found or no matching case in DB) are stored in `unmatched_filings_emails` table instead of being dropped
- **Email Assignment**: Users search for and assign emails to cases; on assignment, the system runs the full filings auto-sort pipeline (correspondence insert, PDF filing creation, AI classification, hearing deadline extraction) within a DB transaction
- **Unmatched Texts**: SMS messages with no matching case shown in Texts tab; on assignment, the phone number is automatically added as a monitored number (`sms_watch_numbers`) for the assigned case
- **Route**: `server/routes/unmatched-emails.js` — GET `/api/unmatched-emails`, PUT `/api/unmatched-emails/assign/:id`
- **Removed**: "Unmatched" button and modal from case detail correspondence texts tab (moved to dedicated nav section)

### UI Improvements
- **Drag-Drop Upload**: reusable DragDropZone component for all upload areas
- **Background Upload Manager**: floating bottom-right indicator with progress/status
- **Voicemail Detection**: auto-detect "Voice Message" emails in correspondence
- **Bulk SMS Delete**: checkbox selection with batch delete
- **Deleted Data View**: search, batch restore, batch purge
- **Collapsible Strategy Notes**: toggle section in case notes
- **AI Panel Styling**: amber/indigo/slate consistent design

### Runtime Migrations
- `ensureColumns()` in server/index.js runs before app.listen()
- Auto-creates tables: transcript_history, custom_reports, custom_agents, custom_task_flows, custom_task_flow_steps, task_flow_executions, custom_dashboard_widgets, unmatched_filings_emails
- Auto-adds columns: is_voicemail, annotations, content_html, is_video, r2 keys, daubert_challenge, ms_access_token, ms_refresh_token, ms_token_expiry, ms_account_email, scribe_url, scribe_token, scribe_user_email, scribe_transcript_id, scribe_status, tasks.source_flow_id, cases.court_case_number, voirdire_url, voirdire_token, voirdire_user_email, trial_jurors.voirdire_juror_id

### Contact Categories
Client, Insurance Adjuster, Insurance Company, Medical Provider, Defense Attorney, Judge, Court, Witness, Expert, Lienholder, Family Member, Miscellaneous

### Seed Data
- **Generator**: `node server/generate-seed-data.js` regenerates `server/seed-data.json`
- **Seeding**: `node server/seed.js` clears all old data and imports fresh PI data
- **Content**: 30 PI cases (77% pre-litigation), 34 tasks, 20 deadlines, 15 notes, 18 activity records, 14 insurance policies, 19 medical treatments, 6 liens, 18 damages, 24 negotiations, 39 contacts
- **Jurisdictions**: AL, GA, TN, TX, FL, MS, CA, NY
- **Case naming**: Client name format for pre-litigation ("Tamika Washington"), litigation-style only for filed cases
- **Default password**: `1234` for all seeded users; Admin account: `admin@mitchellpi.com`

### Client Portal
- **Path**: `/portal` — client-facing portal for case status, messaging, and document uploads
- **Login**: Separate `client_users` table, fully isolated from firm sessions (uses `req.session.clientId` + `req.session.isClient`)
- **Invite Flow**: Firm staff invite clients from case detail's "Client Portal" tab → generates temp password → optional welcome email via SendGrid
- **Portal Settings** (`client_portal_settings`): Per-case toggle switches controlling what clients can see (stage, attorney name, case type, accident date, court date, documents, messaging, medical treatments, negotiations, case value) + custom status message
- **Portal Features**:
  - Case progress timeline (PI stages mapped to client-friendly labels)
  - Case info cards (filtered by visibility settings)
  - Messaging (client ↔ firm, chat-style thread via `client_messages` table)
  - Document upload (client uploads marked with `source='client'`) + view firm-shared documents
  - "What to Expect" section explaining the PI process
  - Attorney / firm contact info
- **Firm-Side Management**: "Client Portal" tab in case detail view with settings toggles, client user management, and message reply
- **Documents**: `case_documents.source` column distinguishes `'firm'` (default) vs `'client'` uploads; firm Documents tab shows "Client Upload" badge
- **Files**: `server/routes/portal-auth.js`, `server/routes/portal-case.js`, `server/routes/portal-admin.js`, `server/middleware/clientAuth.js`, `lextrack/src/portal/PortalApp.js`, `lextrack/src/portal/portalApi.js`
- **Firm Login**: "Click here if you are a client" link on firm login screen navigates to `/portal`

### MFA / Two-Factor Authentication
- TOTP-based MFA using `otplib` and `qrcode` packages
- Users enable MFA in Settings modal (Security section) → generates QR code → verify with authenticator app
- Login flow: password verified → if MFA enabled, returns `{ requireMfa: true }` → user enters 6-digit TOTP code → session created
- Routes: `POST /api/auth/mfa/setup`, `/mfa/verify-setup`, `/mfa/verify`, `/mfa/disable`
- DB columns: `users.mfa_secret TEXT`, `users.mfa_enabled BOOLEAN`

### Remember Me (30-Day Session)
- Checkbox on login screen: "Remember me for 30 days"
- When checked, `req.session.cookie.maxAge = 30 days`; otherwise browser-session cookie
- Passed as `rememberMe` boolean in login request body

### Profile Pictures
- Upload JPEG/PNG/WebP/GIF (max 5MB), stored as BYTEA in `users.profile_picture`
- Routes: `POST/GET/DELETE /api/users/:id/profile-picture`
- Avatar component renders `<img>` when `hasProfilePicture` is true, falls back to initials
- Upload/delete UI in Settings modal (click avatar to upload)

### Document & Transcript Folders
- Tables: `document_folders`, `transcript_folders` (id, case_id, name, sort_order, collapsed)
- `case_documents.folder_id` and `case_transcripts.folder_id` (ON DELETE SET NULL)
- Routes: `GET/POST /:caseId/folders`, `PUT/DELETE /folders/:id`, `PUT /:docId/move`, `PUT /reorder-folders`
- Frontend: Collapsible folder sections, drag-and-drop, double-click rename, create/delete folders, "Unfiled" section

### Batch Delete
- Attorney+ roles (Managing Partner through App Admin) can multi-select and batch delete
- Routes: `POST /api/case-documents/batch-delete`, `/api/transcripts/batch-delete`, `/api/correspondence/batch-delete`
- Frontend: Select mode with checkboxes, Select All/Deselect All, Delete Selected with confirmation

### Multi-Document Floating Window Interface
- Multiple documents can be viewed simultaneously in draggable/resizable floating windows
- State lives in `FirmApp`: `openDocViewers`, `openTranscriptViewers` arrays with `topZIndexRef`, `nextViewerIdRef` refs
- Functions in `FirmApp`: `openAppDocViewer(docId, filename, contentType, caseId)`, `openAppFilingViewer(filingId, filename)`, `openBlobInViewer(blob, filename, contentType)`, `closeDocViewer(id)`, `minimizeDocViewer(id)`, `restoreDocViewer(id)`, `bringDocViewerToFront(id)`, `openTranscriptViewer(transcript)`, `closeTranscriptViewer(id)`, `minimizeTranscriptViewer(id)`, `restoreTranscriptViewer(id)`, `bringTranscriptViewerToFront(id)`
- Props threaded: FirmApp → CasesView → CaseDetailOverlay and FirmApp → ReportsView → CaseDetailOverlay
- Component: `lextrack/src/DocViewerWindow.js` — renders individual floating window with drag/resize handles; includes Case Info Panel (briefcase icon in title bar) showing full case details (client, dates, financials, liability, team) in a 280px right-side slide-in panel; requires `caseId` in viewer state + `allCases` prop
- Component: `lextrack/src/TranscriptViewerWindow.js` — floating transcript viewer with audio player (play/pause, ±5s skip, progress bar, speed buttons), speaker chips, editable segments, reading view, version history, AI summaries, toolbar (Audio Download, Export, History, Reading View, Present, Scribe/Refresh, Save)
- Minimized chips: floating chips (position: fixed, bottom-left, no background bar) that persist across all app screens
- Viewer rendering in FirmApp's return — both DocViewerWindow and TranscriptViewerWindow render at FirmApp level so they persist across navigation
- Cascade offset: each new window shifts 30px from previous
- Mobile: full-screen overlay mode (single window)
- Document types: DOCX (mammoth HTML), XLSX (SheetJS tables), PPTX (slide cards), PDF (iframe), images, audio/video, text

### Microsoft Office Online Viewer (T002)
- Backend: `GET /api/case-documents/:id/office-view-url` generates Office Online embed URL via temporary download token
- Token-based download: `GET /api/case-documents/office-download/:token` (10-minute expiry)
- Frontend: Office/Built-in toggle in DocViewerWindow header for DOCX/XLSX/PPTX files
- Graceful fallback: if Office Online can't reach the document URL, built-in viewer is used

### Presenter View (T003)
- Present button (MonitorPlay icon) in DocViewerWindow toolbar
- Opens new browser window (1280x720) with type-specific presentation content
- Supports: Office iframe, PDF embed, images, videos, DOCX rendered HTML
- Dark/Light mode toggle in all presenter windows (transcript, document, Trial Center)
- Escape key closes presenter window

### Microsoft Office Editing (T004)
- OAuth2 flow connecting user's Microsoft 365 account
- DB columns: `ms_access_token`, `ms_refresh_token`, `ms_token_expiry`, `ms_account_email`
- Backend: `server/routes/microsoft.js` — `/configured`, `/status`, `/auth-url`, `/callback`, `/disconnect`, `/upload-for-edit`, `/sync-back`, `/cleanup/:driveItemId`
- Token refresh logic for expired access tokens
- Upload to OneDrive → edit in browser → sync changes back to DB
- Settings UI: Microsoft 365 connection/disconnection in Integrations section
- Env vars: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_REDIRECT_URI` (optional)

### ONLYOFFICE DocSpace Editing (T005)
- Backend: `server/routes/onlyoffice.js` — `/status`, `/upload-for-edit`, `/sync-back`, `/cleanup/:fileId`
- DocSpace session authentication with caching
- Upload to collaboration room, get editor config (document, editorConfig, token via openedit API), sync back, cleanup
- Frontend: `lextrack/src/DocViewerWindow.js` — inline embedded editor using ONLYOFFICE Document Server JS API (`DocsAPI.DocEditor`)
- Editor loads `api.js` from ONLYOFFICE Document Server (editorUrl), creates editor with full config including JWT token
- Edit mode shows "EDITING" badge, "Save & Close" (syncs back to DB) and "Discard" buttons in title bar
- Settings UI: DocSpace status display in Integrations section
- Env vars: `ONLYOFFICE_URL`, `ONLYOFFICE_PASSWORD`, `ONLYOFFICE_USER`, `ONLYOFFICE_ROOM_ID` (all configured)
- ONLYOFFICE DocSpace URL: https://docspace-13tl7v.onlyoffice.com, Room: MattrMindr-Edit (ID: 2853087)
- Scribe URL hardcoded to `https://scribe.mattrmindr.com`; users connect via email/password; system API key via `SCRIBE_API_KEY` env var

### MattrMindrScribe Integration (T006)
- Backend: `server/routes/scribe.js` — `/status`, `/connect`, `/disconnect`, `/send/:transcriptId`, `/download/:token`, `/transcript-status/:scribeTranscriptId`, `/import/:transcriptId`, `/list-transcripts`, `/import-new`
- DB columns: `users.scribe_url`, `users.scribe_token`, `users.scribe_user_email`; `case_transcripts.scribe_transcript_id`, `case_transcripts.scribe_status`, `case_transcripts.summaries` (JSONB)
- External API extensions: `GET/POST /api/external/cases/:id/files` for Scribe inbound
- Temporary download token system (30-min expiry) for audio file access
- Settings UI: Scribe connection form in Integrations section
- Transcript UI: "Send to Scribe", "Import from Scribe", and "Refresh from Scribe" buttons via ScribeTranscriptButtons component
- "Pull from Scribe" button in transcripts sub-tab opens modal listing completed Scribe transcripts not yet imported; filters out already-imported transcripts
- AI Summaries: collapsible section in transcript detail view showing Scribe-generated summaries (from `summaries` JSONB column)
- Refresh syncs latest segments + summaries from Scribe back to MattrMindr
- API functions: `apiListScribeTranscripts()`, `apiImportNewFromScribe(scribeTranscriptId, caseId)` in `lextrack/src/api.js`

### Voir Dire Analyst Integration
- Backend: `server/routes/voirdire.js` — `/status`, `/connect`, `/disconnect`, `/list-jurors`, `/import-jurors`
- DB columns: `users.voirdire_url`, `users.voirdire_token`, `users.voirdire_user_email`; `trial_jurors.voirdire_juror_id`
- External API: `https://voirdire.mattrmindr.com` — auth at `/api/external/auth`, jurors at `/api/external/jurors`
- Imports jurors with full metadata (name, seat, demographics, notes, analysis, questionnaire, bias rating, occupation)
- Upserts via `voirdire_juror_id` to avoid duplicates on re-import
- Settings UI: Voir Dire Analyst connection card in Integrations section (violet/purple theme)
- Trial Center Jury tab: "Import from VDA" button opens modal listing jurors from VDA to select and import
- API functions: `apiGetVoirdireStatus()`, `apiConnectVoirdire()`, `apiDisconnectVoirdire()`, `apiListVoirdireJurors()`, `apiImportVoirdireJurors()` in `lextrack/src/api.js`

### Auto-Transcription of Audio Email Attachments
- `server/routes/inbound-email.js` detects audio MIME types (MP3/WAV/M4A/OGG/WebM/MP4/AAC/FLAC)
- Creates `case_transcripts` entry with `uploaded_by_name = "Email: {sender}"`
- Calls `processTranscription()` from transcripts.js for background Whisper transcription
- Whisper API requires direct OpenAI key (`OPENAI_API_KEY` env var); Replit AI integration proxy does not support audio transcription endpoints. If Whisper returns 404/400/422/501, a clear error message is stored in `error_message` column

### Filings Email Handling
- Dedicated email: `filings@plaintiff.mattrmindr.com` (requires SendGrid Inbound Parse DNS/MX config)
- Emails to `filings@` are parsed for court case number in subject line (format: `XX-XX-YYYY-NNNNNN.NN`, e.g., `21-CV-2025-900012.00`)
- Regex: `/(\d{1,3}-[A-Za-z]{1,5}-\d{4}-\d+(?:\.\d+)?)/` extracts the court case number
- Matches against `cases.court_case_number` field (renamed from old "Case Number" concept)
- PDF attachments → `case_filings` table with AI classification (same pipeline as existing filing detection)
- All filing emails also stored in `case_correspondence` for audit trail
- "Case Number" field = court-assigned number (stored in `court_case_number` column, frontend key: `courtCaseNumber`)
- "File Number" field = internal firm file number (stored in `case_num` column, frontend key: `caseNum`, was previously labeled "Case Number")

### External API with JWT Auth (MattrMindr ↔ Scribe Contract)
- `server/middleware/external-auth.js`: JWT generation (30-day expiry, `type: "integration"`) using `EXTERNAL_JWT_SECRET` or `SESSION_SECRET`
- `server/routes/external.js`: Auth (`POST /auth` + `/auth/login`), cases search with `q` param and pinned sorting, file existence check (`GET /cases/:id/files?filename=`), file receive (`POST /cases/:id/files` with segments/versions/summaries/pipelineLog), case detail, jury analysis import
- Outbound to Scribe: `POST /api/external/auth` (connect), `POST /api/external/receive` (send file), `GET /api/external/transcripts/:id/status` (poll status)
- DB columns added: `case_transcripts.transcript_versions`, `case_transcripts.summaries`, `case_transcripts.pipeline_log`
- Mounted at `/api/external` with separate CORS config (`EXTERNAL_CORS_ORIGINS` env var)
- Package: `jsonwebtoken`

### Voir Dire Analysis Import
- Table: `jury_analyses` (case_id UNIQUE, jurors JSONB, strike_strategy, cause_challenges JSONB, cause_strategy)
- External API: `POST /api/external/cases/:id/jury-analysis` (JWT auth, upsert)
- Internal: `GET/PATCH/DELETE /api/trial-center/jury-analysis/:caseId`
- Trial Center Jury tab: Juror list table, strike tracker (Defense/Plaintiff strike buttons), suggested strike order, cause challenges section
- Color-coded badges: lean (favorable=emerald, neutral=slate, unfavorable=red), risk (low=emerald, medium=amber, high=red)

### Large File Chunked Upload
- Files >20MB use chunked upload (20MB chunks) with progress bar
- Endpoints: `POST /upload/init`, `/upload/chunk`, `/upload/complete` on both case-documents and filings routes
- API helpers: `apiUploadCaseDocumentChunked(file, caseId, docType, onProgress)`, `apiUploadFilingChunked(file, caseId, filedBy, filingDate, docType, onProgress)`
- Files ≤20MB continue using standard single-request upload

### Unread Client Communication Widget
- Dashboard widget showing unread messages and document uploads from the client portal
- Backend endpoint: `GET /api/portal-admin/unread-summary` — groups unread client messages (`read_at IS NULL`) and unviewed client documents (`firm_viewed_at IS NULL`) by case, filtered to only cases assigned to the logged-in staff member (lead_attorney, second_attorney, case_manager, investigator, paralegal, or custom_team); App Admins see all cases
- Widget shows case name with client name, clickable to open case's correspondence tab, with message/document counters
- DB column: `case_documents.firm_viewed_at TIMESTAMPTZ` for tracking when firm views client-uploaded docs
- Advocate AI has full context of unread client communication when on the dashboard (message previews, document names, per-case counts)

### Soft-Delete System
- All entities now use soft-delete: setting `deleted_at` timestamp instead of permanent deletion
- Tables with `deleted_at`: cases, contacts, users, case_documents, case_transcripts, case_filings, case_correspondence, deadlines, case_notes, time_entries, case_insurance_policies, case_medical_treatments, case_liens, case_damages, case_negotiations, case_parties, case_experts, case_misc_contacts
- All listing queries filter with `AND deleted_at IS NULL` to hide soft-deleted records
- Delete confirmation popup: "Are you sure you want to delete this data? An App Admin can restore the data within 30 days."
- Auto-purge: daily interval permanently removes records where `deleted_at < NOW() - 30 days`

### Deleted Data View (App Admin Only)
- Navigation item "Deleted Data" visible only to App Admin users
- Route: `server/routes/deleted-data.js`
- Endpoints: `GET /api/deleted-data` (list all soft-deleted records grouped by type), `POST /api/deleted-data/restore` (restore by type+id), `POST /api/deleted-data/purge` (permanently remove expired)
- Frontend: `DeletedDataView` component shows grouped items with name, case reference, deletion date, days remaining until permanent removal, and restore button

### Voir Dire Cause Strikes
- Each cause challenge card now displays both the Reason (`cc.reason || cc.basis`) and the Argument (`cc.argument`) as separate labeled fields

### Default Tasks (auto-created for new cases)
Initial Client Interview → Send Preservation Letters → Obtain Police Report → Identify Insurance Policies → Check for Conflicts → Order Medical Records

### Recurring Call Tasks
- On case creation, auto-creates two recurring 30-day tasks: "Call Client - Attorney Check-in" (assigned to lead attorney) and "Call Client - Case Manager Check-in" (assigned to case manager)
- When litigation checkbox toggled on, CM call task reassigned to Paralegal; toggled off, reassigned back to Case Manager

### Overview Layout
- 3-column layout: Case Details | Client Details | Key Dates
- Key Dates: Trial/Court/Mediation dates only visible when stage is Suit Filed or later
- Demand Date shows "Demand Sent" label when populated

### Tab Organization
- Insurance Policies have their own tab (between Details and Medical), with collapsible Negotiations under each policy
- Liens section is inside the Damages tab (below Damages list)
- Fee field in Details tab supports both percentage (%) and flat dollar ($) modes via `fee_is_flat` boolean
- Net Total formula: `Net = Gross - fee (% of gross or flat $) - sum(damages.owed) - sum(liens.negotiated_amount or amount) - sum(expenses.amount)`
- Expenses has its own standalone tab
- Voicemails is a sub-tab under Correspondence

### PDF Intake OCR
- "Upload Intake Form" button in New Case modal
- Endpoint `POST /api/cases/parse-intake` uses OCR + OpenAI to extract case fields from PDF intake forms

### Medical Record Upload & AI Parsing
- Upload PDFs per medical treatment → OCR → OpenAI parses into individual visit records
- Each record: provider, date of service, source pages, AI summary

### Client Provided Documents
- Documents tab splits into "Client Provided" and "Firm Documents" sections based on document source

### Seed Scripts
- `server/seed-tasks-deadlines.js` — Seeds recurring call tasks and default PI tasks for all existing cases
- `server/seed-communications.js` — Seeds realistic fake client correspondence for all existing cases

### Deadline Calculator
Civil procedure & PI deadlines: SOL calculations (Personal Injury, Med Mal, Wrongful Death, Product Liability), Discovery Response, Summary Judgment Response, Expert Disclosure, Mediation, Motion in Limine, Notice of Appeal, Daubert/Expert Challenge, IME Scheduling

### Document Templates
Placeholder tokens updated for PI: Client Name, Case Type, Injury Type, State, Accident Date, SOL Date, Case Value, Demand Amount, Settlement Amount, Contingency %, Case Manager Name, Paralegal Name
