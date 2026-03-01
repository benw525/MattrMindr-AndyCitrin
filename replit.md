# MattrMindr — Criminal Defense Case Management System

## Overview
A case management system for the Mobile County Public Defender's Office. Tracks criminal defense cases, manages deadlines, assigns tasks, tracks charges and custody/bond status, performs conflict checks, and generates office-wide reports.

## Stack
- **Frontend**: React 19 (Create React App), port 5000
- **Backend**: Node.js + Express 4, port 3001
- **Database**: PostgreSQL (Replit-provisioned), accessed via `DATABASE_URL`
- **Auth**: express-session with bcrypt password hashing; session restore on page refresh via `/api/auth/me`; temporary password emails via SendGrid
- **Email**: SendGrid (Replit integration) for auth emails; SendGrid Inbound Parse for case correspondence
- **Styling**: CSS-in-JS template literal injected at runtime via `<style>` tag

## Running the App
Workflow: `npm start` (root) — runs both Express API and React app via `concurrently`
Login: email + password (existing users default: `1234`, new users get temp password via email)

## Deployment
- **Target**: autoscale
- **Build**: `node server/schema.js && cd lextrack && npm install && CI=false npm run build`
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
  sms.js            — Twilio SMS utility (sendSMS, formatPhoneNumber, isConfigured)
  sms-scheduler.js  — SMS scheduler (generateScheduledMessages, processScheduledMessages, scheduleForNewEvent, cancelForEvent)
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
    contacts.js     — CRUD /api/contacts (soft-delete/restore, 30-day retention), multi-phone CRUD (/phones), manual case linking (/case-links)
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
    batch-cases.js — POST /api/batch-cases (preview + apply batch operations on cases)
    calendar-feeds.js — CRUD /api/calendar-feeds (per-user iCal feed persistence)
    probation.js    — CRUD /api/probation/:caseId/violations (probation violation records)
    sms.js          — SMS routes: configs CRUD, messages, send, draft, suggest-numbers, scheduled, inbound webhook
    collaborate.js  — Collaborate chat: channels, messages, groups, private chats, typing, file upload, search, unread counts
  system-templates/
    case-header.docx      — Court caption block (auto-prepended to Pleadings)
    case-signature.docx   — Attorney signature block (auto-appended to Pleadings)
    certificate-of-service.docx — CoS template (optional, party blocks repeated per served party)
    general-letter.docx   — Reference letter template

lextrack/
  src/
    App.js          — All UI components and business logic
    CollaborateView.js — Internal chat feature: Cases/Groups/Private channels, @mentions, file sharing, typing indicators
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
- **Custody Status Options**: In Custody, Out on Bond, Released on Own Recognizance, Supervision, In Treatment
- **Custody Tracking**: `custody_tracking JSONB` column on cases table (JS: `custodyTracking`). Tracks transitional custody states: Bond Status (bondSet/bondPosted with dates), Release Status (releaseOrdered/releaseCompleted with dates), Transport Status (transportOrdered/transportCompleted with dates + destination). UI section in case detail between Case Info and Experts/Parties. Amber "PENDING" badges on case rows in main/pinned tables when any action is pending (set but not completed). "Pending Custody Actions" report shows all unresolved actions across cases
- **Death Penalty Flag**: `death_penalty BOOLEAN` column on cases table (JS: `deathPenalty`). Toggle in case detail header (next to Confidential), checkbox in New Case modal. Red "DP" badge shown in main/pinned/deleted table rows and AI search results. 5 demo Circuit Court Class A Felony cases seeded with flag enabled
- **Probation Flag & Tab**: `probation BOOLEAN` + `probation_data JSONB` columns on cases table (JS: `probation`, `probationData`). Toggle checkbox in case detail header (next to Death Penalty). When enabled, "Probation" tab appears between Details and Documents. Tab sections: (1) Probation Details — type (State Probation/Community Corrections/Court Referral Office/Unsupervised), officer name/contact, start date + term length (end date auto-calculated), supervising agency; (2) Additional Conditions — chip picker from predefined list + custom entries; (3) Fees & Obligations — total owed; (4) Violations — full CRUD via `case_probation_violations` table, supports violation date, type (Technical/Substantive), description, source, related charges, key dates (preliminary hearing, reconvening + custom label/date pairs), hearing type, attorney (combobox: USERS suggestions + free text for retained counsel), judge (combobox: contacts suggestions + free text, clickable for contact linking), outcome (with partial/full revocation detail fields), sentence, notes. Attorney column is TEXT (not integer). Violation hearing dates auto-sync to case deadlines (prefix `PV#<id>:`) visible in Overview and Calendar. Routes: `server/routes/probation.js`. Deadlines also support DELETE via `server/routes/deadlines.js`

### Charge Tracking
- Multiple charges per case stored as JSONB array
- Each charge: statute, description, class (Class A/B/C Felony, Misdemeanor A/B/C, Violation, Other), original/amended flag, disposition (Guilty Plea, Not Guilty Verdict, Nolle Prosequi, Dismissed, Acquitted, Convicted), disposition date
- Inline editing on Details tab

### AI Agents (server/routes/ai-agents.js)
Nine AI-powered agents using OpenAI (`gpt-4o-mini`) via existing integration. All API calls use `store: false` to prevent data retention and model training:
1. **Charge Analysis** — Analyzes Alabama Code sections, sentencing ranges, mandatory minimums, diversion eligibility. Available in New Case modal (after entering charges) and case detail Overview tab
2. **Deadline Generator** — Generates procedural deadlines based on Alabama Rules of Criminal Procedure and case stage. In case detail deadlines section with "Suggest" button; each suggestion has one-click "Add" to create real deadline records
3. **Case Strategy** — Full defense strategy analysis including motions, plea negotiation, sentencing exposure, investigation priorities. Death penalty cases get capital-specific analysis. "Strategy" button in case detail header; results can be saved as case notes
4. **Document Drafting** — Generates first drafts of motions (suppress, dismiss, bond reduction, continuance, discovery, plea agreement, sentencing memo, speedy trial, plus "Other" for custom document types). Accessible via "AI Draft" tab in Generate Document modal and AI Center
5. **Case Triage** — Ranks active cases by urgency (death penalty, trial dates, custody, overdue tasks). Dashboard widget (add via Customize) and "Triage" button in Cases view topbar. Each result shows urgency score (1-10), reason, and next action
6. **Client Communication Summary** — Plain-language case status update for sharing with clients/families. "Client Summary" button in case detail Overview tab with copy functionality
7. **Document Summary** — Summarizes uploaded case documents (police reports, witness statements, lab reports, etc.) for defense-relevant details. Extracts key facts/timeline, people mentioned, inconsistencies, Miranda/constitutional issues, chain of custody, and bottom-line takeaway. Available in Documents tab of case detail overlay (per-document summarize button) and AI Center (paste text for standalone summarization). Document types: Police Report, Witness Statement, Lab/Forensic Report, Mental Health Evaluation, Prior Record/PSI, Discovery Material, Medical Records, Body Cam/Dash Cam Transcript, Court Order, Plea Agreement, Expert Report, Other
8. **Task Suggestions** — Analyzes case details (charges, stage, custody, deadlines, existing tasks, notes, co-defendants) and suggests 5-8 concrete defense tasks. Each suggestion includes title, priority, assigned role, rationale, and due date. One-click "Add" or "Add All" buttons to create real tasks. Death penalty cases get capital-specific suggestions. Available in case detail Tasks section ("Suggest Tasks" button) and AI Center
9. **Filing Classifier** — Classifies court filings by analyzing extracted PDF text. Returns suggested name, filing party (State, Defendant, Co-Defendant, Court, Other), document type, filing date, and summary. Auto-updates the filing record. Auto-triggered on upload and email-received filings. Available per-filing in Filings tab ("Classify" button) and AI Center (select case → select filing → classify)

10. **Charge Class Lookup** — Given a statute and/or charge description, returns the Alabama charge classification (Class A/B/C Felony, Misdemeanor A/B/C, Violation, Other). Auto-triggers on blur of statute/description fields in both New Case form and case detail Charges accordion. Only fills empty class fields — never overwrites user selections.
11. **Advocate AI (Global)** — Multi-turn conversational AI assistant accessible from every screen via a floating button (bottom-right corner, `position: fixed`, z-index 9998/9999). Supports three modes: (a) **case-specific** — loads full case file as context when opened from case detail or when a case is selected in the panel dropdown, (b) **screen-aware** — sends current screen context (dashboard stats, task summaries, template info, etc.) via `buildScreenContext()`, (c) **combined** — both case data + screen context. Panel UI: slide-up animation, case selector dropdown (with pinned cases section), screen context badge showing current view, per-screen starter chips (e.g. "How do I create a template?" on Templates view), message bubbles with markdown rendering, copy/save-as-note/clear conversation actions. Backend includes `APP_KNOWLEDGE_BASE` constant — a comprehensive guide to all MattrMindr features so the AI can answer "how do I..." questions about the software itself. **Actionable task suggestions** only render when a case is selected (AI appends hidden `<!-- TASKS_JSON [...] -->` with structured tasks; frontend parses and renders task cards with Add/Add All buttons). Death penalty cases get capital-defense-specific instructions. Conversation persists across view navigation but resets when case selection changes or user clears. State lives at App level: `showAdvocateGlobal`, `advocateMessages`, `advocateLoading`, `advocateInput`, `advocateStats`, `advocateTasksAdded`, `advocateCaseId`, `advocateEndRef`, plus caches `contextContactsCache`, `contextTemplatesCache`, `contextTimeManualCache` for screen data. **`buildScreenContext()` enrichment**: every screen sends real data — Dashboard (active cases, overdue tasks, upcoming deadlines with names), Calendar (overdue/this-week/next-week deadlines, court dates, tasks with due dates), Tasks (open/overdue/priority breakdown with case references), Templates (real template list by category with placeholder names, fetched via `apiGetTemplates`), Time Log (builds actual time rows from completed tasks, case notes, correspondence, and manual entries — same logic as `TimeLogView` — with hours-by-case and source breakdown), Reports (overdue task details, upcoming hearings, cases by status/stage/custody), Contacts (real counts by category, pinned contacts, fetched via `apiGetContacts`), Staff (active members by role + caseload per attorney). All field references use camelCase (`caseId`, `completedAt`, etc.) matching server-side transforms. Mobile: panel goes full-screen at <768px. Endpoint: `/api/ai-agents/advocate`.

12. **Batch Case Manager** — Form-based batch operations agent (no AI/LLM usage). Available only to Public Defender, Chief Deputy, Deputy PD, Senior Trial Attorney, IT Specialist, App Admin. AI Center only. Operations: Staff Reassignment (by role field), Bulk Status Change, Bulk Stage Advancement, Bulk Court Date Update, Division Transfer. Features preview step before applying, confirmation dialog, activity logging per case, transactional execution. Backend: `server/routes/batch-cases.js` (`POST /api/batch-cases/preview`, `POST /api/batch-cases`)

All agents accessible via `/api/ai-agents/*` endpoints (except Batch Case Manager at `/api/batch-cases`), require authentication. Frontend API helpers in `api.js`. Reusable `AiPanel` component for consistent UI rendering. Charge Analysis and Deadline Generator endpoints accept `caseId` to auto-load case data server-side.

### Advocate AI Trainer
Two-tier system for customizing how AI agents behave by injecting training context into agent system prompts. Each training entry can target specific agents:
- **Personal Training**: Per-user entries that only affect that user's AI interactions. Available to all staff
- **Office Training**: Office-wide entries that affect all users' AI interactions. Create/edit restricted to: Public Defender, Chief Deputy Public Defender, Deputy Public Defender, Senior Trial Attorney, App Admin
- **Categories**: General, Local Rules, Office Policy, Defense Strategy, Court Preferences, Sentencing, Procedures
- **Source Types**: Text (written instructions) or Document (uploaded PDF/TXT/DOCX — text extracted via pdf-parse/mammoth, with OCR fallback for scanned PDFs)
- **Target Agents**: `target_agents TEXT[]` column on `ai_training` table. Users can select one or more agents (or "All Agents") per training entry via pill/chip multi-select. **Advocate AI always receives ALL training** regardless of targeting (it's the general-purpose agent). Other agents only receive entries tagged with their ID or "all"
- **Active Toggle**: Enable/disable individual entries without deleting them
- **Context Injection**: `getTrainingContext(userId, agentId)` in ai-agents.js loads active entries filtered by agent. When `agentId === 'advocate'`, no agent filter applied (gets everything). For other agents, filters to `WHERE 'all' = ANY(target_agents) OR $agentId = ANY(target_agents)`. Concatenates as `=== CUSTOM TRAINING & GUIDELINES ===` block appended to system prompts, capped at 8000 chars. `aiCall()` accepts 5th parameter `agentId` to pass through
- **Backend**: `server/routes/ai-training.js` — full CRUD + document upload with multer. POST/PUT accept `target_agents` array. Registered in server/index.js
- **Frontend**: Tab in AI Center view ("AI Agents" | "Advocate AI Trainer"), with sub-tabs "My Training" / "Office Training", add modal with text/document modes + target agent multi-select, inline edit with target agent selector, active toggle, delete. Agent badges shown on each entry
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
- **Searchable Dropdowns**: All case and staff selection fields use searchable autocomplete components instead of plain `<select>` elements:
  - `CaseSearchField` — type-ahead case search with pinned cases section, used in: Advocate AI panel, Quick Notes, AI Center, Deadlines, Tasks, Time Log
  - `StaffSearchField` — type-ahead staff search with name/role matching + highlight, used in: New Case modal (5 team fields), EditField `type="user"`, custom team popup, deadlines assigned-to, tasks assigned-to, inline task reassign, reports attorney, TimePromptModal assign credit, CaseNotes assign credit
  - Both components show a selected chip with clear (✕) button, and a dropdown with search results on focus/typing
- **Pinned Cases in Dropdowns**: All case search dropdowns show pinned cases in a "📌 Pinned" section at top, followed by "All Cases" section. Uses `PinnedSectionHeader` component
- **Pinned Cases Storage**: Server-backed via `pinned_cases` JSONB column on `users` table. API: `GET/PUT /api/cases/pinned`. App-level `pinnedCaseIds` state loaded at login, passed as props to all views. `handleTogglePinnedCase` callback at App level
- **Pinned Contacts**: Server-backed via `preferences.pinnedContacts` in user preferences. Pin button on each contact row in Contacts view. Pinned contacts shown in collapsible "Pinned Contacts" card section at top of contacts list (similar to pinned staff in Staff view)
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

### Rules Calculator
- Alabama Rules of Criminal Procedure — 14 rules including: Speedy Trial (ARCrP 8.1), Preliminary Hearing in/out of custody (ARCrP 5.1), Grand Jury Indictment (§15-8-30), Motion to Suppress (ARCrP 15.4), Notice of Alibi/Insanity Defense (ARCrP 16.4/16.3), Discovery Response (ARCrP 16), Motion to Dismiss (ARCrP 13.5), Motion for New Trial (ARCrP 24), Notice of Appeal (ARAP 4(b)(1)), Bond Reduction (ARCrP 7.2(d)), Habeas Corpus (§15-21-1), Youthful Offender (§15-19-1)
- Supports negative-day rules (e.g., "20 days before Trial Date") and zero-day rules (same day)
- Disclaimer references Alabama Rules of Criminal Procedure

### Linked Cases
- `linked_cases` table: links between cases (PD-represented or external)
- Tab appears last in case detail overlay (after Activity)
- Two link modes: (1) PD case — searchable by case number/title/defendant from existing cases; (2) External case — manual entry with case number, style, court, county, charges, attorney, status, notes
- Relationship types: Co-Defendant, Related Charges, Prior Case, Companion Case, Probation Revocation, Appeal, Re-Indictment, Other
- Collapsible cards showing case number, style, charges summary, relationship badge
- Expanded view shows full details; PD cases have "Go to Case" navigation button
- Link/unlink gated behind edit mode
- Routes: `server/routes/linked-cases.js` (GET/POST/DELETE)
- API: `apiGetLinkedCases`, `apiCreateLinkedCase`, `apiDeleteLinkedCase`

### Collaborate (Internal Chat)
- Internal messaging system with three channel types: Cases, Groups, Private
- **Cases tab**: Discuss specific cases; auto-creates channels on first message with all active users as members
- **Groups tab**: Create named groups with selected members for team discussions; creator can edit/delete
- **Private tab**: Direct messages between two users; find-or-create existing conversation
- **Features**: @mention autocomplete with highlighted pills, file/document sharing (base64 upload), typing indicators (3s poll), message search across all channels, unread badges per channel and sidebar total (30s poll), date-grouped messages, responsive mobile layout
- **Database tables**: `chat_channels`, `chat_channel_members`, `chat_messages`, `chat_groups`, `chat_typing`
- **Routes**: `server/routes/collaborate.js` registered at `/api/collaborate`
- **Component**: `lextrack/src/CollaborateView.js`
- **API functions**: `apiGetCollabChannels`, `apiCreateCollabChannel`, `apiDeleteCollabChannel`, `apiGetCollabMessages`, `apiSendCollabMessage`, `apiMarkCollabRead`, `apiSearchCollabMessages`, `apiCreateCollabGroup`, `apiUpdateCollabGroup`, `apiGetCollabGroupMembers`, `apiAddCollabGroupMembers`, `apiRemoveCollabGroupMember`, `apiStartPrivateChat`, `apiGetCollabUnreadCount`, `apiCollabTyping`, `apiGetCollabTyping`, `apiUploadCollabFile`

### Default County/State
- New cases default to county "Mobile" and court "Mobile County"
- New contacts default to county "Mobile"
- Document template state placeholder hardcoded to "Alabama"
- All defaults are editable for exceptions

### Conflict Check
- Automatic on new case creation: triggered when defendant name is entered
- Searches existing cases (defendant names, titles) and contacts for matches
- Displays warning panel with matching cases and contacts before case creation proceeds
- Backend endpoint: GET /api/cases/conflict-check?name=<name>

### Core Features
- Customizable Dashboard: per-user widget system with add/remove/reorder (drag-and-drop); Quick Notes widget for unassigned notes with speech-to-text, later assignable to cases with time tracking; Recent Activity widget clicks navigate to case detail with context-appropriate tab
- Cases view with filtering, sorting, pagination (no "matters" concept — everything is a case)
- Case Detail Overlay: editable criminal defense fields, task/note/link management, activity log, Documents tab (formerly Files — document upload/summary, inline-editable name/type), Correspondence tab, Filings tab (court filing management with AI classification). Details tab layout: top-left = Charges, top-right = Case Info + Offices, below = Co-Defendants, Misc Contacts, Experts. Notes: speech-to-text dictation via Web Speech API (browser-native, no external service)
- Calendar (formerly Deadline Tracker): unified calendar grid with deadlines, tasks (due dates), case court/trial/arraignment/sentencing dates, and imported external iCal feeds. Visibility toggles per event type. Day detail panel groups events by type with clickable case links. Persistent iCal feed storage via `calendar_feeds` DB table (auto-imports on session load). Auto-detects case numbers and defendant names in imported calendar events. List view, add deadline form, iCal manager tab, court rules calculator. Calendar grid is responsive — wraps in a scrollable container at narrow widths via `.cal-grid-wrap` class. iCal feeds are fetched via server-side proxy (`GET /api/calendar-feeds/proxy?url=...`) to avoid CORS issues and 403 errors from court calendar servers (AlaCourt, Outlook 365, etc.)
- Tasks View: filterable task list with inline editing, auto-escalation, recurring tasks
- Reports: pre-built report types with CSV export and print; includes "Cases by Custody Status" and "Pending Custody Actions" reports
- Time Log: unified time tracking view; derives entries from task completions, notes, and correspondence; supports manual time entries
- Staff Directory with admin controls (role/office management, send temp passwords, remove staff)
- Contacts: seeded with 47 contacts (20 prosecutors, 20 judges, 3 courts, 4 jails); categories: Client, Prosecutor, Judge, Court, Witness, Expert, Family Member, Social Worker, Treatment Provider, Miscellaneous; associated cases auto-linked by name matching
- AI Search: Natural language search across all case data via OpenAI gpt-5-mini
- Confidential Cases: access-restricted to assigned team members + App Admin
- Co-Defendants: accordion-style co-defendant management on Details tab (below Charges/Case Info grid). Fields: name (first/middle/last), DOB, case number, charges, attorney, status (Pre-Trial/Pled Out/Convicted/Acquitted/Charges Dismissed/Cooperating Witness/Fugitive), joint/severed (Joint/Severed/Pending Severance Motion), cooperation notes, general notes. Uses `case_parties` table with partyType="Co-Defendant", entityKind="individual", all fields in JSONB `data` column
- Case Experts: accordion-style expert management on Details tab
- Document Generator: unified Generate modal with two modes — "From Template" (upload .docx templates with placeholder auto-detection; template categories: Motions, Orders, Notices, Subpoenas, Client Letters, General) and "AI Draft" (AI-generated first drafts of motions, pleas, memoranda tailored to case details; results can be copied or saved as case notes)
- SMS / Auto Text: Twilio-powered automated text message reminders for clients, witnesses, and family members about hearing dates, court dates, deadlines, and meetings. Per-case SMS configs define recipients (name, phone(s), contact type), notification types (hearings, court dates, deadlines, meetings), and reminder intervals (day of, 1/3/7/14 days before + custom "Other" days). Auto-generates scheduled messages when configs are created or new events are added. SMS scheduler runs every 60s in production (300s in dev) to process pending messages. Correspondence tab split into Emails/Texts sub-tabs with chat-style message display. Send Text compose modal with AI-assisted message drafting via Client Communication agent. **Contact search autofill**: Add Recipient form uses type-ahead contact search across allContacts, case parties, and experts — selecting a contact shows all available phone numbers (phone, cell) as checkboxes for multi-select; contacts with multiple numbers can have all numbers selected. Manual name/phone entry supported as fallback. Twilio credentials via env vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`). Functions in `server/sms.js` are synchronous — `isConfigured()`, `getClient()`, `getFromNumber()` read env vars directly. **Inbound SMS webhook**: `POST /api/sms/inbound` (no auth, Twilio POSTs here) — receives incoming replies, matches sender phone number to case(s) via prior outbound messages or sms_configs, stores as `direction: 'inbound'` in `sms_messages`. Configure Twilio webhook URL to `https://<domain>/api/sms/inbound`. Returns empty TwiML response. Backend: `server/sms.js` (Twilio utility), `server/sms-scheduler.js` (scheduler), `server/routes/sms.js` (CRUD + send + draft + suggest + inbound). DB tables: `sms_configs`, `sms_scheduled`, `sms_messages`. Deadline creation/deletion auto-triggers SMS schedule generation/cancellation via hooks in `server/routes/deadlines.js`
- Settings Popup: Consolidated modal replacing separate sidebar buttons. Contains user profile card (avatar, name, email, roles), Appearance section (dark/light mode toggle), Security section (change password), and Session section (sign out). Opened via "Settings" button in sidebar footer. Styled like Change Password modal with blur backdrop
- Help Center: Multi-tab modal with Tutorials, FAQ, Advocate AI, Change Log, and Contact tabs. Opened via "Help Center" button in sidebar footer. Advocate AI tab provides overview of capabilities (6-card grid) with "Open Advocate AI" button that closes Help Center and opens the Advocate AI panel
  - **Tutorials**: Collapsible accordion sections covering Getting Started, Case Management, Calendar, Tasks, Documents, Correspondence, AI Tools, Contacts, Reports, and Administration
  - **FAQ**: 15+ categorized Q&A accordions (General, Cases, AI Features, Documents, Communication, Calendar) with "Still need help? Ask Advocate AI" footer
  - **Change Log**: Versioned release history starting at v1.0, incrementing by 0.1 per publish. Each version shows date, headline, bullet-point changes with sub-bullets. Most recent version first with "LATEST" badge
  - **Contact**: Support form with auto-filled user info (name, email, role), optional subject, message textarea. Sends email via SendGrid to support@mattrmindr.com. Backend: `POST /api/support` in `server/index.js`
- Email Correspondence: SendGrid Inbound Parse captures emails to case-{id}@mcpd.mattrmindr.com
- Filings: court filing management in dedicated Filings tab. PDF-only upload with auto AI classification (names filing, identifies filing party, extracts filing date, extracts hearing dates → auto-creates deadlines). Inbound email PDF attachments are triaged deterministically: PDFs with "NOTICE OF ELECTRONIC FILING" in the first page (AlaCourt NEF coversheet) → Filings tab; all other PDFs → Documents tab. Scanned/image-based PDFs are OCR'd automatically (tesseract.js + pdftoppm, up to 10 pages). Per-filing actions: view (opens in new browser tab), classify, summarize, delete. Filter by filing party. Source tracking (email vs upload). Color-coded party badges (State=red, Defendant=blue, Co-Defendant=purple, Court=green). Inline editing of filing name, filed by, doc type, filing date (click to edit). Non-PDF email attachments (DOCX, DOC, TXT) auto-create documents in Documents tab with AI doc-type classification. **Hearing Date Auto-Extraction**: Filing classification (email, manual classify) and summarization all extract hearing dates/court dates from the filing text and automatically create deadline entries (type="Hearing") with duplicate detection

### User Preferences (Server-Side)
- `preferences JSONB` column on `users` table — stores all per-user settings server-side for cross-device consistency
- **API**: `GET /api/auth/preferences`, `PUT /api/auth/preferences` (merges incoming keys into existing preferences)
- **Included in auth**: Preferences returned with `/api/auth/login` and `/api/auth/me` responses via `userPayload()`
- **Session Restore**: On page load, `apiMe()` is called to check for an existing session cookie. If valid, user is restored without re-login. Splash screen shown during check
- **Stored preferences**: `darkMode` (boolean), `dashboardLayout` (array of widget IDs), `calendarToggles` (`{ deadlines, tasks, courtDates, external }`), `pinnedStaff` (array of user IDs), `pinnedContacts` (array of contact IDs)
- **Migration**: One-time localStorage→server migration on first login after upgrade — reads old localStorage keys, pushes to server preferences, clears localStorage
- **Dark mode**: Still writes to localStorage as secondary for instant render before session check completes (avoids flash of wrong theme)

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
| contact_phones | Additional phone numbers per contact (label: Cell/Office/Home/etc, number) |
| contact_case_links | Manual case-to-contact links (contact_id, case_id, UNIQUE constraint) |
| case_correspondence | Inbound emails captured via SendGrid |
| doc_templates | Document templates (.docx with placeholders, category, sub_type) |
| case_parties | Per-case co-defendants (partyType="Co-Defendant", entityKind="individual", JSONB data: firstName, middleName, lastName, dob, caseNumber, charges, attorney, status, jointSevered, cooperationNotes, notes) |
| case_experts | Per-case experts with contact card links (JSONB data) |
| case_misc_contacts | Per-case miscellaneous contacts (JSONB data, typed) |
| time_entries | Manual time log entries per user/case |
| case_documents | Uploaded case documents (PDF, DOCX, DOC, TXT) with BYTEA file storage, extracted text, AI summaries |
| case_filings | Court filings (PDF only) with BYTEA storage, extracted text, AI classification (filed_by, doc_type, filing_date), AI summaries. Source tracking (email/upload) |
| ai_training | AI training entries for customizing agent behavior. Fields: user_id, scope (personal/office), category, title, content (text or extracted document text), source_type (text/document), filename, active. Personal entries affect only owner's AI; office entries affect all users |
| calendar_feeds | Per-user iCal feed URLs for the Calendar view. Fields: user_id, name, url, active (boolean). Feeds persist across sessions and auto-import on load |
