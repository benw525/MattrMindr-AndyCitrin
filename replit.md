# LexTrack — Case Management System

## Overview
A legal practice management app for law firms. Tracks civil litigation cases and matters, manages deadlines, assigns tasks, and generates firm-wide reports.

## Stack
- **Frontend**: React 19 (Create React App)
- **Styling**: CSS-in-JS template literal injected at runtime via `<style>` tag + `App.css`
- **Data**: Static mock data in `lextrack/src/firmData.js` (729 imported cases/matters)
- **Persistence**: `localStorage` for user-created cases, tasks, notes, deadlines

## Running the App
Workflow: `cd lextrack && PORT=5000 npm start`
Login: select any user and use PIN `1234`

## Project Structure
```
lextrack/
  src/
    App.js        — All UI components and business logic (~3,400 lines)
    firmData.js   — Static data: USERS, CASES, DEADLINES (~1,171 lines)
    App.css       — Base reset styles
    index.js      — React entry point
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
- Task chains: completing certain tasks auto-generates follow-up tasks (see `TASK_CHAINS`, `DUAL_CHAINS`)
- Auto-escalation: task priority rises automatically as due date approaches
- Case overrides: edits to base cases are stored as `_override` entries in `extraCases`
- Activity logging: tracked per-case in `caseActivity` localStorage key
