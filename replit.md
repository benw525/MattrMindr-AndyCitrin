# MattrMindr — Criminal Defense Case Management System

## Overview
A case management system for the Mobile County Public Defender's Office. Tracks criminal defense cases and matters, manages deadlines, assigns tasks, tracks charges and custody/bond status, performs conflict checks, and generates office-wide reports.

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
  seed.js           — Seeds USERS from firmData.js
  email.js          — SendGrid email utility (temp passwords, password resets)
  middleware/
    auth.js         — requireAuth middleware
  routes/
    auth.js         — login, logout, me, change-password, forgot-password, reset-password, send-temp-password
    cases.js        — CRUD /api/cases, GET /api/cases/conflict-check
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
    experts.js      — CRUD /api/experts (case experts with contact card integration)
    misc-contacts.js — CRUD /api/misc-contacts (case miscellaneous contacts)
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

### Case Management
- **Case Types**: Felony, Misdemeanor, Juvenile, Probation Violation, Mental Health/Commitment, Appeal, Other
- **Case Stages**: Arraignment, Preliminary Hearing, Grand Jury/Indictment, Pre-Trial Motions, Plea Negotiations, Trial, Sentencing, Post-Conviction, Appeal
- **Case Statuses**: Active, Closed, Pending, Disposed, Transferred
- **Criminal-Specific Fields**: Defendant name, prosecutor, charge description/statute/class, court division (Circuit/District/Juvenile), custody status, bond amount/conditions, jail location, arrest/arraignment/next court/trial/sentencing/disposition dates, investigator, social worker

### Charge Tracking
- Multiple charges per case stored as JSONB array
- Each charge: statute, description, class (Class A/B/C Felony, Misdemeanor A/B/C, Violation, Other), original/amended flag, disposition (Guilty Plea, Not Guilty Verdict, Nolle Prosequi, Dismissed, Acquitted, Convicted), disposition date
- Inline editing on Details tab

### Conflict Check
- Automatic on new case creation: triggered when defendant name is entered
- Searches existing cases (defendant names, titles) and contacts for matches
- Displays warning panel with matching cases and contacts before case creation proceeds
- Backend endpoint: GET /api/cases/conflict-check?name=<name>

### Core Features
- Customizable Dashboard: per-user widget system with add/remove/reorder
- Cases & Matters view with filtering, sorting, pagination
- Case Detail Overlay: editable criminal defense fields, task/note/link management, activity log, correspondence tab, charges section
- Deadline Tracker: calendar grid, list view, iCal feed import, court rules calculator
- Tasks View: filterable task list with inline editing, auto-escalation, recurring tasks
- Reports: pre-built report types with CSV export and print
- Time Log: unified time tracking view; derives entries from task completions, notes, and correspondence; supports manual time entries
- Staff Directory with admin controls (role/office management, send temp passwords, remove staff)
- Contacts: auto-populated contacts with phone/email/fax/address, associated cases, persistent notes, and soft-delete
- AI Search: Natural language search across all case data via OpenAI gpt-5-mini
- Confidential Cases: access-restricted to assigned team members + App Admin
- Case Parties: accordion-style party management on Details tab (types: Defendant, Co-Defendant, Victim, Witness)
- Case Experts: accordion-style expert management on Details tab
- Document Generator: upload .docx templates with placeholder auto-detection; template categories (Motions, Orders, Notices, Subpoenas, Client Letters, General)
- Email Correspondence: SendGrid Inbound Parse captures emails to case-{id}@mail.mattrmindr.com

### Removed Features (from civil version)
- Insurance tracking (removed entirely)
- Billing Summary (removed)
- Medical Summary (removed)
- Case Expenses (removed)
- Multi-office support (simplified to single Mobile office)

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
| cases | All cases/matters with criminal defense fields (defendant_name, prosecutor, charge_description, charge_statute, charge_class, case_type, custody_status, bond_amount, bond_conditions, jail_location, court_division, arrest/arraignment/next_court/sentencing/disposition dates, charges JSONB, investigator, social_worker) |
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
| case_parties | Per-case parties: Defendant, Co-Defendant, Victim, Witness (JSONB data) |
| case_experts | Per-case experts with contact card links (JSONB data) |
| case_misc_contacts | Per-case miscellaneous contacts (JSONB data, typed) |
| time_entries | Manual time log entries per user/case |
