# LexTrack — Case Management System

## Overview
A legal practice management app for law firms. Tracks civil litigation cases and matters, manages deadlines, assigns tasks, and generates firm-wide reports.

## Stack
- **Frontend**: React 19 (Create React App), port 5000
- **Backend**: Node.js + Express 4, port 3001
- **Database**: PostgreSQL (Replit-provisioned), accessed via `DATABASE_URL`
- **Auth**: express-session with PIN-based login (demo PIN: `1234`)
- **Styling**: CSS-in-JS template literal injected at runtime via `<style>` tag

## Running the App
Workflow: `npm start` (root) — runs both Express API and React app via `concurrently`
Login: select any user and enter PIN `1234`

## Project Structure
```
server/
  index.js          — Express entry point, session middleware, CORS
  db.js             — pg Pool configured from DATABASE_URL
  schema.js         — Creates all 7 DB tables (run once)
  seed.js           — Seeds USERS, CASES, DEADLINES from firmData.js
  middleware/
    auth.js         — requireAuth middleware
  routes/
    auth.js         — POST /api/auth/login, logout, GET /api/auth/me
    cases.js        — CRUD /api/cases
    tasks.js        — CRUD /api/tasks (bulk create, complete)
    deadlines.js    — GET/POST /api/deadlines
    notes.js        — GET/POST/DELETE /api/notes
    links.js        — GET/POST/DELETE /api/links
    activity.js     — GET/POST /api/activity

lextrack/
  src/
    App.js          — All UI components and business logic (~3,460 lines)
    api.js          — Thin fetch wrapper for all API calls
    firmData.js     — Static reference data: USERS display info (avatars, names)
    App.css         — Base reset styles
    index.js        — React entry point
  package.json      — proxy: http://localhost:3001
```

## Key Features
- Dashboard with upcoming deadlines, trials, and personal task list
- Cases & Matters view with filtering, sorting, pagination
- Case Detail Overlay: editable fields, task/note/link management, activity log
- Deadline Tracker: calendar grid, list view, iCal feed import, court rules calculator
- Tasks View: filterable task list with inline editing, auto-escalation, recurring tasks
- Reports: 10 pre-built report types with CSV export and print
- Time Log: activity history per user (task completions + notes)
- Staff Directory

## Architecture Notes
- **DB migration path**: All DB access via REST API — swap `DATABASE_URL` to point to Supabase, swap `express-session` for JWT, done.
- **Standard SQL only**: No Replit-specific extensions — schema is portable.
- **Task chains**: Completing certain tasks auto-generates follow-up tasks (`TASK_CHAINS`, `DUAL_CHAINS`) — business logic stays client-side for now.
- **Auto-escalation**: Task priority rises automatically as due date approaches.
- **Activity logging**: Tracked per-case via `/api/activity`.

## Database Tables
| Table | Records |
|-------|---------|
| users | 6 |
| cases | 729 |
| deadlines | 423 |
| tasks | (user-created) |
| case_notes | (user-created) |
| case_links | (user-created) |
| case_activity | (user-created) |
