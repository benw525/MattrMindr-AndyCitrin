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
- **System Dependencies**: ffmpeg (Nix package, required for audio transcription)
- **Design Packages**: tailwindcss@3.4.19, postcss, autoprefixer, lucide-react (in lextrack/package.json devDependencies)

## Running the App
Workflow: `npm start` (root) — runs both Express API and React app via `concurrently`
Login: email + password (existing users default: `1234`, new users get temp password via email)

## Deployment
- **Target**: autoscale
- **Build**: `node server/schema.js && cd lextrack && npm install && CI=false npm run build && rm -rf node_modules && cd .. && npm prune --production`
- **Run**: `NODE_ENV=production node server/index.js` (serves API + React build on port 5000)

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
    cases.js        — CRUD /api/cases with PI fields, conflict check
    tasks.js        — CRUD /api/tasks (bulk create, complete)
    deadlines.js    — GET/POST/PUT /api/deadlines
    notes.js        — GET/POST/PUT/DELETE /api/notes
    links.js        — GET/POST/DELETE /api/links
    activity.js     — GET/POST /api/activity
    contacts.js     — CRUD /api/contacts (soft-delete/restore)
    insurance.js    — CRUD /api/insurance (case insurance policies)
    medical-treatments.js — CRUD /api/medical-treatments
    liens.js        — CRUD /api/liens
    damages.js      — CRUD /api/damages
    negotiations.js — CRUD /api/negotiations
    expenses.js     — CRUD /api/expenses
    voicemails.js   — CRUD /api/voicemails
    ai-agents.js    — All AI agent endpoints (with AI search enhancement)
    trial-center.js — Trial Center CRUD (with Daubert challenge)
    trial-center-ai.js — Trial Center AI agents (civil PI context)
    custom-reports.js — Custom Report Builder with AI assist
    custom-agents-builder.js — Custom AI Agents with multi-model support
    portal-auth.js  — Client portal auth (login/logout/me/change-password)
    portal-case.js  — Client portal data (case info, messages, documents)
    portal-admin.js — Firm-side portal management (settings, clients, messaging)
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
- **Insurance Policies** (`case_insurance_policies`): Policy type (Liability/UM/UIM/MedPay/PIP/Homeowner/Commercial/Umbrella), carrier, policy number, limits, adjuster details, claim number — displayed under the Details tab
- **Medical Treatments** (`case_medical_treatments`): Provider name/type (ER/Hospital/Orthopedic/Chiropractor/PT/etc.), visit dates, billing totals, treatment status — collapsible cards with medical record upload
- **Medical Records** (`medical_records`): Per-treatment uploaded records with AI-parsed visit entries (provider, date, pages, summary) from PDF uploads
- **Liens** (`case_liens`): Lien type (Medical/Medicare/Medicaid/ERISA/etc.), lienholder, amount, negotiated amount, status — displayed under the Damages tab
- **Damages** (`case_damages`): Category (Medical Bills/Lost Wages/Future Medical/Pain & Suffering/etc.), documentation status
- **Expenses** (`case_expenses`): Category (Filing Fees/Expert Fees/Court Reporter/Medical Records/etc.), amount, date, vendor, status — standalone Expenses tab
- **Negotiations** (`case_negotiations`): Date, direction (Demand/Offer/Counter-Demand/Counter-Offer), amount, from party
- **Voicemails** (`case_voicemails`): Caller name/number, duration, transcript, notes, audio — sub-tab under Correspondence

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

### Custom AI Agents
- Multi-model support: GPT-4o, GPT-4o Mini, Claude 3.5 Sonnet, Gemini 2.0 Flash
- Run mode and Chat mode with case context injection
- Instruction file upload, temperature/max_tokens control
- Context sources: notes, filings, documents, medical_records
- Located under AI Center > Custom Agents tab

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
- Auto-creates tables: transcript_history, custom_reports, custom_agents
- Auto-adds columns: is_voicemail, annotations, content_html, is_video, r2 keys, daubert_challenge

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

### Unified Document Viewer
- In-app overlay (z-index 10001) for viewing documents, filings, and correspondence attachments
- DOCX rendered as HTML (mammoth), XLSX as interactive tables (SheetJS), PPTX as slide cards (jszip)
- PDF (iframe), images (img), text (iframe), audio/video (HTML5)
- Functions: `openAppDocViewer(docId, filename, contentType)`, `openAppFilingViewer(filingId, filename)`, `closeAppDocViewer()`
- Trial Center viewer and Present Mode use same local rendering for all file types

### Auto-Transcription of Audio Email Attachments
- `server/routes/inbound-email.js` detects audio MIME types (MP3/WAV/M4A/OGG/WebM/MP4/AAC/FLAC)
- Creates `case_transcripts` entry with `uploaded_by_name = "Email: {sender}"`
- Calls `processTranscription()` from transcripts.js for background Whisper transcription

### External API with JWT Auth
- `server/middleware/external-auth.js`: JWT generation (24h expiry) using `EXTERNAL_JWT_SECRET` or `SESSION_SECRET`
- `server/routes/external.js`: Login, verify, cases list, case detail, jury analysis import
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
- Insurance Policies section is inside the Details tab (below Experts)
- Liens section is inside the Damages tab (below Damages list)
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
