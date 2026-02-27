# MattrMindr — Criminal Defense Case Management System

## Overview
A case management system for the Mobile County Public Defender's Office. Tracks criminal defense cases, manages deadlines, assigns tasks, tracks charges and custody/bond status, performs conflict checks, and generates office-wide reports.

## Stack
- **Frontend**: React 19 (Create React App), port 5000
- **Backend**: Node.js + Express 4, port 3001
- **Database**: PostgreSQL (Replit-provisioned), accessed via `DATABASE_URL`
- **Auth**: express-session with bcrypt password hashing; temporary password emails via SendGrid
- **Email**: SendGrid (Replit integration) for auth emails; SendGrid Inbound Parse for case correspondence
- **Styling**: CSS-in-JS template literal injected at runtime via `<style>` tag

## Running the App
Workflow: `npm start` (root) — runs both Express API and React app via `concurrently`
Login: email + password (existing users default: `1234`, new users get temp password via email)

## Deployment
- **Target**: autoscale
- **Build**: `node server/schema.js && cd lextrack && npm install && npm run build`
  - Schema runs on every deploy (idempotent: CREATE IF NOT EXISTS) to ensure new tables are created
  - Seed step removed — production database already has all data; seed.js is only for initial setup
  - Production has a **separate PostgreSQL database** from development
- **Run**: `NODE_ENV=production node server/index.js` (serves API + React build on port 5000)
- In production: Express serves static React build, secure cookies enabled, trust proxy set
- Health check (`/api/health`) verifies database connectivity
- Startup logs database user count for deployment verification

## Project Structure
```
server/
  index.js          — Express entry point, session middleware, CORS, prod static serving
  db.js             — pg Pool configured from DATABASE_URL
  schema.js         — Creates all DB tables (run once)
  seed.js           — Seeds USERS from firmData.js + imports all table data from seed-data.json
  export-data.js    — Exports dev DB table data to seed-data.json (run manually to refresh)
  seed-data.json    — Exported table data (cases, tasks, deadlines, notes, etc.) for production seeding
  email.js          — SendGrid email utility (temp passwords, password resets)
  utils/
    extract-text.js — Text extraction from PDF/DOCX/TXT with OCR fallback (tesseract.js + pdftoppm) for scanned PDFs
  middleware/
    auth.js         — requireAuth middleware
  routes/
    auth.js         — login, logout, me, change-password, forgot-password, reset-password, send-temp-password
    cases.js        — CRUD /api/cases, GET /api/cases/conflict-check
    tasks.js        — CRUD /api/tasks (bulk create, complete)
    deadlines.js    — GET/POST/PUT /api/deadlines (key dates auto-sync to deadlines)
    notes.js        — GET/POST/PUT/DELETE /api/notes; GET /api/notes/quick (user's unassigned quick notes)
    links.js        — GET/POST/DELETE /api/links
    activity.js     — GET /api/activity (recent across all cases), GET/POST /api/activity/:caseId
    contacts.js     — CRUD /api/contacts (soft-delete/restore, 30-day retention)
    contact-notes.js — GET/POST/DELETE /api/contact-notes
    contact-staff.js — CRUD /api/contact-staff (staff under attorney/court contacts)
    ai-search.js    — POST /api/ai-search (OpenAI gpt-5-mini semantic case search)
    case-documents.js — Upload/list/summarize/download/delete case documents (PDF, DOCX, DOC, TXT)
    correspondence.js — GET/DELETE /api/correspondence (per-case email history)
    inbound-email.js — POST /api/inbound-email (SendGrid Inbound Parse webhook, no auth)
    templates.js    — CRUD /api/templates, document generation with docxtemplater, pleading assembly
    parties.js      — CRUD /api/parties (case parties: individuals & corporations)
    experts.js      — CRUD /api/experts (case experts with contact card integration)
    misc-contacts.js — CRUD /api/misc-contacts (case miscellaneous contacts)
    time-entries.js — CRUD /api/time-entries (manual time log entries per user/case)
    ai-training.js — CRUD /api/ai-training + document upload (AI Agent Trainer entries)
  system-templates/
    case-header.docx      — Court caption block (auto-prepended to Pleadings)
    case-signature.docx   — Attorney signature block (auto-appended to Pleadings)
    certificate-of-service.docx — CoS template (optional, party blocks repeated per served party)
    general-letter.docx   — Reference letter template

lextrack/
  src/
    App.js          — All UI components and business logic
    api.js          — Thin fetch wrapper for all API calls
    firmData.js     — Static reference data: USERS display info (avatars, names)
    App.css         — Base reset styles
    index.js        — React entry point
  package.json      — proxy: http://localhost:3001
```

## Key Features

### Case Management
- **Case Types**: Felony, Misdemeanor, Juvenile, Probation Violation, Mental Health/Commitment, Appeal, Other
- **Case Stages**: Arraignment, Preliminary Hearing, Grand Jury/Indictment, Pre-Trial Motions, Plea Negotiations, Trial, Sentencing, Post-Conviction, Appeal
- **Case Statuses**: Active, Closed, Pending, Disposed, Transferred
- **Criminal-Specific Fields**: Defendant name, prosecutor, charge description/statute/class, court division (Circuit/District/Juvenile), custody status, bond amount/conditions, jail location, arrest/arraignment/next court/trial/sentencing/disposition dates, investigator, social worker
- **Death Penalty Flag**: `death_penalty BOOLEAN` column on cases table (JS: `deathPenalty`). Toggle in case detail header (next to Confidential), checkbox in New Case modal. Red "DP" badge shown in main/pinned/deleted table rows and AI search results. 5 demo Circuit Court Class A Felony cases seeded with flag enabled

### Charge Tracking
- Multiple charges per case stored as JSONB array
- Each charge: statute, description, class (Class A/B/C Felony, Misdemeanor A/B/C, Violation, Other), original/amended flag, disposition (Guilty Plea, Not Guilty Verdict, Nolle Prosequi, Dismissed, Acquitted, Convicted), disposition date
- Inline editing on Details tab

### AI Agents (server/routes/ai-agents.js)
Nine AI-powered agents using OpenAI (`gpt-4o-mini`) via existing integration. All API calls use `store: false` to prevent data retention and model training:
1. **Charge Analysis** — Analyzes Alabama Code sections, sentencing ranges, mandatory minimums, diversion eligibility. Available in New Case modal (after entering charges) and case detail Overview tab
2. **Deadline Generator** — Generates procedural deadlines based on Alabama Rules of Criminal Procedure and case stage. In case detail deadlines section with "Suggest" button; each suggestion has one-click "Add" to create real deadline records
3. **Case Strategy** — Full defense strategy analysis including motions, plea negotiation, sentencing exposure, investigation priorities. Death penalty cases get capital-specific analysis. "Strategy" button in case detail header; results can be saved as case notes
4. **Document Drafting** — Generates first drafts of motions (suppress, dismiss, bond reduction, continuance, discovery, plea agreement, sentencing memo, speedy trial). Accessible via "AI Draft" tab in Generate Document modal
5. **Case Triage** — Ranks active cases by urgency (death penalty, trial dates, custody, overdue tasks). Dashboard widget (add via Customize) and "Triage" button in Cases view topbar. Each result shows urgency score (1-10), reason, and next action
6. **Client Communication Summary** — Plain-language case status update for sharing with clients/families. "Client Summary" button in case detail Overview tab with copy functionality
7. **Document Summary** — Summarizes uploaded case documents (police reports, witness statements, lab reports, etc.) for defense-relevant details. Extracts key facts/timeline, people mentioned, inconsistencies, Miranda/constitutional issues, chain of custody, and bottom-line takeaway. Available in Documents tab of case detail overlay (per-document summarize button) and AI Center (paste text for standalone summarization). Document types: Police Report, Witness Statement, Lab/Forensic Report, Mental Health Evaluation, Prior Record/PSI, Discovery Material, Medical Records, Body Cam/Dash Cam Transcript, Court Order, Plea Agreement, Expert Report, Other
8. **Task Suggestions** — Analyzes case details (charges, stage, custody, deadlines, existing tasks, notes, co-defendants) and suggests 5-8 concrete defense tasks. Each suggestion includes title, priority, assigned role, rationale, and due date. One-click "Add" or "Add All" buttons to create real tasks. Death penalty cases get capital-specific suggestions. Available in case detail Tasks section ("Suggest Tasks" button) and AI Center
9. **Filing Classifier** — Classifies court filings by analyzing extracted PDF text. Returns suggested name, filing party (State, Defendant, Co-Defendant, Court, Other), document type, filing date, and summary. Auto-updates the filing record. Auto-triggered on upload and email-received filings. Available per-filing in Filings tab ("Classify" button) and AI Center (select case → select filing → classify)

10. **Charge Class Lookup** — Given a statute and/or charge description, returns the Alabama charge classification (Class A/B/C Felony, Misdemeanor A/B/C, Violation, Other). Auto-triggers on blur of statute/description fields in both New Case form and case detail Charges accordion. Only fills empty class fields — never overwrites user selections.
11. **Advocate AI** — Multi-turn conversational AI assistant for case-specific advice. Loads the entire case file as context (case details, all notes, tasks, deadlines, co-defendants/parties, document summaries, filing summaries, email correspondence). Accessible via "🤖 Advocate AI" button in case detail overlay header. Features: starter prompt chips for quick onboarding, chat-style message bubbles with markdown rendering, copy individual AI responses, save full conversation as case note (type "AI Consultation"), context indicator showing loaded data counts, auto-scroll, typing indicator, **actionable task suggestions** (AI appends hidden `<!-- TASKS_JSON [...] -->` with structured tasks; frontend parses and renders task cards with Add/Add All buttons, role-based assignment recommendations, priority badges, due date estimates; tasks created via apiCreateTask with isGenerated:true). Death penalty cases get capital-defense-specific instructions. Token management: progressive truncation for large cases (emails first, then notes, then document summaries). Conversation resets on modal close (no persistence). Endpoint: `/api/ai-agents/advocate`.

All agents accessible via `/api/ai-agents/*` endpoints, require authentication. Frontend API helpers in `api.js`. Reusable `AiPanel` component for consistent UI rendering. Charge Analysis and Deadline Generator endpoints accept `caseId` to auto-load case data server-side.

### AI Agent Trainer
Two-tier system for customizing how all AI agents behave by injecting training context into every agent's system prompt:
- **Personal Training**: Per-user entries that only affect that user's AI interactions. Available to all staff
- **Office Training**: Office-wide entries that affect all users' AI interactions. Create/edit restricted to: Public Defender, Chief Deputy Public Defender, Deputy Public Defender, Senior Trial Attorney, App Admin
- **Categories**: General, Local Rules, Office Policy, Defense Strategy, Court Preferences, Sentencing, Procedures
- **Source Types**: Text (written instructions) or Document (uploaded PDF/TXT/DOCX — text extracted via pdf-parse/mammoth, with OCR fallback for scanned PDFs)
- **Active Toggle**: Enable/disable individual entries without deleting them
- **Context Injection**: `getTrainingContext(userId)` in ai-agents.js loads all active entries (personal for user + all office entries), concatenates them as `=== CUSTOM TRAINING & GUIDELINES ===` block appended to system prompts, capped at 8000 chars
- **Backend**: `server/routes/ai-training.js` — full CRUD + document upload with multer. Registered in server/index.js
- **Frontend**: Tab in AI Center view ("AI Agents" | "AI Trainer"), with sub-tabs "My Training" / "Office Training", add modal with text/document modes, inline edit, active toggle, delete
- **API helpers**: `apiGetTraining`, `apiCreateTraining`, `apiUploadTrainingDoc`, `apiUpdateTraining`, `apiDeleteTraining` in api.js

### AI Center
- Centralized view in sidebar (under Reports) that provides access to all 11 AI agents from one place
- Agent cards in a responsive grid; selecting one opens the agent panel with case selector (for agents that need a case)
- Case Triage runs without case selection; all others require choosing a case first
- Document Drafting includes document type selector and optional instructions field
- Results rendered via shared `AiPanel` component with copy functionality

### Mobile Responsiveness
- **Breakpoints**: 768px (tablet/mobile) and 480px (small mobile)
- **Sidebar**: Collapsible on mobile — hidden by default with slide-in animation via `.sidebar.open` class. Hamburger button (☰) visible in every view's topbar via `.hamburger-btn` (hidden on desktop). Backdrop overlay closes sidebar on tap. All nav items auto-close sidebar on click
- **Hamburger prop**: Each view component receives `onMenuToggle` prop for the hamburger button
- **Grids**: `.grid4` → 2 columns at 768px, 1 column at 480px. `.grid2` and `.form-row` → 1 column at 768px
- **Modals**: `.modal` class uses `width: calc(100vw - 24px) !important; max-width: 620px` at 768px. All inline-width modals have `maxWidth: "calc(100vw - 24px)"` fallback. Modal inner grids auto-collapse via `[style*="grid-template-columns"]` selector
- **Case Overlay**: Full-width (`left: 0`) on mobile; header wraps, tabs scroll horizontally (no visible scrollbar), body padding reduced. All inner grids auto-collapse to single column via CSS attribute selector. `.mobile-grid-1` class on major section grids (details+dates, deadlines/tasks/notes, charges+info, experts/parties). `.case-overlay-panel` forced full-width on mobile
- **Tables → Card Layout**: `table.mobile-cards` class converts tables to stacked card layout at 768px — thead hidden, each td becomes a flex row with `::before` label from `data-label` attribute. Applied to: Cases table, pinned/deleted cases, Deadlines, Tasks, Reports, TimeLog, Contacts (active + deleted). `td[data-label=""]::before` hidden for action columns. `td.mobile-hide` hides low-priority columns
- **Pinned Cases on Mobile**: `.pinned-card-mobile` class removes card border/shadow/background on mobile so pinned row cards don't double-nest inside the wrapper card. Rows get a gold left-border accent (`border-left: 3px solid #B67A18`) for visual distinction
- **Pinned Cases in Dropdowns**: All case search dropdowns (Tasks, AI Center, Quick Notes, Deadlines, Time Log) show pinned cases in a "📌 Pinned" section at top, followed by "All Cases" section. Uses `PinnedSectionHeader` component
- **Pinned Cases Storage**: Server-backed via `pinned_cases` JSONB column on `users` table. API: `GET/PUT /api/cases/pinned`. App-level `pinnedCaseIds` state loaded at login, passed as props to all views. `handleTogglePinnedCase` callback at App level. One-time localStorage→DB migration on first login (reads `pinned_cases_{userId}`, uploads to API, removes localStorage key)
- **Touch targets**: Buttons `min-height: 44px`, btn-sm `min-height: 38px`, inputs/selects `min-height: 44px` with `font-size: 16px` (prevents iOS zoom). Checkboxes 22x22px. Page buttons 38x38px. Nav items 44px min-height. Toggle switches enlarged
- **Login box**: Responsive with max-width constraint
- **Detail panel** (`.detail-panel`): Full-width on mobile
- **Contact Detail Overlay**: `.case-overlay-panel` with `.mobile-full` — full viewport width on mobile
- **Day Detail Panel**: `.mobile-full` class — full width on mobile, calendar layout wraps
- **Team Popup**: `.mobile-full` class with margin — responds to narrow screens
- **Staff Grid**: Uses `minmax(min(290px,100%),1fr)` to prevent overflow on small screens
- **AI Center/Reports Grid**: Uses `minmax(min(260px/200px,100%),1fr)` for safe mobile rendering
- **Edit fields**: Stack label/value vertically at 480px via `flex-wrap: wrap`
- **Utility classes**: `.mobile-grid-1` (force single column), `.mobile-full` (force full width), `.hide-mobile` / `.show-mobile` (visibility toggles)

### Conflict Check
- Automatic on new case creation: triggered when defendant name is entered
- Searches existing cases (defendant names, titles) and contacts for matches
- Displays warning panel with matching cases and contacts before case creation proceeds
- Backend endpoint: GET /api/cases/conflict-check?name=<name>

### Core Features
- Customizable Dashboard: per-user widget system with add/remove/reorder; Quick Notes widget for unassigned notes with speech-to-text, later assignable to cases with time tracking
- Cases view with filtering, sorting, pagination (no "matters" concept — everything is a case)
- Case Detail Overlay: editable criminal defense fields, task/note/link management, activity log, Documents tab (formerly Files — document upload/summary, inline-editable name/type), Correspondence tab, Filings tab (court filing management with AI classification). Details tab layout: top-left = Charges, top-right = Case Info + Offices, below = Co-Defendants, Misc Contacts, Experts. Notes: speech-to-text dictation via Web Speech API (browser-native, no external service)
- Deadline Tracker: calendar grid, list view, iCal feed import, court rules calculator
- Tasks View: filterable task list with inline editing, auto-escalation, recurring tasks
- Reports: pre-built report types with CSV export and print
- Time Log: unified time tracking view; derives entries from task completions, notes, and correspondence; supports manual time entries
- Staff Directory with admin controls (role/office management, send temp passwords, remove staff)
- Contacts: seeded with 47 contacts (20 prosecutors, 20 judges, 3 courts, 4 jails); categories: Client, Prosecutor, Judge, Court, Witness, Expert, Family Member, Social Worker, Treatment Provider, Miscellaneous; associated cases auto-linked by name matching
- AI Search: Natural language search across all case data via OpenAI gpt-5-mini
- Confidential Cases: access-restricted to assigned team members + App Admin
- Co-Defendants: accordion-style co-defendant management on Details tab (below Charges/Case Info grid). Fields: name (first/middle/last), DOB, case number, charges, attorney, status (Pre-Trial/Pled Out/Convicted/Acquitted/Charges Dismissed/Cooperating Witness/Fugitive), joint/severed (Joint/Severed/Pending Severance Motion), cooperation notes, general notes. Uses `case_parties` table with partyType="Co-Defendant", entityKind="individual", all fields in JSONB `data` column
- Case Experts: accordion-style expert management on Details tab
- Document Generator: unified Generate modal with two modes — "From Template" (upload .docx templates with placeholder auto-detection; template categories: Motions, Orders, Notices, Subpoenas, Client Letters, General) and "AI Draft" (AI-generated first drafts of motions, pleas, memoranda tailored to case details; results can be copied or saved as case notes)
- Email Correspondence: SendGrid Inbound Parse captures emails to case-{id}@mcpd.mattrmindr.com
- Filings: court filing management in dedicated Filings tab. PDF-only upload with auto AI classification (names filing, identifies filing party, extracts filing date, extracts hearing dates → auto-creates deadlines). Inbound email PDF attachments are triaged deterministically: PDFs with "NOTICE OF ELECTRONIC FILING" in the first page (AlaCourt NEF coversheet) → Filings tab; all other PDFs → Documents tab. Scanned/image-based PDFs are OCR'd automatically (tesseract.js + pdftoppm, up to 10 pages). Per-filing actions: view (opens in new browser tab), classify, summarize, delete. Filter by filing party. Source tracking (email vs upload). Color-coded party badges (State=red, Defendant=blue, Co-Defendant=purple, Court=green). Inline editing of filing name, filed by, doc type, filing date (click to edit). Non-PDF email attachments (DOCX, DOC, TXT) auto-create documents in Documents tab with AI doc-type classification. **Hearing Date Auto-Extraction**: Filing classification (email, manual classify) and summarization all extract hearing dates/court dates from the filing text and automatically create deadline entries (type="Hearing") with duplicate detection

### Removed Features (from civil version)
- Insurance tracking (removed entirely)
- Billing Summary (removed)
- Medical Summary (removed)
- Case Expenses (removed)
- Multi-office filtering (replaced with Court Division filtering: Circuit, District, Juvenile)

## Staff Roles
- Public Defender
- Chief Deputy Public Defender
- Deputy Public Defender
- Senior Trial Attorney
- Trial Attorney
- Office Administrator
- Administrative Assistant
- IT Specialist
- Trial Coordinator Supervisor
- Trial Coordinator
- Chief Social Worker
- Social Worker
- Client Advocate
- Investigator
- Paralegal
- App Admin

## User Data
- 61 staff members seeded from the actual Mobile County Public Defender's Office team roster
- Users stored in `lextrack/src/firmData.js` and seeded to DB via `server/seed.js`
- Default password for all seeded users: `1234`
- All users assigned to "Mobile" office

## Team Assignment Fields
- Assigned Attorney (replaces leadAttorney)
- 2nd Attorney
- Trial Coordinator
- Investigator
- Social Worker

## Auth System
- Passwords stored as bcrypt hashes in `password_hash` column
- Password requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special character
- `must_change_password` flag forces password change after temp password login
- Admin (App Admin role) can send temp passwords to any user via Staff Directory
- Forgot Password: sends reset code via email, valid for 1 hour
- New users automatically receive temp password email on creation
- Access control: `requirePD` middleware (Public Defender, Chief Deputy, or Deputy Public Defender required for admin actions)

## Architecture Notes
- **DB migration path**: All DB access via REST API — swap `DATABASE_URL` to point to Supabase, swap `express-session` for JWT, done.
- **Standard SQL only**: No Replit-specific extensions — schema is portable.
- **Task chains**: Completing certain tasks auto-generates follow-up tasks — business logic stays client-side.
- **Auto-escalation**: Task priority rises automatically as due date approaches.
- **Activity logging**: Tracked per-case via `/api/activity`.

## Contact Categories
Client, Prosecutor, Judge, Court, Witness, Expert, Family Member, Social Worker, Treatment Provider

## Note Types
General, Attorney Note, Client Contact, Court / Hearing, Investigation, Plea Discussion, Witness Interview, Social Work, Internal

## Link Categories
General, Motions, Discovery, Police Reports, Photographs, Expert Reports, Court Orders, Plea Agreements, Sentencing, Other

## Color Palette
| Token | Light | Dark |
|-------|-------|------|
| App Background | `#F7F8FA` | `#0E1116` |
| Sidebar Background | `#EDEFF2` | `#12161C` |
| Sidebar Active | `#DDE3EA` | `#1A212B` |
| Card Background | `#FFFFFF` | `#161B22` |
| Elevated Panel / Hover | `#E4E7EB` | `#1C2330` |
| Primary Brand | `#1E2A3A` | `#1E2A3A` |
| Brand Hover | `#2A3A4F` | `#4F7393` |
| Primary Text | `#1F2428` | `#E6EDF3` |
| Secondary Text | `#5D6268` | `#9DA7B3` |
| Muted Text | `#8A9096` | `#6E7681` |
| Border | `#D6D8DB` | `#27313D` |
| Accent (links) | `#4F7393` | `#4F7393` |
| Success | `#2F7A5F` | `#2F7A5F` |
| Warning | `#B67A18` | `#B67A18` |
| Error | `#B24A4A` | `#B24A4A` |

## Database Tables
| Table | Purpose |
|-------|---------|
| users | Staff members with auth fields |
| cases | All cases with criminal defense fields (defendant_name, prosecutor, charge_description, charge_statute, charge_class, case_type, custody_status, bond_amount, bond_conditions, jail_location, court_division, arrest/arraignment/next_court/sentencing/disposition dates, charges JSONB, investigator, social_worker) |
| tasks | User-created tasks per case |
| deadlines | Court/filing deadlines |
| case_notes | Per-case notes |
| case_links | Per-case document links |
| case_activity | Per-case activity log |
| contacts | Prosecutors, judges, courts, witnesses, experts, family members, etc. |
| contact_notes | Per-contact notes |
| contact_staff | Staff members under attorney/court contacts (JSONB data) |
| case_correspondence | Inbound emails captured via SendGrid |
| doc_templates | Document templates (.docx with placeholders, category, sub_type) |
| case_parties | Per-case co-defendants (partyType="Co-Defendant", entityKind="individual", JSONB data: firstName, middleName, lastName, dob, caseNumber, charges, attorney, status, jointSevered, cooperationNotes, notes) |
| case_experts | Per-case experts with contact card links (JSONB data) |
| case_misc_contacts | Per-case miscellaneous contacts (JSONB data, typed) |
| time_entries | Manual time log entries per user/case |
| case_documents | Uploaded case documents (PDF, DOCX, DOC, TXT) with BYTEA file storage, extracted text, AI summaries |
| case_filings | Court filings (PDF only) with BYTEA storage, extracted text, AI classification (filed_by, doc_type, filing_date), AI summaries. Source tracking (email/upload) |
| ai_training | AI training entries for customizing agent behavior. Fields: user_id, scope (personal/office), category, title, content (text or extracted document text), source_type (text/document), filename, active. Personal entries affect only owner's AI; office entries affect all users |
