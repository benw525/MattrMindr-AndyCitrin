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
    deadlines.js    — GET/POST /api/deadlines
    notes.js        — GET/POST/DELETE /api/notes
    links.js        — GET/POST/DELETE /api/links
    activity.js     — GET/POST /api/activity
    contacts.js     — CRUD /api/contacts (soft-delete/restore, 30-day retention)
    contact-notes.js — GET/POST/DELETE /api/contact-notes
    ai-search.js    — POST /api/ai-search (OpenAI gpt-5-mini semantic case search)
    correspondence.js — GET/DELETE /api/correspondence (per-case email history)
    inbound-email.js — POST /api/inbound-email (SendGrid Inbound Parse webhook, no auth)
    templates.js    — CRUD /api/templates, document generation with docxtemplater

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
- Dashboard with upcoming deadlines, trials, and personal task list
- Cases & Matters view with filtering, sorting, pagination
- Case Detail Overlay: editable fields (plaintiff, defendant, opposing counsel, short case number, county, court, etc.), task/note/link management, activity log, correspondence tab
- Deadline Tracker: calendar grid, list view, iCal feed import, court rules calculator
- Tasks View: filterable task list with inline editing, auto-escalation, recurring tasks
- Reports: 10 pre-built report types with CSV export and print
- Time Log: activity history per user (task completions + notes)
- Staff Directory with admin controls (role/office management, send temp passwords, remove staff)
- Contacts: auto-populated contacts (Clients, Attorneys, Courts + manual Experts/Miscellaneous), with phone/email/fax/address, associated cases, persistent notes, and soft-delete with 30-day recovery
- AI Search: Natural language search across all case data via OpenAI gpt-5-mini
- Confidential Cases: access-restricted to assigned team members + App Admin
- Document Generator: upload .docx templates, define placeholders, auto-fill from case data; visibility (global/personal); full re-edit of placeholders (add/remove/modify fields) restricted to creator + Shareholders
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
- **Auto-escalation**: Task priority rises automatically as due date approaches.
- **Activity logging**: Tracked per-case via `/api/activity`.

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
| contacts | Clients, attorneys, courts, experts |
| contact_notes | Per-contact notes |
| case_correspondence | Inbound emails captured via SendGrid |
| doc_templates | Document templates (.docx with placeholders) |
