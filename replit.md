# MattrMindr — Case Management System

## Overview
A legal practice management app for Webster Henry law firm. Tracks civil litigation cases and matters, manages deadlines, assigns tasks, and generates firm-wide reports.

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
- **Build**: `cd lextrack && npm run build`
- **Run**: `NODE_ENV=production node server/index.js` (serves API + React build on port 5000)
- In production: Express serves static React build, secure cookies enabled, trust proxy set

## Project Structure
```
server/
  index.js          — Express entry point, session middleware, CORS, prod static serving
  db.js             — pg Pool configured from DATABASE_URL
  schema.js         — Creates all DB tables (run once)
  seed.js           — Seeds USERS, CASES, DEADLINES from firmData.js
  email.js          — SendGrid email utility (temp passwords, password resets)
  middleware/
    auth.js         — requireAuth middleware
  routes/
    auth.js         — login, logout, me, change-password, forgot-password, reset-password, send-temp-password
    cases.js        — CRUD /api/cases
    tasks.js        — CRUD /api/tasks (bulk create, complete)
    deadlines.js    — GET/POST/PUT /api/deadlines (key dates auto-sync to deadlines)
    notes.js        — GET/POST/DELETE /api/notes
    links.js        — GET/POST/DELETE /api/links
    activity.js     — GET /api/activity (recent across all cases), GET/POST /api/activity/:caseId
    contacts.js     — CRUD /api/contacts (soft-delete/restore, 30-day retention)
    contact-notes.js — GET/POST/DELETE /api/contact-notes
    contact-staff.js — CRUD /api/contact-staff (staff under attorney/court contacts)
    ai-search.js    — POST /api/ai-search (OpenAI gpt-5-mini semantic case search)
    correspondence.js — GET/DELETE /api/correspondence (per-case email history)
    inbound-email.js — POST /api/inbound-email (SendGrid Inbound Parse webhook, no auth)
    templates.js    — CRUD /api/templates, document generation with docxtemplater, pleading assembly
    parties.js      — CRUD /api/parties (case parties: individuals & corporations)
    insurance.js    — CRUD /api/insurance (case insurance policies with coverage tracking)
    experts.js      — CRUD /api/experts (case experts with contact card integration)
    time-entries.js — CRUD /api/time-entries (manual time log entries per user/case)
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
- Customizable Dashboard: per-user widget system with add/remove/reorder via Customize modal; widgets: stat cards (Active Records, Upcoming Deadlines, My Open Tasks, Trials in 90 Days), Upcoming Deadlines list, Trials Within 90 Days, My Tasks, Pinned Cases, Recent Activity, Overdue Tasks, My Time (period toggle: Day/Week/Month/Quarter/Year); layout stored in `localStorage` as `dashboard_layout_${userId}`; widget registry in `DASHBOARD_WIDGETS` array; grid grouping: adjacent quarter-sized → grid4, adjacent half-sized → grid2, full → own row
- Cases & Matters view with filtering, sorting, pagination
- Case Detail Overlay: editable fields (plaintiff, defendant, opposing counsel, short case number, county, court, etc.), task/note/link management, activity log, correspondence tab
- Deadline Tracker: calendar grid, list view, iCal feed import, court rules calculator
- Tasks View: filterable task list with inline editing, auto-escalation, recurring tasks
- Reports: 10 pre-built report types with CSV export and print
- Time Log: unified time tracking view; derives entries from task completions, notes, and correspondence; supports manual time entries via `time_entries` table; inline editing for Detail and Time cells (auto-save on blur); Add Entry modal with smart case selector ("Touched Today" grouping, "My Office"/"My Matters" quick filters); CSV export includes all entry types; persistent entries — manual entries store `case_title`/`file_num` at creation time so deleted cases still display correctly; derived entries use `?includeDeleted=true` cases lookup
- Staff Directory with admin controls (role/office management, send temp passwords, remove staff)
- Contacts: auto-populated contacts (Clients, Attorneys, Courts + manual Experts/Miscellaneous), with phone/email/fax/address, associated cases, persistent notes, and soft-delete with 30-day recovery. Category-specific fields: Attorney→Firm, Adjuster/Expert→Company, Court→County. Attorney and Court contacts support Staff accordion (debounced auto-save, accordion UI like case parties). Attorney staff types: Legal Assistant, Paralegal, Receptionist, Other. Court staff types: Judicial Assistant, Clerk, Court Reporter, Bailiff, Other. Staff fields: name (single), phone, email.
- AI Search: Natural language search across all case data via OpenAI gpt-5-mini
- Confidential Cases: access-restricted to assigned team members + App Admin
- Case Parties: accordion-style party management on Details tab; Individual (name/address/phones/other contacts/email/represented-by/notes) and Corporation (entity name/type/registered agent/POC/notes) types; any party type selectable; "Our Client" flag (exclusive — only one party at a time) and "Pro Se" flag (hides Represented By); integrated with document generator placeholders
- Medical Summary: per-party medical treatment tracking tab (between Details and Billing Summary); parties added from Details tab party list; per-entry fields: provider (shared datalist with Billing Summary providers), date of service, collapsible summary textarea; DOB field shared across Details/Medical/Billing tabs; per-party filtering by provider and date range; per-party print view (MedicalPrintView component); autosaved with case data
- Case Experts: accordion-style expert management on Details tab (right column); Types: Treating Physician, Retained, Rebuttal; auto-links to Expert contact cards by name (creates new if not found); syncs phone/email/fax/address/company to contact card; case-specific fields: assigned party, testimony type (Deposition/Live/Both), notes
- Document Generator: upload .docx templates with `<<PLACEHOLDER>>` auto-detection + manual text highlighting; template categories (Pleadings/Letters/Subpoenas/Reports/General); Letter sub-types (Client/Insurance/Attorney/Other) with smart addressee auto-fill; smart placeholder suggestions at generation time (rule-based keyword matching from case/party/insurance data); empty placeholders produce `<<NAME>>` in output; Pleading templates auto-include Case Header (caption block), Signature Block, and optional Certificate of Service; system templates stored in `server/system-templates/`; CoS repeats served-party attorney blocks for each non-client party (looks up attorney contacts via representedBy field, handles Pro Se parties); pleading section detection: when uploading a Pleadings template, the system scans the .docx for existing header/caption, signature block, and CoS sections — if detected, user chooses per-section whether to use the system-provided version or keep the document's own (stored as `use_system_header`, `use_system_signature`, `use_system_cos` on `doc_templates`); visibility (global/personal); full re-edit of placeholders restricted to creator + Shareholders; backward compatible with old mapped templates
- Email Correspondence: SendGrid Inbound Parse captures emails to case-{id}@mail.mattrmindr.com
- Authentication: bcrypt passwords, temp password emails, forgot/reset password flow, forced password change on first login

## Auth System
- Passwords stored as bcrypt hashes in `password_hash` column
- Password requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special character (enforced on backend + frontend)
- `must_change_password` flag forces password change after temp password login
- `temp_password` column stores plaintext temp passwords (cleared after use)
- Admin (App Admin role) can send temp passwords to any user via Staff Directory
- Forgot Password: sends reset code via email, valid for 1 hour
- New users automatically receive temp password email on creation
- Users can change their own password from the sidebar
- Deleted/deactivated users cannot log in; active sessions are invalidated via auth middleware
- User soft-delete: `deleted_at` column on users table; App Admin can deactivate and restore staff
- Only App Admin can create or delete users; only App Admin can view deactivated staff list

## Architecture Notes
- **DB migration path**: All DB access via REST API — swap `DATABASE_URL` to point to Supabase, swap `express-session` for JWT, done.
- **Standard SQL only**: No Replit-specific extensions — schema is portable.
- **Task chains**: Completing certain tasks auto-generates follow-up tasks (`TASK_CHAINS`, `DUAL_CHAINS`) — business logic stays client-side for now.
- **Auto-escalation**: Task priority rises automatically as due date approaches. Thresholds are customizable per-task (default: Medium ≤30d, High ≤14d, Urgent ≤7d). Stored in `escalate_medium_days`, `escalate_high_days`, `escalate_urgent_days` columns.
- **Activity logging**: Tracked per-case via `/api/activity`.

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
| cases | All cases/matters with full field set |
| tasks | User-created tasks per case |
| deadlines | Court/filing deadlines |
| case_notes | Per-case notes |
| case_links | Per-case document links |
| case_activity | Per-case activity log |
| contacts | Clients, attorneys, courts, experts (+ firm/company/county fields) |
| contact_notes | Per-contact notes |
| contact_staff | Staff members under attorney/court contacts (JSONB data) |
| case_correspondence | Inbound emails captured via SendGrid |
| doc_templates | Document templates (.docx with placeholders, category, sub_type) |
| case_parties | Per-case parties (individuals & corporations, JSONB data) |
| case_insurance | Per-case insurance policies with coverage tracking (JSONB data) |
| case_experts | Per-case experts with contact card links (JSONB data) |
| time_entries | Manual time log entries per user/case |
