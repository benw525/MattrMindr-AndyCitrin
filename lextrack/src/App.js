import { useState, useEffect, useMemo, Fragment } from "react";
import { USERS } from "./firmData.js";
import {
  apiLogin, apiLogout,
  apiGetCases, apiCreateCase, apiUpdateCase,
  apiGetTasks, apiCreateTask, apiCreateTasks, apiUpdateTask, apiCompleteTask,
  apiGetDeadlines, apiCreateDeadline,
  apiGetNotes, apiCreateNote, apiDeleteNote,
  apiGetLinks, apiCreateLink, apiDeleteLink,
  apiGetActivity, apiCreateActivity,
} from "./api.js";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');`;

const today = new Date().toISOString().split("T")[0];
let _idCounter = Date.now();
const newId = () => ++_idCounter;

const addDays = (dateStr, days) => {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

const fmt = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date(today)) / 86400000);
};

const urgencyColor = (days) => {
  if (days === null) return "#8899aa";
  if (days < 0) return "#e05252";
  if (days <= 7) return "#e07a30";
  if (days <= 21) return "#c9a84c";
  return "#4CAE72";
};

const isFiled = (c) => !!(c.caseNum && c.caseNum.trim().length > 0);
const recordType = (c) => isFiled(c) ? "Case" : "Matter";

const PRIORITY_RANK = { Low: 0, Medium: 1, High: 2, Urgent: 3 };
const RANK_PRIORITY = ["Low", "Medium", "High", "Urgent"];
const getEffectivePriority = (task) => {
  if (!task.autoEscalate || task.status === "Completed") return task.priority;
  const days = daysUntil(task.due);
  if (days === null) return task.priority;
  let escalated = task.priority;
  if (days <= 7) escalated = "Urgent";
  else if (days <= 14) escalated = (escalated === "Low" || escalated === "Medium") ? "High" : escalated;
  else if (days <= 30) escalated = escalated === "Low" ? "Medium" : escalated;
  return RANK_PRIORITY[Math.max(PRIORITY_RANK[task.priority] || 0, PRIORITY_RANK[escalated] || 0)];
};

// Chain-spawn definitions: when a task with this title is completed, automatically
// create the next task. dueDaysFromCompletion is calculated from the completion date.
const TASK_CHAINS = {
  "Confirm Service": {
    title: "File Answer",
    priority: "Urgent",
    dueDaysFromCompletion: 0,
    autoEscalate: true,
    notes: "Auto-generated after Confirm Service was completed. File answer immediately.",
  },
  "Send Written Discovery to Plaintiff": {
    title: "Plaintiff's Discovery Received",
    priority: "High",
    dueDaysFromCompletion: 30,
    autoEscalate: true,
    notes: "Auto-generated after Send Written Discovery to Plaintiff was completed.",
  },
  "Plaintiff's Discovery Received": {
    title: "Send Subpoenas to Providers",
    priority: "Urgent",
    dueDaysFromCompletion: 0,
    autoEscalate: true,
    notes: "Auto-generated after Plaintiff's Discovery Received was completed.",
  },
  "Send Subpoenas to Providers": {
    title: "Follow-up on Subpoenas",
    priority: "Medium",
    dueDaysFromCompletion: 30,
    autoEscalate: true,
    notes: "Auto-generated after Send Subpoenas to Providers was completed.",
  },
  "Follow-up on Subpoenas": {
    title: "Update Medical Record Summary",
    priority: "Medium",
    dueDaysFromCompletion: 30,
    autoEscalate: true,
    notes: "Auto-generated after Follow-up on Subpoenas was completed.",
  },
  "Schedule Party Depositions": {
    title: "Complete DWU Report",
    priority: "Medium",
    dueDaysFromCompletion: 180,
    autoEscalate: true,
    notes: "Auto-generated after Schedule Party Depositions was completed.",
  },
};

// Dual-condition chains: spawn a task only when BOTH named tasks are complete
// for the same case. Checked after every completion.
const DUAL_CHAINS = [
  {
    requires: ["Send Written Discovery to Plaintiff", "Plaintiff's Discovery Received"],
    spawn: {
      title: "Schedule Party Depositions",
      priority: "Medium",
      dueDaysFromCompletion: 30,
      autoEscalate: true,
      notes: "Auto-generated after both Send Written Discovery to Plaintiff and Plaintiff's Discovery Received were completed.",
    },
  },
];

const generateDefaultTasks = (caseObj, userId) => {
  const base = [
    { title: "Open file and assign file number",       priority: "High",   dueDays: 1,  notes: "" },
    { title: "Send acknowledgment letter to client",   priority: "High",   dueDays: 3,  notes: "Confirm representation and provide case number." },
    { title: "Confirm Service",                      priority: "Urgent", dueDays: 5,  notes: "Verify service date and calculate ARCP 12(a) deadline." },
    { title: "Subpoena Police File",                   priority: "High",   dueDays: 14, notes: "" },
    { title: "Send Written Discovery to Plaintiff", priority: "Urgent", dueDays: 0,  notes: "Completing this task will automatically generate Plaintiff's Discovery Received (due 30 days out)." },
    { title: "Investigate Accident Scene",             priority: "Medium", dueDays: 30, notes: "" },
    { title: "Complete Written Discovery",             priority: "Medium", dueDays: 30, notes: "" },
    { title: "Complete Medical Record Summary",        priority: "Medium", dueDays: 30, notes: "" },
    { title: "Submit ILP",                             priority: "Medium", dueDays: 60, notes: "" },
    { title: "Call claim specialist with status update", priority: "Medium", dueDays: 30, notes: "Introduce firm and confirm coverage.", recurring: true, recurringDays: 30 },
  ];
  // Pre-generate all IDs in a separate pass so each gets a guaranteed unique counter tick
  const ids = base.map(() => newId());
  return base.map((t, i) => ({
    id: ids[i],
    caseId: caseObj.id,
    title: t.title,
    assigned: userId,
    due: addDays(today, t.dueDays),
    priority: t.priority,
    autoEscalate: true,
    status: "Not Started",
    notes: t.notes || "",
    recurring: t.recurring || false,
    recurringDays: t.recurringDays || null,
    isGenerated: true,
  }));
};

const statusBadgeStyle = (status) => {
  const map = {
    Case: { bg: "#1a2a3a", color: "#5599cc", border: "#1a4a6a" },
    Matter: { bg: "#2a1a3a", color: "#a066cc", border: "#4a2a6a" },
    Active: { bg: "#1a3a2a", color: "#4CAE72", border: "#2a5a3a" },
    Closed: { bg: "#1a1a2a", color: "#7788aa", border: "#2a2a4a" },
    Urgent: { bg: "#3a1a1a", color: "#e05252", border: "#6a2a2a" },
    Overdue: { bg: "#3a1a1a", color: "#e05252", border: "#6a2a2a" },
    "Trial Set": { bg: "#2a1a3a", color: "#a066cc", border: "#4a2a6a" },
    "Post-Answer": { bg: "#1a2a1a", color: "#66aa66", border: "#2a4a2a" },
    "Written Discovery": { bg: "#1a2a3a", color: "#5599cc", border: "#1a4a6a" },
    Depositions: { bg: "#2a2a1a", color: "#c9a84c", border: "#4a4a1a" },
    "Expert Discovery": { bg: "#2a1a2a", color: "#cc66aa", border: "#4a1a4a" },
    Pleadings: { bg: "#1a1a2a", color: "#7788aa", border: "#2a2a4a" },
    Mediation: { bg: "#1a2a3a", color: "#5599cc", border: "#1a4a6a" },
    "In Progress": { bg: "#1a2a3a", color: "#5599cc", border: "#1a4a6a" },
    "Not Started": { bg: "#1e2030", color: "#8899bb", border: "#2a2d45" },
    Completed: { bg: "#1a3a2a", color: "#4CAE72", border: "#2a5a3a" },
    Waiting: { bg: "#2a2a1a", color: "#c9a84c", border: "#4a4a1a" },
    High: { bg: "#3a2a1a", color: "#e07a30", border: "#6a4a1a" },
    Medium: { bg: "#2a2a1a", color: "#c9a84c", border: "#4a4a1a" },
    Low: { bg: "#1a2a3a", color: "#5599cc", border: "#1a4a6a" },
  };
  return map[status] || { bg: "#1e2030", color: "#8899bb", border: "#2a2d45" };
};

const Badge = ({ label }) => {
  if (!label) return null;
  const s = statusBadgeStyle(label);
  return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{label}</span>;
};

const getUserById = (id) => USERS.find(u => u.id === id);

const Avatar = ({ userId, size = 28 }) => {
  const u = getUserById(userId);
  if (!u) return null;
  return <div title={`${u.name} (${u.role})`} style={{ width: size, height: size, borderRadius: "50%", background: u.avatar, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.32, fontWeight: 700, color: "#fff", fontFamily: "'Source Sans 3',sans-serif", flexShrink: 0 }}>{u.initials}</div>;
};

const SortTh = ({ col, label, sortCol, sortDir, onSort, style }) => (
  <th style={{ cursor: "pointer", userSelect: "none", ...style }} onClick={() => onSort(col)}>
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {label}
      <span style={{ color: sortCol === col ? "#c9a84c" : "#2a3650", fontSize: 10 }}>
        {sortCol === col ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </span>
  </th>
);

const COURT_RULES = [
  { id: 1, name: "Answer to Complaint (FRCP)", days: 21, from: "Service Date", rule: "FRCP 12(a)(1)(A)" },
  { id: 2, name: "Reply to Answer", days: 21, from: "Answer Filed", rule: "FRCP 7(a)" },
  { id: 3, name: "Motion to Dismiss Response", days: 14, from: "Motion Served", rule: "FRCP 12(b)" },
  { id: 4, name: "Summary Judgment Opposition", days: 21, from: "Motion Filed", rule: "FRCP 56(c)(1)" },
  { id: 5, name: "Notice of Appeal", days: 30, from: "Judgment Entry", rule: "FRAP 4(a)(1)" },
  { id: 6, name: "Expert Disclosure (Plaintiff)", days: 90, from: "Scheduling Order", rule: "FRCP 26(a)(2)(D)" },
  { id: 7, name: "Rebuttal Expert Disclosure", days: 30, from: "Plaintiff Expert Disclosure", rule: "FRCP 26(a)(2)(D)(ii)" },
  { id: 8, name: "Daubert Motion", days: 30, from: "Expert Discovery Close", rule: "FRCP 702" },
  { id: 9, name: "Answer to Complaint (Alabama)", days: 30, from: "Service Date", rule: "ARCP 12(a)" },
  { id: 10, name: "Motion for Summary Judgment (Alabama)", days: 45, from: "Scheduling Order", rule: "ARCP 56" },
];

const CSS = `
${FONTS}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #ccd6e8; font-family: 'Source Sans 3', sans-serif; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #0d1117; }
::-webkit-scrollbar-thumb { background: #2a3650; border-radius: 3px; }
.app { display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 240px; background: #0a0e16; border-right: 1px solid #1a2235; display: flex; flex-direction: column; flex-shrink: 0; }
.sidebar-logo { padding: 28px 24px 20px; border-bottom: 1px solid #1a2235; }
.sidebar-logo-text { font-family: 'Playfair Display', serif; font-size: 17px; color: #c9a84c; font-weight: 700; }
.sidebar-logo-sub { font-size: 10px; color: #445566; letter-spacing: 0.15em; text-transform: uppercase; margin-top: 2px; }
.sidebar-user { padding: 16px 20px; border-bottom: 1px solid #1a2235; display: flex; align-items: center; gap: 10px; }
.sidebar-user-name { font-size: 13px; font-weight: 600; color: #ccd6e8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar-user-role { font-size: 11px; color: #556677; }
.sidebar-nav { flex: 1; overflow-y: auto; padding: 12px 0; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 20px; cursor: pointer; font-size: 13.5px; color: #7788aa; border-left: 3px solid transparent; transition: all 0.15s; }
.nav-item:hover { color: #ccd6e8; background: #111827; }
.nav-item.active { color: #c9a84c; background: #111624; border-left-color: #c9a84c; }
.nav-icon { font-size: 15px; width: 18px; text-align: center; }
.nav-badge { margin-left: auto; background: #3a1a1a; color: #e05252; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar { padding: 14px 28px; border-bottom: 1px solid #1a2235; display: flex; align-items: center; justify-content: space-between; background: #0a0e16; flex-shrink: 0; flex-wrap: wrap; gap: 10px; }
.topbar-title { font-family: 'Playfair Display', serif; font-size: 20px; color: #e8d5a8; font-weight: 600; }
.topbar-subtitle { font-size: 12px; color: #445566; margin-top: 1px; }
.topbar-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.btn { padding: 7px 16px; border-radius: 5px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; font-family: 'Source Sans 3', sans-serif; }
.btn-gold { background: #c9a84c; color: #0a0e16; }
.btn-gold:hover { background: #d4b560; }
.btn-gold:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-outline { background: transparent; color: #7788aa; border: 1px solid #2a3650; }
.btn-outline:hover { border-color: #c9a84c; color: #c9a84c; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.content { flex: 1; overflow-y: auto; padding: 24px 28px; }
.card { background: #111624; border: 1px solid #1a2235; border-radius: 8px; }
.card-header { padding: 16px 20px; border-bottom: 1px solid #1a2235; display: flex; align-items: center; justify-content: space-between; }
.card-title { font-family: 'Playfair Display', serif; font-size: 15px; color: #c9a84c; font-weight: 600; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.stat-card { background: #111624; border: 1px solid #1a2235; border-radius: 8px; padding: 18px 20px; }
.stat-label { font-size: 11px; color: #556677; text-transform: uppercase; letter-spacing: 0.1em; }
.stat-value { font-family: 'Playfair Display', serif; font-size: 32px; color: #e8d5a8; font-weight: 700; margin-top: 4px; }
.stat-sub { font-size: 12px; color: #445566; margin-top: 4px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 10px 14px; font-size: 11px; color: #556677; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid #1a2235; white-space: nowrap; }
td { padding: 11px 14px; font-size: 13px; color: #aabbc8; border-bottom: 1px solid #141c2b; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #131d2e; }
.clickable-row { cursor: pointer; }
.selected-row td { background: #0f1e30 !important; }
.selected-row td:first-child { border-left: 3px solid #c9a84c; }
input, select, textarea { background: #0d1117; border: 1px solid #2a3650; color: #ccd6e8; padding: 8px 12px; border-radius: 5px; font-size: 13.5px; font-family: 'Source Sans 3', sans-serif; width: 100%; }
input:focus, select:focus, textarea:focus { outline: none; border-color: #c9a84c; }
label { font-size: 12px; color: #556677; display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.08em; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-group { margin-bottom: 14px; }
.tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 1px solid #1a2235; flex-wrap: wrap; }
.tab { padding: 8px 16px; font-size: 13px; color: #7788aa; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s; font-weight: 500; white-space: nowrap; }
.tab.active { color: #c9a84c; border-bottom-color: #c9a84c; }
.tab:hover:not(.active) { color: #ccd6e8; }
.tab-divider { width: 1px; background: #1a2235; margin: 4px 6px; }
.deadline-item { padding: 12px 16px; border-bottom: 1px solid #141c2b; display: flex; align-items: center; gap: 12px; }
.deadline-item:last-child { border-bottom: none; }
.dl-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dl-info { flex: 1; min-width: 0; }
.dl-title { font-size: 13.5px; color: #ccd6e8; }
.dl-case { font-size: 11.5px; color: #556677; margin-top: 2px; }
.empty { text-align: center; padding: 40px 20px; color: #445566; font-size: 14px; }
.detail-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 440px; background: #0f1520; border-left: 1px solid #1a2235; z-index: 500; overflow-y: auto; box-shadow: -10px 0 30px rgba(0,0,0,0.4); }
.panel-header { padding: 20px 24px; border-bottom: 1px solid #1a2235; display: flex; align-items: flex-start; justify-content: space-between; position: sticky; top: 0; background: #0f1520; z-index: 1; }
.panel-content { padding: 20px 24px; }
.panel-section { margin-bottom: 22px; }
.panel-section-title { font-size: 10px; color: #556677; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 10px; font-weight: 600; }
.info-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #141c2b; font-size: 13px; gap: 12px; }
.info-row:last-child { border-bottom: none; }
.info-key { color: #556677; flex-shrink: 0; }
.info-val { color: #ccd6e8; text-align: right; word-break: break-word; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(3px); }
.modal { background: #111624; border: 1px solid #2a3650; border-radius: 10px; padding: 28px; width: 620px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.modal-title { font-family: 'Playfair Display', serif; font-size: 20px; color: #e8d5a8; font-weight: 600; margin-bottom: 4px; }
.modal-sub { font-size: 12px; color: #556677; margin-bottom: 20px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #1a2235; }
.login-bg { min-height: 100vh; background: #080c12; display: flex; align-items: center; justify-content: center; }
.login-box { background: #0f1520; border: 1px solid #1a2235; border-radius: 12px; padding: 44px 40px; width: 400px; }
.login-title { font-family: 'Playfair Display', serif; font-size: 26px; color: #c9a84c; text-align: center; margin-bottom: 6px; }
.login-sub { font-size: 12px; color: #445566; text-align: center; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 32px; }
.calc-result { background: #0d1117; border: 1px solid #c9a84c33; border-radius: 6px; padding: 14px 16px; margin-top: 16px; }
.pagination { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-top: 1px solid #1a2235; font-size: 13px; color: #556677; flex-wrap: wrap; }
.page-btn { padding: 4px 10px; border-radius: 4px; background: #1a2235; border: 1px solid #2a3650; color: #7788aa; cursor: pointer; font-size: 12px; }
.page-btn:hover { border-color: #c9a84c; color: #c9a84c; }
.page-btn.active { background: #c9a84c22; border-color: #c9a84c; color: #c9a84c; }
.checkbox { width: 17px; height: 17px; border-radius: 4px; border: 2px solid #2a3650; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; flex-shrink: 0; transition: all 0.15s; }
.checkbox.done { background: #4CAE72; border-color: #4CAE72; }
.rec-badge { display: inline-flex; align-items: center; gap: 3px; background: #1a2a2a; color: #44bbaa; border: 1px solid #1a4a4a; border-radius: 3px; padding: 1px 5px; font-size: 10px; font-weight: 600; margin-left: 5px; }
.chain-badge { display: inline-flex; align-items: center; gap: 3px; background: #1a1a2e; color: #8877cc; border: 1px solid #3a2a6a; border-radius: 3px; padding: 1px 5px; font-size: 10px; font-weight: 600; margin-left: 5px; }
.task-inline-edit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 5px; }
.task-inline-edit input[type="date"] { background: #1a2235; border: 1px solid #2a3650; color: #ccd6e8; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
.task-inline-edit select { background: #1a2235; border: 1px solid #2a3650; color: #ccd6e8; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
.task-inline-edit input[type="date"]:focus, .task-inline-edit select:focus { outline: none; border-color: #c9a84c; }
.toggle { width: 38px; height: 20px; border-radius: 10px; cursor: pointer; position: relative; flex-shrink: 0; transition: background 0.2s; }
.toggle-knob { position: absolute; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.2s; }
.report-card { background: #111624; border: 1px solid #1a2235; border-radius: 8px; padding: 18px 20px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.report-card:hover { border-color: #c9a84c55; background: #131d2e; }
.report-card.active { border-color: #c9a84c; background: #131d2e; }
.report-card-icon { font-size: 24px; margin-bottom: 8px; }
.report-card-title { font-family: 'Playfair Display', serif; font-size: 14px; color: #e8d5a8; font-weight: 600; margin-bottom: 4px; }
.report-card-desc { font-size: 11px; color: #556677; line-height: 1.4; }
.report-output { background: #0d1117; border: 1px solid #1a2235; border-radius: 8px; }
.report-output-header { padding: 16px 20px; border-bottom: 1px solid #1a2235; display: flex; align-items: center; justify-content: space-between; }
.report-output-title { font-family: 'Playfair Display', serif; font-size: 16px; color: #e8d5a8; font-weight: 600; }
.report-meta { font-size: 11px; color: #445566; margin-top: 2px; }
@media print {
  .sidebar, .topbar, .tabs, .report-card, .btn, .pagination { display: none !important; }
  .content { padding: 0 !important; }
  .report-output { border: none; background: white; color: black; }
  .report-output-header { border-bottom: 2px solid #333; }
  .report-output-title { color: black !important; font-size: 18px; }
  table { font-size: 11px; }
  th, td { border-bottom: 1px solid #ddd !important; color: black !important; padding: 6px 10px !important; }
  th { background: #f5f5f5 !important; }
  @page { margin: 0.75in; }
}
.note-item { padding: 10px 14px; border-bottom: 1px solid #141c2b; cursor: pointer; transition: background 0.1s; }
.note-item:last-child { border-bottom: none; }
.note-item:hover { background: #131d2e; }
.note-item.expanded { background: #0f1a2e; border-left: 3px solid #c9a84c; }
.note-type-badge { display: inline-block; padding: 1px 7px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; }
.print-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 2000; display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 30px 20px; }
.print-doc { background: #fff; color: #111; width: 816px; min-height: 100vh; padding: 60px 72px; font-family: 'Source Sans 3', Georgia, serif; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.print-doc h1 { font-family: 'Playfair Display', serif; font-size: 22px; color: #111; margin-bottom: 4px; }
.print-doc h2 { font-family: 'Playfair Display', serif; font-size: 15px; color: #333; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
.print-doc .meta { font-size: 11px; color: #666; margin-bottom: 20px; }
.print-doc .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 8px; }
.print-doc .info-pair { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eee; font-size: 12px; }
.print-doc .info-pair .k { color: #666; min-width: 130px; flex-shrink: 0; }
.print-doc .info-pair .v { color: #111; font-weight: 500; }
.print-doc .note-block { margin-bottom: 16px; padding: 14px 16px; border: 1px solid #ddd; border-radius: 4px; break-inside: avoid; }
.print-doc .note-block .note-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.print-doc .note-block .note-body { font-size: 13px; color: #222; line-height: 1.6; white-space: pre-wrap; }
.print-doc table { width: 100%; border-collapse: collapse; font-size: 12px; }
.print-doc th { text-align: left; padding: 6px 10px; background: #f5f5f5; border-bottom: 1px solid #ccc; font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.06em; }
.print-doc td { padding: 6px 10px; border-bottom: 1px solid #eee; color: #222; }
.print-doc .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
.case-overlay { position: fixed; top: 0; left: 220px; right: 0; bottom: 0; background: #0a0e18; z-index: 600; display: flex; flex-direction: column; overflow: hidden; }
.case-overlay-header { flex-shrink: 0; background: #0f1520; border-bottom: 1px solid #1a2235; padding: 18px 32px; display: flex; align-items: flex-start; justify-content: space-between; z-index: 10; gap: 16px; }
.case-overlay-tabs { flex-shrink: 0; display: flex; gap: 0; border-bottom: 1px solid #1a2235; padding: 0 32px; background: #0f1520; }
.case-overlay-tab { padding: 12px 20px; font-size: 13px; color: #556677; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s; font-weight: 500; }
.case-overlay-tab:hover { color: #aabbcc; }
.case-overlay-tab.active { color: #e8d5a8; border-bottom-color: #c9a84c; }
.case-overlay-body { flex: 1; overflow-y: auto; padding: 28px 32px; }
.case-overlay-body > * { max-width: 1100px; width: 100%; margin-left: auto; margin-right: auto; }
.case-overlay-section { margin-bottom: 32px; }
.case-overlay-section-title { font-size: 10px; color: #445566; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
.activity-entry { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid #141c2b; }
.activity-entry:last-child { border-bottom: none; }
.activity-avatar-col { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 36px; }
.activity-line { width: 1px; flex: 1; background: #1a2235; min-height: 20px; }
.activity-body { flex: 1; min-width: 0; }
.activity-action { font-size: 13px; color: #ccd6e8; font-weight: 600; margin-bottom: 2px; }
.activity-detail { font-size: 12px; color: #7788aa; margin-bottom: 3px; line-height: 1.5; }
.activity-meta { font-size: 11px; color: #445566; }
.edit-field { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #141c2b; }
.edit-field:last-child { border-bottom: none; }
.edit-field-key { font-size: 12px; color: #556677; min-width: 150px; flex-shrink: 0; }
.edit-field-val { flex: 1; font-size: 13px; color: #ccd6e8; }
.edit-field-val input, .edit-field-val select { background: transparent; border: none; color: #ccd6e8; font-size: 13px; padding: 2px 4px; border-radius: 3px; width: 100%; font-family: 'Source Sans 3', sans-serif; }
.edit-field-val input:hover, .edit-field-val select:hover { background: #1a2235; }
.edit-field-val input:focus, .edit-field-val select:focus { background: #1a2235; outline: none; border: none; }
.edit-field-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.edit-field:hover .edit-field-actions { opacity: 1; }
.add-field-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.overlay-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; }
`;

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [selectedCase, setSelectedCase] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState(null);

  // Server-backed state — loaded from API after login
  const [allCases,     setAllCases]     = useState([]);
  const [allDeadlines, setAllDeadlines] = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [caseNotes,    setCaseNotes]    = useState({});
  const [caseLinks,    setCaseLinks]    = useState({});
  const [caseActivity, setCaseActivity] = useState({});

  const [calcInputs, setCalcInputs] = useState({ ruleId: 1, fromDate: today });
  const [calcResult, setCalcResult] = useState(null);

  // Load all data from API when user logs in
  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    setDataError(null);
    Promise.all([
      apiGetCases(),
      apiGetTasks(),
      apiGetDeadlines(),
    ])
      .then(([cases, fetchedTasks, deadlines]) => {
        setAllCases(cases);
        setTasks(fetchedTasks);
        setAllDeadlines(deadlines);
      })
      .catch(err => setDataError(err.message))
      .finally(() => setLoading(false));
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  if (!currentUser) return <LoginScreen onLogin={setCurrentUser} />;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#080c12", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: "#c9a84c" }}>LexTrack</div>
      <div style={{ fontSize: 13, color: "#445566" }}>Loading case data…</div>
    </div>
  );

  if (dataError) return (
    <div style={{ minHeight: "100vh", background: "#080c12", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, color: "#c9a84c" }}>LexTrack</div>
      <div style={{ fontSize: 13, color: "#e05252" }}>Failed to load data: {dataError}</div>
      <button className="btn btn-outline" onClick={() => setCurrentUser(null)}>Return to Login</button>
    </div>
  );

  const overdueBadge = allDeadlines.filter(d => daysUntil(d.date) < 0).length + tasks.filter(t => t.status !== "Completed" && daysUntil(t.due) < 0).length;

  const handleAddRecord = async (record) => {
    try {
      const payload = {
        writtenDisc: "", partyDepo: "", expertDepo: "", mediation: "",
        trialDate: "", answerFiled: "", dol: "", judge: "",
        ...record,
        status: "Active",
      };
      const created = await apiCreateCase(payload);
      setAllCases(p => [...p, created]);

      if (record.autoTasks) {
        const defaultTasks = generateDefaultTasks(created, currentUser.id);
        const savedTasks = await apiCreateTasks(defaultTasks);
        setTasks(p => [...p, ...savedTasks]);
      }

      const activityEntry = {
        caseId: created.id,
        ts: new Date().toISOString(),
        userId: currentUser.id,
        userName: currentUser.name,
        userRole: currentUser.role,
        action: "Case Created",
        detail: `${recordType(created)} opened by ${currentUser.name}`,
      };
      await apiCreateActivity(activityEntry);
      setCaseActivity(prev => ({
        ...prev,
        [created.id]: [{ ...activityEntry, id: Date.now() }],
      }));

      setSelectedCase(created);
      setView("cases");
    } catch (err) {
      alert("Failed to create case: " + err.message);
    }
  };

  const handleUpdateCase = async (updated) => {
    try {
      const saved = await apiUpdateCase(updated.id, updated);
      setAllCases(p => p.map(c => c.id === saved.id ? saved : c));
      setSelectedCase(saved);
    } catch (err) {
      alert("Failed to save case: " + err.message);
    }
  };

  const handleUpdateTask = async (taskId, changes) => {
    try {
      const saved = await apiUpdateTask(taskId, changes);
      setTasks(prev => prev.map(t => t.id === taskId ? saved : t));
    } catch (err) {
      alert("Failed to update task: " + err.message);
    }
  };

  const handleCompleteTask = async (taskId) => {
    try {
      // Optimistically toggle in UI, then confirm with server
      const target = tasks.find(t => t.id === taskId);
      if (!target) return;

      const toggled = await apiCompleteTask(taskId);
      const completing = toggled.status === "Completed";
      const completedDate = today;

      let updatedTasks = tasks.map(t => t.id === taskId ? toggled : t);

      if (!completing) {
        setTasks(updatedTasks);
        return;
      }

      const toSpawn = [];

      // Recurring spawn
      if (target.recurring && target.recurringDays) {
        toSpawn.push({
          caseId: target.caseId,
          title: target.title,
          assigned: target.assigned,
          due: addDays(target.due || completedDate, target.recurringDays),
          priority: target.priority,
          autoEscalate: target.autoEscalate,
          status: "Not Started",
          notes: target.notes || "",
          recurring: target.recurring,
          recurringDays: target.recurringDays,
          isGenerated: true,
          isChained: false,
        });
      }

      // Chain spawn — look up by exact title match
      const chainDef = TASK_CHAINS[target.title.trim()];
      if (chainDef) {
        const due = chainDef.dueDaysFromCompletion === 0
          ? completedDate
          : addDays(completedDate, chainDef.dueDaysFromCompletion);
        toSpawn.push({
          caseId: target.caseId,
          title: chainDef.title,
          assigned: target.assigned,
          due,
          priority: chainDef.priority,
          autoEscalate: chainDef.autoEscalate,
          status: "Not Started",
          notes: chainDef.notes || "",
          recurring: false,
          recurringDays: null,
          isGenerated: true,
          isChained: true,
        });
      }

      // Dual-condition chain spawn
      DUAL_CHAINS.forEach(rule => {
        const { requires, spawn: s } = rule;
        if (!requires.includes(target.title.trim())) return;
        const allDone = requires.every(reqTitle =>
          updatedTasks.some(t =>
            t.caseId === target.caseId &&
            t.title.trim() === reqTitle &&
            t.status === "Completed"
          )
        );
        if (!allDone) return;
        const alreadyExists = updatedTasks.some(t =>
          t.caseId === target.caseId && t.title.trim() === s.title
        );
        if (alreadyExists) return;
        const due = addDays(completedDate, s.dueDaysFromCompletion);
        toSpawn.push({
          caseId: target.caseId,
          title: s.title,
          assigned: target.assigned,
          due,
          priority: s.priority,
          autoEscalate: s.autoEscalate,
          status: "Not Started",
          notes: s.notes || "",
          recurring: false,
          recurringDays: null,
          isGenerated: true,
          isChained: true,
        });
      });

      if (toSpawn.length > 0) {
        const savedSpawned = await apiCreateTasks(toSpawn);
        updatedTasks = [...updatedTasks, ...savedSpawned];
      }

      setTasks(updatedTasks);
    } catch (err) {
      alert("Failed to complete task: " + err.message);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-text">LexTrack</div>
          <div className="sidebar-logo-sub">Case Management</div>
        </div>
        <div className="sidebar-user">
          <Avatar userId={currentUser.id} size={34} />
          <div>
            <div className="sidebar-user-name">{currentUser.name}</div>
            <div className="sidebar-user-role">{currentUser.role}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {[
            { id: "dashboard", icon: "⬛", label: "Dashboard" },
            { id: "cases", icon: "⚖️", label: "Cases & Matters" },
            { id: "deadlines", icon: "📅", label: "Deadlines" },
            { id: "tasks", icon: "✅", label: "Tasks", badge: overdueBadge || null },
            { id: "timelog", icon: "🕐", label: "Time Log" },
            { id: "reports", icon: "📊", label: "Reports" },
            { id: "staff", icon: "👥", label: "Staff" },
          ].map(item => (
            <div key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); if (item.id !== "cases") setSelectedCase(null); }}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </div>
          ))}
        </nav>
        <div style={{ padding: "16px 20px", borderTop: "1px solid #1a2235" }}>
          <div style={{ fontSize: 11, color: "#445566", marginBottom: 4 }}>Signed in as</div>
          <div style={{ fontSize: 12, color: "#7788aa", marginBottom: 10 }}>{currentUser.email}</div>
          <button className="btn btn-outline" style={{ width: "100%", fontSize: 12 }} onClick={() => { apiLogout().catch(() => {}); setCurrentUser(null); setAllCases([]); setAllDeadlines([]); setTasks([]); setCaseNotes({}); setCaseLinks({}); setCaseActivity({}); setSelectedCase(null); }}>Sign Out</button>
        </div>
      </aside>
      <div className="main">
        {view === "dashboard" && <Dashboard currentUser={currentUser} allCases={allCases} deadlines={allDeadlines} tasks={tasks} onSelectCase={c => { setSelectedCase(c); setView("cases"); }} onAddRecord={handleAddRecord} onCompleteTask={handleCompleteTask} onUpdateTask={handleUpdateTask} />}
        {view === "cases" && <CasesView currentUser={currentUser} allCases={allCases} tasks={tasks} selectedCase={selectedCase} setSelectedCase={setSelectedCase} onAddRecord={handleAddRecord} onUpdateCase={handleUpdateCase} onCompleteTask={handleCompleteTask} deadlines={allDeadlines} caseNotes={caseNotes} setCaseNotes={setCaseNotes} caseLinks={caseLinks} setCaseLinks={setCaseLinks} caseActivity={caseActivity} setCaseActivity={setCaseActivity} />}
        {view === "deadlines" && <DeadlinesView deadlines={allDeadlines} onAddDeadline={async (dl) => { try { const saved = await apiCreateDeadline(dl); setAllDeadlines(p => [...p, saved]); } catch (err) { alert("Failed to add deadline: " + err.message); } }} allCases={allCases} calcInputs={calcInputs} setCalcInputs={setCalcInputs} calcResult={calcResult} runCalc={() => { const rule = COURT_RULES.find(r => r.id === Number(calcInputs.ruleId)); if (rule && calcInputs.fromDate) setCalcResult({ rule, from: calcInputs.fromDate, result: addDays(calcInputs.fromDate, rule.days) }); }} currentUser={currentUser} />}
        {view === "tasks" && <TasksView tasks={tasks} onAddTask={async (task) => { try { const saved = await apiCreateTask(task); setTasks(p => [...p, saved]); } catch (err) { alert("Failed to add task: " + err.message); } }} allCases={allCases} currentUser={currentUser} onCompleteTask={handleCompleteTask} onUpdateTask={handleUpdateTask} />}
        {view === "reports" && <ReportsView allCases={allCases} tasks={tasks} deadlines={allDeadlines} currentUser={currentUser} />}
        {view === "timelog" && <TimeLogView currentUser={currentUser} allCases={allCases} tasks={tasks} caseNotes={caseNotes} />}
        {view === "staff" && <StaffView allCases={allCases} />}
      </div>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [sel, setSel] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const doLogin = async () => {
    if (!sel) { setErr("Select a user."); return; }
    if (!pin) { setErr("Enter your PIN."); return; }
    setBusy(true);
    setErr("");
    try {
      const user = await apiLogin(sel.id, pin);
      onLogin(user);
    } catch (e) {
      setErr(e.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-box">
        <div className="login-title">LexTrack</div>
        <div className="login-sub">Case Management System</div>
        <div className="form-group">
          <label>Select User</label>
          <select value={sel?.id || ""} onChange={e => { setSel(USERS.find(u => u.id === Number(e.target.value))); setErr(""); }}>
            <option value="">— Choose your account —</option>
            {USERS.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>PIN</label>
          <input type="password" placeholder="Enter PIN (demo: 1234)" value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} />
        </div>
        {err && <div style={{ color: "#e05252", fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <button className="btn btn-gold" style={{ width: "100%", padding: 10 }} onClick={doLogin} disabled={busy}>
          {busy ? "Signing in…" : "Sign In"}
        </button>
        <div style={{ marginTop: 20, fontSize: 12, color: "#445566", textAlign: "center" }}>All accounts share PIN 1234 in demo mode</div>
      </div>
    </div>
  );
}

// ─── Toggle Helper ────────────────────────────────────────────────────────────
function Toggle({ on, onChange, color = "#c9a84c" }) {
  return (
    <div className="toggle" style={{ background: on ? color : "#2a3650" }} onClick={onChange}>
      <div className="toggle-knob" style={{ left: on ? 20 : 2 }} />
    </div>
  );
}

// ─── New Case/Matter Modal ────────────────────────────────────────────────────
function NewCaseModal({ onSave, onClose }) {
  const [form, setForm] = useState({ caseNum: "", title: "", client: "", insured: "", plaintiff: "", claimNum: "", fileNum: "", claimSpec: "", stage: "Pleadings", leadAttorney: 0, secondAttorney: 0, answerFiled: "", dol: "", mediator: "", notes: "" });
  const [autoTasks, setAutoTasks] = useState(true);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const isMatter = !form.caseNum.trim();

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">Open New {isMatter ? "Matter" : "Case"}</div>
        <div className="modal-sub">
          {isMatter ? "No case number entered — this will be tracked as a Matter (unfiled)." : "Case number entered — this will be tracked as a filed Case."}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
          <Badge label={isMatter ? "Matter" : "Case"} />
          <Badge label="Active" />
        </div>

        <div className="form-row">
          <div className="form-group"><label>Case Number (blank = Matter)</label><input value={form.caseNum} onChange={e => set("caseNum", e.target.value)} placeholder="e.g. 02-CV-2025-901000" /></div>
          <div className="form-group"><label>File Number</label><input value={form.fileNum} onChange={e => set("fileNum", e.target.value)} placeholder="e.g. 010-3100" /></div>
        </div>
        <div className="form-group"><label>Style / Title *</label><input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Smith v. Jones" /></div>
        <div className="form-row">
          <div className="form-group"><label>Client</label><input value={form.client} onChange={e => set("client", e.target.value)} /></div>
          <div className="form-group"><label>Insured</label><input value={form.insured} onChange={e => set("insured", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Plaintiff Attorney</label><input value={form.plaintiff} onChange={e => set("plaintiff", e.target.value)} /></div>
          <div className="form-group"><label>Date of Loss</label><input type="date" value={form.dol} onChange={e => set("dol", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Claim Number</label><input value={form.claimNum} onChange={e => set("claimNum", e.target.value)} /></div>
          <div className="form-group"><label>Claim Specialist</label><input value={form.claimSpec} onChange={e => set("claimSpec", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Lead Attorney</label>
            <select value={form.leadAttorney} onChange={e => set("leadAttorney", Number(e.target.value))}>
              <option value={0}>— Select —</option>
              {USERS.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
            </select>
          </div>
          <div className="form-group"><label>2nd Attorney</label>
            <select value={form.secondAttorney} onChange={e => set("secondAttorney", Number(e.target.value))}>
              <option value={0}>— None —</option>
              {USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ background: autoTasks ? "#0f1e2e" : "#0d1117", border: `1px solid ${autoTasks ? "#c9a84c55" : "#2a3650"}`, borderRadius: 7, padding: "12px 14px", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, color: "#ccd6e8", fontWeight: 600 }}>✅ Auto-generate opening tasks</div>
              <div style={{ fontSize: 11, color: "#556677", marginTop: 2 }}>Open file, ack. letter, calendar answer deadline, subpoena police file, send written discovery, investigate scene, written discovery, medical record summary, ILP, claim specialist call (recurring)</div>
            </div>
            <Toggle on={autoTasks} onChange={() => setAutoTasks(p => !p)} />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" disabled={!form.title.trim()} onClick={() => { onSave({ ...form, autoTasks }); onClose(); }}>
            Open {isMatter ? "Matter" : "Case"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-escalate preview box ────────────────────────────────────────────────
function EscalateBox({ on, onChange, basePriority }) {
  return (
    <div style={{ background: on ? "#0f1e2e" : "#0d1117", border: `1px solid ${on ? "#c9a84c55" : "#2a3650"}`, borderRadius: 7, padding: "12px 14px", transition: "all 0.2s" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: on ? 10 : 0 }}>
        <div><div style={{ fontSize: 13, color: "#ccd6e8", fontWeight: 600 }}>🔺 Auto-Escalate Priority</div><div style={{ fontSize: 11, color: "#556677", marginTop: 2 }}>Priority rises automatically as the due date approaches</div></div>
        <Toggle on={on} onChange={onChange} />
      </div>
      {on && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
          {[
            { label: "30+ days", result: basePriority, note: "Base" },
            { label: "14–30 days", result: basePriority === "Low" ? "Medium" : basePriority, note: "↑ if Low" },
            { label: "7–14 days", result: (basePriority === "Low" || basePriority === "Medium") ? "High" : basePriority, note: "↑ if <High" },
            { label: "≤7 days", result: "Urgent", note: "Always" },
          ].map(({ label, result, note }) => {
            const s = statusBadgeStyle(result);
            return (
              <div key={label} style={{ background: "#0d1117", border: `1px solid ${s.border}`, borderRadius: 5, padding: "7px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#445566", marginBottom: 4 }}>{label}</div>
                <div style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 3, display: "inline-block" }}>{result}</div>
                <div style={{ fontSize: 10, color: "#445566", marginTop: 3 }}>{note}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ currentUser, allCases, deadlines, tasks, onSelectCase, onAddRecord, onCompleteTask, onUpdateTask }) {
  const [showModal, setShowModal] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const activeCases = allCases.filter(c => c.status === "Active");
  const upcomingDl = deadlines.filter(d => { const n = daysUntil(d.date); return n !== null && n >= 0 && n <= 30; }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const trialSoon = allCases.filter(c => c.trialDate && daysUntil(c.trialDate) >= 0 && daysUntil(c.trialDate) <= 90).sort((a, b) => new Date(a.trialDate) - new Date(b.trialDate));
  const myTasks = tasks.filter(t => t.assigned === currentUser.id && t.status !== "Completed");

  return (
    <>
      {showModal && <NewCaseModal onSave={onAddRecord} onClose={() => setShowModal(false)} />}
      <div className="topbar">
        <div>
          <div className="topbar-title">Good morning, {currentUser.name.split(" ")[0]}</div>
          <div className="topbar-subtitle">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
        </div>
        <button className="btn btn-gold" onClick={() => setShowModal(true)}>+ New Case / Matter</button>
      </div>
      <div className="content">
        <div className="grid4" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-label">Active Records</div>
            <div className="stat-value">{activeCases.length}</div>
            <div className="stat-sub">{activeCases.filter(c => isFiled(c)).length} cases · {activeCases.filter(c => !isFiled(c)).length} matters</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Upcoming Deadlines</div>
            <div className="stat-value" style={{ color: upcomingDl.length > 5 ? "#e07a30" : "#e8d5a8" }}>{upcomingDl.length}</div>
            <div className="stat-sub">Next 30 days</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">My Open Tasks</div>
            <div className="stat-value" style={{ color: myTasks.filter(t => daysUntil(t.due) < 0).length > 0 ? "#e05252" : "#e8d5a8" }}>{myTasks.length}</div>
            <div className="stat-sub">{myTasks.filter(t => daysUntil(t.due) < 0).length} overdue</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Trials in 90 Days</div>
            <div className="stat-value" style={{ color: trialSoon.length > 0 ? "#c9a84c" : "#e8d5a8" }}>{trialSoon.length}</div>
            <div className="stat-sub">{allCases.filter(c => c.trialDate).length} with trial dates</div>
          </div>
        </div>
        <div className="grid2" style={{ marginBottom: 20 }}>
          <div className="card">
            <div className="card-header"><div className="card-title">Upcoming Deadlines</div><span style={{ fontSize: 12, color: "#556677" }}>30 days</span></div>
            {upcomingDl.length === 0 && <div className="empty">No upcoming deadlines</div>}
            {upcomingDl.slice(0, 7).map(d => {
              const days = daysUntil(d.date); const col = urgencyColor(days);
              const cs = allCases.find(c => c.id === d.caseId);
              return (
                <div key={d.id} className="deadline-item">
                  <div className="dl-dot" style={{ background: col }} />
                  <div className="dl-info"><div className="dl-title">{d.title}</div><div className="dl-case">{cs?.title?.slice(0, 40) || `#${d.caseId}`}</div></div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: col, fontSize: 12, fontWeight: 700 }}>{days === 0 ? "Today" : `${days}d`}</div>
                    <div style={{ fontSize: 11, color: "#445566" }}>{fmt(d.date)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="card">
            <div className="card-header"><div className="card-title">Trials Within 90 Days</div></div>
            {trialSoon.length === 0 && <div className="empty">No trials in the next 90 days</div>}
            {trialSoon.slice(0, 6).map(c => {
              const days = daysUntil(c.trialDate); const col = urgencyColor(days);
              return (
                <div key={c.id} className="deadline-item" style={{ cursor: "pointer" }} onClick={() => onSelectCase(c)}>
                  <div className="dl-dot" style={{ background: col }} />
                  <div className="dl-info"><div className="dl-title" style={{ fontSize: 13 }}>{c.title}</div><div className="dl-case">{c.caseNum}{c.judge ? ` · ${c.judge}` : ""}</div></div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: col, fontSize: 12, fontWeight: 700 }}>{days}d</div>
                    <div style={{ fontSize: 11, color: "#445566" }}>{fmt(c.trialDate)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {myTasks.length > 0 && (
          <div className="card">
            <div className="card-header"><div className="card-title">My Tasks</div><Badge label={`${myTasks.length} open`} /></div>
            {myTasks.slice(0, 10).map(t => {
              const days = daysUntil(t.due);
              const cs = allCases.find(c => c.id === t.caseId);
              const ep = getEffectivePriority(t);
              const isExpanded = expandedTask === t.id;
              return (
                <div key={t.id} className="deadline-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 0, padding: "10px 16px", cursor: "default" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="checkbox" onClick={() => onCompleteTask(t.id)} title="Mark complete" />
                    <div className="dl-dot" style={{ background: urgencyColor(days), flexShrink: 0 }} />
                    <div className="dl-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="dl-title">{t.title}{t.recurring && <span className="rec-badge">🔁</span>}{t.isChained && <span className="chain-badge">⛓</span>}</div>
                      <div className="dl-case">{cs?.title?.slice(0, 45) || `#${t.caseId}`}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <Badge label={ep} />
                      <div style={{ fontSize: 11, color: days < 0 ? "#e05252" : "#445566" }}>{fmt(t.due)}</div>
                      <button
                        onClick={() => setExpandedTask(isExpanded ? null : t.id)}
                        style={{ background: "none", border: "none", color: "#445566", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}
                        title="Edit task"
                      >{isExpanded ? "▲" : "✎"}</button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="task-inline-edit" style={{ paddingLeft: 44, marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: "#556677" }}>Due</label>
                      <input
                        type="date"
                        value={t.due || ""}
                        onChange={e => onUpdateTask(t.id, { due: e.target.value })}
                      />
                      <label style={{ fontSize: 11, color: "#556677" }}>Priority</label>
                      <select
                        value={t.priority}
                        onChange={e => onUpdateTask(t.id, { priority: e.target.value })}
                      >
                        {["Urgent", "High", "Medium", "Low"].map(p => <option key={p}>{p}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ─── Cases View ───────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

function CasesView({ currentUser, allCases, tasks, selectedCase, setSelectedCase, onAddRecord, onUpdateCase, onCompleteTask, deadlines, caseNotes, setCaseNotes, caseLinks, setCaseLinks, caseActivity, setCaseActivity }) {
  const [typeFilter, setTypeFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("Active");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [attyFilter, setAttyFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [sortCol, setSortCol] = useState("title");
  const [sortDir, setSortDir] = useState("asc");

  // Load notes/links/activity from API when a case is opened
  useEffect(() => {
    if (!selectedCase) return;
    const caseId = selectedCase.id;
    Promise.all([
      apiGetNotes(caseId),
      apiGetLinks(caseId),
      apiGetActivity(caseId),
    ]).then(([notes, links, activity]) => {
      setCaseNotes(prev => ({ ...prev, [caseId]: notes }));
      setCaseLinks(prev => ({ ...prev, [caseId]: links }));
      setCaseActivity(prev => ({ ...prev, [caseId]: activity }));
    }).catch(err => console.error("Failed to load case data:", err));
  }, [selectedCase?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (col) => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } };

  const filtered = useMemo(() => {
    let list = allCases.filter(c => {
      if (statusFilter !== "All" && c.status !== statusFilter) return false;
      if (typeFilter === "Case" && !isFiled(c)) return false;
      if (typeFilter === "Matter" && isFiled(c)) return false;
      if (attyFilter !== "All" && c.leadAttorney !== Number(attyFilter) && c.secondAttorney !== Number(attyFilter)) return false;
      if (search) {
        const q = search.toLowerCase();
        return c.title?.toLowerCase().includes(q) || (c.caseNum || "").toLowerCase().includes(q) || (c.client || "").toLowerCase().includes(q) || (c.plaintiff || "").toLowerCase().includes(q) || (c.fileNum || "").toLowerCase().includes(q) || (c.claimNum || "").toLowerCase().includes(q);
      }
      return true;
    });
    list.sort((a, b) => {
      let av = "", bv = "";
      if (sortCol === "title") { av = a.title || ""; bv = b.title || ""; }
      else if (sortCol === "caseNum") { av = a.caseNum || ""; bv = b.caseNum || ""; }
      else if (sortCol === "client") { av = a.client || ""; bv = b.client || ""; }
      else if (sortCol === "stage") { av = a.stage || ""; bv = b.stage || ""; }
      else if (sortCol === "trialDate") { av = a.trialDate || "9999"; bv = b.trialDate || "9999"; }
      else if (sortCol === "type") { av = recordType(a); bv = recordType(b); }
      else if (sortCol === "lead") { av = getUserById(a.leadAttorney)?.name || ""; bv = getUserById(b.leadAttorney)?.name || ""; }
      return (sortDir === "asc" ? 1 : -1) * av.localeCompare(bv);
    });
    return list;
  }, [allCases, statusFilter, typeFilter, attyFilter, search, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [search, statusFilter, typeFilter, attyFilter, sortCol]);

  const caseTasks = useMemo(() => selectedCase ? tasks.filter(t => t.caseId === selectedCase.id) : [], [tasks, selectedCase]);
  const caseDeadlines = useMemo(() => selectedCase ? deadlines.filter(d => d.caseId === selectedCase.id) : [], [deadlines, selectedCase]);
  const notes = selectedCase ? (caseNotes[selectedCase.id] || []) : [];
  const [showPrint, setShowPrint] = useState(false);

  return (
    <>
      {showModal && <NewCaseModal onSave={onAddRecord} onClose={() => setShowModal(false)} />}
      {showPrint && selectedCase && (
        <CasePrintView c={selectedCase} notes={notes} tasks={caseTasks} deadlines={caseDeadlines} links={caseLinks[selectedCase.id] || []} onClose={() => setShowPrint(false)} />
      )}
      <div className="topbar">
        <div>
          <div className="topbar-title">Cases & Matters</div>
          <div className="topbar-subtitle">{filtered.length} of {allCases.length} · {allCases.filter(c => isFiled(c) && c.status === "Active").length} active cases · {allCases.filter(c => !isFiled(c) && c.status === "Active").length} active matters</div>
        </div>
        <div className="topbar-actions">
          <select style={{ width: 160 }} value={attyFilter} onChange={e => setAttyFilter(e.target.value)}>
            <option value="All">All Attorneys</option>
            {USERS.filter(u => u.role === "Shareholder" || u.role === "Associate").map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input style={{ width: 200 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn btn-gold" onClick={() => setShowModal(true)}>+ New Case / Matter</button>
        </div>
      </div>
      <div className="content">
        <div className="tabs">
          {["All", "Active", "Closed"].map(s => <div key={s} className={`tab ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>{s}</div>)}
          <div className="tab-divider" />
          {["All", "Case", "Matter"].map(t => <div key={t} className={`tab ${typeFilter === t ? "active" : ""}`} onClick={() => setTypeFilter(t)}>{t}</div>)}
        </div>
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortTh col="type" label="Type" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="caseNum" label="Case Number" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="title" label="Style" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <th>File #</th>
                  <SortTh col="client" label="Client" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="stage" label="Stage" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="trialDate" label="Trial Date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="lead" label="Lead" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {paged.map(c => (
                  <tr key={c.id} className={`clickable-row ${selectedCase?.id === c.id ? "selected-row" : ""}`} onClick={() => setSelectedCase(selectedCase?.id === c.id ? null : c)}>
                    <td><Badge label={recordType(c)} /></td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "#c9a84c", whiteSpace: "nowrap" }}>{c.caseNum || "—"}</td>
                    <td><div style={{ color: "#ccd6e8", fontWeight: 600, fontSize: 13 }}>{c.title}</div>{c.plaintiff && <div style={{ fontSize: 11, color: "#445566" }}>Pltf: {c.plaintiff}</div>}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, color: "#7788aa" }}>{c.fileNum || "—"}</td>
                    <td style={{ fontSize: 12, color: "#7788aa" }}>{c.client || "—"}{c.claimNum && <div style={{ fontSize: 10, color: "#445566" }}>Claim: {c.claimNum}</div>}</td>
                    <td><Badge label={c.stage} /></td>
                    <td style={{ color: c.trialDate ? urgencyColor(daysUntil(c.trialDate)) : "#445566", fontSize: 12, whiteSpace: "nowrap" }}>{fmt(c.trialDate)}</td>
                    <td><Avatar userId={c.leadAttorney} size={26} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paged.length === 0 && <div className="empty">No records match your filters.</div>}
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <span>{filtered.length} results · Page {page} of {totalPages}</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
                {[...Array(Math.min(totalPages, 7))].map((_, i) => { const p = page <= 4 ? i + 1 : page + i - 3; if (p < 1 || p > totalPages) return null; return <button key={p} className={`page-btn ${page === p ? "active" : ""}`} onClick={() => setPage(p)}>{p}</button>; })}
                <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next →</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedCase && (
        <CaseDetailOverlay
          c={selectedCase}
          currentUser={currentUser}
          tasks={caseTasks}
          deadlines={caseDeadlines}
          notes={notes}
          links={caseLinks[selectedCase.id] || []}
          activity={caseActivity[selectedCase.id] || []}
          onClose={() => setSelectedCase(null)}
          onUpdate={onUpdateCase}
          onCompleteTask={onCompleteTask}
          onAddNote={async (note) => { try { const saved = await apiCreateNote(note); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: [saved, ...(prev[selectedCase.id] || [])] })); } catch (err) { alert("Failed to save note: " + err.message); } }}
          onDeleteNote={async (noteId) => { try { await apiDeleteNote(noteId); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).filter(n => n.id !== noteId) })); } catch (err) { alert("Failed to delete note: " + err.message); } }}
          onAddLink={async (link) => { try { const saved = await apiCreateLink(link); setCaseLinks(prev => ({ ...prev, [selectedCase.id]: [...(prev[selectedCase.id] || []), saved] })); } catch (err) { alert("Failed to save link: " + err.message); } }}
          onDeleteLink={async (linkId) => { try { await apiDeleteLink(linkId); setCaseLinks(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).filter(l => l.id !== linkId) })); } catch (err) { alert("Failed to delete link: " + err.message); } }}
          onLogActivity={async (entry) => { try { const saved = await apiCreateActivity(entry); setCaseActivity(prev => ({ ...prev, [selectedCase.id]: [saved, ...(prev[selectedCase.id] || [])] })); } catch (err) { console.error("Failed to log activity:", err); } }}
        />
      )}
    </>
  );
}

// ─── Case Detail Overlay ──────────────────────────────────────────────────────
// Field definitions: key = JS property name, label = display name, type = input type
const CORE_FIELDS = [
  // Details section
  { key: "title",      label: "Style / Title",      type: "text",   section: "details" },
  { key: "caseNum",    label: "Case Number",         type: "text",   section: "details" },
  { key: "fileNum",    label: "File Number",         type: "text",   section: "details" },
  { key: "client",     label: "Client",              type: "text",   section: "details" },
  { key: "insured",    label: "Insured",              type: "text",   section: "details" },
  { key: "plaintiff",  label: "Plaintiff Attorney",  type: "text",   section: "details" },
  { key: "claimNum",   label: "Claim Number",        type: "text",   section: "details" },
  { key: "claimSpec",  label: "Claim Specialist",    type: "text",   section: "details" },
  { key: "judge",      label: "Judge",               type: "text",   section: "details" },
  { key: "mediator",   label: "Mediator",            type: "text",   section: "details" },
  { key: "status",     label: "Status",              type: "select", section: "details", options: ["Active", "Closed", "Pending"] },
  { key: "stage",      label: "Stage",               type: "select", section: "details", options: ["Pleadings", "Post-Answer", "Written Discovery", "Depositions", "Expert Discovery", "Pre-Trial", "Trial Set", "Appeal", "Closed"] },
  // Dates section
  { key: "dol",          label: "Date of Loss",          type: "date", section: "dates" },
  { key: "answerFiled",  label: "Answer Filed",           type: "date", section: "dates" },
  { key: "writtenDisc",  label: "Written Discovery",      type: "date", section: "dates" },
  { key: "partyDepo",    label: "Party Depositions",      type: "date", section: "dates" },
  { key: "expertDepo",   label: "Expert Depositions",     type: "date", section: "dates" },
  { key: "mediation",    label: "Mediation Date",         type: "date", section: "dates" },
  { key: "trialDate",    label: "Trial Date",             type: "date", section: "dates" },
  // Team section
  { key: "leadAttorney",   label: "Lead Attorney",   type: "user",   section: "team" },
  { key: "secondAttorney", label: "2nd Attorney",    type: "user",   section: "team" },
  { key: "paralegal",      label: "Paralegal",       type: "user",   section: "team" },
];

const isAttorney = (user) => user.role === "Shareholder" || user.role === "Associate";

function EditField({ fieldKey, label, type, options, value, onChange, onBlur, onRemove, canRemove, isCustom }) {
  const displayVal = type === "date" ? (value || "") : (value ?? "");
  const userVal = type === "user" ? (value || "") : undefined;

  return (
    <div className="edit-field">
      <div className="edit-field-key">{label}</div>
      <div className="edit-field-val">
        {type === "select" && (
          <select value={displayVal} onChange={e => onChange(e.target.value)}>
            <option value="">—</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
        {type === "user" && (
          <select value={userVal} onChange={e => onChange(Number(e.target.value))}>
            <option value="">— None —</option>
            {USERS.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        )}
        {type === "date" && (
          <input type="date" value={displayVal} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
        )}
        {type === "text" && (
          <input type="text" value={displayVal} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder="—" />
        )}
        {type === "custom" && (
          <input type="text" value={displayVal} onChange={e => onChange(e.target.value)} onBlur={onBlur} placeholder="Enter value…" />
        )}
      </div>
      {canRemove && (
        <div className="edit-field-actions">
          <button
            onClick={onRemove}
            title="Remove field"
            style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", padding: "2px 6px", borderRadius: 3, fontSize: 13, lineHeight: 1 }}
          >✕</button>
        </div>
      )}
    </div>
  );
}

function CaseDetailOverlay({ c, currentUser, tasks, deadlines, notes, links, activity, onClose, onUpdate, onCompleteTask, onAddNote, onDeleteNote, onAddLink, onDeleteLink, onLogActivity }) {
  const [draft, setDraft] = useState({ ...c });
  const [customFields, setCustomFields] = useState(c._customFields || []);
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [showPrint, setShowPrint] = useState(false);
  const [activeTab, setActiveTab] = useState("details"); // "details" | "activity"
  const canRemove = isAttorney(currentUser);

  // Track "committed" values for blur-based change detection
  const committed = useState({ ...c })[0]; // ref-like: we mutate it directly

  const log = (action, detail) => {
    onLogActivity({
      id: newId(),
      ts: new Date().toISOString(),
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      action,
      detail,
    });
  };

  // Auto-save on draft/customFields change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      onUpdate({ ...draft, _customFields: customFields });
    }, 400);
    return () => clearTimeout(t);
  }, [draft, customFields]); // eslint-disable-line react-hooks/exhaustive-deps

  // Field label lookup for human-readable log entries
  const fieldLabel = (key) => {
    const f = CORE_FIELDS.find(f => f.key === key);
    return f ? f.label : key;
  };

  const formatVal = (key, val) => {
    if (!val && val !== 0) return "—";
    const f = CORE_FIELDS.find(f => f.key === key);
    if (f?.type === "date") return fmt(val);
    if (f?.type === "user") return getUserById(Number(val))?.name || val;
    return String(val);
  };

  // On blur: compare current draft value against what was committed, log if changed
  const handleBlur = (key) => {
    const oldVal = committed[key];
    const newVal = draft[key];
    if (String(oldVal ?? "") !== String(newVal ?? "")) {
      log(
        "Field Updated",
        `${fieldLabel(key)} changed from "${formatVal(key, oldVal)}" to "${formatVal(key, newVal)}"`
      );
      committed[key] = newVal;
    }
  };

  const set = (key, val) => setDraft(p => ({ ...p, [key]: val }));

  // For selects/dropdowns: log immediately on change (no blur needed)
  const setAndLog = (key, val) => {
    const oldVal = draft[key];
    setDraft(p => ({ ...p, [key]: val }));
    if (String(oldVal ?? "") !== String(val ?? "")) {
      log(
        "Field Updated",
        `${fieldLabel(key)} changed from "${formatVal(key, oldVal)}" to "${formatVal(key, val)}"`
      );
      committed[key] = val;
    }
  };

  const detailFields = CORE_FIELDS.filter(f => f.section === "details");
  const dateFields   = CORE_FIELDS.filter(f => f.section === "dates");
  const teamFields   = CORE_FIELDS.filter(f => f.section === "team");

  const addCustomField = () => {
    if (!newFieldLabel.trim()) return;
    const label = newFieldLabel.trim();
    setCustomFields(p => [...p, { id: newId(), label, value: "" }]);
    setNewFieldLabel("");
    setAddingField(false);
    log("Field Added", `Custom field "${label}" added`);
  };

  const removeCustomField = (id) => {
    const field = customFields.find(f => f.id === id);
    setCustomFields(p => p.filter(f => f.id !== id));
    if (field) log("Field Removed", `Custom field "${field.label}" removed`);
  };

  const updateCustomField = (id, val) => {
    setCustomFields(p => p.map(f => f.id === id ? { ...f, value: val } : f));
  };

  const handleCustomBlur = (id) => {
    const field = customFields.find(f => f.id === id);
    if (!field) return;
    const prev = (c._customFields || []).find(f => f.id === id);
    const oldVal = prev?.value ?? "";
    if (oldVal !== field.value) {
      log("Field Updated", `"${field.label}" changed from "${oldVal || "—"}" to "${field.value || "—"}"`);
    }
  };

  // Wrap onCompleteTask to also log
  const handleComplete = (taskId) => {
    const t = tasks.find(t => t.id === taskId);
    onCompleteTask(taskId);
    if (t) {
      const completing = t.status !== "Completed";
      log(
        completing ? "Task Completed" : "Task Reopened",
        `"${t.title}" marked ${completing ? "complete" : "incomplete"}`
      );
    }
  };

  // Wrap link handlers to log
  const handleAddLink = (link) => {
    onAddLink(link);
    log("File Link Added", `"${link.label}" linked (${link.category})`);
  };
  const handleDeleteLink = (linkId) => {
    const link = links.find(l => l.id === linkId);
    onDeleteLink(linkId);
    if (link) log("File Link Removed", `"${link.label}" removed`);
  };

  // Timestamp formatter for activity tab
  const fmtTs = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const actionColor = (action) => {
    if (action.includes("Completed")) return "#4CAE72";
    if (action.includes("Removed") || action.includes("Reopened")) return "#e05252";
    if (action.includes("Added") || action.includes("Created")) return "#c9a84c";
    return "#5599cc";
  };

  return (
    <>
      {showPrint && (
        <CasePrintView c={draft} notes={notes} tasks={tasks} deadlines={deadlines} links={links} onClose={() => setShowPrint(false)} />
      )}
      <div className="case-overlay">

        {/* Header */}
        <div className="case-overlay-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <Badge label={recordType(draft)} />
              <Badge label={draft.status} />
              {draft.caseNum && <span style={{ fontSize: 11, color: "#c9a84c", fontFamily: "monospace" }}>{draft.caseNum}</span>}
              <span style={{ fontSize: 11, color: "#445566" }}>Auto-saving</span>
            </div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, color: "#e8d5a8", fontWeight: 600, lineHeight: 1.2 }}>
              {draft.title || "Untitled"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0, alignItems: "flex-start" }}>
            <button className="btn btn-outline btn-sm" onClick={() => setShowPrint(true)}>🖨 Print</button>
            <button className="btn btn-outline btn-sm" style={{ fontSize: 16, lineHeight: 1, padding: "4px 10px" }} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="case-overlay-tabs">
          <div className={`case-overlay-tab ${activeTab === "details" ? "active" : ""}`} onClick={() => setActiveTab("details")}>Details</div>
          <div className={`case-overlay-tab ${activeTab === "activity" ? "active" : ""}`} onClick={() => setActiveTab("activity")}>
            Activity {activity.length > 0 && <span style={{ fontSize: 10, color: "#445566", marginLeft: 4 }}>({activity.length})</span>}
          </div>
        </div>

        {/* ── Details Tab ── */}
        {activeTab === "details" && (
          <div className="case-overlay-body">

            {/* Two-column: Details + Key Dates */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 48px", marginBottom: 32 }}>

              <div className="case-overlay-section">
                <div className="case-overlay-section-title">Case Details</div>
                {detailFields.map(f => (
                  <EditField
                    key={f.key}
                    fieldKey={f.key}
                    label={f.label}
                    type={f.type}
                    options={f.options}
                    value={draft[f.key]}
                    onChange={val => f.type === "select" || f.type === "user" ? setAndLog(f.key, val) : set(f.key, val)}
                    onBlur={() => (f.type === "text") && handleBlur(f.key)}
                    canRemove={false}
                  />
                ))}
              </div>

              <div className="case-overlay-section">
                <div className="case-overlay-section-title">Key Dates</div>
                {dateFields.map(f => {
                  const days = draft[f.key] ? daysUntil(draft[f.key]) : null;
                  return (
                    <div key={f.key} className="edit-field">
                      <div className="edit-field-key">{f.label}</div>
                      <div className="edit-field-val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="date"
                          value={draft[f.key] || ""}
                          onChange={e => set(f.key, e.target.value)}
                          onBlur={() => handleBlur(f.key)}
                          style={{ flex: 1 }}
                        />
                        {draft[f.key] && days !== null && (
                          <span style={{ fontSize: 11, color: urgencyColor(days), whiteSpace: "nowrap", fontWeight: 600 }}>
                            {days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? "Today" : `${days}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Team */}
            <div className="case-overlay-section" style={{ maxWidth: 500 }}>
              <div className="case-overlay-section-title">Team</div>
              {teamFields.map(f => (
                <EditField
                  key={f.key}
                  fieldKey={f.key}
                  label={f.label}
                  type={f.type}
                  value={draft[f.key]}
                  onChange={val => setAndLog(f.key, val)}
                  canRemove={false}
                />
              ))}
            </div>

            {/* Custom Fields */}
            <div className="case-overlay-section" style={{ maxWidth: 600 }}>
              <div className="case-overlay-section-title">
                <span>Additional Fields</span>
                <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={() => setAddingField(s => !s)}>
                  {addingField ? "Cancel" : "+ Add Field"}
                </button>
              </div>
              {addingField && (
                <div className="add-field-row" style={{ marginBottom: 12 }}>
                  <input
                    placeholder="Field name (e.g. Policy Limit, Adjuster Phone)"
                    value={newFieldLabel}
                    onChange={e => setNewFieldLabel(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addCustomField()}
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <button className="btn btn-gold" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={addCustomField}>Add</button>
                </div>
              )}
              {customFields.length === 0 && !addingField && (
                <div style={{ fontSize: 12, color: "#445566", fontStyle: "italic" }}>No additional fields. Click "+ Add Field" to track anything not listed above.</div>
              )}
              {customFields.map(f => (
                <EditField
                  key={f.id}
                  fieldKey={f.id}
                  label={f.label}
                  type="custom"
                  value={f.value}
                  onChange={val => updateCustomField(f.id, val)}
                  onBlur={() => handleCustomBlur(f.id)}
                  onRemove={() => canRemove ? removeCustomField(f.id) : alert("Only attorneys can remove fields.")}
                  canRemove={canRemove}
                  isCustom
                />
              ))}
            </div>

            <div style={{ borderTop: "1px solid #1a2235", margin: "8px 0 32px" }} />

            {/* Three-column: Deadlines | Tasks | Notes */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: "0 32px" }}>
              <div className="case-overlay-section">
                <div className="case-overlay-section-title">Deadlines ({deadlines.length})</div>
                {deadlines.length === 0 && <div style={{ fontSize: 12, color: "#445566" }}>None on record.</div>}
                {[...deadlines].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(d => {
                  const days = daysUntil(d.date); const col = urgencyColor(days);
                  return (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #141c2b" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#ccd6e8" }}>{d.title}</div>
                        {d.type && <div style={{ fontSize: 10, color: "#445566" }}>{d.type}</div>}
                      </div>
                      <div style={{ fontSize: 12, color: col, whiteSpace: "nowrap", textAlign: "right" }}>
                        <div>{fmt(d.date)}</div>
                        {days !== null && <div style={{ fontSize: 10 }}>{days < 0 ? `${Math.abs(days)}d over` : `${days}d`}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="case-overlay-section">
                <div className="case-overlay-section-title">Tasks ({tasks.filter(t => t.status !== "Completed").length} open)</div>
                {tasks.length === 0 && <div style={{ fontSize: 12, color: "#445566" }}>No tasks yet.</div>}
                {tasks.map(t => {
                  const done = t.status === "Completed"; const days = daysUntil(t.due);
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid #141c2b", opacity: done ? 0.45 : 1 }}>
                      <div className={`checkbox ${done ? "done" : ""}`} style={{ marginTop: 2 }} onClick={() => handleComplete(t.id)}>{done && "✓"}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "#ccd6e8", textDecoration: done ? "line-through" : "none", lineHeight: 1.3 }}>
                          {t.title}
                          {t.recurring && <span className="rec-badge">🔁</span>}
                          {t.isChained && <span className="chain-badge">⛓</span>}
                        </div>
                        <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                          <Badge label={getEffectivePriority(t)} />
                          <span style={{ fontSize: 10, color: days < 0 && !done ? "#e05252" : "#445566" }}>
                            {fmt(t.due)}{days < 0 && !done ? ` (${Math.abs(days)}d over)` : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="case-overlay-section">
                <CaseNotes caseId={c.id} notes={notes} currentUser={currentUser} onAddNote={onAddNote} onDeleteNote={onDeleteNote} />
              </div>
            </div>

            {/* File Links */}
            <div style={{ borderTop: "1px solid #1a2235", marginTop: 8, paddingTop: 28 }}>
              <CaseFileLinks
                caseId={c.id}
                links={links}
                currentUser={currentUser}
                onAddLink={handleAddLink}
                onDeleteLink={handleDeleteLink}
              />
            </div>
          </div>
        )}

        {/* ── Activity Tab ── */}
        {activeTab === "activity" && (
          <div className="case-overlay-body">
            <div className="case-overlay-section">
              <div className="case-overlay-section-title" style={{ marginBottom: 20 }}>
                <span>Case Activity</span>
                <span style={{ fontSize: 11, color: "#445566", fontWeight: 400 }}>{activity.length} event{activity.length !== 1 ? "s" : ""}</span>
              </div>

              {activity.length === 0 && (
                <div style={{ fontSize: 13, color: "#445566", fontStyle: "italic", padding: "20px 0" }}>
                  No activity recorded yet. Changes to this case will appear here.
                </div>
              )}

              {activity.map((entry, i) => (
                <div key={entry.id} className="activity-entry">
                  <div className="activity-avatar-col">
                    <Avatar userId={entry.userId} size={28} />
                    {i < activity.length - 1 && <div className="activity-line" />}
                  </div>
                  <div className="activity-body">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                        background: "#111a2c", border: `1px solid ${actionColor(entry.action)}44`,
                        color: actionColor(entry.action),
                      }}>{entry.action}</span>
                      <span style={{ fontSize: 12, color: "#ccd6e8", fontWeight: 500 }}>{entry.userName}</span>
                      <span style={{ fontSize: 11, color: "#445566" }}>{entry.userRole}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#aabbcc", marginBottom: 4, lineHeight: 1.5 }}>{entry.detail}</div>
                    <div style={{ fontSize: 11, color: "#445566" }}>{fmtTs(entry.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </>
  );
}

// ─── CaseFileLinks Component ──────────────────────────────────────────────────
// Stores local file path strings (not file contents) — user pastes or types a
// path and it's saved as a clickable link that opens via the file:// protocol.
const LINK_CATEGORIES = ["General", "Pleadings", "Discovery", "Medical Records", "Correspondence", "Photographs", "Expert Reports", "Settlement", "Court Orders", "Other"];

function CaseFileLinks({ caseId, links, currentUser, onAddLink, onDeleteLink }) {
  const [showForm, setShowForm] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newCat, setNewCat] = useState("General");

  const handleAdd = () => {
    const path = newPath.trim();
    if (!path) return;
    // Derive a display label from the filename if none provided
    const label = newLabel.trim() || path.split(/[\\/]/).pop() || path;
    onAddLink({
      id: newId(),
      caseId,
      path,
      label,
      category: newCat,
      addedBy: currentUser.name,
      addedAt: new Date().toISOString(),
    });
    setNewPath("");
    setNewLabel("");
    setNewCat("General");
    setShowForm(false);
  };

  const openLink = (path) => {
    // Normalise backslashes → forward slashes for file:// URI
    const uri = "file:///" + path.replace(/\\/g, "/").replace(/^\/+/, "");
    window.open(uri, "_blank");
  };

  // Derive a file-type icon from the extension
  const linkIcon = (path) => {
    const ext = (path || "").split(".").pop().toLowerCase();
    const map = { pdf: "📄", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊", ppt: "📋", pptx: "📋", txt: "📃", csv: "📊", jpg: "🖼️", jpeg: "🖼️", png: "🖼️", gif: "🖼️", msg: "📧", eml: "📧", zip: "🗜️" };
    return map[ext] || "📎";
  };

  return (
    <div className="case-overlay-section">
      <div className="case-overlay-section-title" style={{ marginBottom: 14 }}>
        <span>Linked Files {links.length > 0 && <span style={{ color: "#445566" }}>({links.length})</span>}</span>
        <button
          className="btn btn-outline btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => setShowForm(s => !s)}
        >{showForm ? "Cancel" : "+ Add Link"}</button>
      </div>

      {showForm && (
        <div style={{ background: "#0d1520", border: "1px solid #1a2235", borderRadius: 7, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "#556677", display: "block", marginBottom: 4 }}>File Path *</label>
            <input
              autoFocus
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="e.g. C:\Cases\Smith v Jones\Complaint.pdf or /Users/ben/cases/file.pdf"
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
            />
            <div style={{ fontSize: 10, color: "#445566", marginTop: 4 }}>Paste the full path to the file on your computer or network drive.</div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "#556677", display: "block", marginBottom: 4 }}>Display Name <span style={{ color: "#445566" }}>(optional)</span></label>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="Defaults to filename"
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#556677", display: "block", marginBottom: 4 }}>Category</label>
              <select value={newCat} onChange={e => setNewCat(e.target.value)} style={{ height: 36 }}>
                {LINK_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={handleAdd} disabled={!newPath.trim()}>Add Link</button>
            <button className="btn btn-outline" style={{ fontSize: 12 }} onClick={() => { setShowForm(false); setNewPath(""); setNewLabel(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {links.length === 0 && !showForm && (
        <div style={{ fontSize: 12, color: "#445566", fontStyle: "italic" }}>
          No linked files yet. Click "+ Add Link" to paste a local or network file path.
        </div>
      )}

      {links.length > 0 && (
        <div style={{ background: "#0a0e16", border: "1px solid #1a2235", borderRadius: 6, overflow: "hidden" }}>
          {links.map((link, i) => (
            <div key={link.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < links.length - 1 ? "1px solid #141c2b" : "none", transition: "background 0.12s" }}
              onMouseEnter={e => e.currentTarget.style.background = "#111a2c"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ fontSize: 18, flexShrink: 0, width: 26, textAlign: "center" }}>{linkIcon(link.path)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  onClick={() => openLink(link.path)}
                  title={link.path}
                  style={{ fontSize: 13, color: "#ccd6e8", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#c9a84c"; e.currentTarget.style.textDecoration = "underline"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "#ccd6e8"; e.currentTarget.style.textDecoration = "none"; }}
                >
                  {link.label}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: "#445566", background: "#1a2235", border: "1px solid #2a3650", borderRadius: 3, padding: "1px 5px" }}>{link.category}</span>
                  <span style={{ fontSize: 10, color: "#334455", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }} title={link.path}>{link.path}</span>
                </div>
                <div style={{ fontSize: 10, color: "#445566", marginTop: 2 }}>Added by {link.addedBy} · {new Date(link.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
              </div>
              <button
                onClick={() => window.confirm(`Remove link to "${link.label}"?`) && onDeleteLink(link.id)}
                style={{ background: "none", border: "none", color: "#445566", cursor: "pointer", padding: "4px 6px", fontSize: 14, flexShrink: 0, lineHeight: 1 }}
                title="Remove link"
                onMouseEnter={e => e.currentTarget.style.color = "#e05252"}
                onMouseLeave={e => e.currentTarget.style.color = "#445566"}
              >🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Note type config ─────────────────────────────────────────────────────────
const NOTE_TYPES = [
  { label: "General",          color: "#7788aa", bg: "#1e2030" },
  { label: "Attorney Note",    color: "#c9a84c", bg: "#2a2010" },
  { label: "Client Contact",   color: "#5599cc", bg: "#102030" },
  { label: "Claim Specialist", color: "#44bbaa", bg: "#102020" },
  { label: "Mediation",        color: "#a066cc", bg: "#201030" },
  { label: "Court / Hearing",  color: "#e07a30", bg: "#2a1800" },
  { label: "Investigation",    color: "#4CAE72", bg: "#0f2a18" },
  { label: "Medical",          color: "#e05252", bg: "#2a0f0f" },
  { label: "Settlement",       color: "#d4b560", bg: "#241e08" },
  { label: "Internal",         color: "#556677", bg: "#111820" },
];

const noteTypeStyle = (label) => NOTE_TYPES.find(t => t.label === label) || NOTE_TYPES[0];

// ─── CaseNotes Component ──────────────────────────────────────────────────────
function CaseNotes({ caseId, notes, currentUser, onAddNote, onDeleteNote }) {
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState({ type: "General", body: "" });

  const handleAdd = () => {
    if (!form.body.trim()) return;
    onAddNote({
      id: newId(),
      caseId,
      type: form.type,
      body: form.body.trim(),
      authorId: currentUser.id,
      authorName: currentUser.name,
      authorRole: currentUser.role,
      createdAt: new Date().toISOString(),
    });
    setForm({ type: "General", body: "" });
    setShowForm(false);
  };

  return (
    <div className="panel-section">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="panel-section-title" style={{ marginBottom: 0 }}>
          Notes {notes.length > 0 && <span style={{ color: "#445566" }}>({notes.length})</span>}
        </div>
        <button
          className="btn btn-outline btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => { setShowForm(s => !s); setExpandedId(null); }}
        >
          {showForm ? "Cancel" : "+ Add Note"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={{ background: "#0d1117", border: "1px solid #2a3650", borderRadius: 7, padding: 14, marginBottom: 12 }}>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Note Type</label>
            <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
              {NOTE_TYPES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Note</label>
            <textarea
              rows={5}
              value={form.body}
              onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
              placeholder="Enter detailed note here…"
              style={{ resize: "vertical" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={handleAdd} disabled={!form.body.trim()}>
              Save Note
            </button>
            <span style={{ fontSize: 11, color: "#445566" }}>
              Will be recorded as {currentUser.name} · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
        </div>
      )}

      {/* Notes list */}
      {notes.length === 0 && !showForm && (
        <div style={{ fontSize: 12, color: "#445566", fontStyle: "italic" }}>No notes yet. Click "+ Add Note" to create the first one.</div>
      )}
      {notes.length > 0 && (
        <div style={{ background: "#0a0e16", border: "1px solid #1a2235", borderRadius: 6, overflow: "hidden" }}>
          {notes.map((note, i) => {
            const ts = noteTypeStyle(note.type);
            const dt = new Date(note.createdAt);
            const dateStr = dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const timeStr = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            const isExpanded = expandedId === note.id;
            const preview = note.body.length > 80 ? note.body.slice(0, 80) + "…" : note.body;

            return (
              <div
                key={note.id}
                className={`note-item ${isExpanded ? "expanded" : ""}`}
                onClick={() => setExpandedId(isExpanded ? null : note.id)}
              >
                {/* Collapsed header — always visible */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: isExpanded ? 10 : 4 }}>
                  <span
                    className="note-type-badge"
                    style={{ background: ts.bg, color: ts.color, border: `1px solid ${ts.color}44` }}
                  >
                    {note.type}
                  </span>
                  <span style={{ fontSize: 11, color: "#556677", flex: 1 }}>{note.authorName}</span>
                  <span style={{ fontSize: 10, color: "#445566", whiteSpace: "nowrap" }}>{dateStr}</span>
                  <span style={{ fontSize: 10, color: "#2a3650" }}>{isExpanded ? "▲" : "▼"}</span>
                </div>

                {!isExpanded && (
                  <div style={{ fontSize: 12, color: "#556677", paddingLeft: 2, fontStyle: "italic", lineHeight: 1.4 }}>
                    {preview}
                  </div>
                )}

                {/* Expanded body */}
                {isExpanded && (
                  <div>
                    <div style={{ fontSize: 11, color: "#445566", marginBottom: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>👤 {note.authorName} ({note.authorRole})</span>
                      <span>🕐 {dateStr} at {timeStr}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#ccd6e8", lineHeight: 1.7, whiteSpace: "pre-wrap", background: "#060a10", padding: "10px 12px", borderRadius: 5, border: "1px solid #1a2235" }}>
                      {note.body}
                    </div>
                    <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: 11, color: "#e05252", borderColor: "#5a2a2a" }}
                        onClick={e => { e.stopPropagation(); if (window.confirm("Delete this note?")) { onDeleteNote(note.id); setExpandedId(null); } }}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Case Print View (full case file with notes) ──────────────────────────────
function CasePrintView({ c, notes, tasks, deadlines, links, onClose }) {

  const handlePrint = () => {
    const el = document.getElementById("case-print-content");
    const w = window.open("", "_blank", "width=900,height=800");
    w.document.write(`
      <html><head><title>${c.title} — Case File</title>
      <style>
        body { font-family: Georgia, 'Source Sans 3', serif; color: #111; margin: 0; padding: 0; }
        .doc { padding: 60px 72px; max-width: 816px; margin: 0 auto; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #555; margin: 24px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
        .meta { font-size: 11px; color: #777; margin-bottom: 24px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin-bottom: 8px; }
        .ip { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eee; font-size: 12px; }
        .ik { color: #666; min-width: 130px; flex-shrink: 0; }
        .iv { color: #111; font-weight: 500; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
        th { text-align: left; padding: 5px 8px; background: #f5f5f5; border-bottom: 1px solid #bbb; font-size: 11px; color: #555; text-transform: uppercase; }
        td { padding: 5px 8px; border-bottom: 1px solid #eee; }
        .note-block { margin-bottom: 14px; padding: 12px 14px; border: 1px solid #ddd; border-radius: 4px; page-break-inside: avoid; }
        .note-head { display: flex; gap: 12px; align-items: center; margin-bottom: 6px; font-size: 11px; color: #555; }
        .nt { font-weight: 700; color: #333; font-size: 12px; }
        .nb { font-size: 13px; color: #222; line-height: 1.65; white-space: pre-wrap; }
        .footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10px; color: #999; display: flex; justify-content: space-between; }
        @page { margin: 0.75in; }
      </style></head><body>
      ${el.innerHTML}
      </body></html>
    `);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  };

  const lead = getUserById(c.leadAttorney);
  const second = getUserById(c.secondAttorney);
  const para = getUserById(c.paralegal);
  const now = new Date().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="print-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "100%", maxWidth: 860 }}>
        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, padding: "0 4px" }}>
          <div style={{ color: "#ccd6e8", fontSize: 14, fontWeight: 600 }}>📄 Case File Preview — {c.title}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-gold" onClick={handlePrint}>🖨 Print / Save as PDF</button>
            <button className="btn btn-outline" onClick={onClose}>✕ Close</button>
          </div>
        </div>

        {/* Document preview */}
        <div id="case-print-content">
          <div className="print-doc">
            {/* Header */}
            <div style={{ borderBottom: "2px solid #333", paddingBottom: 16, marginBottom: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h1 style={{ marginBottom: 4, fontFamily: "Georgia, serif" }}>{c.title}</h1>
                  <div className="meta">
                    {c.caseNum && <span style={{ marginRight: 16 }}>Case No. {c.caseNum}</span>}
                    {c.fileNum && <span style={{ marginRight: 16 }}>File No. {c.fileNum}</span>}
                    <span>Status: {c.status}</span>
                    {c.stage && <span style={{ marginLeft: 16 }}>Stage: {c.stage}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "#777" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#333", marginBottom: 2 }}>LexTrack</div>
                  <div>Printed {now}</div>
                </div>
              </div>
            </div>

            {/* Case details */}
            <h2>Case Information</h2>
            <div className="info-grid">
              {[
                ["Client", c.client],
                ["Insured", c.insured],
                ["Claim Number", c.claimNum],
                ["Plaintiff Attorney", c.plaintiff],
                ["Claim Specialist", c.claimSpec],
                ["Date of Loss", fmt(c.dol)],
                ["Judge", c.judge],
                ["Mediator", c.mediator],
                ["Lead Attorney", lead?.name],
                ["2nd Attorney", second?.name],
                ["Paralegal", para?.name],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="ip"><span className="ik">{k}</span><span className="iv">{v}</span></div>
              ))}
            </div>

            {/* Key dates */}
            <h2>Key Dates</h2>
            <div className="info-grid">
              {[
                ["Answer Filed", fmt(c.answerFiled)],
                ["Written Discovery", fmt(c.writtenDisc)],
                ["Party Depositions", fmt(c.partyDepo)],
                ["Expert Depositions", fmt(c.expertDepo)],
                ["Mediation", fmt(c.mediation)],
                ["Trial Date", fmt(c.trialDate)],
              ].map(([k, v]) => (
                <div key={k} className="ip"><span className="ik">{k}</span><span className="iv">{v}</span></div>
              ))}
            </div>

            {/* Deadlines */}
            {deadlines.length > 0 && (
              <>
                <h2>Deadlines</h2>
                <table>
                  <thead><tr><th>Deadline</th><th>Type</th><th>Due Date</th><th>Days</th></tr></thead>
                  <tbody>
                    {[...deadlines].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(d => {
                      const days = daysUntil(d.date);
                      return (
                        <tr key={d.id}>
                          <td>{d.title}</td>
                          <td>{d.type || "—"}</td>
                          <td>{fmt(d.date)}</td>
                          <td>{days !== null ? (days < 0 ? `${Math.abs(days)}d overdue` : `${days}d`) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}

            {/* Tasks */}
            {tasks.length > 0 && (
              <>
                <h2>Tasks</h2>
                <table>
                  <thead><tr><th>Task</th><th>Assigned To</th><th>Due</th><th>Status</th><th>Priority</th></tr></thead>
                  <tbody>
                    {[...tasks].sort((a, b) => (a.due || "").localeCompare(b.due || "")).map(t => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>{getUserById(t.assigned)?.name || "—"}</td>
                        <td>{fmt(t.due)}</td>
                        <td>{t.status}</td>
                        <td>{getEffectivePriority(t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Notes */}
            <h2>Notes {notes.length > 0 ? `(${notes.length})` : "(None)"}</h2>
            {notes.length === 0 && <p style={{ fontSize: 12, color: "#777", fontStyle: "italic" }}>No notes on record for this case.</p>}
            {[...notes].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map(note => {
              const dt = new Date(note.createdAt);
              return (
                <div key={note.id} className="note-block">
                  <div className="note-head">
                    <span className="nt">{note.type}</span>
                    <span>·</span>
                    <span>{note.authorName} ({note.authorRole})</span>
                    <span>·</span>
                    <span>{dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <div className="nb">{note.body}</div>
                </div>
              );
            })}

            {/* Linked Files index */}
            {links && links.length > 0 && (
              <>
                <h2>Linked Files ({links.length})</h2>
                <table>
                  <thead><tr><th>Label</th><th>Category</th><th>Path</th><th>Added By</th><th>Date</th></tr></thead>
                  <tbody>
                    {links.map(link => (
                      <tr key={link.id}>
                        <td>{link.label}</td>
                        <td>{link.category || "General"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 10, wordBreak: "break-all" }}>{link.path}</td>
                        <td>{link.addedBy}</td>
                        <td>{new Date(link.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Footer */}
            <div className="footer">
              <span>LexTrack Case Management · Confidential — Attorney Work Product</span>
              <span>Printed {now}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── iCal parser (client-side, no network needed for stored data) ─────────────
function parseICalText(text, calName) {
  const events = [];
  const lines = text.replace(/\r\n /g, "").replace(/\r\n\t/g, "").split(/\r?\n/);
  let inEvent = false, cur = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") { inEvent = true; cur = {}; }
    else if (line === "END:VEVENT") {
      if (cur.date && cur.title) events.push({ ...cur, id: newId(), source: calName, isExternal: true });
      inEvent = false; cur = {};
    } else if (inEvent) {
      if (line.startsWith("SUMMARY:")) cur.title = line.slice(8).trim();
      else if (line.startsWith("DTSTART")) {
        const val = line.includes(":") ? line.split(":").slice(1).join(":") : "";
        const d = val.replace(/T.*/,"");
        if (d.length === 8) cur.date = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
      }
      else if (line.startsWith("DESCRIPTION:")) cur.notes = line.slice(12).trim().slice(0,120);
      else if (line.startsWith("LOCATION:")) cur.location = line.slice(9).trim();
      else if (line.startsWith("UID:")) cur.uid = line.slice(4).trim();
    }
  }
  return events;
}

// ─── Calendar Grid ────────────────────────────────────────────────────────────
function CalendarGrid({ deadlines, allCases, externalEvents }) {
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-indexed
  const [selected, setSelected] = useState(null); // date string "YYYY-MM-DD"

  const monthName = new Date(calYear, calMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Build day grid: always 6 rows × 7 cols
  const firstDow = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const dayNum = i - firstDow + 1;
    if (dayNum < 1 || dayNum > daysInMonth) { cells.push(null); continue; }
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,"0")}-${String(dayNum).padStart(2,"0")}`;
    cells.push(dateStr);
  }

  // Index all events by date
  const eventsByDate = useMemo(() => {
    const map = {};
    const addTo = (dateStr, item) => { if (!map[dateStr]) map[dateStr] = []; map[dateStr].push(item); };
    deadlines.forEach(d => { if (d.date) addTo(d.date, { ...d, kind: "deadline" }); });
    externalEvents.forEach(e => { if (e.date) addTo(e.date, { ...e, kind: "external" }); });
    return map;
  }, [deadlines, externalEvents]);

  const selectedEvents = selected ? (eventsByDate[selected] || []) : [];

  const todayStr = today;
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); setSelected(null); };
  const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); setSelected(null); };

  const chipColor = (item) => {
    if (item.kind === "external") return "#5588cc";
    return urgencyColor(daysUntil(item.date));
  };

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
      {/* Calendar */}
      <div className="card" style={{ flex: 1, minWidth: 0 }}>
        {/* Month nav */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #1a2235", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button className="btn btn-outline btn-sm" onClick={prevMonth}>← Prev</button>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "#e8d5a8", fontWeight: 600 }}>{monthName}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setCalMonth(now.getMonth()); setCalYear(now.getFullYear()); setSelected(todayStr); }}>Today</button>
            <button className="btn btn-outline btn-sm" onClick={nextMonth}>Next →</button>
          </div>
        </div>

        {/* Legend */}
        <div style={{ padding: "8px 18px", borderBottom: "1px solid #1a2235", display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[["#e05252","Overdue"],["#e07a30","≤7 days"],["#c9a84c","≤21 days"],["#4CAE72","Upcoming"],["#5588cc","External Cal"]].map(([col,lbl]) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#556677" }}>{lbl}</span>
            </div>
          ))}
        </div>

        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid #1a2235" }}>
          {DOW.map(d => <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "#556677", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{d}</div>)}
        </div>

        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {cells.map((dateStr, i) => {
            if (!dateStr) return <div key={i} style={{ minHeight: 80, borderRight: "1px solid #141c2b", borderBottom: "1px solid #141c2b", background: "#0a0e16" }} />;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selected;
            const events = eventsByDate[dateStr] || [];
            const dayNum = Number(dateStr.split("-")[2]);
            const borderR = (i + 1) % 7 !== 0 ? "1px solid #141c2b" : "none";
            return (
              <div key={dateStr} onClick={() => setSelected(isSelected ? null : dateStr)}
                style={{ minHeight: 80, borderRight: borderR, borderBottom: "1px solid #141c2b", padding: "6px 7px", cursor: events.length ? "pointer" : "default", background: isSelected ? "#0f1e30" : isToday ? "#121c2c" : "transparent", transition: "background 0.1s", position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? "#c9a84c" : "#556677", width: 22, height: 22, borderRadius: "50%", background: isToday ? "#c9a84c22" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{dayNum}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {events.slice(0, 3).map((ev, ei) => (
                    <div key={ei} style={{ background: chipColor(ev) + "22", border: `1px solid ${chipColor(ev)}55`, borderRadius: 3, padding: "1px 4px", fontSize: 10, color: chipColor(ev), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {ev.title}
                    </div>
                  ))}
                  {events.length > 3 && <div style={{ fontSize: 10, color: "#445566", paddingLeft: 2 }}>+{events.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day detail panel */}
      <div className="card" style={{ width: 300, flexShrink: 0 }}>
        <div className="card-header">
          <div className="card-title">{selected ? fmt(selected) : "Select a date"}</div>
          {selected && <span style={{ fontSize: 12, color: "#556677" }}>{selectedEvents.length} event{selectedEvents.length !== 1 ? "s" : ""}</span>}
        </div>
        {!selected && <div className="empty" style={{ padding: "30px 20px" }}>Click any date to see its deadlines and events.</div>}
        {selected && selectedEvents.length === 0 && <div className="empty" style={{ padding: "30px 20px" }}>No deadlines or events on this date.</div>}
        {selected && selectedEvents.map((ev, i) => {
          const col = chipColor(ev);
          const cs = ev.caseId ? allCases.find(c => c.id === ev.caseId) : null;
          return (
            <div key={i} style={{ padding: "12px 16px", borderBottom: "1px solid #141c2b" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0, marginTop: 3 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#ccd6e8", fontWeight: 600, marginBottom: 3 }}>{ev.title}</div>
                  {ev.kind === "deadline" && cs && <div style={{ fontSize: 11, color: "#556677" }}>{cs.title?.slice(0, 45)}</div>}
                  {ev.kind === "deadline" && ev.type && <Badge label={ev.type} />}
                  {ev.kind === "external" && <div style={{ fontSize: 11, color: "#5588cc", marginTop: 2 }}>📅 {ev.source}</div>}
                  {ev.location && <div style={{ fontSize: 11, color: "#445566", marginTop: 2 }}>📍 {ev.location}</div>}
                  {ev.notes && <div style={{ fontSize: 11, color: "#445566", marginTop: 2, fontStyle: "italic" }}>{ev.notes.slice(0, 80)}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── iCal Feeds Manager ───────────────────────────────────────────────────────
function ICalManager({ externalEvents, setExternalEvents }) {
  const [feeds, setFeeds] = useState([]); // { id, name, url, status, count }
  const [newFeed, setNewFeed] = useState({ name: "", url: "" });
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState("");

  const importFeed = async (feed) => {
    setImporting(feed.id);
    setError("");
    try {
      // Normalize webcal:// → https://
      let url = feed.url.trim().replace(/^webcal:\/\//i, "https://");
      // Use a CORS proxy since browsers can't fetch iCal feeds directly cross-origin
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Not a valid iCal feed");
      const events = parseICalText(text, feed.name);
      setExternalEvents(prev => [...prev.filter(e => e.source !== feed.name), ...events]);
      setFeeds(f => f.map(x => x.id === feed.id ? { ...x, status: "ok", count: events.length, lastSync: new Date().toLocaleTimeString() } : x));
    } catch (e) {
      setFeeds(f => f.map(x => x.id === feed.id ? { ...x, status: "error", error: e.message } : x));
      setError(`Could not import "${feed.name}": ${e.message}. Some calendar providers require you to use their public sharing URL. Try copying the URL directly from your calendar app's "Share" or "Publish" settings.`);
    } finally {
      setImporting(null);
    }
  };

  const addFeed = () => {
    if (!newFeed.name.trim() || !newFeed.url.trim()) return;
    const feed = { id: newId(), name: newFeed.name.trim(), url: newFeed.url.trim(), status: "pending", count: 0 };
    setFeeds(f => [...f, feed]);
    setNewFeed({ name: "", url: "" });
    importFeed(feed);
  };

  const removeFeed = (id, name) => {
    setFeeds(f => f.filter(x => x.id !== id));
    setExternalEvents(prev => prev.filter(e => e.source !== name));
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">📅 Internet Calendar Feeds</div>
          <span style={{ fontSize: 12, color: "#556677" }}>{feeds.length} feed{feeds.length !== 1 ? "s" : ""} · {externalEvents.length} events imported</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: "#7788aa", marginBottom: 16, lineHeight: 1.6 }}>
            Add any iCal/webcal feed URL to overlay external events on the calendar — court dockets, Google Calendar, Outlook, bar association deadlines, etc.
            <br /><span style={{ fontSize: 11, color: "#445566" }}>Tip: In Google Calendar, go to the calendar's settings → "Integrate calendar" → copy the public iCal address. In Outlook, use File → Account Settings → Internet Calendars.</span>
          </div>

          {/* Add feed form */}
          <div style={{ background: "#0d1117", border: "1px solid #2a3650", borderRadius: 7, padding: 16, marginBottom: feeds.length ? 16 : 0 }}>
            <div style={{ fontSize: 12, color: "#c9a84c", fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Add New Calendar Feed</div>
            <div className="form-row" style={{ marginBottom: 10 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Calendar Name</label>
                <input value={newFeed.name} onChange={e => setNewFeed(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Court Docket, Google Calendar" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>iCal / webcal URL</label>
                <input value={newFeed.url} onChange={e => setNewFeed(p => ({ ...p, url: e.target.value }))} placeholder="https://… or webcal://…" />
              </div>
            </div>
            <button className="btn btn-gold" onClick={addFeed} disabled={!newFeed.name.trim() || !newFeed.url.trim()}>
              Import Feed
            </button>
          </div>

          {error && (
            <div style={{ background: "#2a1010", border: "1px solid #5a2020", borderRadius: 6, padding: "10px 14px", marginTop: 12, fontSize: 12, color: "#cc8888", lineHeight: 1.5 }}>
              ⚠ {error}
            </div>
          )}

          {/* Feed list */}
          {feeds.map(feed => (
            <div key={feed.id} style={{ background: "#0d1117", border: "1px solid #2a3650", borderRadius: 7, padding: "12px 14px", marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <div style={{ fontSize: 13, color: "#ccd6e8", fontWeight: 600 }}>{feed.name}</div>
                  {feed.status === "ok" && <span style={{ fontSize: 10, background: "#1a3a2a", color: "#4CAE72", border: "1px solid #2a5a3a", padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>✓ {feed.count} events</span>}
                  {feed.status === "error" && <span style={{ fontSize: 10, background: "#3a1a1a", color: "#e05252", border: "1px solid #6a2a2a", padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>✗ Error</span>}
                  {feed.status === "pending" && <span style={{ fontSize: 10, color: "#556677" }}>Importing…</span>}
                </div>
                <div style={{ fontSize: 11, color: "#445566", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{feed.url}</div>
                {feed.lastSync && <div style={{ fontSize: 10, color: "#2a4a3a", marginTop: 2 }}>Last synced: {feed.lastSync}</div>}
                {feed.status === "error" && feed.error && <div style={{ fontSize: 11, color: "#994444", marginTop: 3 }}>{feed.error}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn btn-outline btn-sm" onClick={() => importFeed(feed)} disabled={importing === feed.id}>
                  {importing === feed.id ? "…" : "↻ Sync"}
                </button>
                <button className="btn btn-outline btn-sm" style={{ color: "#e05252", borderColor: "#5a2a2a" }} onClick={() => removeFeed(feed.id, feed.name)}>✕</button>
              </div>
            </div>
          ))}

          {feeds.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 0 4px", color: "#445566", fontSize: 13 }}>
              No calendar feeds added yet. Paste a webcal or iCal URL above to get started.
            </div>
          )}
        </div>
      </div>

      {/* Help section */}
      <div className="card">
        <div className="card-header"><div className="card-title">Where to find iCal URLs</div></div>
        <div style={{ padding: 20 }}>
          {[
            ["Google Calendar", "Calendar Settings → Integrate calendar → Public address in iCal format"],
            ["Outlook / Microsoft 365", "Calendar → Share → Publish to web → Copy ICS link"],
            ["Apple Calendar (iCloud)", "iCloud.com → Calendar → Share → Copy Public Calendar URL"],
            ["Court Dockets (PACER/Odyssey)", "Check your court's website for a published calendar feed, or use a third-party court-alert service that provides iCal export"],
            ["Bar Association Calendars", "Most state bar websites publish a CLE/events calendar — look for an iCal or .ics download link"],
          ].map(([src, tip]) => (
            <div key={src} style={{ display: "flex", gap: 12, padding: "9px 0", borderBottom: "1px solid #141c2b" }}>
              <div style={{ fontSize: 13, color: "#c9a84c", fontWeight: 600, width: 180, flexShrink: 0 }}>{src}</div>
              <div style={{ fontSize: 12, color: "#7788aa", lineHeight: 1.5 }}>{tip}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Deadlines View ───────────────────────────────────────────────────────────
function DeadlinesView({ deadlines, onAddDeadline, allCases, calcInputs, setCalcInputs, calcResult, runCalc, currentUser }) {
  const [tab, setTab] = useState("calendar");
  const [typeFilter, setTypeFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("asc");
  const [externalEvents, setExternalEvents] = useState([]);
  const [newDl, setNewDl] = useState({ caseId: allCases.find(c => c.status === "Active")?.id || 1, title: "", date: today, type: "Filing", rule: "", assigned: currentUser.id });

  const handleSort = (col) => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } };

  const types = ["All", ...Array.from(new Set(deadlines.map(d => d.type))).sort()];
  const sorted = useMemo(() => {
    let list = deadlines.filter(d => {
      if (typeFilter !== "All" && d.type !== typeFilter) return false;
      if (search) { const q = search.toLowerCase(); const cs = allCases.find(c => c.id === d.caseId); return d.title.toLowerCase().includes(q) || (cs?.title || "").toLowerCase().includes(q) || (cs?.caseNum || "").toLowerCase().includes(q); }
      return true;
    });
    list.sort((a, b) => {
      let av = "", bv = "";
      if (sortCol === "date") { av = a.date || "9999"; bv = b.date || "9999"; }
      else if (sortCol === "title") { av = a.title || ""; bv = b.title || ""; }
      else if (sortCol === "type") { av = a.type || ""; bv = b.type || ""; }
      else if (sortCol === "case") { av = allCases.find(c => c.id === a.caseId)?.title || ""; bv = allCases.find(c => c.id === b.caseId)?.title || ""; }
      return (sortDir === "asc" ? 1 : -1) * av.localeCompare(bv);
    });
    return list;
  }, [deadlines, typeFilter, search, sortCol, sortDir, allCases]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [typeFilter, search, sortCol]);

  return (
    <>
      <div className="topbar">
        <div><div className="topbar-title">Deadline Tracker</div><div className="topbar-subtitle">{deadlines.filter(d => daysUntil(d.date) < 0).length} overdue · {deadlines.filter(d => { const n = daysUntil(d.date); return n >= 0 && n <= 7; }).length} this week · {deadlines.length} total{externalEvents.length ? ` · ${externalEvents.length} external` : ""}</div></div>
      </div>
      <div className="content">
        <div className="tabs">
          {[["calendar","📅 Calendar"], ["list","List View"], ["add","Add Deadline"], ["ical","Internet Calendars"], ["calc","Rules Calculator"]].map(([t, l]) => (
            <div key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{l}</div>
          ))}
        </div>

        {tab === "calendar" && (
          <CalendarGrid deadlines={deadlines} allCases={allCases} externalEvents={externalEvents} />
        )}

        {tab === "list" && (
          <div className="card">
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a2235", display: "flex", gap: 10 }}>
              <select style={{ width: 160 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select>
              <input placeholder="Search deadlines or cases…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 14 }}></th>
                    <SortTh col="title" label="Deadline" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortTh col="case" label="Case / Matter" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortTh col="type" label="Type" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortTh col="date" label="Due Date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <th>Days</th><th>Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(d => {
                    const days = daysUntil(d.date); const col = urgencyColor(days);
                    const cs = allCases.find(c => c.id === d.caseId);
                    return (
                      <tr key={d.id}>
                        <td><div style={{ width: 10, height: 10, borderRadius: "50%", background: col }} /></td>
                        <td><div style={{ color: "#ccd6e8", fontWeight: 600 }}>{d.title}</div>{d.rule && <div style={{ fontSize: 11, color: "#c9a84c", fontFamily: "monospace" }}>{d.rule}</div>}</td>
                        <td style={{ fontSize: 12, color: "#7788aa" }}>{cs?.title?.slice(0, 40) || `#${d.caseId}`}<div style={{ fontSize: 10, color: "#445566" }}>{cs?.caseNum}</div></td>
                        <td><Badge label={d.type} /></td>
                        <td style={{ color: col, fontSize: 13, whiteSpace: "nowrap" }}>{fmt(d.date)}</td>
                        <td style={{ color: col, fontWeight: 700 }}>{days < 0 ? <span style={{ color: "#e05252" }}>{Math.abs(days)}d over</span> : days === 0 ? "Today" : `${days}d`}</td>
                        <td><Avatar userId={d.assigned} size={26} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {paged.length === 0 && <div className="empty">No deadlines match.</div>}
            </div>
            {totalPages > 1 && (
              <div className="pagination">
                <span>{sorted.length} results · Page {page} of {totalPages}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button className="page-btn" onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
                  {[...Array(Math.min(totalPages, 7))].map((_, i) => { const p = page <= 4 ? i + 1 : page + i - 3; if (p < 1 || p > totalPages) return null; return <button key={p} className={`page-btn ${page === p ? "active" : ""}`} onClick={() => setPage(p)}>{p}</button>; })}
                  <button className="page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "add" && (
          <div className="card" style={{ maxWidth: 600 }}>
            <div className="card-header"><div className="card-title">Add New Deadline</div></div>
            <div style={{ padding: 20 }}>
              <div className="form-group"><label>Case / Matter (sorted by style)</label>
                <select value={newDl.caseId} onChange={e => setNewDl(p => ({ ...p, caseId: Number(e.target.value) }))}>
                  {[...allCases].filter(c => c.status === "Active").sort((a, b) => (a.title || "").localeCompare(b.title || "")).map(c => <option key={c.id} value={c.id}>{c.title}{c.caseNum ? ` (${c.caseNum})` : ""}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Deadline Title</label><input value={newDl.title} onChange={e => setNewDl(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Summary Judgment Motion" /></div>
              <div className="form-row">
                <div className="form-group"><label>Due Date</label><input type="date" value={newDl.date} onChange={e => setNewDl(p => ({ ...p, date: e.target.value }))} /></div>
                <div className="form-group"><label>Type</label>
                  <select value={newDl.type} onChange={e => setNewDl(p => ({ ...p, type: e.target.value }))}>
                    {["Filing", "Discovery", "Motion", "Expert", "Pleading", "Hearing", "Trial", "Deposition", "Mediation"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Rule / Authority</label><input value={newDl.rule} onChange={e => setNewDl(p => ({ ...p, rule: e.target.value }))} placeholder="e.g. ARCP 56" /></div>
                <div className="form-group"><label>Assigned To</label>
                  <select value={newDl.assigned} onChange={e => setNewDl(p => ({ ...p, assigned: Number(e.target.value) }))}>
                    {USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              </div>
              <button className="btn btn-gold" onClick={() => { if (!newDl.title || !newDl.date) return; onAddDeadline({ ...newDl }); setNewDl(prev => ({ ...prev, title: "", date: today, rule: "" })); setTab("calendar"); }}>Add Deadline</button>
            </div>
          </div>
        )}

        {tab === "ical" && (
          <ICalManager externalEvents={externalEvents} setExternalEvents={setExternalEvents} />
        )}

        {tab === "calc" && (
          <div style={{ maxWidth: 600 }}>
            <div className="card">
              <div className="card-header"><div className="card-title">Court Rules Calculator</div></div>
              <div style={{ padding: 20 }}>
                <div className="form-group"><label>Select Rule</label>
                  <select value={calcInputs.ruleId} onChange={e => setCalcInputs(p => ({ ...p, ruleId: Number(e.target.value) }))}>
                    {COURT_RULES.map(r => <option key={r.id} value={r.id}>{r.name} ({r.days}d) — {r.rule}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Trigger Date ({COURT_RULES.find(r => r.id === Number(calcInputs.ruleId))?.from})</label>
                  <input type="date" value={calcInputs.fromDate} onChange={e => setCalcInputs(p => ({ ...p, fromDate: e.target.value }))} />
                </div>
                <button className="btn btn-gold" onClick={runCalc}>Calculate</button>
                {calcResult && (
                  <div className="calc-result">
                    <div style={{ fontSize: 11, color: "#c9a84c", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Result</div>
                    <div style={{ fontSize: 24, fontFamily: "'Playfair Display',serif", color: "#e8d5a8", marginBottom: 8 }}>{fmt(calcResult.result)}</div>
                    <div style={{ fontSize: 13, color: "#7788aa" }}><strong style={{ color: "#c9a84c" }}>{calcResult.rule.name}</strong><br />{calcResult.rule.days} days from {fmt(calcResult.from)} · <span style={{ fontFamily: "monospace", fontSize: 12 }}>{calcResult.rule.rule}</span></div>
                    <div style={{ marginTop: 10, fontSize: 12, color: "#e07a30", fontStyle: "italic" }}>⚠ Always verify against court orders and local rules.</div>
                  </div>
                )}
              </div>
            </div>
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header"><div className="card-title">Common Deadlines Reference</div></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Action</th><th>Days</th><th>From</th><th>Rule</th></tr></thead>
                  <tbody>{COURT_RULES.map(r => <tr key={r.id}><td style={{ color: "#ccd6e8" }}>{r.name}</td><td style={{ color: "#c9a84c", fontWeight: 700 }}>{r.days}</td><td style={{ fontSize: 12, color: "#7788aa" }}>{r.from}</td><td style={{ fontFamily: "monospace", fontSize: 11, color: "#556677" }}>{r.rule}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Tasks View ───────────────────────────────────────────────────────────────
function TasksView({ tasks, onAddTask, allCases, currentUser, onCompleteTask, onUpdateTask }) {
  const [filter, setFilter] = useState("All");
  const [showForm, setShowForm] = useState(false);
  const [caseSearch, setCaseSearch] = useState("");
  const [sortCol, setSortCol] = useState("due");
  const [sortDir, setSortDir] = useState("asc");
  const [expandedTask, setExpandedTask] = useState(null);

  const handleSort = (col) => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } };

  const sortedCases = useMemo(() => [...allCases].filter(c => c.status === "Active").sort((a, b) => (a.title || "").localeCompare(b.title || "")), [allCases]);
  const filteredCases = useMemo(() => caseSearch ? sortedCases.filter(c => (c.title || "").toLowerCase().includes(caseSearch.toLowerCase()) || (c.caseNum || "").toLowerCase().includes(caseSearch.toLowerCase())) : sortedCases, [sortedCases, caseSearch]);

  const blank = useMemo(() => ({ caseId: sortedCases[0]?.id || 0, title: "", assigned: currentUser.id, due: addDays(today, 7), priority: "Low", autoEscalate: true, status: "Not Started", notes: "", recurring: false, recurringDays: 30 }), [sortedCases, currentUser.id]);
  const [newTask, setNewTask] = useState({ ...blank });

  const filtered = useMemo(() => {
    let list = tasks.filter(t => {
      if (filter === "Mine") return t.assigned === currentUser.id;
      if (filter === "Overdue") return t.status !== "Completed" && daysUntil(t.due) < 0;
      if (filter === "Urgent") return ["Urgent", "High"].includes(getEffectivePriority(t)) && t.status !== "Completed";
      if (filter === "Recurring") return t.recurring;
      return true;
    });
    list.sort((a, b) => {
      let av = "", bv = "";
      if (sortCol === "due") { av = a.due || "9999"; bv = b.due || "9999"; }
      else if (sortCol === "title") { av = a.title || ""; bv = b.title || ""; }
      else if (sortCol === "priority") { av = String(PRIORITY_RANK[getEffectivePriority(a)] ?? 0); bv = String(PRIORITY_RANK[getEffectivePriority(b)] ?? 0); }
      else if (sortCol === "case") { av = allCases.find(c => c.id === a.caseId)?.title || ""; bv = allCases.find(c => c.id === b.caseId)?.title || ""; }
      else if (sortCol === "assigned") { av = getUserById(a.assigned)?.name || ""; bv = getUserById(b.assigned)?.name || ""; }
      return (sortDir === "asc" ? 1 : -1) * av.localeCompare(bv);
    });
    return list;
  }, [tasks, filter, sortCol, sortDir, currentUser.id, allCases]);

  return (
    <>
      <div className="topbar">
        <div><div className="topbar-title">Tasks</div><div className="topbar-subtitle">{tasks.filter(t => t.status !== "Completed").length} open · {tasks.filter(t => t.recurring).length} recurring · {tasks.filter(t => t.status !== "Completed" && daysUntil(t.due) < 0).length} overdue</div></div>
        <button className="btn btn-gold" onClick={() => setShowForm(!showForm)}>+ New Task</button>
      </div>
      <div className="content">
        <div className="tabs">
          {["All", "Mine", "Urgent", "Overdue", "Recurring"].map(f => <div key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</div>)}
        </div>

        {showForm && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-header"><div className="card-title">New Task</div></div>
            <div style={{ padding: 20 }}>
              <div className="form-group"><label>Task Title</label><input value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Describe the task…" /></div>
              <div className="form-group">
                <label>Case / Matter — sorted by style</label>
                <input placeholder="Search by style or case number…" value={caseSearch} onChange={e => setCaseSearch(e.target.value)} style={{ marginBottom: 6 }} />
                <select value={newTask.caseId} onChange={e => setNewTask(p => ({ ...p, caseId: Number(e.target.value) }))} size={5} style={{ height: "auto" }}>
                  {filteredCases.map(c => <option key={c.id} value={c.id}>{c.title}{c.caseNum ? ` — ${c.caseNum}` : ""}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Assigned To</label>
                  <select value={newTask.assigned} onChange={e => setNewTask(p => ({ ...p, assigned: Number(e.target.value) }))}>
                    {USERS.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Due Date</label><input type="date" value={newTask.due} onChange={e => setNewTask(p => ({ ...p, due: e.target.value }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Base Priority</label>
                  <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}>
                    {["Urgent", "High", "Medium", "Low"].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Status</label>
                  <select value={newTask.status} onChange={e => setNewTask(p => ({ ...p, status: e.target.value }))}>
                    {["Not Started", "In Progress", "Waiting", "Completed"].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Recurring toggle */}
              <div className="form-group">
                <div style={{ background: newTask.recurring ? "#0f201e" : "#0d1117", border: `1px solid ${newTask.recurring ? "#44bbaa55" : "#2a3650"}`, borderRadius: 7, padding: "12px 14px", marginBottom: 8, transition: "all 0.2s" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: newTask.recurring ? 12 : 0 }}>
                    <div><div style={{ fontSize: 13, color: "#ccd6e8", fontWeight: 600 }}>🔁 Recurring Task</div><div style={{ fontSize: 11, color: "#556677", marginTop: 2 }}>A new task is auto-generated when this one is checked off</div></div>
                    <Toggle on={newTask.recurring} onChange={() => setNewTask(p => ({ ...p, recurring: !p.recurring }))} color="#44bbaa" />
                  </div>
                  {newTask.recurring && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, color: "#7788aa", whiteSpace: "nowrap" }}>Repeat every</span>
                      <input type="number" min={1} max={365} value={newTask.recurringDays} onChange={e => setNewTask(p => ({ ...p, recurringDays: Number(e.target.value) }))} style={{ width: 80 }} />
                      <span style={{ fontSize: 13, color: "#7788aa" }}>days</span>
                      <span style={{ fontSize: 12, color: "#445566" }}>→ Next: {fmt(addDays(newTask.due, newTask.recurringDays))}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Auto-escalate */}
              <div className="form-group">
                <EscalateBox on={newTask.autoEscalate} onChange={() => setNewTask(p => ({ ...p, autoEscalate: !p.autoEscalate }))} basePriority={newTask.priority} />
              </div>

              <div className="form-group"><label>Notes</label><textarea rows={2} value={newTask.notes} onChange={e => setNewTask(p => ({ ...p, notes: e.target.value }))} /></div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-gold" disabled={!newTask.title || !newTask.caseId} onClick={() => { onAddTask({ ...newTask }); setShowForm(false); setCaseSearch(""); setNewTask({ ...blank }); }}>Add Task</button>
                <button className="btn btn-outline" onClick={() => { setShowForm(false); setCaseSearch(""); }}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <SortTh col="title" label="Task" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="case" label="Case / Matter" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="assigned" label="Assigned" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="due" label="Due" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="priority" label="Priority" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <th>Status</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const days = daysUntil(t.due);
                  const cs = allCases.find(c => c.id === t.caseId);
                  const done = t.status === "Completed";
                  const ep = getEffectivePriority(t);
                  const escalated = t.autoEscalate && ep !== t.priority && !done;
                  const isExpanded = expandedTask === t.id;
                  return (
                    <Fragment key={t.id}>
                      <tr style={{ opacity: done ? 0.5 : 1 }}>
                        <td><div className={`checkbox ${done ? "done" : ""}`} onClick={() => onCompleteTask(t.id)}>{done && "✓"}</div></td>
                        <td>
                          <div style={{ color: "#ccd6e8", fontWeight: 600, textDecoration: done ? "line-through" : "none" }}>
                            {t.title}{t.recurring && <span className="rec-badge">🔁 {t.recurringDays}d</span>}{t.isChained && <span className="chain-badge">⛓ auto</span>}
                          </div>
                          {t.notes && <div style={{ fontSize: 11, color: "#445566", marginTop: 2 }}>{t.notes}</div>}
                        </td>
                        <td style={{ fontSize: 12, color: "#7788aa", maxWidth: 200 }}>{cs?.title?.slice(0, 40) || `#${t.caseId}`}<div style={{ fontSize: 10, color: "#445566" }}>{cs?.caseNum}</div></td>
                        <td><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar userId={t.assigned} size={24} /><span style={{ fontSize: 12, color: "#7788aa" }}>{getUserById(t.assigned)?.name.split(" ")[0]}</span></div></td>
                        <td style={{ color: urgencyColor(days), fontSize: 13, whiteSpace: "nowrap" }}>{fmt(t.due)}{days < 0 && !done && <div style={{ fontSize: 11, color: "#e05252" }}>{Math.abs(days)}d over</div>}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <Badge label={ep} />
                            {t.autoEscalate && <span title={escalated ? `Escalated from ${t.priority}` : "Auto-escalate on"} style={{ fontSize: 11, cursor: "help" }}>🔺</span>}
                          </div>
                          {escalated && <div style={{ fontSize: 10, color: "#556677", marginTop: 2 }}>was {t.priority}</div>}
                        </td>
                        <td><Badge label={done ? "Completed" : t.status} /></td>
                        <td>
                          <button
                            onClick={() => setExpandedTask(isExpanded ? null : t.id)}
                            style={{ background: "none", border: "none", color: isExpanded ? "#c9a84c" : "#445566", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 3 }}
                            title="Edit due date, priority, assignee"
                          >✎</button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${t.id}-edit`} style={{ background: "#0d1520" }}>
                          <td />
                          <td colSpan={7} style={{ paddingBottom: 12, paddingTop: 4 }}>
                            <div className="task-inline-edit">
                              <label style={{ fontSize: 11, color: "#556677" }}>Due date</label>
                              <input
                                type="date"
                                value={t.due || ""}
                                onChange={e => onUpdateTask(t.id, { due: e.target.value })}
                              />
                              <label style={{ fontSize: 11, color: "#556677" }}>Priority</label>
                              <select
                                value={t.priority}
                                onChange={e => onUpdateTask(t.id, { priority: e.target.value })}
                              >
                                {["Urgent", "High", "Medium", "Low"].map(p => <option key={p}>{p}</option>)}
                              </select>
                              <label style={{ fontSize: 11, color: "#556677" }}>Assigned to</label>
                              <select
                                value={t.assigned || ""}
                                onChange={e => onUpdateTask(t.id, { assigned: Number(e.target.value) })}
                              >
                                {USERS.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                              </select>
                              <button
                                className="btn btn-outline btn-sm"
                                style={{ fontSize: 11, marginLeft: 4 }}
                                onClick={() => setExpandedTask(null)}
                              >Done</button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="empty">No tasks in this view. Add one above.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Reports View ─────────────────────────────────────────────────────────────
const REPORT_DEFS = [
  {
    id: "trial_date",
    icon: "⚖️",
    title: "Cases by Trial Date",
    desc: "All active cases with a trial date set, sorted soonest first. Includes judge, lead attorney, and stage.",
    params: [],
  },
  {
    id: "attorney",
    icon: "👤",
    title: "Cases by Attorney",
    desc: "All cases assigned to a selected attorney as lead or second chair, grouped by status.",
    params: ["attorney"],
  },
  {
    id: "mediation",
    icon: "🤝",
    title: "Cases by Mediation Deadline",
    desc: "Active cases with a mediation date, sorted soonest first. Includes mediator and days remaining.",
    params: [],
  },
  {
    id: "discovery",
    icon: "🔍",
    title: "Cases by Discovery Deadline",
    desc: "Cases with written discovery, party deposition, or expert deposition deadlines. Filter by deadline window.",
    params: ["window"],
  },
  {
    id: "task_filter",
    icon: "✅",
    title: "Cases with Specific Open Task",
    desc: "Select an incomplete task type from the list and see all cases that have that task open.",
    params: ["task"],
  },
  {
    id: "no_trial",
    icon: "📋",
    title: "Active Cases Without Trial Date",
    desc: "Cases currently active but with no trial date set — useful for tracking docket gaps.",
    params: [],
  },
  {
    id: "overdue_tasks",
    icon: "🔴",
    title: "Overdue Tasks by Case",
    desc: "All cases that have at least one overdue task, with a breakdown of each overdue item.",
    params: [],
  },
  {
    id: "workload",
    icon: "📊",
    title: "Attorney Workload Summary",
    desc: "Case counts per attorney broken down by active/closed and stage. Useful for load balancing.",
    params: [],
  },
  {
    id: "upcoming_deadlines",
    icon: "📅",
    title: "Upcoming Deadlines by Window",
    desc: "All deadlines falling within a chosen time window — 7, 14, 30, 60, or 90 days.",
    params: ["window"],
  },
  {
    id: "answer_due",
    icon: "📝",
    title: "Cases by Answer Filed Date",
    desc: "Cases sorted by answer filed date. Identifies early-stage cases and tracks answer timelines.",
    params: [],
  },
];

function buildReport(id, allCases, tasks, deadlines, params) {
  const activeCases = allCases.filter(c => c.status === "Active");
  switch (id) {
    case "trial_date": {
      const rows = activeCases.filter(c => c.trialDate).sort((a, b) => a.trialDate.localeCompare(b.trialDate));
      return {
        columns: ["Case Number", "Style", "Trial Date", "Days", "Judge", "Lead Attorney", "Stage"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          fmt(c.trialDate),
          daysUntil(c.trialDate) !== null ? `${daysUntil(c.trialDate)}d` : "—",
          c.judge || "—",
          getUserById(c.leadAttorney)?.name || "—",
          c.stage || "—",
        ]),
        colorCol: 3,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "attorney": {
      const uid = params.attorney;
      const rows = allCases.filter(c => c.leadAttorney === uid || c.secondAttorney === uid).sort((a, b) => (a.status + a.title).localeCompare(b.status + b.title));
      return {
        columns: ["Case Number", "Style", "Status", "Stage", "Trial Date", "Role"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          c.status,
          c.stage || "—",
          fmt(c.trialDate),
          c.leadAttorney === uid ? "Lead" : "2nd Chair",
        ]),
        count: rows.length,
      };
    }
    case "mediation": {
      const rows = activeCases.filter(c => c.mediation).sort((a, b) => a.mediation.localeCompare(b.mediation));
      return {
        columns: ["Case Number", "Style", "Mediation Date", "Days", "Mediator", "Lead Attorney"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          fmt(c.mediation),
          daysUntil(c.mediation) !== null ? `${daysUntil(c.mediation)}d` : "—",
          c.mediator || "—",
          getUserById(c.leadAttorney)?.name || "—",
        ]),
        colorCol: 3,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "discovery": {
      const win = params.window || 90;
      const rows = [];
      activeCases.forEach(c => {
        const fields = [["Written Discovery", c.writtenDisc], ["Party Depositions", c.partyDepo], ["Expert Depositions", c.expertDepo]];
        fields.forEach(([label, date]) => {
          if (!date) return;
          const d = daysUntil(date);
          if (d !== null && d >= 0 && d <= win) {
            rows.push({ c, label, date, d });
          }
        });
      });
      rows.sort((a, b) => a.date.localeCompare(b.date));
      return {
        columns: ["Case Number", "Style", "Deadline Type", "Date", "Days", "Lead Attorney"],
        rows: rows.map(({ c, label, date, d }) => [
          c.caseNum || "—",
          c.title,
          label,
          fmt(date),
          `${d}d`,
          getUserById(c.leadAttorney)?.name || "—",
        ]),
        colorCol: 4,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "task_filter": {
      const taskTitle = params.task;
      if (!taskTitle) return { columns: [], rows: [], count: 0 };
      const matchingTasks = tasks.filter(t => t.title === taskTitle && t.status !== "Completed");
      const caseIds = [...new Set(matchingTasks.map(t => t.caseId))];
      const rows = caseIds.map(cid => {
        const c = allCases.find(x => x.id === cid);
        const t = matchingTasks.find(x => x.caseId === cid);
        if (!c) return null;
        return [c.caseNum || "—", c.title, c.status, fmt(t?.due), `${daysUntil(t?.due) ?? "—"}d`, getUserById(t?.assigned)?.name || "—", getEffectivePriority(t)];
      }).filter(Boolean).sort((a, b) => (a[3] || "").localeCompare(b[3] || ""));
      return {
        columns: ["Case Number", "Style", "Status", "Task Due", "Days", "Assigned To", "Priority"],
        rows,
        colorCol: 4,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "no_trial": {
      const rows = activeCases.filter(c => !c.trialDate).sort((a, b) => a.title.localeCompare(b.title));
      return {
        columns: ["Case Number", "Style", "Stage", "Answer Filed", "Lead Attorney", "File #"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          c.stage || "—",
          fmt(c.answerFiled),
          getUserById(c.leadAttorney)?.name || "—",
          c.fileNum || "—",
        ]),
        count: rows.length,
      };
    }
    case "overdue_tasks": {
      const overdue = tasks.filter(t => t.status !== "Completed" && daysUntil(t.due) < 0);
      const byCaseId = {};
      overdue.forEach(t => { if (!byCaseId[t.caseId]) byCaseId[t.caseId] = []; byCaseId[t.caseId].push(t); });
      const rows = [];
      Object.entries(byCaseId).sort((a, b) => b[1].length - a[1].length).forEach(([cid, ts]) => {
        const c = allCases.find(x => x.id === Number(cid));
        if (!c) return;
        ts.sort((a, b) => (a.due || "").localeCompare(b.due || "")).forEach(t => {
          rows.push([c.caseNum || "—", c.title, t.title, fmt(t.due), `${Math.abs(daysUntil(t.due))}d over`, getUserById(t.assigned)?.name || "—", getEffectivePriority(t)]);
        });
      });
      return {
        columns: ["Case Number", "Style", "Task", "Was Due", "Overdue By", "Assigned To", "Priority"],
        rows,
        colorCol: 4,
        colorFn: () => "#e05252",
        count: rows.length,
      };
    }
    case "workload": {
      const rows = USERS.map(u => {
        const lead = allCases.filter(c => c.leadAttorney === u.id);
        const second = allCases.filter(c => c.secondAttorney === u.id);
        const activeLead = lead.filter(c => c.status === "Active").length;
        const activeSecond = second.filter(c => c.status === "Active").length;
        const trials = lead.filter(c => c.trialDate && daysUntil(c.trialDate) >= 0 && daysUntil(c.trialDate) <= 90).length;
        const openTasks = tasks.filter(t => t.assigned === u.id && t.status !== "Completed").length;
        return [u.name, u.role, String(activeLead), String(activeSecond), String(activeLead + activeSecond), String(trials), String(openTasks)];
      });
      return {
        columns: ["Attorney / Staff", "Role", "Active Lead", "Active 2nd Chair", "Total Active", "Trials (90d)", "Open Tasks"],
        rows,
        count: USERS.length,
      };
    }
    case "upcoming_deadlines": {
      const win = params.window || 30;
      const rows = deadlines.filter(d => { const n = daysUntil(d.date); return n !== null && n >= 0 && n <= win; })
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(d => {
          const c = allCases.find(x => x.id === d.caseId);
          const days = daysUntil(d.date);
          return [c?.caseNum || "—", c?.title?.slice(0, 50) || `#${d.caseId}`, d.title, d.type || "—", fmt(d.date), `${days}d`, getUserById(d.assigned)?.name || "—"];
        });
      return {
        columns: ["Case Number", "Style", "Deadline", "Type", "Date", "Days", "Assigned"],
        rows,
        colorCol: 5,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "answer_due": {
      const rows = allCases.filter(c => c.answerFiled).sort((a, b) => b.answerFiled.localeCompare(a.answerFiled));
      return {
        columns: ["Case Number", "Style", "Answer Filed", "Status", "Stage", "Lead Attorney", "Client"],
        rows: rows.map(c => [c.caseNum || "—", c.title, fmt(c.answerFiled), c.status, c.stage || "—", getUserById(c.leadAttorney)?.name || "—", c.client || "—"]),
        count: rows.length,
      };
    }
    default:
      return { columns: [], rows: [], count: 0 };
  }
}

function ReportsView({ allCases, tasks, deadlines, currentUser }) {
  const [activeReport, setActiveReport] = useState(null);
  const [params, setParams] = useState({});
  const [generated, setGenerated] = useState(null);

  const activeTasks = tasks.filter(t => t.status !== "Completed");
  const uniqueTaskTitles = [...new Set(activeTasks.map(t => t.title))].sort();

  const def = REPORT_DEFS.find(r => r.id === activeReport);

  const generate = () => {
    if (!activeReport) return;
    const result = buildReport(activeReport, allCases, tasks, deadlines, params);
    setGenerated({ ...result, reportId: activeReport, params: { ...params }, generatedAt: new Date().toLocaleString(), title: def?.title });
  };

  const handlePrint = () => window.print();

  const handleCSV = () => {
    if (!generated) return;
    const lines = [generated.columns.join(","), ...generated.rows.map(r => r.map(v => `"${(v||"").replace(/"/g,'""')}"`).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${generated.title?.replace(/\s+/g, "_") || "report"}_${today}.csv`;
    a.click();
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Reports</div>
          <div className="topbar-subtitle">Generate and export case reports</div>
        </div>
        {generated && (
          <div className="topbar-actions">
            <button className="btn btn-outline" onClick={handleCSV}>⬇ Export CSV</button>
            <button className="btn btn-outline" onClick={handlePrint}>🖨 Print</button>
          </div>
        )}
      </div>
      <div className="content">
        {/* Report picker grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
          {REPORT_DEFS.map(r => (
            <div key={r.id} className={`report-card ${activeReport === r.id ? "active" : ""}`}
              onClick={() => { setActiveReport(r.id); setGenerated(null); setParams({}); }}>
              <div className="report-card-icon">{r.icon}</div>
              <div className="report-card-title">{r.title}</div>
              <div className="report-card-desc">{r.desc}</div>
            </div>
          ))}
        </div>

        {/* Parameters + Generate */}
        {activeReport && (
          <div className="card" style={{ marginBottom: 20, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "#e8d5a8", marginBottom: 4 }}>{def?.icon} {def?.title}</div>
                <div style={{ fontSize: 12, color: "#556677" }}>{def?.desc}</div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", marginLeft: "auto" }}>
                {def?.params.includes("attorney") && (
                  <div className="form-group" style={{ marginBottom: 0, minWidth: 200 }}>
                    <label>Attorney</label>
                    <select value={params.attorney || ""} onChange={e => setParams(p => ({ ...p, attorney: Number(e.target.value) }))}>
                      <option value="">— Select attorney —</option>
                      {USERS.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                    </select>
                  </div>
                )}
                {def?.params.includes("window") && (
                  <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
                    <label>Time Window</label>
                    <select value={params.window || 30} onChange={e => setParams(p => ({ ...p, window: Number(e.target.value) }))}>
                      {[7, 14, 30, 60, 90, 180].map(n => <option key={n} value={n}>Next {n} days</option>)}
                    </select>
                  </div>
                )}
                {def?.params.includes("task") && (
                  <div className="form-group" style={{ marginBottom: 0, minWidth: 260 }}>
                    <label>Select Open Task</label>
                    <select value={params.task || ""} onChange={e => setParams(p => ({ ...p, task: e.target.value }))}>
                      <option value="">— Choose a task type —</option>
                      {uniqueTaskTitles.map(t => {
                        const count = activeTasks.filter(x => x.title === t).length;
                        return <option key={t} value={t}>{t} ({count} open)</option>;
                      })}
                    </select>
                  </div>
                )}
                <button className="btn btn-gold" onClick={generate}
                  disabled={
                    (def?.params.includes("attorney") && !params.attorney) ||
                    (def?.params.includes("task") && !params.task)
                  }>
                  Generate Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Report output */}
        {generated && (
          <div className="report-output">
            <div className="report-output-header">
              <div>
                <div className="report-output-title">{generated.title}</div>
                <div className="report-meta">
                  {generated.count} record{generated.count !== 1 ? "s" : ""}
                  {generated.params.attorney ? ` · ${getUserById(generated.params.attorney)?.name}` : ""}
                  {generated.params.window ? ` · Next ${generated.params.window} days` : ""}
                  {generated.params.task ? ` · Task: "${generated.params.task}"` : ""}
                  {" · "}Generated {generated.generatedAt}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={handleCSV}>⬇ CSV</button>
                <button className="btn btn-outline btn-sm" onClick={handlePrint}>🖨 Print</button>
              </div>
            </div>

            {generated.count === 0 ? (
              <div className="empty">No records match this report's criteria.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>{generated.columns.map((col, i) => <th key={i}>{col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {generated.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => {
                          const isColored = generated.colorCol === ci && generated.colorFn;
                          const color = isColored ? generated.colorFn(cell) : undefined;
                          // Style the status/badge columns
                          const isStatus = generated.columns[ci] === "Status" || generated.columns[ci] === "Role" || generated.columns[ci] === "Stage" || generated.columns[ci] === "Priority" || generated.columns[ci] === "Type";
                          return (
                            <td key={ci} style={{ color: color || undefined }}>
                              {isStatus && cell && cell !== "—" ? <Badge label={cell} /> : (
                                <span style={{ fontWeight: ci === 1 ? 600 : 400, color: color || (ci === 1 ? "#ccd6e8" : undefined), fontFamily: ci === 0 ? "monospace" : undefined, fontSize: ci === 0 ? 11 : undefined }}>{cell || "—"}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Summary footer */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid #1a2235", display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#445566" }}>
                <strong style={{ color: "#c9a84c" }}>{generated.count}</strong> total records
              </div>
              {generated.reportId === "workload" && (() => {
                const totalActive = allCases.filter(c => c.status === "Active").length;
                return <div style={{ fontSize: 12, color: "#445566" }}><strong style={{ color: "#c9a84c" }}>{totalActive}</strong> total active cases across firm</div>;
              })()}
              {generated.reportId === "overdue_tasks" && (() => {
                const caseCount = new Set(generated.rows.map(r => r[0])).size;
                return <div style={{ fontSize: 12, color: "#445566" }}><strong style={{ color: "#e05252" }}>{caseCount}</strong> cases affected</div>;
              })()}
              {(generated.reportId === "trial_date" || generated.reportId === "discovery" || generated.reportId === "upcoming_deadlines") && (() => {
                const urgent = generated.rows.filter(r => { const v = parseInt(r[generated.colorCol]); return !isNaN(v) && v <= 14; }).length;
                if (urgent === 0) return null;
                return <div style={{ fontSize: 12, color: "#445566" }}><strong style={{ color: "#e07a30" }}>{urgent}</strong> within 14 days</div>;
              })()}
              <div style={{ marginLeft: "auto", fontSize: 11, color: "#2a3650" }}>LexTrack · {generated.generatedAt} · {currentUser.name}</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Staff View ───────────────────────────────────────────────────────────────
// ─── Time Log View ────────────────────────────────────────────────────────────
function TimeLogView({ currentUser, allCases, tasks, caseNotes }) {
  const thisMonth = today.slice(0, 7); // "YYYY-MM"
  const [fromDate, setFromDate] = useState(thisMonth + "-01");
  const [toDate,   setToDate]   = useState(today);

  // Quick range helpers
  const setRange = (label) => {
    const now = new Date(today + "T00:00:00");
    if (label === "This Week") {
      const day = now.getDay(); // 0=Sun
      const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
      setFromDate(mon.toISOString().split("T")[0]);
      setToDate(today);
    } else if (label === "This Month") {
      setFromDate(today.slice(0, 7) + "-01");
      setToDate(today);
    } else if (label === "Last Month") {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      setFromDate(first.toISOString().split("T")[0]);
      setToDate(last.toISOString().split("T")[0]);
    } else if (label === "Last 30 Days") {
      const d = new Date(now); d.setDate(d.getDate() - 29);
      setFromDate(d.toISOString().split("T")[0]);
      setToDate(today);
    } else if (label === "Last 90 Days") {
      const d = new Date(now); d.setDate(d.getDate() - 89);
      setFromDate(d.toISOString().split("T")[0]);
      setToDate(today);
    } else if (label === "This Year") {
      setFromDate(today.slice(0, 4) + "-01-01");
      setToDate(today);
    }
  };

  // Build activity rows from tasks and notes
  const rows = useMemo(() => {
    const result = [];
    const from = new Date(fromDate + "T00:00:00");
    const to   = new Date(toDate   + "T23:59:59");

    const inRange = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= from && d <= to;
    };

    // Task completions
    tasks.forEach(t => {
      if (t.assigned !== currentUser.id) return;
      if (t.status !== "Completed" || !t.completedAt) return;
      if (!inRange(t.completedAt)) return;
      const cs = allCases.find(c => c.id === t.caseId);
      result.push({
        date:     t.completedAt,
        type:     "Task Completed",
        caseTitle: cs?.title || `Case #${t.caseId}`,
        fileNum:  cs?.fileNum || "",
        detail:   t.title,
        category: "",
      });
    });

    // Notes
    Object.entries(caseNotes).forEach(([caseId, notes]) => {
      (notes || []).forEach(note => {
        if (note.authorId !== currentUser.id) return;
        if (!inRange(note.createdAt)) return;
        const cs = allCases.find(c => c.id === Number(caseId));
        const summary = (note.body || "").slice(0, 100).replace(/\n/g, " ") + (note.body?.length > 100 ? "…" : "");
        result.push({
          date:     note.createdAt,
          type:     "Note Added",
          caseTitle: cs?.title || `Case #${caseId}`,
          fileNum:  cs?.fileNum || "",
          detail:   summary,
          category: note.type || "",
        });
      });
    });

    // Sort newest first
    result.sort((a, b) => new Date(b.date) - new Date(a.date));
    return result;
  }, [tasks, caseNotes, currentUser.id, allCases, fromDate, toDate]);

  const fmtDateTime = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const exportCSV = () => {
    const headers = ["Date", "Activity Type", "Case/Matter", "File Number", "Detail", "Note Category"];
    const escapeCell = (val) => `"${String(val || "").replace(/"/g, '""')}"`;
    const csvRows = [
      headers.join(","),
      ...rows.map(r => [
        fmtDateTime(r.date),
        r.type,
        r.caseTitle,
        r.fileNum,
        r.detail,
        r.category,
      ].map(escapeCell).join(","))
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `time-log-${currentUser.name.replace(/\s+/g, "-").toLowerCase()}-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const taskCount = rows.filter(r => r.type === "Task Completed").length;
  const noteCount = rows.filter(r => r.type === "Note Added").length;

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Time Log</div>
          <div className="topbar-subtitle">{currentUser.name} · {taskCount} task{taskCount !== 1 ? "s" : ""} completed · {noteCount} note{noteCount !== 1 ? "s" : ""} added</div>
        </div>
        <div className="topbar-actions">
          <button
            className="btn btn-gold"
            disabled={rows.length === 0}
            onClick={exportCSV}
            title={rows.length === 0 ? "No activity in this range" : "Download CSV"}
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      <div className="content">
        {/* Filters */}
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, color: "#556677", whiteSpace: "nowrap" }}>From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: 150 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, color: "#556677", whiteSpace: "nowrap" }}>To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: 150 }} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["This Week", "This Month", "Last Month", "Last 30 Days", "Last 90 Days", "This Year"].map(label => (
                <button
                  key={label}
                  className="btn btn-outline btn-sm"
                  style={{ fontSize: 11 }}
                  onClick={() => setRange(label)}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Preview table */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Activity Preview</div>
            <span style={{ fontSize: 12, color: "#556677" }}>{rows.length} entries · {fmtDateTime(fromDate)} – {fmtDateTime(toDate)}</span>
          </div>
          {rows.length === 0 ? (
            <div className="empty">No activity recorded for this date range.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ whiteSpace: "nowrap" }}>Date</th>
                    <th>Activity</th>
                    <th>Case/Matter</th>
                    <th>Detail</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12, color: "#7788aa" }}>{fmtDateTime(r.date)}</td>
                      <td>
                        <span style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: r.type === "Task Completed" ? "#1a3a2a" : "#1a2a3a",
                          color:      r.type === "Task Completed" ? "#4CAE72"  : "#5599cc",
                          border:     `1px solid ${r.type === "Task Completed" ? "#2a5a3a" : "#1a4a6a"}`,
                        }}>{r.type}</span>
                      </td>
                      <td>
                        <div style={{ fontSize: 13, color: "#ccd6e8", fontWeight: 500 }}>{r.caseTitle}</div>
                        {r.fileNum && <div style={{ fontSize: 10, color: "#445566", fontFamily: "monospace" }}>File # {r.fileNum}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: "#aabbcc", maxWidth: 380 }}>
                        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.detail}</div>
                      </td>
                      <td>
                        {r.category && (
                          <span style={{ fontSize: 11, color: "#c9a84c", background: "#2a1800", border: "1px solid #4a3000", padding: "2px 7px", borderRadius: 4 }}>
                            {r.category}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StaffView({ allCases }) {
  return (
    <>
      <div className="topbar"><div><div className="topbar-title">Staff Directory</div><div className="topbar-subtitle">{USERS.length} team members</div></div></div>
      <div className="content">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
          {USERS.map(u => {
            const mine = allCases.filter(c => c.leadAttorney === u.id || c.secondAttorney === u.id || c.paralegal === u.id);
            return (
              <div key={u.id} className="card" style={{ padding: "20px 22px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: u.avatar, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{u.initials}</div>
                  <div><div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "#e8d5a8", fontWeight: 600 }}>{u.name}</div><Badge label={u.role} /></div>
                </div>
                {[["Email", u.email], ["Direct Line", u.phone || "—"], ["Cell", u.cell || "—"], ["Active Cases", `${mine.filter(c => c.status === "Active").length} (${mine.length} total)`]].map(([k, v]) => (
                  <div key={k} className="info-row"><span className="info-key">{k}</span><span className="info-val" style={{ fontSize: 12 }}>{v}</span></div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
