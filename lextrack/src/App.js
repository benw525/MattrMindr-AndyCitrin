import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { USERS } from "./firmData.js";
import {
  apiLogin, apiLogout, apiChangePassword, apiForgotPassword, apiResetPassword, apiSendTempPassword,
  apiGetCases, apiGetDeletedCases, apiGetCasesAll, apiCreateCase, apiUpdateCase, apiDeleteCase, apiRestoreCase,
  apiGetTasks, apiGetCaseTasks, apiCreateTask, apiCreateTasks, apiUpdateTask, apiCompleteTask, apiReassignTasksByRole,
  apiGetDeadlines, apiCreateDeadline, apiUpdateDeadline,
  apiGetUsers, apiCreateUser, apiDeleteUser, apiGetDeletedUsers, apiRestoreUser, apiUpdateUserRoles, apiUpdateUser,
  apiGetNotes, apiGetQuickNotes, apiCreateNote, apiUpdateNote, apiDeleteNote,
  apiGetLinks, apiCreateLink, apiDeleteLink,
  apiGetActivity, apiGetRecentActivity, apiCreateActivity,
  apiGetContacts, apiGetDeletedContacts, apiCreateContact, apiUpdateContact, apiDeleteContact, apiRestoreContact, apiMergeContacts, apiGetContactCases, apiGetContactCaseCounts,
  apiGetContactNotes, apiCreateContactNote, apiDeleteContactNote,
  apiGetContactStaff, apiCreateContactStaff, apiUpdateContactStaff, apiDeleteContactStaff,
  apiAiSearch,
  apiChargeAnalysis, apiGetChargeClass, apiDeadlineGenerator, apiCaseStrategy, apiDraftDocument, apiCaseTriage, apiClientSummary, apiDocSummary, apiTaskSuggestions, apiAdvocateChat,
  apiGetCaseDocuments, apiUploadCaseDocument, apiSummarizeDocument, apiDownloadDocument, apiDeleteCaseDocument, apiUpdateCaseDocument,
  apiGetFilings, apiUploadFiling, apiDeleteFiling, apiSummarizeFiling, apiUpdateFiling, apiClassifyFiling,
  apiGetCorrespondence, apiDeleteCorrespondence, apiGetAllCorrespondence,
  apiGetParties, apiCreateParty, apiUpdateParty, apiDeleteParty,
  apiConflictCheck,
  apiGetExperts, apiCreateExpert, apiUpdateExpert, apiDeleteExpert,
  apiGetMiscContacts, apiCreateMiscContact, apiUpdateMiscContact, apiDeleteMiscContact,
  apiGetTemplates, apiDeleteTemplate, apiUpdateTemplate, apiGetTemplateSource, apiUploadTemplateFile, apiSaveTemplate, apiGenerateDocument, apiDetectPleadingSections,
  apiGetTimeEntries, apiCreateTimeEntry, apiUpdateTimeEntry, apiDeleteTimeEntry,
  apiGetTraining, apiCreateTraining, apiUploadTrainingDoc, apiUpdateTraining, apiDeleteTraining,
  apiGetPinnedCases, apiSetPinnedCases,
  apiBatchPreview, apiBatchApply,
} from "./api.js";

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');`;


const STAFF_ROLES = ["Public Defender","Chief Deputy Public Defender","Deputy Public Defender","Senior Trial Attorney","Trial Attorney","Office Administrator","Administrative Assistant","IT Specialist","Trial Coordinator Supervisor","Trial Coordinator","Chief Social Worker","Social Worker","Client Advocate","Investigator","Paralegal","App Admin"];
const hasRole = (user, role) => (user?.roles || (user?.role ? [user.role] : [])).includes(role);
const isAppAdmin = (user) => hasRole(user, "App Admin");
const AVATAR_PALETTE = ["#C9A84C","#4C7AC9","#4CAE72","#C94C4C","#9B4CC9","#4CC9C9","#C97B4C","#4C9BC9","#7BC94C","#C94C8C","#884CC9","#4CC96A","#C9C94C","#4C6AC9","#C94C6A","#4CAEC9","#6AC94C","#C9844C","#4CC9A8","#5884C9"];
const makeInitials = n => n.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 3).toUpperCase();
const pickAvatar   = n => AVATAR_PALETTE[n.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_PALETTE.length];

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
  if (days === null) return "#8A9096";
  if (days < 0) return "#e05252";
  if (days <= 7) return "#e07a30";
  if (days <= 21) return "#4F7393";
  return "#4CAE72";
};

const recordType = () => "Case";

const PRIORITY_RANK = { Low: 0, Medium: 1, High: 2, Urgent: 3 };
const RANK_PRIORITY = ["Low", "Medium", "High", "Urgent"];
const getEffectivePriority = (task) => {
  if (!task.autoEscalate || task.status === "Completed") return task.priority;
  const days = daysUntil(task.due);
  if (days === null) return task.priority;
  const urgentDays = task.escalateUrgentDays ?? 7;
  const highDays = task.escalateHighDays ?? 14;
  const mediumDays = task.escalateMediumDays ?? 30;
  let escalated = task.priority;
  if (days <= urgentDays) escalated = "Urgent";
  else if (days <= highDays) escalated = (escalated === "Low" || escalated === "Medium") ? "High" : escalated;
  else if (days <= mediumDays) escalated = escalated === "Low" ? "Medium" : escalated;
  return RANK_PRIORITY[Math.max(PRIORITY_RANK[task.priority] || 0, PRIORITY_RANK[escalated] || 0)];
};

// Chain-spawn definitions: when a task with this title is completed, automatically
// create the next task. dueDaysFromCompletion is calculated from the completion date.
const TASK_CHAINS = {
  "Initial Client Interview": {
    title: "Request Discovery from Prosecutor",
    assignedRole: "trialCoordinator",
    priority: "High",
    dueDaysFromCompletion: 3,
    autoEscalate: true,
    notes: "Auto-generated after Initial Client Interview was completed.",
  },
  "Request Discovery from Prosecutor": {
    title: "Review Discovery Materials",
    assignedRole: "assignedAttorney",
    priority: "High",
    dueDaysFromCompletion: 14,
    autoEscalate: true,
    notes: "Auto-generated after Request Discovery from Prosecutor was completed.",
  },
  "Review Discovery Materials": {
    title: "Investigation and Witness Interviews",
    assignedRole: "investigator",
    priority: "Medium",
    dueDaysFromCompletion: 21,
    autoEscalate: true,
    notes: "Auto-generated after Review Discovery Materials was completed.",
  },
  "File Pre-Trial Motions": {
    title: "Prepare for Motion Hearing",
    assignedRole: "assignedAttorney",
    priority: "High",
    dueDaysFromCompletion: 14,
    autoEscalate: true,
    notes: "Auto-generated after File Pre-Trial Motions was completed.",
  },
};

const MULTI_CHAINS = {};

const DUAL_CHAINS = [];

const generateDefaultTasks = (caseObj, userId) => {
  const resolveRole = (role) => role ? (caseObj[role] || userId) : userId;
  const base = [
    { title: "Initial Client Interview",              assignedRole: "assignedAttorney", priority: "Urgent", dueDays: 1,  notes: "Meet with client to discuss charges and case details." },
    { title: "Request Discovery from Prosecutor",     assignedRole: "trialCoordinator",        priority: "High",   dueDays: 3,  notes: "Request all discovery materials from the DA's office." },
    { title: "Obtain Arrest Report and Booking Info",  assignedRole: "trialCoordinator", priority: "High",   dueDays: 3,  notes: "" },
    { title: "Review Bond Conditions",                 assignedRole: "assignedAttorney", priority: "High",   dueDays: 2,  notes: "Review and assess bond conditions; file motion to modify if needed." },
    { title: "Check for Conflicts of Interest",        assignedRole: "assignedAttorney", priority: "Urgent", dueDays: 1,  notes: "Run conflict check against existing cases." },
    { title: "Client Background Investigation",        assignedRole: "investigator",     priority: "Medium", dueDays: 14, notes: "Gather background info, employment, family ties, community involvement." },
  ];
  const ids = base.map(() => newId());
  return base.map((t, i) => ({
    id: ids[i],
    caseId: caseObj.id,
    title: t.title,
    assigned: resolveRole(t.assignedRole),
    assignedRole: t.assignedRole || null,
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
    Case: { bg: "#E4E7EB", color: "#5599cc", border: "#E4E7EB" },
    Matter: { bg: "#f3e8ff", color: "#a066cc", border: "#f3e8ff" },
    Active: { bg: "#dcfce7", color: "#4CAE72", border: "#bbf7d0" },
    Closed: { bg: "var(--c-bg)", color: "var(--c-text2)", border: "var(--c-border)" },
    Pending: { bg: "#fef9c3", color: "#1E2A3A", border: "#fef9c3" },
    Disposed: { bg: "var(--c-bg)", color: "var(--c-text2)", border: "var(--c-border)" },
    Transferred: { bg: "#E4E7EB", color: "#5599cc", border: "#E4E7EB" },
    Arraignment: { bg: "#E4E7EB", color: "#5599cc", border: "#E4E7EB" },
    "Preliminary Hearing": { bg: "#dcfce7", color: "#66aa66", border: "#bbf7d0" },
    "Grand Jury/Indictment": { bg: "#fef9c3", color: "#1E2A3A", border: "#fef9c3" },
    "Pre-Trial Motions": { bg: "#dcfce7", color: "#66aa66", border: "#bbf7d0" },
    "Plea Negotiations": { bg: "#f3e8ff", color: "#a066cc", border: "#e9d5ff" },
    Trial: { bg: "#fee2e2", color: "#e05252", border: "#fca5a5" },
    Sentencing: { bg: "#fef3c7", color: "#e07a30", border: "#fde68a" },
    "Post-Conviction": { bg: "var(--c-bg)", color: "var(--c-text2)", border: "var(--c-border)" },
    Appeal: { bg: "#f3e8ff", color: "#a066cc", border: "#f3e8ff" },
    Urgent: { bg: "#fee2e2", color: "#e05252", border: "#fca5a5" },
    Overdue: { bg: "#fee2e2", color: "#e05252", border: "#fca5a5" },
    "In Progress": { bg: "#E4E7EB", color: "#5599cc", border: "#E4E7EB" },
    "Not Started": { bg: "var(--c-card)", color: "#8A9096", border: "var(--c-border)" },
    Completed: { bg: "#dcfce7", color: "#4CAE72", border: "#bbf7d0" },
    Waiting: { bg: "#fef9c3", color: "#1E2A3A", border: "#fef9c3" },
    High: { bg: "#fef3c7", color: "#e07a30", border: "#fde68a" },
    Medium: { bg: "#fef9c3", color: "#1E2A3A", border: "#fef9c3" },
    Low: { bg: "#E4E7EB", color: "#5599cc", border: "#E4E7EB" },
  };
  return map[status] || { bg: "var(--c-card)", color: "#8A9096", border: "var(--c-border)" };
};

const Badge = ({ label }) => {
  if (!label) return null;
  const s = statusBadgeStyle(label);
  return <span style={{ background: s.bg, color: "#1F2428", borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{label}</span>;
};

const getUserById = (id) => USERS.find(u => u.id === id);

const Avatar = ({ userId, size = 28 }) => {
  const u = getUserById(userId);
  if (!u) return null;
  return <div title={`${u.name} (${u.role})`} style={{ width: size, height: size, borderRadius: "50%", background: u.avatar, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.32, fontWeight: 700, color: "#fff", fontFamily: "'Source Sans 3',sans-serif", flexShrink: 0 }}>{u.initials}</div>;
};

const SortTh = ({ col, label, sortCol, sortDir, onSort, style, className }) => (
  <th className={className} style={{ cursor: "pointer", userSelect: "none", ...style }} onClick={() => onSort(col)}>
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {label}
      <span style={{ color: sortCol === col ? "#1E2A3A" : "#D6D8DB", fontSize: 10 }}>
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
:root {
  --c-text:    #1F2428;
  --c-text-h:  #121A26;
  --c-text2:   #5D6268;
  --c-text3:   #8A9096;
  --c-text4:   #8A9096;
  --c-bg:      #F7F8FA;
  --c-bg2:     #EEF1F4;
  --c-card:    #FFFFFF;
  --c-hover:   #E4E7EB;
  --c-border:  #D6D8DB;
  --c-border2: #EEF1F4;
  --c-border3: #D6D8DB;
  --c-accent:  #1E2A3A;
  --c-success: #2F7A5F;
  --c-warning: #B67A18;
  --c-error:   #B24A4A;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--c-bg); color: var(--c-text); font-family: 'Source Sans 3', sans-serif; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #F7F8FA; }
::-webkit-scrollbar-thumb { background: #D6D8DB; border-radius: 3px; }
.app { display: flex; height: 100vh; overflow: hidden; }
.sidebar { width: 240px; background: #EDEFF2; border-right: 1px solid #D6D8DB; display: flex; flex-direction: column; flex-shrink: 0; }
.sidebar-logo { padding: 28px 24px 20px; border-bottom: 1px solid #D6D8DB; }
.sidebar-logo-text { font-family: 'Playfair Display', serif; font-size: 17px; color: #121A26; font-weight: 700; }
.sidebar-logo-sub { font-size: 10px; color: #8A9096; letter-spacing: 0.15em; text-transform: uppercase; margin-top: 2px; }
.sidebar-user { padding: 16px 20px; border-bottom: 1px solid #D6D8DB; display: flex; align-items: center; gap: 10px; }
.sidebar-user-name { font-size: 13px; font-weight: 600; color: #1F2428; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sidebar-user-role { font-size: 11px; color: #8A9096; }
.sidebar-nav { flex: 1; overflow-y: auto; padding: 12px 0; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 20px; cursor: pointer; font-size: 13.5px; color: #5D6268; border-left: 3px solid transparent; transition: all 0.15s; }
.nav-item:hover { color: #1F2428; background: #DDE3EA; }
.nav-item.active { color: #1E2A3A; background: #DDE3EA; border-left-color: #1E2A3A; }
.nav-icon { font-size: 15px; width: 18px; text-align: center; }
.nav-badge { margin-left: auto; background: #f5dada; color: #B24A4A; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.topbar { padding: 14px 28px; border-bottom: 1px solid #D6D8DB; display: flex; align-items: center; justify-content: space-between; background: #FFFFFF; flex-shrink: 0; flex-wrap: wrap; gap: 10px; }
.topbar-title { font-family: 'Playfair Display', serif; font-size: 20px; color: #121A26; font-weight: 600; }
.topbar-subtitle { font-size: 12px; color: #8A9096; margin-top: 1px; }
.topbar-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.btn { padding: 7px 16px; border-radius: 5px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; font-family: 'Source Sans 3', sans-serif; }
.btn-gold { background: #1E2A3A; color: #FFFFFF; }
.btn-gold:hover { background: #2A3A4F; }
.btn-gold:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-outline { background: transparent; color: #5D6268; border: 1px solid #D6D8DB; }
.btn-outline:hover { border-color: #1E2A3A; color: #1E2A3A; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.content { flex: 1; overflow-y: auto; padding: 24px 28px; }
.card { background: #FFFFFF; border: 1px solid #D6D8DB; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.card-header { padding: 16px 20px; border-bottom: 1px solid #D6D8DB; display: flex; align-items: center; justify-content: space-between; }
.card-title { font-family: 'Playfair Display', serif; font-size: 15px; color: #1E2A3A; font-weight: 600; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.stat-card { background: #FFFFFF; border: 1px solid #D6D8DB; border-radius: 8px; padding: 18px 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.stat-label { font-size: 11px; color: #8A9096; text-transform: uppercase; letter-spacing: 0.1em; }
.stat-value { font-family: 'Playfair Display', serif; font-size: 32px; color: #121A26; font-weight: 700; margin-top: 4px; }
.stat-sub { font-size: 12px; color: #8A9096; margin-top: 4px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 10px 14px; font-size: 11px; color: #8A9096; text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid #D6D8DB; white-space: nowrap; }
td { padding: 11px 14px; font-size: 13px; color: #1F2428; border-bottom: 1px solid #EEF1F4; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #EEF1F4; }
.clickable-row { cursor: pointer; }
.selected-row td { background: #E4E7EB !important; }
.selected-row td:first-child { border-left: 3px solid #1E2A3A; }
input:not([type=radio]):not([type=checkbox]), select, textarea { background: #EEF1F4; border: 1px solid #D6D8DB; color: #1F2428; padding: 8px 12px; border-radius: 5px; font-size: 13.5px; font-family: 'Source Sans 3', sans-serif; width: 100%; }
input:not([type=radio]):not([type=checkbox]):focus, select:focus, textarea:focus { outline: none; border-color: #1E2A3A; }
input[type=radio], input[type=checkbox] { width: auto; padding: 0; border: none; background: none; cursor: pointer; }
label { font-size: 12px; color: #8A9096; display: block; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.08em; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-group { margin-bottom: 14px; }
.tabs { display: flex; gap: 0; margin-bottom: 20px; border-bottom: 1px solid #D6D8DB; flex-wrap: wrap; }
.tab { padding: 8px 16px; font-size: 13px; color: #5D6268; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s; font-weight: 500; white-space: nowrap; }
.tab.active { color: #1E2A3A; border-bottom-color: #1E2A3A; }
.tab:hover:not(.active) { color: #1F2428; }
.tab-divider { width: 1px; background: #D6D8DB; margin: 4px 6px; }
.deadline-item { padding: 12px 16px; border-bottom: 1px solid #EEF1F4; display: flex; align-items: center; gap: 12px; }
.deadline-item:last-child { border-bottom: none; }
.dl-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.dl-info { flex: 1; min-width: 0; }
.dl-title { font-size: 13.5px; color: #1F2428; }
.dl-case { font-size: 11.5px; color: #8A9096; margin-top: 2px; }
.empty { text-align: center; padding: 40px 20px; color: #8A9096; font-size: 14px; }
.detail-panel { position: fixed; right: 0; top: 0; bottom: 0; width: 440px; background: #FFFFFF; border-left: 1px solid #D6D8DB; z-index: 500; overflow-y: auto; box-shadow: -10px 0 30px rgba(0,0,0,0.4); }
.panel-header { padding: 20px 24px; border-bottom: 1px solid #D6D8DB; display: flex; align-items: flex-start; justify-content: space-between; position: sticky; top: 0; background: #FFFFFF; z-index: 1; }
.panel-content { padding: 20px 24px; }
.panel-section { margin-bottom: 22px; }
.panel-section-title { font-size: 10px; color: #8A9096; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 10px; font-weight: 600; }
.info-row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #EEF1F4; font-size: 13px; gap: 12px; }
.info-row:last-child { border-bottom: none; }
.info-key { color: #8A9096; flex-shrink: 0; }
.info-val { color: #1F2428; text-align: right; word-break: break-word; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 1000; backdrop-filter: blur(3px); }
.modal { background: #FFFFFF; border: 1px solid #D6D8DB; border-radius: 10px; padding: 28px; width: 620px; max-height: 90vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
.modal-body { flex: 1; overflow-y: auto; min-height: 0; }
.modal-title { font-family: 'Playfair Display', serif; font-size: 20px; color: #121A26; font-weight: 600; margin-bottom: 4px; }
.modal-sub { font-size: 12px; color: #8A9096; margin-bottom: 20px; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid #D6D8DB; flex-shrink: 0; position: sticky; bottom: -28px; background: inherit; padding-bottom: 0; z-index: 1; }
.login-bg { min-height: 100vh; background: #F7F8FA; display: flex; align-items: center; justify-content: center; }
.login-box { background: #FFFFFF; border: 1px solid #D6D8DB; border-radius: 12px; padding: 44px 40px; width: 400px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
.login-title { font-family: 'Playfair Display', serif; font-size: 26px; color: #121A26; text-align: center; margin-bottom: 6px; }
.login-sub { font-size: 12px; color: #8A9096; text-align: center; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 32px; }
.calc-result { background: #EEF1F4; border: 1px solid #1E2A3A15; border-radius: 6px; padding: 14px 16px; margin-top: 16px; }
.pagination { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-top: 1px solid #D6D8DB; font-size: 13px; color: #8A9096; flex-wrap: wrap; }
.page-btn { padding: 4px 10px; border-radius: 4px; background: #EEF1F4; border: 1px solid #D6D8DB; color: #5D6268; cursor: pointer; font-size: 12px; }
.page-btn:hover { border-color: #1E2A3A; color: #1E2A3A; }
.page-btn.active { background: #1E2A3A12; border-color: #1E2A3A; color: #1E2A3A; }
.checkbox { width: 17px; height: 17px; border-radius: 4px; border: 2px solid #D6D8DB; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; flex-shrink: 0; transition: all 0.15s; }
.checkbox.done { background: #2F7A5F; border-color: #2F7A5F; }
.rec-badge { display: inline-flex; align-items: center; gap: 3px; background: #e0f2ec; color: #1F2428; border-radius: 3px; padding: 1px 5px; font-size: 10px; font-weight: 600; margin-left: 5px; }
.chain-badge { display: inline-flex; align-items: center; gap: 3px; background: #ede9fe; color: #1F2428; border-radius: 3px; padding: 1px 5px; font-size: 10px; font-weight: 600; margin-left: 5px; }
.task-inline-edit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 5px; }
.task-inline-edit input[type="date"] { background: #EEF1F4; border: 1px solid #D6D8DB; color: #1F2428; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
.task-inline-edit select { background: #EEF1F4; border: 1px solid #D6D8DB; color: #1F2428; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
.task-inline-edit input[type="date"]:focus, .task-inline-edit select:focus { outline: none; border-color: #1E2A3A; }
.toggle { width: 38px; height: 20px; border-radius: 10px; cursor: pointer; position: relative; flex-shrink: 0; transition: background 0.2s; }
.toggle-knob { position: absolute; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left 0.2s; }
.report-card { background: #FFFFFF; border: 1px solid #D6D8DB; border-radius: 8px; padding: 18px 20px; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
.report-card:hover { border-color: #1E2A3A33; background: #EEF1F4; }
.report-card.active { border-color: #1E2A3A; background: #EEF1F4; }
.report-card-icon { font-size: 24px; margin-bottom: 8px; }
.report-card-title { font-family: 'Playfair Display', serif; font-size: 14px; color: #121A26; font-weight: 600; margin-bottom: 4px; }
.report-card-desc { font-size: 11px; color: #8A9096; line-height: 1.4; }
.report-output { background: #EEF1F4; border: 1px solid #D6D8DB; border-radius: 8px; }
.report-output-header { padding: 16px 20px; border-bottom: 1px solid #D6D8DB; display: flex; align-items: center; justify-content: space-between; }
.report-output-title { font-family: 'Playfair Display', serif; font-size: 16px; color: #121A26; font-weight: 600; }
.report-meta { font-size: 11px; color: #8A9096; margin-top: 2px; }
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
.note-item { padding: 10px 14px; border-bottom: 1px solid #EEF1F4; cursor: pointer; transition: background 0.1s; }
.note-item:last-child { border-bottom: none; }
.note-item:hover { background: #EEF1F4; }
.note-item.expanded { background: #E4E7EB; border-left: 3px solid #1E2A3A; }
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
.case-overlay { position: fixed; top: 0; left: 220px; right: 0; bottom: 0; background: #FFFFFF; z-index: 600; display: flex; flex-direction: column; overflow: hidden; }
.case-overlay-header { flex-shrink: 0; background: #FFFFFF; border-bottom: 1px solid #D6D8DB; padding: 18px 32px; display: flex; align-items: flex-start; justify-content: space-between; z-index: 10; gap: 16px; }
.case-overlay-tabs { flex-shrink: 0; display: flex; gap: 0; border-bottom: 1px solid #D6D8DB; padding: 0 32px; background: #FFFFFF; }
.case-overlay-tab { padding: 12px 20px; font-size: 13px; color: #8A9096; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s; font-weight: 500; }
.case-overlay-tab:hover { color: #5D6268; }
.case-overlay-tab.active { color: #121A26; border-bottom-color: #1E2A3A; }
.case-overlay-body { flex: 1; overflow-y: auto; padding: 28px 32px; }
.case-overlay-body > * { max-width: 1100px; width: 100%; margin-left: auto; margin-right: auto; }
.case-overlay-section { margin-bottom: 32px; }
.case-overlay-section-title { font-size: 10px; color: #8A9096; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; }
.activity-entry { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid #EEF1F4; }
.activity-entry:last-child { border-bottom: none; }
.activity-avatar-col { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 36px; }
.activity-line { width: 1px; flex: 1; background: #D6D8DB; min-height: 20px; }
.activity-body { flex: 1; min-width: 0; }
.activity-action { font-size: 13px; color: #1F2428; font-weight: 600; margin-bottom: 2px; }
.activity-detail { font-size: 12px; color: #5D6268; margin-bottom: 3px; line-height: 1.5; }
.activity-meta { font-size: 11px; color: #8A9096; }
.edit-field { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid #EEF1F4; }
.edit-field:last-child { border-bottom: none; }
.edit-field-key { font-size: 12px; color: #8A9096; min-width: 150px; flex-shrink: 0; }
.edit-field-val { flex: 1; font-size: 13px; color: #1F2428; }
.edit-field-val input, .edit-field-val select { background: transparent; border: none; color: #1F2428; font-size: 13px; padding: 2px 4px; border-radius: 3px; width: 100%; font-family: 'Source Sans 3', sans-serif; }
.edit-field-val input:hover, .edit-field-val select:hover { background: #E4E7EB; }
.edit-field-val input:focus, .edit-field-val select:focus { background: #E4E7EB; outline: none; border: none; }
.edit-field-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.edit-field:hover .edit-field-actions { opacity: 1; }
.add-field-row { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
.overlay-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; }

/* ── Dark Mode ─────────────────────────────────────────────────────────────── */
.dark {
  color-scheme: dark;
  --c-text:    #E6EDF3;
  --c-text-h:  #E6EDF3;
  --c-text2:   #9DA7B3;
  --c-text3:   #6E7681;
  --c-text4:   #6E7681;
  --c-bg:      #0E1116;
  --c-bg2:     #161B22;
  --c-card:    #161B22;
  --c-hover:   #1C2330;
  --c-border:  #27313D;
  --c-border2: #1C2330;
  --c-border3: #27313D;
  --c-accent:  #4F7393;
  --c-success: #2F7A5F;
  --c-warning: #B67A18;
  --c-error:   #B24A4A;
}
body.dark-body { background: #0E1116; }
.dark .sidebar { background: #12161C; border-right-color: #27313D; }
.dark .sidebar-logo { border-bottom-color: #27313D; }
.dark .sidebar-logo-text { color: #4F7393; }
.dark .sidebar-logo-sub { color: #6E7681; }
.dark .sidebar-user { border-bottom-color: #27313D; }
.dark .sidebar-user-name { color: #E6EDF3; }
.dark .sidebar-user-role { color: #6E7681; }
.dark .sidebar-nav { scrollbar-color: #27313D #12161C; }
.dark .nav-item { color: #9DA7B3; }
.dark .nav-item:hover { color: #E6EDF3; background: #1A212B; }
.dark .nav-item.active { color: #4F7393; background: #1A212B; border-left-color: #4F7393; }
.dark .main { background: #0E1116; }
.dark .topbar { background: #161B22; border-bottom-color: #27313D; }
.dark .topbar-title { color: #E6EDF3; }
.dark .topbar-subtitle { color: #6E7681; }
.dark .content { background: #0E1116; }
.dark .card { background: #161B22; border-color: #27313D; box-shadow: 0 1px 6px rgba(0,0,0,0.4); }
.dark .card-header { border-bottom-color: #27313D; }
.dark .card-title { color: #4F7393; }
.dark .stat-card { background: #161B22; border-color: #27313D; box-shadow: 0 1px 6px rgba(0,0,0,0.4); }
.dark .stat-label { color: #6E7681; }
.dark .stat-value { color: #E6EDF3; }
.dark .stat-sub { color: #6E7681; }
.dark th { color: #6E7681; border-bottom-color: #27313D; background: transparent; }
.dark td { color: #9DA7B3; border-bottom-color: #1C2330; }
.dark tr:last-child td { border-bottom: none; }
.dark tr:hover td { background: #1C2330; }
.dark .selected-row td { background: #1C2330 !important; }
.dark .selected-row td:first-child { border-left-color: #4F7393; }
.dark input:not([type=radio]):not([type=checkbox]), .dark select, .dark textarea { background: #1C2330; border-color: #27313D; color: #E6EDF3; }
.dark input:not([type=radio]):not([type=checkbox]):focus, .dark select:focus, .dark textarea:focus { border-color: #4F7393; }
.dark label { color: #6E7681; }
.dark .tabs { border-bottom-color: #27313D; }
.dark .tab { color: #6E7681; }
.dark .tab.active { color: #4F7393; border-bottom-color: #4F7393; }
.dark .tab:hover:not(.active) { color: #E6EDF3; }
.dark .tab-divider { background: #27313D; }
.dark .detail-panel { background: #161B22; border-left-color: #27313D; }
.dark .panel-header { background: #161B22; border-bottom-color: #27313D; }
.dark .panel-section-title { color: #6E7681; }
.dark .info-row { border-bottom-color: #1C2330; }
.dark .info-key { color: #6E7681; }
.dark .info-val { color: #E6EDF3; }
.dark .modal { background: #1C2330; border-color: #27313D; }
.dark .modal-title { color: #E6EDF3; }
.dark .modal-sub { color: #6E7681; }
.dark .modal-footer { border-top-color: #27313D; }
.dark .modal-box { background: #161B22; border-color: #27313D; color: #E6EDF3; }
.dark .login-bg { background: #0E1116; }
.dark .login-box { background: #161B22; border-color: #27313D; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
.dark .login-title { color: #E6EDF3; }
.dark .login-sub { color: #6E7681; }
.dark .btn-outline { color: #9DA7B3; border-color: #27313D; }
.dark .btn-outline:hover { color: #4F7393; border-color: #4F7393; background: transparent; }
.dark .btn-gold { background: #1E2A3A; color: #E6EDF3; }
.dark .btn-gold:hover { background: #4F7393; }
.dark .deadline-item { border-bottom-color: #1C2330; }
.dark .dl-title { color: #E6EDF3; }
.dark .dl-case { color: #6E7681; }
.dark .empty { color: #6E7681; }
.dark .case-overlay { background: #0E1116; }
.dark .case-overlay-header { background: #161B22; border-bottom-color: #27313D; }
.dark .case-overlay-tabs { background: #161B22; border-bottom-color: #27313D; }
.dark .case-overlay-tab { color: #6E7681; }
.dark .case-overlay-tab:hover { color: #9DA7B3; }
.dark .case-overlay-tab.active { color: #E6EDF3; border-bottom-color: #4F7393; }
.dark .case-overlay-section-title { color: #6E7681; }
.dark .case-overlay-body { background: #0E1116; }
.dark .activity-entry { border-bottom-color: #1C2330; }
.dark .activity-action { color: #E6EDF3; }
.dark .activity-detail { color: #9DA7B3; }
.dark .activity-meta { color: #6E7681; }
.dark .activity-line { background: #27313D; }
.dark .edit-field { border-bottom-color: #1C2330; }
.dark .edit-field-key { color: #6E7681; }
.dark .edit-field-val { color: #E6EDF3; }
.dark .edit-field-val input, .dark .edit-field-val select { color: #E6EDF3; background: transparent; }
.dark .edit-field-val input:hover, .dark .edit-field-val select:hover { background: #1C2330; }
.dark .edit-field-val input:focus, .dark .edit-field-val select:focus { background: #1C2330; }
.dark .note-item { border-bottom-color: #1C2330; }
.dark .note-item:hover { background: #1C2330; }
.dark .note-item.expanded { background: #1C2330; border-left-color: #4F7393; }
.dark .report-card { background: #161B22; border-color: #27313D; }
.dark .report-card:hover { background: #1C2330; border-color: #27313D; }
.dark .report-card.active { border-color: #4F7393; background: #1C2330; }
.dark .report-card-title { color: #E6EDF3; }
.dark .report-card-desc { color: #6E7681; }
.dark .report-output { background: #161B22; border-color: #27313D; }
.dark .report-output-header { border-bottom-color: #27313D; }
.dark .report-output-title { color: #E6EDF3; }
.dark .report-meta { color: #6E7681; }
.dark .calc-result { background: #1C2330; border-color: #27313D; }
.dark .pagination { border-top-color: #27313D; color: #6E7681; }
.dark .page-btn { background: #1C2330; border-color: #27313D; color: #6E7681; }
.dark .page-btn:hover { border-color: #4F7393; color: #4F7393; }
.dark .page-btn.active { background: #1C2330; border-color: #4F7393; color: #4F7393; }
.dark .task-inline-edit input[type="date"] { background: #1C2330; border-color: #27313D; color: #E6EDF3; }
.dark .task-inline-edit select { background: #1C2330; border-color: #27313D; color: #E6EDF3; }
.dark .checkbox { border-color: #27313D; }
.dark .checkbox.done { background: #2F7A5F; border-color: #2F7A5F; }
.dark ::-webkit-scrollbar-track { background: #0E1116; }
.dark ::-webkit-scrollbar-thumb { background: #27313D; }
.sidebar-footer { padding: 16px 20px; border-top: 1px solid #D6D8DB; }
.dark .sidebar-footer { border-top-color: #27313D; }
.dark-mode-btn { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 8px 0; background: transparent; border: 1px solid #D6D8DB; border-radius: 6px; cursor: pointer; font-size: 12px; color: #8A9096; font-family: 'Source Sans 3', sans-serif; margin-bottom: 10px; transition: all 0.15s; }
.dark-mode-btn:hover { border-color: #1E2A3A; color: #1E2A3A; }
.dark .dark-mode-btn { border-color: #27313D; color: #9DA7B3; }
.dark .dark-mode-btn:hover { border-color: #4F7393; color: #4F7393; }
.hamburger-btn { display: none; background: none; border: 1px solid var(--c-border); border-radius: 6px; padding: 6px 10px; font-size: 20px; cursor: pointer; color: var(--c-text); line-height: 1; }
.sidebar-backdrop { display: none; }
.hide-mobile { }
@media (max-width: 768px) {
  .hamburger-btn { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; }
  .sidebar { position: fixed; z-index: 700; top: 0; bottom: 0; left: 0; transform: translateX(-100%); transition: transform 0.25s ease; }
  .sidebar.open { transform: translateX(0); }
  .sidebar-backdrop { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 699; }
  .nav-item { padding: 12px 20px; min-height: 44px; }
  .content { padding: 14px 12px; }
  .topbar { padding: 10px 12px; }
  .topbar-title { font-size: 17px; }
  .topbar-actions { width: 100%; }
  .topbar-actions select, .topbar-actions input { width: 100% !important; min-width: 0 !important; font-size: 16px !important; min-height: 44px; }
  .grid4 { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .grid2, .form-row { grid-template-columns: 1fr; }
  .stat-value { font-size: 24px; }
  .stat-card { padding: 14px 16px; }
  .btn { min-height: 44px; padding: 10px 16px; font-size: 14px; }
  .btn-sm { min-height: 38px; padding: 8px 12px; font-size: 13px; }
  input:not([type=radio]):not([type=checkbox]), select, textarea { font-size: 16px !important; min-height: 44px; padding: 10px 12px; }
  .checkbox { width: 22px; height: 22px; }
  .modal { width: calc(100vw - 16px) !important; max-width: 620px; padding: 18px; border-radius: 8px; }
  .detail-panel { width: 100% !important; }
  .login-box { width: calc(100vw - 24px) !important; max-width: 400px; padding: 28px 20px; }
  .print-doc { width: 100% !important; padding: 24px 16px; }
  .case-overlay { left: 0 !important; }
  .case-overlay-header { padding: 14px 12px; flex-wrap: wrap; gap: 10px; }
  .case-overlay-actions { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; flex-shrink: 1 !important; }
  .case-overlay-actions::-webkit-scrollbar { display: none; }
  .case-overlay-actions .btn { white-space: nowrap; }
  .case-overlay-tabs { padding: 0 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; -ms-overflow-style: none; position: relative; }
  .case-overlay-tabs::-webkit-scrollbar { display: none; }
  .case-overlay-tab { padding: 10px 14px; white-space: nowrap; font-size: 12px; min-height: 44px; display: flex; align-items: center; }
  .case-overlay-body { padding: 16px 12px; }
  .overlay-cols { grid-template-columns: 1fr; gap: 0; }
  .edit-field-key { min-width: 110px; font-size: 11px; }
  .edit-field-actions { opacity: 1; }
  .table-wrap { overflow-x: visible; }
  table.mobile-cards { display: block; width: 100%; }
  table.mobile-cards thead { display: none; }
  table.mobile-cards tbody { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
  table.mobile-cards tr { display: flex; flex-direction: column; background: var(--c-bg); border: 1px solid var(--c-border); border-radius: 8px; padding: 12px 14px; gap: 6px; cursor: pointer; }
  table.mobile-cards tr:hover td { background: transparent; }
  table.mobile-cards td { display: flex; align-items: center; gap: 8px; padding: 2px 0 !important; border-bottom: none !important; font-size: 13px; }
  table.mobile-cards td::before { content: attr(data-label); font-size: 11px; color: var(--c-text3); text-transform: uppercase; letter-spacing: 0.06em; min-width: 90px; flex-shrink: 0; font-weight: 600; }
  table.mobile-cards td[data-label=""]::before, table.mobile-cards td:not([data-label])::before { display: none; }
  table.mobile-cards td.mobile-hide { display: none; }
  table.mobile-cards .selected-row { border-color: var(--c-accent); border-width: 2px; }
  table.mobile-cards .selected-row td:first-child { border-left: none; }
  .pinned-card-mobile { border: none; box-shadow: none; background: transparent; margin-bottom: 8px; }
  .pinned-card-mobile table.mobile-cards tr { border-left: 3px solid #B67A18; }
  th { padding: 8px 8px; font-size: 10px; }
  td { padding: 8px 8px; font-size: 12px; }
  .hide-mobile { display: none !important; }
  .show-mobile { display: flex !important; }
  .tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { white-space: nowrap; padding: 10px 14px; font-size: 13px; min-height: 44px; display: flex; align-items: center; }
  .pagination { font-size: 12px; flex-wrap: wrap; gap: 6px; }
  .page-btn { min-height: 38px; min-width: 38px; display: flex; align-items: center; justify-content: center; }
  .modal-title { font-size: 18px; }
  .card-header { padding: 12px 14px; flex-wrap: wrap; gap: 8px; }
  .card-title { font-size: 14px; }
  .deadline-item { padding: 12px; }
  .note-item { padding: 10px 12px; }
  .print-overlay { padding: 10px 8px; }
  .modal-footer { gap: 8px; flex-wrap: wrap; }
  .modal-footer .btn { flex: 1; min-width: 100px; text-align: center; justify-content: center; }
  .report-card { padding: 14px 16px; }
  .info-row { flex-direction: column; gap: 2px; }
  .info-val { text-align: left; }
  .mobile-grid-1 { grid-template-columns: 1fr !important; display: grid !important; }
  .mobile-full { width: 100% !important; min-width: 0 !important; max-width: 100% !important; }
  .activity-entry { gap: 10px; }
  .activity-avatar-col { width: 28px; }
  .toggle { width: 44px; height: 24px; }
  .toggle-knob { width: 20px; height: 20px; }
  .dark-mode-btn { min-height: 44px; }
  .case-overlay-body [style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
  .modal [style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
  .case-overlay-header > div:first-child { min-width: 0; flex: 1; }
  .case-overlay-header select { max-width: 100%; font-size: 14px !important; }
  .topbar-actions .btn { flex: 1; min-width: 0; text-align: center; justify-content: center; }
  .field-input { width: 100% !important; }
  .case-overlay-panel { width: 100% !important; max-width: 100vw !important; }
  .report-card { min-width: 0 !important; }
}
@media (max-width: 480px) {
  .grid4 { grid-template-columns: 1fr; }
  .stat-value { font-size: 22px; }
  .topbar-title { font-size: 15px; }
  .topbar-subtitle { font-size: 11px; }
  .case-overlay-header { padding: 10px 10px; }
  .case-overlay-body { padding: 12px 10px; }
  .edit-field { flex-wrap: wrap; gap: 4px; }
  .edit-field-key { min-width: 100%; font-size: 11px; }
  .btn { font-size: 13px; }
  .btn-sm { font-size: 12px; }
  .modal { padding: 14px; }
  .modal-title { font-size: 16px; }
  .content { padding: 10px 8px; }
  table.mobile-cards td::before { min-width: 80px; font-size: 10px; }
  table.mobile-cards tr { padding: 10px 12px; }
  .topbar-actions { gap: 6px; }
}
@keyframes pulse-mic {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
`;


// ─── TimePromptModal ──────────────────────────────────────────────────────────
const ATTY_PARA_ROLES = ["Public Defender", "Chief Deputy Public Defender", "Deputy Public Defender", "Senior Trial Attorney", "Trial Attorney", "Trial Coordinator"];
const isAttyPara  = (u) => ATTY_PARA_ROLES.some(r => hasRole(u, r));
const isSupportStaff = (u) => u && !isAttyPara(u);

function TimePromptModal({ pending, onSubmit }) {
  const [time, setTime]           = useState("");
  const [claimIt, setClaimIt]     = useState(false);  // true | false (defaults no-claim)
  const [assignId, setAssignId]   = useState(0);
  const [showAll, setShowAll]     = useState(false);

  if (!pending) return null;

  const { task, completingUser, caseForTask } = pending;

  const showClaimPrompt  = isAttyPara(completingUser)  && task?.assigned > 0 && task.assigned !== completingUser?.id;
  const showAssignPrompt = isSupportStaff(completingUser);

  const caseTeamIds   = caseForTask ? [caseForTask.assignedAttorney, caseForTask.secondAttorney, caseForTask.trialCoordinator, caseForTask.investigator, caseForTask.socialWorker].filter(id => id > 0) : [];
  const caseTeamUsers = USERS.filter(u => caseTeamIds.includes(u.id) && isAttyPara(u));
  const otherAttyPara = USERS.filter(u => !caseTeamIds.includes(u.id) && isAttyPara(u));
  const assignedUser  = task ? getUserById(task.assigned) : null;

  const handleSave = () => {
    const t          = time.trim() || null;
    const completedBy = (showClaimPrompt  && claimIt === true && completingUser) ? completingUser.id : null;
    const timeLogUser = (showAssignPrompt && assignId > 0)                       ? assignId          : null;
    onSubmit(pending.taskId, t, completedBy, timeLogUser);
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 430 }}>
        <div className="modal-title" style={{ marginBottom: 6 }}>Log Time</div>
        <p style={{ fontSize: 13, color: "var(--c-text2)", marginBottom: 14 }}>
          How much time did this task take?
        </p>
        <input
          type="text"
          placeholder="e.g. 1.5 hours, 30 min, 2 hrs"
          value={time}
          onChange={e => setTime(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          autoFocus
        />

        {/* Attorney / Trial Coordinator: claim for own time log? */}
        {showClaimPrompt && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--c-border)" }}>
            <p style={{ fontSize: 13, color: "var(--c-text)", marginBottom: 10 }}>
              This task is assigned to <strong>{assignedUser?.name || "another user"}</strong>.
              Add it to <strong>your</strong> time log instead?
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={`btn ${claimIt === true  ? "btn-gold" : "btn-outline"}`}
                style={{ flex: 1, fontSize: 13 }}
                onClick={() => setClaimIt(true)}
              >Yes, add to mine</button>
              <button
                className={`btn ${claimIt === false ? "btn-gold" : "btn-outline"}`}
                style={{ flex: 1, fontSize: 13 }}
                onClick={() => setClaimIt(false)}
              >No, keep in theirs</button>
            </div>
          </div>
        )}

        {/* Support staff: assign credit to attorney/trial coordinator? */}
        {showAssignPrompt && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--c-border)" }}>
            <p style={{ fontSize: 13, color: "var(--c-text)", marginBottom: 10 }}>
              Assign time credit to an attorney or trial coordinator?
            </p>
            <select value={assignId} onChange={e => setAssignId(Number(e.target.value))}>
              <option value={0}>— Keep in my log —</option>
              {caseTeamUsers.length > 0 && (
                <optgroup label="On this file">
                  {caseTeamUsers.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                </optgroup>
              )}
              {showAll && otherAttyPara.length > 0 && (
                <optgroup label="All attorneys / trial coordinators">
                  {otherAttyPara.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                </optgroup>
              )}
            </select>
            {!showAll && (
              <button
                className="btn btn-outline btn-sm"
                style={{ marginTop: 6, fontSize: 11 }}
                onClick={() => setShowAll(true)}
              >Show all attorneys / paralegals</button>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            className="btn btn-gold"
            style={{ flex: 1 }}
            onClick={handleSave}
          >Save</button>
          <button
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={() => onSubmit(
              pending.taskId,
              time.trim() || null,
              null,
              task?.assigned > 0 ? task.assigned : null
            )}
          >Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─── FollowUpPromptModal ──────────────────────────────────────────────────────
function FollowUpPromptModal({ prompt, onDecide }) {
  const [step, setStep]       = useState("question");
  const [days, setDays]       = useState(7);
  const [escalate, setEscalate] = useState(false);

  if (!prompt) return null;

  const { target } = prompt;

  const handleYes = () => {
    if (days < 1) return;
    onDecide(true, days, escalate);
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 460, maxWidth: "calc(100vw - 24px)" }}>
        <div className="modal-title" style={{ marginBottom: 6 }}>Follow-up Task Completed</div>
        <div style={{ fontSize: 13, color: "#8A9096", marginBottom: 20 }}>
          "{target.title}" has been marked complete.
        </div>

        {step === "question" ? (
          <>
            <p style={{ fontSize: 14, color: "var(--c-text)", marginBottom: 24, lineHeight: 1.6 }}>
              Would you like to schedule another follow-up task?
            </p>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => onDecide(false, null, null)}>
                No, Continue Workflow
              </button>
              <button className="btn btn-primary" onClick={() => setStep("form")}>
                Yes, Schedule Follow-up
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#8A9096", display: "block", marginBottom: 6 }}>
                Days Until Due
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={days}
                onChange={e => setDays(Math.max(1, Number(e.target.value)))}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--c-border)", borderRadius: 6, fontSize: 13, color: "var(--c-text)", background: "var(--c-card)" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, padding: "12px 14px", background: "var(--c-hover)", borderRadius: 8, border: "1px solid var(--c-border)" }}>
              <Toggle on={escalate} onChange={() => setEscalate(p => !p)} />
              <div>
                <div style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 600 }}>Auto-Escalate Priority</div>
                <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>Priority rises automatically as due date approaches</div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 4 }}>
              Priority: <strong style={{ color: "var(--c-text)" }}>{target.priority}</strong>
              {" · "}Assigned to: <strong style={{ color: "var(--c-text)" }}>{target.assignedRole || "same staff"}</strong>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setStep("question")}>Back</button>
              <button className="btn btn-primary" onClick={handleYes}>
                Create Follow-up
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState("dashboard");
  const [selectedCase, setSelectedCase] = useState(null);
  const [pendingTab, setPendingTab] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState(null);

  // Server-backed state — loaded from API after login
  const [allCases,     setAllCases]     = useState([]);
  const [allDeadlines, setAllDeadlines] = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [caseNotes,    setCaseNotes]    = useState({});
  const [caseLinks,    setCaseLinks]    = useState({});
  const [caseActivity, setCaseActivity] = useState({});
  const [allCorrespondence, setAllCorrespondence] = useState([]);
  const [deletedCases, setDeletedCases] = useState(null); // null = not yet loaded
  const [allUsers,     setAllUsers]     = useState(USERS);
  const [pinnedCaseIds, setPinnedCaseIds] = useState([]);

  const [calcInputs, setCalcInputs] = useState({ ruleId: 1, fromDate: today });
  const [calcResult, setCalcResult] = useState(null);
  const [followUpPrompt,   setFollowUpPrompt]   = useState(null);
  const [pendingTimePrompt, setPendingTimePrompt] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("lextrack-dark") === "1");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

  useEffect(() => {
    localStorage.setItem("lextrack-dark", darkMode ? "1" : "0");
    if (darkMode) {
      document.body.classList.add("dark-body");
    } else {
      document.body.classList.remove("dark-body");
    }
  }, [darkMode]);
  // shape: { target, caseForTask, updatedTasksAfterComplete, pendingChainSpawns, completedDate }

  // Load all data from API when user logs in
  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    setDataError(null);
    const isAdmin = (currentUser.roles || [currentUser.role]).includes("App Admin");
    const fetches = [
      apiGetCases(),
      apiGetTasks(),
      apiGetDeadlines(),
      apiGetUsers(),
      apiGetAllCorrespondence(),
      apiGetPinnedCases(),
    ];
    if (isAdmin) fetches.push(apiGetDeletedUsers());
    Promise.all(fetches)
      .then(([cases, fetchedTasks, deadlines, users, corr, pinned, deletedUsersResult]) => {
        setAllCases(cases);
        setTasks(fetchedTasks);
        setAllDeadlines(deadlines);
        setAllCorrespondence(corr || []);
        const serverPins = pinned || [];
        if (serverPins.length === 0) {
          try {
            const localPins = JSON.parse(localStorage.getItem(`pinned_cases_${currentUser.id}`) || "[]");
            if (localPins.length > 0) {
              apiSetPinnedCases(localPins).then(() => localStorage.removeItem(`pinned_cases_${currentUser.id}`)).catch(() => {});
              setPinnedCaseIds(localPins);
            } else { setPinnedCaseIds([]); }
          } catch { setPinnedCaseIds([]); }
        } else {
          setPinnedCaseIds(serverPins);
          localStorage.removeItem(`pinned_cases_${currentUser.id}`);
        }
        const allU = [...users, ...(deletedUsersResult || []).map(u => ({ ...u, deletedAt: u.deletedAt || u.deleted_at }))];
        USERS.splice(0, USERS.length, ...users);
        setAllUsers(allU);
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

  const handleTogglePinnedCase = useCallback(async (caseId) => {
    setPinnedCaseIds(prev => {
      const next = prev.includes(caseId) ? prev.filter(id => id !== caseId) : [...prev, caseId];
      apiSetPinnedCases(next).catch(err => console.error("Failed to save pinned cases:", err));
      return next;
    });
  }, []);

  const handleSelectCase = useCallback(async (c) => {
    setSelectedCase(c);
    if (c) {
      try {
        const caseTasks = await apiGetCaseTasks(c.id);
        setTasks(prev => {
          const existingIds = new Set(prev.map(t => t.id));
          const incoming = caseTasks.filter(t => !existingIds.has(t.id));
          return incoming.length > 0 ? [...prev, ...incoming] : prev;
        });
      } catch (err) {
        console.error("Failed to load case tasks:", err);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentUser) return <LoginScreen onLogin={setCurrentUser} />;

  if (currentUser.mustChangePassword) return (
    <ChangePasswordModal forced currentUser={currentUser} onDone={() => setCurrentUser(prev => ({ ...prev, mustChangePassword: false }))} />
  );

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <img src="/logo.png" alt="MattrMindr" style={{ height: 40 }} />
      <div style={{ fontSize: 13, color: "#8A9096" }}>Loading case data…</div>
    </div>
  );

  if (dataError) return (
    <div style={{ minHeight: "100vh", background: "var(--c-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <img src="/logo.png" alt="MattrMindr" style={{ height: 40 }} />
      <div style={{ fontSize: 13, color: "#e05252" }}>Failed to load data: {dataError}</div>
      <button className="btn btn-outline" onClick={() => setCurrentUser(null)}>Return to Login</button>
    </div>
  );

  const overdueBadge = tasks.filter(t => t.assigned === currentUser?.id && t.status !== "Completed" && daysUntil(t.due) < 0).length;

  const handleAddRecord = async (record) => {
    try {
      const payload = {
        arrestDate: "", arraignmentDate: "", nextCourtDate: "",
        trialDate: "", sentencingDate: "", dispositionDate: "", judge: "",
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

  const TEAM_ROLES = ["assignedAttorney", "secondAttorney", "trialCoordinator", "investigator", "socialWorker"];

  const handleUpdateCase = async (updated) => {
    try {
      const prev = allCases.find(c => c.id === updated.id);
      const saved = await apiUpdateCase(updated.id, updated);
      setAllCases(p => p.map(c => c.id === saved.id ? saved : c));
      setSelectedCase(saved);

      const roleChanges = prev ? TEAM_ROLES.filter(role => saved[role] !== prev[role]) : [];
      if (roleChanges.length > 0) {
        const results = await Promise.all(
          roleChanges.map(role => apiReassignTasksByRole(saved.id, role, saved[role] || 0))
        );
        const allReassigned = results.flat();
        if (allReassigned.length > 0) {
          setTasks(prev => prev.map(t => allReassigned.find(r => r.id === t.id) || t));
        }
      }

      // When status changes to "Disposed", spawn closing task + complete all other open tasks
      if (saved.status === "Disposed" && prev && prev.status !== "Disposed") {
        const alreadyExists = tasks.some(t =>
          t.caseId === saved.id && t.title === "Notify client of case disposition"
        );
        if (!alreadyExists) {
          const triggerTask = {
            caseId: saved.id,
            title: "Notify client of case disposition",
            assigned: saved.assignedAttorney || 0,
            assignedRole: "assignedAttorney",
            due: addDays(today, 7),
            priority: "High",
            autoEscalate: false,
            status: "Not Started",
            notes: "Auto-generated when case status was set to Disposed.",
            recurring: false,
            recurringDays: null,
            isGenerated: true,
            isChained: true,
          };
          const savedTask = await apiCreateTask(triggerTask);
          setTasks(prev => [...prev, savedTask]);
        }
        const openOthers = tasks.filter(t =>
          t.caseId === saved.id &&
          t.status !== "Completed" &&
          t.title !== "Notify client of case disposition"
        );
        if (openOthers.length > 0) {
          const completed = await Promise.all(
            openOthers.map(t => apiUpdateTask(t.id, { status: "Completed" }))
          );
          setTasks(prev => prev.map(t => completed.find(c => c.id === t.id) || t));
        }
      }

      // When status changes to "Closed", mark all open tasks as Completed
      if (saved.status === "Closed" && prev && prev.status !== "Closed") {
        const openTasks = tasks.filter(t =>
          t.caseId === saved.id && t.status !== "Completed"
        );
        if (openTasks.length > 0) {
          const completed = await Promise.all(
            openTasks.map(t => apiUpdateTask(t.id, { status: "Completed" }))
          );
          setTasks(prev => prev.map(t => completed.find(c => c.id === t.id) || t));
        }
      }
    } catch (err) {
      alert("Failed to save case: " + err.message);
    }
  };

  const handleDeleteCase = (id) => {
    setAllCases(p => p.filter(c => c.id !== id));
    setSelectedCase(null);
  };

  const handleRestoreCase = (restoredCase) => {
    setDeletedCases(p => p ? p.filter(c => c.id !== restoredCase.id) : null);
    setAllCases(p => [...p, restoredCase].sort((a, b) => (a.title || "").localeCompare(b.title || "")));
  };

  const handleUpdateTask = async (taskId, changes) => {
    try {
      const saved = await apiUpdateTask(taskId, changes);
      setTasks(prev => prev.map(t => t.id === taskId ? saved : t));
    } catch (err) {
      alert("Failed to update task: " + err.message);
    }
  };

  const handleCompleteTask = (taskId) => {
    const target = tasks.find(t => t.id === taskId);
    if (!target) return;
    if (target.status === "Completed") {
      finishCompleteTask(taskId, null, null, null, true);
    } else {
      const caseForTask = allCases.find(c => c.id === target.caseId);
      setPendingTimePrompt({ taskId, task: target, completingUser: currentUser, caseForTask });
    }
  };

  const logTaskActivity = (target, action, detail) => {
    const entry = {
      id: newId(),
      caseId: target.caseId,
      ts: new Date().toISOString(),
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      action,
      detail,
    };
    apiCreateActivity(entry)
      .then(saved => setCaseActivity(prev => ({ ...prev, [target.caseId]: [saved, ...(prev[target.caseId] || [])] })))
      .catch(e => console.error("Failed to log activity:", e));
  };

  const finishCompleteTask = async (taskId, timeLogged, completedBy, timeLogUser, isUncomplete = false) => {
    setPendingTimePrompt(null);
    try {
      const target = tasks.find(t => t.id === taskId);
      if (!target) return;

      const toggled = await apiCompleteTask(
        taskId,
        isUncomplete ? null : timeLogged,
        isUncomplete ? null : completedBy,
        isUncomplete ? null : timeLogUser
      );
      const completing = toggled.status === "Completed";
      const completedDate = today;

      let updatedTasks = tasks.map(t => t.id === taskId ? toggled : t);

      if (!completing) {
        setTasks(updatedTasks);
        logTaskActivity(target, "Task Reopened", `"${target.title}" marked incomplete`);
        return;
      }

      const caseForTask = allCases.find(c => c.id === target.caseId);
      const resolveRole = (role) => role ? (caseForTask?.[role] || 0) : 0;

      const recurringSpawns = [];
      const chainSpawns = [];

      // Recurring spawn
      if (target.recurring && target.recurringDays) {
        recurringSpawns.push({
          caseId: target.caseId,
          title: target.title,
          assigned: target.assignedRole ? resolveRole(target.assignedRole) : target.assigned,
          assignedRole: target.assignedRole || null,
          due: addDays(target.due || completedDate, target.recurringDays),
          priority: target.priority,
          autoEscalate: target.autoEscalate,
          escalateMediumDays: target.escalateMediumDays,
          escalateHighDays: target.escalateHighDays,
          escalateUrgentDays: target.escalateUrgentDays,
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
        chainSpawns.push({
          caseId: target.caseId,
          title: chainDef.title,
          assigned: resolveRole(chainDef.assignedRole),
          assignedRole: chainDef.assignedRole || null,
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

      // Multi-chain spawn — one completion spawns multiple tasks
      const multiChainDefs = MULTI_CHAINS[target.title.trim()];
      if (multiChainDefs) {
        multiChainDefs.forEach(def => {
          const alreadyExists = updatedTasks.some(t =>
            t.caseId === target.caseId && t.title.trim() === def.title
          );
          if (alreadyExists) return;
          chainSpawns.push({
            caseId: target.caseId,
            title: def.title,
            assigned: resolveRole(def.assignedRole),
            assignedRole: def.assignedRole || null,
            due: addDays(completedDate, def.dueDaysFromCompletion),
            priority: def.priority,
            autoEscalate: def.autoEscalate,
            status: "Not Started",
            notes: def.notes || "",
            recurring: false,
            recurringDays: null,
            isGenerated: true,
            isChained: true,
          });
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
        chainSpawns.push({
          caseId: target.caseId,
          title: s.title,
          assigned: resolveRole(s.assignedRole),
          assignedRole: s.assignedRole || null,
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


      const assignedToOther = target.assigned > 0 && target.assigned !== currentUser.id;
      const completionDetail = assignedToOther
        ? `"${target.title}" completed by ${currentUser.name} (assigned to ${getUserById(target.assigned)?.name || "unknown"})`
        : `"${target.title}" marked complete`;

      // Follow-up tasks: always spawn recurring immediately, but hold chain spawns
      // until user decides whether they want another follow-up
      if (target.title.trim().startsWith("Follow-up")) {
        if (recurringSpawns.length > 0) {
          const savedR = await apiCreateTasks(recurringSpawns);
          updatedTasks = [...updatedTasks, ...savedR];
        }
        setTasks(updatedTasks);
        logTaskActivity(target, "Task Completed", completionDetail);
        setFollowUpPrompt({
          target,
          caseForTask,
          updatedTasksAfterComplete: updatedTasks,
          pendingChainSpawns: chainSpawns,
          completedDate,
        });
        return;
      }

      // Normal tasks: spawn everything
      const allSpawns = [...recurringSpawns, ...chainSpawns];
      if (allSpawns.length > 0) {
        const savedSpawned = await apiCreateTasks(allSpawns);
        updatedTasks = [...updatedTasks, ...savedSpawned];
      }

      setTasks(updatedTasks);
      logTaskActivity(target, "Task Completed", completionDetail);
    } catch (err) {
      alert("Failed to complete task: " + err.message);
    }
  };

  const handleFollowUpDecision = async (wantsFollowUp, days, escalate) => {
    const { target, caseForTask, updatedTasksAfterComplete, pendingChainSpawns } = followUpPrompt;
    const resolveRole = (role) => role ? (caseForTask?.[role] || 0) : 0;
    let updatedTasks = updatedTasksAfterComplete;
    try {
      if (wantsFollowUp) {
        const newTask = {
          caseId: target.caseId,
          title: target.title,
          assigned: target.assignedRole ? resolveRole(target.assignedRole) : target.assigned,
          assignedRole: target.assignedRole || null,
          due: addDays(today, days),
          priority: target.priority,
          autoEscalate: escalate,
          status: "Not Started",
          notes: `Follow-up rescheduled by user after completing previous "${target.title}".`,
          recurring: false,
          recurringDays: null,
          isGenerated: true,
          isChained: true,
        };
        const saved = await apiCreateTask(newTask);
        updatedTasks = [...updatedTasks, saved];
        // Pending chain spawns are NOT created — they will fire when this new follow-up is eventually completed
      } else {
        // User is done with follow-ups — release the pending chain tasks
        if (pendingChainSpawns.length > 0) {
          const savedChain = await apiCreateTasks(pendingChainSpawns);
          updatedTasks = [...updatedTasks, ...savedChain];
        }
      }
      setTasks(updatedTasks);
    } catch (err) {
      alert("Failed to process follow-up decision: " + err.message);
    }
    setFollowUpPrompt(null);
  };

  return (
    <div className={`app${darkMode ? " dark" : ""}`}>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="sidebar-logo">
          <img src="/logo.png" alt="MattrMindr" style={{ height: 30 }} />
        </div>
        <div className="sidebar-user">
          <Avatar userId={currentUser.id} size={34} />
          <div>
            <div className="sidebar-user-name">{currentUser.name}</div>
            <div className="sidebar-user-role">{(currentUser.roles && currentUser.roles.length > 1) ? currentUser.roles.join(" · ") : currentUser.role}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {[
            { id: "dashboard", icon: "⬛", label: "Dashboard" },
            { id: "cases", icon: "⚖️", label: "Cases" },
            { id: "deadlines", icon: "📅", label: "Deadlines" },
            { id: "tasks", icon: "✅", label: "Tasks", badge: overdueBadge || null },
            { id: "documents", icon: "📄", label: "Templates" },
            { id: "timelog", icon: "🕐", label: "Time Log" },
            { id: "reports", icon: "📊", label: "Reports" },
            { id: "aicenter", icon: "⚡", label: "AI Center" },
            { id: "contacts", icon: "📇", label: "Contacts" },
            { id: "staff", icon: "👥", label: "Staff" },
          ].map(item => (
            <div key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); setSelectedCase(null); setSidebarOpen(false); }}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="dark-mode-btn" onClick={() => setDarkMode(d => !d)}>
            {darkMode ? "☀️  Light Mode" : "🌙  Dark Mode"}
          </button>
          <div style={{ fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Signed in as</div>
          <div style={{ fontSize: 12, color: "var(--c-text2)", marginBottom: 10 }}>{currentUser.email}</div>
          <button className="btn btn-outline" style={{ width: "100%", fontSize: 12, marginBottom: 6 }} onClick={() => setShowChangePw(true)}>Change Password</button>
          <button className="btn btn-outline" style={{ width: "100%", fontSize: 12 }} onClick={() => { apiLogout().catch(() => {}); setCurrentUser(null); setAllCases([]); setAllDeadlines([]); setTasks([]); setCaseNotes({}); setCaseLinks({}); setCaseActivity({}); setSelectedCase(null); setDeletedCases(null); }}>Sign Out</button>
        </div>
      </aside>
      {showChangePw && (
        <ChangePasswordModal currentUser={currentUser} onClose={() => setShowChangePw(false)} />
      )}
      <div className="main">
        {view === "dashboard" && <Dashboard currentUser={currentUser} allCases={allCases} deadlines={allDeadlines} tasks={tasks} onSelectCase={(c, tab) => { setPendingTab(tab || null); handleSelectCase(c); setView("cases"); }} onAddRecord={handleAddRecord} onCompleteTask={handleCompleteTask} onUpdateTask={handleUpdateTask} onMenuToggle={() => setSidebarOpen(true)} pinnedCaseIds={pinnedCaseIds} />}
        {view === "cases" && <CasesView currentUser={currentUser} allCases={allCases} tasks={tasks} selectedCase={selectedCase} setSelectedCase={handleSelectCase} pendingTab={pendingTab} clearPendingTab={() => setPendingTab(null)} onAddRecord={handleAddRecord} onUpdateCase={handleUpdateCase} onCompleteTask={handleCompleteTask} onAddTask={(saved) => setTasks(p => [...p, saved])} deadlines={allDeadlines} caseNotes={caseNotes} setCaseNotes={setCaseNotes} caseLinks={caseLinks} setCaseLinks={setCaseLinks} caseActivity={caseActivity} setCaseActivity={setCaseActivity} deletedCases={deletedCases} setDeletedCases={setDeletedCases} onDeleteCase={handleDeleteCase} onRestoreCase={handleRestoreCase} onAddDeadline={async (dl) => { try { const saved = await apiCreateDeadline(dl); setAllDeadlines(p => [...p, saved]); } catch (err) { console.error("Failed to add deadline:", err); } }} onUpdateDeadline={async (id, data) => { try { const updated = await apiUpdateDeadline(id, data); setAllDeadlines(p => p.map(d => d.id === id ? updated : d)); } catch (err) { console.error("Failed to update deadline:", err); } }} onMenuToggle={() => setSidebarOpen(true)} pinnedCaseIds={pinnedCaseIds} onTogglePinnedCase={handleTogglePinnedCase} />}
        {view === "deadlines" && <DeadlinesView deadlines={allDeadlines} onAddDeadline={async (dl) => { try { const saved = await apiCreateDeadline(dl); setAllDeadlines(p => [...p, saved]); } catch (err) { alert("Failed to add deadline: " + err.message); } }} allCases={allCases} calcInputs={calcInputs} setCalcInputs={setCalcInputs} calcResult={calcResult} runCalc={() => { const rule = COURT_RULES.find(r => r.id === Number(calcInputs.ruleId)); if (rule && calcInputs.fromDate) setCalcResult({ rule, from: calcInputs.fromDate, result: addDays(calcInputs.fromDate, rule.days) }); }} currentUser={currentUser} onMenuToggle={() => setSidebarOpen(true)} pinnedCaseIds={pinnedCaseIds} />}
        {view === "documents" && <DocumentsView currentUser={currentUser} allCases={allCases} onMenuToggle={() => setSidebarOpen(true)} />}
        {view === "tasks" && <TasksView tasks={tasks} onAddTask={async (task) => { try { const saved = await apiCreateTask(task); setTasks(p => [...p, saved]); } catch (err) { alert("Failed to add task: " + err.message); } }} allCases={allCases} currentUser={currentUser} onCompleteTask={handleCompleteTask} onUpdateTask={handleUpdateTask} onMenuToggle={() => setSidebarOpen(true)} pinnedCaseIds={pinnedCaseIds} />}
        {view === "reports" && <ReportsView allCases={allCases} tasks={tasks} deadlines={allDeadlines} currentUser={currentUser} onUpdateCase={handleUpdateCase} onCompleteTask={handleCompleteTask} onAddTask={(saved) => setTasks(p => [...p, saved])} onDeleteCase={handleDeleteCase} caseNotes={caseNotes} setCaseNotes={setCaseNotes} caseLinks={caseLinks} setCaseLinks={setCaseLinks} caseActivity={caseActivity} setCaseActivity={setCaseActivity} onAddDeadline={async (dl) => { try { const saved = await apiCreateDeadline(dl); setAllDeadlines(p => [...p, saved]); } catch (err) { console.error("Failed to add deadline:", err); } }} onUpdateDeadline={async (id, data) => { try { const updated = await apiUpdateDeadline(id, data); setAllDeadlines(p => p.map(d => d.id === id ? updated : d)); } catch (err) { console.error("Failed to update deadline:", err); } }} onMenuToggle={() => setSidebarOpen(true)} />}
        {view === "aicenter" && <AiCenterView allCases={allCases} currentUser={currentUser} onMenuToggle={() => setSidebarOpen(true)} pinnedCaseIds={pinnedCaseIds} />}
        {view === "timelog" && <TimeLogView currentUser={currentUser} allCases={allCases} tasks={tasks} caseNotes={caseNotes} correspondence={allCorrespondence} allUsers={allUsers} onMenuToggle={() => setSidebarOpen(true)} pinnedCaseIds={pinnedCaseIds} />}
        {view === "contacts" && <ContactsView currentUser={currentUser} allCases={allCases} onOpenCase={c => { handleSelectCase(c); setView("cases"); }} onMenuToggle={() => setSidebarOpen(true)} />}
        {view === "staff" && <StaffView allCases={allCases} currentUser={currentUser} setCurrentUser={setCurrentUser} allUsers={allUsers} setAllUsers={setAllUsers} onMenuToggle={() => setSidebarOpen(true)} />}
      </div>
      <FollowUpPromptModal
        key={followUpPrompt ? `${followUpPrompt.target.id}-${followUpPrompt.completedDate}` : "none"}
        prompt={followUpPrompt}
        onDecide={handleFollowUpDecision}
      />
      <TimePromptModal
        key={pendingTimePrompt?.taskId}
        pending={pendingTimePrompt}
        onSubmit={(taskId, timeLogged, completedBy, timeLogUser) => finishCompleteTask(taskId, timeLogged, completedBy, timeLogUser)}
      />
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [err,      setErr]      = useState("");
  const [busy,     setBusy]     = useState(false);
  const [view,     setView]     = useState("login");
  const [resetCode, setResetCode] = useState("");
  const [newPw,    setNewPw]    = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [msg,      setMsg]      = useState("");

  const doLogin = async () => {
    if (!email.trim()) { setErr("Enter your email address."); return; }
    if (!password)     { setErr("Enter your password."); return; }
    setBusy(true);
    setErr("");
    try {
      const user = await apiLogin(email.trim(), password);
      onLogin(user);
    } catch (e) {
      setErr(e.message || "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  const doForgot = async () => {
    if (!email.trim()) { setErr("Enter your email address first."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      const result = await apiForgotPassword(email.trim());
      setMsg(result.message || "If an account exists, a reset code has been sent.");
      setView("reset");
    } catch (e) {
      setErr(e.message || "Failed to send reset email.");
    } finally { setBusy(false); }
  };

  const doReset = async () => {
    if (!resetCode.trim()) { setErr("Enter the reset code from your email."); return; }
    if (!newPw || newPw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (!/[A-Z]/.test(newPw)) { setErr("Must contain at least 1 uppercase letter."); return; }
    if (!/[a-z]/.test(newPw)) { setErr("Must contain at least 1 lowercase letter."); return; }
    if (!/[0-9]/.test(newPw)) { setErr("Must contain at least 1 number."); return; }
    if (!/[^A-Za-z0-9]/.test(newPw)) { setErr("Must contain at least 1 special character."); return; }
    if (newPw !== confirmPw) { setErr("Passwords do not match."); return; }
    setBusy(true); setErr("");
    try {
      await apiResetPassword(email.trim(), resetCode.trim(), newPw);
      setMsg("Password reset successful. You can now log in.");
      setView("login"); setPassword(""); setResetCode(""); setNewPw(""); setConfirmPw("");
    } catch (e) {
      setErr(e.message || "Reset failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="login-bg">
      <div className="login-box">
        <img src="/logo.png" alt="MattrMindr" style={{ height: 48, marginBottom: 8 }} />
        <div className="login-sub">Case Management System</div>

        {view === "login" && (<>
          <div className="form-group">
            <label>Email</label>
            <input type="email" placeholder="your.email@mobiledefender.org" value={email} onChange={e => { setEmail(e.target.value); setErr(""); setMsg(""); }} onKeyDown={e => e.key === "Enter" && doLogin()} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Enter your password" value={password} onChange={e => { setPassword(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && doLogin()} />
          </div>
          {err && <div style={{ color: "#e05252", fontSize: 13, marginBottom: 12 }}>{err}</div>}
          {msg && <div style={{ color: "#1E2A3A", fontSize: 13, marginBottom: 12 }}>{msg}</div>}
          <button className="btn btn-gold" style={{ width: "100%", padding: 10 }} onClick={doLogin} disabled={busy}>
            {busy ? "Signing in…" : "Sign In"}
          </button>
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <span style={{ fontSize: 12, color: "#1E2A3A", cursor: "pointer" }} onClick={() => { setErr(""); setMsg(""); setView("forgot"); }}>Forgot password?</span>
          </div>
        </>)}

        {view === "forgot" && (<>
          <div style={{ fontSize: 13, color: "#8A9096", marginBottom: 16 }}>Enter your email and we'll send a reset code.</div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" placeholder="your.email@mobiledefender.org" value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && doForgot()} />
          </div>
          {err && <div style={{ color: "#e05252", fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-gold" style={{ width: "100%", padding: 10 }} onClick={doForgot} disabled={busy}>
            {busy ? "Sending…" : "Send Reset Code"}
          </button>
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <span style={{ fontSize: 12, color: "#1E2A3A", cursor: "pointer" }} onClick={() => { setErr(""); setView("login"); }}>Back to login</span>
          </div>
        </>)}

        {view === "reset" && (<>
          <div style={{ fontSize: 13, color: "#8A9096", marginBottom: 16 }}>Enter the reset code from your email and choose a new password.</div>
          <div className="form-group">
            <label>Reset Code</label>
            <input type="text" placeholder="Enter code from email" value={resetCode} onChange={e => { setResetCode(e.target.value); setErr(""); }} />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" placeholder="At least 8 characters" value={newPw} onChange={e => { setNewPw(e.target.value); setErr(""); }} />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => { setConfirmPw(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && doReset()} />
          </div>
          {err && <div style={{ color: "#e05252", fontSize: 13, marginBottom: 12 }}>{err}</div>}
          <button className="btn btn-gold" style={{ width: "100%", padding: 10 }} onClick={doReset} disabled={busy}>
            {busy ? "Resetting…" : "Reset Password"}
          </button>
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <span style={{ fontSize: 12, color: "#1E2A3A", cursor: "pointer" }} onClick={() => { setErr(""); setView("login"); }}>Back to login</span>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── Change Password Modal ──────────────────────────────────────────────────
function ChangePasswordModal({ forced, currentUser, onDone, onClose }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const doChange = async () => {
    if (!forced && !currentPw) { setErr("Enter your current password."); return; }
    if (!newPw || newPw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (!/[A-Z]/.test(newPw)) { setErr("Password must contain at least 1 uppercase letter."); return; }
    if (!/[a-z]/.test(newPw)) { setErr("Password must contain at least 1 lowercase letter."); return; }
    if (!/[0-9]/.test(newPw)) { setErr("Password must contain at least 1 number."); return; }
    if (!/[^A-Za-z0-9]/.test(newPw)) { setErr("Password must contain at least 1 special character."); return; }
    if (newPw !== confirmPw) { setErr("Passwords do not match."); return; }
    setBusy(true); setErr("");
    try {
      await apiChangePassword(forced ? null : currentPw, newPw);
      if (onDone) onDone();
      if (onClose) onClose();
    } catch (e) {
      setErr(e.message || "Failed to change password.");
    } finally { setBusy(false); }
  };

  const content = (
    <>
      <img src="/logo.png" alt="MattrMindr" style={{ height: 36, marginBottom: 8 }} />
      {forced && <div style={{ fontSize: 13, color: "#8A9096", margin: "8px 0 16px" }}>You must set a new password before continuing.</div>}
      {!forced && (
        <div className="form-group">
          <label>Current Password</label>
          <input type="password" placeholder="Enter current password" value={currentPw} onChange={e => { setCurrentPw(e.target.value); setErr(""); }} />
        </div>
      )}
      <div className="form-group">
        <label>New Password</label>
        <input type="password" placeholder="At least 8 characters" value={newPw} onChange={e => { setNewPw(e.target.value); setErr(""); }} />
        <div style={{ fontSize: 11, color: "#8A9096", marginTop: 4 }}>Must include uppercase, lowercase, number, and special character</div>
      </div>
      <div className="form-group">
        <label>Confirm New Password</label>
        <input type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => { setConfirmPw(e.target.value); setErr(""); }} onKeyDown={e => e.key === "Enter" && doChange()} />
      </div>
      {err && <div style={{ color: "#e05252", fontSize: 13, marginBottom: 12 }}>{err}</div>}
      <button className="btn btn-gold" style={{ width: "100%", padding: 10 }} onClick={doChange} disabled={busy}>
        {busy ? "Saving…" : "Set New Password"}
      </button>
    </>
  );

  if (forced) {
    return (
      <div className="login-bg">
        <div className="login-box">{content}</div>
      </div>
    );
  }

  return (
    <div className="case-overlay" style={{ left: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="login-box" style={{ maxWidth: 420, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative" }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 16, background: "transparent", border: "none", fontSize: 18, color: "#8A9096", cursor: "pointer", lineHeight: 1 }}>✕</button>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "var(--c-text-h)", marginBottom: 16 }}>Change Password</div>
        {content}
        <button className="btn btn-outline" style={{ width: "100%", marginTop: 10 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Toggle Helper ────────────────────────────────────────────────────────────
function Toggle({ on, onChange, color = "#1E2A3A" }) {
  return (
    <div className="toggle" style={{ background: on ? color : "#D6D8DB" }} onClick={onChange}>
      <div className="toggle-knob" style={{ left: on ? 20 : 2 }} />
    </div>
  );
}

// ─── Reusable AI Panel Component ────────────────────────────────────────────
function AiPanel({ title, result, loading, error, onRun, onClose, actions, children }) {
  return (
    <div style={{ background: "linear-gradient(135deg, #f8f6f0, #f3f0e8)", border: "1px solid #d4c9a8", borderRadius: 8, padding: "14px 16px", marginTop: 10, fontSize: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: loading || result || error || children ? 10 : 0 }}>
        <div style={{ fontWeight: 600, color: "#1E2A3A", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>⚡</span> {title}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {result && onRun && <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={onRun}>↻ Retry</button>}
          {actions}
          {onClose && <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#8A9096", padding: "0 2px" }} onClick={onClose}>✕</button>}
        </div>
      </div>
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", color: "#8A9096" }}>
          <div style={{ width: 16, height: 16, border: "2px solid #d4c9a8", borderTopColor: "#b8860b", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 12 }}>AI is analyzing...</span>
        </div>
      )}
      {error && <div style={{ color: "#dc2626", fontSize: 12, padding: "8px 0" }}>{error}</div>}
      {result && (
        <div style={{ fontSize: 12, lineHeight: 1.7, color: "#1E2A3A", whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto", padding: "4px 0" }}>
          {result.split("\n").map((line, i) => {
            if (line.startsWith("## ")) return <div key={i} style={{ fontWeight: 700, fontSize: 14, marginTop: 12, marginBottom: 4, color: "#1E2A3A" }}>{line.replace(/^## /, "")}</div>;
            if (line.startsWith("### ")) return <div key={i} style={{ fontWeight: 600, fontSize: 13, marginTop: 10, marginBottom: 2, color: "#1E2A3A" }}>{line.replace(/^### /, "")}</div>;
            if (line.startsWith("**") && line.endsWith("**")) return <div key={i} style={{ fontWeight: 700, marginTop: 8, marginBottom: 2 }}>{line.replace(/\*\*/g, "")}</div>;
            if (line.startsWith("- ") || line.startsWith("* ")) return <div key={i} style={{ paddingLeft: 12, position: "relative" }}><span style={{ position: "absolute", left: 0 }}>•</span>{line.replace(/^[-*] /, "").replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
            if (line.match(/^\d+\.\s/)) return <div key={i} style={{ paddingLeft: 4 }}>{line.replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
            if (line.trim() === "") return <div key={i} style={{ height: 6 }} />;
            return <div key={i}>{line.replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
          })}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── New Case Modal ──────────────────────────────────────────────────────────
function NewCaseModal({ onSave, onClose }) {
  const [form, setForm] = useState({ caseNum: "", title: "", defendantName: "", prosecutor: "", county: "", court: "", courtDivision: "", chargeDescription: "", chargeStatute: "", chargeClass: "", caseType: "Felony", stage: "Arraignment", assignedAttorney: 0, secondAttorney: 0, trialCoordinator: 0, investigator: 0, socialWorker: 0, arrestDate: "", notes: "", deathPenalty: false });
  const [autoTasks, setAutoTasks] = useState(true);
  const [conflicts, setConflicts] = useState(null);
  const [conflictChecking, setConflictChecking] = useState(false);
  const [chargeAi, setChargeAi] = useState({ loading: false, result: null, error: null, show: false });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const checkConflicts = async (name) => {
    if (!name || name.trim().length < 2) { setConflicts(null); return; }
    setConflictChecking(true);
    try {
      const result = await apiConflictCheck(name.trim());
      if (result.cases.length > 0 || result.contacts.length > 0) setConflicts(result);
      else setConflicts(null);
    } catch { setConflicts(null); }
    setConflictChecking(false);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">Open New Case</div>
        <div className="modal-sub">
          Enter the case details below.
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <Badge label="Case" />
          <Badge label="Active" />
        </div>

        <div className="form-row">
          <div className="form-group"><label>Case Number</label><input value={form.caseNum} onChange={e => set("caseNum", e.target.value)} placeholder="e.g. CC-2025-001234" /></div>
          <div className="form-group"><label>Case Title *</label><input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. State v. Smith" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Defendant Name</label><input value={form.defendantName} onChange={e => set("defendantName", e.target.value)} onBlur={e => checkConflicts(e.target.value)} /></div>
          <div className="form-group"><label>Prosecutor</label><input value={form.prosecutor} onChange={e => set("prosecutor", e.target.value)} /></div>
        </div>
        {conflictChecking && <div style={{ padding: "8px 12px", background: "#FFF8E1", border: "1px solid #FFD54F", borderRadius: 6, marginBottom: 10, fontSize: 12, color: "#795548" }}>Checking for conflicts...</div>}
        {conflicts && (
          <div style={{ padding: "10px 14px", background: "#FFF3E0", border: "1px solid #FF9800", borderRadius: 6, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#E65100", marginBottom: 6 }}>⚠ Potential Conflict Detected</div>
            {conflicts.cases.length > 0 && <div style={{ fontSize: 12, color: "#BF360C", marginBottom: 4 }}>
              <strong>Matching cases:</strong> {conflicts.cases.map(cc => `${cc.title} (${cc.case_num || "no case #"})`).join(", ")}
            </div>}
            {conflicts.contacts.length > 0 && <div style={{ fontSize: 12, color: "#BF360C" }}>
              <strong>Matching contacts:</strong> {conflicts.contacts.map(cc => `${cc.first_name} ${cc.last_name}`).join(", ")}
            </div>}
            <div style={{ fontSize: 11, color: "#795548", marginTop: 4 }}>Review potential conflicts before proceeding.</div>
          </div>
        )}
        <div className="form-row">
          <div className="form-group"><label>Court Division</label>
            <select value={form.courtDivision} onChange={e => set("courtDivision", e.target.value)}>
              <option value="">— Select —</option>
              <option value="Circuit">Circuit Court</option>
              <option value="District">District Court</option>
              <option value="Juvenile">Juvenile Court</option>
            </select>
          </div>
          <div className="form-group"><label>County</label><input value={form.county} onChange={e => set("county", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Court</label><input value={form.court} onChange={e => set("court", e.target.value)} /></div>
          <div className="form-group"><label>Judge</label><input value={form.judge || ""} onChange={e => set("judge", e.target.value)} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Case Type</label>
            <select value={form.caseType} onChange={e => set("caseType", e.target.value)}>
              {["Felony", "Misdemeanor", "Juvenile", "Probation Violation", "Mental Health/Commitment", "Appeal", "Other"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Charge Description</label><input value={form.chargeDescription} onChange={e => set("chargeDescription", e.target.value)} onBlur={() => {
            if ((form.chargeDescription || form.chargeStatute) && !form.chargeClass) {
              set("_classifying", true);
              apiGetChargeClass({ statute: form.chargeStatute, description: form.chargeDescription }).then(r => { setForm(p => p.chargeClass ? { ...p, _classifying: false } : { ...p, chargeClass: r.chargeClass, _classifying: false }); }).catch(() => set("_classifying", false));
            }
          }} /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Charge Statute</label><input value={form.chargeStatute} onChange={e => set("chargeStatute", e.target.value)} onBlur={() => {
            if ((form.chargeDescription || form.chargeStatute) && !form.chargeClass) {
              set("_classifying", true);
              apiGetChargeClass({ statute: form.chargeStatute, description: form.chargeDescription }).then(r => { setForm(p => p.chargeClass ? { ...p, _classifying: false } : { ...p, chargeClass: r.chargeClass, _classifying: false }); }).catch(() => set("_classifying", false));
            }
          }} /></div>
          <div className="form-group"><label>Charge Class {form._classifying && <span style={{ fontSize: 10, color: "#b8860b" }}>(classifying...)</span>}</label>
            <select value={form.chargeClass} onChange={e => set("chargeClass", e.target.value)}>
              <option value="">— Select —</option>
              {["Class A Felony", "Class B Felony", "Class C Felony", "Misdemeanor A", "Misdemeanor B", "Misdemeanor C", "Violation", "Other"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Arrest Date</label><input type="date" value={form.arrestDate} onChange={e => set("arrestDate", e.target.value)} /></div>
        </div>
        {(form.chargeDescription || form.chargeStatute) && (
          <div style={{ marginBottom: 10 }}>
            {!chargeAi.show ? (
              <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#b8860b", borderColor: "#d4c9a8" }} onClick={() => {
                setChargeAi({ loading: true, result: null, error: null, show: true });
                apiChargeAnalysis({ chargeDescription: form.chargeDescription, chargeStatute: form.chargeStatute, chargeClass: form.chargeClass, caseType: form.caseType, courtDivision: form.courtDivision })
                  .then(r => setChargeAi(p => ({ ...p, loading: false, result: r.result })))
                  .catch(e => setChargeAi(p => ({ ...p, loading: false, error: e.message })));
              }}>⚡ Analyze Charges</button>
            ) : (
              <AiPanel title="Charge Analysis" result={chargeAi.result} loading={chargeAi.loading} error={chargeAi.error} onClose={() => setChargeAi({ loading: false, result: null, error: null, show: false })} onRun={() => {
                setChargeAi({ loading: true, result: null, error: null, show: true });
                apiChargeAnalysis({ chargeDescription: form.chargeDescription, chargeStatute: form.chargeStatute, chargeClass: form.chargeClass, caseType: form.caseType, courtDivision: form.courtDivision })
                  .then(r => setChargeAi(p => ({ ...p, loading: false, result: r.result })))
                  .catch(e => setChargeAi(p => ({ ...p, loading: false, error: e.message })));
              }} />
            )}
          </div>
        )}
        <div className="form-row">
          <div className="form-group"><label>Stage</label>
            <select value={form.stage} onChange={e => set("stage", e.target.value)}>
              {["Arraignment", "Preliminary Hearing", "Grand Jury/Indictment", "Pre-Trial Motions", "Plea Negotiations", "Trial", "Sentencing", "Post-Conviction", "Appeal"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: form.deathPenalty ? 700 : 400, color: form.deathPenalty ? "#991b1b" : "#8A9096", cursor: "pointer", userSelect: "none" }}>
              <input type="checkbox" checked={form.deathPenalty} onChange={e => set("deathPenalty", e.target.checked)} style={{ margin: 0, cursor: "pointer", accentColor: "#991b1b" }} />
              Death Penalty Case
            </label>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Assigned Attorney</label>
            <select value={form.assignedAttorney} onChange={e => set("assignedAttorney", Number(e.target.value))}>
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
        <div className="form-row">
          <div className="form-group"><label>Trial Coordinator</label>
            <select value={form.trialCoordinator} onChange={e => set("trialCoordinator", Number(e.target.value))}>
              <option value={0}>— None —</option>
              {USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Investigator</label>
            <select value={form.investigator} onChange={e => set("investigator", Number(e.target.value))}>
              <option value={0}>— None —</option>
              {USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Social Worker</label>
            <select value={form.socialWorker} onChange={e => set("socialWorker", Number(e.target.value))}>
              <option value={0}>— None —</option>
              {USERS.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="form-group" />
        </div>
        <div className="form-group"><label>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={3} /></div>

        <div style={{ background: autoTasks ? "#E4E7EB" : "var(--c-bg)", border: `1px solid ${autoTasks ? "#1E2A3A22" : "#D6D8DB"}`, borderRadius: 7, padding: "12px 14px", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 600 }}>✅ Auto-generate opening tasks</div>
              <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>Initial client interview, request discovery, obtain arrest report, review bond, conflict check, background investigation</div>
            </div>
            <Toggle on={autoTasks} onChange={() => setAutoTasks(p => !p)} />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" disabled={!form.title.trim()} onClick={() => { onSave({ ...form, autoTasks }); onClose(); }}>
            Open Case
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Auto-escalate preview box ────────────────────────────────────────────────
function EscalateBox({ on, onChange, basePriority, mediumDays, highDays, urgentDays, onChangeDays }) {
  const md = mediumDays ?? 30;
  const hd = highDays ?? 14;
  const ud = urgentDays ?? 7;
  return (
    <div style={{ background: on ? "#E4E7EB" : "var(--c-bg)", border: `1px solid ${on ? "#1E2A3A22" : "#D6D8DB"}`, borderRadius: 7, padding: "12px 14px", transition: "all 0.2s" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: on ? 10 : 0 }}>
        <div><div style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 600 }}>🔺 Auto-Escalate Priority</div><div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>Priority rises automatically as the due date approaches</div></div>
        <Toggle on={on} onChange={onChange} />
      </div>
      {on && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
          {[
            { label: `${md}+ days`, result: basePriority, note: "Base", field: null },
            { label: `${ud + 1}–${md} days`, result: basePriority === "Low" ? "Medium" : basePriority, note: "↑ if Low", field: "medium", days: md },
            { label: `${ud + 1}–${hd} days`, result: (basePriority === "Low" || basePriority === "Medium") ? "High" : basePriority, note: "↑ if <High", field: "high", days: hd },
            { label: `≤${ud} days`, result: "Urgent", note: "Always", field: "urgent", days: ud },
          ].map(({ label, result, note, field, days }) => {
            const s = statusBadgeStyle(result);
            return (
              <div key={label} style={{ background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: 5, padding: "7px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#8A9096", marginBottom: 4 }}>{field ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    ≤ <input
                      type="number"
                      min={1}
                      value={days}
                      onChange={e => onChangeDays && onChangeDays(field, parseInt(e.target.value) || 1)}
                      style={{ width: 36, fontSize: 10, padding: "1px 3px", border: "1px solid var(--c-border)", borderRadius: 3, textAlign: "center", background: "var(--c-card)", color: "var(--c-text)" }}
                    /> days
                  </span>
                ) : label}</div>
                <div style={{ background: s.bg, color: "#1F2428", fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 3, display: "inline-block" }}>{result}</div>
                <div style={{ fontSize: 10, color: "#8A9096", marginTop: 3 }}>{note}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard Widget System ─────────────────────────────────────────────────
const DASHBOARD_WIDGETS = [
  { id: "stat-active", label: "Active Records", size: "quarter", icon: "📊" },
  { id: "stat-deadlines", label: "Upcoming Deadlines Count", size: "quarter", icon: "📅" },
  { id: "stat-tasks", label: "My Open Tasks Count", size: "quarter", icon: "✅" },
  { id: "stat-trials", label: "Trials in 90 Days Count", size: "quarter", icon: "⚖️" },
  { id: "deadlines", label: "Upcoming Deadlines", size: "half", icon: "📋" },
  { id: "trials", label: "Trials Within 90 Days", size: "half", icon: "🏛️" },
  { id: "tasks", label: "My Tasks", size: "full", icon: "📝" },
  { id: "pinned", label: "Pinned Cases", size: "full", icon: "📌" },
  { id: "recent-activity", label: "Recent Activity", size: "half", icon: "🕐" },
  { id: "overdue", label: "Overdue Tasks", size: "half", icon: "⚠️" },
  { id: "my-time", label: "My Time", size: "half", icon: "⏱️" },
  { id: "ai-triage", label: "AI Case Triage", size: "full", icon: "⚡" },
  { id: "quick-notes", label: "Quick Notes", size: "half", icon: "📝" },
];
const DEFAULT_LAYOUT = ["stat-active", "stat-deadlines", "stat-tasks", "stat-trials", "deadlines", "trials", "tasks"];
const getDashboardLayout = (userId) => { try { return JSON.parse(localStorage.getItem(`dashboard_layout_${userId}`)) || DEFAULT_LAYOUT; } catch { return DEFAULT_LAYOUT; } };
const saveDashboardLayout = (userId, layout) => localStorage.setItem(`dashboard_layout_${userId}`, JSON.stringify(layout));

function CustomizeDashboardModal({ layout, setLayout, userId, onClose }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const available = DASHBOARD_WIDGETS.filter(w => !layout.includes(w.id));
  const remove = (id) => { const n = layout.filter(x => x !== id); setLayout(n); saveDashboardLayout(userId, n); };
  const add = (id) => { const n = [...layout, id]; setLayout(n); saveDashboardLayout(userId, n); };
  const reset = () => { setLayout([...DEFAULT_LAYOUT]); saveDashboardLayout(userId, DEFAULT_LAYOUT); };
  const sizeLabel = (s) => s === "quarter" ? "\u00BC" : s === "half" ? "\u00BD" : "Full";
  const sizeColor = (s) => s === "quarter" ? "#4F7393" : s === "half" ? "#2F7A5F" : "#B67A18";
  const handleDragStart = (e, i) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); };
  const handleDragOver = (e, i) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverIdx(i); };
  const handleDrop = (e, dropI) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropI) { setDragIdx(null); setOverIdx(null); return; }
    const n = [...layout];
    const [moved] = n.splice(dragIdx, 1);
    n.splice(dropI, 0, moved);
    setLayout(n);
    saveDashboardLayout(userId, n);
    setDragIdx(null);
    setOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setOverIdx(null); };
  return (
    <div className="login-bg" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}>
      <div className="login-box" style={{ width: 480, maxWidth: "calc(100vw - 24px)", maxHeight: "80vh", overflow: "auto" }}>
        <div className="login-title" style={{ fontSize: 20, marginBottom: 4 }}>Customize Dashboard</div>
        <div className="login-sub" style={{ marginBottom: 20 }}>Drag to reorder, add or remove widgets</div>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--c-text2)", marginBottom: 8 }}>Your Dashboard</div>
        {layout.length === 0 && <div style={{ fontSize: 13, color: "#8A9096", padding: "8px 0" }}>No widgets added yet</div>}
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (dragIdx !== null) { setDragIdx(null); setOverIdx(null); } }}>
        {layout.map((id, i) => {
          const w = DASHBOARD_WIDGETS.find(x => x.id === id);
          if (!w) return null;
          const isDragging = dragIdx === i;
          const isOver = overIdx === i && dragIdx !== i;
          return (
            <div
              key={id}
              draggable="true"
              onDragStart={e => handleDragStart(e, i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={e => handleDrop(e, i)}
              onDragEnd={handleDragEnd}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 4px",
                borderBottom: "1px solid var(--c-border)",
                opacity: isDragging ? 0.4 : 1,
                borderTop: isOver ? "2px solid #b8860b" : "2px solid transparent",
                background: isDragging ? "var(--c-hover, #f5f5f5)" : "transparent",
                borderRadius: 4,
                transition: "border-top 0.15s ease, opacity 0.15s ease",
                cursor: "grab",
                userSelect: "none"
              }}
            >
              <span style={{ fontSize: 16, color: "var(--c-text2)", cursor: "grab", userSelect: "none", width: 20, textAlign: "center", letterSpacing: 1 }} title="Drag to reorder">⠿</span>
              <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{w.icon}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--c-text)" }}>{w.label}</span>
              <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: sizeColor(w.size), color: "#fff", fontWeight: 600 }}>{sizeLabel(w.size)}</span>
              <button onClick={() => remove(id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B24A4A", padding: "2px 4px" }} title="Remove">✕</button>
            </div>
          );
        })}
        </div>
        {available.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--c-text2)", marginTop: 20, marginBottom: 8 }}>Available Widgets</div>
            {available.map(w => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--c-border)" }}>
                <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>{w.icon}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "var(--c-text)" }}>{w.label}</span>
                <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: sizeColor(w.size), color: "#fff", fontWeight: 600 }}>{sizeLabel(w.size)}</span>
                <button onClick={() => add(w.id)} className="btn" style={{ fontSize: 11, padding: "3px 10px" }}>+ Add</button>
              </div>
            ))}
          </>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
          <button onClick={reset} className="btn" style={{ fontSize: 12 }}>Reset to Default</button>
          <button onClick={onClose} className="btn btn-gold" style={{ fontSize: 12 }}>Done</button>
        </div>
      </div>
    </div>
  );
}

function MyTimeWidget({ currentUser }) {
  const [period, setPeriod] = useState("Week");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const getRange = useCallback((p) => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const toStr = (dt) => dt.toISOString().split("T")[0];
    const endDate = toStr(now);
    let startDate;
    if (p === "Day") startDate = endDate;
    else if (p === "Week") { const s = new Date(y, m, d - now.getDay()); startDate = toStr(s); }
    else if (p === "Month") startDate = toStr(new Date(y, m, 1));
    else if (p === "Quarter") { const qm = m - (m % 3); startDate = toStr(new Date(y, qm, 1)); }
    else startDate = toStr(new Date(y, 0, 1));
    return { from: startDate, to: endDate };
  }, []);
  useEffect(() => {
    setLoading(true);
    const { from, to } = getRange(period);
    apiGetTimeEntries(currentUser.id, from, to)
      .then(data => setEntries(data))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [period, currentUser.id, getRange]);
  const totalHours = useMemo(() => entries.reduce((s, e) => s + (parseFloat(e.time) || 0), 0), [entries]);
  const byCase = useMemo(() => {
    const map = {};
    entries.forEach(e => {
      const key = e.caseTitle || "Unknown";
      map[key] = (map[key] || 0) + (parseFloat(e.time) || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [entries]);
  const periods = ["Day", "Week", "Month", "Quarter", "Year"];
  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="card-title">My Time</div>
        <div style={{ display: "flex", gap: 2 }}>
          {periods.map(p => (
            <button key={p} onClick={() => setPeriod(p)} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: period === p ? "var(--c-brand)" : "transparent", color: period === p ? "#fff" : "var(--c-text2)", cursor: "pointer", fontWeight: period === p ? 600 : 400 }}>{p}</button>
          ))}
        </div>
      </div>
      <div style={{ padding: "16px 20px" }}>
        {loading ? <div style={{ fontSize: 13, color: "#8A9096" }}>Loading...</div> : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, fontWeight: 700, color: "var(--c-text-h)" }}>{totalHours.toFixed(1)}</span>
              <span style={{ fontSize: 13, color: "#8A9096" }}>hours this {period.toLowerCase()}</span>
            </div>
            {byCase.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "#8A9096", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Top Cases</div>
                {byCase.map(([name, hrs]) => (
                  <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 12 }}>
                    <span style={{ color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>{name}</span>
                    <span style={{ fontWeight: 600, color: "var(--c-text-h)", flexShrink: 0 }}>{hrs.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            )}
            {byCase.length === 0 && <div style={{ fontSize: 12, color: "#8A9096" }}>No time entries this {period.toLowerCase()}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function RecentActivityWidget({ currentUser, allCases, onSelectCase }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiGetRecentActivity(currentUser.id, 10)
      .then(data => setActivities(data))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false));
  }, [currentUser.id]);
  const timeAgo = (ts) => {
    const diff = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };
  const tabForAction = (action) => {
    const a = (action || "").toLowerCase();
    if (a.includes("document") || a.includes("evidence")) return "files";
    if (a.includes("filing") || a.includes("motion")) return "filings";
    if (a.includes("correspondence")) return "correspondence";
    if (a.includes("note")) return "activity";
    return "overview";
  };
  const handleClick = (a) => {
    if (!onSelectCase || !allCases) return;
    const caseObj = allCases.find(c => c.id === a.caseId);
    if (caseObj) onSelectCase(caseObj, tabForAction(a.action));
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">My Recent Activity</div></div>
      {loading && <div className="empty">Loading...</div>}
      {!loading && activities.length === 0 && <div className="empty">No recent activity</div>}
      {!loading && activities.map(a => (
        <div key={a.id} className="deadline-item" style={{ padding: "8px 16px", cursor: "pointer" }} onClick={() => handleClick(a)}>
          <div className="dl-info" style={{ flex: 1, minWidth: 0 }}>
            <div className="dl-title" style={{ fontSize: 12 }}>{a.action}</div>
            <div className="dl-case">{a.caseTitle || `Case #${a.caseId}`}{a.detail ? ` — ${a.detail}` : ""}</div>
          </div>
          <div style={{ fontSize: 11, color: "#8A9096", flexShrink: 0 }}>{timeAgo(a.ts)}</div>
        </div>
      ))}
    </div>
  );
}

const PinnedSectionHeader = () => (
  <div style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, color: "#B67A18", textTransform: "uppercase", letterSpacing: "0.06em", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border2)", position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 4 }}>
    <span style={{ fontSize: 11 }}>📌</span> Pinned Cases
  </div>
);

const CaseDropdownItem = ({ c, onClick, showDetails }) => (
  <div
    onClick={onClick}
    style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid var(--c-border2)", fontSize: 12 }}
    onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg)"}
    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
  >
    <div style={{ fontWeight: 600, color: "var(--c-text)" }}>{c.defendantName || c.title}</div>
    <div style={{ fontSize: 11, color: "#8A9096" }}>{c.caseNum || "—"}{showDetails && c.trialDate ? ` · Trial: ${new Date(c.trialDate).toLocaleDateString()}` : ""}</div>
  </div>
);

const EMPTY_PINS = [];
function CaseSearchField({ allCases, value, onChange, placeholder, userId, pinnedCaseIds: pinnedIdsProp }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selectedCase = value ? allCases.find(c => c.id === parseInt(value)) : null;
  const pinnedIds = useMemo(() => pinnedIdsProp || EMPTY_PINS, [pinnedIdsProp]);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const { pinned, others } = useMemo(() => {
    const active = allCases.filter(c => c.status === "Active");
    const q = search.toLowerCase().trim();
    const matched = q ? active.filter(c =>
      (c.title || "").toLowerCase().includes(q) ||
      (c.caseNum || "").toLowerCase().includes(q) ||
      (c.defendantName || "").toLowerCase().includes(q)
    ) : active;
    const sortFn = (a, b) => {
      const aDate = a.trialDate ? new Date(a.trialDate) : null;
      const bDate = b.trialDate ? new Date(b.trialDate) : null;
      if (aDate && bDate) return aDate - bDate;
      if (aDate) return -1;
      if (bDate) return 1;
      return (a.title || "").localeCompare(b.title || "");
    };
    const pinnedSet = new Set(pinnedIds);
    const p = matched.filter(c => pinnedSet.has(c.id)).sort(sortFn);
    const o = matched.filter(c => !pinnedSet.has(c.id)).sort(sortFn).slice(0, 20);
    return { pinned: p, others: o };
  }, [allCases, search, pinnedIds]);

  const handleSelect = (c) => { onChange(String(c.id)); setSearch(""); setOpen(false); };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {selectedCase ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", fontSize: 12 }}>
          <span style={{ flex: 1, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedCase.title || selectedCase.caseNum}</span>
          <button onClick={() => { onChange(""); setSearch(""); }} style={{ background: "none", border: "none", color: "#8A9096", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
        </div>
      ) : (
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder || "Search cases…"}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", fontSize: 12, boxSizing: "border-box" }}
        />
      )}
      {open && !selectedCase && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, maxHeight: 260, overflowY: "auto", background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: 6, marginTop: 2, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
          {pinned.length === 0 && others.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "#8A9096" }}>No cases found</div>}
          {pinned.length > 0 && <PinnedSectionHeader />}
          {pinned.map(c => <CaseDropdownItem key={c.id} c={c} onClick={() => handleSelect(c)} showDetails />)}
          {pinned.length > 0 && others.length > 0 && (
            <div style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, color: "#5D6268", textTransform: "uppercase", letterSpacing: "0.06em", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border2)", position: "sticky", top: pinned.length > 0 ? 24 : 0, zIndex: 1 }}>All Cases</div>
          )}
          {others.map(c => <CaseDropdownItem key={c.id} c={c} onClick={() => handleSelect(c)} showDetails />)}
        </div>
      )}
    </div>
  );
}

function QuickNotesWidget({ currentUser, allCases, onSelectCase, pinnedCaseIds }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [body, setBody] = useState("");
  const [formCaseId, setFormCaseId] = useState("");
  const [formTime, setFormTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [editCaseId, setEditCaseId] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const recRef = useRef(null);
  const speechSupported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  useEffect(() => {
    apiGetQuickNotes().then(setNotes).catch(() => setNotes([])).finally(() => setLoading(false));
  }, []);

  const showSuccess = (msg) => { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 3000); };

  const toggleSpeech = () => {
    if (isListening && recRef.current) {
      recRef.current.stop();
      recRef.current = null;
      setIsListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) transcript += e.results[i][0].transcript;
      }
      if (transcript) {
        setBody(p => p + (p && !p.endsWith(" ") ? " " : "") + transcript);
      }
    };
    rec.onerror = () => { setIsListening(false); recRef.current = null; };
    rec.onend = () => { setIsListening(false); recRef.current = null; };
    rec.start();
    recRef.current = rec;
    setIsListening(true);
  };

  const handleAdd = async () => {
    if (!body.trim()) return;
    if (recRef.current) { recRef.current.stop(); recRef.current = null; setIsListening(false); }
    setSaving(true);
    try {
      const noteData = {
        body: body.trim(),
        type: formCaseId ? "General" : "Quick Note",
        authorId: currentUser.id,
        authorName: currentUser.name,
        authorRole: currentUser.role,
      };
      if (formCaseId) noteData.caseId = parseInt(formCaseId);
      if (formTime) noteData.timeLogged = formTime;
      const saved = await apiCreateNote(noteData);
      if (!formCaseId) {
        setNotes(prev => [saved, ...prev]);
      } else {
        const cs = allCases.find(c => c.id === parseInt(formCaseId));
        showSuccess(`Note saved to ${cs?.title || "case"}`);
      }
      setBody("");
      setFormCaseId("");
      setFormTime("");
      setShowForm(false);
    } catch (err) {
      alert("Failed to save note: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await apiDeleteNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (err) {
      alert("Failed to delete note: " + err.message);
    }
  };

  const startEdit = (note) => {
    setEditingId(note.id);
    setEditBody(note.body);
    setEditCaseId(note.caseId || "");
    setEditTime(note.timeLogged || "");
  };

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      const updates = { body: editBody };
      if (editCaseId) { updates.caseId = parseInt(editCaseId); updates.type = "General"; }
      if (editTime) updates.timeLogged = editTime;
      const updated = await apiUpdateNote(editingId, updates);
      if (editCaseId) {
        setNotes(prev => prev.filter(n => n.id !== editingId));
        const cs = allCases.find(c => c.id === parseInt(editCaseId));
        showSuccess(`Note moved to ${cs?.title || "case"}`);
      } else {
        setNotes(prev => prev.map(n => n.id === editingId ? updated : n));
      }
      setEditingId(null);
    } catch (err) {
      alert("Failed to update note: " + err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const fmtDate = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const caseFields = (caseIdVal, setCaseIdVal, timeVal, setTimeVal) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div>
        <label style={{ fontSize: 11, color: "#8A9096", display: "block", marginBottom: 2 }}>Assign to Case (optional)</label>
        <CaseSearchField allCases={allCases} value={caseIdVal} onChange={setCaseIdVal} placeholder="Search cases…" pinnedCaseIds={pinnedCaseIds} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "#8A9096", display: "block", marginBottom: 2 }}>Time Spent (hours)</label>
        <input
          type="number"
          step="0.1"
          min="0"
          value={timeVal}
          onChange={e => setTimeVal(e.target.value)}
          placeholder="0.0"
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", fontSize: 12, boxSizing: "border-box" }}
        />
      </div>
    </div>
  );

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="card-title">Quick Notes</div>
        <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={() => { setShowForm(!showForm); setEditingId(null); setFormCaseId(""); setFormTime(""); }}>
          {showForm ? "Cancel" : "+ Add Note"}
        </button>
      </div>
      {successMsg && (
        <div style={{ padding: "8px 20px", background: "rgba(47,122,95,0.1)", color: "#2F7A5F", fontSize: 12, fontWeight: 600, borderBottom: "1px solid var(--c-border2)" }}>
          {successMsg}
        </div>
      )}
      {showForm && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--c-border2)" }}>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={isListening ? "Speak now — your words will appear here…" : "Type your note…"}
            style={{ width: "100%", minHeight: 70, resize: "vertical", padding: 10, borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
          />
          <div style={{ marginTop: 8 }}>
            {caseFields(formCaseId, setFormCaseId, formTime, setFormTime)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            {speechSupported && (
              <button
                onClick={toggleSpeech}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 6, border: isListening ? "1px solid #e05252" : "1px solid var(--c-border)", background: isListening ? "rgba(224,82,82,0.08)" : "transparent", color: isListening ? "#e05252" : "var(--c-text2)", cursor: "pointer", fontSize: 12, animation: isListening ? "pulse-mic 1.5s ease-in-out infinite" : "none" }}
              >
                <span style={{ fontSize: 14 }}>{isListening ? "🔴" : "🎙️"}</span>
                {isListening ? "Listening…" : "Dictate"}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving || !body.trim()} style={{ fontSize: 12 }}>
              {saving ? "Saving…" : formCaseId ? "Save to Case" : "Save Note"}
            </button>
          </div>
        </div>
      )}
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {loading && <div style={{ padding: "16px 20px", fontSize: 13, color: "#8A9096" }}>Loading…</div>}
        {!loading && notes.length === 0 && !showForm && (
          <div style={{ padding: "24px 20px", textAlign: "center", color: "#8A9096", fontSize: 13 }}>
            No quick notes yet. Click "+ Add Note" to jot something down.
          </div>
        )}
        {notes.map(note => (
          <div key={note.id} style={{ padding: "10px 20px", borderBottom: "1px solid var(--c-border2)" }}>
            {editingId === note.id ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={editBody}
                  onChange={e => setEditBody(e.target.value)}
                  style={{ width: "100%", minHeight: 60, resize: "vertical", padding: 8, borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
                />
                {caseFields(editCaseId, setEditCaseId, editTime, setEditTime)}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditingId(null)} style={{ fontSize: 11 }}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={editSaving} style={{ fontSize: 11 }}>
                    {editSaving ? "Saving…" : editCaseId ? "Save & Move to Case" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: "var(--c-text)", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>
                  {note.body.length > 200 ? note.body.slice(0, 200) + "…" : note.body}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "#8A9096" }}>{fmtDate(note.createdAt)}</span>
                  {note.timeLogged && <span style={{ fontSize: 11, color: "var(--c-brand)", fontWeight: 600 }}>{note.timeLogged}h</span>}
                  <div style={{ flex: 1 }} />
                  <button onClick={() => startEdit(note)} style={{ background: "none", border: "none", color: "#8A9096", cursor: "pointer", fontSize: 11, padding: "2px 6px" }} title="Edit note">✎</button>
                  <button onClick={() => { if (window.confirm("Delete this note?")) handleDelete(note.id); }} style={{ background: "none", border: "none", color: "#8A9096", cursor: "pointer", fontSize: 11, padding: "2px 6px" }} title="Delete note">✕</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard({ currentUser, allCases, deadlines, tasks, onSelectCase, onAddRecord, onCompleteTask, onUpdateTask, onMenuToggle, pinnedCaseIds }) {
  const [showModal, setShowModal] = useState(false);
  const [showCustomize, setShowCustomize] = useState(false);
  const [expandedTask, setExpandedTask] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [triageResults, setTriageResults] = useState(null);
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState(null);
  const [layout, setLayout] = useState(() => getDashboardLayout(currentUser.id));
  const pinnedIds = pinnedCaseIds;
  useEffect(() => { setLayout(getDashboardLayout(currentUser.id)); }, [currentUser.id]);
  const activeCases = allCases.filter(c => c.status === "Active");
  const upcomingDl = deadlines.filter(d => { const n = daysUntil(d.date); return n !== null && n >= 0 && n <= 30; }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const trialSoon = allCases.filter(c => c.trialDate && daysUntil(c.trialDate) >= 0 && daysUntil(c.trialDate) <= 90).sort((a, b) => new Date(a.trialDate) - new Date(b.trialDate));
  const myTasks = tasks.filter(t => t.assigned === currentUser.id && t.status !== "Completed");
  const myCompleted = tasks.filter(t => t.assigned === currentUser.id && t.status === "Completed").sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  const overdueTasks = myTasks.filter(t => daysUntil(t.due) !== null && daysUntil(t.due) < 0);
  const pinnedCases = useMemo(() => pinnedIds.map(id => allCases.find(c => c.id === id)).filter(Boolean), [pinnedIds, allCases]);

  const renderWidget = (widgetId) => {
    switch (widgetId) {
      case "stat-active":
        return (
          <div className="stat-card" key={widgetId}>
            <div className="stat-label">Active Cases</div>
            <div className="stat-value">{activeCases.length}</div>
            <div className="stat-sub">{activeCases.length} active case{activeCases.length !== 1 ? "s" : ""}</div>
          </div>
        );
      case "stat-deadlines":
        return (
          <div className="stat-card" key={widgetId}>
            <div className="stat-label">Upcoming Deadlines</div>
            <div className="stat-value" style={{ color: upcomingDl.length > 5 ? "#e07a30" : "var(--c-text-h)" }}>{upcomingDl.length}</div>
            <div className="stat-sub">Next 30 days</div>
          </div>
        );
      case "stat-tasks":
        return (
          <div className="stat-card" key={widgetId}>
            <div className="stat-label">My Open Tasks</div>
            <div className="stat-value" style={{ color: myTasks.filter(t => daysUntil(t.due) < 0).length > 0 ? "#e05252" : "var(--c-text-h)" }}>{myTasks.length}</div>
            <div className="stat-sub">{myTasks.filter(t => daysUntil(t.due) < 0).length} overdue</div>
          </div>
        );
      case "stat-trials":
        return (
          <div className="stat-card" key={widgetId}>
            <div className="stat-label">Trials in 90 Days</div>
            <div className="stat-value" style={{ color: trialSoon.length > 0 ? "#1E2A3A" : "var(--c-text-h)" }}>{trialSoon.length}</div>
            <div className="stat-sub">{allCases.filter(c => c.trialDate).length} with trial dates</div>
          </div>
        );
      case "deadlines":
        return (
          <div className="card" key={widgetId}>
            <div className="card-header"><div className="card-title">Upcoming Deadlines</div><span style={{ fontSize: 12, color: "#8A9096" }}>30 days</span></div>
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
                    <div style={{ fontSize: 11, color: "#8A9096" }}>{fmt(d.date)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      case "trials":
        return (
          <div className="card" key={widgetId}>
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
                    <div style={{ fontSize: 11, color: "#8A9096" }}>{fmt(c.trialDate)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      case "tasks":
        return (myTasks.length > 0 || myCompleted.length > 0) ? (
          <div className="card" key={widgetId}>
            <div className="card-header"><div className="card-title">My Tasks</div><Badge label={`${myTasks.length} open`} /></div>
            {myTasks.length === 0 && <div className="empty" style={{ padding: "12px 16px", fontSize: 13, color: "#8A9096" }}>No open tasks</div>}
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
                      <div style={{ fontSize: 11, color: days < 0 ? "#e05252" : "#8A9096" }}>{fmt(t.due)}</div>
                      <button
                        onClick={() => setExpandedTask(isExpanded ? null : t.id)}
                        style={{ background: "none", border: "none", color: "#8A9096", cursor: "pointer", fontSize: 12, padding: "2px 4px" }}
                        title="Edit task"
                      >{isExpanded ? "▲" : "✎"}</button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="task-inline-edit" style={{ paddingLeft: 44, marginTop: 8 }}>
                      <label style={{ fontSize: 11, color: "#8A9096" }}>Due</label>
                      <input
                        type="date"
                        value={t.due || ""}
                        onChange={e => onUpdateTask(t.id, { due: e.target.value })}
                      />
                      <label style={{ fontSize: 11, color: "#8A9096" }}>Priority</label>
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
            {myCompleted.length > 0 && (
              <>
                <div
                  onClick={() => setShowCompleted(!showCompleted)}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", cursor: "pointer", borderTop: "1px solid var(--c-border)", background: showCompleted ? "var(--c-bg2)" : "transparent" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: "#8A9096" }}>{showCompleted ? "▼" : "▶"}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text2)" }}>Completed</span>
                    <Badge label={`${myCompleted.length}`} />
                  </div>
                </div>
                {showCompleted && myCompleted.slice(0, 20).map(t => {
                  const cs = allCases.find(c => c.id === t.caseId);
                  return (
                    <div key={t.id} className="deadline-item" style={{ padding: "8px 16px", opacity: 0.7 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                        <div style={{ width: 16, height: 16, borderRadius: 4, background: "#2F7A5F", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>
                        </div>
                        <div className="dl-info" style={{ flex: 1, minWidth: 0 }}>
                          <div className="dl-title" style={{ textDecoration: "line-through", color: "var(--c-text2)" }}>{t.title}</div>
                          <div className="dl-case">{cs?.title?.slice(0, 45) || `#${t.caseId}`}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#8A9096", flexShrink: 0 }}>{t.completedAt ? fmt(t.completedAt) : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        ) : null;
      case "pinned":
        return pinnedCases.length > 0 ? (
          <div className="card" key={widgetId}>
            <div className="card-header"><div className="card-title">Pinned Cases</div><Badge label={`${pinnedCases.length}`} /></div>
            {pinnedCases.map(c => (
              <div key={c.id} className="deadline-item" style={{ cursor: "pointer", padding: "10px 16px" }} onClick={() => onSelectCase(c)}>
                <span style={{ fontSize: 14, marginRight: 6 }}>📌</span>
                <div className="dl-info" style={{ flex: 1, minWidth: 0 }}>
                  <div className="dl-title" style={{ fontSize: 13 }}>{c.title}</div>
                  <div className="dl-case">{c.caseNum || "—"}{c.defendantName ? ` · ${c.defendantName}` : ""}</div>
                </div>
                <div style={{ fontSize: 11, color: "#8A9096", flexShrink: 0 }}>{c.status}</div>
              </div>
            ))}
          </div>
        ) : null;
      case "recent-activity":
        return <RecentActivityWidget key={widgetId} currentUser={currentUser} allCases={allCases} onSelectCase={onSelectCase} />;
      case "overdue":
        return (
          <div className="card" key={widgetId}>
            <div className="card-header"><div className="card-title">Overdue Tasks</div><Badge label={`${overdueTasks.length}`} /></div>
            {overdueTasks.length === 0 && <div className="empty">No overdue tasks</div>}
            {overdueTasks.sort((a, b) => daysUntil(a.due) - daysUntil(b.due)).slice(0, 8).map(t => {
              const days = daysUntil(t.due);
              const cs = allCases.find(c => c.id === t.caseId);
              return (
                <div key={t.id} className="deadline-item" style={{ padding: "8px 16px" }}>
                  <div className="checkbox" onClick={() => onCompleteTask(t.id)} title="Mark complete" />
                  <div className="dl-dot" style={{ background: "#e05252", flexShrink: 0 }} />
                  <div className="dl-info" style={{ flex: 1, minWidth: 0 }}>
                    <div className="dl-title">{t.title}</div>
                    <div className="dl-case">{cs?.title?.slice(0, 40) || `#${t.caseId}`}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "#e05252", fontWeight: 700, flexShrink: 0 }}>{Math.abs(days)}d overdue</div>
                </div>
              );
            })}
          </div>
        );
      case "my-time":
        return <MyTimeWidget key={widgetId} currentUser={currentUser} />;
      case "ai-triage":
        return (
          <div className="card" key={widgetId}>
            <div className="card-header">
              <div className="card-title">⚡ AI Case Triage</div>
              <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#b8860b", borderColor: "#d4c9a8" }} onClick={() => {
                setTriageLoading(true); setTriageError(null);
                apiCaseTriage().then(r => { setTriageResults(r.cases || []); setTriageLoading(false); }).catch(e => { setTriageError(e.message); setTriageLoading(false); });
              }}>{triageResults ? "↻ Refresh" : "⚡ Run Triage"}</button>
            </div>
            {triageLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 0", color: "#8A9096", fontSize: 12 }}>
                <div style={{ width: 16, height: 16, border: "2px solid #d4c9a8", borderTopColor: "#b8860b", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                AI is analyzing your caseload...
              </div>
            )}
            {triageError && <div style={{ color: "#dc2626", fontSize: 12, padding: "8px 0" }}>{triageError}</div>}
            {!triageLoading && !triageResults && !triageError && (
              <div style={{ fontSize: 12, color: "#8A9096", padding: "16px 0", textAlign: "center" }}>Click "Run Triage" to get AI-powered case prioritization</div>
            )}
            {triageResults && triageResults.map((t, i) => {
              const caseObj = allCases.find(cc => cc.id === t.id);
              return (
                <div key={t.id || i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: i < triageResults.length - 1 ? "1px solid var(--c-border2)" : "none", cursor: caseObj ? "pointer" : "default" }} onClick={() => caseObj && onSelectCase(caseObj)}>
                  <div style={{ minWidth: 28, height: 28, borderRadius: "50%", background: t.urgency >= 8 ? "#dc2626" : t.urgency >= 5 ? "#e07a30" : "#b8860b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{t.urgency}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--c-text)" }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>{t.reason}</div>
                    <div style={{ fontSize: 11, color: "#b8860b", marginTop: 2, fontWeight: 500 }}>→ {t.action}</div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      case "quick-notes":
        return <QuickNotesWidget key={widgetId} currentUser={currentUser} allCases={allCases} onSelectCase={onSelectCase} pinnedCaseIds={pinnedCaseIds} />;
      default:
        return null;
    }
  };

  const renderedGroups = useMemo(() => {
    const sized = layout.map(id => { const w = DASHBOARD_WIDGETS.find(x => x.id === id); return w ? { id, size: w.size } : null; }).filter(Boolean);
    const groups = [];
    sized.forEach(item => {
      const last = groups[groups.length - 1];
      if (last && last.size === item.size && item.size !== "full") {
        last.ids.push(item.id);
      } else {
        groups.push({ size: item.size, ids: [item.id] });
      }
    });
    return groups;
  }, [layout]);

  return (
    <>
      {showModal && <NewCaseModal onSave={onAddRecord} onClose={() => setShowModal(false)} />}
      {showCustomize && <CustomizeDashboardModal layout={layout} setLayout={setLayout} userId={currentUser.id} onClose={() => setShowCustomize(false)} />}
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div>
            <div className="topbar-title">Good morning, {currentUser.name.split(" ")[0]}</div>
            <div className="topbar-subtitle">{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setShowCustomize(true)} style={{ fontSize: 12 }}>⚙ Customize</button>
          <button className="btn btn-gold" onClick={() => setShowModal(true)}>+ New Case</button>
        </div>
      </div>
      <div className="content">
        {renderedGroups.map((group, gi) => {
          if (group.size === "quarter") {
            return (
              <div className="grid4" style={{ marginBottom: 20 }} key={`g${gi}`}>
                {group.ids.map(id => renderWidget(id))}
              </div>
            );
          }
          if (group.size === "half") {
            return (
              <div className="grid2" style={{ marginBottom: 20 }} key={`g${gi}`}>
                {group.ids.map(id => renderWidget(id))}
              </div>
            );
          }
          return (
            <div style={{ marginBottom: 20 }} key={`g${gi}`}>
              {group.ids.map(id => renderWidget(id))}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Cases View ───────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

function StaffSearchPicker({ staffSearchRef, attyFilter, setAttyFilter, staffInput, setStaffInput, staffFocused, setStaffFocused, staffDisplayValue, staffSuggestions }) {
  const inputRef = useRef(null);
  const [dropdownPos, setDropdownPos] = useState(null);
  const darkMode = document.querySelector(".app.dark") !== null;
  useEffect(() => {
    if (!staffFocused) { setDropdownPos(null); return; }
    const el = inputRef.current;
    if (!el) return;
    let raf;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const ddWidth = Math.max(rect.width, 240);
      let left = rect.left;
      if (left + ddWidth > vw - 8) left = Math.max(8, vw - ddWidth - 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow > 200 ? rect.bottom + 2 : rect.top - 262;
      setDropdownPos({ top: Math.max(4, top), left, width: ddWidth });
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [staffFocused]);
  const selectStaff = (id) => { setAttyFilter(id); setStaffInput(""); setStaffFocused(false); inputRef.current?.blur(); };
  const ddBg = darkMode ? "#1C2330" : "#fff";
  const ddBorder = darkMode ? "#27313D" : "#D6D8DB";
  const ddText = darkMode ? "#E6EDF3" : "#1F2428";
  const ddHover = darkMode ? "#27313D" : "#F0F2F4";
  return (
    <div ref={staffSearchRef} style={{ position: "relative", width: 160 }}>
      <input
        ref={inputRef}
        style={{ width: "100%", paddingRight: attyFilter !== "All" ? 28 : 8 }}
        placeholder="Search staff..."
        value={staffDisplayValue}
        onChange={e => setStaffInput(e.target.value)}
        onFocus={() => { setStaffInput(""); setStaffFocused(true); }}
        onBlur={() => setTimeout(() => { setStaffFocused(false); setStaffInput(""); }, 200)}
        autoComplete="off"
      />
      {attyFilter !== "All" && !staffFocused && (
        <button
          onMouseDown={e => { e.preventDefault(); setAttyFilter("All"); setStaffInput(""); }}
          style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--c-text2)", padding: "2px 4px", lineHeight: 1 }}
          title="Clear filter"
        >✕</button>
      )}
      {staffFocused && dropdownPos && createPortal(
        <div style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, maxHeight: 260, overflowY: "auto", background: ddBg, border: `1px solid ${ddBorder}`, borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,0.35)", zIndex: 99999, fontSize: 13 }}>
          <div
            style={{ padding: "8px 12px", cursor: "pointer", color: "#8A9096", borderBottom: `1px solid ${ddBorder}` }}
            onMouseDown={e => { e.preventDefault(); selectStaff("All"); }}
          >All Staff</div>
          {staffSuggestions.length > 0 ? staffSuggestions.map(u => {
            const isSelected = String(u.id) === attyFilter;
            const q = staffInput.toLowerCase();
            const name = u.name;
            let nameEl;
            if (q && name.toLowerCase().includes(q)) {
              const idx = name.toLowerCase().indexOf(q);
              nameEl = <>{name.slice(0, idx)}<strong>{name.slice(idx, idx + q.length)}</strong>{name.slice(idx + q.length)}</>;
            } else {
              nameEl = name;
            }
            return (
              <div
                key={u.id}
                style={{ padding: "8px 12px", cursor: "pointer", color: ddText, background: isSelected ? ddHover : "transparent" }}
                onMouseDown={e => { e.preventDefault(); selectStaff(String(u.id)); }}
                onMouseEnter={e => e.currentTarget.style.background = ddHover}
                onMouseLeave={e => e.currentTarget.style.background = isSelected ? ddHover : "transparent"}
              >{nameEl}</div>
            );
          }) : (
            <div style={{ padding: "8px 12px", color: "#8A9096" }}>No matches</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function BatchStaffPicker({ staffList, value, onChange, inputValue, onInputChange, focused, onFocusChange, inputRef, placeholder }) {
  const localRef = useRef(null);
  const ref = inputRef || localRef;
  const [dropdownPos, setDropdownPos] = useState(null);
  const darkMode = document.querySelector(".app.dark") !== null;
  useEffect(() => {
    if (!focused) { setDropdownPos(null); return; }
    const el = ref.current;
    if (!el) return;
    let raf;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const ddWidth = Math.max(rect.width, 280);
      let left = rect.left;
      if (left + ddWidth > vw - 8) left = Math.max(8, vw - ddWidth - 8);
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow > 220 ? rect.bottom + 2 : rect.top - 282;
      setDropdownPos({ top: Math.max(4, top), left, width: ddWidth });
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [focused, ref]);
  const selectedUser = staffList.find(u => String(u.id) === String(value));
  const displayValue = focused ? inputValue : (selectedUser ? `${selectedUser.name} — ${(selectedUser.roles || [selectedUser.role]).join(", ")}` : "");
  const q = (inputValue || "").toLowerCase();
  const filtered = q ? staffList.filter(u => u.name.toLowerCase().includes(q) || (u.roles || [u.role]).some(r => r.toLowerCase().includes(q))) : staffList;
  const ddBg = darkMode ? "#1C2330" : "#fff";
  const ddBorder = darkMode ? "#27313D" : "#D6D8DB";
  const ddText = darkMode ? "#E6EDF3" : "#1F2428";
  const ddHover = darkMode ? "#27313D" : "#F0F2F4";
  return (
    <div style={{ position: "relative" }}>
      <input
        ref={ref}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: `1px solid ${ddBorder}`, background: darkMode ? "#161B22" : "#fff", color: ddText, fontSize: 13, paddingRight: value ? 28 : 10 }}
        placeholder={placeholder || "Search staff..."}
        value={displayValue}
        onChange={e => onInputChange(e.target.value)}
        onFocus={() => { onInputChange(""); onFocusChange(true); }}
        onBlur={() => setTimeout(() => { onFocusChange(false); onInputChange(""); }, 200)}
        autoComplete="off"
      />
      {value && !focused && (
        <button
          onMouseDown={e => { e.preventDefault(); onChange(""); onInputChange(""); }}
          style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--c-text2)", padding: "2px 4px", lineHeight: 1 }}
          title="Clear"
        >✕</button>
      )}
      {focused && dropdownPos && createPortal(
        <div style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, maxHeight: 280, overflowY: "auto", background: ddBg, border: `1px solid ${ddBorder}`, borderRadius: 6, boxShadow: "0 6px 24px rgba(0,0,0,0.35)", zIndex: 99999, fontSize: 13 }}>
          {filtered.length > 0 ? filtered.map(u => {
            const isSelected = String(u.id) === String(value);
            const name = u.name;
            const roles = (u.roles || [u.role]).join(", ");
            let nameEl;
            if (q && name.toLowerCase().includes(q)) {
              const idx = name.toLowerCase().indexOf(q);
              nameEl = <>{name.slice(0, idx)}<strong>{name.slice(idx, idx + q.length)}</strong>{name.slice(idx + q.length)}</>;
            } else {
              nameEl = name;
            }
            return (
              <div
                key={u.id}
                style={{ padding: "8px 12px", cursor: "pointer", color: ddText, background: isSelected ? ddHover : "transparent" }}
                onMouseDown={e => { e.preventDefault(); onChange(String(u.id)); }}
                onMouseEnter={e => e.currentTarget.style.background = ddHover}
                onMouseLeave={e => e.currentTarget.style.background = isSelected ? ddHover : "transparent"}
              >{nameEl} <span style={{ color: "#8A9096", fontSize: 11 }}>— {roles}</span></div>
            );
          }) : (
            <div style={{ padding: "8px 12px", color: "#8A9096" }}>No matches</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function CasesView({ currentUser, allCases, tasks, selectedCase, setSelectedCase: rawSetSelectedCase, pendingTab, clearPendingTab, onAddRecord, onUpdateCase, onCompleteTask, onAddTask, deadlines, caseNotes, setCaseNotes, caseLinks, setCaseLinks, caseActivity, setCaseActivity, deletedCases, setDeletedCases, onDeleteCase, onRestoreCase, onAddDeadline, onUpdateDeadline, onMenuToggle, pinnedCaseIds: pinnedIds, onTogglePinnedCase: togglePin }) {
  const setSelectedCase = useCallback((c) => { if (clearPendingTab) clearPendingTab(); rawSetSelectedCase(c); }, [clearPendingTab, rawSetSelectedCase]);
  const [statusFilter, setStatusFilter] = useState("Active");
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [attyFilter, setAttyFilter] = useState(String(currentUser.id));
  const [staffInput, setStaffInput] = useState("");
  const [staffFocused, setStaffFocused] = useState(false);
  const staffSearchRef = useRef(null);
  const [divisionFilter, setDivisionFilter] = useState("All");
  const [stageFilter, setStageFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [sortCol, setSortCol] = useState("arrestDate");
  const [sortDir, setSortDir] = useState("desc");
  const [aiQuery, setAiQuery] = useState("");
  const [aiResults, setAiResults] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [triageResults, setTriageResults] = useState(null);
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageShow, setTriageShow] = useState(false);
  const [aiError, setAiError] = useState("");
  const [pinnedExpanded, setPinnedExpanded] = useState(true);

  const pinnedCases = useMemo(() => pinnedIds.map(id => allCases.find(c => c.id === id)).filter(Boolean), [pinnedIds, allCases]);

  const runAiSearch = async () => {
    if (!aiQuery.trim()) return;
    setAiLoading(true);
    setAiError("");
    setAiResults(null);
    try {
      const data = await apiAiSearch(aiQuery.trim());
      setAiResults(data.results || []);
    } catch (err) {
      setAiError(err.message || "AI search failed");
    } finally {
      setAiLoading(false);
    }
  };

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

  // Load deleted cases from API when Deleted tab is first opened
  useEffect(() => {
    if (statusFilter !== "Deleted" || deletedCases !== null) return;
    setDeletedLoading(true);
    apiGetDeletedCases()
      .then(rows => setDeletedCases(rows))
      .catch(err => console.error("Failed to load deleted cases:", err))
      .finally(() => setDeletedLoading(false));
  }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteFromOverlay = async (id) => {
    try {
      const deleted = await apiDeleteCase(id);
      setDeletedCases(p => p !== null ? [deleted, ...p] : [deleted]);
      onDeleteCase(id);
    } catch (err) {
      alert("Failed to delete: " + err.message);
    }
  };

  const handleRestoreDeleted = async (id) => {
    try {
      const restored = await apiRestoreCase(id);
      onRestoreCase(restored);
    } catch (err) {
      alert("Failed to restore: " + err.message);
    }
  };

  const handleSort = (col) => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } };

  const filtered = useMemo(() => {
    let list = allCases.filter(c => {
      if (statusFilter !== "All" && statusFilter !== "Deleted" && c.status !== statusFilter) return false;
      if (attyFilter !== "All") { const fid = Number(attyFilter); if (![c.assignedAttorney, c.secondAttorney, c.trialCoordinator, c.investigator, c.socialWorker].includes(fid)) return false; }
      if (divisionFilter !== "All" && c.courtDivision !== divisionFilter) return false;
      if (stageFilter !== "All" && c.stage !== stageFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return c.title?.toLowerCase().includes(q) || (c.caseNum || "").toLowerCase().includes(q) || (c.defendantName || "").toLowerCase().includes(q) || (c.prosecutor || "").toLowerCase().includes(q) || (c.county || "").toLowerCase().includes(q) || (c.court || "").toLowerCase().includes(q) || (c.chargeDescription || "").toLowerCase().includes(q);
      }
      return true;
    });
    list.sort((a, b) => {
      let av = "", bv = "";
      if (sortCol === "title") { av = a.defendantName || a.title || ""; bv = b.defendantName || b.title || ""; }
      else if (sortCol === "caseNum") { av = a.caseNum || ""; bv = b.caseNum || ""; }
      else if (sortCol === "defendant") { av = a.defendantName || ""; bv = b.defendantName || ""; }
      else if (sortCol === "stage") {
        const STAGE_ORDER = { "Arraignment": 0, "Preliminary Hearing": 1, "Grand Jury/Indictment": 2, "Pre-Trial Motions": 3, "Plea Negotiations": 4, "Trial": 5, "Sentencing": 6, "Post-Conviction": 7, "Appeal": 8 };
        const ai = STAGE_ORDER[a.stage] ?? 99, bi = STAGE_ORDER[b.stage] ?? 99;
        return (sortDir === "asc" ? 1 : -1) * (ai - bi);
      }
      else if (sortCol === "trialDate") { av = a.trialDate || "9999"; bv = b.trialDate || "9999"; }
      else if (sortCol === "arrestDate") { av = a.arrestDate || "9999"; bv = b.arrestDate || "9999"; }
      else if (sortCol === "lead") { av = getUserById(a.assignedAttorney)?.name || ""; bv = getUserById(b.assignedAttorney)?.name || ""; }
      return (sortDir === "asc" ? 1 : -1) * av.localeCompare(bv);
    });
    return list;
  }, [allCases, statusFilter, attyFilter, divisionFilter, stageFilter, search, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => setPage(1), [search, statusFilter, attyFilter, divisionFilter, stageFilter, sortCol]);

  const caseTasks = useMemo(() => selectedCase ? tasks.filter(t => t.caseId === selectedCase.id) : [], [tasks, selectedCase]);
  const caseDeadlines = useMemo(() => selectedCase ? deadlines.filter(d => d.caseId === selectedCase.id) : [], [deadlines, selectedCase]);
  const notes = selectedCase ? (caseNotes[selectedCase.id] || []) : [];
  const [showPrint, setShowPrint] = useState(false);

  const allStaff = useMemo(() => {
    const fields = ["assignedAttorney", "secondAttorney", "trialCoordinator", "investigator", "socialWorker"];
    const assignedIds = new Set();
    allCases.forEach(c => fields.forEach(f => { if (c[f] > 0) assignedIds.add(c[f]); }));
    assignedIds.add(currentUser.id);
    return USERS.filter(u => assignedIds.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [allCases, currentUser.id]);
  const selectedStaffName = useMemo(() => {
    if (attyFilter === "All") return "";
    const u = USERS.find(u => u.id === Number(attyFilter));
    return u ? u.name : "";
  }, [attyFilter]);
  const staffDisplayValue = staffFocused ? staffInput : selectedStaffName;
  const staffSuggestions = useMemo(() => {
    if (!staffInput.trim()) return allStaff;
    const q = staffInput.toLowerCase();
    return allStaff.filter(u => u.name.toLowerCase().includes(q));
  }, [allStaff, staffInput]);

  return (
    <>
      {showModal && <NewCaseModal onSave={onAddRecord} onClose={() => setShowModal(false)} />}
      {showPrint && selectedCase && (
        <CasePrintView c={selectedCase} notes={notes} tasks={caseTasks} deadlines={caseDeadlines} links={caseLinks[selectedCase.id] || []} onClose={() => setShowPrint(false)} />
      )}
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div>
            <div className="topbar-title">Cases</div>
            <div className="topbar-subtitle">{filtered.length} of {allCases.length} · {allCases.filter(c => c.status === "Active").length} active</div>
          </div>
        </div>
        <div className="topbar-actions">
          <select style={{ width: 160 }} value={divisionFilter} onChange={e => setDivisionFilter(e.target.value)}>
            <option value="All">All Divisions</option>
            <option value="Circuit">Circuit Court</option>
            <option value="District">District Court</option>
            <option value="Juvenile">Juvenile Court</option>
          </select>
          <select style={{ width: 160 }} value={stageFilter} onChange={e => setStageFilter(e.target.value)}>
            <option value="All">All Stages</option>
            {["Arraignment", "Preliminary Hearing", "Grand Jury/Indictment", "Pre-Trial Motions", "Plea Negotiations", "Trial", "Sentencing", "Post-Conviction", "Appeal"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <StaffSearchPicker
            staffSearchRef={staffSearchRef}
            attyFilter={attyFilter}
            setAttyFilter={setAttyFilter}
            staffInput={staffInput}
            setStaffInput={setStaffInput}
            staffFocused={staffFocused}
            setStaffFocused={setStaffFocused}
            staffDisplayValue={staffDisplayValue}
            staffSuggestions={staffSuggestions}
          />
          <input style={{ width: 200 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
          <button className="btn btn-outline btn-sm" style={{ color: "#b8860b", borderColor: "#d4c9a8", fontSize: 12 }} onClick={() => {
            setTriageShow(true); setTriageLoading(true);
            apiCaseTriage().then(r => { setTriageResults(r.cases || []); setTriageLoading(false); }).catch(() => setTriageLoading(false));
          }}>⚡ Triage</button>
          <button className="btn btn-gold" onClick={() => setShowModal(true)}>+ New Case</button>
        </div>
      </div>
      <div className="content">
        {triageShow && (
          <div style={{ marginBottom: 16 }}>
            <AiPanel title="AI Case Triage" loading={triageLoading} onClose={() => { setTriageShow(false); setTriageResults(null); }}
              onRun={() => { setTriageLoading(true); apiCaseTriage().then(r => { setTriageResults(r.cases || []); setTriageLoading(false); }).catch(() => setTriageLoading(false)); }}
            >
              {triageResults && triageResults.map((t, i) => {
                const caseObj = allCases.find(cc => cc.id === t.id);
                return (
                  <div key={t.id || i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: i < triageResults.length - 1 ? "1px solid #e8e0d0" : "none", cursor: caseObj ? "pointer" : "default" }} onClick={() => caseObj && setSelectedCase(caseObj)}>
                    <div style={{ minWidth: 26, height: 26, borderRadius: "50%", background: t.urgency >= 8 ? "#dc2626" : t.urgency >= 5 ? "#e07a30" : "#b8860b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{t.urgency}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: "#1E2A3A" }}>{t.title}</div>
                      <div style={{ fontSize: 11, color: "#8A9096", marginTop: 1 }}>{t.reason}</div>
                      <div style={{ fontSize: 11, color: "#b8860b", marginTop: 1, fontWeight: 500 }}>→ {t.action}</div>
                    </div>
                  </div>
                );
              })}
            </AiPanel>
          </div>
        )}
        <div style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <input
              style={{ width: "100%", paddingLeft: 36, paddingRight: 10, height: 40, borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, background: "#fff" }}
              placeholder="AI Search — ask anything about your cases (e.g. &quot;cases with trial in March&quot; or &quot;slip and fall in Mobile&quot;)…"
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") runAiSearch(); }}
            />
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: "#8A9096", pointerEvents: "none" }}>&#x2728;</span>
          </div>
          <button className="btn btn-gold" style={{ height: 40, whiteSpace: "nowrap", minWidth: 100 }} onClick={runAiSearch} disabled={aiLoading || !aiQuery.trim()}>
            {aiLoading ? "Searching…" : "AI Search"}
          </button>
          {aiResults !== null && (
            <button className="btn btn-outline" style={{ height: 40 }} onClick={() => { setAiResults(null); setAiQuery(""); setAiError(""); }}>Clear</button>
          )}
        </div>

        {aiLoading && (
          <div className="card" style={{ marginBottom: 16, padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "#8A9096" }}>Searching across all case data — this may take a few seconds…</div>
          </div>
        )}

        {aiError && (
          <div className="card" style={{ marginBottom: 16, padding: 16, borderLeft: "4px solid #e05252" }}>
            <div style={{ color: "#e05252", fontSize: 13 }}>{aiError}</div>
          </div>
        )}

        {aiResults !== null && !aiLoading && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>&#x2728;</span> AI Search Results
                <span style={{ fontSize: 12, fontWeight: 400, color: "#8A9096" }}>({aiResults.length} match{aiResults.length !== 1 ? "es" : ""})</span>
              </div>
            </div>
            {aiResults.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "#8A9096", fontSize: 13 }}>No matching cases found. Try rephrasing your search.</div>
            ) : (
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {aiResults.map((r, i) => {
                  const c = allCases.find(cc => cc.id === r.id);
                  if (!c) return null;
                  return (
                    <div
                      key={r.id}
                      style={{ padding: "14px 18px", borderBottom: i < aiResults.length - 1 ? "1px solid #e2e8f0" : "none", cursor: "pointer", display: "flex", gap: 14, alignItems: "flex-start" }}
                      onClick={() => setSelectedCase(c)}
                      onMouseEnter={e => e.currentTarget.style.background = "#EEF1F4"}
                      onMouseLeave={e => e.currentTarget.style.background = ""}
                    >
                      <div style={{ minWidth: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #b8860b, #d4a843)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, fontSize: 14, color: "#1F2428" }}>{c.title}</span>
                          {c.deathPenalty && <span style={{ fontSize: 9, fontWeight: 700, background: "#991b1b", color: "#fff", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>DP</span>}
                          {c.caseNum && <span style={{ fontFamily: "monospace", fontSize: 11, color: "#1E2A3A" }}>{c.caseNum}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "#8A9096", marginTop: 4, lineHeight: 1.5 }}>{r.reason}</div>
                        <div style={{ fontSize: 11, color: "#8A9096", marginTop: 4, display: "flex", gap: 12 }}>
                          {c.defendantName && <span>Defendant: {c.defendantName}</span>}
                          {c.stage && <span>Stage: {c.stage}</span>}
                          {c.courtDivision && <span>Division: {c.courtDivision}</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#b8860b", fontWeight: 500, flexShrink: 0 }}>View →</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {pinnedCases.length > 0 && (
          <div className="card pinned-card-mobile" style={{ marginBottom: 16 }}>
            <div
              onClick={() => setPinnedExpanded(!pinnedExpanded)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", cursor: "pointer", borderBottom: pinnedExpanded ? "1px solid var(--c-border)" : "none" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "#8A9096" }}>{pinnedExpanded ? "▼" : "▶"}</span>
                <span style={{ fontSize: 14, color: "#B67A18" }}>📌</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)" }}>Pinned Cases</span>
                <Badge label={`${pinnedCases.length}`} />
              </div>
            </div>
            {pinnedExpanded && (
              <div className="table-wrap">
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}></th>
                      <th>Case Number</th>
                      <th>Style</th>
                      <th className="hide-mobile">Case Type</th>
                      <th className="hide-mobile">Defendant</th>
                      <th>Stage</th>
                      <th>Trial Date</th>
                      <th className="hide-mobile">Arrest Date</th>
                      <th className="hide-mobile">Lead</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pinnedCases.map(c => (
                      <tr key={c.id} className={`clickable-row ${selectedCase?.id === c.id ? "selected-row" : ""}`} onClick={() => setSelectedCase(selectedCase?.id === c.id ? null : c)}>
                        <td data-label="" style={{ textAlign: "center", padding: "6px 4px" }}>
                          <button onClick={e => { e.stopPropagation(); togglePin(c.id); }} title="Unpin" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#B67A18", padding: 0, lineHeight: 1 }}>📌</button>
                        </td>
                        <td data-label="Case #" style={{ whiteSpace: "nowrap" }}>
                          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#1E2A3A" }}>{c.caseNum || "—"}</div>
                        </td>
                        <td data-label="Style">
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ color: "var(--c-text)", fontWeight: 600, fontSize: 13 }}>{c.title}</span>
                            {c.deathPenalty && <span style={{ fontSize: 9, fontWeight: 700, background: "#991b1b", color: "#fff", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>DP</span>}
                          </div>
                          {c.prosecutor && <div style={{ fontSize: 12, color: "#1F2428", fontWeight: 500, marginTop: 1 }}>{c.prosecutor}</div>}
                        </td>
                        <td className="hide-mobile" data-label="Type" style={{ fontSize: 11, color: "var(--c-text2)" }}>{c.caseType || "—"}</td>
                        <td className="hide-mobile" data-label="Defendant" style={{ fontSize: 12, color: "var(--c-text2)" }}>{c.defendantName || "—"}</td>
                        <td data-label="Stage"><Badge label={c.stage} /></td>
                        <td data-label="Trial" style={{ color: c.trialDate ? urgencyColor(daysUntil(c.trialDate)) : "#8A9096", fontSize: 12, whiteSpace: "nowrap" }}>{fmt(c.trialDate)}</td>
                        <td className="hide-mobile" data-label="Arrest" style={{ fontSize: 12, color: "#8A9096", whiteSpace: "nowrap" }}>{fmt(c.arrestDate)}</td>
                        <td className="hide-mobile" data-label="Lead"><Avatar userId={c.assignedAttorney} size={26} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <div className="tabs">
          {["All", "Active", "Monitoring", "Closed"].map(s => <div key={s} className={`tab ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>{s}</div>)}
          <div className={`tab ${statusFilter === "Deleted" ? "active" : ""}`} style={{ color: statusFilter === "Deleted" ? "#e05252" : undefined }} onClick={() => setStatusFilter("Deleted")}>Deleted</div>
        </div>
        <div className="card">
          {statusFilter === "Deleted" ? (
            <div className="table-wrap">
              {deletedLoading ? (
                <div className="empty">Loading deleted records…</div>
              ) : (
                <>
                  <table className="mobile-cards">
                    <thead>
                      <tr>
                        <th>Case Number</th>
                        <th>Style</th>
                        <th>Case Type</th>
                        <th>Deleted On</th>
                        <th>Expires In</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(deletedCases || []).map(c => {
                        const deletedDate = new Date(c.deletedAt);
                        const expiresDate = new Date(deletedDate.getTime() + 30 * 24 * 60 * 60 * 1000);
                        const daysLeft = Math.ceil((expiresDate - new Date()) / (1000 * 60 * 60 * 24));
                        return (
                          <tr key={c.id}>
                            <td data-label="Case #" style={{ fontFamily: "monospace", fontSize: 11, color: "#1E2A3A", whiteSpace: "nowrap" }}>{c.caseNum || "—"}</td>
                            <td data-label="Style"><div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}><span style={{ color: "var(--c-text)", fontWeight: 600, fontSize: 13 }}>{c.title}</span>{c.deathPenalty && <span style={{ fontSize: 9, fontWeight: 700, background: "#991b1b", color: "#fff", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>DP</span>}</div>{c.defendantName && <div style={{ fontSize: 11, color: "#8A9096" }}>Def: {c.defendantName}</div>}</td>
                            <td data-label="Type" style={{ fontSize: 11, color: "var(--c-text2)" }}>{c.caseType || "—"}</td>
                            <td data-label="Deleted" style={{ fontSize: 12, color: "#e05252" }}>{deletedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                            <td data-label="Expires" style={{ fontSize: 12, color: daysLeft <= 7 ? "#e05252" : "#8A9096" }}>{daysLeft} day{daysLeft !== 1 ? "s" : ""}</td>
                            <td data-label=""><button className="btn btn-outline btn-sm" onClick={() => handleRestoreDeleted(c.id)}>Restore</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {(deletedCases || []).length === 0 && <div className="empty">No deleted records in the last 30 days.</div>}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}></th>
                      <SortTh col="caseNum" label="Case Number" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh col="title" label="Style" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <th className="hide-mobile">Case Type</th>
                      <SortTh col="defendant" label="Defendant" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="hide-mobile" />
                      <SortTh col="stage" label="Stage" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh col="trialDate" label="Trial Date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                      <SortTh col="arrestDate" label="Arrest Date" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="hide-mobile" />
                      <SortTh col="lead" label="Lead" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="hide-mobile" />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(c => (
                      <tr key={c.id} className={`clickable-row ${selectedCase?.id === c.id ? "selected-row" : ""}`} onClick={() => setSelectedCase(selectedCase?.id === c.id ? null : c)}>
                        <td data-label="" style={{ textAlign: "center", padding: "6px 4px" }}>
                          <button onClick={e => { e.stopPropagation(); togglePin(c.id); }} title={pinnedIds.includes(c.id) ? "Unpin" : "Pin"} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: pinnedIds.includes(c.id) ? "#B67A18" : "#D6D8DB", padding: 0, lineHeight: 1, opacity: pinnedIds.includes(c.id) ? 1 : 0.5, transition: "opacity 0.15s" }} onMouseEnter={e => e.currentTarget.style.opacity = "1"} onMouseLeave={e => { if (!pinnedIds.includes(c.id)) e.currentTarget.style.opacity = "0.5"; }}>📌</button>
                        </td>
                        <td data-label="Case #" style={{ whiteSpace: "nowrap" }}>
                          <div style={{ fontFamily: "monospace", fontSize: 11, color: "#1E2A3A" }}>{c.caseNum || "—"}</div>
                        </td>
                        <td data-label="Style">
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ color: "var(--c-text)", fontWeight: 600, fontSize: 13 }}>{c.title}</span>
                            {c.deathPenalty && <span style={{ fontSize: 9, fontWeight: 700, background: "#991b1b", color: "#fff", padding: "1px 5px", borderRadius: 3, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>DP</span>}
                          </div>
                          {c.prosecutor && <div style={{ fontSize: 12, color: "#1F2428", fontWeight: 500, marginTop: 1 }}>{c.prosecutor}</div>}
                        </td>
                        <td className="hide-mobile" data-label="Type" style={{ fontSize: 11, color: "var(--c-text2)" }}>{c.caseType || "—"}</td>
                        <td className="hide-mobile" data-label="Defendant" style={{ fontSize: 12, color: "var(--c-text2)" }}>{c.defendantName || "—"}</td>
                        <td data-label="Stage"><Badge label={c.stage} /></td>
                        <td data-label="Trial" style={{ color: c.trialDate ? urgencyColor(daysUntil(c.trialDate)) : "#8A9096", fontSize: 12, whiteSpace: "nowrap" }}>{fmt(c.trialDate)}</td>
                        <td className="hide-mobile" data-label="Arrest" style={{ fontSize: 12, color: "#8A9096", whiteSpace: "nowrap" }}>{fmt(c.arrestDate)}</td>
                        <td className="hide-mobile" data-label="Lead"><Avatar userId={c.assignedAttorney} size={26} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {paged.length === 0 && <div className="empty">No cases match your filters.</div>}
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
            </>
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
          onClose={() => { setSelectedCase(null); if (clearPendingTab) clearPendingTab(); }}
          onUpdate={onUpdateCase}
          onDeleteCase={handleDeleteFromOverlay}
          initialTab={pendingTab || undefined}
          onCompleteTask={onCompleteTask}
          onAddTask={onAddTask}
          onAddNote={async (note) => { try { const saved = await apiCreateNote(note); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: [saved, ...(prev[selectedCase.id] || [])] })); } catch (err) { alert("Failed to save note: " + err.message); } }}
          onDeleteNote={async (noteId) => { try { await apiDeleteNote(noteId); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).filter(n => n.id !== noteId) })); } catch (err) { alert("Failed to delete note: " + err.message); } }}
          onUpdateNote={async (noteId, data) => { try { const updated = await apiUpdateNote(noteId, data); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).map(n => n.id === noteId ? updated : n) })); } catch (err) { alert("Failed to update note: " + err.message); throw err; } }}
          onAddLink={async (link) => { try { const saved = await apiCreateLink(link); setCaseLinks(prev => ({ ...prev, [selectedCase.id]: [...(prev[selectedCase.id] || []), saved] })); } catch (err) { alert("Failed to save link: " + err.message); } }}
          onDeleteLink={async (linkId) => { try { await apiDeleteLink(linkId); setCaseLinks(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).filter(l => l.id !== linkId) })); } catch (err) { alert("Failed to delete link: " + err.message); } }}
          onLogActivity={async (entry) => { try { const saved = await apiCreateActivity(entry); setCaseActivity(prev => ({ ...prev, [selectedCase.id]: [saved, ...(prev[selectedCase.id] || [])] })); } catch (err) { console.error("Failed to log activity:", err); } }}
          onRefreshActivity={(caseId, fresh) => setCaseActivity(prev => ({ ...prev, [caseId]: fresh }))}
          onAddDeadline={onAddDeadline}
          onUpdateDeadline={onUpdateDeadline}
        />
      )}
    </>
  );
}

// ─── Case Detail Overlay ──────────────────────────────────────────────────────
// Field definitions: key = JS property name, label = display name, type = input type
const CORE_FIELDS = [
  // Details section
  { key: "title",            label: "Case Title",           type: "text",   section: "details" },
  { key: "caseNum",          label: "Case Number",          type: "text",   section: "details" },
  { key: "defendantName",    label: "Defendant",            type: "text",   section: "details" },
  { key: "prosecutor",       label: "Prosecutor",           type: "text",   section: "details" },
  { key: "chargeDescription",label: "Charge Description",   type: "text",   section: "details" },
  { key: "chargeStatute",    label: "Statute",              type: "text",   section: "details" },
  { key: "chargeClass",      label: "Charge Class",         type: "select", section: "details", options: ["Class A Felony", "Class B Felony", "Class C Felony", "Misdemeanor A", "Misdemeanor B", "Misdemeanor C", "Violation", "Other"] },
  { key: "caseType",         label: "Case Type",            type: "select", section: "details", options: ["Felony", "Misdemeanor", "Juvenile", "Probation Violation", "Mental Health/Commitment", "Appeal", "Other"] },
  { key: "judge",            label: "Judge",                type: "text",   section: "details" },
  { key: "status",           label: "Status",               type: "select", section: "details", options: ["Active", "Closed", "Pending", "Disposed", "Transferred"] },
  { key: "stage",            label: "Stage",                type: "select", section: "details", options: ["Arraignment", "Preliminary Hearing", "Grand Jury/Indictment", "Pre-Trial Motions", "Plea Negotiations", "Trial", "Sentencing", "Post-Conviction", "Appeal"] },
  // Info section
  { key: "custodyStatus",    label: "Custody Status",       type: "select", section: "info", options: ["In Custody", "Out on Bond", "Released on Own Recognizance", "Supervision"] },
  { key: "bondAmount",       label: "Bond Amount",          type: "text",   section: "info" },
  { key: "bondConditions",   label: "Bond Conditions",      type: "text",   section: "info" },
  { key: "jailLocation",     label: "Jail Location",        type: "text",   section: "info" },
  { key: "courtDivision",    label: "Court Division",       type: "select", section: "info", options: ["Circuit", "District", "Juvenile"] },
  { key: "county",           label: "County",               type: "text",   section: "info" },
  { key: "court",            label: "Court",                type: "text",   section: "info" },
  { key: "dispositionType",  label: "Disposition",          type: "select", section: "info", options: ["", "Guilty Plea", "Not Guilty Verdict", "Nolle Prosequi", "Dismissed", "Acquitted", "Convicted at Trial", "Youthful Offender", "Other"] },
  // Dates section
  { key: "arrestDate",       label: "Arrest Date",          type: "date",   section: "dates" },
  { key: "arraignmentDate",  label: "Arraignment Date",     type: "date",   section: "dates" },
  { key: "nextCourtDate",    label: "Next Court Date",      type: "date",   section: "dates" },
  { key: "trialDate",        label: "Trial Date",           type: "date",   section: "dates" },
  { key: "sentencingDate",   label: "Sentencing Date",      type: "date",   section: "dates" },
  { key: "dispositionDate",  label: "Disposition Date",     type: "date",   section: "dates" },
  // Team section
  { key: "assignedAttorney", label: "Assigned Attorney",    type: "user",   section: "team" },
  { key: "secondAttorney",   label: "2nd Attorney",         type: "user",   section: "team" },
  { key: "trialCoordinator", label: "Trial Coordinator",     type: "user",   section: "team" },
  { key: "investigator",     label: "Investigator",         type: "user",   section: "team" },
  { key: "socialWorker",     label: "Social Worker",        type: "user",   section: "team" },
];

const isAttorney = (user) => hasRole(user, "Public Defender") || hasRole(user, "Chief Deputy Public Defender") || hasRole(user, "Deputy Public Defender") || hasRole(user, "Senior Trial Attorney") || hasRole(user, "Trial Attorney");

function EditField({ fieldKey, label, type, options, value, onChange, onBlur, onRemove, canRemove, isCustom, userList, readOnly, onContactClick }) {
  const displayVal = type === "date" ? (value || "") : (value ?? "");
  const userVal = type === "user" ? (value || "") : undefined;
  const availableUsers = userList || USERS;

  if (readOnly) {
    let display = "—";
    if (type === "user") display = getUserById(Number(value))?.name || "—";
    else if (type === "date") display = value ? fmt(value) : "—";
    else display = value || "—";
    const isClickable = onContactClick && display !== "—";
    return (
      <div className="edit-field">
        <div className="edit-field-key">{label}</div>
        <div className="edit-field-val" style={{ padding: "3px 0" }}>
          {isClickable ? (
            <span
              onClick={() => onContactClick(display)}
              style={{ color: "#1E2A3A", cursor: "pointer", fontSize: 13, fontWeight: 400, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}
              title="View contact card"
            >{display}</span>
          ) : (
            <span style={{ color: "var(--c-text)", fontSize: 13, fontWeight: 400 }}>{display}</span>
          )}
        </div>
      </div>
    );
  }

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
            {availableUsers.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
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

const CONTACT_LINKABLE_KEYS = new Set(["defendantName", "prosecutor", "judge"]);

const KEY_DATE_FIELDS = ["arrestDate", "arraignmentDate", "nextCourtDate", "trialDate", "sentencingDate", "dispositionDate"];
const KEY_DATE_TYPES = { arrestDate: "Other", arraignmentDate: "Hearing", nextCourtDate: "Hearing", trialDate: "Hearing", sentencingDate: "Hearing", dispositionDate: "Other" };

function CaseDetailOverlay({ c, currentUser, tasks, deadlines, notes, links, activity, onClose, onUpdate, onDeleteCase, onCompleteTask, onAddTask, onAddNote, onDeleteNote, onUpdateNote, onAddLink, onDeleteLink, onLogActivity, onRefreshActivity, onAddDeadline, onUpdateDeadline, initialTab }) {
  const [draft, setDraft] = useState({ ...c });
  const [customFields, setCustomFields] = useState(c._customFields || []);
  const DEFAULT_HIDDEN_DATES = [];
  const [hiddenFields, setHiddenFields] = useState(c._hiddenFields != null ? c._hiddenFields : DEFAULT_HIDDEN_DATES);
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldIsName, setNewFieldIsName] = useState(false);
  const [customDates, setCustomDates] = useState(c._customDates || []);
  const [addingDate, setAddingDate] = useState(false);
  const [newDateLabel, setNewDateLabel] = useState("");
  const [showPrint, setShowPrint] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab || "overview");
  const initialTabConsumed = useRef(false);
  useEffect(() => {
    if (initialTab && !initialTabConsumed.current) {
      setActiveTab(initialTab);
      initialTabConsumed.current = true;
    }
  }, [initialTab]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [allContacts, setAllContacts] = useState([]);
  const [contactPopup, setContactPopup] = useState(null);
  const [contactEditMode, setContactEditMode] = useState(false);
  const [contactEditDraft, setContactEditDraft] = useState(null);
  const [showCompletedOverlay, setShowCompletedOverlay] = useState(false);
  const [customTeam, setCustomTeam] = useState(c._customTeam || []);
  const [addingTeamSlot, setAddingTeamSlot] = useState(false);
  const [newTeamRole, setNewTeamRole] = useState("");
  const [newTeamUserId, setNewTeamUserId] = useState(0);
  const [correspondence, setCorrespondence] = useState([]);
  const [corrLoading, setCorrLoading] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState(null);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [corrCopied, setCorrCopied] = useState(false);
  const [parties, setParties] = useState([]);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [expandedParty, setExpandedParty] = useState(null);
  const [addingParty, setAddingParty] = useState(false);
  const [newCoDefFirst, setNewCoDefFirst] = useState("");
  const [newCoDefMiddle, setNewCoDefMiddle] = useState("");
  const [newCoDefLast, setNewCoDefLast] = useState("");
  const partyTimers = useRef({});
  const partyPendingData = useRef({});
  const [experts, setExperts] = useState([]);
  const [expertsLoading, setExpertsLoading] = useState(false);
  const [expandedExpert, setExpandedExpert] = useState(null);
  const [addingExpert, setAddingExpert] = useState(false);
  const [newExpertType, setNewExpertType] = useState("Treating Physician");
  const expertTimers = useRef({});
  const expertPendingData = useRef({});
  const [miscContacts, setMiscContacts] = useState([]);
  const [miscContactsLoading, setMiscContactsLoading] = useState(false);
  const [expandedMiscContact, setExpandedMiscContact] = useState(null);
  const [addingMiscContact, setAddingMiscContact] = useState(false);
  const [newMiscContactType, setNewMiscContactType] = useState("Other");
  const miscContactTimers = useRef({});
  const miscContactPendingData = useRef({});
  const [showTeamPopup, setShowTeamPopup] = useState(false);
  const [showDocGen, setShowDocGen] = useState(false);
  const [activityFilter, setActivityFilter] = useState("all");
  const [aiStrategy, setAiStrategy] = useState({ loading: false, result: null, error: null, show: false });
  const [aiDeadlines, setAiDeadlines] = useState({ loading: false, deadlines: null, error: null, show: false });
  const [aiTasks, setAiTasks] = useState({ loading: false, tasks: null, error: null, show: false, added: {} });
  const [aiClientSummary, setAiClientSummary] = useState({ loading: false, result: null, error: null, show: false });
  const [aiChargeAnalysis, setAiChargeAnalysis] = useState({ loading: false, result: null, error: null, show: false });
  const [classifyingChargeIdx, setClassifyingChargeIdx] = useState(null);
  const chargesRef = useRef(c.charges);
  chargesRef.current = c.charges;
  const [showAdvocate, setShowAdvocate] = useState(false);
  const [advocateMessages, setAdvocateMessages] = useState([]);
  const [advocateLoading, setAdvocateLoading] = useState(false);
  const [advocateInput, setAdvocateInput] = useState("");
  const [advocateStats, setAdvocateStats] = useState(null);
  const [advocateTasksAdded, setAdvocateTasksAdded] = useState({});
  const advocateEndRef = useRef(null);
  useEffect(() => { if (advocateEndRef.current) advocateEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [advocateMessages, advocateLoading]);
  const [caseDocuments, setCaseDocuments] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploadType, setDocUploadType] = useState("Police Report");
  const [docFilterType, setDocFilterType] = useState("All");
  const [docSummarizing, setDocSummarizing] = useState(null);
  const [expandedDocId, setExpandedDocId] = useState(null);
  const [filings, setFilings] = useState([]);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [filingUploadFiledBy, setFilingUploadFiledBy] = useState("");
  const [filingUploadDate, setFilingUploadDate] = useState("");
  const [filingUploadDocType, setFilingUploadDocType] = useState("");
  const [filingFilterBy, setFilingFilterBy] = useState("All");
  const [filingSummarizing, setFilingSummarizing] = useState(null);
  const [filingClassifying, setFilingClassifying] = useState(null);
  const [expandedFilingId, setExpandedFilingId] = useState(null);
  const [editingFilingId, setEditingFilingId] = useState(null);
  const [editingFilingData, setEditingFilingData] = useState({});
  const [editingDocId, setEditingDocId] = useState(null);
  const [editingDocData, setEditingDocData] = useState({});
  const canRemove = isAttorney(currentUser) || isAppAdmin(currentUser);
  const canDelete = isAppAdmin(currentUser);

  useEffect(() => {
    apiGetContacts().then(setAllContacts).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCorrLoading(true);
    apiGetCorrespondence(c.id).then(setCorrespondence).catch(() => {}).finally(() => setCorrLoading(false));
    setDocsLoading(true);
    apiGetCaseDocuments(c.id).then(setCaseDocuments).catch(() => {}).finally(() => setDocsLoading(false));
    setFilingsLoading(true);
    apiGetFilings(c.id).then(setFilings).catch(() => {}).finally(() => setFilingsLoading(false));
    apiGetActivity(c.id).then(fresh => onRefreshActivity(c.id, fresh)).catch(() => {});
    setPartiesLoading(true);
    apiGetParties(c.id).then(setParties).catch(() => {}).finally(() => setPartiesLoading(false));
    setExpertsLoading(true);
    apiGetExperts(c.id).then(setExperts).catch(() => {}).finally(() => setExpertsLoading(false));
    setMiscContactsLoading(true);
    apiGetMiscContacts(c.id).then(setMiscContacts).catch(() => {}).finally(() => setMiscContactsLoading(false));
    const timersRef = partyTimers.current;
    const pendingRef = partyPendingData.current;

    const expTimersRef = expertTimers.current;
    const expPendingRef = expertPendingData.current;
    const miscTimersRef = miscContactTimers.current;
    const miscPendingRef = miscContactPendingData.current;
    return () => {
      Object.entries(timersRef).forEach(([key, timer]) => {
        clearTimeout(timer);
        const pendingData = pendingRef[key];
        if (pendingData) {
          apiUpdateParty(parseInt(key), { data: pendingData }).catch(() => {});
          delete pendingRef[key];
        }
      });
      partyTimers.current = {};

      Object.entries(expTimersRef).forEach(([key, timer]) => {
        clearTimeout(timer);
        const pendingData = expPendingRef[key];
        if (pendingData) {
          apiUpdateExpert(parseInt(key), { data: pendingData }).catch(() => {});
          delete expPendingRef[key];
        }
      });
      expertTimers.current = {};
      Object.entries(miscTimersRef).forEach(([key, timer]) => {
        clearTimeout(timer);
        const pendingData = miscPendingRef[key];
        if (pendingData) {
          apiUpdateMiscContact(parseInt(key), { data: pendingData }).catch(() => {});
          delete miscPendingRef[key];
        }
      });
      miscContactTimers.current = {};
    };
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleContactClick = async (name) => {
    if (!name || !name.trim()) return;
    const n = name.trim().toLowerCase();
    const found = allContacts.find(ct => ct.name.trim().toLowerCase() === n);
    if (found) {
      setContactPopup(found);
    } else {
      try {
        const created = await apiCreateContact({ name: name.trim(), category: "Miscellaneous", phone: "", email: "", fax: "", address: "" });
        setAllContacts(p => [...p, created]);
        setContactPopup(created);
      } catch { /* silently ignore if creation fails */ }
    }
  };

  // Track "committed" values for blur-based change detection
  const committed = useState({ ...c })[0]; // ref-like: we mutate it directly

  const log = (action, detail) => {
    onLogActivity({
      id: newId(),
      caseId: c.id,
      ts: new Date().toISOString(),
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentUser.role,
      action,
      detail,
    });
  };

  // Auto-save on draft/customFields/customDates/billing/expenses change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      onUpdate({ ...draft, _customFields: customFields, _customDates: customDates, _hiddenFields: hiddenFields, _customTeam: customTeam });
    }, 400);
    return () => clearTimeout(t);
  }, [draft, customFields, customDates, customTeam]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (KEY_DATE_FIELDS.includes(key)) {
        const label = fieldLabel(key);
        const existing = deadlines.find(d => d.caseId === c.id && d.title === label);
        if (newVal) {
          if (existing) {
            if (onUpdateDeadline) onUpdateDeadline(existing.id, { date: newVal });
          } else {
            handleAddDeadline({ caseId: c.id, title: label, date: newVal, type: KEY_DATE_TYPES[key] || "Filing", rule: "", assigned: currentUser.id });
          }
        }
      }
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

  const detailFields = CORE_FIELDS.filter(f => f.section === "details" && f.key !== "status" && f.key !== "stage");
  const infoFields   = CORE_FIELDS.filter(f => f.section === "info");
  const dateFields   = CORE_FIELDS.filter(f => f.section === "dates");
  const teamFields   = CORE_FIELDS.filter(f => f.section === "team");

  const filteredUsersForTeam = USERS;

  const addCustomField = () => {
    if (!newFieldLabel.trim()) return;
    const label = newFieldLabel.trim();
    setCustomFields(p => [...p, { id: newId(), label, value: "", isNameField: newFieldIsName }]);
    setNewFieldLabel("");
    setNewFieldIsName(false);
    setAddingField(false);
    log("Field Added", `Custom field "${label}" added${newFieldIsName ? " (name/contact field)" : ""}`);
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

  const addCustomDate = () => {
    if (!newDateLabel.trim()) return;
    const label = newDateLabel.trim();
    setCustomDates(p => [...p, { id: newId(), label, value: "" }]);
    setNewDateLabel("");
    setAddingDate(false);
    log("Field Added", `Custom date "${label}" added`);
  };

  const removeCustomDate = (id) => {
    const d = customDates.find(d => d.id === id);
    setCustomDates(p => p.filter(d => d.id !== id));
    if (d) log("Field Removed", `Custom date "${d.label}" removed`);
  };

  const updateCustomDate = (id, val) => {
    const prev = customDates.find(d => d.id === id);
    setCustomDates(p => p.map(d => d.id === id ? { ...d, value: val } : d));
    if (val && prev) {
      const alreadyExists = deadlines.some(d => d.title === prev.label);
      if (!alreadyExists) {
        handleAddDeadline({ caseId: c.id, title: prev.label, date: val, type: "Filing", rule: "", assigned: currentUser.id });
      }
    }
  };

  const handleComplete = (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    onCompleteTask(taskId);
    if (task) log("Task Completed", `"${task.title}" marked complete`);
  };

  const handleAddNote = (note) => {
    onAddNote(note);
    const typeLabel = note.type || "General";
    const preview = (note.body || "").substring(0, 60);
    log("Note Added", `${typeLabel} note: "${preview}${note.body && note.body.length > 60 ? "..." : ""}"`);
  };

  const handleDeleteNote = (noteId) => {
    const note = notes.find(n => n.id === noteId);
    onDeleteNote(noteId);
    if (note) {
      const preview = (note.body || "").substring(0, 60);
      log("Note Removed", `Note deleted: "${preview}${note.body && note.body.length > 60 ? "..." : ""}"`);
    }
  };

  const handleUpdateNote = async (noteId, data) => {
    await onUpdateNote(noteId, data);
    log("Note Edited", `Note updated`);
  };

  const handleAddDeadline = (dl) => {
    if (onAddDeadline) onAddDeadline(dl);
    log("Deadline Added", `"${dl.title}" due ${dl.date}${dl.type ? ` (${dl.type})` : ""}`);
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
    if (action.includes("Removed") || action.includes("Reopened") || action.includes("Deleted")) return "#e05252";
    if (action.includes("Added") || action.includes("Created")) return "#1E2A3A";
    if (action.includes("Note") || action.includes("Deadline")) return "#5E81AC";
    if (action.includes("Billing") || action.includes("Expense")) return "#D08770";
    if (action.includes("Correspondence")) return "#88C0D0";
    return "#5599cc";
  };

  return (
    <>
      {showPrint && (
        <CasePrintView c={draft} notes={notes} tasks={tasks} deadlines={deadlines} links={links} onClose={() => setShowPrint(false)} />
      )}
      {showDocGen && (
        <GenerateDocumentModal caseData={draft} currentUser={currentUser} onClose={() => setShowDocGen(false)} parties={parties} experts={experts} caseId={c.id} onAddNote={onAddNote} onLogActivity={onLogActivity} />
      )}
      {aiStrategy.show && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setAiStrategy({ loading: false, result: null, error: null, show: false })}>
          <div className="modal" style={{ maxWidth: 700, maxHeight: "85vh", overflow: "auto" }}>
            <div className="modal-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>⚡ Defense Strategy Analysis</span>
              <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#8A9096" }} onClick={() => setAiStrategy({ loading: false, result: null, error: null, show: false })}>✕</button>
            </div>
            <div className="modal-sub">{draft.title} — {draft.defendantName || "Defendant"}</div>
            <AiPanel title="Strategy Analysis" result={aiStrategy.result} loading={aiStrategy.loading} error={aiStrategy.error}
              onRun={() => {
                setAiStrategy(p => ({ ...p, loading: true, result: null, error: null }));
                apiCaseStrategy({ caseId: c.id }).then(r => setAiStrategy(p => ({ ...p, loading: false, result: r.result }))).catch(e => setAiStrategy(p => ({ ...p, loading: false, error: e.message })));
              }}
              actions={aiStrategy.result ? (
                <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => {
                  onAddNote({ caseId: c.id, body: aiStrategy.result, type: "Strategy" });
                  onLogActivity("AI Strategy Saved", "Defense strategy analysis saved as note");
                  alert("Strategy saved as case note.");
                }}>Save as Note</button>
              ) : null}
            />
          </div>
        </div>
      )}
      {showAdvocate && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && { }}>
          <div className="modal" style={{ maxWidth: 600, height: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>🤖</span>
                <div>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 16, fontWeight: 600, color: "var(--c-text-h)" }}>Advocate AI</div>
                  <div style={{ fontSize: 11, color: "#8A9096" }}>{draft.title} — {draft.defendantName || "Defendant"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {advocateMessages.length > 0 && (
                  <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => {
                    const thread = advocateMessages.map(m => m.role === "user" ? `**You:** ${m.content}` : `**Advocate AI:** ${m.content}`).join("\n\n---\n\n");
                    onAddNote({ caseId: c.id, body: thread, type: "AI Consultation" });
                    onLogActivity("AI Consultation Saved", "Advocate AI conversation saved as note");
                    alert("Conversation saved as case note.");
                  }}>Save as Note</button>
                )}
                <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#8A9096" }} onClick={() => { setShowAdvocate(false); setAdvocateMessages([]); setAdvocateInput(""); setAdvocateStats(null); setAdvocateLoading(false); setAdvocateTasksAdded({}); }}>✕</button>
              </div>
            </div>
            {advocateStats && (
              <div style={{ padding: "6px 18px", fontSize: 11, color: "#8A9096", borderBottom: "1px solid var(--c-border)", flexShrink: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {advocateStats.notes > 0 && <span>📋 {advocateStats.notes} notes</span>}
                {advocateStats.tasks > 0 && <span>✓ {advocateStats.tasks} tasks</span>}
                {advocateStats.deadlines > 0 && <span>📅 {advocateStats.deadlines} deadlines</span>}
                {advocateStats.documents > 0 && <span>📄 {advocateStats.documents} docs</span>}
                {advocateStats.filings > 0 && <span>⚖ {advocateStats.filings} filings</span>}
                {advocateStats.emails > 0 && <span>✉ {advocateStats.emails} emails</span>}
                {advocateStats.parties > 0 && <span>👥 {advocateStats.parties} parties</span>}
              </div>
            )}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              {advocateMessages.length === 0 && !advocateLoading && (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                  <div style={{ fontSize: 40, opacity: 0.3 }}>🤖</div>
                  <div style={{ fontSize: 14, color: "#8A9096", textAlign: "center", maxWidth: 360, lineHeight: 1.6 }}>
                    Ask me anything about this case. I have access to all notes, documents, filings, emails, and case details.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 420 }}>
                    {["Analyze defense strategies", "Summarize key evidence", "Identify weaknesses in the State's case", "What motions should I consider?"].map(prompt => (
                      <button key={prompt} style={{ padding: "6px 12px", fontSize: 12, borderRadius: 16, border: "1px solid #a5b4fc", background: "rgba(99,102,241,0.08)", color: "#818cf8", cursor: "pointer", transition: "all 0.15s" }}
                        onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.18)"; }}
                        onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.08)"; }}
                        onClick={() => {
                          const msgs = [{ role: "user", content: prompt }];
                          setAdvocateMessages(msgs);
                          setAdvocateLoading(true);
                          setAdvocateInput("");
                          apiAdvocateChat({ caseId: c.id, messages: msgs }).then(r => {
                            setAdvocateMessages(p => [...p, { role: "assistant", content: r.reply, suggestedTasks: r.suggestedTasks || null }]);
                            if (r.contextStats) setAdvocateStats(r.contextStats);
                          }).catch(e => {
                            setAdvocateMessages(p => [...p, { role: "assistant", content: "I encountered an error. Please try again." }]);
                          }).finally(() => setAdvocateLoading(false));
                        }}>{prompt}</button>
                    ))}
                  </div>
                </div>
              )}
              {advocateMessages.map((msg, i) => {
                const displayText = msg.content;
                const parsedTasks = msg.suggestedTasks && Array.isArray(msg.suggestedTasks) && msg.suggestedTasks.length > 0 ? msg.suggestedTasks : null;
                const msgAdded = advocateTasksAdded[i] || {};
                const priorityColors = { Urgent: "#e05252", High: "#e88c30", Medium: "#b8860b", Low: "#2F7A5F" };
                return (
                <div key={i}>
                <div style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                  <div style={{
                    maxWidth: "85%", padding: "10px 14px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: msg.role === "user" ? "linear-gradient(135deg, #6366f1, #4f46e5)" : "var(--c-card-alt, #1a2332)",
                    color: msg.role === "user" ? "#fff" : "#E6EDF3",
                    fontSize: 13, lineHeight: 1.7, position: "relative",
                    border: msg.role === "user" ? "none" : "1px solid var(--c-border)"
                  }}>
                    {msg.role === "assistant" && (
                      <button style={{ position: "absolute", top: 4, right: 4, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#8A9096", opacity: 0.6, padding: "2px 4px" }}
                        title="Copy response"
                        onClick={() => { navigator.clipboard.writeText(displayText); }}>📋</button>
                    )}
                    {msg.role === "user" ? (
                      <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                    ) : (
                      <div>
                        {displayText.split("\n").map((line, li) => {
                          if (line.startsWith("## ")) return <div key={li} style={{ fontWeight: 700, fontSize: 14, marginTop: 10, marginBottom: 4 }}>{line.replace(/^## /, "")}</div>;
                          if (line.startsWith("### ")) return <div key={li} style={{ fontWeight: 600, fontSize: 13, marginTop: 8, marginBottom: 2 }}>{line.replace(/^### /, "")}</div>;
                          if (line.startsWith("**") && line.endsWith("**")) return <div key={li} style={{ fontWeight: 700, marginTop: 6, marginBottom: 2 }}>{line.replace(/\*\*/g, "")}</div>;
                          if (line.startsWith("- ") || line.startsWith("* ")) return <div key={li} style={{ paddingLeft: 12, position: "relative" }}><span style={{ position: "absolute", left: 0 }}>•</span>{line.replace(/^[-*] /, "").replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
                          if (line.match(/^\d+\.\s/)) return <div key={li} style={{ paddingLeft: 4 }}>{line.replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
                          if (line.trim() === "") return <div key={li} style={{ height: 4 }} />;
                          return <div key={li}>{line.replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {parsedTasks && parsedTasks.length > 0 && (
                  <div style={{ maxWidth: "85%", marginTop: 6, padding: "10px 14px", borderRadius: 10, background: "var(--c-card)", border: "1px solid var(--c-border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text-h)" }}>⚡ Suggested Tasks</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {Object.keys(msgAdded).length < parsedTasks.length && (
                          <button className="btn btn-sm" style={{ fontSize: 10, padding: "2px 10px", background: "#6366f1", color: "#fff", border: "none" }} onClick={async () => {
                            for (let ti = 0; ti < parsedTasks.length; ti++) {
                              if (msgAdded[ti]) continue;
                              const t = parsedTasks[ti];
                              const dueDate = t.dueInDays ? new Date(Date.now() + t.dueInDays * 86400000).toISOString().split("T")[0] : null;
                              try {
                                await apiCreateTask({ caseId: c.id, title: t.title, priority: t.priority || "Medium", assignedRole: t.assignedRole || "", due: dueDate, notes: t.rationale || "", isGenerated: true });
                                setAdvocateTasksAdded(p => ({ ...p, [i]: { ...(p[i] || {}), [ti]: true } }));
                              } catch (err) { alert("Failed: " + err.message); break; }
                            }
                          }}>+ Add All</button>
                        )}
                      </div>
                    </div>
                    {parsedTasks.map((t, ti) => {
                      const added = msgAdded[ti];
                      return (
                        <div key={ti} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderTop: ti > 0 ? "1px solid var(--c-border)" : "none", opacity: added ? 0.45 : 1 }}>
                          <span style={{ fontSize: 12, marginTop: 1 }}>{added ? "✓" : "⚡"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: "var(--c-text-h)", fontWeight: 500 }}>{t.title}</div>
                            <div style={{ display: "flex", gap: 8, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                              <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: (priorityColors[t.priority] || "#b8860b") + "18", color: priorityColors[t.priority] || "#b8860b" }}>{t.priority}</span>
                              {t.assignedRole && <span style={{ fontSize: 10, color: "#8A9096" }}>{t.assignedRole}</span>}
                              {t.dueInDays && <span style={{ fontSize: 10, color: "#8A9096" }}>Due in {t.dueInDays} days</span>}
                            </div>
                            {t.rationale && <div style={{ fontSize: 11, color: "var(--c-text2)", marginTop: 3, lineHeight: 1.4 }}>{t.rationale}</div>}
                          </div>
                          {!added && (
                            <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px", flexShrink: 0 }} onClick={async () => {
                              const dueDate = t.dueInDays ? new Date(Date.now() + t.dueInDays * 86400000).toISOString().split("T")[0] : null;
                              try {
                                await apiCreateTask({ caseId: c.id, title: t.title, priority: t.priority || "Medium", assignedRole: t.assignedRole || "", due: dueDate, notes: t.rationale || "", isGenerated: true });
                                setAdvocateTasksAdded(p => ({ ...p, [i]: { ...(p[i] || {}), [ti]: true } }));
                              } catch (err) { alert("Failed: " + err.message); }
                            }}>+ Add</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              )})}
              {advocateLoading && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ padding: "12px 18px", borderRadius: "14px 14px 14px 4px", background: "var(--c-card-alt, #1a2332)", border: "1px solid var(--c-border)", display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "pulse 1s ease-in-out infinite" }} />
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "pulse 1s ease-in-out 0.2s infinite" }} />
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "pulse 1s ease-in-out 0.4s infinite" }} />
                  </div>
                </div>
              )}
              <div ref={advocateEndRef} />
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--c-border)", flexShrink: 0, display: "flex", gap: 8 }}>
              <input
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", fontSize: 13, outline: "none" }}
                placeholder="Ask about this case..."
                value={advocateInput}
                onChange={e => setAdvocateInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey && advocateInput.trim() && !advocateLoading) {
                    e.preventDefault();
                    const newMsgs = [...advocateMessages, { role: "user", content: advocateInput.trim() }];
                    setAdvocateMessages(newMsgs);
                    setAdvocateLoading(true);
                    setAdvocateInput("");
                    apiAdvocateChat({ caseId: c.id, messages: newMsgs }).then(r => {
                      setAdvocateMessages(p => [...p, { role: "assistant", content: r.reply, suggestedTasks: r.suggestedTasks || null }]);
                      if (r.contextStats && !advocateStats) setAdvocateStats(r.contextStats);
                    }).catch(() => {
                      setAdvocateMessages(p => [...p, { role: "assistant", content: "I encountered an error. Please try again." }]);
                    }).finally(() => setAdvocateLoading(false));
                  }
                }}
                disabled={advocateLoading}
              />
              <button
                className="btn btn-sm"
                style={{ background: advocateInput.trim() && !advocateLoading ? "#6366f1" : "#4b5563", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 8, cursor: advocateInput.trim() && !advocateLoading ? "pointer" : "not-allowed" }}
                disabled={!advocateInput.trim() || advocateLoading}
                onClick={() => {
                  if (!advocateInput.trim() || advocateLoading) return;
                  const newMsgs = [...advocateMessages, { role: "user", content: advocateInput.trim() }];
                  setAdvocateMessages(newMsgs);
                  setAdvocateLoading(true);
                  setAdvocateInput("");
                  apiAdvocateChat({ caseId: c.id, messages: newMsgs }).then(r => {
                    setAdvocateMessages(p => [...p, { role: "assistant", content: r.reply, suggestedTasks: r.suggestedTasks || null }]);
                    if (r.contextStats && !advocateStats) setAdvocateStats(r.contextStats);
                  }).catch(() => {
                    setAdvocateMessages(p => [...p, { role: "assistant", content: "I encountered an error. Please try again." }]);
                  }).finally(() => setAdvocateLoading(false));
                }}
              >Send</button>
            </div>
          </div>
        </div>
      )}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowDeleteConfirm(false)}>
          <div className="modal-box" style={{ maxWidth: 440 }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "var(--c-text-h)", marginBottom: 10 }}>Delete {recordType(draft)}?</div>
            <div style={{ fontSize: 13, color: "var(--c-text2)", marginBottom: 6, lineHeight: 1.6 }}>
              <strong style={{ color: "var(--c-text)" }}>{draft.title}</strong> will be moved to the Deleted tab and permanently removed after 30 days.
            </div>
            <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 24 }}>This action can be undone within the 30-day window by restoring the record.</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn" style={{ background: "#fca5a5", color: "#e05252", border: "1px solid #8a3a3a" }} onClick={() => { setShowDeleteConfirm(false); onDeleteCase(c.id); }}>Delete {recordType(draft)}</button>
            </div>
          </div>
        </div>
      )}
      {showTeamPopup && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowTeamPopup(false)}>
          <div className="mobile-full" style={{ background: "var(--c-card)", borderRadius: 12, padding: "24px 28px", minWidth: 380, maxWidth: 500, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.3)", margin: "0 8px" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 600, color: "var(--c-text-h)" }}>Team</div>
              <button onClick={() => setShowTeamPopup(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#8A9096", lineHeight: 1, padding: "2px 4px" }}>✕</button>
            </div>
            {teamFields.map(f => (
              <EditField
                key={f.key}
                fieldKey={f.key}
                label={f.label}
                type={f.type}
                value={draft[f.key]}
                onChange={val => setAndLog(f.key, val)}
                canRemove={false}
                userList={filteredUsersForTeam}
                readOnly={false}
              />
            ))}
            {customTeam.map(m => (
              <div key={m.id} className="edit-field">
                <div className="edit-field-key" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>{m.role}</span>
                  <button onClick={() => setCustomTeam(p => p.filter(t => t.id !== m.id))} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}>✕</button>
                </div>
                <select
                  value={m.userId || 0}
                  onChange={e => setCustomTeam(p => p.map(t => t.id === m.id ? { ...t, userId: parseInt(e.target.value) } : t))}
                  className="edit-field-value"
                >
                  <option value={0}>— None —</option>
                  {filteredUsersForTeam.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            ))}
            <div style={{ marginTop: 10 }}>
              {addingTeamSlot && (
                  <div style={{ marginBottom: 8 }}>
                    <input
                      placeholder="Role (e.g. Co-Counsel, Investigator)"
                      value={newTeamRole}
                      onChange={e => setNewTeamRole(e.target.value)}
                      style={{ width: "100%", fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", marginBottom: 6, boxSizing: "border-box" }}
                      autoFocus
                    />
                    <select
                      value={newTeamUserId}
                      onChange={e => setNewTeamUserId(parseInt(e.target.value))}
                      style={{ width: "100%", fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", marginBottom: 6 }}
                    >
                      <option value={0}>Select staff member</option>
                      {filteredUsersForTeam.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <button
                      className="btn btn-gold"
                      style={{ fontSize: 12, width: "100%" }}
                      disabled={!newTeamRole.trim() || !newTeamUserId}
                      onClick={() => {
                        setCustomTeam(p => [...p, { id: Date.now(), role: newTeamRole.trim(), userId: newTeamUserId }]);
                        setNewTeamRole("");
                        setNewTeamUserId(0);
                        setAddingTeamSlot(false);
                      }}
                    >Add to Team</button>
                  </div>
                )}
                <button className="btn btn-outline btn-sm" style={{ fontSize: 11, width: "100%" }} onClick={() => setAddingTeamSlot(s => !s)}>
                  {addingTeamSlot ? "Cancel" : "+ Add Team Slot"}
                </button>
            </div>
          </div>
        </div>
      )}
      {contactPopup && (
        <div className="case-overlay" style={{ left: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }} onClick={e => e.target === e.currentTarget && (setContactPopup(null), setContactEditMode(false))}>
          <div className="login-box" style={{ maxWidth: 420, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => { setContactPopup(null); setContactEditMode(false); }} style={{ position: "absolute", top: 14, right: 16, background: "transparent", border: "none", fontSize: 18, color: "#8A9096", cursor: "pointer", lineHeight: 1 }}>✕</button>
            {contactEditMode && contactEditDraft ? (
              <>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "var(--c-text-h)", marginBottom: 16 }}>Edit Contact</div>
                {[["Name", "name"], ["Phone", "phone"], ["Email", "email"], ["Fax", "fax"], ["Address", "address"]].map(([lbl, key]) => (
                  <div className="form-group" key={key}>
                    <label>{lbl}</label>
                    <input value={contactEditDraft[key] || ""} onChange={e => setContactEditDraft(p => ({ ...p, [key]: e.target.value }))} style={{ width: "100%" }} />
                  </div>
                ))}
                <div className="form-group">
                  <label>Category</label>
                  <select value={contactEditDraft.category || "Client"} onChange={e => setContactEditDraft(p => ({ ...p, category: e.target.value }))} style={{ width: "100%" }}>
                    {CONTACT_CATEGORIES.map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <button className="btn btn-gold" style={{ width: "100%", padding: 10 }} onClick={async () => {
                  try {
                    const saved = await apiUpdateContact(contactEditDraft.id, contactEditDraft);
                    setAllContacts(p => p.map(ct => ct.id === saved.id ? saved : ct));
                    setContactPopup(saved);
                    setContactEditMode(false);
                  } catch { alert("Failed to save contact."); }
                }}>Save</button>
                <button className="btn btn-outline" style={{ width: "100%", marginTop: 10 }} onClick={() => setContactEditMode(false)}>Cancel</button>
              </>
            ) : (() => {
              const cs = CONTACT_CAT_STYLE[contactPopup.category] || CONTACT_CAT_STYLE.Miscellaneous;
              const row = (icon, val) => val ? (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ fontSize: 14, color: "#8A9096", width: 18, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 13, color: "var(--c-text)" }}>{val}</span>
                </div>
              ) : null;
              return (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 6 }}>{contactPopup.name}</div>
                    <span style={{ fontSize: 11, fontWeight: 600, background: cs.bg, color: "#1F2428", borderRadius: 4, padding: "2px 8px" }}>{contactPopup.category}</span>
                  </div>
                  <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 14 }}>
                    {row("📞", contactPopup.phone)}
                    {row("✉️", contactPopup.email)}
                    {row("📠", contactPopup.fax)}
                    {row("📍", contactPopup.address)}
                    {!contactPopup.phone && !contactPopup.email && !contactPopup.fax && !contactPopup.address && (
                      <div style={{ fontSize: 12, color: "#8A9096", fontStyle: "italic" }}>No contact details on file.</div>
                    )}
                  </div>
                  <button className="btn btn-gold" style={{ width: "100%", padding: 10, marginTop: 16 }} onClick={() => { setContactEditDraft({ ...contactPopup }); setContactEditMode(true); }}>Edit Contact</button>
                </>
              );
            })()}
          </div>
        </div>
      )}
      <div className="case-overlay">

        {/* Header */}
        <div className="case-overlay-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
              <Badge label="Case" />
              {draft.caseNum && <span style={{ fontSize: 11, color: "#1E2A3A", fontFamily: "monospace" }}>{draft.caseNum}</span>}
              {editMode
                ? <span style={{ fontSize: 11, fontWeight: 700, color: "#1E2A3A", background: "#E4E7EB", border: "1px solid #D6D8DB", borderRadius: 4, padding: "2px 8px", letterSpacing: "0.03em" }}>EDIT MODE</span>
                : <span style={{ fontSize: 11, color: "#8A9096" }}>Auto-saving</span>
              }
              <select
                value={draft.status || "Active"}
                onChange={e => setAndLog("status", e.target.value)}
                style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", cursor: "pointer", fontFamily: "inherit" }}
              >
                {["Active", "Closed", "Pending", "Disposed", "Transferred"].map(o => <option key={o}>{o}</option>)}
              </select>
              <select
                value={draft.stage || "Arraignment"}
                onChange={e => setAndLog("stage", e.target.value)}
                style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", cursor: "pointer", fontFamily: "inherit" }}
              >
                {["Arraignment", "Preliminary Hearing", "Grand Jury/Indictment", "Pre-Trial Motions", "Plea Negotiations", "Trial", "Sentencing", "Post-Conviction", "Appeal"].map(o => <option key={o}>{o}</option>)}
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: draft.confidential ? "#dc2626" : "#8A9096", cursor: "pointer", userSelect: "none", marginLeft: 4 }} title="Confidential cases are excluded from AI Search">
                <input type="checkbox" checked={!!draft.confidential} onChange={e => setAndLog("confidential", e.target.checked)} style={{ margin: 0, cursor: "pointer" }} />
                {draft.confidential ? "CONFIDENTIAL" : "Confidential"}
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: draft.deathPenalty ? 700 : 400, color: draft.deathPenalty ? "#fff" : "#8A9096", background: draft.deathPenalty ? "#991b1b" : "transparent", padding: draft.deathPenalty ? "2px 8px" : "0", borderRadius: 4, cursor: "pointer", userSelect: "none", marginLeft: 4, letterSpacing: "0.03em" }} title="Flag this case as a death penalty / capital case">
                <input type="checkbox" checked={!!draft.deathPenalty} onChange={e => setAndLog("deathPenalty", e.target.checked)} style={{ margin: 0, cursor: "pointer", accentColor: "#991b1b" }} />
                {draft.deathPenalty ? "DEATH PENALTY" : "Death Penalty"}
              </label>
            </div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, color: "var(--c-text-h)", fontWeight: 600, lineHeight: 1.2 }}>
              {draft.title || "Untitled"}
            </div>
          </div>
          <div className="case-overlay-actions" style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-outline btn-sm" style={{ lineHeight: "20px" }} onClick={() => setShowTeamPopup(true)}>👥 Team</button>
            <button
              className={`btn btn-sm ${editMode ? "" : "btn-outline"}`}
              style={editMode ? { background: "#1E2A3A", color: "#fff", border: "1px solid #1E2A3A", lineHeight: "20px" } : { lineHeight: "20px" }}
              onClick={() => setEditMode(e => !e)}
            >{editMode ? "✓ Done" : "✎ Edit"}</button>
            <button className="btn btn-outline btn-sm" style={{ lineHeight: "20px", color: "#b8860b", borderColor: "#d4c9a8" }} onClick={() => {
              setAiStrategy(p => ({ ...p, show: true, loading: true, result: null, error: null }));
              apiCaseStrategy({ caseId: c.id }).then(r => setAiStrategy(p => ({ ...p, loading: false, result: r.result }))).catch(e => setAiStrategy(p => ({ ...p, loading: false, error: e.message })));
            }}>⚡ Strategy</button>
            <button className="btn btn-outline btn-sm" style={{ lineHeight: "20px", color: "#6366f1", borderColor: "#a5b4fc" }} onClick={() => setShowAdvocate(true)}>🤖 Advocate AI</button>
            <button className="btn btn-outline btn-sm" style={{ lineHeight: "20px" }} onClick={() => setShowPrint(true)}>🖨 Print</button>
            <button className="btn btn-outline btn-sm" style={{ lineHeight: "20px" }} onClick={() => { if (parties.length === 0) apiGetParties(c.id).then(setParties).catch(() => {}); setShowDocGen(true); }}>📄 Generate</button>
            {canDelete && (
              <button className="btn btn-outline btn-sm" style={{ color: "#e05252", borderColor: "#fca5a5", lineHeight: "20px" }} onClick={() => setShowDeleteConfirm(true)}>Delete</button>
            )}
            <button className="btn btn-outline btn-sm" style={{ fontSize: 16, lineHeight: 1, padding: "4px 10px" }} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="case-overlay-tabs">
          <div className={`case-overlay-tab ${activeTab === "overview" ? "active" : ""}`} onClick={() => setActiveTab("overview")}>Overview</div>
          <div className={`case-overlay-tab ${activeTab === "details" ? "active" : ""}`} onClick={() => setActiveTab("details")}>Details</div>
          <div className={`case-overlay-tab ${activeTab === "files" ? "active" : ""}`} onClick={() => setActiveTab("files")}>Documents</div>
          <div className={`case-overlay-tab ${activeTab === "correspondence" ? "active" : ""}`} onClick={() => setActiveTab("correspondence")}>
            Correspondence {correspondence.length > 0 && <span style={{ fontSize: 10, color: "#8A9096", marginLeft: 4 }}>({correspondence.length})</span>}
          </div>
          <div className={`case-overlay-tab ${activeTab === "filings" ? "active" : ""}`} onClick={() => setActiveTab("filings")}>
            Filings {filings.length > 0 && <span style={{ fontSize: 10, color: "#8A9096", marginLeft: 4 }}>({filings.length})</span>}
          </div>
          <div className={`case-overlay-tab ${activeTab === "activity" ? "active" : ""}`} onClick={() => setActiveTab("activity")}>
            Activity {activity.length > 0 && <span style={{ fontSize: 10, color: "#8A9096", marginLeft: 4 }}>({activity.length})</span>}
          </div>
        </div>

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div className="case-overlay-body">

            {/* AI Quick Actions Bar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#b8860b", borderColor: "#d4c9a8" }} onClick={() => {
                setAiClientSummary({ loading: true, result: null, error: null, show: true });
                apiClientSummary({ caseId: c.id }).then(r => setAiClientSummary(p => ({ ...p, loading: false, result: r.result }))).catch(e => setAiClientSummary(p => ({ ...p, loading: false, error: e.message })));
              }}>⚡ Client Summary</button>
              <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#b8860b", borderColor: "#d4c9a8" }} onClick={() => {
                setAiChargeAnalysis({ loading: true, result: null, error: null, show: true });
                apiChargeAnalysis({ chargeDescription: draft.chargeDescription, chargeStatute: draft.chargeStatute, chargeClass: draft.chargeClass, caseType: draft.caseType, courtDivision: draft.courtDivision, charges: draft._charges || [] })
                  .then(r => setAiChargeAnalysis(p => ({ ...p, loading: false, result: r.result }))).catch(e => setAiChargeAnalysis(p => ({ ...p, loading: false, error: e.message })));
              }}>⚡ Analyze Charges</button>
            </div>

            {aiClientSummary.show && (
              <div style={{ marginBottom: 16 }}>
                <AiPanel title="Client Communication Summary" result={aiClientSummary.result} loading={aiClientSummary.loading} error={aiClientSummary.error}
                  onClose={() => setAiClientSummary({ loading: false, result: null, error: null, show: false })}
                  onRun={() => {
                    setAiClientSummary({ loading: true, result: null, error: null, show: true });
                    apiClientSummary({ caseId: c.id }).then(r => setAiClientSummary(p => ({ ...p, loading: false, result: r.result }))).catch(e => setAiClientSummary(p => ({ ...p, loading: false, error: e.message })));
                  }}
                  actions={aiClientSummary.result ? <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => navigator.clipboard.writeText(aiClientSummary.result)}>Copy</button> : null}
                />
              </div>
            )}

            {aiChargeAnalysis.show && (
              <div style={{ marginBottom: 16 }}>
                <AiPanel title="Charge Analysis" result={aiChargeAnalysis.result} loading={aiChargeAnalysis.loading} error={aiChargeAnalysis.error}
                  onClose={() => setAiChargeAnalysis({ loading: false, result: null, error: null, show: false })}
                  onRun={() => {
                    setAiChargeAnalysis({ loading: true, result: null, error: null, show: true });
                    apiChargeAnalysis({ chargeDescription: draft.chargeDescription, chargeStatute: draft.chargeStatute, chargeClass: draft.chargeClass, caseType: draft.caseType, courtDivision: draft.courtDivision, charges: draft._charges || [] })
                      .then(r => setAiChargeAnalysis(p => ({ ...p, loading: false, result: r.result }))).catch(e => setAiChargeAnalysis(p => ({ ...p, loading: false, error: e.message })));
                  }}
                />
              </div>
            )}

            {/* Two-column: Details + Key Dates */}
            <div className="mobile-grid-1" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 48px", marginBottom: 32 }}>

              <div className="case-overlay-section" style={{ display: "flex", flexDirection: "column" }}>
                <div className="case-overlay-section-title">Case Details</div>
                {detailFields.filter(f => !hiddenFields.includes(f.key)).map(f => (
                  <EditField
                    key={f.key}
                    fieldKey={f.key}
                    label={f.label}
                    type={f.type}
                    options={f.options}
                    value={draft[f.key]}
                    onChange={val => f.type === "select" || f.type === "user" ? setAndLog(f.key, val) : set(f.key, val)}
                    onBlur={() => (f.type === "text") && handleBlur(f.key)}
                    canRemove={editMode && canRemove}
                    onRemove={() => setHiddenFields(p => [...p, f.key])}
                    readOnly={!editMode}
                    onContactClick={!editMode && CONTACT_LINKABLE_KEYS.has(f.key) ? handleContactClick : undefined}
                  />
                ))}
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
                    canRemove={editMode && canRemove}
                    isCustom
                    readOnly={!editMode}
                    onContactClick={!editMode && f.isNameField ? handleContactClick : undefined}
                  />
                ))}
                {editMode && (
                  <div style={{ marginTop: 6 }}>
                    {addingField && (
                      <div style={{ marginBottom: 8 }}>
                        <div className="add-field-row" style={{ marginBottom: 6 }}>
                          <input
                            placeholder="Field name (e.g. Policy Limit)"
                            value={newFieldLabel}
                            onChange={e => setNewFieldLabel(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && addCustomField()}
                            style={{ flex: 1 }}
                            autoFocus
                          />
                          <button className="btn btn-gold" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={addCustomField}>Add</button>
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--c-text2)", cursor: "pointer", paddingLeft: 2 }}>
                          <input type="checkbox" checked={newFieldIsName} onChange={e => setNewFieldIsName(e.target.checked)} />
                          Name field (contact-linkable)
                        </label>
                      </div>
                    )}
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 11, width: "100%" }} onClick={() => setAddingField(s => !s)}>
                      {addingField ? "Cancel" : "+ Add Field"}
                    </button>
                  </div>
                )}
              </div>

              <div className="case-overlay-section" style={{ display: "flex", flexDirection: "column" }}>
                <div className="case-overlay-section-title">Key Dates</div>
                {dateFields.filter(f => !hiddenFields.includes(f.key)).map(f => {
                  const days = draft[f.key] ? daysUntil(draft[f.key]) : null;
                  return (
                    <div key={f.key} className="edit-field">
                      <div className="edit-field-key" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>{f.label}</span>
                        {editMode && canRemove && (
                          <button onClick={() => setHiddenFields(p => [...p, f.key])} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}>✕</button>
                        )}
                      </div>
                      <div className="edit-field-val" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {editMode ? (
                          <input type="date" value={draft[f.key] || ""} onChange={e => set(f.key, e.target.value)} onBlur={() => handleBlur(f.key)} style={{ flex: 1 }} />
                        ) : (
                          <span style={{ fontSize: 13, color: "var(--c-text)", padding: "3px 0" }}>{draft[f.key] ? fmt(draft[f.key]) : "—"}</span>
                        )}
                        {draft[f.key] && days !== null && (
                          <span style={{ fontSize: 11, color: urgencyColor(days), whiteSpace: "nowrap", fontWeight: 600 }}>
                            {days < 0 ? `${Math.abs(days)}d ago` : days === 0 ? "Today" : `${days}d`}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {customDates.map(d => (
                  <div key={d.id} className="edit-field">
                    <div className="edit-field-key" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{d.label}</span>
                      {editMode && (
                        <button onClick={() => removeCustomDate(d.id)} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "0 2px" }}>✕</button>
                      )}
                    </div>
                    <div className="edit-field-val">
                      {editMode ? (
                        <input type="date" value={d.value || ""} onChange={e => updateCustomDate(d.id, e.target.value)} style={{ width: "100%" }} />
                      ) : (
                        <span style={{ fontSize: 13, color: "var(--c-text)", padding: "3px 0" }}>{d.value ? fmt(d.value) : "—"}</span>
                      )}
                    </div>
                  </div>
                ))}
                {editMode && (
                  <div style={{ marginTop: 6 }}>
                    {addingDate && (
                      <div className="add-field-row" style={{ marginBottom: 8 }}>
                        <input
                          placeholder="Date label (e.g. Statute of Limitations)"
                          value={newDateLabel}
                          onChange={e => setNewDateLabel(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && addCustomDate()}
                          style={{ flex: 1 }}
                          autoFocus
                        />
                        <button className="btn btn-gold" style={{ fontSize: 12, whiteSpace: "nowrap" }} onClick={addCustomDate}>Add</button>
                      </div>
                    )}
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 11, width: "100%" }} onClick={() => setAddingDate(s => !s)}>
                      {addingDate ? "Cancel" : "+ Add Date"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--c-border)", margin: "8px 0 32px" }} />

            {/* Three-column: Deadlines | Tasks | Notes */}
            <div className="mobile-grid-1" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.4fr", gap: "0 32px" }}>
              <div className="case-overlay-section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="case-overlay-section-title">Deadlines ({deadlines.length})</div>
                  <button className="btn btn-outline btn-sm" style={{ fontSize: 10, color: "#b8860b", borderColor: "#d4c9a8", padding: "2px 8px" }} onClick={() => {
                    setAiDeadlines({ loading: true, deadlines: null, error: null, show: true });
                    apiDeadlineGenerator({ caseId: c.id, stage: draft.stage, chargeClass: draft.chargeClass, caseType: draft.caseType, courtDivision: draft.courtDivision, arrestDate: draft.arrestDate, arraignmentDate: draft.arraignmentDate, trialDate: draft.trialDate, nextCourtDate: draft.nextCourtDate, existingDeadlines: deadlines.map(d => ({ title: d.title, date: d.date })) })
                      .then(r => setAiDeadlines(p => ({ ...p, loading: false, deadlines: r.deadlines })))
                      .catch(e => setAiDeadlines(p => ({ ...p, loading: false, error: e.message })));
                  }}>⚡ Suggest</button>
                </div>
                {deadlines.length === 0 && !aiDeadlines.show && <div style={{ fontSize: 12, color: "#8A9096" }}>None on record.</div>}
                {[...deadlines].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(d => {
                  const days = daysUntil(d.date); const col = urgencyColor(days);
                  return (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid var(--c-border2)" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: "var(--c-text)" }}>{d.title}</div>
                        {d.type && <div style={{ fontSize: 10, color: "#8A9096" }}>{d.type}</div>}
                      </div>
                      <div style={{ fontSize: 12, color: col, whiteSpace: "nowrap", textAlign: "right" }}>
                        <div>{fmt(d.date)}</div>
                        {days !== null && <div style={{ fontSize: 10 }}>{days < 0 ? `${Math.abs(days)}d over` : `${days}d`}</div>}
                      </div>
                    </div>
                  );
                })}
                {aiDeadlines.show && (
                  <div style={{ marginTop: 8 }}>
                    {aiDeadlines.loading && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", color: "#8A9096", fontSize: 11 }}>
                        <div style={{ width: 14, height: 14, border: "2px solid #d4c9a8", borderTopColor: "#b8860b", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        Generating deadlines...
                      </div>
                    )}
                    {aiDeadlines.error && <div style={{ fontSize: 11, color: "#dc2626", padding: "4px 0" }}>{aiDeadlines.error}</div>}
                    {aiDeadlines.deadlines && aiDeadlines.deadlines.map((d, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px dashed #d4c9a8", fontSize: 11 }}>
                        <span style={{ fontSize: 10, color: "#b8860b" }}>⚡</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: "#1E2A3A", fontWeight: 500 }}>{d.title}</div>
                          <div style={{ color: "#8A9096", fontSize: 10 }}>{d.date} · {d.rule || d.type || ""}</div>
                        </div>
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 9, padding: "1px 6px" }} onClick={() => {
                          onAddDeadline({ caseId: c.id, title: d.title, date: d.date, type: d.type || "Filing", rule: d.rule || "" });
                          setAiDeadlines(p => ({ ...p, deadlines: p.deadlines.filter((_, j) => j !== i) }));
                        }}>+ Add</button>
                      </div>
                    ))}
                    {aiDeadlines.deadlines && aiDeadlines.deadlines.length === 0 && <div style={{ fontSize: 11, color: "#8A9096", padding: "4px 0" }}>No additional deadlines suggested.</div>}
                    {(aiDeadlines.deadlines || aiDeadlines.error) && (
                      <button style={{ fontSize: 10, color: "#8A9096", background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginTop: 4 }} onClick={() => setAiDeadlines({ loading: false, deadlines: null, error: null, show: false })}>Dismiss</button>
                    )}
                  </div>
                )}
              </div>

              <div className="case-overlay-section">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div className="case-overlay-section-title">Tasks ({tasks.filter(t => t.status !== "Completed").length} open)</div>
                  <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px", color: "#b8860b", borderColor: "#d4c9a8" }} disabled={aiTasks.loading} onClick={() => {
                    setAiTasks({ loading: true, tasks: null, error: null, show: true, added: {} });
                    apiTaskSuggestions({ caseId: c.id })
                      .then(r => setAiTasks(p => ({ ...p, loading: false, tasks: r.tasks })))
                      .catch(e => setAiTasks(p => ({ ...p, loading: false, error: e.message })));
                  }}>⚡ Suggest Tasks</button>
                </div>
                {tasks.length === 0 && !aiTasks.show && <div style={{ fontSize: 12, color: "#8A9096" }}>No tasks yet.</div>}
                {tasks.filter(t => t.status !== "Completed").sort((a, b) => {
                  const da = a.due ? new Date(a.due) : new Date("9999-12-31");
                  const db = b.due ? new Date(b.due) : new Date("9999-12-31");
                  return da - db;
                }).map(t => {
                  const days = daysUntil(t.due);
                  const assignee = getUserById(t.assigned);
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--c-border2)" }}>
                      <div className="checkbox" style={{ marginTop: 2 }} onClick={() => handleComplete(t.id)} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--c-text)", lineHeight: 1.3 }}>
                          {t.title}
                          {t.recurring && <span className="rec-badge">🔁</span>}
                          {t.isChained && <span className="chain-badge">⛓</span>}
                        </div>
                        <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                          <Badge label={getEffectivePriority(t)} />
                          <span style={{ fontSize: 10, color: days < 0 ? "#e05252" : "#8A9096" }}>
                            {fmt(t.due)}{days < 0 ? ` (${Math.abs(days)}d over)` : ""}
                          </span>
                          {assignee && (
                            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Avatar userId={assignee.id} size={16} />
                              <span style={{ fontSize: 10, color: "#8A9096" }}>{assignee.name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {tasks.filter(t => t.status === "Completed").length > 0 && (
                  <>
                    <div
                      onClick={() => setShowCompletedOverlay(!showCompletedOverlay)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", cursor: "pointer", borderBottom: "1px solid var(--c-border2)" }}
                    >
                      <span style={{ fontSize: 12, color: "#8A9096" }}>{showCompletedOverlay ? "▼" : "▶"}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text2)" }}>Completed</span>
                      <Badge label={`${tasks.filter(t => t.status === "Completed").length}`} />
                    </div>
                    {showCompletedOverlay && tasks.filter(t => t.status === "Completed").sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0)).map(t => {
                      const assignee = getUserById(t.assigned);
                      return (
                        <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--c-border2)", opacity: 0.45 }}>
                          <div className="checkbox done" style={{ marginTop: 2 }} onClick={() => handleComplete(t.id)}>✓</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: "var(--c-text)", textDecoration: "line-through", lineHeight: 1.3 }}>
                              {t.title}
                              {t.recurring && <span className="rec-badge">🔁</span>}
                              {t.isChained && <span className="chain-badge">⛓</span>}
                            </div>
                            <div style={{ display: "flex", gap: 5, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                              <Badge label={getEffectivePriority(t)} />
                              <span style={{ fontSize: 10, color: "#8A9096" }}>
                                {fmt(t.due)}
                              </span>
                              {assignee && (
                                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <Avatar userId={assignee.id} size={16} />
                                  <span style={{ fontSize: 10, color: "#8A9096" }}>{assignee.name}</span>
                                </span>
                              )}
                              {t.completedAt && <span style={{ fontSize: 10, color: "#2F7A5F" }}>completed {fmt(t.completedAt)}</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                {aiTasks.show && (
                  <div style={{ marginTop: 8, borderTop: "1px dashed #d4c9a8", paddingTop: 8 }}>
                    {aiTasks.loading && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", color: "#8A9096", fontSize: 11 }}>
                        <div style={{ width: 14, height: 14, border: "2px solid #d4c9a8", borderTopColor: "#b8860b", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        Analyzing case for task suggestions...
                      </div>
                    )}
                    {aiTasks.error && <div style={{ fontSize: 11, color: "#dc2626", padding: "4px 0" }}>{aiTasks.error}</div>}
                    {aiTasks.tasks && aiTasks.tasks.length > 0 && (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#b8860b" }}>⚡ Suggested Tasks ({aiTasks.tasks.length})</div>
                          {aiTasks.tasks.some((_, i) => !aiTasks.added[i]) && (
                            <button className="btn btn-outline btn-sm" style={{ fontSize: 9, padding: "1px 6px", color: "#b8860b", borderColor: "#d4c9a8" }} onClick={async () => {
                              const toAdd = aiTasks.tasks.filter((_, i) => !aiTasks.added[i]);
                              const newAdded = { ...aiTasks.added };
                              for (let i = 0; i < aiTasks.tasks.length; i++) {
                                if (!aiTasks.added[i]) {
                                  const s = aiTasks.tasks[i];
                                  const dueDate = s.dueInDays ? new Date(Date.now() + s.dueInDays * 86400000).toISOString().split("T")[0] : null;
                                  try {
                                    const saved = await apiCreateTask({ caseId: c.id, title: s.title, priority: s.priority || "Medium", assignedRole: s.assignedRole || "", due: dueDate, notes: s.rationale || "", isGenerated: true });
                                    if (onAddTask) onAddTask(saved);
                                    newAdded[i] = true;
                                  } catch (err) { console.error(err); }
                                }
                              }
                              setAiTasks(p => ({ ...p, added: newAdded }));
                              log("AI Tasks Added", `${toAdd.length} suggested tasks added`);
                            }}>+ Add All</button>
                          )}
                        </div>
                        {aiTasks.tasks.map((s, i) => {
                          const isAdded = aiTasks.added[i];
                          const priorityColors = { Urgent: "#e05252", High: "#e88c30", Medium: "#b8860b", Low: "#2F7A5F" };
                          return (
                            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0", borderBottom: "1px dashed #d4c9a8", opacity: isAdded ? 0.45 : 1 }}>
                              <span style={{ fontSize: 10, color: "#b8860b", marginTop: 2 }}>{isAdded ? "✓" : "⚡"}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, color: "#1E2A3A", fontWeight: 500 }}>{s.title}</div>
                                <div style={{ display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                                  <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: (priorityColors[s.priority] || "#b8860b") + "18", color: priorityColors[s.priority] || "#b8860b" }}>{s.priority}</span>
                                  {s.assignedRole && <span style={{ fontSize: 9, color: "#8A9096" }}>{s.assignedRole}</span>}
                                  {s.dueInDays && <span style={{ fontSize: 9, color: "#8A9096" }}>· {s.dueInDays}d</span>}
                                </div>
                                {s.rationale && <div style={{ fontSize: 10, color: "#8A9096", marginTop: 2, lineHeight: 1.3 }}>{s.rationale}</div>}
                              </div>
                              {!isAdded && (
                                <button className="btn btn-outline btn-sm" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }} onClick={async () => {
                                  const dueDate = s.dueInDays ? new Date(Date.now() + s.dueInDays * 86400000).toISOString().split("T")[0] : null;
                                  try {
                                    const saved = await apiCreateTask({ caseId: c.id, title: s.title, priority: s.priority || "Medium", assignedRole: s.assignedRole || "", due: dueDate, notes: s.rationale || "", isGenerated: true });
                                    if (onAddTask) onAddTask(saved);
                                    setAiTasks(p => ({ ...p, added: { ...p.added, [i]: true } }));
                                    log("AI Task Added", s.title);
                                  } catch (err) { alert("Failed to add task: " + err.message); }
                                }}>+ Add</button>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )}
                    {aiTasks.tasks && aiTasks.tasks.length === 0 && <div style={{ fontSize: 11, color: "#8A9096", padding: "4px 0" }}>No additional tasks suggested.</div>}
                    {(aiTasks.tasks || aiTasks.error) && (
                      <button style={{ fontSize: 10, color: "#8A9096", background: "none", border: "none", cursor: "pointer", padding: "4px 0", marginTop: 4 }} onClick={() => setAiTasks({ loading: false, tasks: null, error: null, show: false, added: {} })}>Dismiss</button>
                    )}
                  </div>
                )}
              </div>

              <div className="case-overlay-section">
                <CaseNotes caseId={c.id} notes={notes} currentUser={currentUser} onAddNote={handleAddNote} onDeleteNote={handleDeleteNote} onUpdateNote={handleUpdateNote} caseRecord={c} />
              </div>
            </div>

            {/* File Links */}
            <div style={{ borderTop: "1px solid var(--c-border)", marginTop: 8, paddingTop: 28 }}>
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

        {/* ── Details Tab ── */}
        {activeTab === "details" && (
          <div className="case-overlay-body">

            {/* Two-column: Charges + Case Info */}
            <div className="mobile-grid-1" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 48px", marginBottom: 32 }}>

              {/* Left column: Charges */}
              <div className="case-overlay-section" style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div className="case-overlay-section-title" style={{ marginBottom: 0 }}>Charges</div>
                  <button className="btn btn-sm" style={{ fontSize: 12, padding: "4px 12px", background: "#1E2A3A", color: "#fff", border: "none", borderRadius: 5 }}
                    onClick={() => {
                      const newCharge = { id: Date.now(), statute: "", description: "", chargeClass: "", originalOrAmended: "Original", disposition: "", dispositionDate: "" };
                      onUpdate({ charges: [...(c.charges || []), newCharge] });
                    }}>+ Add Charge</button>
                </div>
                {(!c.charges || c.charges.length === 0) && <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic" }}>No charges added yet.</div>}
                {(c.charges || []).map((charge, idx) => (
                  <div key={charge.id || idx} style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginBottom: 8, padding: "12px 14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)" }}>
                          {charge.description || "Untitled Charge"}{charge.statute ? ` (§${charge.statute})` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          {charge.chargeClass && <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: /Felony/.test(charge.chargeClass) ? "#FDECEA" : "#E8F4FD", color: /Felony/.test(charge.chargeClass) ? "#9A3030" : "#1A6FA0", fontWeight: 600 }}>{charge.chargeClass}</span>}
                          {charge.originalOrAmended && <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: "#EDEFF2", color: "#5D6268", fontWeight: 600 }}>{charge.originalOrAmended}</span>}
                          {charge.disposition && <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 4, background: "#EAF5EA", color: "#2F6A3A", fontWeight: 600 }}>{charge.disposition}</span>}
                        </div>
                      </div>
                      <button style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", fontSize: 14 }}
                        onClick={() => onUpdate({ charges: (c.charges || []).filter((_, i) => i !== idx) })}>✕</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginTop: 8 }}>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Statute</label>
                        <input style={{ width: "100%", fontSize: 13, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }}
                          value={charge.statute} onChange={e => { const updated = [...(c.charges || [])]; updated[idx] = { ...charge, statute: e.target.value }; onUpdate({ charges: updated }); }} onBlur={() => {
                            if ((charge.statute || charge.description) && !charge.chargeClass) {
                              setClassifyingChargeIdx(idx);
                              apiGetChargeClass({ statute: charge.statute, description: charge.description }).then(r => {
                                const cur = chargesRef.current || []; if (cur[idx] && !cur[idx].chargeClass) { const updated = [...cur]; updated[idx] = { ...updated[idx], chargeClass: r.chargeClass }; onUpdate({ ...c, charges: updated }); }
                              }).catch(() => {}).finally(() => setClassifyingChargeIdx(null));
                            }
                          }} /></div>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Description</label>
                        <input style={{ width: "100%", fontSize: 13, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }}
                          value={charge.description} onChange={e => { const updated = [...(c.charges || [])]; updated[idx] = { ...charge, description: e.target.value }; onUpdate({ charges: updated }); }} onBlur={() => {
                            if ((charge.statute || charge.description) && !charge.chargeClass) {
                              setClassifyingChargeIdx(idx);
                              apiGetChargeClass({ statute: charge.statute, description: charge.description }).then(r => {
                                const cur = chargesRef.current || []; if (cur[idx] && !cur[idx].chargeClass) { const updated = [...cur]; updated[idx] = { ...updated[idx], chargeClass: r.chargeClass }; onUpdate({ ...c, charges: updated }); }
                              }).catch(() => {}).finally(() => setClassifyingChargeIdx(null));
                            }
                          }} /></div>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Class {classifyingChargeIdx === idx && <span style={{ fontSize: 10, color: "#b8860b" }}>(classifying...)</span>}</label>
                        <select style={{ width: "100%", fontSize: 13, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }}
                          value={charge.chargeClass} onChange={e => { const updated = [...(c.charges || [])]; updated[idx] = { ...charge, chargeClass: e.target.value }; onUpdate({ charges: updated }); }}>
                          <option value="">— Select —</option>
                          {["Class A Felony", "Class B Felony", "Class C Felony", "Misdemeanor A", "Misdemeanor B", "Misdemeanor C", "Violation", "Other"].map(o => <option key={o} value={o}>{o}</option>)}
                        </select></div>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Original / Amended</label>
                        <select style={{ width: "100%", fontSize: 13, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }}
                          value={charge.originalOrAmended} onChange={e => { const updated = [...(c.charges || [])]; updated[idx] = { ...charge, originalOrAmended: e.target.value }; onUpdate({ charges: updated }); }}>
                          <option value="Original">Original</option>
                          <option value="Amended">Amended</option>
                        </select></div>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Disposition</label>
                        <select style={{ width: "100%", fontSize: 13, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }}
                          value={charge.disposition} onChange={e => { const updated = [...(c.charges || [])]; updated[idx] = { ...charge, disposition: e.target.value }; onUpdate({ charges: updated }); }}>
                          <option value="">— None —</option>
                          {["Guilty Plea", "Not Guilty Verdict", "Nolle Prosequi", "Dismissed", "Acquitted", "Convicted"].map(o => <option key={o} value={o}>{o}</option>)}
                        </select></div>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", display: "block", marginBottom: 2 }}>Disposition Date</label>
                        <input type="date" style={{ width: "100%", fontSize: 13, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }}
                          value={charge.dispositionDate} onChange={e => { const updated = [...(c.charges || [])]; updated[idx] = { ...charge, dispositionDate: e.target.value }; onUpdate({ charges: updated }); }} /></div>
                    </div>
                  </div>
                ))}
              </div>


              {/* Right column: Case Info + Offices */}
              <div className="case-overlay-section" style={{ display: "flex", flexDirection: "column" }}>
                <div className="case-overlay-section-title">Case Info</div>
                {infoFields.filter(f => !hiddenFields.includes(f.key)).map(f => (
                  <EditField
                    key={f.key}
                    fieldKey={f.key}
                    label={f.label}
                    type={f.type}
                    options={f.options}
                    value={draft[f.key]}
                    onChange={val => f.type === "select" || f.type === "user" ? setAndLog(f.key, val) : set(f.key, val)}
                    onBlur={() => (f.type === "text") && handleBlur(f.key)}
                    canRemove={editMode && canRemove}
                    onRemove={() => setHiddenFields(p => [...p, f.key])}
                    readOnly={!editMode}
                    onContactClick={!editMode && CONTACT_LINKABLE_KEYS.has(f.key) ? handleContactClick : undefined}
                  />
                ))}

              </div>

            </div>

            <div style={{ borderTop: "1px solid var(--c-border)", margin: "8px 0 32px" }} />

            <div className="mobile-grid-1" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 48px", marginBottom: 32 }}>

              {/* Experts */}
              <div className="case-overlay-section" style={{ display: "flex", flexDirection: "column" }}>
              <div className="case-overlay-section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Experts ({experts.length})</span>
                <button className="btn btn-sm" style={{ background: "#1E2A3A", color: "#fff", border: "1px solid #1E2A3A", fontSize: 11, padding: "2px 10px" }} onClick={() => setAddingExpert(true)}>+ Add Expert</button>
              </div>

              {addingExpert && (
                <div style={{ background: "var(--c-bg2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 12 }}>New Expert</div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Expert Type</label>
                    <select value={newExpertType} onChange={e => setNewExpertType(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "6px 8px" }}>
                      {["Treating Physician", "Retained", "Rebuttal"].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => { setAddingExpert(false); setNewExpertType("Treating Physician"); }}>Cancel</button>
                    <button className="btn btn-sm" style={{ background: "#1E2A3A", color: "#fff", border: "1px solid #1E2A3A" }} onClick={async () => {
                      try {
                        const saved = await apiCreateExpert({ caseId: c.id, expertType: newExpertType, data: {} });
                        setExperts(p => [...p, saved]);
                        setAddingExpert(false);
                        setExpandedExpert(saved.id);
                        log("Expert Added", `Added ${newExpertType} expert`);
                        setNewExpertType("Treating Physician");
                      } catch (err) { alert("Failed to add expert: " + err.message); }
                    }}>Add</button>
                  </div>
                </div>
              )}

              {expertsLoading && <div style={{ fontSize: 13, color: "#8A9096", padding: "12px 0" }}>Loading experts...</div>}

              {!expertsLoading && experts.length === 0 && !addingExpert && (
                <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic", padding: "12px 0" }}>No experts added yet.</div>
              )}

              {!expertsLoading && experts.map(exp => {
                const isExp = expandedExpert === exp.id;
                const d = exp.data || {};
                const displayName = d.fullName || "Unnamed Expert";
                const EXPERT_TYPE_COLORS = {
                  "Treating Physician": { bg: "#E6F5ED", text: "#2F6A3A" },
                  "Retained": { bg: "#E8F0FD", text: "#1A5FA0" },
                  "Rebuttal": { bg: "#FDF0E6", text: "#8A5A1E" },
                };
                const typeColor = EXPERT_TYPE_COLORS[exp.expertType] || { bg: "#EDEFF2", text: "#5D6268" };

                const updateField = (field, value) => {
                  const newData = { ...(expertPendingData.current[exp.id] || d), [field]: value };
                  expertPendingData.current[exp.id] = newData;
                  setExperts(p => p.map(x => x.id === exp.id ? { ...x, data: newData } : x));
                  const timerKey = `${exp.id}`;
                  if (expertTimers.current[timerKey]) clearTimeout(expertTimers.current[timerKey]);
                  expertTimers.current[timerKey] = setTimeout(async () => {
                    const dataToSave = expertPendingData.current[exp.id];
                    delete expertPendingData.current[exp.id];
                    try { await apiUpdateExpert(exp.id, { data: dataToSave }); } catch (err) { console.error(err); }
                  }, 600);
                };

                const handleNameBlur = async () => {
                  const name = (d.fullName || "").trim();
                  if (!name || d.contactId) return;
                  const match = allContacts.find(ct => ct.category === "Expert" && ct.name.toLowerCase() === name.toLowerCase() && !ct.deletedAt);
                  if (match) {
                    updateField("contactId", match.id);
                    updateField("phone", match.phone || d.phone || "");
                    updateField("email", match.email || d.email || "");
                    updateField("fax", match.fax || d.fax || "");
                    updateField("address", match.address || d.address || "");
                    updateField("company", match.company || d.company || "");
                  } else if (name) {
                    try {
                      const created = await apiCreateContact({ name, category: "Expert", phone: d.phone || "", email: d.email || "", fax: d.fax || "", address: d.address || "", company: d.company || "" });
                      updateField("contactId", created.id);
                      setAllContacts(prev => [...prev, created]);
                    } catch (err) { console.error("Failed to create expert contact:", err); }
                  }
                };

                const syncContactFromExpert = async (field, value) => {
                  updateField(field, value);
                  if (d.contactId) {
                    const contactField = field;
                    try {
                      await apiUpdateContact(d.contactId, { [contactField]: value });
                      setAllContacts(prev => prev.map(ct => ct.id === d.contactId ? { ...ct, [contactField]: value } : ct));
                    } catch (err) { console.error(err); }
                  }
                };

                const inputStyle = { width: "100%", fontSize: 13, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" };
                const labelStyle = { fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 3 };
                const fieldGroup = { marginBottom: 10 };

                const partyOptions = parties.map(p => {
                  const pd = p.data || {};
                  const pName = p.entityKind === "corporation" ? (pd.entityName || "Unnamed Entity") : [pd.firstName, pd.lastName].filter(Boolean).join(" ") || "Unnamed Party";
                  return { value: `${p.partyType}: ${pName}`, label: `${p.partyType}: ${pName}` };
                });

                return (
                  <div key={exp.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                    <div
                      onClick={() => setExpandedExpert(isExp ? null : exp.id)}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", cursor: "pointer", background: isExp ? "var(--c-bg2)" : "transparent" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 14 }}>🩺</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)" }}>{displayName}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: typeColor.bg, color: "#1F2428", letterSpacing: "0.02em" }}>{exp.expertType}</span>
                            {d.company && <span style={{ fontSize: 11, color: "#8A9096" }}>· {d.company}</span>}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: "#8A9096" }}>{isExp ? "▲" : "▼"}</span>
                    </div>

                    {isExp && (
                      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--c-border)" }}>
                        <div style={fieldGroup}>
                          <label style={labelStyle}>Full Name</label>
                          <input
                            style={{ ...inputStyle, fontWeight: 600 }}
                            value={d.fullName || ""}
                            placeholder="Enter expert's full name"
                            onChange={e => { updateField("fullName", e.target.value); if (d.contactId) updateField("contactId", null); }}
                            onBlur={handleNameBlur}
                          />
                          {d.contactId && <div style={{ fontSize: 10, color: "#2F7A5F", marginTop: 2 }}>Linked to contact card</div>}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Company / Practice</label>
                            <input style={inputStyle} value={d.company || ""} placeholder="Company or practice name" onChange={e => syncContactFromExpert("company", e.target.value)} />
                          </div>
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Specialty / Area of Expertise</label>
                            <input style={inputStyle} value={d.specialty || ""} placeholder="e.g., Orthopedic Surgery" onChange={e => updateField("specialty", e.target.value)} />
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={d.phone || ""} onChange={e => syncContactFromExpert("phone", e.target.value)} /></div>
                          <div><label style={labelStyle}>Fax</label><input style={inputStyle} value={d.fax || ""} onChange={e => syncContactFromExpert("fax", e.target.value)} /></div>
                        </div>
                        <div style={fieldGroup}>
                          <label style={labelStyle}>Email</label>
                          <input style={inputStyle} value={d.email || ""} onChange={e => syncContactFromExpert("email", e.target.value)} />
                        </div>
                        <div style={fieldGroup}>
                          <label style={labelStyle}>Address</label>
                          <input style={inputStyle} value={d.address || ""} onChange={e => syncContactFromExpert("address", e.target.value)} />
                        </div>

                        <div style={{ borderTop: "1px solid var(--c-border)", margin: "10px 0", paddingTop: 10 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div style={fieldGroup}>
                              <label style={labelStyle}>Assigned Party</label>
                              <select style={inputStyle} value={d.assignedParty || ""} onChange={e => updateField("assignedParty", e.target.value)}>
                                <option value="">— None —</option>
                                {partyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            <div style={fieldGroup}>
                              <label style={labelStyle}>Testimony</label>
                              <select style={inputStyle} value={d.testimony || ""} onChange={e => updateField("testimony", e.target.value)}>
                                <option value="">— Select —</option>
                                <option value="Deposition">Deposition</option>
                                <option value="Live Testimony">Live Testimony</option>
                                <option value="Both">Both</option>
                              </select>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div style={fieldGroup}><label style={labelStyle}>Rate</label><input style={inputStyle} value={d.rate || ""} placeholder="Hourly/deposition/trial rates" onChange={e => updateField("rate", e.target.value)} /></div>
                            <div style={fieldGroup}>
                              <label style={labelStyle}>CV / Resume Link</label>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input style={{ ...inputStyle, flex: 1 }} value={d.cvLink || ""} placeholder="https://..." onChange={e => updateField("cvLink", e.target.value)} />
                                {d.cvLink && <a href={d.cvLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--c-accent)", whiteSpace: "nowrap" }}>Open</a>}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div style={fieldGroup}><label style={labelStyle}>Retained Date</label><input type="date" style={inputStyle} value={d.retainedDate || ""} onChange={e => updateField("retainedDate", e.target.value)} /></div>
                            <div style={fieldGroup}><label style={labelStyle}>Report Date</label><input type="date" style={inputStyle} value={d.reportDate || ""} onChange={e => updateField("reportDate", e.target.value)} /></div>
                            <div style={fieldGroup}><label style={labelStyle}>Deposition Date</label><input type="date" style={inputStyle} value={d.depositionDate || ""} onChange={e => updateField("depositionDate", e.target.value)} /></div>
                          </div>
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Notes</label>
                            <textarea
                              style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                              value={d.notes || ""}
                              placeholder="Notes about this expert..."
                              onChange={e => updateField("notes", e.target.value)}
                            />
                          </div>
                        </div>

                        <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 10, display: "flex", justifyContent: "flex-end" }}>
                          <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#e05252", borderColor: "#e05252" }} onClick={async () => {
                            if (!window.confirm(`Remove ${displayName} (${exp.expertType}) from this case?`)) return;
                            try {
                              await apiDeleteExpert(exp.id);
                              setExperts(p => p.filter(x => x.id !== exp.id));
                              setExpandedExpert(null);
                              log("Expert Removed", `Removed ${exp.expertType}: ${displayName}`);
                            } catch (err) { alert("Failed: " + err.message); }
                          }}>Remove Expert</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>


              {/* Co-Defendants Section */}
              <div style={{ marginTop: 32, borderTop: "2px solid var(--c-border)", paddingTop: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  {(() => { const coDefs = parties.filter(p => (p.party_type || p.partyType) === "Co-Defendant"); return <div className="case-overlay-section-title" style={{ marginBottom: 0 }}>Co-Defendant(s) ({coDefs.length})</div>; })()}
                  <button className="btn btn-sm" style={{ background: "#1E2A3A", color: "#fff", border: "1px solid #1E2A3A", fontSize: 11, padding: "2px 10px" }} onClick={() => { setAddingParty(true); setNewCoDefFirst(""); setNewCoDefMiddle(""); setNewCoDefLast(""); }}>+ Add Co-Defendant</button>
                </div>

                {addingParty && (
                  <div style={{ background: "var(--c-bg2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: 16, marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 12 }}>New Co-Defendant</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>First Name</label>
                        <input type="text" placeholder="First name" value={newCoDefFirst} onChange={e => setNewCoDefFirst(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "6px 8px" }} /></div>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Middle Name</label>
                        <input type="text" placeholder="Middle" value={newCoDefMiddle} onChange={e => setNewCoDefMiddle(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "6px 8px" }} /></div>
                      <div><label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Last Name</label>
                        <input type="text" placeholder="Last name" value={newCoDefLast} onChange={e => setNewCoDefLast(e.target.value)} style={{ width: "100%", fontSize: 13, padding: "6px 8px" }} /></div>
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => { setAddingParty(false); setNewCoDefFirst(""); setNewCoDefMiddle(""); setNewCoDefLast(""); }}>Cancel</button>
                      <button className="btn btn-sm" style={{ background: "#1E2A3A", color: "#fff", border: "1px solid #1E2A3A" }} onClick={async () => {
                        const fullName = [newCoDefFirst, newCoDefMiddle, newCoDefLast].filter(Boolean).join(" ") || "Unnamed";
                        try {
                          const saved = await apiCreateParty({ caseId: c.id, partyType: "Co-Defendant", entityKind: "individual", data: { firstName: newCoDefFirst, middleName: newCoDefMiddle, lastName: newCoDefLast } });
                          setParties(p => [...p, saved]);
                          setAddingParty(false);
                          setNewCoDefFirst(""); setNewCoDefMiddle(""); setNewCoDefLast("");
                          setExpandedParty(saved.id);
                          log("Co-Defendant Added", fullName);
                        } catch (err) { alert("Failed to add co-defendant: " + err.message); }
                      }}>Add</button>
                    </div>
                  </div>
                )}

                {partiesLoading && <div style={{ fontSize: 13, color: "#8A9096", padding: "12px 0" }}>Loading co-defendants...</div>}
                {!partiesLoading && parties.filter(p => (p.party_type || p.partyType) === "Co-Defendant").length === 0 && !addingParty && (
                  <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic", padding: "12px 0" }}>No co-defendants added yet.</div>
                )}

                {!partiesLoading && parties.filter(p => (p.party_type || p.partyType) === "Co-Defendant").map(party => {
                  const isExp = expandedParty === party.id;
                  const d = party.data || {};
                  const displayName = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ") || "Unnamed Co-Defendant";

                  const STATUS_COLORS = {
                    "Pre-Trial": { bg: "#FDF0E6", text: "#8A5A1E" },
                    "Pled Out": { bg: "#EAF5EA", text: "#2F6A3A" },
                    "Convicted": { bg: "#FDECEA", text: "#9A3030" },
                    "Acquitted": { bg: "#E8F4FD", text: "#1A6FA0" },
                    "Charges Dismissed": { bg: "#E8F4FD", text: "#1A6FA0" },
                    "Cooperating Witness": { bg: "#FFF3CD", text: "#856404" },
                    "Fugitive": { bg: "#FDECEA", text: "#9A3030" },
                  };
                  const statusColor = STATUS_COLORS[d.status] || { bg: "#EDEFF2", text: "#5D6268" };

                  const updateField = (field, value) => {
                    const newData = { ...(partyPendingData.current[party.id] || d), [field]: value };
                    partyPendingData.current[party.id] = newData;
                    setParties(p => p.map(x => x.id === party.id ? { ...x, data: newData } : x));
                    const timerKey = `${party.id}`;
                    if (partyTimers.current[timerKey]) clearTimeout(partyTimers.current[timerKey]);
                    partyTimers.current[timerKey] = setTimeout(async () => {
                      const dataToSave = partyPendingData.current[party.id];
                      delete partyPendingData.current[party.id];
                      try { await apiUpdateParty(party.id, { data: dataToSave }); } catch (err) { console.error(err); }
                    }, 600);
                  };

                  const inputStyle = { width: "100%", fontSize: 13, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" };
                  const labelStyle = { fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 3 };
                  const fieldGroup = { marginBottom: 10 };

                  return (
                    <div key={party.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                      <div
                        onClick={() => setExpandedParty(isExp ? null : party.id)}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", cursor: "pointer", background: isExp ? "var(--c-bg2)" : "transparent" }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 14 }}>👤</span>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)" }}>{displayName}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                              {d.status && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: statusColor.bg, color: "#1F2428", letterSpacing: "0.02em" }}>{d.status}</span>}
                              {d.jointSevered && <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: "#EDEFF2", color: "#5D6268" }}>{d.jointSevered}</span>}
                              {d.attorney && <span style={{ fontSize: 11, color: "#8A9096" }}>· Atty: {d.attorney}</span>}
                            </div>
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: "#8A9096" }}>{isExp ? "▲" : "▼"}</span>
                      </div>

                      {isExp && (
                        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--c-border)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div style={fieldGroup}><label style={labelStyle}>First Name</label><input style={inputStyle} value={d.firstName || ""} onChange={e => updateField("firstName", e.target.value)} /></div>
                            <div style={fieldGroup}><label style={labelStyle}>Middle Name</label><input style={inputStyle} value={d.middleName || ""} onChange={e => updateField("middleName", e.target.value)} /></div>
                            <div style={fieldGroup}><label style={labelStyle}>Last Name</label><input style={inputStyle} value={d.lastName || ""} onChange={e => updateField("lastName", e.target.value)} /></div>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, marginBottom: 10 }}>
                            <div style={fieldGroup}><label style={labelStyle}>Date of Birth</label><input type="date" style={inputStyle} value={d.dob || ""} onChange={e => updateField("dob", e.target.value)} /></div>
                            <div style={fieldGroup}><label style={labelStyle}>Case Number</label><input style={inputStyle} value={d.caseNumber || ""} placeholder="Their case number, if known" onChange={e => updateField("caseNumber", e.target.value)} /></div>
                          </div>
                          <div style={fieldGroup}><label style={labelStyle}>Charges</label><input style={inputStyle} value={d.charges || ""} placeholder="What they are charged with" onChange={e => updateField("charges", e.target.value)} /></div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div style={fieldGroup}><label style={labelStyle}>Attorney / Represented By</label><input style={inputStyle} value={d.attorney || ""} placeholder="Attorney name" onChange={e => updateField("attorney", e.target.value)} /></div>
                            <div style={fieldGroup}>
                              <label style={labelStyle}>Status</label>
                              <select style={inputStyle} value={d.status || ""} onChange={e => updateField("status", e.target.value)}>
                                <option value="">— Unknown —</option>
                                {["Pre-Trial", "Pled Out", "Convicted", "Acquitted", "Charges Dismissed", "Cooperating Witness", "Fugitive"].map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>
                          </div>
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Joint / Severed</label>
                            <select style={inputStyle} value={d.jointSevered || ""} onChange={e => updateField("jointSevered", e.target.value)}>
                              <option value="">— Select —</option>
                              {["Joint", "Severed", "Pending Severance Motion"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </div>
                          <div style={fieldGroup}><label style={labelStyle}>Cooperation Notes</label>
                            <textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical", fontFamily: "inherit" }} value={d.cooperationNotes || ""} placeholder="Is this person cooperating with the state? Potential witness against our client?" onChange={e => updateField("cooperationNotes", e.target.value)} />
                          </div>
                          <div style={fieldGroup}><label style={labelStyle}>Notes</label>
                            <textarea style={{ ...inputStyle, minHeight: 50, resize: "vertical", fontFamily: "inherit" }} value={d.notes || ""} placeholder="General notes about this co-defendant..." onChange={e => updateField("notes", e.target.value)} />
                          </div>
                          <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 10, display: "flex", justifyContent: "flex-end" }}>
                            <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#e05252", borderColor: "#e05252" }} onClick={async () => {
                              if (!window.confirm(`Remove co-defendant ${displayName} from this case?`)) return;
                              try {
                                await apiDeleteParty(party.id);
                                setParties(p => p.filter(x => x.id !== party.id));
                                setExpandedParty(null);
                                log("Co-Defendant Removed", displayName);
                              } catch (err) { alert("Failed: " + err.message); }
                            }}>Remove Co-Defendant</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, fontWeight: 600, color: "var(--c-text-h)" }}>Miscellaneous Contacts</div>
                  <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={() => setAddingMiscContact(true)}>+ Add</button>
                </div>

              {addingMiscContact && (
                <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, padding: 12, marginBottom: 10, background: "var(--c-bg2)" }}>
                  <label style={{ fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 3 }}>Contact Type</label>
                  <select style={{ width: "100%", fontSize: 13, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box", marginBottom: 10 }} value={newMiscContactType} onChange={e => setNewMiscContactType(e.target.value)}>
                    {["Police Officer","Witness","Consultant","Investigator","Process Server","Court Reporter","Guardian ad Litem","Mediator","Other"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => { setAddingMiscContact(false); setNewMiscContactType("Other"); }}>Cancel</button>
                    <button className="btn btn-gold btn-sm" onClick={async () => {
                      try {
                        const created = await apiCreateMiscContact({ caseId: c.id, contactType: newMiscContactType, data: {} });
                        setMiscContacts(p => [...p, created]);
                        setExpandedMiscContact(created.id);
                        setAddingMiscContact(false);
                        log("Misc Contact Added", `Added ${newMiscContactType} contact`);
                        setNewMiscContactType("Other");
                      } catch (err) { alert("Failed to add contact: " + err.message); }
                    }}>Add</button>
                  </div>
                </div>
              )}

              {miscContactsLoading && <div style={{ fontSize: 13, color: "#8A9096", padding: "12px 0" }}>Loading contacts...</div>}

              {!miscContactsLoading && miscContacts.length === 0 && !addingMiscContact && (
                <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic", padding: "12px 0" }}>No miscellaneous contacts added yet.</div>
              )}

              {!miscContactsLoading && miscContacts.map(mc => {
                const isExp = expandedMiscContact === mc.id;
                const d = mc.data || {};
                const displayName = d.name || "Unnamed Contact";
                const MISC_TYPE_COLORS = {
                  "Police Officer": { bg: "#E0ECFF", text: "#1A4D8F" },
                  "Witness": { bg: "#FFF3E0", text: "#8A5A1E" },
                  "Consultant": { bg: "#E6F5ED", text: "#2F6A3A" },
                  "Investigator": { bg: "#F3E8FF", text: "#6B21A8" },
                  "Process Server": { bg: "#E8F0FD", text: "#1A5FA0" },
                  "Court Reporter": { bg: "#FDE8E8", text: "#9B2C2C" },
                  "Guardian ad Litem": { bg: "#E0F7FA", text: "#00695C" },
                  "Mediator": { bg: "#FFF8E1", text: "#F57F17" },
                };
                const typeColor = MISC_TYPE_COLORS[mc.contactType] || { bg: "#EDEFF2", text: "#5D6268" };

                const updateField = (field, value) => {
                  const newData = { ...(miscContactPendingData.current[mc.id] || d), [field]: value };
                  miscContactPendingData.current[mc.id] = newData;
                  setMiscContacts(p => p.map(x => x.id === mc.id ? { ...x, data: newData } : x));
                  const timerKey = `${mc.id}`;
                  if (miscContactTimers.current[timerKey]) clearTimeout(miscContactTimers.current[timerKey]);
                  miscContactTimers.current[timerKey] = setTimeout(async () => {
                    const dataToSave = miscContactPendingData.current[mc.id];
                    delete miscContactPendingData.current[mc.id];
                    try { await apiUpdateMiscContact(mc.id, { data: dataToSave }); } catch (err) { console.error(err); }
                  }, 600);
                };

                const handleMiscNameBlur = async () => {
                  const name = (miscContactPendingData.current[mc.id]?.name || d.name || "").trim();
                  if (!name) return;
                  const existing = allContacts.find(c => c.category === "Miscellaneous" && c.name.toLowerCase() === name.toLowerCase());
                  if (existing) {
                    updateField("contactId", existing.id);
                  } else {
                    try {
                      const created = await apiCreateContact({ name, category: "Miscellaneous", phone: d.phone || "", email: d.email || "", address: d.address || "", company: d.company || "" });
                      setAllContacts(p => [...p, created]);
                      updateField("contactId", created.id);
                    } catch (err) { console.error("Failed to create misc contact card:", err); }
                  }
                };

                const syncMiscContactCard = async (field, value) => {
                  updateField(field, value);
                  const cId = miscContactPendingData.current[mc.id]?.contactId || d.contactId;
                  if (cId) {
                    const contact = allContacts.find(c => c.id === cId);
                    if (contact) {
                      const updated = { ...contact, [field]: value };
                      setAllContacts(p => p.map(c => c.id === cId ? updated : c));
                      try { await apiUpdateContact(cId, updated); } catch {}
                    }
                  }
                };

                const inputStyle = { width: "100%", fontSize: 13, padding: "5px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" };
                const labelStyle = { fontSize: 11, color: "var(--c-text3)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 3 };
                const fieldGroup = { marginBottom: 10 };

                const assocOptions = [];
                parties.forEach(p => {
                  const pd = p.data || {};
                  const pName = p.entityKind === "corporation" ? (pd.entityName || "Unnamed Entity") : [pd.firstName, pd.lastName].filter(Boolean).join(" ") || "Unnamed Party";
                  assocOptions.push({ type: "party", id: p.id, label: `Party: ${pName} (${p.partyType})`, name: pName });
                });
                experts.forEach(ex => {
                  const eName = ex.data?.fullName || "Unnamed Expert";
                  assocOptions.push({ type: "expert", id: ex.id, label: `Expert: ${eName} (${ex.expertType})`, name: eName });
                });
                miscContacts.filter(x => x.id !== mc.id).forEach(x => {
                  const xName = x.data?.name || "Unnamed Contact";
                  assocOptions.push({ type: "misc", id: x.id, label: `Contact: ${xName} (${x.contactType})`, name: xName });
                });

                const assocValue = d.associatedWith ? `${d.associatedWith.type}:${d.associatedWith.id}` : "";
                const assocMatch = d.associatedWith ? assocOptions.find(o => o.type === d.associatedWith.type && o.id === d.associatedWith.id) : null;
                const assocDisplay = assocMatch ? assocMatch.label : (d.associatedWith ? `${d.associatedWith.type}: ${d.associatedWith.name}` : "");

                return (
                  <div key={mc.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                    <div
                      onClick={() => setExpandedMiscContact(isExp ? null : mc.id)}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", cursor: "pointer", background: isExp ? "var(--c-bg2)" : "transparent" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 14 }}>📋</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)" }}>{displayName}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 4, background: typeColor.bg, color: "#1F2428", letterSpacing: "0.02em" }}>{mc.contactType}</span>
                            {d.company && <span style={{ fontSize: 11, color: "#8A9096" }}>· {d.company}</span>}
                            {assocDisplay && <span style={{ fontSize: 11, color: "#4F7393" }}>· {assocDisplay}</span>}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: "#8A9096" }}>{isExp ? "▲" : "▼"}</span>
                    </div>

                    {isExp && (
                      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--c-border)" }}>
                        <div style={fieldGroup}>
                          <label style={labelStyle}>Name</label>
                          <input style={{ ...inputStyle, fontWeight: 600 }} value={d.name || ""} placeholder="Full name" onChange={e => updateField("name", e.target.value)} onBlur={handleMiscNameBlur} />
                          {d.contactId && <div style={{ fontSize: 10, color: "#2F7A5F", marginTop: 2 }}>Linked to contact card</div>}
                        </div>
                        <div style={fieldGroup}>
                          <label style={labelStyle}>{mc.contactType === "Police Officer" ? "Department" : "Company / Agency"}</label>
                          <input style={inputStyle} value={d.company || ""} placeholder={mc.contactType === "Police Officer" ? "Police department" : "Company or agency"} onChange={e => syncMiscContactCard("company", e.target.value)} />
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                          <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={d.phone || ""} onChange={e => syncMiscContactCard("phone", e.target.value)} /></div>
                          <div><label style={labelStyle}>Email</label><input style={inputStyle} value={d.email || ""} onChange={e => syncMiscContactCard("email", e.target.value)} /></div>
                        </div>
                        <div style={fieldGroup}>
                          <label style={labelStyle}>Address</label>
                          <input style={inputStyle} value={d.address || ""} onChange={e => syncMiscContactCard("address", e.target.value)} />
                        </div>

                        {mc.contactType === "Police Officer" && (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div><label style={labelStyle}>Badge / ID #</label><input style={inputStyle} value={d.badgeNumber || ""} onChange={e => updateField("badgeNumber", e.target.value)} /></div>
                            <div><label style={labelStyle}>Report #</label><input style={inputStyle} value={d.reportNumber || ""} onChange={e => updateField("reportNumber", e.target.value)} /></div>
                          </div>
                        )}
                        {mc.contactType === "Witness" && (
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Relationship to Case</label>
                            <input style={inputStyle} value={d.relationship || ""} placeholder="e.g., Eyewitness, Bystander, Co-worker" onChange={e => updateField("relationship", e.target.value)} />
                          </div>
                        )}
                        {(mc.contactType === "Consultant" || mc.contactType === "Investigator") && (
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Specialty / Area</label>
                            <input style={inputStyle} value={d.specialty || ""} placeholder="Area of expertise" onChange={e => updateField("specialty", e.target.value)} />
                          </div>
                        )}
                        {mc.contactType === "Investigator" && (
                          <div style={fieldGroup}>
                            <label style={labelStyle}>License #</label>
                            <input style={inputStyle} value={d.licenseNumber || ""} onChange={e => updateField("licenseNumber", e.target.value)} />
                          </div>
                        )}

                        <div style={{ borderTop: "1px solid var(--c-border)", margin: "10px 0", paddingTop: 10 }}>
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Associated With</label>
                            <select style={inputStyle} value={assocValue} onChange={e => {
                              if (!e.target.value) { updateField("associatedWith", null); return; }
                              const [aType, aId] = e.target.value.split(":");
                              const opt = assocOptions.find(o => o.type === aType && String(o.id) === aId);
                              updateField("associatedWith", opt ? { type: opt.type, id: opt.id, name: opt.name } : null);
                            }}>
                              <option value="">— None —</option>
                              {assocOptions.map(o => <option key={`${o.type}-${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
                            </select>
                          </div>
                          <div style={fieldGroup}>
                            <label style={labelStyle}>Notes</label>
                            <textarea
                              style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                              value={d.notes || ""}
                              placeholder="Notes about this contact..."
                              onChange={e => updateField("notes", e.target.value)}
                            />
                          </div>
                        </div>

                        <div style={{ borderTop: "1px solid var(--c-border)", paddingTop: 10, display: "flex", justifyContent: "flex-end" }}>
                          <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#e05252", borderColor: "#e05252" }} onClick={async () => {
                            if (!window.confirm(`Remove ${displayName} (${mc.contactType}) from this case?`)) return;
                            try {
                              await apiDeleteMiscContact(mc.id);
                              setMiscContacts(p => p.filter(x => x.id !== mc.id));
                              setExpandedMiscContact(null);
                              log("Misc Contact Removed", `Removed ${mc.contactType}: ${displayName}`);
                            } catch (err) { alert("Failed: " + err.message); }
                          }}>Remove Contact</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>

            </div>

          </div>
        )}

        {/* ── Files Tab ── */}
        {activeTab === "files" && (
          <div className="case-overlay-body">
            <div className="case-overlay-section">
              <div className="case-overlay-section-title" style={{ marginBottom: 12 }}>Upload Document</div>
              <form onSubmit={async (e) => {
                e.preventDefault();
                const fileInput = e.target.querySelector('input[type="file"]');
                if (!fileInput.files[0]) return;
                const formData = new FormData();
                formData.append("file", fileInput.files[0]);
                formData.append("caseId", c.id);
                formData.append("docType", docUploadType);
                try {
                  const saved = await apiUploadCaseDocument(formData);
                  setCaseDocuments(prev => [saved, ...prev]);
                  fileInput.value = "";
                  log("Document Uploaded", `${saved.filename} (${saved.docType})`);
                } catch (err) { alert("Upload failed: " + err.message); }
              }} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 11, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>File (PDF, DOCX, DOC, TXT)</label>
                  <input type="file" accept=".pdf,.docx,.doc,.txt" style={{ fontSize: 12, width: "100%" }} />
                </div>
                <div style={{ minWidth: 160 }}>
                  <label style={{ fontSize: 11, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Document Type</label>
                  <select value={docUploadType} onChange={e => setDocUploadType(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 5, border: "1px solid var(--c-border)", width: "100%", background: "var(--c-bg)", color: "var(--c-text)" }}>
                    {["Police Report", "Witness Statement", "Lab/Forensic Report", "Mental Health Evaluation", "Prior Record/PSI", "Discovery Material", "Medical Records", "Body Cam/Dash Cam Transcript", "Court Order", "Plea Agreement", "Expert Report", "Other"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <button type="submit" className="btn btn-gold btn-sm">Upload</button>
              </form>
            </div>

            <div className="case-overlay-section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div className="case-overlay-section-title" style={{ marginBottom: 0 }}>
                  Documents {caseDocuments.length > 0 && <span style={{ fontSize: 11, color: "#8A9096", fontWeight: 400, marginLeft: 6 }}>({docFilterType === "All" ? caseDocuments.length : caseDocuments.filter(d => d.docType === docFilterType).length}{docFilterType !== "All" ? ` of ${caseDocuments.length}` : ""})</span>}
                </div>
                {caseDocuments.length > 0 && (
                  <select value={docFilterType} onChange={e => setDocFilterType(e.target.value)} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)" }}>
                    <option value="All">All Types</option>
                    {[...new Set(caseDocuments.map(d => d.docType))].sort().map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
              {docsLoading && <div style={{ fontSize: 12, color: "#8A9096", padding: "12px 0" }}>Loading...</div>}
              {!docsLoading && caseDocuments.length === 0 && <div className="empty" style={{ fontSize: 12 }}>No documents uploaded yet</div>}
              {caseDocuments.filter(d => docFilterType === "All" || d.docType === docFilterType).map(doc => {
                const isDocEditing = editingDocId === doc.id;
                return (
                <div key={doc.id} style={{ borderBottom: "1px solid var(--c-border)", padding: "12px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isDocEditing ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <input value={editingDocData.filename || ""} onChange={e => setEditingDocData(d => ({ ...d, filename: e.target.value }))} style={{ fontSize: 13, fontWeight: 500, padding: "3px 6px", borderRadius: 4, border: "1px solid #3B82F6", flex: 1, minWidth: 120 }} />
                          <select value={editingDocData.docType || "Other"} onChange={e => setEditingDocData(d => ({ ...d, docType: e.target.value }))} style={{ fontSize: 11, padding: "3px 6px", borderRadius: 4, border: "1px solid #3B82F6" }}>
                            {["Police Report", "Witness Statement", "Lab/Forensic Report", "Mental Health Evaluation", "Prior Record/PSI", "Discovery Material", "Medical Records", "Body Cam/Dash Cam Transcript", "Court Order", "Plea Agreement", "Expert Report", "Other"].map(t => <option key={t}>{t}</option>)}
                          </select>
                          <button onClick={async () => {
                            try {
                              const updated = await apiUpdateCaseDocument(doc.id, editingDocData);
                              setCaseDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, filename: updated.filename, docType: updated.docType } : d));
                              log("Document edited", editingDocData.filename);
                              setEditingDocId(null);
                            } catch (err) { alert("Save failed: " + err.message); }
                          }} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #059669", background: "#D1FAE5", color: "#065F46", cursor: "pointer", fontWeight: 600 }}>Save</button>
                          <button onClick={() => setEditingDocId(null)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #D1D5DB", background: "#fff", cursor: "pointer" }}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => { setEditingDocId(doc.id); setEditingDocData({ filename: doc.filename, docType: doc.docType }); }} title="Click to edit">{doc.filename}</div>
                          <div style={{ fontSize: 11, color: "var(--c-text2)", marginTop: 2 }}>
                            <span style={{ cursor: "pointer" }} onClick={() => { setEditingDocId(doc.id); setEditingDocData({ filename: doc.filename, docType: doc.docType }); }} title="Click to edit">{doc.docType}</span> · {(doc.fileSize / 1024).toFixed(0)} KB · {new Date(doc.createdAt).toLocaleDateString()}{doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
                          </div>
                        </>
                      )}
                    </div>
                    {!isDocEditing && (
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={async () => {
                        try {
                          const blob = await apiDownloadDocument(doc.id);
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a"); a.href = url; a.download = doc.filename; a.click(); URL.revokeObjectURL(url);
                        } catch (err) { alert("Download failed: " + err.message); }
                      }}>Download</button>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px", color: "#b8860b", borderColor: "#d4c9a8" }} disabled={docSummarizing === doc.id} onClick={async () => {
                        setDocSummarizing(doc.id);
                        try {
                          const { summary } = await apiSummarizeDocument(doc.id);
                          setCaseDocuments(prev => prev.map(d => d.id === doc.id ? { ...d, summary } : d));
                          setExpandedDocId(doc.id);
                        } catch (err) { alert("Summarize failed: " + err.message); }
                        setDocSummarizing(null);
                      }}>{docSummarizing === doc.id ? "Summarizing..." : (doc.summary ? "Re-summarize" : "⚡ Summarize")}</button>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px", color: "#e05252", borderColor: "#fca5a5" }} onClick={async () => {
                        if (!window.confirm(`Delete ${doc.filename}?`)) return;
                        try {
                          await apiDeleteCaseDocument(doc.id);
                          setCaseDocuments(prev => prev.filter(d => d.id !== doc.id));
                          log("Document Deleted", doc.filename);
                        } catch (err) { alert("Delete failed: " + err.message); }
                      }}>Delete</button>
                    </div>
                    )}
                  </div>
                  {doc.summary && (
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#b8860b", fontWeight: 500, padding: 0 }}>
                        {expandedDocId === doc.id ? "▾ Hide Summary" : "▸ View Summary"}
                      </button>
                      {expandedDocId === doc.id && (
                        <AiPanel title="Document Summary" result={doc.summary}
                          actions={<button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => navigator.clipboard.writeText(doc.summary)}>Copy</button>}
                        />
                      )}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Correspondence Tab ── */}
        {activeTab === "correspondence" && (
          <div className="case-overlay-body">
            <div className="case-overlay-section">
              <div className="case-overlay-section-title" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Correspondence</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#8A9096", fontWeight: 400 }}>
                    Email: <span style={{ fontFamily: "monospace", color: "#1E2A3A", cursor: "pointer" }} onClick={() => {
                      navigator.clipboard.writeText(`case-${c.id}@mcpd.mattrmindr.com`);
                      setCorrCopied(true);
                      setTimeout(() => setCorrCopied(false), 2000);
                    }}>{corrCopied ? "Copied!" : `case-${c.id}@mcpd.mattrmindr.com`}</span>
                  </span>
                  <button className="btn btn-outline btn-sm" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => {
                    setCorrLoading(true);
                    apiGetCorrespondence(c.id).then(setCorrespondence).catch(() => {}).finally(() => setCorrLoading(false));
                  }}>↻ Refresh</button>
                </div>
              </div>

              {corrLoading && <div style={{ fontSize: 13, color: "#8A9096", padding: "20px 0" }}>Loading correspondence...</div>}

              {!corrLoading && correspondence.length === 0 && (
                <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic", padding: "20px 0" }}>
                  No correspondence received yet. CC or forward emails to <span style={{ fontFamily: "monospace", color: "#1E2A3A" }}>case-{c.id}@mcpd.mattrmindr.com</span> and they will appear here, including any attachments.
                </div>
              )}

              {!corrLoading && correspondence.map(email => {
                const isExpanded = expandedEmail === email.id;
                const dateStr = email.receivedAt ? new Date(email.receivedAt).toLocaleString() : "";
                return (
                  <div key={email.id} style={{ borderBottom: "1px solid var(--c-border2)", padding: "10px 0" }}>
                    <div
                      style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}
                      onClick={() => setExpandedEmail(isExpanded ? null : email.id)}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#1E2A3A", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                        {(email.fromName || email.fromEmail || "?")[0].toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>{email.fromName || email.fromEmail}</div>
                          <div style={{ fontSize: 11, color: "#8A9096", whiteSpace: "nowrap" }}>{dateStr}</div>
                        </div>
                        <div style={{ fontSize: 13, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email.subject || "(no subject)"}</div>
                        {!isExpanded && (
                          <div style={{ fontSize: 12, color: "#8A9096", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                            {(email.bodyText || "").substring(0, 120)}
                          </div>
                        )}
                        {email.hasAttachments && (
                          <div style={{ fontSize: 11, color: "#1E2A3A", marginTop: 2 }}>📎 {email.attachments.length} attachment{email.attachments.length !== 1 ? "s" : ""}</div>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ marginTop: 10, marginLeft: 42 }}>
                        <div style={{ fontSize: 11, color: "#8A9096", marginBottom: 4 }}>
                          <div>From: {email.fromName} &lt;{email.fromEmail}&gt;</div>
                          {email.toEmails && <div>To: {email.toEmails}</div>}
                          {email.ccEmails && <div>CC: {email.ccEmails}</div>}
                        </div>
                        {email.attachments.length > 0 && (
                          <div style={{ marginTop: 8, marginBottom: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text2)", marginBottom: 6 }}>Attachments</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {email.attachments.map((att, idx) => {
                                const isImage = att.contentType?.startsWith("image/");
                                const isPdf = att.contentType === "application/pdf";
                                const isPreviewable = isImage || isPdf;
                                const icon = isImage ? "🖼" : isPdf ? "📄" : "📎";
                                return (
                                  <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                                    <button
                                      onClick={async () => {
                                        try {
                                          const res = await fetch(`/api/correspondence/attachment/${email.id}/${idx}?inline=true`, { credentials: "include" });
                                          if (!res.ok) throw new Error("Failed to load attachment");
                                          const blob = await res.blob();
                                          const typedBlob = new Blob([blob], { type: att.contentType || "application/octet-stream" });
                                          const blobUrl = URL.createObjectURL(typedBlob);
                                          if (isPdf) {
                                            window.open(blobUrl, "_blank");
                                          } else if (isImage) {
                                            setAttachmentPreview({ url: blobUrl, filename: att.filename, contentType: att.contentType, blobUrl });
                                          } else {
                                            const a = document.createElement("a"); a.href = blobUrl; a.download = att.filename; a.click(); URL.revokeObjectURL(blobUrl);
                                          }
                                        } catch (err) { alert("Failed to load attachment: " + err.message); }
                                      }}
                                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 14px", background: "#E4E7EB", borderRadius: 6, border: "1px solid #D6D8DB", cursor: "pointer", minWidth: 90, textAlign: "center" }}
                                      title={isPreviewable ? "Click to preview" : "Click to download"}
                                    >
                                      <span style={{ fontSize: 22 }}>{icon}</span>
                                      <span style={{ fontSize: 11, color: "#1E2A3A", fontWeight: 600, wordBreak: "break-all", maxWidth: 120 }}>{att.filename}</span>
                                      <span style={{ fontSize: 10, color: "#8A9096" }}>{(att.size / 1024).toFixed(0)} KB</span>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div style={{ fontSize: 13, color: "var(--c-text)", whiteSpace: "pre-wrap", background: "var(--c-bg2)", borderRadius: 6, padding: 12, marginTop: 8, maxHeight: 400, overflow: "auto", border: "1px solid var(--c-border)" }}>
                          {email.bodyText || "(empty)"}
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: 11, color: "#e05252", borderColor: "#e05252" }}
                            onClick={async () => {
                              if (!window.confirm("Delete this email from correspondence?")) return;
                              try {
                                await apiDeleteCorrespondence(email.id);
                                setCorrespondence(p => p.filter(e => e.id !== email.id));
                                setExpandedEmail(null);
                                log("Correspondence Removed", `Deleted email from ${email.fromName || email.fromEmail}: "${email.subject || "(no subject)"}"`)
                              } catch (err) { console.error(err); }
                            }}
                          >Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {attachmentPreview && (
          <div
            onClick={() => { if (attachmentPreview.blobUrl) URL.revokeObjectURL(attachmentPreview.blobUrl); setAttachmentPreview(null); }}
            style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: "var(--c-bg)", borderRadius: 10, width: "90vw", maxWidth: 900, height: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text-h)" }}>{attachmentPreview.filename}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={() => { const a = document.createElement("a"); a.href = attachmentPreview.url; a.download = attachmentPreview.filename; a.click(); }}
                    style={{ padding: "5px 14px", fontSize: 12, fontWeight: 600, background: "#1E2A3A", color: "#fff", borderRadius: 4, border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >Download</button>
                  <button
                    onClick={() => { if (attachmentPreview.blobUrl) URL.revokeObjectURL(attachmentPreview.blobUrl); setAttachmentPreview(null); }}
                    style={{ background: "transparent", border: "none", fontSize: 20, color: "#8A9096", cursor: "pointer", padding: "2px 6px", lineHeight: 1 }}
                  >✕</button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: "#1F2428" }}>
                {attachmentPreview.contentType?.startsWith("image/") ? (
                  <img src={attachmentPreview.url} alt={attachmentPreview.filename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                ) : attachmentPreview.contentType === "application/pdf" ? (
                  <iframe src={attachmentPreview.url} title={attachmentPreview.filename} style={{ width: "100%", height: "100%", border: "none" }} />
                ) : (
                  <div style={{ color: "#8A9096", fontSize: 14, textAlign: "center", padding: 40 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📎</div>
                    <div>Preview not available for this file type.</div>
                    <div style={{ marginTop: 8 }}>
                      <button onClick={() => { const a = document.createElement("a"); a.href = attachmentPreview.url; a.download = attachmentPreview.filename; a.click(); }} style={{ color: "#1E2A3A", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", fontSize: 14 }}>Download to view</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Filings Tab ── */}
        {activeTab === "filings" && (
          <div className="case-overlay-body">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Upload Filing (PDF only)</label>
                <input type="file" accept=".pdf,application/pdf" id="filing-upload-input" style={{ fontSize: 12, width: "100%" }} onChange={async (e) => {
                  const file = e.target.files[0]; if (!file) return;
                  const formData = new FormData();
                  formData.append("file", file);
                  formData.append("caseId", c.id);
                  if (filingUploadFiledBy) formData.append("filedBy", filingUploadFiledBy);
                  if (filingUploadDate) formData.append("filingDate", filingUploadDate);
                  if (filingUploadDocType) formData.append("docType", filingUploadDocType);
                  try {
                    const saved = await apiUploadFiling(formData);
                    setFilings(prev => [saved, ...prev]);
                    log("Filing uploaded", `${file.name}`);
                    e.target.value = "";
                    setFilingClassifying(saved.id);
                    try {
                      const { classification } = await apiClassifyFiling(saved.id);
                      setFilings(prev => prev.map(f => f.id === saved.id ? { ...f, filename: classification.suggestedName || f.filename, filedBy: classification.filedBy || f.filedBy, docType: classification.docType || f.docType, filingDate: classification.filingDate || f.filingDate, summary: classification.summary || f.summary } : f));
                      log("Filing auto-classified", `${classification.suggestedName || file.name} → ${classification.filedBy || "Unknown"}`);
                    } catch (classErr) { console.error("Auto-classify error:", classErr); }
                    setFilingClassifying(null);
                  } catch (err) { alert("Upload failed: " + err.message); setFilingClassifying(null); }
                }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Filed By</label>
                <select value={filingUploadFiledBy} onChange={e => setFilingUploadFiledBy(e.target.value)} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #D1D5DB" }}>
                  <option value="">— Auto-detect —</option>
                  <option>State</option><option>Defendant</option><option>Co-Defendant</option><option>Court</option><option>Other</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Filing Date</label>
                <input type="date" value={filingUploadDate} onChange={e => setFilingUploadDate(e.target.value)} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #D1D5DB" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280", display: "block", marginBottom: 4 }}>Doc Type</label>
                <input type="text" placeholder="e.g., Motion to Suppress" value={filingUploadDocType} onChange={e => setFilingUploadDocType(e.target.value)} style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid #D1D5DB", width: 160 }} />
              </div>
            </div>

            {filingClassifying && (
              <div style={{ background: "#FEF9C3", border: "1px solid #FCD34D", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span className="spinner" style={{ width: 14, height: 14, border: "2px solid #D97706", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
                AI is classifying the filing...
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#6B7280" }}>Filter by party:</label>
              <select value={filingFilterBy} onChange={e => setFilingFilterBy(e.target.value)} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #D1D5DB" }}>
                <option value="All">All</option>
                <option>State</option><option>Defendant</option><option>Co-Defendant</option><option>Court</option><option>Other</option>
              </select>
              <span style={{ fontSize: 11, color: "#8A9096" }}>
                {filings.length} filing{filings.length !== 1 ? "s" : ""}
              </span>
            </div>

            {filingsLoading ? <div style={{ textAlign: "center", padding: 40, color: "#8A9096" }}>Loading filings...</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                
                {filings.filter(f => filingFilterBy === "All" || f.filedBy === filingFilterBy).map(f => {
                  const partyColors = { State: "#DC2626", Defendant: "#2563EB", "Co-Defendant": "#7C3AED", Court: "#059669", Other: "#6B7280" };
                  const partyColor = partyColors[f.filedBy] || "#6B7280";
                  const isEditing = editingFilingId === f.id;
                  return (
                    <div key={f.id} style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "10px 14px", background: "#FAFBFC" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {isEditing ? (
                          <input value={editingFilingData.filename || ""} onChange={e => setEditingFilingData(d => ({ ...d, filename: e.target.value }))} style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 150, padding: "3px 6px", borderRadius: 4, border: "1px solid #3B82F6" }} />
                        ) : (
                          <span style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 150, cursor: "pointer" }} onClick={() => { setEditingFilingId(f.id); setEditingFilingData({ filename: f.filename, filedBy: f.filedBy || "", docType: f.docType || "", filingDate: f.filingDate ? f.filingDate.substring(0, 10) : "" }); }} title="Click to edit">{f.filename}</span>
                        )}
                        {isEditing ? (
                          <select value={editingFilingData.filedBy || ""} onChange={e => setEditingFilingData(d => ({ ...d, filedBy: e.target.value }))} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #3B82F6" }}>
                            <option value="">— None —</option>
                            <option>State</option><option>Defendant</option><option>Co-Defendant</option><option>Court</option><option>Other</option>
                          </select>
                        ) : (
                          f.filedBy && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: partyColor, borderRadius: 4, padding: "2px 7px", textTransform: "uppercase", cursor: "pointer" }} onClick={() => { setEditingFilingId(f.id); setEditingFilingData({ filename: f.filename, filedBy: f.filedBy || "", docType: f.docType || "", filingDate: f.filingDate ? f.filingDate.substring(0, 10) : "" }); }} title="Click to edit">{f.filedBy}</span>
                        )}
                        {isEditing ? (
                          <input value={editingFilingData.docType || ""} onChange={e => setEditingFilingData(d => ({ ...d, docType: e.target.value }))} placeholder="Doc type" style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #3B82F6", width: 120 }} />
                        ) : (
                          f.docType && <span style={{ fontSize: 10, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }} onClick={() => { setEditingFilingId(f.id); setEditingFilingData({ filename: f.filename, filedBy: f.filedBy || "", docType: f.docType || "", filingDate: f.filingDate ? f.filingDate.substring(0, 10) : "" }); }} title="Click to edit">{f.docType}</span>
                        )}
                        {f.source === "email" && <span style={{ fontSize: 10, color: "#D97706", background: "#FEF3C7", borderRadius: 4, padding: "2px 7px" }}>📧 Email</span>}
                        {isEditing ? (
                          <input type="date" value={editingFilingData.filingDate || ""} onChange={e => setEditingFilingData(d => ({ ...d, filingDate: e.target.value }))} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "1px solid #3B82F6" }} />
                        ) : (
                          f.filingDate && <span style={{ fontSize: 10, color: "#6B7280", cursor: "pointer" }} onClick={() => { setEditingFilingId(f.id); setEditingFilingData({ filename: f.filename, filedBy: f.filedBy || "", docType: f.docType || "", filingDate: f.filingDate ? f.filingDate.substring(0, 10) : "" }); }} title="Click to edit">Filed: {new Date(f.filingDate).toLocaleDateString()}</span>
                        )}
                        {isEditing && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={async () => {
                              try {
                                await apiUpdateFiling(f.id, editingFilingData);
                                setFilings(prev => prev.map(x => x.id === f.id ? { ...x, filename: editingFilingData.filename, filedBy: editingFilingData.filedBy, docType: editingFilingData.docType, filingDate: editingFilingData.filingDate || null } : x));
                                log("Filing edited", editingFilingData.filename);
                                setEditingFilingId(null);
                              } catch (err) { alert("Save failed: " + err.message); }
                            }} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #059669", background: "#D1FAE5", color: "#065F46", cursor: "pointer", fontWeight: 600 }}>Save</button>
                            <button onClick={() => setEditingFilingId(null)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #D1D5DB", background: "#fff", cursor: "pointer" }}>Cancel</button>
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, color: "#8A9096" }}>{f.fileSize ? (f.fileSize / 1024).toFixed(0) + " KB" : ""}</span>
                        <span style={{ fontSize: 10, color: "#8A9096" }}>{f.uploadedByName ? `by ${f.uploadedByName}` : ""}{f.sourceEmailFrom ? `from ${f.sourceEmailFrom}` : ""}</span>
                        <span style={{ fontSize: 10, color: "#8A9096" }}>{new Date(f.createdAt).toLocaleDateString()}</span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          <button onClick={async () => { try { const res = await fetch(`/api/filings/${f.id}/download?inline=true`, { credentials: "include" }); if (!res.ok) throw new Error("View failed"); const blob = await res.blob(); const pdfBlob = new Blob([blob], { type: "application/pdf" }); const url = URL.createObjectURL(pdfBlob); window.open(url, "_blank"); } catch (err) { alert("View failed: " + err.message); } }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid #D1D5DB", background: "#fff", cursor: "pointer" }}>View</button>
                          <button disabled={filingClassifying === f.id} onClick={async () => { setFilingClassifying(f.id); try { const { classification } = await apiClassifyFiling(f.id); setFilings(prev => prev.map(x => x.id === f.id ? { ...x, filename: classification.suggestedName || x.filename, filedBy: classification.filedBy || x.filedBy, docType: classification.docType || x.docType, filingDate: classification.filingDate || x.filingDate, summary: classification.summary || x.summary } : x)); log("Filing classified", `${classification.suggestedName || f.filename}`); } catch (err) { alert("Classification failed: " + err.message); } setFilingClassifying(null); }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid #D97706", background: "#FEF3C7", color: "#92400E", cursor: "pointer" }}>{filingClassifying === f.id ? "Classifying..." : "⚡ Classify"}</button>
                          <button disabled={filingSummarizing === f.id} onClick={async () => { setFilingSummarizing(f.id); try { const { summary } = await apiSummarizeFiling(f.id); setFilings(prev => prev.map(x => x.id === f.id ? { ...x, summary } : x)); setExpandedFilingId(f.id); log("Filing summarized", f.filename); } catch (err) { alert("Summary failed: " + err.message); } setFilingSummarizing(null); }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid #6366F1", background: "#EEF2FF", color: "#4338CA", cursor: "pointer" }}>{filingSummarizing === f.id ? "Summarizing..." : (f.summary ? "⚡ Re-summarize" : "⚡ Summarize")}</button>
                          {canRemove && <button onClick={async () => { if (!window.confirm("Delete this filing?")) return; try { await apiDeleteFiling(f.id); setFilings(prev => prev.filter(x => x.id !== f.id)); log("Filing deleted", f.filename); } catch (err) { alert("Delete failed: " + err.message); } }} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid #EF4444", background: "#FEF2F2", color: "#DC2626", cursor: "pointer" }}>Delete</button>}
                        </div>
                      </div>
                      {f.originalFilename && f.originalFilename !== f.filename && (
                        <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4, fontStyle: "italic" }}>Original: {f.originalFilename}</div>
                      )}
                      {f.summary && (
                        <div style={{ marginTop: 8 }}>
                          <button onClick={() => setExpandedFilingId(expandedFilingId === f.id ? null : f.id)} style={{ fontSize: 11, color: "#4F46E5", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>{expandedFilingId === f.id ? "▾ Hide Summary" : "▸ View Summary"}</button>
                          {expandedFilingId === f.id && (
                            <div style={{ marginTop: 6 }}>
                              <AiPanel title="Filing Summary" result={f.summary} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filings.length === 0 && !filingsLoading && (
                  <div style={{ textAlign: "center", padding: 40, color: "#8A9096" }}>
                    <div style={{ fontSize: 14, marginBottom: 8 }}>No filings yet</div>
                    <div style={{ fontSize: 12 }}>Upload a PDF filing above, or forward an email with a PDF attachment to the case email alias to auto-create filings.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Activity Tab ── */}
        {activeTab === "activity" && (() => {
          const ACTIVITY_FILTERS = [
            { key: "all", label: "All" },
            { key: "field", label: "Field Edits" },
            { key: "note", label: "Notes" },
            { key: "task", label: "Tasks" },
            { key: "link", label: "Links" },
            { key: "deadline", label: "Deadlines" },
            { key: "billing", label: "Billing" },
            { key: "expense", label: "Expenses" },
            { key: "correspondence", label: "Correspondence" },
          ];
          const matchFilter = (entry) => {
            if (activityFilter === "all") return true;
            const a = (entry.action || "").toLowerCase();
            if (activityFilter === "field") return a.includes("changed") || a.includes("updated") || a.includes("custom field") || a.includes("custom date") || a.includes("team");
            if (activityFilter === "note") return a.includes("note");
            if (activityFilter === "task") return a.includes("task");
            if (activityFilter === "link") return a.includes("link");
            if (activityFilter === "deadline") return a.includes("deadline");
            if (activityFilter === "billing") return a.includes("billing");
            if (activityFilter === "expense") return a.includes("expense");
            if (activityFilter === "correspondence") return a.includes("correspondence");
            return true;
          };
          const filtered = activity.filter(matchFilter);
          return (
          <div className="case-overlay-body">
            <div className="case-overlay-section">
              <div className="case-overlay-section-title" style={{ marginBottom: 12 }}>
                <span>Case Activity</span>
                <span style={{ fontSize: 11, color: "#8A9096", fontWeight: 400 }}>{filtered.length} event{filtered.length !== 1 ? "s" : ""}{activityFilter !== "all" ? ` (filtered)` : ""}</span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 }}>
                {ACTIVITY_FILTERS.map(f => (
                  <button key={f.key} className={`btn btn-sm ${activityFilter === f.key ? "" : "btn-outline"}`} style={activityFilter === f.key ? { background: "#1E2A3A", color: "#fff", border: "1px solid #1E2A3A", fontSize: 11, padding: "3px 10px" } : { fontSize: 11, padding: "3px 10px" }} onClick={() => setActivityFilter(f.key)}>{f.label}</button>
                ))}
              </div>

              {filtered.length === 0 && (
                <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic", padding: "20px 0" }}>
                  {activity.length === 0 ? "No activity recorded yet. Changes to this case will appear here." : "No matching activity for this filter."}
                </div>
              )}

              {filtered.map((entry, i) => (
                <div key={entry.id} className="activity-entry">
                  <div className="activity-avatar-col">
                    <Avatar userId={entry.userId} size={28} />
                    {i < filtered.length - 1 && <div className="activity-line" />}
                  </div>
                  <div className="activity-body">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                        background: "var(--c-hover)", border: `1px solid ${actionColor(entry.action)}44`,
                        color: actionColor(entry.action),
                      }}>{entry.action}</span>
                      <span style={{ fontSize: 12, color: "var(--c-text)", fontWeight: 500 }}>{entry.userName}</span>
                      <span style={{ fontSize: 11, color: "#8A9096" }}>{entry.userRole}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--c-text)", marginBottom: 4, lineHeight: 1.5 }}>{entry.detail}</div>
                    <div style={{ fontSize: 11, color: "#8A9096" }}>{fmtTs(entry.ts)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })()}

      </div>
    </>
  );
}

// ─── CaseFileLinks Component ──────────────────────────────────────────────────
// Stores local file path strings (not file contents) — user pastes or types a
// path and it's saved as a clickable link that opens via the file:// protocol.
const LINK_CATEGORIES = ["General", "Motions", "Discovery", "Police Reports", "Photographs", "Expert Reports", "Court Orders", "Plea Agreements", "Sentencing", "Other"];

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
        <span>Linked Files {links.length > 0 && <span style={{ color: "#8A9096" }}>({links.length})</span>}</span>
        <button
          className="btn btn-outline btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => setShowForm(s => !s)}
        >{showForm ? "Cancel" : "+ Add Link"}</button>
      </div>

      {showForm && (
        <div style={{ background: "var(--c-hover)", border: "1px solid var(--c-border)", borderRadius: 7, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "#8A9096", display: "block", marginBottom: 4 }}>File Path *</label>
            <input
              autoFocus
              value={newPath}
              onChange={e => setNewPath(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="e.g. C:\Cases\Smith v Jones\Complaint.pdf or /Users/ben/cases/file.pdf"
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
            />
            <div style={{ fontSize: 10, color: "#8A9096", marginTop: 4 }}>Paste the full path to the file on your computer or network drive.</div>
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "#8A9096", display: "block", marginBottom: 4 }}>Display Name <span style={{ color: "#8A9096" }}>(optional)</span></label>
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="Defaults to filename"
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#8A9096", display: "block", marginBottom: 4 }}>Category</label>
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
        <div style={{ fontSize: 12, color: "#8A9096", fontStyle: "italic" }}>
          No linked files yet. Click "+ Add Link" to paste a local or network file path.
        </div>
      )}

      {links.length > 0 && (
        <div style={{ background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: 6, overflow: "hidden" }}>
          {links.map((link, i) => (
            <div key={link.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < links.length - 1 ? "1px solid var(--c-border2)" : "none", transition: "background 0.12s" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--c-hover)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ fontSize: 18, flexShrink: 0, width: 26, textAlign: "center" }}>{linkIcon(link.path)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  onClick={() => openLink(link.path)}
                  title={link.path}
                  style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "#1E2A3A"; e.currentTarget.style.textDecoration = "underline"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--c-text)"; e.currentTarget.style.textDecoration = "none"; }}
                >
                  {link.label}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 3, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color: "#8A9096", background: "var(--c-border)", border: "1px solid var(--c-border3)", borderRadius: 3, padding: "1px 5px" }}>{link.category}</span>
                  <span style={{ fontSize: 10, color: "var(--c-text2)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }} title={link.path}>{link.path}</span>
                </div>
                <div style={{ fontSize: 10, color: "#8A9096", marginTop: 2 }}>Added by {link.addedBy} · {new Date(link.addedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</div>
              </div>
              <button
                onClick={() => window.confirm(`Remove link to "${link.label}"?`) && onDeleteLink(link.id)}
                style={{ background: "none", border: "none", color: "#8A9096", cursor: "pointer", padding: "4px 6px", fontSize: 14, flexShrink: 0, lineHeight: 1 }}
                title="Remove link"
                onMouseEnter={e => e.currentTarget.style.color = "#e05252"}
                onMouseLeave={e => e.currentTarget.style.color = "#8A9096"}
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
  { label: "General",          color: "var(--c-text2)", bg: "var(--c-card)" },
  { label: "Attorney Note",    color: "#1E2A3A", bg: "#fef3c7" },
  { label: "Client Contact",   color: "#5599cc", bg: "#E4E7EB" },
  { label: "Plea Discussion",  color: "#44bbaa", bg: "#ccfbf1" },
  { label: "Court / Hearing",  color: "#e07a30", bg: "#fff7ed" },
  { label: "Investigation",    color: "#4CAE72", bg: "#dcfce7" },
  { label: "Witness Interview", color: "#a066cc", bg: "#fdf4ff" },
  { label: "Social Work",      color: "#e05252", bg: "#fef2f2" },
  { label: "Internal",         color: "#8A9096", bg: "var(--c-bg)" },
];

const noteTypeStyle = (label) => NOTE_TYPES.find(t => t.label === label) || NOTE_TYPES[0];

// ─── CaseNotes Component ──────────────────────────────────────────────────────
function CaseNotes({ caseId, notes, currentUser, onAddNote, onDeleteNote, onUpdateNote, caseRecord }) {
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [form, setForm] = useState({ type: "General", body: "", time: "" });
  const [assignId, setAssignId] = useState(0);
  const [showAllAssign, setShowAllAssign] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editBody, setEditBody] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const speechRecRef = useRef(null);
  const speechSupported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggleSpeech = useCallback(() => {
    if (isListening && speechRecRef.current) {
      speechRecRef.current.stop();
      setIsListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) transcript += e.results[i][0].transcript;
      }
      if (transcript) {
        setForm(p => ({ ...p, body: p.body + (p.body && !p.body.endsWith(" ") ? " " : "") + transcript }));
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") alert("Microphone access was denied. Please allow microphone permissions.");
      setIsListening(false);
    };
    rec.onend = () => setIsListening(false);
    speechRecRef.current = rec;
    rec.start();
    setIsListening(true);
  }, [isListening]);

  useEffect(() => {
    return () => { if (speechRecRef.current) { try { speechRecRef.current.stop(); } catch {} } };
  }, []);

  const currentIsSupportStaff = isSupportStaff(currentUser);

  const caseTeamIds   = caseRecord ? [caseRecord.assignedAttorney, caseRecord.secondAttorney, caseRecord.trialCoordinator, caseRecord.investigator, caseRecord.socialWorker].filter(id => id > 0) : [];
  const caseTeamUsers = USERS.filter(u => caseTeamIds.includes(u.id) && isAttyPara(u));
  const otherAttyPara = USERS.filter(u => !caseTeamIds.includes(u.id) && isAttyPara(u));

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
      timeLogged: form.time.trim() || null,
      timeLogUser: (currentIsSupportStaff && assignId > 0) ? assignId : null,
    });
    if (speechRecRef.current) { try { speechRecRef.current.stop(); } catch {} }
    setIsListening(false);
    setForm({ type: "General", body: "", time: "" });
    setAssignId(0);
    setShowAllAssign(false);
    setShowForm(false);
  };

  return (
    <div className="panel-section">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div className="panel-section-title" style={{ marginBottom: 0 }}>
          Notes {notes.length > 0 && <span style={{ color: "#8A9096" }}>({notes.length})</span>}
        </div>
        <button
          className="btn btn-outline btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => { setShowForm(s => !s); setExpandedId(null); if (showForm) { setAssignId(0); setShowAllAssign(false); if (speechRecRef.current) { try { speechRecRef.current.stop(); } catch {} } setIsListening(false); } }}
        >
          {showForm ? "Cancel" : "+ Add Note"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div style={{ background: "var(--c-bg)", border: "1px solid var(--c-border3)", borderRadius: 7, padding: 14, marginBottom: 12 }}>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Note Type</label>
            <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
              {NOTE_TYPES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ marginBottom: 0 }}>Note</label>
              {speechSupported && (
                <button
                  type="button"
                  onClick={toggleSpeech}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "3px 10px", fontSize: 11, fontWeight: 500,
                    border: isListening ? "1px solid #ef4444" : "1px solid var(--c-border)",
                    borderRadius: 5,
                    background: isListening ? "rgba(239,68,68,0.1)" : "var(--c-bg)",
                    color: isListening ? "#ef4444" : "var(--c-text2)",
                    cursor: "pointer",
                    animation: isListening ? "pulse-mic 1.5s infinite" : "none",
                  }}
                  title={isListening ? "Stop dictation" : "Start voice dictation"}
                >
                  <span style={{ fontSize: 14 }}>{isListening ? "🔴" : "🎙️"}</span>
                  {isListening ? "Listening…" : "Dictate"}
                </button>
              )}
            </div>
            <textarea
              rows={5}
              value={form.body}
              onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
              placeholder={isListening ? "Speak now — your words will appear here…" : "Enter detailed note here…"}
              style={{ resize: "vertical", marginTop: 4 }}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Time Spent <span style={{ fontSize: 11, color: "#8A9096", fontWeight: 400 }}>(optional — e.g. 1.5 hours, 30 min)</span></label>
            <input
              type="text"
              placeholder="e.g. 1.5 hours, 30 min"
              value={form.time}
              onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
            />
          </div>
          {currentIsSupportStaff && (
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Assign Time Credit To <span style={{ fontSize: 11, color: "#8A9096", fontWeight: 400 }}>(optional)</span></label>
              <select value={assignId} onChange={e => setAssignId(Number(e.target.value))}>
                <option value={0}>— Keep in my log —</option>
                {caseTeamUsers.length > 0 && (
                  <optgroup label="On this file">
                    {caseTeamUsers.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                  </optgroup>
                )}
                {showAllAssign && otherAttyPara.length > 0 && (
                  <optgroup label="All attorneys / trial coordinators">
                    {otherAttyPara.map(u => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
                  </optgroup>
                )}
              </select>
              {!showAllAssign && (
                <button
                  className="btn btn-outline btn-sm"
                  style={{ marginTop: 4, fontSize: 11 }}
                  onClick={() => setShowAllAssign(true)}
                  type="button"
                >Show all attorneys / paralegals</button>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={handleAdd} disabled={!form.body.trim()}>
              Save Note
            </button>
            <span style={{ fontSize: 11, color: "#8A9096" }}>
              Will be recorded as {currentUser.name} · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
        </div>
      )}

      {/* Notes list */}
      {notes.length === 0 && !showForm && (
        <div style={{ fontSize: 12, color: "#8A9096", fontStyle: "italic" }}>No notes yet. Click "+ Add Note" to create the first one.</div>
      )}
      {notes.length > 0 && (
        <div style={{ background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: 6, overflow: "hidden" }}>
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
                  <span style={{ fontSize: 11, color: "#8A9096", flex: 1 }}>{note.authorName}</span>
                  <span style={{ fontSize: 10, color: "#8A9096", whiteSpace: "nowrap" }}>{dateStr}</span>
                  <span style={{ fontSize: 10, color: "#D6D8DB" }}>{isExpanded ? "▲" : "▼"}</span>
                </div>

                {!isExpanded && (
                  <div style={{ fontSize: 12, color: "#8A9096", paddingLeft: 2, fontStyle: "italic", lineHeight: 1.4 }}>
                    {preview}
                  </div>
                )}

                {/* Expanded body */}
                {isExpanded && (
                  <div>
                    <div style={{ fontSize: 11, color: "#8A9096", marginBottom: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <span>👤 {note.authorName} ({note.authorRole})</span>
                      <span>🕐 {dateStr} at {timeStr}</span>
                    </div>
                    {editingNoteId === note.id ? (
                      <div onClick={e => e.stopPropagation()}>
                        <textarea
                          rows={6}
                          value={editBody}
                          onChange={e => setEditBody(e.target.value)}
                          style={{ width: "100%", fontSize: 13, lineHeight: 1.7, padding: "10px 12px", borderRadius: 5, border: "1px solid var(--c-accent)", background: "var(--c-bg)", color: "var(--c-text)", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
                          autoFocus
                        />
                        <div style={{ marginTop: 8, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => { setEditingNoteId(null); setEditBody(""); }}
                            disabled={editSaving}
                          >Cancel</button>
                          <button
                            className="btn btn-gold btn-sm"
                            style={{ fontSize: 11 }}
                            disabled={editSaving || !editBody.trim() || editBody.trim() === note.body}
                            onClick={async () => {
                              setEditSaving(true);
                              try {
                                await onUpdateNote(note.id, { body: editBody.trim() });
                                setEditingNoteId(null);
                                setEditBody("");
                              } catch (err) {
                                alert("Failed to update note: " + err.message);
                              } finally {
                                setEditSaving(false);
                              }
                            }}
                          >{editSaving ? "Saving…" : "Save"}</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: "var(--c-text)", lineHeight: 1.7, whiteSpace: "pre-wrap", background: "var(--c-hover)", padding: "10px 12px", borderRadius: 5, border: "1px solid var(--c-border)" }}>
                        {note.body}
                      </div>
                    )}
                    <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      {editingNoteId !== note.id && (
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ fontSize: 11 }}
                          onClick={e => { e.stopPropagation(); setEditingNoteId(note.id); setEditBody(note.body); }}
                        >
                          ✏️ Edit
                        </button>
                      )}
                      <button
                        className="btn btn-outline btn-sm"
                        style={{ fontSize: 11, color: "#e05252", borderColor: "#fca5a5" }}
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

  const lead = getUserById(c.assignedAttorney);
  const second = getUserById(c.secondAttorney);
  const para = getUserById(c.trialCoordinator);
  const inv = getUserById(c.investigator);
  const sw = getUserById(c.socialWorker);
  const now = new Date().toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="print-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width: "100%", maxWidth: 860 }}>
        {/* Toolbar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, padding: "0 4px" }}>
          <div style={{ color: "var(--c-text)", fontSize: 14, fontWeight: 600 }}>📄 Case File Preview — {c.title}</div>
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
                    {c.caseType && <span style={{ marginRight: 16 }}>{c.caseType}</span>}
                    <span>Status: {c.status}</span>
                    {c.stage && <span style={{ marginLeft: 16 }}>Stage: {c.stage}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: 11, color: "#777" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#333", marginBottom: 2 }}>MattrMindr</div>
                  <div>Printed {now}</div>
                </div>
              </div>
            </div>

            {/* Case details */}
            <h2>Case Information</h2>
            <div className="info-grid">
              {[
                ["Defendant", c.defendantName],
                ["Prosecutor", c.prosecutor],
                ["Charge", c.chargeDescription],
                ["Statute", c.chargeStatute],
                ["Charge Class", c.chargeClass],
                ["Case Type", c.caseType],
                ["County", c.county],
                ["Court", c.court],
                ["Court Division", c.courtDivision],
                ["Judge", c.judge],
                ["Custody Status", c.custodyStatus],
                ["Bond Amount", c.bondAmount],
                ["Assigned Attorney", lead?.name],
                ["2nd Attorney", second?.name],
                ["Trial Coordinator", para?.name],
                ["Investigator", inv?.name],
                ["Social Worker", sw?.name],
                ...(c._customTeam || []).map(m => [m.role, USERS.find(u => u.id === m.userId)?.name]),
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="ip"><span className="ik">{k}</span><span className="iv">{v}</span></div>
              ))}
            </div>

            {/* Key dates */}
            <h2>Key Dates</h2>
            <div className="info-grid">
              {[
                ["Arrest Date", fmt(c.arrestDate)],
                ["Arraignment Date", fmt(c.arraignmentDate)],
                ["Next Court Date", fmt(c.nextCourtDate)],
                ["Trial Date", fmt(c.trialDate)],
                ["Sentencing Date", fmt(c.sentencingDate)],
                ["Disposition Date", fmt(c.dispositionDate)],
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
                  <thead><tr><th>Task</th><th>Assigned To</th><th>Due</th><th>Status</th><th>Priority</th><th>Time</th></tr></thead>
                  <tbody>
                    {[...tasks].sort((a, b) => (a.due || "").localeCompare(b.due || "")).map(t => (
                      <tr key={t.id}>
                        <td>{t.title}</td>
                        <td>{getUserById(t.assigned)?.name || "—"}</td>
                        <td>{fmt(t.due)}</td>
                        <td>{t.status}</td>
                        <td>{getEffectivePriority(t)}</td>
                        <td>{t.timeLogged || "—"}</td>
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
                    {note.timeLogged && <><span>·</span><span style={{ fontWeight: 600 }}>⏱ {note.timeLogged}</span></>}
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
              <span>MattrMindr Case Management · Confidential — Attorney Work Product</span>
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
    <div className="mobile-grid-1" style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* Calendar */}
      <div className="card" style={{ flex: 1, minWidth: 0 }}>
        {/* Month nav */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button className="btn btn-outline btn-sm" onClick={prevMonth}>← Prev</button>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, color: "var(--c-text-h)", fontWeight: 600 }}>{monthName}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-outline btn-sm" onClick={() => { setCalMonth(now.getMonth()); setCalYear(now.getFullYear()); setSelected(todayStr); }}>Today</button>
            <button className="btn btn-outline btn-sm" onClick={nextMonth}>Next →</button>
          </div>
        </div>

        {/* Legend */}
        <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--c-border)", display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[["#e05252","Overdue"],["#e07a30","≤7 days"],["#1E2A3A","≤21 days"],["#4CAE72","Upcoming"],["#5588cc","External Cal"]].map(([col,lbl]) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#8A9096" }}>{lbl}</span>
            </div>
          ))}
        </div>

        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid var(--c-border)" }}>
          {DOW.map(d => <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, color: "#8A9096", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{d}</div>)}
        </div>

        {/* Day cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {cells.map((dateStr, i) => {
            if (!dateStr) return <div key={i} style={{ minHeight: 80, borderRight: "1px solid var(--c-border2)", borderBottom: "1px solid var(--c-border2)", background: "var(--c-card)" }} />;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selected;
            const events = eventsByDate[dateStr] || [];
            const dayNum = Number(dateStr.split("-")[2]);
            const borderR = (i + 1) % 7 !== 0 ? "1px solid var(--c-border2)" : "none";
            return (
              <div key={dateStr} onClick={() => setSelected(isSelected ? null : dateStr)}
                style={{ minHeight: 80, borderRight: borderR, borderBottom: "1px solid var(--c-border2)", padding: "6px 7px", cursor: events.length ? "pointer" : "default", background: isSelected ? "#E4E7EB" : isToday ? "#E4E7EB" : "transparent", transition: "background 0.1s", position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? "#1E2A3A" : "#8A9096", width: 22, height: 22, borderRadius: "50%", background: isToday ? "#1E2A3A12" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{dayNum}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {events.slice(0, 3).map((ev, ei) => (
                    <div key={ei} style={{ background: chipColor(ev) + "22", border: `1px solid ${chipColor(ev)}55`, borderRadius: 3, padding: "1px 4px", fontSize: 10, color: chipColor(ev), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {ev.title}
                    </div>
                  ))}
                  {events.length > 3 && <div style={{ fontSize: 10, color: "#8A9096", paddingLeft: 2 }}>+{events.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day detail panel */}
      <div className="card mobile-full" style={{ width: 300, flexShrink: 0 }}>
        <div className="card-header">
          <div className="card-title">{selected ? fmt(selected) : "Select a date"}</div>
          {selected && <span style={{ fontSize: 12, color: "#8A9096" }}>{selectedEvents.length} event{selectedEvents.length !== 1 ? "s" : ""}</span>}
        </div>
        {!selected && <div className="empty" style={{ padding: "30px 20px" }}>Click any date to see its deadlines and events.</div>}
        {selected && selectedEvents.length === 0 && <div className="empty" style={{ padding: "30px 20px" }}>No deadlines or events on this date.</div>}
        {selected && selectedEvents.map((ev, i) => {
          const col = chipColor(ev);
          const cs = ev.caseId ? allCases.find(c => c.id === ev.caseId) : null;
          return (
            <div key={i} style={{ padding: "12px 16px", borderBottom: "1px solid var(--c-border2)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0, marginTop: 3 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 600, marginBottom: 3 }}>{ev.title}</div>
                  {ev.kind === "deadline" && cs && <div style={{ fontSize: 11, color: "#8A9096" }}>{cs.title?.slice(0, 45)}</div>}
                  {ev.kind === "deadline" && ev.type && <Badge label={ev.type} />}
                  {ev.kind === "external" && <div style={{ fontSize: 11, color: "#5588cc", marginTop: 2 }}>📅 {ev.source}</div>}
                  {ev.location && <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>📍 {ev.location}</div>}
                  {ev.notes && <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2, fontStyle: "italic" }}>{ev.notes.slice(0, 80)}</div>}
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
          <span style={{ fontSize: 12, color: "#8A9096" }}>{feeds.length} feed{feeds.length !== 1 ? "s" : ""} · {externalEvents.length} events imported</span>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: "var(--c-text2)", marginBottom: 16, lineHeight: 1.6 }}>
            Add any iCal/webcal feed URL to overlay external events on the calendar — court dockets, Google Calendar, Outlook, bar association deadlines, etc.
            <br /><span style={{ fontSize: 11, color: "#8A9096" }}>Tip: In Google Calendar, go to the calendar's settings → "Integrate calendar" → copy the public iCal address. In Outlook, use File → Account Settings → Internet Calendars.</span>
          </div>

          {/* Add feed form */}
          <div style={{ background: "var(--c-bg)", border: "1px solid var(--c-border3)", borderRadius: 7, padding: 16, marginBottom: feeds.length ? 16 : 0 }}>
            <div style={{ fontSize: 12, color: "#1E2A3A", fontWeight: 600, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Add New Calendar Feed</div>
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
            <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 6, padding: "10px 14px", marginTop: 12, fontSize: 12, color: "#cc8888", lineHeight: 1.5 }}>
              ⚠ {error}
            </div>
          )}

          {/* Feed list */}
          {feeds.map(feed => (
            <div key={feed.id} style={{ background: "var(--c-bg)", border: "1px solid var(--c-border3)", borderRadius: 7, padding: "12px 14px", marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                  <div style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 600 }}>{feed.name}</div>
                  {feed.status === "ok" && <span style={{ fontSize: 10, background: "#dcfce7", color: "#1F2428", padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>✓ {feed.count} events</span>}
                  {feed.status === "error" && <span style={{ fontSize: 10, background: "#fee2e2", color: "#1F2428", padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>✗ Error</span>}
                  {feed.status === "pending" && <span style={{ fontSize: 10, color: "#8A9096" }}>Importing…</span>}
                </div>
                <div style={{ fontSize: 11, color: "#8A9096", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{feed.url}</div>
                {feed.lastSync && <div style={{ fontSize: 10, color: "#059669", marginTop: 2 }}>Last synced: {feed.lastSync}</div>}
                {feed.status === "error" && feed.error && <div style={{ fontSize: 11, color: "#994444", marginTop: 3 }}>{feed.error}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button className="btn btn-outline btn-sm" onClick={() => importFeed(feed)} disabled={importing === feed.id}>
                  {importing === feed.id ? "…" : "↻ Sync"}
                </button>
                <button className="btn btn-outline btn-sm" style={{ color: "#e05252", borderColor: "#fca5a5" }} onClick={() => removeFeed(feed.id, feed.name)}>✕</button>
              </div>
            </div>
          ))}

          {feeds.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px 0 4px", color: "#8A9096", fontSize: 13 }}>
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
            <div key={src} style={{ display: "flex", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--c-border2)" }}>
              <div style={{ fontSize: 13, color: "#1E2A3A", fontWeight: 600, width: 180, flexShrink: 0 }}>{src}</div>
              <div style={{ fontSize: 12, color: "var(--c-text2)", lineHeight: 1.5 }}>{tip}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Deadlines View ───────────────────────────────────────────────────────────
function DeadlinesView({ deadlines, onAddDeadline, allCases, calcInputs, setCalcInputs, calcResult, runCalc, currentUser, onMenuToggle, pinnedCaseIds }) {
  const [tab, setTab] = useState("calendar");
  const [typeFilter, setTypeFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState("date");
  const [sortDir, setSortDir] = useState("asc");
  const [externalEvents, setExternalEvents] = useState([]);
  const [newDl, setNewDl] = useState({ caseId: allCases.find(c => c.status === "Active")?.id || 1, title: "", date: today, type: "Filing", rule: "", assigned: currentUser.id });
  const [dlCaseSearch, setDlCaseSearch] = useState("");
  const [dlCaseDropOpen, setDlCaseDropOpen] = useState(false);

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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div><div className="topbar-title">Deadline Tracker</div><div className="topbar-subtitle">{deadlines.filter(d => daysUntil(d.date) < 0).length} overdue · {deadlines.filter(d => { const n = daysUntil(d.date); return n >= 0 && n <= 7; }).length} this week · {deadlines.length} total{externalEvents.length ? ` · ${externalEvents.length} external` : ""}</div></div>
        </div>
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
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--c-border)", display: "flex", gap: 10 }}>
              <select style={{ width: 160 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>{types.map(t => <option key={t}>{t}</option>)}</select>
              <input placeholder="Search deadlines or cases…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="table-wrap">
              <table className="mobile-cards">
                <thead>
                  <tr>
                    <th style={{ width: 14 }}></th>
                    <SortTh col="title" label="Deadline" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortTh col="case" label="Case" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
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
                        <td className="mobile-hide"><div style={{ width: 10, height: 10, borderRadius: "50%", background: col }} /></td>
                        <td data-label="Deadline"><div style={{ color: "var(--c-text)", fontWeight: 600 }}>{d.title}</div>{d.rule && <div style={{ fontSize: 11, color: "#1E2A3A", fontFamily: "monospace" }}>{d.rule}</div>}</td>
                        <td data-label="Case" style={{ fontSize: 12, color: "var(--c-text2)" }}>{cs?.title?.slice(0, 40) || `#${d.caseId}`}<div style={{ fontSize: 10, color: "#8A9096" }}>{cs?.caseNum}</div></td>
                        <td data-label="Type"><Badge label={d.type} /></td>
                        <td data-label="Due" style={{ color: col, fontSize: 13, whiteSpace: "nowrap" }}>{fmt(d.date)}</td>
                        <td data-label="Days" style={{ color: col, fontWeight: 700 }}>{days < 0 ? <span style={{ color: "#e05252" }}>{Math.abs(days)}d over</span> : days === 0 ? "Today" : `${days}d`}</td>
                        <td data-label="Assigned"><Avatar userId={d.assigned} size={26} /></td>
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
              <div className="form-group"><label>Case</label>
                <div style={{ position: "relative" }}>
                  {newDl.caseId && !dlCaseDropOpen ? (() => {
                    const sc = allCases.find(c => c.id === newDl.caseId);
                    return (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #cbd5e1", borderRadius: 6, padding: "7px 10px", background: "var(--c-bg)", cursor: "default" }}>
                        <span style={{ flex: 1, fontSize: 13, color: "var(--c-text)" }}>{sc?.defendantName || sc?.title || "Unknown"}{sc?.caseNum ? <span style={{ fontSize: 11, color: "#8A9096", marginLeft: 8 }}>{sc.caseNum}</span> : null}</span>
                        <button type="button" style={{ border: "none", background: "none", color: "#8A9096", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }} onClick={() => { setNewDl(p => ({ ...p, caseId: 0 })); setDlCaseSearch(""); setDlCaseDropOpen(true); }}>×</button>
                      </div>
                    );
                  })() : (
                    <div onBlur={e => { setTimeout(() => { if (!e.currentTarget.contains(document.activeElement)) setDlCaseDropOpen(false); }, 150); }} tabIndex={-1} style={{ outline: "none" }}>
                      <input
                        autoFocus={dlCaseDropOpen}
                        placeholder="Search by defendant name..."
                        value={dlCaseSearch}
                        onChange={e => { setDlCaseSearch(e.target.value); setDlCaseDropOpen(true); }}
                        onFocus={() => setDlCaseDropOpen(true)}
                        autoComplete="off"
                      />
                      {dlCaseDropOpen && (() => {
                        const q = dlCaseSearch.toLowerCase().trim();
                        const dlFiltered = [...allCases].filter(c => c.status === "Active").filter(c => !q || (c.defendantName || "").toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q) || (c.caseNum || "").toLowerCase().includes(q)).sort((a, b) => (a.defendantName || a.title || "").localeCompare(b.defendantName || b.title || ""));
                        const pIds = new Set(pinnedCaseIds);
                        const dlPinned = dlFiltered.filter(c => pIds.has(c.id));
                        const dlOthers = dlFiltered.filter(c => !pIds.has(c.id));
                        return (
                          <div style={{ position: "absolute", zIndex: 200, left: 0, right: 0, maxHeight: 260, overflowY: "auto", border: "1px solid #cbd5e1", borderRadius: 6, background: "var(--c-card)", boxShadow: "0 6px 20px rgba(0,0,0,0.18)", marginTop: 2 }}>
                            {dlFiltered.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: "#8A9096" }}>No matches</div>}
                            {dlPinned.length > 0 && <PinnedSectionHeader />}
                            {dlPinned.map(c => (
                              <div key={c.id} onMouseDown={e => { e.preventDefault(); setNewDl(p => ({ ...p, caseId: c.id })); setDlCaseSearch(""); setDlCaseDropOpen(false); }} style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--c-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }} onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                <span style={{ color: "var(--c-text)", fontWeight: 500 }}>{c.defendantName || c.title}</span>
                                {c.caseNum && <span style={{ fontSize: 10, color: "#8A9096", fontFamily: "monospace", flexShrink: 0, marginLeft: 8 }}>{c.caseNum}</span>}
                              </div>
                            ))}
                            {dlPinned.length > 0 && dlOthers.length > 0 && <div style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, color: "#5D6268", textTransform: "uppercase", letterSpacing: "0.06em", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border2)" }}>All Cases</div>}
                            {dlOthers.slice(0, 20).map(c => (
                              <div key={c.id} onMouseDown={e => { e.preventDefault(); setNewDl(p => ({ ...p, caseId: c.id })); setDlCaseSearch(""); setDlCaseDropOpen(false); }} style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--c-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }} onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                <span style={{ color: "var(--c-text)", fontWeight: 500 }}>{c.defendantName || c.title}</span>
                                {c.caseNum && <span style={{ fontSize: 10, color: "#8A9096", fontFamily: "monospace", flexShrink: 0, marginLeft: 8 }}>{c.caseNum}</span>}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
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
                    <div style={{ fontSize: 11, color: "#1E2A3A", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Result</div>
                    <div style={{ fontSize: 24, fontFamily: "'Playfair Display',serif", color: "var(--c-text-h)", marginBottom: 8 }}>{fmt(calcResult.result)}</div>
                    <div style={{ fontSize: 13, color: "var(--c-text2)" }}><strong style={{ color: "#1E2A3A" }}>{calcResult.rule.name}</strong><br />{calcResult.rule.days} days from {fmt(calcResult.from)} · <span style={{ fontFamily: "monospace", fontSize: 12 }}>{calcResult.rule.rule}</span></div>
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
                  <tbody>{COURT_RULES.map(r => <tr key={r.id}><td style={{ color: "var(--c-text)" }}>{r.name}</td><td style={{ color: "#1E2A3A", fontWeight: 700 }}>{r.days}</td><td style={{ fontSize: 12, color: "var(--c-text2)" }}>{r.from}</td><td style={{ fontFamily: "monospace", fontSize: 11, color: "#8A9096" }}>{r.rule}</td></tr>)}</tbody>
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
function TasksView({ tasks, onAddTask, allCases, currentUser, onCompleteTask, onUpdateTask, onMenuToggle, pinnedCaseIds }) {
  const [filter, setFilter] = useState("Open");
  const [showForm, setShowForm] = useState(false);
  const [caseSearch, setCaseSearch] = useState("");
  const [caseDropOpen, setCaseDropOpen] = useState(false);
  const [sortCol, setSortCol] = useState("due");
  const [sortDir, setSortDir] = useState("asc");
  const [expandedTask, setExpandedTask] = useState(null);

  const handleSort = (col) => { if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } };

  const sortedCases = useMemo(() => [...allCases].filter(c => c.status === "Active").sort((a, b) => (a.defendantName || a.title || "").localeCompare(b.defendantName || b.title || "")), [allCases]);
  const filteredCases = useMemo(() => { const q = caseSearch.toLowerCase(); return q ? sortedCases.filter(c => (c.defendantName || "").toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q) || (c.caseNum || "").toLowerCase().includes(q)) : sortedCases; }, [sortedCases, caseSearch]);
  const blank = useMemo(() => ({ caseId: 0, title: "", assigned: currentUser.id, due: addDays(today, 7), priority: "Low", autoEscalate: true, status: "Not Started", notes: "", recurring: false, recurringDays: 30, escalateMediumDays: 30, escalateHighDays: 14, escalateUrgentDays: 7 }), [currentUser.id]);
  const [newTask, setNewTask] = useState({ ...blank });

  const filtered = useMemo(() => {
    let list = tasks.filter(t => t.assigned === currentUser.id).filter(t => {
      if (filter === "Open")     return t.status !== "Completed";
      if (filter === "Overdue")  return t.status !== "Completed" && daysUntil(t.due) < 0;
      if (filter === "Urgent")   return ["Urgent", "High"].includes(getEffectivePriority(t)) && t.status !== "Completed";
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div><div className="topbar-title">Tasks</div><div className="topbar-subtitle">{tasks.filter(t => t.assigned === currentUser.id && t.status !== "Completed").length} open · {tasks.filter(t => t.assigned === currentUser.id && t.recurring).length} recurring · {tasks.filter(t => t.assigned === currentUser.id && t.status !== "Completed" && daysUntil(t.due) < 0).length} overdue</div></div>
        </div>
        <button className="btn btn-gold" onClick={() => setShowForm(!showForm)}>+ New Task</button>
      </div>
      <div className="content">
        <div className="tabs">
          {["All", "Open", "Urgent", "Overdue", "Recurring"].map(f => <div key={f} className={`tab ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>{f}</div>)}
        </div>

        {showForm && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-header"><div className="card-title">New Task</div></div>
            <div style={{ padding: 20 }}>
              <div className="form-group"><label>Task Title</label><input value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Describe the task…" /></div>
              <div className="form-group">
                <label>Case</label>
                <div style={{ position: "relative" }}>
                  {newTask.caseId && !caseDropOpen ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #cbd5e1", borderRadius: 6, padding: "7px 10px", background: "var(--c-bg)", cursor: "default" }}>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--c-text)" }}>{sortedCases.find(c => c.id === newTask.caseId)?.defendantName || sortedCases.find(c => c.id === newTask.caseId)?.title || "Unknown"}{sortedCases.find(c => c.id === newTask.caseId)?.caseNum ? <span style={{ fontSize: 11, color: "#8A9096", marginLeft: 8 }}>{sortedCases.find(c => c.id === newTask.caseId)?.caseNum}</span> : null}</span>
                      <button type="button" style={{ border: "none", background: "none", color: "#8A9096", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }} onClick={() => { setNewTask(p => ({ ...p, caseId: 0 })); setCaseSearch(""); setCaseDropOpen(true); }}>×</button>
                    </div>
                  ) : (
                    <div onBlur={e => { setTimeout(() => { if (!e.currentTarget.contains(document.activeElement)) setCaseDropOpen(false); }, 150); }} tabIndex={-1} style={{ outline: "none" }}>
                      <input
                        autoFocus={caseDropOpen}
                        placeholder="Search by style or case number…"
                        value={caseSearch}
                        onChange={e => { setCaseSearch(e.target.value); setCaseDropOpen(true); }}
                        onFocus={() => setCaseDropOpen(true)}
                        autoComplete="off"
                      />
                      {caseDropOpen && (() => {
                        const tPIds = new Set(pinnedCaseIds);
                        const tPinned = filteredCases.filter(c => tPIds.has(c.id));
                        const tOthers = filteredCases.filter(c => !tPIds.has(c.id));
                        return (
                        <div style={{ position: "absolute", zIndex: 200, left: 0, right: 0, maxHeight: 260, overflowY: "auto", border: "1px solid #cbd5e1", borderRadius: 6, background: "var(--c-card)", boxShadow: "0 6px 20px rgba(0,0,0,0.18)", marginTop: 2 }}>
                          {filteredCases.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: "#8A9096" }}>No matches</div>}
                          {tPinned.length > 0 && <PinnedSectionHeader />}
                          {tPinned.map(c => (
                            <div key={c.id} tabIndex={0} onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setNewTask(p => ({ ...p, caseId: c.id })); setCaseSearch(""); setCaseDropOpen(false); }} onClick={e => { e.preventDefault(); e.stopPropagation(); setNewTask(p => ({ ...p, caseId: c.id })); setCaseSearch(""); setCaseDropOpen(false); }} style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--c-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }} onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <span style={{ color: "var(--c-text)", fontWeight: 500 }}>{c.defendantName || c.title}</span>
                              {c.caseNum && <span style={{ fontSize: 10, color: "#8A9096", fontFamily: "monospace", flexShrink: 0, marginLeft: 8 }}>{c.caseNum}</span>}
                            </div>
                          ))}
                          {tPinned.length > 0 && tOthers.length > 0 && <div style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, color: "#5D6268", textTransform: "uppercase", letterSpacing: "0.06em", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border2)" }}>All Cases</div>}
                          {tOthers.map(c => (
                            <div key={c.id} tabIndex={0} onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setNewTask(p => ({ ...p, caseId: c.id })); setCaseSearch(""); setCaseDropOpen(false); }} onClick={e => { e.preventDefault(); e.stopPropagation(); setNewTask(p => ({ ...p, caseId: c.id })); setCaseSearch(""); setCaseDropOpen(false); }} style={{ padding: "10px 14px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid var(--c-border)", display: "flex", justifyContent: "space-between", alignItems: "center" }} onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                              <span style={{ color: "var(--c-text)", fontWeight: 500 }}>{c.defendantName || c.title}</span>
                              {c.caseNum && <span style={{ fontSize: 10, color: "#8A9096", fontFamily: "monospace", flexShrink: 0, marginLeft: 8 }}>{c.caseNum}</span>}
                            </div>
                          ))}
                        </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
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
                <div style={{ background: newTask.recurring ? "#f0fdf4" : "var(--c-bg)", border: `1px solid ${newTask.recurring ? "#44bbaa55" : "#D6D8DB"}`, borderRadius: 7, padding: "12px 14px", marginBottom: 8, transition: "all 0.2s" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: newTask.recurring ? 12 : 0 }}>
                    <div><div style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 600 }}>🔁 Recurring Task</div><div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>A new task is auto-generated when this one is checked off</div></div>
                    <Toggle on={newTask.recurring} onChange={() => setNewTask(p => ({ ...p, recurring: !p.recurring }))} color="#44bbaa" />
                  </div>
                  {newTask.recurring && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, color: "var(--c-text2)", whiteSpace: "nowrap" }}>Repeat every</span>
                      <input type="number" min={1} max={365} value={newTask.recurringDays} onChange={e => setNewTask(p => ({ ...p, recurringDays: Number(e.target.value) }))} style={{ width: 80 }} />
                      <span style={{ fontSize: 13, color: "var(--c-text2)" }}>days</span>
                      <span style={{ fontSize: 12, color: "#8A9096" }}>→ Next: {fmt(addDays(newTask.due, newTask.recurringDays))}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Auto-escalate */}
              <div className="form-group">
                <EscalateBox
                  on={newTask.autoEscalate}
                  onChange={() => setNewTask(p => ({ ...p, autoEscalate: !p.autoEscalate }))}
                  basePriority={newTask.priority}
                  mediumDays={newTask.escalateMediumDays}
                  highDays={newTask.escalateHighDays}
                  urgentDays={newTask.escalateUrgentDays}
                  onChangeDays={(field, val) => setNewTask(p => ({
                    ...p,
                    ...(field === "medium" ? { escalateMediumDays: val } : field === "high" ? { escalateHighDays: val } : { escalateUrgentDays: val }),
                  }))}
                />
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
            <table className="mobile-cards">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <SortTh col="title" label="Task" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortTh col="case" label="Case" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
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
                        <td data-label=""><div className={`checkbox ${done ? "done" : ""}`} onClick={() => onCompleteTask(t.id)}>{done && "✓"}</div></td>
                        <td data-label="Task">
                          <div style={{ color: "var(--c-text)", fontWeight: 600, textDecoration: done ? "line-through" : "none" }}>
                            {t.title}{t.recurring && <span className="rec-badge">🔁 {t.recurringDays}d</span>}{t.isChained && <span className="chain-badge">⛓ auto</span>}
                          </div>
                          {t.notes && <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>{t.notes}</div>}
                        </td>
                        <td data-label="Case" style={{ fontSize: 12, color: "var(--c-text2)", maxWidth: 200 }}>{cs?.title?.slice(0, 40) || `#${t.caseId}`}<div style={{ fontSize: 10, color: "#8A9096" }}>{cs?.caseNum}</div></td>
                        <td data-label="Assigned"><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar userId={t.assigned} size={24} /><span style={{ fontSize: 12, color: "var(--c-text2)" }}>{getUserById(t.assigned)?.name.split(" ")[0]}</span></div></td>
                        <td data-label="Due" style={{ color: urgencyColor(days), fontSize: 13, whiteSpace: "nowrap" }}>{fmt(t.due)}{days < 0 && !done && <div style={{ fontSize: 11, color: "#e05252" }}>{Math.abs(days)}d over</div>}</td>
                        <td data-label="Priority">
                          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <Badge label={ep} />
                            {t.autoEscalate && <span title={escalated ? `Escalated from ${t.priority}` : "Auto-escalate on"} style={{ fontSize: 11, cursor: "help" }}>🔺</span>}
                          </div>
                          {escalated && <div style={{ fontSize: 10, color: "#8A9096", marginTop: 2 }}>was {t.priority}</div>}
                        </td>
                        <td data-label="Status"><Badge label={done ? "Completed" : t.status} /></td>
                        <td data-label="">
                          <button
                            onClick={() => setExpandedTask(isExpanded ? null : t.id)}
                            style={{ background: "none", border: "none", color: isExpanded ? "#1E2A3A" : "#8A9096", cursor: "pointer", fontSize: 13, padding: "2px 6px", borderRadius: 3, minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}
                            title="Edit due date, priority, assignee"
                          >✎</button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${t.id}-edit`} style={{ background: "var(--c-hover)" }}>
                          <td />
                          <td colSpan={7} style={{ paddingBottom: 12, paddingTop: 4 }}>
                            <div className="task-inline-edit">
                              <label style={{ fontSize: 11, color: "#8A9096" }}>Due date</label>
                              <input
                                type="date"
                                value={t.due || ""}
                                onChange={e => onUpdateTask(t.id, { due: e.target.value })}
                              />
                              <label style={{ fontSize: 11, color: "#8A9096" }}>Priority</label>
                              <select
                                value={t.priority}
                                onChange={e => onUpdateTask(t.id, { priority: e.target.value })}
                              >
                                {["Urgent", "High", "Medium", "Low"].map(p => <option key={p}>{p}</option>)}
                              </select>
                              <label style={{ fontSize: 11, color: "#8A9096" }}>Assigned to</label>
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
                            {t.autoEscalate && (
                              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 11, color: "#8A9096" }}>Escalation thresholds:</span>
                                <label style={{ fontSize: 11, color: "#8A9096", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  Medium ≤
                                  <input type="number" min={1} value={t.escalateMediumDays ?? 30} onChange={e => onUpdateTask(t.id, { escalateMediumDays: parseInt(e.target.value) || 30 })} style={{ width: 40, fontSize: 11, padding: "2px 4px", border: "1px solid #D6D8DB", borderRadius: 3, textAlign: "center" }} />d
                                </label>
                                <label style={{ fontSize: 11, color: "#8A9096", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  High ≤
                                  <input type="number" min={1} value={t.escalateHighDays ?? 14} onChange={e => onUpdateTask(t.id, { escalateHighDays: parseInt(e.target.value) || 14 })} style={{ width: 40, fontSize: 11, padding: "2px 4px", border: "1px solid #D6D8DB", borderRadius: 3, textAlign: "center" }} />d
                                </label>
                                <label style={{ fontSize: 11, color: "#8A9096", display: "inline-flex", alignItems: "center", gap: 3 }}>
                                  Urgent ≤
                                  <input type="number" min={1} value={t.escalateUrgentDays ?? 7} onChange={e => onUpdateTask(t.id, { escalateUrgentDays: parseInt(e.target.value) || 7 })} style={{ width: 40, fontSize: 11, padding: "2px 4px", border: "1px solid #D6D8DB", borderRadius: 3, textAlign: "center" }} />d
                                </label>
                              </div>
                            )}
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
    params: ["courtDivision"],
  },
  {
    id: "attorney",
    icon: "👤",
    title: "Cases by Attorney",
    desc: "All cases assigned to a selected attorney as lead or second chair, grouped by status.",
    params: ["attorney"],
  },
  {
    id: "nextCourt",
    icon: "🤝",
    title: "Next Court Date Report",
    desc: "Active cases with a next court date, sorted soonest first. Includes judge and days remaining.",
    params: ["courtDivision"],
  },
  {
    id: "discovery",
    icon: "🔍",
    title: "Cases by Upcoming Dates",
    desc: "Cases with arraignment or next court date deadlines within the specified window.",
    params: ["window", "courtDivision"],
  },
  {
    id: "task_filter",
    icon: "✅",
    title: "Cases with Specific Open Task",
    desc: "Select an incomplete task type from the list and see all cases that have that task open.",
    params: ["task", "courtDivision"],
  },
  {
    id: "no_trial",
    icon: "📋",
    title: "Active Cases Without Trial Date",
    desc: "Cases currently active but with no trial date set — useful for tracking docket gaps.",
    params: ["office"],
  },
  {
    id: "overdue_tasks",
    icon: "🔴",
    title: "Overdue Tasks by Case",
    desc: "All cases that have at least one overdue task, with a breakdown of each overdue item.",
    params: ["courtDivision"],
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
    params: ["window", "courtDivision"],
  },
  {
    id: "answer_due",
    icon: "📝",
    title: "Cases by Arrest Date",
    desc: "Cases sorted by arrest date. Useful for tracking case timelines and reviewing recent arrests.",
    params: ["courtDivision"],
  },
];

function buildReport(id, allCases, tasks, deadlines, params) {
  const courtDivision = params.courtDivision || null;
  const filteredCases = courtDivision ? allCases.filter(c => c.courtDivision === courtDivision) : allCases;
  const filteredDeadlines = courtDivision ? deadlines.filter(d => {
    const c = allCases.find(x => x.id === d.caseId);
    return c && c.courtDivision === courtDivision;
  }) : deadlines;
  const activeCases = filteredCases.filter(c => c.status === "Active");
  allCases = filteredCases;
  deadlines = filteredDeadlines;
  switch (id) {
    case "trial_date": {
      const rows = activeCases.filter(c => c.trialDate).sort((a, b) => a.trialDate.localeCompare(b.trialDate));
      return {
        columns: ["Case Number", "Style", "Trial Date", "Days", "Judge", "Assigned Attorney", "Stage"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          fmt(c.trialDate),
          daysUntil(c.trialDate) !== null ? `${daysUntil(c.trialDate)}d` : "—",
          c.judge || "—",
          getUserById(c.assignedAttorney)?.name || "—",
          c.stage || "—",
        ]),
        caseIds: rows.map(c => c.id),
        colorCol: 3,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "attorney": {
      const uid = params.attorney;
      const rows = allCases.filter(c => c.assignedAttorney === uid || c.secondAttorney === uid).sort((a, b) => (a.status + a.title).localeCompare(b.status + b.title));
      return {
        columns: ["Case Number", "Style", "Status", "Stage", "Trial Date", "Role"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          c.status,
          c.stage || "—",
          fmt(c.trialDate),
          c.assignedAttorney === uid ? "Lead" : "2nd Chair",
        ]),
        caseIds: rows.map(c => c.id),
        count: rows.length,
      };
    }
    case "nextCourt": {
      const rows = activeCases.filter(c => c.nextCourtDate).sort((a, b) => a.nextCourtDate.localeCompare(b.nextCourtDate));
      return {
        columns: ["Case Number", "Style", "Next Court Date", "Days", "Judge", "Assigned Attorney"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          fmt(c.nextCourtDate),
          daysUntil(c.nextCourtDate) !== null ? `${daysUntil(c.nextCourtDate)}d` : "—",
          c.judge || "—",
          getUserById(c.assignedAttorney)?.name || "—",
        ]),
        caseIds: rows.map(c => c.id),
        colorCol: 3,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "discovery": {
      const win = params.window || 90;
      const rows = [];
      activeCases.forEach(c => {
        const fields = [["Arraignment", c.arraignmentDate], ["Next Court Date", c.nextCourtDate]];
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
        columns: ["Case Number", "Style", "Deadline Type", "Date", "Days", "Assigned Attorney"],
        rows: rows.map(({ c, label, date, d }) => [
          c.caseNum || "—",
          c.title,
          label,
          fmt(date),
          `${d}d`,
          getUserById(c.assignedAttorney)?.name || "—",
        ]),
        caseIds: rows.map(({ c }) => c.id),
        colorCol: 4,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: rows.length,
      };
    }
    case "task_filter": {
      const taskTitle = params.task;
      if (!taskTitle) return { columns: [], rows: [], count: 0, caseIds: [] };
      const matchingTasks = tasks.filter(t => t.title === taskTitle && t.status !== "Completed");
      const tfCaseIds = [...new Set(matchingTasks.map(t => t.caseId))];
      const tfEntries = tfCaseIds.map(cid => {
        const c = allCases.find(x => x.id === cid);
        const t = matchingTasks.find(x => x.caseId === cid);
        if (!c) return null;
        return { row: [c.caseNum || "—", c.title, c.status, fmt(t?.due), `${daysUntil(t?.due) ?? "—"}d`, getUserById(t?.assigned)?.name || "—", getEffectivePriority(t)], caseId: c.id };
      }).filter(Boolean).sort((a, b) => (a.row[3] || "").localeCompare(b.row[3] || ""));
      return {
        columns: ["Case Number", "Style", "Status", "Task Due", "Days", "Assigned To", "Priority"],
        rows: tfEntries.map(e => e.row),
        caseIds: tfEntries.map(e => e.caseId),
        colorCol: 4,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: tfEntries.length,
      };
    }
    case "no_trial": {
      const rows = activeCases.filter(c => !c.trialDate).sort((a, b) => a.title.localeCompare(b.title));
      return {
        columns: ["Case Number", "Style", "Stage", "Arrest Date", "Assigned Attorney", "Case Type"],
        rows: rows.map(c => [
          c.caseNum || "—",
          c.title,
          c.stage || "—",
          fmt(c.arrestDate),
          getUserById(c.assignedAttorney)?.name || "—",
          c.caseType || "—",
        ]),
        caseIds: rows.map(c => c.id),
        count: rows.length,
      };
    }
    case "overdue_tasks": {
      const overdue = tasks.filter(t => t.status !== "Completed" && daysUntil(t.due) < 0);
      const byCaseId = {};
      overdue.forEach(t => { if (!byCaseId[t.caseId]) byCaseId[t.caseId] = []; byCaseId[t.caseId].push(t); });
      const otRows = [];
      const otCaseIds = [];
      Object.entries(byCaseId).sort((a, b) => b[1].length - a[1].length).forEach(([cid, ts]) => {
        const c = allCases.find(x => x.id === Number(cid));
        if (!c) return;
        ts.sort((a, b) => (a.due || "").localeCompare(b.due || "")).forEach(t => {
          otRows.push([c.caseNum || "—", c.title, t.title, fmt(t.due), `${Math.abs(daysUntil(t.due))}d over`, getUserById(t.assigned)?.name || "—", getEffectivePriority(t)]);
          otCaseIds.push(c.id);
        });
      });
      return {
        columns: ["Case Number", "Style", "Task", "Was Due", "Overdue By", "Assigned To", "Priority"],
        rows: otRows,
        caseIds: otCaseIds,
        colorCol: 4,
        colorFn: () => "#e05252",
        count: otRows.length,
      };
    }
    case "workload": {
      const rows = USERS.map(u => {
        const lead = allCases.filter(c => c.assignedAttorney === u.id);
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
      const udEntries = deadlines.filter(d => { const n = daysUntil(d.date); return n !== null && n >= 0 && n <= win; })
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(d => {
          const c = allCases.find(x => x.id === d.caseId);
          const days = daysUntil(d.date);
          return { row: [c?.caseNum || "—", c?.title?.slice(0, 50) || `#${d.caseId}`, d.title, d.type || "—", fmt(d.date), `${days}d`, getUserById(d.assigned)?.name || "—"], caseId: d.caseId };
        });
      return {
        columns: ["Case Number", "Style", "Deadline", "Type", "Date", "Days", "Assigned"],
        rows: udEntries.map(e => e.row),
        caseIds: udEntries.map(e => e.caseId),
        colorCol: 5,
        colorFn: (val) => urgencyColor(parseInt(val)),
        count: udEntries.length,
      };
    }
    case "answer_due": {
      const rows = allCases.filter(c => c.arrestDate).sort((a, b) => b.arrestDate.localeCompare(a.arrestDate));
      return {
        columns: ["Case Number", "Style", "Arrest Date", "Status", "Stage", "Assigned Attorney", "Defendant"],
        rows: rows.map(c => [c.caseNum || "—", c.title, fmt(c.arrestDate), c.status, c.stage || "—", getUserById(c.assignedAttorney)?.name || "—", c.defendantName || "—"]),
        caseIds: rows.map(c => c.id),
        count: rows.length,
      };
    }
    default:
      return { columns: [], rows: [], count: 0 };
  }
}

function ReportsView({ allCases, tasks, deadlines, currentUser, onUpdateCase, onCompleteTask, onAddTask, onDeleteCase, caseNotes, setCaseNotes, caseLinks, setCaseLinks, caseActivity, setCaseActivity, onAddDeadline, onUpdateDeadline, onMenuToggle }) {
  const [activeReport, setActiveReport] = useState(null);
  const [params, setParams] = useState({});
  const [generated, setGenerated] = useState(null);
  const [selectedCase, setSelectedCase] = useState(null);

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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div>
            <div className="topbar-title">Reports</div>
            <div className="topbar-subtitle">Generate and export case reports</div>
          </div>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px,100%), 1fr))", gap: 12, marginBottom: 24 }}>
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
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "var(--c-text-h)", marginBottom: 4 }}>{def?.icon} {def?.title}</div>
                <div style={{ fontSize: 12, color: "#8A9096" }}>{def?.desc}</div>
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
                {def?.params.includes("courtDivision") && (
                  <div className="form-group" style={{ marginBottom: 0, minWidth: 160 }}>
                    <label>Court Division</label>
                    <select value={params.courtDivision || ""} onChange={e => setParams(p => ({ ...p, courtDivision: e.target.value || null }))}>
                      <option value="">All Divisions</option>
                      {["Circuit", "District", "Juvenile"].map(d => <option key={d} value={d}>{d}</option>)}
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
                  {generated.params.courtDivision ? ` · Division: ${generated.params.courtDivision}` : ""}
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
                <table className="mobile-cards">
                  <thead>
                    <tr>{generated.columns.map((col, i) => <th key={i}>{col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {generated.rows.map((row, ri) => {
                      const caseId = generated.caseIds?.[ri];
                      const clickable = !!caseId;
                      const handleRowClick = clickable ? () => {
                        const c = allCases.find(x => x.id === caseId);
                        if (c) setSelectedCase(c);
                      } : undefined;
                      return (
                      <tr key={ri} onClick={handleRowClick} className={clickable ? "clickable-row" : ""} style={clickable ? { cursor: "pointer" } : undefined}>
                        {row.map((cell, ci) => {
                          const isColored = generated.colorCol === ci && generated.colorFn;
                          const color = isColored ? generated.colorFn(cell) : undefined;
                          const isStatus = generated.columns[ci] === "Status" || generated.columns[ci] === "Role" || generated.columns[ci] === "Stage" || generated.columns[ci] === "Priority" || generated.columns[ci] === "Type";
                          return (
                            <td key={ci} data-label={generated.columns[ci] || ""} style={{ color: color || undefined }}>
                              {isStatus && cell && cell !== "—" ? <Badge label={cell} /> : (
                                <span style={{ fontWeight: ci === 1 ? 600 : 400, color: color || (ci === 1 ? "var(--c-text)" : undefined), fontFamily: ci === 0 ? "monospace" : undefined, fontSize: ci === 0 ? 11 : undefined }}>{cell || "—"}</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Summary footer */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--c-border)", display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, color: "#8A9096" }}>
                <strong style={{ color: "#1E2A3A" }}>{generated.count}</strong> total records
              </div>
              {generated.reportId === "workload" && (() => {
                const totalActive = allCases.filter(c => c.status === "Active").length;
                return <div style={{ fontSize: 12, color: "#8A9096" }}><strong style={{ color: "#1E2A3A" }}>{totalActive}</strong> total active cases across firm</div>;
              })()}
              {generated.reportId === "overdue_tasks" && (() => {
                const caseCount = new Set(generated.rows.map(r => r[0])).size;
                return <div style={{ fontSize: 12, color: "#8A9096" }}><strong style={{ color: "#e05252" }}>{caseCount}</strong> cases affected</div>;
              })()}
              {(generated.reportId === "trial_date" || generated.reportId === "discovery" || generated.reportId === "upcoming_deadlines") && (() => {
                const urgent = generated.rows.filter(r => { const v = parseInt(r[generated.colorCol]); return !isNaN(v) && v <= 14; }).length;
                if (urgent === 0) return null;
                return <div style={{ fontSize: 12, color: "#8A9096" }}><strong style={{ color: "#e07a30" }}>{urgent}</strong> within 14 days</div>;
              })()}
              <div style={{ marginLeft: "auto", fontSize: 11, color: "#D6D8DB" }}>MattrMindr · {generated.generatedAt} · {currentUser.name}</div>
            </div>
          </div>
        )}
      </div>

      {selectedCase && (() => {
        const caseTasks = tasks.filter(t => t.caseId === selectedCase.id);
        const caseDeadlines = deadlines.filter(d => d.caseId === selectedCase.id);
        const notes = caseNotes[selectedCase.id] || [];
        return (
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
            onDeleteCase={(id) => { onDeleteCase(id); setSelectedCase(null); }}
            onCompleteTask={onCompleteTask}
            onAddTask={onAddTask}
            onAddNote={async (note) => { try { const saved = await apiCreateNote(note); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: [saved, ...(prev[selectedCase.id] || [])] })); } catch (err) { alert("Failed to save note: " + err.message); } }}
            onDeleteNote={async (noteId) => { try { await apiDeleteNote(noteId); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).filter(n => n.id !== noteId) })); } catch (err) { alert("Failed to delete note: " + err.message); } }}
            onUpdateNote={async (noteId, data) => { try { const updated = await apiUpdateNote(noteId, data); setCaseNotes(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).map(n => n.id === noteId ? updated : n) })); } catch (err) { alert("Failed to update note: " + err.message); throw err; } }}
            onAddLink={async (link) => { try { const saved = await apiCreateLink(link); setCaseLinks(prev => ({ ...prev, [selectedCase.id]: [...(prev[selectedCase.id] || []), saved] })); } catch (err) { alert("Failed to save link: " + err.message); } }}
            onDeleteLink={async (linkId) => { try { await apiDeleteLink(linkId); setCaseLinks(prev => ({ ...prev, [selectedCase.id]: (prev[selectedCase.id] || []).filter(l => l.id !== linkId) })); } catch (err) { alert("Failed to delete link: " + err.message); } }}
            onLogActivity={async (entry) => { try { const saved = await apiCreateActivity(entry); setCaseActivity(prev => ({ ...prev, [selectedCase.id]: [saved, ...(prev[selectedCase.id] || [])] })); } catch (err) { console.error("Failed to log activity:", err); } }}
            onRefreshActivity={(caseId, fresh) => setCaseActivity(prev => ({ ...prev, [caseId]: fresh }))}
            onAddDeadline={onAddDeadline}
            onUpdateDeadline={onUpdateDeadline}
          />
        );
      })()}
    </>
  );
}

// ─── AI Center View ───────────────────────────────────────────────────────────
const TRAINING_CATEGORIES = ["General", "Local Rules", "Office Policy", "Defense Strategy", "Court Preferences", "Sentencing", "Procedures"];
const OFFICE_ROLES = ["Public Defender","Chief Deputy Public Defender","Deputy Public Defender","Senior Trial Attorney","App Admin"];

function AiCenterView({ allCases, currentUser, onMenuToggle, pinnedCaseIds }) {
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [activeAgent, setActiveAgent] = useState(null);
  const [aiState, setAiState] = useState({ loading: false, result: null, error: null });
  const [aiCenterTab, setAiCenterTab] = useState("agents");
  const [trainingEntries, setTrainingEntries] = useState([]);
  const [trainingLoaded, setTrainingLoaded] = useState(false);
  const [trainingTab, setTrainingTab] = useState("personal");
  const [showAddTraining, setShowAddTraining] = useState(false);
  const [addMode, setAddMode] = useState("text");
  const [addForm, setAddForm] = useState({ title: "", content: "", category: "General", scope: "personal" });
  const [addFile, setAddFile] = useState(null);
  const [addSaving, setAddSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const canOffice = (currentUser?.roles || []).some(r => OFFICE_ROLES.includes(r));
  const [docType, setDocType] = useState("Motion to Suppress");
  const [docTypeCustom, setDocTypeCustom] = useState("");
  const [docInstructions, setDocInstructions] = useState("");
  const [aiCenterTasks, setAiCenterTasks] = useState({ tasks: [], added: {} });
  const [docSummaryText, setDocSummaryText] = useState("");
  const [docSummaryType, setDocSummaryType] = useState("Police Report");
  const [aiCenterFilings, setAiCenterFilings] = useState([]);
  const [aiCenterSelectedFiling, setAiCenterSelectedFiling] = useState("");
  const [aiCenterFilingResult, setAiCenterFilingResult] = useState(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [caseDropOpen, setCaseDropOpen] = useState(false);

  const activeCases = allCases.filter(c => c.status !== "Closed");
  const selectedCase = allCases.find(c => String(c.id) === String(selectedCaseId));

  const agents = [
    { id: "triage", icon: "🚨", title: "Case Triage", desc: "Rank active cases by urgency — death penalty, trial dates, custody status, overdue tasks.", needsCase: false },
    { id: "charge", icon: "⚖️", title: "Charge Analysis", desc: "Analyze charges under Alabama Code — sentencing ranges, mandatory minimums, diversion eligibility.", needsCase: true },
    { id: "strategy", icon: "🧠", title: "Case Strategy", desc: "Full defense strategy analysis — motions, plea negotiations, sentencing exposure, investigation priorities.", needsCase: true },
    { id: "deadlines", icon: "📅", title: "Deadline Generator", desc: "Generate procedural deadlines based on Alabama Rules of Criminal Procedure and case stage.", needsCase: true },
    { id: "draft", icon: "📝", title: "Document Drafting", desc: "Generate first drafts of motions, pleas, and memoranda tailored to your case.", needsCase: true },
    { id: "summary", icon: "💬", title: "Client Communication", desc: "Plain-language case status update suitable for sharing with clients and families.", needsCase: true },
    { id: "docsummary", icon: "📋", title: "Document Summary", desc: "Summarize police reports, witness statements, lab reports, and other case documents for defense-relevant details.", needsCase: true },
    { id: "tasksuggestions", icon: "✅", title: "Task Suggestions", desc: "Suggest concrete defense tasks based on case stage, charges, deadlines, and existing work — one-click to add.", needsCase: true },
    { id: "filingclassifier", icon: "📁", title: "Filing Classifier", desc: "Classify court filings — auto-name, identify filing party (State, Defendant, Court), and summarize significance.", needsCase: true },
  ];

  const BATCH_ALLOWED_ROLES = ["Public Defender", "Chief Deputy Public Defender", "Deputy Public Defender", "Senior Trial Attorney", "IT Specialist", "App Admin"];
  const canBatch = (currentUser?.roles || []).some(r => BATCH_ALLOWED_ROLES.includes(r));
  if (canBatch) {
    agents.push({ id: "batch", icon: "🔄", title: "Batch Case Manager", desc: "Perform bulk operations — reassign staff, change statuses, advance stages, update court dates, transfer divisions.", needsCase: false });
  }

  const [batchOp, setBatchOp] = useState("reassign-staff");
  const [batchParams, setBatchParams] = useState({});
  const [batchPreview, setBatchPreview] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchApplied, setBatchApplied] = useState(null);
  const [batchStaffList, setBatchStaffList] = useState([]);
  const [batchCaseSearch, setBatchCaseSearch] = useState("");
  const [batchSelectedCases, setBatchSelectedCases] = useState([]);
  const [batchFromStaffInput, setBatchFromStaffInput] = useState("");
  const [batchFromStaffFocused, setBatchFromStaffFocused] = useState(false);
  const [batchToStaffInput, setBatchToStaffInput] = useState("");
  const [batchToStaffFocused, setBatchToStaffFocused] = useState(false);
  const batchFromRef = useRef(null);
  const batchToRef = useRef(null);

  const runAgent = async (agentId) => {
    setAiState({ loading: true, result: null, error: null });
    try {
      let r;
      if (agentId === "triage") {
        r = await apiCaseTriage();
      } else if (agentId === "charge") {
        r = await apiChargeAnalysis({ caseId: Number(selectedCaseId) });
      } else if (agentId === "strategy") {
        r = await apiCaseStrategy({ caseId: Number(selectedCaseId) });
      } else if (agentId === "deadlines") {
        const dlRes = await apiDeadlineGenerator({ caseId: Number(selectedCaseId) });
        const dls = dlRes.deadlines || [];
        r = { result: dls.length ? dls.map((d, i) => `**${i + 1}. ${d.title}**\nDate: ${d.date}\nRule: ${d.rule || "—"}\nType: ${d.type || "—"}\n`).join("\n") : "No deadlines generated." };
      } else if (agentId === "draft") {
        const effectiveDocType = docType === "Other" ? (docTypeCustom.trim() || "Other Document") : docType;
        r = await apiDraftDocument({ caseId: Number(selectedCaseId), documentType: effectiveDocType, customInstructions: docInstructions });
      } else if (agentId === "summary") {
        r = await apiClientSummary({ caseId: Number(selectedCaseId) });
      } else if (agentId === "docsummary") {
        if (!docSummaryText.trim()) throw new Error("Please paste document text to summarize.");
        r = await apiDocSummary({ text: docSummaryText, docType: docSummaryType, caseTitle: selectedCase?.title || "", defendantName: selectedCase?.defendantName || "" });
      } else if (agentId === "tasksuggestions") {
        const tsRes = await apiTaskSuggestions({ caseId: Number(selectedCaseId) });
        const tks = tsRes.tasks || [];
        setAiCenterTasks({ tasks: tks, added: {} });
        r = { result: tks.length ? "__TASK_SUGGESTIONS__" : "No tasks suggested for this case." };
      } else if (agentId === "filingclassifier") {
        if (!aiCenterSelectedFiling) throw new Error("Please select a filing to classify.");
        const clRes = await apiClassifyFiling(Number(aiCenterSelectedFiling));
        setAiCenterFilingResult(clRes.classification);
        setAiCenterFilings(prev => prev.map(f => f.id === Number(aiCenterSelectedFiling) ? { ...f, filename: clRes.classification.suggestedName || f.filename, filedBy: clRes.classification.filedBy || f.filedBy, docType: clRes.classification.docType || f.docType, summary: clRes.classification.summary || f.summary } : f));
        r = { result: "__FILING_CLASSIFIER__" };
      }
      setAiState({ loading: false, result: r.result, error: null });
    } catch (e) {
      setAiState({ loading: false, result: null, error: e.message });
    }
  };

  const selectAgent = (agentId) => {
    setActiveAgent(agentId);
    setAiState({ loading: false, result: null, error: null });
    setDocType("Motion to Suppress");
    setDocTypeCustom("");
    setDocInstructions("");
    setDocSummaryText("");
    setDocSummaryType("Police Report");
    setAiCenterFilings([]);
    setAiCenterSelectedFiling("");
    setBatchOp("reassign-staff");
    setBatchParams({});
    setBatchPreview(null);
    setBatchLoading(false);
    setBatchApplied(null);
    setBatchCaseSearch("");
    setBatchSelectedCases([]);
    setBatchFromStaffInput("");
    setBatchFromStaffFocused(false);
    setBatchToStaffInput("");
    setBatchToStaffFocused(false);
    if (agentId === "batch" && batchStaffList.length === 0) {
      apiGetUsers().then(users => setBatchStaffList(users.filter(u => u.active !== false))).catch(() => {});
    }
    setAiCenterFilingResult(null);
    setCaseSearch("");
    setCaseDropOpen(false);
  };

  useEffect(() => {
    if (activeAgent === "filingclassifier" && selectedCaseId) {
      apiGetFilings(Number(selectedCaseId)).then(setAiCenterFilings).catch(() => setAiCenterFilings([]));
    }
  }, [activeAgent, selectedCaseId]);

  useEffect(() => {
    if (aiCenterTab === "trainer" && !trainingLoaded) {
      apiGetTraining().then(entries => { setTrainingEntries(entries); setTrainingLoaded(true); }).catch(() => setTrainingLoaded(true));
    }
  }, [aiCenterTab, trainingLoaded]);

  const loadTraining = () => apiGetTraining().then(setTrainingEntries).catch(err => console.error("Load training error:", err));

  const handleAddTraining = async () => {
    if (!addForm.title.trim()) return alert("Title is required");
    if (addMode === "text" && !addForm.content.trim()) return alert("Content is required");
    if (addMode !== "text" && !addFile) return alert("Please select a file");
    setAddSaving(true);
    try {
      let newEntry;
      if (addMode === "text") {
        newEntry = await apiCreateTraining(addForm);
      } else {
        const fd = new FormData();
        fd.append("file", addFile);
        fd.append("title", addForm.title);
        fd.append("category", addForm.category);
        fd.append("scope", addForm.scope);
        newEntry = await apiUploadTrainingDoc(fd);
      }
      if (newEntry && newEntry.id) {
        setTrainingEntries(prev => [{ ...newEntry, created_by_name: currentUser?.name || "" }, ...prev]);
      }
      setShowAddTraining(false);
      setAddForm({ title: "", content: "", category: "General", scope: "personal" });
      setAddFile(null);
      setAddMode("text");
      loadTraining();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setAddSaving(false);
    }
  };

  const handleToggleActive = async (entry) => {
    try {
      await apiUpdateTraining(entry.id, { active: !entry.active });
      setTrainingEntries(p => p.map(e => e.id === entry.id ? { ...e, active: !e.active } : e));
    } catch (e) { alert("Error: " + e.message); }
  };

  const handleDeleteTraining = async (id) => {
    if (!window.confirm("Delete this training entry?")) return;
    try {
      await apiDeleteTraining(id);
      setTrainingEntries(p => p.filter(e => e.id !== id));
    } catch (e) { alert("Error: " + e.message); }
  };

  const handleSaveEdit = async (id) => {
    try {
      await apiUpdateTraining(id, editForm);
      setTrainingEntries(p => p.map(e => e.id === id ? { ...e, ...editForm } : e));
      setEditingId(null);
    } catch (e) { alert("Error: " + e.message); }
  };

  const needsCase = activeAgent && agents.find(a => a.id === activeAgent)?.needsCase;
  const canRun = activeAgent && (!needsCase || selectedCaseId);

  return (
    <>
      <div className="topbar">
        <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
        <div>
          <div className="topbar-title">AI Center</div>
          <div className="topbar-subtitle">Centralized AI-powered analysis tools</div>
        </div>
      </div>
      <div className="content" style={{ maxWidth: 900 }}>
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid var(--c-border)" }}>
          <button onClick={() => setAiCenterTab("agents")} style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: "none", color: aiCenterTab === "agents" ? "#b8860b" : "var(--c-text2)", borderBottom: aiCenterTab === "agents" ? "2px solid #b8860b" : "2px solid transparent", marginBottom: -2, transition: "all 0.15s" }}>AI Agents</button>
          <button onClick={() => setAiCenterTab("trainer")} style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: "none", color: aiCenterTab === "trainer" ? "#6366f1" : "var(--c-text2)", borderBottom: aiCenterTab === "trainer" ? "2px solid #6366f1" : "2px solid transparent", marginBottom: -2, transition: "all 0.15s" }}>🧠 AI Trainer</button>
        </div>

        {aiCenterTab === "agents" && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px,100%), 1fr))", gap: 14, marginBottom: 24 }}>
          {agents.map(a => (
            <div key={a.id} onClick={() => selectAgent(a.id)} style={{
              background: activeAgent === a.id ? "linear-gradient(135deg, #f8f6f0, #f3f0e8)" : "var(--c-card)",
              border: activeAgent === a.id ? "2px solid #b8860b" : "1px solid var(--c-border)",
              borderRadius: 10, padding: "16px 18px", cursor: "pointer",
              transition: "all 0.15s ease",
            }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{a.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--c-text-h)", marginBottom: 4 }}>{a.title}</div>
              <div style={{ fontSize: 12, color: "var(--c-text2)", lineHeight: 1.5 }}>{a.desc}</div>
              {a.needsCase && <div style={{ fontSize: 10, color: "#b8860b", marginTop: 6, fontWeight: 500 }}>Requires case selection</div>}
            </div>
          ))}
        </div>

        {activeAgent && (
          <div style={{ background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: 10, padding: "20px 24px" }}>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 17, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{agents.find(a => a.id === activeAgent)?.icon}</span>
              {agents.find(a => a.id === activeAgent)?.title}
            </div>

            {needsCase && (
              <div style={{ marginBottom: 16, position: "relative" }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Search Case</label>
                {selectedCase ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)" }}>
                    <div style={{ flex: 1, fontSize: 13, color: "var(--c-text)" }}>
                      <strong>{selectedCase.defendantName || selectedCase.title}</strong>
                      <span style={{ color: "var(--c-text2)", marginLeft: 6, fontSize: 11 }}>{selectedCase.stage} · {selectedCase.caseType}{selectedCase.deathPenalty ? " · " : ""}</span>
                      {selectedCase.deathPenalty && <span style={{ color: "#dc2626", fontWeight: 700, fontSize: 11 }}>DP</span>}
                    </div>
                    <button onClick={() => { setSelectedCaseId(""); setCaseSearch(""); setAiState({ loading: false, result: null, error: null }); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#8A9096", padding: "0 2px" }}>✕</button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={caseSearch}
                      onChange={e => { setCaseSearch(e.target.value); setCaseDropOpen(true); }}
                      onFocus={() => setCaseDropOpen(true)}
                      placeholder="Type defendant name to search..."
                      style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }}
                    />
                    {caseDropOpen && (() => {
                      const q = caseSearch.toLowerCase().trim();
                      const filtered = (q ? activeCases.filter(c => (c.defendantName || "").toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q) || (c.caseNumber || "").toLowerCase().includes(q)) : activeCases).sort((a, b) => (a.defendantName || a.title || "").localeCompare(b.defendantName || b.title || ""));
                      const aiPIds = new Set(pinnedCaseIds);
                      const aiPinned = filtered.filter(c => aiPIds.has(c.id));
                      const aiOthers = filtered.filter(c => !aiPIds.has(c.id));
                      const selectCase = (c) => { setSelectedCaseId(String(c.id)); setCaseSearch(""); setCaseDropOpen(false); setAiState({ loading: false, result: null, error: null }); };
                      const aiItem = (c) => (
                        <div key={c.id} onClick={() => selectCase(c)} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--c-text)", borderBottom: "1px solid var(--c-border)" }} onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div style={{ fontWeight: 500 }}>{c.defendantName || c.title}</div>
                          <div style={{ fontSize: 11, color: "var(--c-text2)" }}>{c.caseNumber || "—"} · {c.stage} · {c.caseType}{c.deathPenalty ? " · " : ""}{c.deathPenalty && <span style={{ color: "#dc2626", fontWeight: 700 }}>DP</span>}</div>
                        </div>
                      );
                      return (aiPinned.length > 0 || aiOthers.length > 0) ? (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: "0 0 6px 6px", maxHeight: 260, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                          {aiPinned.length > 0 && <PinnedSectionHeader />}
                          {aiPinned.map(aiItem)}
                          {aiPinned.length > 0 && aiOthers.length > 0 && <div style={{ padding: "5px 10px", fontSize: 10, fontWeight: 700, color: "#5D6268", textTransform: "uppercase", letterSpacing: "0.06em", background: "var(--c-bg)", borderBottom: "1px solid var(--c-border2)" }}>All Cases</div>}
                          {aiOthers.slice(0, 20).map(aiItem)}
                        </div>
                      ) : q ? (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: "0 0 6px 6px", padding: "12px", fontSize: 12, color: "var(--c-text2)", textAlign: "center" }}>No matching cases</div>
                      ) : null;
                    })()}
                  </>
                )}
              </div>
            )}

            {activeAgent === "draft" && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Document Type</label>
                  <select value={docType} onChange={e => { setDocType(e.target.value); if (e.target.value !== "Other") setDocTypeCustom(""); }} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)" }}>
                    {["Motion to Suppress", "Motion to Dismiss", "Bond Reduction Motion", "Continuance Request", "Discovery Demand", "Plea Agreement Draft", "Sentencing Memorandum", "Motion for Speedy Trial", "Other"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                {docType === "Other" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Specify Document Type</label>
                    <input type="text" value={docTypeCustom} onChange={e => setDocTypeCustom(e.target.value)} placeholder="e.g. Habeas Corpus Petition, Expungement Motion, Subpoena..." style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)" }} />
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Additional Instructions (optional)</label>
                  <textarea value={docInstructions} onChange={e => setDocInstructions(e.target.value)} style={{ width: "100%", minHeight: 60, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 12, resize: "vertical", fontFamily: "inherit", background: "var(--c-bg)", color: "var(--c-text)" }} placeholder="e.g. Focus on Fourth Amendment issues, include specific facts about the traffic stop..." />
                </div>
              </>
            )}

            {activeAgent === "docsummary" && (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Document Type</label>
                  <select value={docSummaryType} onChange={e => setDocSummaryType(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)" }}>
                    {["Police Report", "Witness Statement", "Lab/Forensic Report", "Mental Health Evaluation", "Prior Record/PSI", "Discovery Material", "Medical Records", "Body Cam/Dash Cam Transcript", "Court Order", "Plea Agreement", "Expert Report", "Other"].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Paste Document Text</label>
                  <textarea value={docSummaryText} onChange={e => setDocSummaryText(e.target.value)} style={{ width: "100%", minHeight: 120, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 12, resize: "vertical", fontFamily: "inherit", background: "var(--c-bg)", color: "var(--c-text)" }} placeholder="Paste the text of the document you want summarized (police report, witness statement, lab report, etc.)..." />
                </div>
              </>
            )}

            {activeAgent === "filingclassifier" && selectedCaseId && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Select Filing to Classify</label>
                {aiCenterFilings.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--c-text2)", padding: "10px 0" }}>No filings found for this case. Upload filings in the case's Filings tab first.</div>
                ) : (
                  <select value={aiCenterSelectedFiling} onChange={e => { setAiCenterSelectedFiling(e.target.value); setAiCenterFilingResult(null); }} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)" }}>
                    <option value="">— Select a filing —</option>
                    {aiCenterFilings.map(f => <option key={f.id} value={f.id}>{f.filename}{f.filedBy ? ` [${f.filedBy}]` : ""}{f.docType ? ` — ${f.docType}` : ""}</option>)}
                  </select>
                )}
              </div>
            )}

            {activeAgent === "batch" && (() => {
              const BATCH_OPS = [
                { id: "reassign-staff", label: "Staff Reassignment", desc: "Reassign cases from one staff member to another by role" },
                { id: "change-status", label: "Bulk Status Change", desc: "Change the status of multiple cases at once" },
                { id: "advance-stage", label: "Bulk Stage Advancement", desc: "Move cases from one stage to another" },
                { id: "update-court-date", label: "Bulk Court Date Update", desc: "Update the next court date for multiple cases" },
                { id: "transfer-division", label: "Division Transfer", desc: "Move cases to a different court division" },
              ];
              const ROLE_FIELDS = [
                { id: "assignedAttorney", label: "Assigned Attorney" },
                { id: "secondAttorney", label: "Second Attorney" },
                { id: "trialCoordinator", label: "Trial Coordinator" },
                { id: "investigator", label: "Investigator" },
                { id: "socialWorker", label: "Social Worker" },
              ];
              const STATUSES = ["Active", "Closed", "Pending", "Disposed", "Transferred"];
              const STAGES = ["Arraignment", "Preliminary Hearing", "Grand Jury/Indictment", "Pre-Trial Motions", "Plea Negotiations", "Trial", "Sentencing", "Post-Conviction", "Appeal"];
              const DIVISIONS = ["Circuit", "District", "Juvenile"];
              const needsCaseSelect = ["change-status", "update-court-date", "transfer-division"].includes(batchOp);
              const bq = batchCaseSearch.toLowerCase().trim();
              const batchFilteredCases = bq ? allCases.filter(c => c.status !== "Closed" && c.deletedAt == null && ((c.defendantName || "").toLowerCase().includes(bq) || (c.title || "").toLowerCase().includes(bq) || (c.caseNum || "").toLowerCase().includes(bq))) : [];
              const toggleCase = (c) => {
                setBatchSelectedCases(prev => prev.find(x => x.id === c.id) ? prev.filter(x => x.id !== c.id) : [...prev, c]);
                setBatchPreview(null);
                setBatchApplied(null);
              };
              const canPreview = (() => {
                if (batchOp === "reassign-staff") return batchParams.fromUserId && batchParams.toUserId && batchParams.roleField && batchParams.fromUserId !== batchParams.toUserId;
                if (batchOp === "change-status") return batchSelectedCases.length > 0 && batchParams.newStatus;
                if (batchOp === "advance-stage") return batchParams.fromStage && batchParams.toStage && batchParams.fromStage !== batchParams.toStage;
                if (batchOp === "update-court-date") return batchSelectedCases.length > 0 && batchParams.newDate;
                if (batchOp === "transfer-division") return batchSelectedCases.length > 0 && batchParams.newDivision;
                return false;
              })();
              const handlePreview = async () => {
                setBatchLoading(true); setBatchPreview(null); setBatchApplied(null);
                try {
                  const payload = { operation: batchOp, ...batchParams };
                  if (needsCaseSelect) payload.caseIds = batchSelectedCases.map(c => c.id);
                  const res = await apiBatchPreview(payload);
                  setBatchPreview(res);
                } catch (e) { alert("Preview failed: " + e.message); }
                setBatchLoading(false);
              };
              const handleApply = async () => {
                if (!window.confirm(`Apply this batch operation to ${batchPreview.count} case${batchPreview.count === 1 ? "" : "s"}? This cannot be undone.`)) return;
                setBatchLoading(true);
                try {
                  const payload = { operation: batchOp, ...batchParams };
                  if (needsCaseSelect) payload.caseIds = batchSelectedCases.map(c => c.id);
                  const res = await apiBatchApply(payload);
                  setBatchApplied(res);
                  setBatchPreview(null);
                } catch (e) { alert("Batch operation failed: " + e.message); }
                setBatchLoading(false);
              };
              const labelStyle = { fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" };
              const selectStyle = { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)" };
              return (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={labelStyle}>Operation</label>
                    <select value={batchOp} onChange={e => { setBatchOp(e.target.value); setBatchParams({}); setBatchPreview(null); setBatchApplied(null); setBatchSelectedCases([]); setBatchCaseSearch(""); setBatchFromStaffInput(""); setBatchFromStaffFocused(false); setBatchToStaffInput(""); setBatchToStaffFocused(false); }} style={selectStyle}>
                      {BATCH_OPS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <div style={{ fontSize: 11, color: "var(--c-text2)", marginTop: 4 }}>{BATCH_OPS.find(o => o.id === batchOp)?.desc}</div>
                  </div>

                  {batchOp === "reassign-staff" && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Role to Reassign</label>
                        <select value={batchParams.roleField || ""} onChange={e => setBatchParams(p => ({ ...p, roleField: e.target.value }))} style={selectStyle}>
                          <option value="">Select role...</option>
                          {ROLE_FIELDS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>From Staff Member</label>
                        <BatchStaffPicker
                          staffList={batchStaffList}
                          value={batchParams.fromUserId || ""}
                          onChange={val => { setBatchParams(p => ({ ...p, fromUserId: val })); setBatchFromStaffInput(""); setBatchFromStaffFocused(false); }}
                          inputValue={batchFromStaffInput}
                          onInputChange={setBatchFromStaffInput}
                          focused={batchFromStaffFocused}
                          onFocusChange={setBatchFromStaffFocused}
                          inputRef={batchFromRef}
                          placeholder="Search staff..."
                        />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>To Staff Member</label>
                        <BatchStaffPicker
                          staffList={batchStaffList.filter(u => String(u.id) !== String(batchParams.fromUserId))}
                          value={batchParams.toUserId || ""}
                          onChange={val => { setBatchParams(p => ({ ...p, toUserId: val })); setBatchToStaffInput(""); setBatchToStaffFocused(false); }}
                          inputValue={batchToStaffInput}
                          onInputChange={setBatchToStaffInput}
                          focused={batchToStaffFocused}
                          onFocusChange={setBatchToStaffFocused}
                          inputRef={batchToRef}
                          placeholder="Search staff..."
                        />
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Status Filter (optional)</label>
                        <select value={batchParams.statusFilter || "All"} onChange={e => setBatchParams(p => ({ ...p, statusFilter: e.target.value }))} style={selectStyle}>
                          <option value="All">All Statuses</option>
                          {STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {batchOp === "change-status" && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>New Status</label>
                        <select value={batchParams.newStatus || ""} onChange={e => setBatchParams(p => ({ ...p, newStatus: e.target.value }))} style={selectStyle}>
                          <option value="">Select status...</option>
                          {STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {batchOp === "advance-stage" && (
                    <>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>From Stage</label>
                        <select value={batchParams.fromStage || ""} onChange={e => setBatchParams(p => ({ ...p, fromStage: e.target.value }))} style={selectStyle}>
                          <option value="">Select stage...</option>
                          {STAGES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>To Stage</label>
                        <select value={batchParams.toStage || ""} onChange={e => setBatchParams(p => ({ ...p, toStage: e.target.value }))} style={selectStyle}>
                          <option value="">Select stage...</option>
                          {STAGES.filter(s => s !== batchParams.fromStage).map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Status Filter (optional)</label>
                        <select value={batchParams.statusFilter || "All"} onChange={e => setBatchParams(p => ({ ...p, statusFilter: e.target.value }))} style={selectStyle}>
                          <option value="All">All Statuses</option>
                          {STATUSES.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {batchOp === "update-court-date" && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>New Court Date</label>
                      <input type="date" value={batchParams.newDate || ""} onChange={e => setBatchParams(p => ({ ...p, newDate: e.target.value }))} style={selectStyle} />
                    </div>
                  )}

                  {batchOp === "transfer-division" && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={labelStyle}>New Division</label>
                      <select value={batchParams.newDivision || ""} onChange={e => setBatchParams(p => ({ ...p, newDivision: e.target.value }))} style={selectStyle}>
                        <option value="">Select division...</option>
                        {DIVISIONS.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </div>
                  )}

                  {needsCaseSelect && (
                    <div style={{ marginBottom: 16 }}>
                      <label style={labelStyle}>Select Cases ({batchSelectedCases.length} selected)</label>
                      <div style={{ position: "relative" }}>
                        <input type="text" value={batchCaseSearch} onChange={e => setBatchCaseSearch(e.target.value)} placeholder="Search cases by defendant, title, or case number..." style={{ ...selectStyle, marginBottom: 4 }} />
                        {bq && batchFilteredCases.length > 0 && (
                          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: "0 0 6px 6px", maxHeight: 200, overflowY: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                            {batchFilteredCases.slice(0, 20).map(c => {
                              const sel = batchSelectedCases.find(x => x.id === c.id);
                              return (
                                <div key={c.id} onClick={() => { toggleCase(c); setBatchCaseSearch(""); }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--c-text)", borderBottom: "1px solid var(--c-border)", background: sel ? "var(--c-bg)" : "transparent", display: "flex", alignItems: "center", gap: 8 }} onMouseEnter={e => { if (!sel) e.currentTarget.style.background = "var(--c-bg)"; }} onMouseLeave={e => { if (!sel) e.currentTarget.style.background = "transparent"; }}>
                                  <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{sel ? "✓" : ""}</span>
                                  <div>
                                    <div style={{ fontWeight: 500 }}>{c.defendantName || c.title}</div>
                                    <div style={{ fontSize: 11, color: "var(--c-text2)" }}>{c.caseNum || "—"} · {c.status} · {c.stage}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {batchSelectedCases.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                          {batchSelectedCases.map(c => (
                            <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 4, background: "var(--c-bg)", border: "1px solid var(--c-border)", fontSize: 11, color: "var(--c-text)" }}>
                              {c.defendantName || c.title}
                              <button onClick={() => toggleCase(c)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#e05252", padding: 0, lineHeight: 1 }}>✕</button>
                            </span>
                          ))}
                          <button onClick={() => { setBatchSelectedCases([]); setBatchPreview(null); }} style={{ fontSize: 11, color: "#e05252", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clear all</button>
                        </div>
                      )}
                    </div>
                  )}

                  {!batchPreview && !batchApplied && (
                    <button className="btn btn-gold" style={{ width: "100%", opacity: canPreview ? 1 : 0.5 }} disabled={!canPreview || batchLoading} onClick={handlePreview}>
                      {batchLoading ? "Loading..." : "Preview Changes"}
                    </button>
                  )}

                  {batchPreview && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--c-text-h)", marginBottom: 8 }}>
                        Preview: {batchPreview.count} case{batchPreview.count === 1 ? "" : "s"} will be affected
                      </div>
                      {batchPreview.count === 0 ? (
                        <div style={{ padding: 16, textAlign: "center", color: "var(--c-text2)", fontSize: 13 }}>No cases match the selected criteria</div>
                      ) : (
                        <>
                          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 6, marginBottom: 12 }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                              <thead>
                                <tr style={{ background: "var(--c-bg)", position: "sticky", top: 0 }}>
                                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--c-text2)", borderBottom: "1px solid var(--c-border)" }}>Case</th>
                                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--c-text2)", borderBottom: "1px solid var(--c-border)" }}>Defendant</th>
                                  <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--c-text2)", borderBottom: "1px solid var(--c-border)" }}>Current</th>
                                </tr>
                              </thead>
                              <tbody>
                                {batchPreview.cases.slice(0, 50).map(c => (
                                  <tr key={c.id} style={{ borderBottom: "1px solid var(--c-border)" }}>
                                    <td style={{ padding: "6px 10px", color: "var(--c-text)" }}>{c.caseNum || c.title}</td>
                                    <td style={{ padding: "6px 10px", color: "var(--c-text)" }}>{c.defendantName || "—"}</td>
                                    <td style={{ padding: "6px 10px", color: "var(--c-text2)", fontSize: 11 }}>
                                      {batchOp === "reassign-staff" && (c.currentStaffName || "—")}
                                      {batchOp === "change-status" && c.status}
                                      {batchOp === "advance-stage" && c.stage}
                                      {batchOp === "update-court-date" && (c.nextCourtDate ? new Date(c.nextCourtDate).toLocaleDateString() : "Not set")}
                                      {batchOp === "transfer-division" && (c.courtDivision || "—")}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {batchPreview.cases.length > 50 && (
                              <div style={{ padding: "8px 10px", textAlign: "center", fontSize: 11, color: "var(--c-text2)" }}>...and {batchPreview.cases.length - 50} more</div>
                            )}
                          </div>
                          {batchOp === "reassign-staff" && batchPreview.fromUserName && batchPreview.toUserName && (
                            <div style={{ fontSize: 12, color: "var(--c-text)", marginBottom: 12, padding: "8px 12px", background: "var(--c-bg)", borderRadius: 6 }}>
                              <strong>{batchPreview.fromUserName}</strong> → <strong>{batchPreview.toUserName}</strong>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 10 }}>
                            <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setBatchPreview(null)}>Cancel</button>
                            <button className="btn" style={{ flex: 1, background: "#dc2626", color: "#fff", border: "none" }} disabled={batchLoading} onClick={handleApply}>
                              {batchLoading ? "Applying..." : `Apply to ${batchPreview.count} Case${batchPreview.count === 1 ? "" : "s"}`}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {batchApplied && (
                    <div style={{ marginTop: 16, padding: 16, background: "#dcfce7", borderRadius: 8, border: "1px solid #bbf7d0" }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#166534", marginBottom: 4 }}>Batch Operation Complete</div>
                      <div style={{ fontSize: 13, color: "#15803d" }}>{batchApplied.message}</div>
                      <button className="btn btn-outline btn-sm" style={{ marginTop: 12, fontSize: 11 }} onClick={() => { setBatchApplied(null); setBatchPreview(null); setBatchParams({}); setBatchSelectedCases([]); setBatchCaseSearch(""); setBatchFromStaffInput(""); setBatchFromStaffFocused(false); setBatchToStaffInput(""); setBatchToStaffFocused(false); }}>Start New Operation</button>
                    </div>
                  )}
                </div>
              );
            })()}

            {activeAgent !== "batch" && !aiState.result && !aiState.loading && (
              <button className="btn btn-gold" style={{ width: "100%", opacity: (activeAgent === "docsummary" ? (canRun && docSummaryText.trim()) : (activeAgent === "filingclassifier" ? (canRun && aiCenterSelectedFiling) : canRun)) ? 1 : 0.5 }} disabled={activeAgent === "docsummary" ? !(canRun && docSummaryText.trim()) : (activeAgent === "filingclassifier" ? !(canRun && aiCenterSelectedFiling) : !canRun)} onClick={() => runAgent(activeAgent)}>
                Run {agents.find(a => a.id === activeAgent)?.title}
              </button>
            )}

            {(aiState.loading || aiState.result || aiState.error) && aiState.result !== "__TASK_SUGGESTIONS__" && aiState.result !== "__FILING_CLASSIFIER__" && !(aiState.loading && activeAgent === "tasksuggestions") && !(aiState.loading && activeAgent === "filingclassifier") && (
              <AiPanel title={agents.find(a => a.id === activeAgent)?.title} result={aiState.result} loading={aiState.loading} error={aiState.error}
                onRun={() => runAgent(activeAgent)}
                actions={aiState.result ? (
                  <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => { navigator.clipboard.writeText(aiState.result); }}>Copy</button>
                ) : null}
              />
            )}
            {aiState.result === "__TASK_SUGGESTIONS__" && aiCenterTasks.tasks.length > 0 && (
              <div className="card" style={{ marginTop: 16, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, fontWeight: 600, color: "var(--c-text-h)" }}>⚡ Suggested Tasks ({aiCenterTasks.tasks.length})</div>
                  {aiCenterTasks.tasks.some((_, i) => !aiCenterTasks.added[i]) && (
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px", color: "#b8860b", borderColor: "#d4c9a8" }} onClick={async () => {
                      const newAdded = { ...aiCenterTasks.added };
                      for (let i = 0; i < aiCenterTasks.tasks.length; i++) {
                        if (!aiCenterTasks.added[i]) {
                          const s = aiCenterTasks.tasks[i];
                          const dueDate = s.dueInDays ? new Date(Date.now() + s.dueInDays * 86400000).toISOString().split("T")[0] : null;
                          try {
                            await apiCreateTask({ caseId: Number(selectedCaseId), title: s.title, priority: s.priority || "Medium", assignedRole: s.assignedRole || "", due: dueDate, notes: s.rationale || "", isGenerated: true });
                            newAdded[i] = true;
                          } catch (err) { console.error(err); }
                        }
                      }
                      setAiCenterTasks(p => ({ ...p, added: newAdded }));
                    }}>+ Add All to Case</button>
                  )}
                </div>
                {aiCenterTasks.tasks.map((s, i) => {
                  const isAdded = aiCenterTasks.added[i];
                  const priorityColors = { Urgent: "#e05252", High: "#e88c30", Medium: "#b8860b", Low: "#2F7A5F" };
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--c-border)", opacity: isAdded ? 0.45 : 1 }}>
                      <span style={{ fontSize: 12, marginTop: 1 }}>{isAdded ? "✓" : "⚡"}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--c-text-h)", fontWeight: 500 }}>{s.title}</div>
                        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: (priorityColors[s.priority] || "#b8860b") + "18", color: priorityColors[s.priority] || "#b8860b" }}>{s.priority}</span>
                          {s.assignedRole && <span style={{ fontSize: 10, color: "#8A9096" }}>{s.assignedRole}</span>}
                          {s.dueInDays && <span style={{ fontSize: 10, color: "#8A9096" }}>· Due in {s.dueInDays} days</span>}
                        </div>
                        {s.rationale && <div style={{ fontSize: 11, color: "var(--c-text2)", marginTop: 4, lineHeight: 1.4 }}>{s.rationale}</div>}
                      </div>
                      {!isAdded && (
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px", flexShrink: 0 }} onClick={async () => {
                          const dueDate = s.dueInDays ? new Date(Date.now() + s.dueInDays * 86400000).toISOString().split("T")[0] : null;
                          try {
                            await apiCreateTask({ caseId: Number(selectedCaseId), title: s.title, priority: s.priority || "Medium", assignedRole: s.assignedRole || "", due: dueDate, notes: s.rationale || "", isGenerated: true });
                            setAiCenterTasks(p => ({ ...p, added: { ...p.added, [i]: true } }));
                          } catch (err) { alert("Failed: " + err.message); }
                        }}>+ Add</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {aiState.loading && activeAgent === "tasksuggestions" && (
              <AiPanel title="Task Suggestions" result={null} loading={true} error={null} />
            )}
            {aiState.result === "__FILING_CLASSIFIER__" && aiCenterFilingResult && (
              <div className="card" style={{ marginTop: 16, padding: 20 }}>
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 12 }}>📁 Classification Result</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text2)" }}>Suggested Name:</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text-h)" }}>{aiCenterFilingResult.suggestedName || "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {aiCenterFilingResult.filedBy && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text2)" }}>Filed By:</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: { State: "#DC2626", Defendant: "#2563EB", "Co-Defendant": "#7C3AED", Court: "#059669", Other: "#6B7280" }[aiCenterFilingResult.filedBy] || "#6B7280", borderRadius: 4, padding: "2px 7px", textTransform: "uppercase" }}>{aiCenterFilingResult.filedBy}</span>
                      </div>
                    )}
                    {aiCenterFilingResult.docType && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text2)" }}>Type:</span>
                        <span style={{ fontSize: 11, color: "var(--c-text)" }}>{aiCenterFilingResult.docType}</span>
                      </div>
                    )}
                    {aiCenterFilingResult.filingDate && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text2)" }}>Filing Date:</span>
                        <span style={{ fontSize: 11, color: "var(--c-text)" }}>{aiCenterFilingResult.filingDate}</span>
                      </div>
                    )}
                  </div>
                  {aiCenterFilingResult.summary && (
                    <div style={{ fontSize: 12, color: "var(--c-text)", lineHeight: 1.6, marginTop: 4, padding: 12, background: "var(--c-bg)", borderRadius: 8, border: "1px solid var(--c-border)" }}>{aiCenterFilingResult.summary}</div>
                  )}
                </div>
                <button className="btn btn-outline btn-sm" style={{ marginTop: 12, fontSize: 11 }} onClick={() => { setAiState({ loading: false, result: null, error: null }); setAiCenterFilingResult(null); }}>Classify Another</button>
              </div>
            )}
            {aiState.loading && activeAgent === "filingclassifier" && (
              <AiPanel title="Filing Classifier" result={null} loading={true} error={null} />
            )}
          </div>
        )}

        {!activeAgent && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--c-text2)", fontSize: 13 }}>
            Select an AI agent above to get started
          </div>
        )}
        </>}

        {aiCenterTab === "trainer" && (
          <>
            <div style={{ marginBottom: 16, fontSize: 13, color: "var(--c-text2)", lineHeight: 1.6 }}>
              Add instructions or upload documents to customize how all AI agents work. Training content is injected into every AI agent's context.
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--c-border)" }}>
                <button onClick={() => setTrainingTab("personal")} style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "none", color: trainingTab === "personal" ? "#2563eb" : "var(--c-text2)", borderBottom: trainingTab === "personal" ? "2px solid #2563eb" : "2px solid transparent", marginBottom: -1 }}>My Training</button>
                <button onClick={() => setTrainingTab("office")} style={{ padding: "6px 16px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "none", color: trainingTab === "office" ? "#059669" : "var(--c-text2)", borderBottom: trainingTab === "office" ? "2px solid #059669" : "2px solid transparent", marginBottom: -1 }}>Office Training</button>
              </div>
              {(trainingTab === "personal" || canOffice) && (
                <button className="btn btn-sm" style={{ background: "#6366f1", color: "#fff", border: "none", fontSize: 12 }} onClick={() => { setShowAddTraining(true); setAddForm(f => ({ ...f, scope: trainingTab })); }}>+ Add Training</button>
              )}
            </div>

            {(() => {
              const userId = currentUser?.id;
              const filtered = trainingEntries.filter(e => trainingTab === "personal" ? (e.scope === "personal" && e.user_id === userId) : e.scope === "office");
              if (filtered.length === 0) return (
                <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--c-text2)" }}>
                  <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>🧠</div>
                  <div style={{ fontSize: 13 }}>{trainingTab === "personal" ? "No personal training entries yet. Add instructions to customize AI for your workflow." : "No office-wide training entries yet." + (canOffice ? " Add guidelines that apply to all staff." : "")}</div>
                </div>
              );
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {filtered.map(entry => {
                    const isEditing = editingId === entry.id;
                    const isOwner = entry.user_id === userId;
                    const canEdit = entry.scope === "personal" ? isOwner : canOffice;
                    return (
                      <div key={entry.id} style={{ background: "var(--c-card)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "14px 16px", opacity: entry.active ? 1 : 0.5, transition: "opacity 0.15s" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <input value={editForm.title || ""} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} style={{ fontSize: 13, fontWeight: 600, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)" }} />
                            <select value={editForm.category || "General"} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)" }}>
                              {TRAINING_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                            </select>
                            {entry.source_type === "text" && (
                              <textarea value={editForm.content || ""} onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))} style={{ fontSize: 12, minHeight: 100, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", resize: "vertical", fontFamily: "inherit" }} />
                            )}
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={() => setEditingId(null)}>Cancel</button>
                              <button className="btn btn-sm" style={{ fontSize: 11, background: "#6366f1", color: "#fff", border: "none" }} onClick={() => handleSaveEdit(entry.id)}>Save</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text-h)" }}>{entry.title}</span>
                                  <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: entry.scope === "office" ? "#05966918" : "#2563eb18", color: entry.scope === "office" ? "#059669" : "#2563eb" }}>{entry.scope === "office" ? "Office" : "Personal"}</span>
                                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "var(--c-bg)", color: "var(--c-text2)", border: "1px solid var(--c-border)" }}>{entry.category}</span>
                                  <span style={{ fontSize: 10, color: "#8A9096" }}>{entry.source_type === "document" ? "📄" : "📝"}</span>
                                </div>
                                <div style={{ fontSize: 12, color: "var(--c-text2)", lineHeight: 1.5, maxHeight: 60, overflow: "hidden" }}>
                                  {entry.source_type === "document" && entry.filename && <span style={{ fontSize: 11, color: "#8A9096", marginRight: 6 }}>[{entry.filename}]</span>}
                                  {(entry.content || "").substring(0, 150)}{(entry.content || "").length > 150 ? "..." : ""}
                                </div>
                                {entry.created_by_name && <div style={{ fontSize: 10, color: "#8A9096", marginTop: 4 }}>Added by {entry.created_by_name}</div>}
                              </div>
                              {canEdit && (
                                <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, marginLeft: 8 }}>
                                  <button onClick={() => handleToggleActive(entry)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, padding: "2px", color: entry.active ? "#059669" : "#8A9096" }} title={entry.active ? "Active — click to disable" : "Inactive — click to enable"}>{entry.active ? "✓" : "○"}</button>
                                  <button onClick={() => { setEditingId(entry.id); setEditForm(entry.source_type === "document" ? { title: entry.title, category: entry.category } : { title: entry.title, category: entry.category, content: entry.content }); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "2px 4px", color: "#8A9096" }}>✎</button>
                                  <button onClick={() => handleDeleteTraining(entry.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "2px 4px", color: "#e05252" }}>✕</button>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {showAddTraining && (
              <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowAddTraining(false)}>
                <div className="modal" style={{ maxWidth: 540 }}>
                  <div className="modal-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Add Training</span>
                    <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#8A9096" }} onClick={() => setShowAddTraining(false)}>✕</button>
                  </div>
                  <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid var(--c-border)" }}>
                    <button onClick={() => setAddMode("text")} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "none", color: addMode === "text" ? "#6366f1" : "var(--c-text2)", borderBottom: addMode === "text" ? "2px solid #6366f1" : "2px solid transparent", marginBottom: -1 }}>📝 Write Instructions</button>
                    <button onClick={() => setAddMode("document")} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: "none", color: addMode === "document" ? "#6366f1" : "var(--c-text2)", borderBottom: addMode === "document" ? "2px solid #6366f1" : "2px solid transparent", marginBottom: -1 }}>📄 Upload Document</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Title</label>
                      <input value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))} placeholder={addMode === "text" ? "e.g., Judge Thompson prefers brief motions" : "e.g., Local Court Rules Reference"} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }} />
                    </div>
                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Category</label>
                        <select value={addForm.category} onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)" }}>
                          {TRAINING_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Scope</label>
                        <select value={addForm.scope} onChange={e => setAddForm(f => ({ ...f, scope: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg)", color: "var(--c-text)" }}>
                          <option value="personal">Personal (just me)</option>
                          {canOffice && <option value="office">Office-wide (everyone)</option>}
                        </select>
                      </div>
                    </div>
                    {addMode === "text" ? (
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Instructions</label>
                        <textarea value={addForm.content} onChange={e => setAddForm(f => ({ ...f, content: e.target.value }))} placeholder="Write specific instructions, guidelines, or knowledge that should inform all AI agents. For example: local court rules, office procedures, defense strategies, or judge preferences." style={{ width: "100%", minHeight: 150, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 12, resize: "vertical", fontFamily: "inherit", background: "var(--c-bg)", color: "var(--c-text)", boxSizing: "border-box" }} />
                      </div>
                    ) : (
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text)", marginBottom: 4, display: "block" }}>Upload File (PDF, TXT, DOCX)</label>
                        <input type="file" accept=".pdf,.txt,.docx" onChange={e => setAddFile(e.target.files[0])} style={{ fontSize: 12, color: "var(--c-text)" }} />
                        {addFile && <div style={{ fontSize: 11, color: "var(--c-text2)", marginTop: 4 }}>Selected: {addFile.name}</div>}
                      </div>
                    )}
                    <button className="btn" style={{ width: "100%", background: "#6366f1", color: "#fff", border: "none" }} disabled={addSaving} onClick={handleAddTraining}>{addSaving ? "Saving..." : "Add Training"}</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Staff View ───────────────────────────────────────────────────────────────
// ─── Time Log View ────────────────────────────────────────────────────────────
function TimeLogView({ currentUser, allCases, tasks, caseNotes, correspondence = [], allUsers = [], onMenuToggle, pinnedCaseIds }) {
  const thisMonth = today.slice(0, 7);
  const [fromDate, setFromDate] = useState(thisMonth + "-01");
  const [toDate,   setToDate]   = useState(today);
  const [manualEntries, setManualEntries] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef(null);
  const [allCasesForLog, setAllCasesForLog] = useState([]);

  useEffect(() => {
    apiGetCasesAll().then(setAllCasesForLog).catch(() => setAllCasesForLog(allCases));
  }, [allCases]);

  useEffect(() => {
    apiGetTimeEntries(currentUser.id, fromDate, toDate)
      .then(setManualEntries)
      .catch(() => {});
  }, [currentUser.id, fromDate, toDate]);

  const setRange = (label) => {
    const now = new Date(today + "T00:00:00");
    if (label === "This Week") {
      const day = now.getDay();
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

  const rows = useMemo(() => {
    const result = [];
    const from = new Date(fromDate + "T00:00:00");
    const to   = new Date(toDate   + "T23:59:59");
    const inRange = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= from && d <= to;
    };

    const findCase = (id) => allCasesForLog.find(c => c.id === id);

    tasks.forEach(t => {
      const creditId = t.timeLogUser || t.completedBy || t.assigned;
      if (creditId !== currentUser.id) return;
      if (t.status !== "Completed" || !t.completedAt) return;
      if (!inRange(t.completedAt)) return;
      const cs = findCase(t.caseId);
      result.push({
        _source: "task", _id: t.id,
        date: t.completedAt,
        caseTitle: cs?.title || `Case #${t.caseId}`,
        caseType: cs?.caseType || "",
        detail: t.title,
        time: t.timeLogged || "",
      });
    });

    Object.entries(caseNotes).forEach(([caseId, notes]) => {
      (notes || []).forEach(note => {
        const creditId = note.timeLogUser || note.authorId;
        if (creditId !== currentUser.id) return;
        if (!inRange(note.createdAt)) return;
        const cs = findCase(Number(caseId));
        const summary = (note.body || "").slice(0, 100).replace(/\n/g, " ") + (note.body?.length > 100 ? "…" : "");
        result.push({
          _source: "note", _id: note.id,
          date: note.createdAt,
          caseTitle: cs?.title || `Case #${caseId}`,
          caseType: cs?.caseType || "",
          detail: summary,
          time: note.timeLogged || "",
        });
      });
    });

    const myCaseIds = new Set(allCasesForLog.filter(c =>
      [c.assignedAttorney, c.secondAttorney, c.trialCoordinator, c.investigator, c.socialWorker].includes(currentUser.id)
    ).map(c => c.id));
    correspondence.forEach(email => {
      if (!myCaseIds.has(email.caseId)) return;
      if (!inRange(email.receivedAt)) return;
      const cs = findCase(email.caseId);
      result.push({
        _source: "email", _id: email.id,
        date: email.receivedAt,
        caseTitle: cs?.title || `Case #${email.caseId}`,
        caseType: cs?.caseType || "",
        detail: email.subject || "(no subject)",
        time: "",
      });
    });

    manualEntries.forEach(me => {
      result.push({
        _source: "manual", _id: me.id,
        date: me.date,
        caseTitle: me.caseTitle || `Case #${me.caseId || "?"}`,
        caseType: me.caseType || "",
        detail: me.detail,
        time: me.time || "",
      });
    });

    result.sort((a, b) => new Date(b.date) - new Date(a.date));
    return result;
  }, [tasks, caseNotes, currentUser.id, allCasesForLog, fromDate, toDate, correspondence, manualEntries]);

  const fmtDateTime = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const exportCSV = () => {
    const headers = ["Date", "Case", "Case Type", "Description", "Time"];
    const escapeCell = (val) => `"${String(val || "").replace(/"/g, '""')}"`;
    const csvRows = [
      headers.join(","),
      ...rows.map(r => [
        fmtDateTime(r.date), r.caseTitle, r.caseType, r.detail, r.time || "",
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

  const startEdit = (source, id, field, currentVal) => {
    setEditingCell({ key: `${source}-${id}`, field });
    setEditValue(currentVal || "");
    setTimeout(() => editRef.current?.focus(), 0);
  };

  const saveEdit = async () => {
    if (!editingCell) return;
    const row = rows.find(r => `${r._source}-${r._id}` === editingCell.key);
    const field = editingCell.field;
    setEditingCell(null);
    if (!row || (row[field] || "") === editValue) return;

    if (row._source === "manual") {
      try {
        await apiUpdateTimeEntry(row._id, { [field]: editValue });
        setManualEntries(prev => prev.map(e => e.id === row._id ? { ...e, [field]: editValue } : e));
      } catch (err) { console.error(err); }
    } else if (row._source === "task") {
      try {
        const updates = field === "time" ? { timeLogged: editValue } : { title: editValue };
        await apiUpdateTask(row._id, updates);
      } catch (err) { console.error(err); }
    } else if (row._source === "note") {
      try {
        await apiUpdateNote(row._id, field === "time" ? { timeLogged: editValue } : { body: editValue });
      } catch (err) { console.error(err); }
    }
  };

  const handleDeleteManual = async (id) => {
    try {
      await apiDeleteTimeEntry(id);
      setManualEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) { console.error(err); }
  };

  const handleAddEntry = async (entry) => {
    try {
      const saved = await apiCreateTimeEntry(entry);
      setManualEntries(prev => [...prev, saved]);
      setShowAddForm(false);
    } catch (err) { alert("Failed to add entry: " + err.message); }
  };

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div>
            <div className="topbar-title">Time Log</div>
            <div className="topbar-subtitle">{currentUser.name} · {rows.length} entr{rows.length !== 1 ? "ies" : "y"} · {fmtDateTime(fromDate)} – {fmtDateTime(toDate)}</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(true)}>+ Add Entry</button>
          <button className="btn btn-gold" disabled={rows.length === 0} onClick={exportCSV} title={rows.length === 0 ? "No activity in this range" : "Download CSV"}>⬇ Export CSV</button>
        </div>
      </div>

      <div className="content">
        <div className="card" style={{ marginBottom: 18 }}>
          <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, color: "#8A9096", whiteSpace: "nowrap" }}>From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ width: 150 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <label style={{ fontSize: 12, color: "#8A9096", whiteSpace: "nowrap" }}>To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ width: 150 }} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["This Week", "This Month", "Last Month", "Last 30 Days", "Last 90 Days", "This Year"].map(label => (
                <button key={label} className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={() => setRange(label)}>{label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Time Entries</div>
            <span style={{ fontSize: 12, color: "#8A9096" }}>{rows.length} entries</span>
          </div>
          {rows.length === 0 ? (
            <div className="empty">No activity recorded for this date range.</div>
          ) : (
            <div className="table-wrap">
              <table className="mobile-cards">
                <thead>
                  <tr>
                    <th style={{ whiteSpace: "nowrap" }}>Date</th>
                    <th>Case</th>
                    <th>Description</th>
                    <th style={{ whiteSpace: "nowrap", width: 90 }}>Time</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r._source}-${r._id}-${i}`}>
                      <td data-label="Date" style={{ whiteSpace: "nowrap", fontSize: 12, color: "var(--c-text2)" }}>{fmtDateTime(r.date)}</td>
                      <td data-label="Case">
                        <div style={{ fontSize: 13, color: "var(--c-text)", fontWeight: 500 }}>{r.caseTitle}</div>
                        {r.caseType && <div style={{ fontSize: 10, color: "#8A9096" }}>{r.caseType}</div>}
                      </td>
                      <td data-label="Detail" style={{ fontSize: 12, color: "#1F2428", maxWidth: 420 }}>
                        {editingCell?.key === `${r._source}-${r._id}` && editingCell.field === "detail" ? (
                          <input ref={editRef} value={editValue} onChange={e => setEditValue(e.target.value)}
                            onBlur={saveEdit} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingCell(null); }}
                            style={{ width: "100%", fontSize: 12, padding: "4px 6px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", boxSizing: "border-box" }} />
                        ) : (
                          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", cursor: "pointer", minHeight: 18 }}
                            onClick={() => startEdit(r._source, r._id, "detail", r.detail)}
                            title="Click to edit"
                          >{r.detail || <span style={{ color: "#8A9096", fontStyle: "italic" }}>Click to add description</span>}</div>
                        )}
                      </td>
                      <td data-label="Time" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        {editingCell?.key === `${r._source}-${r._id}` && editingCell.field === "time" ? (
                          <input ref={editRef} value={editValue} onChange={e => setEditValue(e.target.value)}
                            onBlur={saveEdit} onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingCell(null); }}
                            style={{ width: 70, fontSize: 12, padding: "4px 6px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }} />
                        ) : (
                          <span style={{ cursor: "pointer", color: r.time ? "var(--c-text2)" : "#8A9096" }}
                            onClick={() => startEdit(r._source, r._id, "time", r.time)}
                            title="Click to edit"
                          >{r.time || "—"}</span>
                        )}
                      </td>
                      <td data-label="">
                        {r._source === "manual" && (
                          <button onClick={() => handleDeleteManual(r._id)}
                            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#8A9096", padding: 2, minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center" }}
                            title="Delete entry">✕</button>
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

      {showAddForm && (
        <AddTimeEntryModal
          allCases={allCases}
          currentUser={currentUser}
          tasks={tasks}
          caseNotes={caseNotes}
          correspondence={correspondence}
          allUsers={allUsers}
          onSave={handleAddEntry}
          onClose={() => setShowAddForm(false)}
          pinnedCaseIds={pinnedCaseIds}
        />
      )}
    </>
  );
}

function AddTimeEntryModal({ allCases, currentUser, tasks, caseNotes, correspondence, allUsers, onSave, onClose, pinnedCaseIds }) {
  const [caseId, setCaseId] = useState(null);
  const [date, setDate] = useState(today);
  const [detail, setDetail] = useState("");
  const [time, setTime] = useState("");
  const [caseSearch, setCaseSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState("all");

  const todayCaseIds = useMemo(() => {
    const ids = new Set();
    const todayStart = new Date(today + "T00:00:00");
    const todayEnd = new Date(today + "T23:59:59");
    const isToday = (dateStr) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= todayStart && d <= todayEnd;
    };
    tasks.forEach(t => {
      const creditId = t.timeLogUser || t.completedBy || t.assigned;
      if (creditId === currentUser.id && t.status === "Completed" && isToday(t.completedAt)) ids.add(t.caseId);
    });
    Object.entries(caseNotes).forEach(([cid, notes]) => {
      (notes || []).forEach(note => {
        const creditId = note.timeLogUser || note.authorId;
        if (creditId === currentUser.id && isToday(note.createdAt)) ids.add(Number(cid));
      });
    });
    const userEmail = (allUsers.find(u => u.id === currentUser.id) || {}).email || "";
    (correspondence || []).forEach(email => {
      if (userEmail && email.fromEmail?.toLowerCase() === userEmail.toLowerCase() && isToday(email.receivedAt)) ids.add(email.caseId);
    });
    return ids;
  }, [tasks, caseNotes, correspondence, currentUser.id, allUsers]);

  const filteredCases = useMemo(() => {
    let cases = allCases.filter(c => c.status !== "Closed" || todayCaseIds.has(c.id));
    if (caseFilter === "myMatters") {
      cases = cases.filter(c => [c.assignedAttorney, c.secondAttorney, c.trialCoordinator, c.investigator, c.socialWorker].includes(currentUser.id));
    }
    if (caseSearch) {
      const q = caseSearch.toLowerCase();
      cases = cases.filter(c => (c.title || "").toLowerCase().includes(q) || (c.defendantName || "").toLowerCase().includes(q) || (c.caseNum || "").toLowerCase().includes(q));
    }
    const todayGroup = cases.filter(c => todayCaseIds.has(c.id));
    const otherGroup = cases.filter(c => !todayCaseIds.has(c.id));
    todayGroup.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    otherGroup.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    return { todayGroup, otherGroup };
  }, [allCases, caseFilter, caseSearch, todayCaseIds, currentUser.id]);

  const selectedCase = allCases.find(c => c.id === caseId);

  return (
    <div className="case-overlay" style={{ left: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="login-box" style={{ maxWidth: 440, borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.3)", position: "relative", maxHeight: "85vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 16, background: "transparent", border: "none", fontSize: 18, color: "#8A9096", cursor: "pointer", lineHeight: 1 }}>✕</button>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, color: "var(--c-text-h)", marginBottom: 16 }}>Add Time Entry</div>

        <div className="form-group">
          <label>Case</label>
          {selectedCase ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "1px solid #D6D8DB", background: "#F7F8FA", fontSize: 13 }}>
                <div style={{ fontWeight: 500 }}>{selectedCase.title}</div>
                {selectedCase.caseType && <div style={{ fontSize: 10, color: "#8A9096" }}>{selectedCase.caseType}</div>}
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setCaseId(null)}>Change</button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                {[
                  { key: "all", label: "All Cases" },
                  { key: "myMatters", label: "My Cases" },
                ].map(f => (
                  <button key={f.key}
                    className={`btn btn-sm ${caseFilter === f.key ? "btn-primary" : "btn-outline"}`}
                    style={{ fontSize: 11 }}
                    onClick={() => setCaseFilter(f.key)}
                  >{f.label}</button>
                ))}
              </div>
              <input
                placeholder="Search cases..."
                value={caseSearch}
                onChange={e => setCaseSearch(e.target.value)}
                style={{ width: "100%", marginBottom: 8 }}
              />
              {(() => {
                const tlPIds = new Set(pinnedCaseIds);
                const allTlCases = [...filteredCases.todayGroup, ...filteredCases.otherGroup];
                const tlPinned = allTlCases.filter(c => tlPIds.has(c.id));
                const tlToday = filteredCases.todayGroup.filter(c => !tlPIds.has(c.id));
                const tlOther = filteredCases.otherGroup.filter(c => !tlPIds.has(c.id));
                const tlItem = (c) => (
                  <div key={c.id} onClick={() => setCaseId(c.id)}
                    style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #D6D8DB", fontSize: 13 }}
                    onMouseOver={e => e.currentTarget.style.background = "#F7F8FA"} onMouseOut={e => e.currentTarget.style.background = ""}>
                    <div style={{ fontWeight: 500, color: "#1F2428" }}>{c.title}</div>
                    {c.defendantName && <span style={{ fontSize: 10, color: "#8A9096" }}>{c.defendantName}</span>}
                  </div>
                );
                return (
              <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #D6D8DB", borderRadius: 6 }}>
                {tlPinned.length > 0 && (
                  <>
                    <PinnedSectionHeader />
                    {tlPinned.map(tlItem)}
                  </>
                )}
                {tlToday.length > 0 && (
                  <>
                    <div style={{ padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "#5D6268", textTransform: "uppercase", letterSpacing: 0.5, background: "#F7F8FA", borderBottom: "1px solid #D6D8DB", position: "sticky", top: 0, zIndex: 1 }}>Touched Today</div>
                    {tlToday.map(tlItem)}
                  </>
                )}
                {tlOther.length > 0 && (
                  <>
                    {(tlPinned.length > 0 || tlToday.length > 0) && (
                      <div style={{ padding: "6px 10px", fontSize: 10, fontWeight: 700, color: "#5D6268", textTransform: "uppercase", letterSpacing: 0.5, background: "#F7F8FA", borderBottom: "1px solid #D6D8DB", position: "sticky", top: 0, zIndex: 1 }}>All Cases</div>
                    )}
                    {tlOther.map(tlItem)}
                  </>
                )}
                {allTlCases.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12, color: "#8A9096", textAlign: "center" }}>No cases match your filters.</div>
                )}
              </div>
                );
              })()}
            </>
          )}
        </div>

        <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Time</label>
            <input placeholder="e.g. 1.5, 0:30" value={time} onChange={e => setTime(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3}
            placeholder="Description of work performed..."
            style={{ resize: "vertical", fontFamily: "inherit" }} />
        </div>

        <button className="btn btn-gold" style={{ width: "100%", padding: 10 }} disabled={!caseId} onClick={() => onSave({ caseId, date, detail, time })}>
          Add Entry
        </button>
        <button className="btn btn-outline" style={{ width: "100%", marginTop: 10 }} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

const CONTACT_CATEGORIES = ["Client", "Prosecutor", "Judge", "Court", "Witness", "Expert", "Family Member", "Social Worker", "Treatment Provider"];

const CONTACT_CAT_STYLE = {
  Client:             { bg: "#E4E7EB", color: "#5599cc", border: "#D6D8DB" },
  Prosecutor:         { bg: "#fef9c3", color: "#1E2A3A", border: "#fef9c3" },
  Judge:              { bg: "#f3e8ff", color: "#9966cc", border: "#f3e8ff" },
  Court:              { bg: "#f3e8ff", color: "#9966cc", border: "#f3e8ff" },
  Witness:            { bg: "#fef3c7", color: "#e07a30", border: "#fde68a" },
  Expert:             { bg: "#dcfce7", color: "#4CAE72", border: "#bbf7d0" },
  "Family Member":    { bg: "#ffe4e6", color: "#e05252", border: "#fecdd3" },
  "Social Worker":    { bg: "#E4E7EB", color: "#5599cc", border: "#D6D8DB" },
  "Treatment Provider": { bg: "#ccfbf1", color: "#44bbaa", border: "#ccfbf1" },
};

const CONTACT_NOTE_TYPES = [
  { label: "General",    bg: "var(--c-border)", color: "var(--c-text2)" },
  { label: "Call Log",   bg: "#dcfce7", color: "#4CAE72" },
  { label: "Email Log",  bg: "#E4E7EB", color: "#5599cc" },
  { label: "Meeting",    bg: "#fef9c3", color: "#1E2A3A" },
  { label: "Follow-up",  bg: "#fee2e2", color: "#e05252" },
];

function NewContactModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: "", category: "Client", phone: "", email: "", fax: "", address: "", firm: "", company: "", county: "" });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: "calc(100vw - 24px)" }}>
        <div className="modal-header"><span>New Contact</span><button className="modal-close" onClick={onClose}>✕</button></div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label className="field-label">Name *</label>
            <input className="field-input" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Full name or organization" autoFocus />
          </div>
          <div>
            <label className="field-label">Category *</label>
            <select className="field-input" value={form.category} onChange={e => set("category", e.target.value)}>
              {CONTACT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {form.category === "Prosecutor" && (
            <div>
              <label className="field-label">Office</label>
              <input className="field-input" value={form.firm} onChange={e => set("firm", e.target.value)} placeholder="District Attorney's Office" />
            </div>
          )}
          {(form.category === "Adjuster" || form.category === "Expert") && (
            <div>
              <label className="field-label">Company</label>
              <input className="field-input" value={form.company} onChange={e => set("company", e.target.value)} placeholder="Company name" />
            </div>
          )}
          {(form.category === "Court" || form.category === "Judge") && (
            <div>
              <label className="field-label">County</label>
              <input className="field-input" value={form.county} onChange={e => set("county", e.target.value)} placeholder="County name" />
            </div>
          )}
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="field-label">Phone</label>
              <input className="field-input" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(555) 555-5555" />
            </div>
            <div>
              <label className="field-label">Fax</label>
              <input className="field-input" value={form.fax} onChange={e => set("fax", e.target.value)} placeholder="(555) 555-5555" />
            </div>
          </div>
          <div>
            <label className="field-label">Email</label>
            <input className="field-input" value={form.email} onChange={e => set("email", e.target.value)} placeholder="email@example.com" />
          </div>
          <div>
            <label className="field-label">Address</label>
            <textarea className="field-input" rows={2} value={form.address} onChange={e => set("address", e.target.value)} placeholder="Street, City, State ZIP" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!form.name.trim()} onClick={() => onSave(form)}>Create Contact</button>
        </div>
      </div>
    </div>
  );
}

const ATTORNEY_STAFF_TYPES = ["Paralegal", "Trial Coordinator", "Administrative Assistant", "Other"];
const COURT_STAFF_TYPES = ["Judicial Assistant", "Clerk", "Court Reporter", "Bailiff", "Other"];

function ContactDetailOverlay({ contact, currentUser, notes, allCases, onClose, onUpdate, onDelete, onAddNote, onDeleteNote }) {
  const [draft, setDraft] = useState({ ...contact });
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [newNoteBody, setNewNoteBody] = useState("");
  const [newNoteType, setNewNoteType] = useState("General");
  const [addingNote, setAddingNote] = useState(false);
  const [staff, setStaff] = useState([]);
  const [expandedStaff, setExpandedStaff] = useState(null);
  const [addingStaff, setAddingStaff] = useState(false);
  const staffTimers = useRef({});
  const staffPendingData = useRef({});

  const hasStaff = contact.category === "Prosecutor" || contact.category === "Court";
  const staffTypes = contact.category === "Prosecutor" ? ATTORNEY_STAFF_TYPES : COURT_STAFF_TYPES;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft({ ...contact }); setShowDelete(false); }, [contact.id]);

  useEffect(() => {
    if (hasStaff) {
      apiGetContactStaff(contact.id).then(setStaff).catch(() => setStaff([]));
    } else {
      setStaff([]);
    }
    return () => {
      Object.values(staffTimers.current).forEach(clearTimeout);
      const pending = staffPendingData.current;
      Object.keys(pending).forEach(async (sid) => {
        try { await apiUpdateContactStaff(sid, { data: pending[sid] }); } catch {}
      });
      staffPendingData.current = {};
      staffTimers.current = {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, hasStaff]);

  const set = (k, v) => setDraft(p => ({ ...p, [k]: v }));

  const save = async (updated) => {
    setSaving(true);
    try { await onUpdate(updated); } catch {}
    setSaving(false);
  };

  const handleBlur = () => save(draft);

  const [fetchedAssocCases, setFetchedAssocCases] = useState([]);
  useEffect(() => {
    if (contact.category === "Expert" || contact.category === "Adjuster" || contact.category === "Miscellaneous") {
      apiGetContactCases(contact.id).then(setFetchedAssocCases).catch(() => setFetchedAssocCases([]));
    } else {
      setFetchedAssocCases([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.id, contact.category]);

  const assocCases = useMemo(() => {
    if (contact.category === "Expert" || contact.category === "Adjuster" || contact.category === "Miscellaneous") return fetchedAssocCases;
    if (!allCases) return [];
    if (contact.category === "Client")   return allCases.filter(c => c.defendantName === contact.name && !c.deletedAt);
    if (contact.category === "Prosecutor") return allCases.filter(c => c.prosecutor === contact.name && !c.deletedAt);
    if (contact.category === "Judge")    return allCases.filter(c => c.judge === contact.name && !c.deletedAt);
    return [];
  }, [contact, allCases, fetchedAssocCases]);

  const catStyle = CONTACT_CAT_STYLE[contact.category] || CONTACT_CAT_STYLE.Miscellaneous;

  const noteTypeStyle = (label) => CONTACT_NOTE_TYPES.find(t => t.label === label) || CONTACT_NOTE_TYPES[0];

  const submitNote = async () => {
    if (!newNoteBody.trim()) return;
    setAddingNote(true);
    try {
      await onAddNote(contact.id, {
        type: newNoteType, body: newNoteBody.trim(),
        authorId: currentUser.id, authorName: currentUser.name, authorRole: currentUser.role,
        createdAt: new Date().toISOString(),
      });
      setNewNoteBody("");
    } catch {}
    setAddingNote(false);
  };

  const addStaffMember = async () => {
    setAddingStaff(true);
    try {
      const s = await apiCreateContactStaff({ contactId: contact.id, staffType: staffTypes[0], data: { name: "", phone: "", email: "" } });
      setStaff(prev => [...prev, s]);
      setExpandedStaff(s.id);
    } catch {}
    setAddingStaff(false);
  };

  const removeStaffMember = async (id) => {
    if (!window.confirm("Remove this staff member?")) return;
    try {
      await apiDeleteContactStaff(id);
      setStaff(prev => prev.filter(s => s.id !== id));
      if (expandedStaff === id) setExpandedStaff(null);
    } catch {}
  };

  const updateStaffType = async (id, staffType) => {
    setStaff(prev => prev.map(s => s.id === id ? { ...s, staffType } : s));
    try { await apiUpdateContactStaff(id, { staffType }); } catch {}
  };

  const updateStaffField = (staffMember, field, value) => {
    const newData = { ...(staffPendingData.current[staffMember.id] || staffMember.data), [field]: value };
    staffPendingData.current[staffMember.id] = newData;
    setStaff(prev => prev.map(s => s.id === staffMember.id ? { ...s, data: newData } : s));
    if (staffTimers.current[staffMember.id]) clearTimeout(staffTimers.current[staffMember.id]);
    staffTimers.current[staffMember.id] = setTimeout(async () => {
      const dataToSave = staffPendingData.current[staffMember.id];
      delete staffPendingData.current[staffMember.id];
      try { await apiUpdateContactStaff(staffMember.id, { data: dataToSave }); } catch (err) { console.error(err); }
    }, 600);
  };

  return (
    <div className="case-overlay" onClick={onClose}>
      <div className="case-overlay-panel mobile-full" onClick={e => e.stopPropagation()} style={{ width: 640, maxWidth: "100vw" }}>
        <div className="case-overlay-header" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ padding: "2px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", background: catStyle.bg, color: "#1F2428" }}>
                {contact.category.toUpperCase()}
              </span>
              {saving && <span style={{ fontSize: 11, color: "#8A9096" }}>Saving…</span>}
            </div>
            <input
              value={draft.name}
              onChange={e => set("name", e.target.value)}
              onBlur={handleBlur}
              style={{ background: "transparent", border: "none", outline: "none", fontSize: 20, fontWeight: 700, color: "var(--c-text)", fontFamily: "inherit", width: "100%", padding: 0 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {!showDelete && (
              <button onClick={() => setShowDelete(true)} style={{ background: "#fee2e2", border: "1px solid #fca5a5", color: "#e05252", borderRadius: 4, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                Delete
              </button>
            )}
            {showDelete && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#e05252" }}>Delete this contact?</span>
                <button onClick={() => onDelete(contact.id)} style={{ background: "#e05252", border: "none", color: "#fff", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>Confirm</button>
                <button onClick={() => setShowDelete(false)} style={{ background: "var(--c-border)", border: "1px solid var(--c-border)", color: "var(--c-text2)", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontSize: 12 }}>Cancel</button>
              </div>
            )}
            <button className="overlay-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="case-overlay-body" style={{ padding: "20px 28px", overflowY: "auto" }}>
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#8A9096", textTransform: "uppercase", marginBottom: 14, paddingBottom: 6, borderBottom: "1px solid var(--c-border)" }}>Contact Information</div>
            {contact.category === "Prosecutor" && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Office</label>
                <input className="field-input" value={draft.firm || ""} onChange={e => set("firm", e.target.value)} onBlur={handleBlur} placeholder="District Attorney's Office" />
              </div>
            )}
            {(contact.category === "Adjuster" || contact.category === "Expert") && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Company</label>
                <input className="field-input" value={draft.company || ""} onChange={e => set("company", e.target.value)} onBlur={handleBlur} placeholder="Company name" />
              </div>
            )}
            {(contact.category === "Court" || contact.category === "Judge") && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>County</label>
                <input className="field-input" value={draft.county || ""} onChange={e => set("county", e.target.value)} onBlur={handleBlur} placeholder="County name" />
              </div>
            )}
            <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Phone</label>
                <input className="field-input" value={draft.phone} onChange={e => set("phone", e.target.value)} onBlur={handleBlur} placeholder="(555) 555-5555" />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Fax</label>
                <input className="field-input" value={draft.fax} onChange={e => set("fax", e.target.value)} onBlur={handleBlur} placeholder="(555) 555-5555" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Email</label>
                <input className="field-input" value={draft.email} onChange={e => set("email", e.target.value)} onBlur={handleBlur} placeholder="email@example.com" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Address</label>
                <textarea className="field-input" rows={2} value={draft.address} onChange={e => set("address", e.target.value)} onBlur={handleBlur} placeholder="Street, City, State ZIP" style={{ resize: "vertical" }} />
              </div>
            </div>
          </div>

          {hasStaff && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 6, borderBottom: "1px solid var(--c-border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#8A9096", textTransform: "uppercase" }}>
                  Staff <span style={{ fontSize: 11, fontWeight: 400, color: "#8A9096", textTransform: "none", letterSpacing: 0 }}>({staff.length})</span>
                </div>
                <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={addStaffMember} disabled={addingStaff}>
                  {addingStaff ? "Adding…" : "+ Add Staff"}
                </button>
              </div>
              {staff.length === 0 ? (
                <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic" }}>No staff members added yet.</div>
              ) : (
                staff.map(s => {
                  const isExp = expandedStaff === s.id;
                  const d = s.data || {};
                  return (
                    <div key={s.id} style={{ border: "1px solid var(--c-border)", borderRadius: 8, marginBottom: 8 }}>
                      <div
                        onClick={() => setExpandedStaff(isExp ? null : s.id)}
                        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer", background: isExp ? "var(--c-bg2)" : "transparent", borderRadius: isExp ? "8px 8px 0 0" : 8, transition: "background 0.15s" }}
                      >
                        <span style={{ fontSize: 12, color: "var(--c-text2)" }}>{isExp ? "▲" : "▼"}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#E4E7EB", color: "#1F2428" }}>{s.staffType}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)", flex: 1 }}>{d.name || "Unnamed"}</span>
                        {d.phone && <span style={{ fontSize: 11, color: "#8A9096" }}>{d.phone}</span>}
                      </div>
                      {isExp && (
                        <div style={{ padding: "14px 14px 10px", borderTop: "1px solid var(--c-border)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Type</label>
                              <select className="field-input" value={s.staffType} onChange={e => updateStaffType(s.id, e.target.value)}>
                                {staffTypes.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Name</label>
                              <input className="field-input" value={d.name || ""} onChange={e => updateStaffField(s, "name", e.target.value)} placeholder="Full name" />
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Phone</label>
                              <input className="field-input" value={d.phone || ""} onChange={e => updateStaffField(s, "phone", e.target.value)} placeholder="(555) 555-5555" />
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: 11, color: "#8A9096", marginBottom: 4 }}>Email</label>
                              <input className="field-input" value={d.email || ""} onChange={e => updateStaffField(s, "email", e.target.value)} placeholder="email@example.com" />
                            </div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "flex-end" }}>
                            <button onClick={() => removeStaffMember(s.id)} style={{ background: "none", border: "none", color: "#e05252", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Remove Staff</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {(contact.category === "Client" || contact.category === "Prosecutor" || contact.category === "Judge" || contact.category === "Court" || contact.category === "Expert" || contact.category === "Adjuster" || contact.category === "Miscellaneous") && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#8A9096", textTransform: "uppercase", marginBottom: 14, paddingBottom: 6, borderBottom: "1px solid var(--c-border)" }}>
                Associated Cases <span style={{ fontSize: 11, fontWeight: 400, color: "#8A9096", textTransform: "none", letterSpacing: 0 }}>({assocCases.length})</span>
              </div>
              {assocCases.length === 0 ? (
                <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic" }}>No associated cases found.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: "#8A9096", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      <th style={{ textAlign: "left", padding: "4px 8px 8px 0" }}>Case Number</th>
                      <th style={{ textAlign: "left", padding: "4px 8px 8px 0" }}>Style</th>
                      <th style={{ textAlign: "left", padding: "4px 8px 8px 0" }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assocCases.slice(0, 20).map(c => (
                      <tr key={c.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "7px 8px 7px 0", color: "#5599cc", fontFamily: "monospace", fontSize: 11 }}>{c.caseNum}</td>
                        <td style={{ padding: "7px 8px 7px 0", color: "var(--c-text)" }}>{c.title}</td>
                        <td style={{ padding: "7px 0", color: c.status === "Active" ? "#4CAE72" : "var(--c-text2)", fontWeight: 600 }}>{c.status}</td>
                      </tr>
                    ))}
                    {assocCases.length > 20 && <tr><td colSpan={3} style={{ padding: "6px 0", color: "#8A9096", fontSize: 11 }}>+ {assocCases.length - 20} more cases</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#8A9096", textTransform: "uppercase", marginBottom: 14, paddingBottom: 6, borderBottom: "1px solid var(--c-border)" }}>
              Notes <span style={{ fontSize: 11, fontWeight: 400, color: "#8A9096", textTransform: "none", letterSpacing: 0 }}>({(notes || []).length})</span>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <select value={newNoteType} onChange={e => setNewNoteType(e.target.value)} className="field-input" style={{ width: "auto", flexShrink: 0 }}>
                  {CONTACT_NOTE_TYPES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
                </select>
              </div>
              <textarea
                className="field-input"
                rows={3}
                value={newNoteBody}
                onChange={e => setNewNoteBody(e.target.value)}
                placeholder="Add a note…"
                style={{ resize: "vertical", width: "100%" }}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitNote(); }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button className="btn btn-primary" disabled={!newNoteBody.trim() || addingNote} onClick={submitNote} style={{ fontSize: 12 }}>
                  {addingNote ? "Adding…" : "Add Note"}
                </button>
              </div>
            </div>
            {(notes || []).length === 0 ? (
              <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic" }}>No notes yet.</div>
            ) : (
              (notes || []).map(note => {
                const ts = noteTypeStyle(note.type);
                return (
                  <div key={note.id} className="note-block">
                    <div className="note-head">
                      <span style={{ background: ts.bg, color: ts.color, padding: "1px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>{note.type}</span>
                      <span>{note.authorName}</span>
                      <span>{note.authorRole}</span>
                      <span>{note.createdAt ? new Date(note.createdAt).toLocaleString() : ""}</span>
                      <span style={{ marginLeft: "auto", cursor: "pointer", color: "#8A9096", fontSize: 11 }} onClick={() => onDeleteNote(note.id, contact.id)}>Delete</span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--c-text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{note.body}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactMergeModal({ contacts, contactNotes, onMerge, onClose }) {
  const hasAnyFirm = contacts.some(c => c.firm);
  const hasAnyCompany = contacts.some(c => c.company);
  const hasAnyCounty = contacts.some(c => c.county);
  const MERGE_FIELDS = [
    { key: "name",     label: "Name" },
    { key: "category", label: "Category" },
    ...(hasAnyFirm ? [{ key: "firm", label: "Firm" }] : []),
    ...(hasAnyCompany ? [{ key: "company", label: "Company" }] : []),
    ...(hasAnyCounty ? [{ key: "county", label: "County" }] : []),
    { key: "phone",    label: "Phone" },
    { key: "email",    label: "Email" },
    { key: "fax",      label: "Fax" },
    { key: "address",  label: "Address" },
  ];

  // choices[fieldKey] = contactId whose value to use — never ambiguous even when values match
  const initChoices = () => {
    const c = {};
    MERGE_FIELDS.forEach(({ key }) => { c[key] = contacts[0].id; });
    return c;
  };

  const [primaryId, setPrimaryId] = useState(contacts[0].id);
  const [choices, setChoices] = useState(initChoices);
  const [merging, setMerging] = useState(false);

  const handleSetPrimary = (id) => {
    setPrimaryId(id);
    const c = {};
    MERGE_FIELDS.forEach(({ key }) => { c[key] = id; });
    setChoices(c);
  };

  const totalNotes = contacts.reduce((sum, c) => sum + (contactNotes[c.id] || []).length, 0);

  const handleMerge = async () => {
    setMerging(true);
    const fields = {};
    MERGE_FIELDS.forEach(({ key }) => {
      const chosen = contacts.find(c => c.id === choices[key]);
      fields[key] = chosen ? (chosen[key] || "") : "";
    });
    try {
      await onMerge({ primaryId, mergeIds: contacts.filter(c => c.id !== primaryId).map(c => c.id), fields });
    } catch { setMerging(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ width: 700, maxWidth: "calc(100vw - 40px)", maxHeight: "90vh", background: "var(--c-card)", border: "1px solid var(--c-border3)", borderRadius: 10, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 16px", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--c-text)" }}>Merge {contacts.length} Contacts</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8A9096", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 4px" }}>✕</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "20px 24px", flex: 1, overflowY: "auto" }}>

          {/* Surviving record */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#8A9096", textTransform: "uppercase", marginBottom: 6 }}>Surviving Record</div>
            <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 10 }}>Choose which contact's database record is kept. All other records are permanently removed.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {contacts.map(c => {
                const catStyle = CONTACT_CAT_STYLE[c.category] || CONTACT_CAT_STYLE.Miscellaneous;
                const noteCount = (contactNotes[c.id] || []).length;
                const isPrimary = primaryId === c.id;
                return (
                  <div key={c.id} onClick={() => handleSetPrimary(c.id)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "9px 14px", borderRadius: 5, background: isPrimary ? "#E4E7EB" : "var(--c-card)", border: `1px solid ${isPrimary ? "#D6D8DB" : "#EEF1F4"}`, transition: "all 0.15s" }}>
                    <input type="radio" name="merge-primary" checked={isPrimary} onChange={() => handleSetPrimary(c.id)} onClick={e => e.stopPropagation()} style={{ flexShrink: 0, cursor: "pointer", width: "auto", padding: 0, border: "none", background: "none" }} />
                    <span style={{ color: isPrimary ? "var(--c-text)" : "var(--c-text2)", fontWeight: isPrimary ? 600 : 400, flex: 1, fontSize: 14 }}>{c.name}</span>
                    <span style={{ padding: "1px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: catStyle.bg, color: "#1F2428" }}>{c.category}</span>
                    {noteCount > 0 && <span style={{ fontSize: 11, color: "#8A9096" }}>{noteCount} note{noteCount !== 1 ? "s" : ""}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Field-by-field chooser */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#8A9096", textTransform: "uppercase", marginBottom: 6 }}>Choose Field Values</div>
            <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 14 }}>Click a cell to choose that contact's value for each field.</div>
            <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid var(--c-border)", borderRadius: 5, overflow: "hidden", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ background: "var(--c-card)", borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ width: 90, padding: "9px 10px", textAlign: "left", fontWeight: 400 }}></th>
                  {contacts.map(c => (
                    <th key={c.id} style={{ padding: "9px 14px", textAlign: "left", fontSize: 13, fontWeight: 700, color: c.id === primaryId ? "#1E2A3A" : "var(--c-text2)", borderLeft: "1px solid var(--c-border)", wordBreak: "break-word", letterSpacing: "normal", textTransform: "none" }}>
                      {c.name}{c.id === primaryId ? " ★" : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MERGE_FIELDS.map(({ key, label: fLabel }) => {
                  const allSame = contacts.every(c => (c[key] || "") === (contacts[0][key] || ""));
                  return (
                    <tr key={key} style={{ borderBottom: "1px solid #ffffff" }}>
                      <td style={{ padding: "11px 10px", background: "var(--c-hover)", borderRight: "1px solid var(--c-border)", fontSize: 11, fontWeight: 700, color: "#8A9096", textTransform: "uppercase", letterSpacing: "0.06em", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                        {fLabel}
                      </td>
                      {allSame ? (
                        <td colSpan={contacts.length} style={{ padding: "11px 14px", verticalAlign: "middle" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 4, background: "#dcfce7", color: "#1F2428", fontSize: 13 }}>
                            <span>✓</span>
                            <span style={{ fontWeight: 400, letterSpacing: "normal", textTransform: "none" }}>
                              {contacts[0][key] || <em style={{ color: "#8A9096", fontStyle: "italic" }}>empty on all</em>}
                            </span>
                          </div>
                        </td>
                      ) : contacts.map(c => {
                        const val = c[key] || "";
                        const isChosen = choices[key] === c.id;
                        return (
                          <td
                            key={c.id}
                            onClick={() => setChoices(p => ({ ...p, [key]: c.id }))}
                            style={{ padding: "11px 14px", borderLeft: "1px solid #f1f5f9", cursor: "pointer", background: isChosen ? "#E4E7EB" : "transparent", verticalAlign: "middle", transition: "background 0.1s" }}
                          >
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                              <input
                                type="radio"
                                name={`mfc-${key}`}
                                checked={isChosen}
                                onChange={() => setChoices(p => ({ ...p, [key]: c.id }))}
                                onClick={e => e.stopPropagation()}
                                style={{ marginTop: 2, flexShrink: 0, cursor: "pointer", width: "auto", padding: 0, border: "none", background: "none" }}
                              />
                              {val ? (
                                <span style={{ color: isChosen ? "var(--c-text)" : "var(--c-text2)", fontSize: 13, wordBreak: "break-word", lineHeight: 1.5, fontWeight: 400, letterSpacing: "normal", textTransform: "none" }}>{val}</span>
                              ) : (
                                <span style={{ color: "var(--c-border)", fontSize: 12, fontStyle: "italic", fontWeight: 400, letterSpacing: "normal", textTransform: "none" }}>empty</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Notes notice */}
          {totalNotes > 0 && (
            <div style={{ background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 4, padding: "10px 14px", fontSize: 12, color: "#4CAE72" }}>
              {totalNotes} note{totalNotes !== 1 ? "s" : ""} across all selected contacts will be automatically combined onto the surviving record.
            </div>
          )}

          {/* Warning */}
          <div style={{ background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 4, padding: "10px 14px", fontSize: 12, color: "#cc4444" }}>
            This action is permanent. Non-surviving contacts will be hard-deleted and cannot be recovered.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 24px 20px", borderTop: "1px solid var(--c-border)", flexShrink: 0 }}>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button
            onClick={handleMerge}
            disabled={merging}
            style={{ background: "#1E2A3A", color: "var(--c-card)", border: "none", borderRadius: 4, padding: "8px 20px", fontWeight: 700, fontSize: 13, cursor: merging ? "not-allowed" : "pointer", opacity: merging ? 0.6 : 1 }}
          >
            {merging ? "Merging…" : `Merge ${contacts.length} Contacts`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactsView({ currentUser, allCases, onOpenCase, onMenuToggle }) {
  const [contacts, setContacts] = useState(null);
  const [deletedContacts, setDeletedContacts] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState(null);
  const [contactNotes, setContactNotes] = useState({});
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelected, setMergeSelected] = useState(new Set());
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [contactCaseCounts, setContactCaseCounts] = useState({});

  useEffect(() => {
    apiGetContacts().then(data => { setContacts(data); setLoading(false); }).catch(() => setLoading(false));
    apiGetContactCaseCounts().then(setContactCaseCounts).catch(() => {});
  }, []);

  useEffect(() => {
    if (categoryFilter !== "Deleted") return;
    if (deletedContacts !== null) return;
    apiGetDeletedContacts().then(setDeletedContacts).catch(console.error);
  }, [categoryFilter, deletedContacts]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectContact = async (c) => {
    setSelectedContact(c);
    if (!contactNotes[c.id]) {
      try {
        const notes = await apiGetContactNotes(c.id);
        setContactNotes(p => ({ ...p, [c.id]: notes }));
      } catch {}
    }
  };

  const handleUpdateContact = async (updated) => {
    try {
      const saved = await apiUpdateContact(updated.id, updated);
      setContacts(p => p ? p.map(c => c.id === saved.id ? saved : c) : p);
      setSelectedContact(saved);
    } catch (err) { alert("Failed to save: " + err.message); }
  };

  const handleDeleteContact = async (id) => {
    try {
      const deleted = await apiDeleteContact(id);
      setContacts(p => p ? p.filter(c => c.id !== id) : p);
      setDeletedContacts(p => p ? [deleted, ...p] : [deleted]);
      setSelectedContact(null);
    } catch (err) { alert("Failed to delete: " + err.message); }
  };

  const handleRestoreContact = async (id) => {
    try {
      const restored = await apiRestoreContact(id);
      setDeletedContacts(p => p ? p.filter(c => c.id !== id) : null);
      setContacts(p => p ? [...p, restored].sort((a, b) => a.name.localeCompare(b.name)) : [restored]);
    } catch (err) { alert("Failed to restore: " + err.message); }
  };

  const handleCreateContact = async (data) => {
    try {
      const saved = await apiCreateContact(data);
      setContacts(p => [...(p || []), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setShowNew(false);
      handleSelectContact(saved);
    } catch (err) { alert("Failed to create contact: " + err.message); }
  };

  const toggleMergeMode = () => {
    setMergeMode(m => !m);
    setMergeSelected(new Set());
    setSelectedContact(null);
  };

  const toggleMergeSelect = (id) => {
    setMergeSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleMerge = async ({ primaryId, mergeIds, fields }) => {
    try {
      const merged = await apiMergeContacts({ primaryId, mergeIds, fields });
      setContacts(p => {
        const without = (p || []).filter(c => c.id !== primaryId && !mergeIds.includes(c.id));
        return [...without, merged].sort((a, b) => a.name.localeCompare(b.name));
      });
      setContactNotes(p => {
        const combined = [...(p[primaryId] || []), ...mergeIds.flatMap(id => p[id] || [])];
        const next = { ...p, [merged.id]: combined };
        mergeIds.forEach(id => delete next[id]);
        return next;
      });
      setShowMergeModal(false);
      setMergeMode(false);
      setMergeSelected(new Set());
    } catch (err) { alert("Merge failed: " + err.message); }
  };

  const handleAddNote = async (contactId, noteData) => {
    const saved = await apiCreateContactNote({ ...noteData, contactId });
    setContactNotes(p => ({ ...p, [contactId]: [saved, ...(p[contactId] || [])] }));
  };

  const handleDeleteNote = async (noteId, contactId) => {
    try {
      await apiDeleteContactNote(noteId);
      setContactNotes(p => ({ ...p, [contactId]: (p[contactId] || []).filter(n => n.id !== noteId) }));
    } catch (err) { alert("Failed to delete note: " + err.message); }
  };

  const isDeleted = categoryFilter === "Deleted";
  const list = isDeleted ? (deletedContacts || []) : (contacts || []);

  const filtered = list.filter(c => {
    if (!isDeleted && categoryFilter !== "All" && c.category !== categoryFilter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !c.phone.toLowerCase().includes(search.toLowerCase()) &&
        !c.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {};
  (contacts || []).forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });

  const daysLeft = (deletedAt) => {
    if (!deletedAt) return null;
    const diff = 30 - Math.floor((Date.now() - new Date(deletedAt)) / 86400000);
    return Math.max(0, diff);
  };

  const tabs = [
    { id: "All",              label: `All (${(contacts || []).length})` },
    { id: "Client",           label: `Clients (${counts.Client || 0})` },
    { id: "Prosecutor",      label: `Prosecutors (${counts.Prosecutor || 0})` },
    { id: "Judge",            label: `Judges (${counts.Judge || 0})` },
    { id: "Court",            label: `Courts (${counts.Court || 0})` },
    { id: "Witness",          label: `Witnesses (${counts.Witness || 0})` },
    { id: "Expert",           label: `Experts (${counts.Expert || 0})` },
    { id: "Family Member",    label: `Family (${counts["Family Member"] || 0})` },
    { id: "Social Worker",    label: `Social Workers (${counts["Social Worker"] || 0})` },
    { id: "Treatment Provider", label: `Treatment (${counts["Treatment Provider"] || 0})` },
    { id: "Miscellaneous",    label: `Misc (${counts.Miscellaneous || 0})` },
    { id: "Deleted",          label: `Deleted (${(deletedContacts || []).length})`, red: true },
  ];

  return (
    <>
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div>
            <div className="topbar-title">Contacts</div>
            <div className="topbar-subtitle">{loading ? "Loading…" : `${(contacts || []).length} contacts across ${CONTACT_CATEGORIES.length} categories`}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            className="field-input"
            placeholder="Search contacts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220, maxWidth: "100%", fontSize: 13 }}
          />
          {isAppAdmin(currentUser) && !isDeleted && (
            <button
              onClick={toggleMergeMode}
              style={{ background: mergeMode ? "#1E2A3A" : "var(--c-border)", color: mergeMode ? "var(--c-card)" : "var(--c-text2)", border: `1px solid ${mergeMode ? "#1E2A3A" : "var(--c-border)"}`, borderRadius: 4, padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.15s" }}
            >
              {mergeMode ? "Cancel Merge" : "Merge Contacts"}
            </button>
          )}
          {!mergeMode && <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New Contact</button>}
        </div>
      </div>

      <div className="content" style={{ paddingTop: 0 }}>
        {/* Category tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--c-border)", marginBottom: 20, overflowX: "auto" }}>
          {tabs.map(t => (
            <div
              key={t.id}
              onClick={() => setCategoryFilter(t.id)}
              style={{
                padding: "10px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                borderBottom: categoryFilter === t.id ? `2px solid ${t.red ? "#e05252" : "#1E2A3A"}` : "2px solid transparent",
                color: categoryFilter === t.id ? (t.red ? "#e05252" : "#1E2A3A") : "#8A9096",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </div>
          ))}
        </div>

        {/* Deleted contacts table */}
        {isDeleted && (
          <table className="mobile-cards" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ fontSize: 11, color: "#8A9096", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--c-border)" }}>
                <th style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600 }}>Category</th>
                <th style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600 }}>Name</th>
                <th style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600 }}>Deleted</th>
                <th style={{ textAlign: "left", padding: "6px 0", fontWeight: 600 }}>Days Remaining</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(deletedContacts === null) ? (
                <tr><td colSpan={5} style={{ padding: 20, color: "#8A9096", textAlign: "center" }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 20, color: "#8A9096", textAlign: "center" }}>No deleted contacts.</td></tr>
              ) : filtered.map(c => {
                const days = daysLeft(c.deletedAt);
                const catStyle = CONTACT_CAT_STYLE[c.category] || CONTACT_CAT_STYLE.Miscellaneous;
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid #ffffff" }}>
                    <td data-label="Category" style={{ padding: "10px 12px 10px 0" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: catStyle.bg, color: catStyle.color }}>{c.category}</span>
                    </td>
                    <td data-label="Name" style={{ padding: "10px 12px 10px 0", color: "var(--c-text)" }}>{c.name}</td>
                    <td data-label="Deleted" style={{ padding: "10px 12px 10px 0", color: "#8A9096" }}>{c.deletedAt ? new Date(c.deletedAt).toLocaleDateString() : ""}</td>
                    <td data-label="Remaining" style={{ padding: "10px 12px 10px 0", color: days <= 7 ? "#e05252" : "var(--c-text2)", fontWeight: days <= 7 ? 700 : 400 }}>{days} days</td>
                    <td data-label="" style={{ padding: "10px 0", textAlign: "right" }}>
                      <button onClick={() => handleRestoreContact(c.id)} style={{ background: "#dcfce7", border: "1px solid #bbf7d0", color: "#4CAE72", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>Restore</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Active contacts table */}
        {!isDeleted && (
          <>
            {mergeMode && (
              <div style={{ position: "sticky", top: 0, zIndex: 12, marginBottom: 0, padding: "10px 14px", background: "#dcfce7", border: "1px solid #bbf7d0", borderBottom: "none", borderRadius: "4px 4px 0 0", display: "flex", alignItems: "center", gap: 14, fontSize: 13 }}>
                <span style={{ color: "#4CAE72" }}>Select 2 or more contacts to merge.</span>
                {mergeSelected.size >= 2 && (
                  <button
                    onClick={async () => {
                      const selected = [...mergeSelected];
                      const toLoad = selected.filter(id => !contactNotes[id]);
                      if (toLoad.length > 0) {
                        await Promise.all(toLoad.map(id => apiGetContactNotes(id).then(notes => setContactNotes(p => ({ ...p, [id]: notes }))).catch(() => {})));
                      }
                      setShowMergeModal(true);
                    }}
                    style={{ background: "#1E2A3A", color: "var(--c-card)", border: "none", borderRadius: 4, padding: "6px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}
                  >
                    Merge Selected ({mergeSelected.size})
                  </button>
                )}
                <span style={{ color: "#8A9096", fontSize: 12 }}>{mergeSelected.size} selected</span>
              </div>
            )}
            <table className="mobile-cards" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ fontSize: 11, color: "#8A9096", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {mergeMode && <th style={{ width: 32, padding: "6px 8px 6px 0", position: "sticky", top: mergeMode ? 44 : 0, background: "var(--c-bg)", zIndex: 11, borderBottom: "1px solid var(--c-border)" }}></th>}
                  <th style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600, position: "sticky", top: mergeMode ? 44 : 0, background: "var(--c-bg)", zIndex: 11, borderBottom: "1px solid var(--c-border)" }}>Category</th>
                  <th style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600, position: "sticky", top: mergeMode ? 44 : 0, background: "var(--c-bg)", zIndex: 11, borderBottom: "1px solid var(--c-border)" }}>Name</th>
                  <th className="hide-mobile" style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600, position: "sticky", top: mergeMode ? 44 : 0, background: "var(--c-bg)", zIndex: 11, borderBottom: "1px solid var(--c-border)" }}>Phone</th>
                  <th className="hide-mobile" style={{ textAlign: "left", padding: "6px 12px 6px 0", fontWeight: 600, position: "sticky", top: mergeMode ? 44 : 0, background: "var(--c-bg)", zIndex: 11, borderBottom: "1px solid var(--c-border)" }}>Email</th>
                  <th style={{ textAlign: "left", padding: "6px 0", fontWeight: 600, position: "sticky", top: mergeMode ? 44 : 0, background: "var(--c-bg)", zIndex: 11, borderBottom: "1px solid var(--c-border)" }}>Cases</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={mergeMode ? 6 : 5} style={{ padding: 30, color: "#8A9096", textAlign: "center" }}>Loading contacts…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={mergeMode ? 6 : 5} style={{ padding: 30, color: "#8A9096", textAlign: "center" }}>
                    {search ? "No contacts match your search." : "No contacts in this category yet."}
                  </td></tr>
                ) : filtered.map(c => {
                  const catStyle = CONTACT_CAT_STYLE[c.category] || CONTACT_CAT_STYLE.Miscellaneous;
                  const caseCount = c.category === "Client"   ? allCases.filter(a => a.defendantName === c.name && !a.deletedAt).length
                                  : c.category === "Prosecutor" ? allCases.filter(a => a.prosecutor === c.name && !a.deletedAt).length
                                  : c.category === "Judge"    ? allCases.filter(a => a.judge === c.name && !a.deletedAt).length
                                  : (contactCaseCounts[c.id] || 0);
                  const isChecked = mergeSelected.has(c.id);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => mergeMode ? toggleMergeSelect(c.id) : handleSelectContact(c)}
                      style={{ borderBottom: "1px solid #ffffff", cursor: "pointer", transition: "background 0.1s", background: isChecked ? "#E4E7EB" : "" }}
                      onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = "var(--c-card)"; }}
                      onMouseLeave={e => { if (!isChecked) e.currentTarget.style.background = ""; }}
                    >
                      {mergeMode && (
                        <td data-label="" style={{ padding: "10px 8px 10px 0" }}>
                          <input type="checkbox" checked={isChecked} onChange={() => toggleMergeSelect(c.id)} onClick={e => e.stopPropagation()} style={{ width: 22, height: 22, cursor: "pointer" }} />
                        </td>
                      )}
                      <td data-label="Category" style={{ padding: "10px 12px 10px 0" }}>
                        <span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10, fontWeight: 700, background: catStyle.bg, color: "#1F2428" }}>
                          {c.category}
                        </span>
                      </td>
                      <td data-label="Name" style={{ padding: "10px 12px 10px 0", color: "var(--c-text)", fontWeight: 500 }}>{c.name}</td>
                      <td data-label="Phone" className="hide-mobile" style={{ padding: "10px 12px 10px 0", color: "var(--c-text2)", fontFamily: "monospace", fontSize: 12 }}>{c.phone || <span style={{ color: "var(--c-border)" }}>—</span>}</td>
                      <td data-label="Email" className="hide-mobile" style={{ padding: "10px 12px 10px 0", color: "#5599cc", fontSize: 12, wordBreak: "break-all" }}>{c.email || <span style={{ color: "var(--c-border)" }}>—</span>}</td>
                      <td data-label="Cases" style={{ padding: "10px 0", color: caseCount > 0 ? "#1E2A3A" : "var(--c-border)", fontWeight: caseCount > 0 ? 600 : 400 }}>
                        {caseCount > 0 ? caseCount : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {selectedContact && (
        <ContactDetailOverlay
          contact={selectedContact}
          currentUser={currentUser}
          notes={contactNotes[selectedContact.id]}
          allCases={allCases}
          onClose={() => setSelectedContact(null)}
          onUpdate={handleUpdateContact}
          onDelete={handleDeleteContact}
          onAddNote={handleAddNote}
          onDeleteNote={handleDeleteNote}
        />
      )}
      {showNew && <NewContactModal onSave={handleCreateContact} onClose={() => setShowNew(false)} />}
      {showMergeModal && mergeSelected.size >= 2 && (
        <ContactMergeModal
          contacts={(contacts || []).filter(c => mergeSelected.has(c.id))}
          contactNotes={contactNotes}
          onMerge={handleMerge}
          onClose={() => setShowMergeModal(false)}
        />
      )}
    </>
  );
}

function EditContactModal({ user, onSave, onClose }) {
  const [form, setForm] = useState({
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    cell: user.cell || "",
    ext: user.ext || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const saved = await onSave(user.id, { ...form, name: form.name.trim() });
      onClose(saved);
    } catch (err) {
      alert("Failed to save: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose(null)}>
      <div className="modal">
        <div className="modal-title">Edit Contact Info</div>
        <div className="modal-sub">{user.name} · {(user.roles && user.roles.length ? user.roles : [user.role]).join(", ")}</div>

        <div className="form-group"><label>Full Name</label><input value={form.name} onChange={e => set("name", e.target.value)} autoFocus /></div>
        <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="name@firm.com" /></div>
        <div className="form-group"><label>Extension</label><input value={form.ext} onChange={e => set("ext", e.target.value)} placeholder="e.g. 312" /></div>
        <div className="form-row">
          <div className="form-group"><label>Direct Line</label><input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(251) 278-0000" /></div>
          <div className="form-group"><label>Cell</label><input value={form.cell} onChange={e => set("cell", e.target.value)} placeholder="(251) 404-0000" /></div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={() => onClose(null)}>Cancel</button>
          <button className="btn btn-gold" disabled={!form.name.trim() || busy} onClick={handleSave}>
            {busy ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddStaffModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: "", roles: ["Trial Attorney"], email: "", phone: "", cell: "", ext: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const toggleRole = r => {
    const c = form.roles;
    const next = c.includes(r) ? c.filter(x => x !== r) : [...c, r];
    if (next.length > 0) set("roles", next);
  };

  const handleSave = async () => {
    if (!form.name.trim() || form.roles.length === 0) return;
    setBusy(true);
    try {
      const initials = makeInitials(form.name);
      const avatar = pickAvatar(form.name);
      const email = form.email.trim() || `${form.name.trim().toLowerCase().replace(/\s+/g, ".").replace(/[^a-z.]/g, "")}@firm.com`;
      const role = form.roles[0];
      const saved = await onSave({ ...form, name: form.name.trim(), role, initials, avatar, email });
      onClose(saved);
    } catch (err) {
      alert("Failed to add staff: " + err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose(null)}>
      <div className="modal">
        <div className="modal-title">Add Staff Member</div>
        <div className="modal-sub">A temporary password will be emailed to the new staff member.</div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#8A9096", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Role(s) *</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {STAFF_ROLES.map(r => {
              const checked = form.roles.includes(r);
              return (
                <label key={r} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 12, color: checked ? "#1E2A3A" : "#8A9096", userSelect: "none" }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleRole(r)} />
                  {r}
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-group"><label>Full Name *</label><input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Jane Smith" autoFocus /></div>
        <div className="form-group"><label>Extension</label><input value={form.ext} onChange={e => set("ext", e.target.value)} placeholder="e.g. 312" /></div>
        <div className="form-group"><label>Email</label><input value={form.email} onChange={e => set("email", e.target.value)} placeholder="auto-generated if blank" /></div>
        <div className="form-row">
          <div className="form-group"><label>Direct Line</label><input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="(251) 278-0000" /></div>
          <div className="form-group"><label>Cell</label><input value={form.cell} onChange={e => set("cell", e.target.value)} placeholder="(251) 404-0000" /></div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={() => onClose(null)}>Cancel</button>
          <button className="btn btn-gold" disabled={!form.name.trim() || form.roles.length === 0 || busy} onClick={handleSave}>
            {busy ? "Adding…" : "Add Staff Member"}
          </button>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
const CASE_FIELD_MAP = [
  { key: "title", label: "Case Title" },
  { key: "caseNum", label: "Case Number" },
  { key: "defendantName", label: "Defendant Name" },
  { key: "prosecutor", label: "Prosecutor" },
  { key: "chargeDescription", label: "Charge Description" },
  { key: "chargeStatute", label: "Statute" },
  { key: "chargeClass", label: "Charge Class" },
  { key: "caseType", label: "Case Type" },
  { key: "county", label: "County" },
  { key: "court", label: "Court" },
  { key: "courtDivision", label: "Court Division" },
  { key: "custodyStatus", label: "Custody Status" },
  { key: "bondAmount", label: "Bond Amount" },
  { key: "judge", label: "Judge" },
  { key: "type", label: "Case Type" },
  { key: "status", label: "Status" },
  { key: "stage", label: "Stage" },
  { key: "dispositionType", label: "Disposition" },
  { key: "arrestDate", label: "Arrest Date" },
  { key: "arraignmentDate", label: "Arraignment Date" },
  { key: "nextCourtDate", label: "Next Court Date" },
  { key: "trialDate", label: "Trial Date" },
  { key: "sentencingDate", label: "Sentencing Date" },
  { key: "dispositionDate", label: "Disposition Date" },
  { key: "_assignedAttorneyName", label: "Assigned Attorney Name" },
  { key: "_secondAttorneyName", label: "2nd Attorney Name" },
  { key: "_trialCoordinatorName", label: "Trial Coordinator Name" },
  { key: "_investigatorName", label: "Investigator Name" },
  { key: "_socialWorkerName", label: "Social Worker Name" },
  { key: "_todayDate", label: "Today's Date" },
];

function buildPartyFieldMap(parties) { // eslint-disable-line no-unused-vars
  const map = [];
  const grouped = {};
  for (const p of parties) {
    if (!grouped[p.partyType]) grouped[p.partyType] = [];
    grouped[p.partyType].push(p);
  }
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
  for (const [type, arr] of Object.entries(grouped)) {
    const typeSlug = slug(type);
    arr.forEach((party, idx) => {
      const n = idx + 1;
      const prefix = `_party_${typeSlug}_${n}`;
      const label = `${type} #${n}`;
      if (party.entityKind === "individual") {
        map.push({ key: `${prefix}_full_name`, label: `${label} — Full Name` });
        map.push({ key: `${prefix}_first_name`, label: `${label} — First Name` });
        map.push({ key: `${prefix}_middle_name`, label: `${label} — Middle Name` });
        map.push({ key: `${prefix}_last_name`, label: `${label} — Last Name` });
      } else {
        map.push({ key: `${prefix}_entity_name`, label: `${label} — Entity Name` });
        map.push({ key: `${prefix}_entity_type`, label: `${label} — Entity Type` });
        map.push({ key: `${prefix}_registered_agent`, label: `${label} — Registered Agent` });
        map.push({ key: `${prefix}_poc_name`, label: `${label} — POC Name` });
        map.push({ key: `${prefix}_poc_title`, label: `${label} — POC Title` });
        map.push({ key: `${prefix}_poc_phone`, label: `${label} — POC Phone` });
        map.push({ key: `${prefix}_poc_email`, label: `${label} — POC Email` });
      }
      map.push({ key: `${prefix}_address`, label: `${label} — Address` });
      map.push({ key: `${prefix}_full_address`, label: `${label} — Full Address` });
      map.push({ key: `${prefix}_city`, label: `${label} — City` });
      map.push({ key: `${prefix}_state`, label: `${label} — State` });
      map.push({ key: `${prefix}_zip`, label: `${label} — Zip` });
      map.push({ key: `${prefix}_email`, label: `${label} — Email` });
      map.push({ key: `${prefix}_phone`, label: `${label} — Phone (Primary)` });
    });
  }
  return map;
}

function getCaseFieldValue(c, key, parties) {
  if (key === "_todayDate") return new Date().toLocaleDateString();
  if (key === "_assignedAttorneyName") return USERS.find(u => u.id === c.assignedAttorney)?.name || "";
  if (key === "_secondAttorneyName") return USERS.find(u => u.id === c.secondAttorney)?.name || "";
  if (key === "_trialCoordinatorName") return USERS.find(u => u.id === c.trialCoordinator)?.name || "";
  if (key === "_investigatorName") return USERS.find(u => u.id === c.investigator)?.name || "";
  if (key === "_socialWorkerName") return USERS.find(u => u.id === c.socialWorker)?.name || "";
  if (key.startsWith("_party_") && parties) {
    const m = key.match(/^_party_(.+?)_(\d+)_(.+)$/);
    if (m) {
      const [, typeSlug, numStr, field] = m;
      const idx = parseInt(numStr) - 1;
      const grouped = {};
      for (const p of parties) {
        const s = p.partyType.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
        if (!grouped[s]) grouped[s] = [];
        grouped[s].push(p);
      }
      const party = (grouped[typeSlug] || [])[idx];
      if (!party) return "";
      const d = party.data || {};
      switch (field) {
        case "full_name": return [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
        case "first_name": return d.firstName || "";
        case "middle_name": return d.middleName || "";
        case "last_name": return d.lastName || "";
        case "entity_name": return d.entityName || "";
        case "entity_type": return d.entityType || "";
        case "registered_agent": return d.registeredAgent || "";
        case "poc_name": return d.pocName || "";
        case "poc_title": return d.pocTitle || "";
        case "poc_phone": return d.pocPhone || "";
        case "poc_email": return d.pocEmail || "";
        case "address": return d.address || "";
        case "full_address": return [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
        case "city": return d.city || "";
        case "state": return d.state || "";
        case "zip": return d.zip || "";
        case "email": return d.email || "";
        case "phone": return (d.phones || [])[0]?.number || "";
        default: return "";
      }
    }
  }
  return c[key] || "";
}

const TEMPLATE_CATEGORIES = ["Motions", "Orders", "Notices", "Subpoenas", "Client Letters", "General"];
const LETTER_SUB_TYPES = ["Client", "Prosecutor", "Court", "Other"];
const CATEGORY_COLORS = { Pleadings: "#dbeafe", Letters: "#fef3c7", Subpoenas: "#fce7f3", Reports: "#d1fae5", General: "#E4E7EB" };

function getPartyName(p) {
  const d = p.data || {};
  return p.entityKind === "corporation" ? (d.entityName || "") : [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
}

function getPlaceholderSuggestions(token, caseData, parties, experts) {
  const key = token.toLowerCase();
  const suggestions = [];
  const allParties = parties || [];
  const ourClient = allParties.find(p => p.data?.isOurClient);

  if (/^plaintiffs$/.test(key)) {
    const names = allParties.filter(p => /plaintiff/i.test(p.partyType)).map(getPartyName).filter(Boolean);
    if (names.length) suggestions.push({ label: "All Plaintiffs", value: names.join(",\n") });
    if (!names.length && caseData.prosecutor) suggestions.push({ label: "Prosecutor", value: caseData.prosecutor });
  } else if (/^defendants$/.test(key)) {
    const names = allParties.filter(p => /defendant/i.test(p.partyType)).map(getPartyName).filter(Boolean);
    if (names.length) suggestions.push({ label: "All Defendants", value: names.join(",\n") });
    if (!names.length && caseData.defendant) suggestions.push({ label: "Defendant", value: caseData.defendant });
  } else if (/^(defendant|def_name|def$)/.test(key)) {
    allParties.filter(p => /defendant/i.test(p.partyType)).forEach(p => {
      const name = getPartyName(p);
      if (name) suggestions.push({ label: `${p.partyType}: ${name}`, value: name });
    });
    if (!suggestions.length && caseData.defendant) suggestions.push({ label: "Defendant", value: caseData.defendant });
  } else if (/^(plaintiff|pl_name|pl$)/.test(key)) {
    allParties.filter(p => /plaintiff/i.test(p.partyType)).forEach(p => {
      const name = getPartyName(p);
      if (name) suggestions.push({ label: `${p.partyType}: ${name}`, value: name });
    });
    if (!suggestions.length && caseData.prosecutor) suggestions.push({ label: "Prosecutor", value: caseData.prosecutor });
  } else if (/^(client|client_name|our_client)/.test(key)) {
    if (ourClient) {
      const d = ourClient.data || {};
      const name = ourClient.entityKind === "corporation" ? (d.entityName || "") : [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
      if (name) suggestions.push({ label: "Our Client", value: name });
    }
    if (!suggestions.length && caseData.defendantName) suggestions.push({ label: "Defendant", value: caseData.defendantName });
  } else if (/^(client_address|our_client_address)/.test(key)) {
    if (ourClient) {
      const d = ourClient.data || {};
      const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
      if (addr) suggestions.push({ label: "Our Client Address", value: addr });
    }
  } else if (/^(case_number|case_no|civil_action|cause_no|case_num)/.test(key)) {
    if (caseData.caseNum) suggestions.push({ label: "Case Number", value: caseData.caseNum });
    if (caseData.shortCaseNum) suggestions.push({ label: "Short Case Number", value: caseData.shortCaseNum });
  } else if (/^(court$|court_name)/.test(key)) {
    if (caseData.court) suggestions.push({ label: "Court", value: caseData.court });
  } else if (/^(judge|judge_name)/.test(key)) {
    if (caseData.judge) suggestions.push({ label: "Judge", value: caseData.judge });
  } else if (/^(county|county_name)/.test(key)) {
    if (caseData.county) suggestions.push({ label: "County", value: caseData.county });
  } else if (/^(date|today|todays_date|current_date)/.test(key)) {
    suggestions.push({ label: "Today", value: new Date().toLocaleDateString() });
  } else if (/^(lead_attorney|attorney_name|attorney$|counsel$|assigned_attorney)/.test(key)) {
    const lead = USERS.find(u => u.id === caseData.assignedAttorney);
    if (lead) suggestions.push({ label: "Assigned Attorney", value: lead.name });
    const second = USERS.find(u => u.id === caseData.secondAttorney);
    if (second) suggestions.push({ label: "2nd Attorney", value: second.name });
  } else if (/^(opposing_counsel|opp_counsel|prosecutor)/.test(key)) {
    if (caseData.prosecutor) suggestions.push({ label: "Prosecutor", value: caseData.prosecutor });
  } else if (/^(case_title|case_style|case_name|title$|style)/.test(key)) {
    if (caseData.title) suggestions.push({ label: "Case Title", value: caseData.title });
  } else if (/^(defendant_name|defendant$)/.test(key)) {
    if (caseData.defendantName) suggestions.push({ label: "Defendant", value: caseData.defendantName });
  } else if (/^(trial_date)/.test(key)) {
    if (caseData.trialDate) suggestions.push({ label: "Trial Date", value: caseData.trialDate });
  } else if (/^(arrest_date)/.test(key)) {
    if (caseData.arrestDate) suggestions.push({ label: "Arrest Date", value: caseData.arrestDate });
  } else if (/^(expert|expert_name)/.test(key)) {
    (experts || []).forEach(ex => {
      const name = ex.data?.name || "";
      if (name) suggestions.push({ label: `Expert: ${name}`, value: name });
    });
    if (!suggestions.length && caseData.expert) suggestions.push({ label: "Expert", value: caseData.expert });
  } else if (/^(trial_coordinator|paralegal|paralegal_name)/.test(key)) {
    const para = USERS.find(u => u.id === caseData.trialCoordinator);
    if (para) suggestions.push({ label: "Trial Coordinator", value: para.name });
  } else if (/^(investigator|investigator_name)/.test(key)) {
    const inv = USERS.find(u => u.id === caseData.investigator);
    if (inv) suggestions.push({ label: "Investigator", value: inv.name });
  } else if (/^(social_worker|sw_name)/.test(key)) {
    const sw = USERS.find(u => u.id === caseData.socialWorker);
    if (sw) suggestions.push({ label: "Social Worker", value: sw.name });
  } else if (/defendant.*address/.test(key)) {
    allParties.filter(p => /defendant/i.test(p.partyType)).forEach(p => {
      const d = p.data || {};
      const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
      const name = p.entityKind === "corporation" ? (d.entityName || "") : [d.firstName, d.lastName].filter(Boolean).join(" ");
      if (addr) suggestions.push({ label: `${name} Address`, value: addr });
    });
  } else if (/plaintiff.*address/.test(key)) {
    allParties.filter(p => /plaintiff/i.test(p.partyType)).forEach(p => {
      const d = p.data || {};
      const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
      const name = p.entityKind === "corporation" ? (d.entityName || "") : [d.firstName, d.lastName].filter(Boolean).join(" ");
      if (addr) suggestions.push({ label: `${name} Address`, value: addr });
    });
  } else if (/^(state$|state_name)/.test(key)) {
    suggestions.push({ label: "Alabama", value: "Alabama" });
  } else if (/^(signature$)/.test(key)) {
    const lead = USERS.find(u => u.id === caseData.assignedAttorney);
    if (lead) suggestions.push({ label: `${lead.name}`, value: lead.name });
  } else if (/^(client_type)/.test(key)) {
    if (ourClient) {
      suggestions.push({ label: ourClient.partyType, value: ourClient.partyType });
    }
  } else if (/^(defendant_name)/.test(key)) {
    allParties.filter(p => /defendant/i.test(p.partyType)).forEach(p => {
      const name = getPartyName(p);
      if (name) suggestions.push({ label: `${p.partyType}: ${name}`, value: name });
    });
    if (!suggestions.length && caseData.defendant) suggestions.push({ label: "Defendant", value: caseData.defendant });
  } else if (/^(attorney_code|bar_number|bar_num)/.test(key)) {
  } else if (/^(attorney_firm|firm_name|firm$)/.test(key)) {
    suggestions.push({ label: "Mobile County Public Defender's Office", value: "Mobile County Public Defender's Office" });
  } else if (/^(attorney_address)/.test(key)) {
    suggestions.push({ label: "Office Address", value: "205 Government Street, Mobile, AL 36602" });
  } else if (/^(attorney_phone)/.test(key)) {
    const lead = USERS.find(u => u.id === caseData.assignedAttorney);
    if (lead?.phone) suggestions.push({ label: `${lead.name}`, value: lead.phone });
  } else if (/^(attorney_email)/.test(key)) {
    const lead = USERS.find(u => u.id === caseData.assignedAttorney);
    if (lead?.email) suggestions.push({ label: `${lead.name}`, value: lead.email });
  } else if (/^(today_date|todays_date)/.test(key)) {
    suggestions.push({ label: "Today", value: new Date().toLocaleDateString() });
  } else if (/addressee.*last|last.*name/.test(key)) {
    if (ourClient) {
      const d = ourClient.data || {};
      if (d.lastName) suggestions.push({ label: "Client Last Name", value: d.lastName });
    }
  }
  return suggestions;
}

const PLEADING_HEADER_PLACEHOLDERS = [
  { token: "COURT", label: "Court" },
  { token: "COUNTY", label: "County" },
  { token: "STATE", label: "State" },
  { token: "PLAINTIFFS", label: "Plaintiff(s)" },
  { token: "DEFENDANTS", label: "Defendant(s)" },
  { token: "CASE_NUMBER", label: "Case Number" },
];
const PLEADING_SIGNATURE_PLACEHOLDERS = [
  { token: "SIGNATURE", label: "Signature" },
  { token: "ATTORNEY_NAME", label: "Attorney Name" },
  { token: "ATTORNEY_CODE", label: "Attorney Code (Bar #)" },
  { token: "CLIENT_TYPE", label: "Client Type" },
  { token: "DEFENDANT_NAME", label: "Defendant Name" },
  { token: "ATTORNEY_FIRM", label: "Attorney Firm" },
  { token: "ATTORNEY_ADDRESS", label: "Attorney Address" },
  { token: "ATTORNEY_PHONE", label: "Attorney Phone" },
  { token: "ATTORNEY_EMAIL", label: "Attorney Email" },
];

function buildAllCaseFields(caseData, parties, experts) {
  const fields = [];
  const add = (cat, label, value) => { if (value) fields.push({ category: cat, label, value: String(value) }); };
  add("Case Info", "Case Title", caseData.title);
  add("Case Info", "Case Number", caseData.caseNum);
  add("Case Info", "Defendant", caseData.defendantName);
  add("Case Info", "Prosecutor", caseData.prosecutor);
  add("Case Info", "Charge Description", caseData.chargeDescription);
  add("Case Info", "Charge Statute", caseData.chargeStatute);
  add("Case Info", "Charge Class", caseData.chargeClass);
  add("Case Info", "Case Type", caseData.caseType);
  add("Case Info", "Court", caseData.court);
  add("Case Info", "Court Division", caseData.courtDivision);
  add("Case Info", "County", caseData.county);
  add("Case Info", "Judge", caseData.judge);
  add("Case Info", "Status", caseData.status);
  add("Case Info", "Stage", caseData.stage);
  add("Case Info", "Custody Status", caseData.custodyStatus);
  add("Case Info", "Bond Amount", caseData.bondAmount);
  add("Case Info", "State", "Alabama");
  const fmt = d => { try { return new Date(d).toLocaleDateString(); } catch { return ""; } };
  add("Dates", "Arrest Date", caseData.arrestDate ? fmt(caseData.arrestDate) : "");
  add("Dates", "Arraignment Date", caseData.arraignmentDate ? fmt(caseData.arraignmentDate) : "");
  add("Dates", "Next Court Date", caseData.nextCourtDate ? fmt(caseData.nextCourtDate) : "");
  add("Dates", "Trial Date", caseData.trialDate ? fmt(caseData.trialDate) : "");
  add("Dates", "Sentencing Date", caseData.sentencingDate ? fmt(caseData.sentencingDate) : "");
  add("Dates", "Disposition Date", caseData.dispositionDate ? fmt(caseData.dispositionDate) : "");
  add("Dates", "Today's Date", new Date().toLocaleDateString());
  const lead = USERS.find(u => u.id === caseData.assignedAttorney);
  const second = USERS.find(u => u.id === caseData.secondAttorney);
  const para = USERS.find(u => u.id === caseData.trialCoordinator);
  const inv = USERS.find(u => u.id === caseData.investigator);
  const sw = USERS.find(u => u.id === caseData.socialWorker);
  if (lead) { add("Staff", "Assigned Attorney", lead.name); add("Staff", "Assigned Attorney Email", lead.email); add("Staff", "Assigned Attorney Phone", lead.phone); }
  if (second) { add("Staff", "2nd Attorney", second.name); add("Staff", "2nd Attorney Email", second.email); add("Staff", "2nd Attorney Phone", second.phone); }
  if (para) { add("Staff", "Trial Coordinator", para.name); add("Staff", "Trial Coordinator Email", para.email); add("Staff", "Trial Coordinator Phone", para.phone); }
  if (inv) { add("Staff", "Investigator", inv.name); add("Staff", "Investigator Email", inv.email); add("Staff", "Investigator Phone", inv.phone); }
  if (sw) { add("Staff", "Social Worker", sw.name); add("Staff", "Social Worker Email", sw.email); add("Staff", "Social Worker Phone", sw.phone); }
  add("Staff", "Office", "Mobile County Public Defender's Office");
  add("Staff", "Office Address", "205 Government Street, Mobile, AL 36602");
  (parties || []).forEach(p => {
    const d = p.data || {};
    const name = p.entityKind === "corporation" ? (d.entityName || "") : [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
    if (!name) return;
    const prefix = `${p.partyType || "Party"}: ${name}`;
    add("Parties", `${prefix} — Name`, name);
    const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
    if (addr) add("Parties", `${prefix} — Address`, addr);
    if (d.phone) add("Parties", `${prefix} — Phone`, d.phone);
    if (d.email) add("Parties", `${prefix} — Email`, d.email);
    if (d.representedBy) add("Parties", `${prefix} — Represented By`, d.representedBy);
    if (d.isOurClient) add("Parties", "Our Client", name);
    if (p.entityKind === "individual") {
      if (d.ssnLast4) add("Parties", `${prefix} — SSN (last 4)`, d.ssnLast4);
      if (d.driversLicense) add("Parties", `${prefix} — Driver's License #`, d.driversLicense);
      if (d.employer) add("Parties", `${prefix} — Employer`, d.employer);
      if (d.occupation) add("Parties", `${prefix} — Occupation`, d.occupation);
      if (d.maritalStatus) add("Parties", `${prefix} — Marital Status`, d.maritalStatus);
      if (d.dob) add("Parties", `${prefix} — Date of Birth`, fmt(d.dob));
      if (d.dateOfDeath) add("Parties", `${prefix} — Date of Death`, fmt(d.dateOfDeath));
      if (d.isMinor) add("Parties", `${prefix} — Minor`, "Yes");
    } else {
      if (d.stateOfIncorporation) add("Parties", `${prefix} — State of Incorporation`, d.stateOfIncorporation);
      if (d.principalPlaceOfBusiness) add("Parties", `${prefix} — Principal Place of Business`, d.principalPlaceOfBusiness);
    }
  });
  (experts || []).forEach(ex => {
    const d = ex.data || {};
    if (!d.name) return;
    const prefix = d.name;
    add("Experts", `${prefix} — Name`, d.name);
    if (d.type) add("Experts", `${prefix} — Type`, d.type);
    if (d.company) add("Experts", `${prefix} — Company`, d.company);
    if (d.specialty) add("Experts", `${prefix} — Specialty`, d.specialty);
    if (d.phone) add("Experts", `${prefix} — Phone`, d.phone);
    if (d.email) add("Experts", `${prefix} — Email`, d.email);
    if (d.rate) add("Experts", `${prefix} — Rate`, d.rate);
    if (d.retainedDate) add("Experts", `${prefix} — Retained Date`, fmt(d.retainedDate));
    if (d.reportDate) add("Experts", `${prefix} — Report Date`, fmt(d.reportDate));
    if (d.depositionDate) add("Experts", `${prefix} — Deposition Date`, fmt(d.depositionDate));
  });
  return fields;
}

function GenerateDocumentModal({ caseData, currentUser, onClose, parties, experts, caseId, onAddNote, onLogActivity }) {
  const [mode, setMode] = useState("template");
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [values, setValues] = useState({});
  const [generating, setGenerating] = useState(false);
  const [includeCoS, setIncludeCoS] = useState(true);
  const [browseOpen, setBrowseOpen] = useState(null);
  const [aiDraft, setAiDraft] = useState({ loading: false, result: null, error: null, docType: "Motion to Suppress", instructions: "" });

  useEffect(() => {
    apiGetTemplates().then(t => { setTemplates(t); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const allTags = [...new Set(templates.flatMap(t => t.tags))].sort();
  const allCategories = [...new Set(templates.map(t => t.category || "General"))].sort();
  const filtered = templates.filter(t => {
    if (filter === "mine" && t.createdBy !== currentUser.id) return false;
    if (filter === "other" && t.createdBy === currentUser.id) return false;
    if (catFilter && (t.category || "General") !== catFilter) return false;
    if (tagFilter && !t.tags.includes(tagFilter)) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleSelect = (tmpl) => {
    setSelected(tmpl);
    const v = {};
    const isPleading = tmpl.category === "Pleadings";
    const allPhs = [...tmpl.placeholders];
    if (isPleading) {
      const existing = new Set(allPhs.map(p => p.token));
      for (const sys of [...PLEADING_HEADER_PLACEHOLDERS, ...PLEADING_SIGNATURE_PLACEHOLDERS]) {
        if (!existing.has(sys.token)) allPhs.push(sys);
      }
    }
    for (const ph of allPhs) {
      if (ph.mapping && ph.mapping !== "_manual") {
        v[ph.token] = getCaseFieldValue(caseData, ph.mapping, parties || []);
      } else {
        const sugs = getPlaceholderSuggestions(ph.token, caseData, parties, experts);
        v[ph.token] = sugs.length === 1 ? sugs[0].value : "";
      }
    }
    if (tmpl.category === "Letters" && tmpl.subType) {
      const ourClient = (parties || []).find(p => p.data?.isOurClient);
      if (tmpl.subType === "Client" && ourClient) {
        const d = ourClient.data || {};
        const name = ourClient.entityKind === "corporation" ? (d.entityName || "") : [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
        const addr = [d.address, d.city, d.state, d.zip].filter(Boolean).join(", ");
        for (const ph of tmpl.placeholders) {
          const k = ph.token.toLowerCase();
          if (/addressee|recipient|to_name/.test(k) && name) v[ph.token] = v[ph.token] || name;
          if (/address|to_address/.test(k) && addr) v[ph.token] = v[ph.token] || addr;
        }
      } else if (tmpl.subType === "Attorney") {
        if (caseData.prosecutor) {
          for (const ph of tmpl.placeholders) {
            const k = ph.token.toLowerCase();
            if (/addressee|recipient|to_name|attorney/.test(k)) v[ph.token] = v[ph.token] || caseData.prosecutor;
          }
        }
      }
    }
    setValues(v);
    setIncludeCoS(tmpl.category === "Pleadings");
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const blob = await apiGenerateDocument(selected.id, values, caseData.id, selected.category === "Pleadings" ? includeCoS : false);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selected.name} - ${caseData.title || "Document"}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      alert("Failed to generate document: " + err.message);
    }
    setGenerating(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--c-bg)", borderRadius: 12, width: "90%", maxWidth: 750, maxHeight: "85vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "20px 24px 0", borderBottom: "1px solid var(--c-border)", paddingBottom: 0, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, margin: 0, color: "var(--c-text-h)" }}>
              {mode === "template" && selected ? "Fill in Document Fields" : "Generate Document"}
            </h2>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--c-text2)" }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 0, marginTop: 12 }}>
            <button onClick={() => setMode("template")} style={{ fontSize: 13, fontWeight: mode === "template" ? 600 : 400, padding: "8px 18px", border: "none", borderBottom: mode === "template" ? "2px solid #1E2A3A" : "2px solid transparent", background: "none", color: mode === "template" ? "var(--c-text-h)" : "var(--c-text2)", cursor: "pointer" }}>From Template</button>
            <button onClick={() => setMode("ai")} style={{ fontSize: 13, fontWeight: mode === "ai" ? 600 : 400, padding: "8px 18px", border: "none", borderBottom: mode === "ai" ? "2px solid #b8860b" : "2px solid transparent", background: "none", color: mode === "ai" ? "#b8860b" : "var(--c-text2)", cursor: "pointer" }}>AI Draft</button>
          </div>
          {mode === "template" && selected && (
            <div style={{ fontSize: 12, color: "#1E2A3A", padding: "8px 0 4px", cursor: "pointer" }} onClick={() => { setSelected(null); setValues({}); }}>
              ← Back to template list
            </div>
          )}
        </div>

        <div style={{ padding: 24, flex: 1, overflowY: "auto", minHeight: 0 }}>
          {mode === "ai" && (
            <div>
              <div style={{ fontSize: 12, color: "var(--c-text2)", marginBottom: 16 }}>Generate a first draft of a motion, plea, or memorandum using AI — tailored to your case details.</div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text-h)", marginBottom: 4, display: "block" }}>Document Type</label>
                <select value={aiDraft.docType} onChange={e => setAiDraft(p => ({ ...p, docType: e.target.value, customType: e.target.value !== "Other" ? "" : (p.customType || "") }))} style={{ width: "100%", padding: "8px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg2)", color: "var(--c-text)" }}>
                  {["Motion to Suppress", "Motion to Dismiss", "Bond Reduction Motion", "Continuance Request", "Discovery Demand", "Plea Agreement Draft", "Sentencing Memorandum", "Motion for Speedy Trial", "Other"].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              {aiDraft.docType === "Other" && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text-h)", marginBottom: 4, display: "block" }}>Specify Document Type</label>
                  <input type="text" value={aiDraft.customType || ""} onChange={e => setAiDraft(p => ({ ...p, customType: e.target.value }))} placeholder="e.g. Habeas Corpus Petition, Expungement Motion, Subpoena..." style={{ width: "100%", padding: "8px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-bg2)", color: "var(--c-text)" }} />
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text-h)", marginBottom: 4, display: "block" }}>Additional Instructions (optional)</label>
                <textarea value={aiDraft.instructions} onChange={e => setAiDraft(p => ({ ...p, instructions: e.target.value }))} style={{ width: "100%", minHeight: 60, padding: "8px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 12, resize: "vertical", fontFamily: "inherit", background: "var(--c-bg2)", color: "var(--c-text)" }} placeholder="e.g. Focus on Fourth Amendment issues, include specific facts about the traffic stop..." />
              </div>
              {!aiDraft.result && !aiDraft.loading && (
                <button className="btn btn-gold" style={{ width: "100%" }} onClick={() => {
                  const effectiveType = aiDraft.docType === "Other" ? ((aiDraft.customType || "").trim() || "Other Document") : aiDraft.docType;
                  setAiDraft(p => ({ ...p, loading: true, result: null, error: null }));
                  apiDraftDocument({ caseId: caseId || caseData.id, documentType: effectiveType, customInstructions: aiDraft.instructions })
                    .then(r => setAiDraft(p => ({ ...p, loading: false, result: r.result })))
                    .catch(e => setAiDraft(p => ({ ...p, loading: false, error: e.message })));
                }}>Generate Draft</button>
              )}
              {(aiDraft.loading || aiDraft.result || aiDraft.error) && (
                <AiPanel title={aiDraft.docType} result={aiDraft.result} loading={aiDraft.loading} error={aiDraft.error}
                  onRun={() => {
                    setAiDraft(p => ({ ...p, loading: true, result: null, error: null }));
                    apiDraftDocument({ caseId: caseId || caseData.id, documentType: aiDraft.docType, customInstructions: aiDraft.instructions })
                      .then(r => setAiDraft(p => ({ ...p, loading: false, result: r.result })))
                      .catch(e => setAiDraft(p => ({ ...p, loading: false, error: e.message })));
                  }}
                  actions={aiDraft.result ? (
                    <Fragment>
                      <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => { navigator.clipboard.writeText(aiDraft.result); }}>Copy</button>
                      {onAddNote && <button className="btn btn-outline btn-sm" style={{ fontSize: 10, padding: "2px 8px" }} onClick={() => {
                        onAddNote({ caseId: caseId || caseData.id, body: aiDraft.result, type: "Draft" });
                        if (onLogActivity) onLogActivity("AI Draft Saved", `${aiDraft.docType} draft saved as note`);
                        alert("Draft saved as case note.");
                      }}>Save as Note</button>}
                    </Fragment>
                  ) : null}
                />
              )}
            </div>
          )}
          {mode === "template" && loading && <div style={{ color: "#8A9096", fontSize: 13 }}>Loading templates...</div>}

          {mode === "template" && !loading && !selected && (
            <>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 6 }}>Document Type</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["", ...allCategories].map(cat => (
                    <button key={cat || "_all"} onClick={() => setCatFilter(cat)}
                      style={{ fontSize: 12, padding: "7px 14px", borderRadius: 6, border: catFilter === cat ? "2px solid #1E2A3A" : "1px solid var(--c-border)", background: catFilter === cat ? "#1E2A3A" : "var(--c-bg2)", color: catFilter === cat ? "#fff" : "var(--c-text)", cursor: "pointer", fontWeight: catFilter === cat ? 600 : 400, transition: "all 0.15s" }}
                    >{cat || "All Types"}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                <input placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 150, fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }} />
                <select value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }}>
                  <option value="all">All Templates</option>
                  <option value="mine">My Templates</option>
                  <option value="other">Others' Templates</option>
                </select>
                {allTags.length > 0 && (
                  <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }}>
                    <option value="">All Tags</option>
                    {allTags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </div>
              {filtered.length === 0 && <div style={{ fontSize: 13, color: "#8A9096", fontStyle: "italic", padding: "20px 0" }}>No templates found{catFilter ? ` for "${catFilter}"` : ""}. Upload templates from the Documents view first.</div>}
              {filtered.map(t => (
                <div key={t.id} onClick={() => handleSelect(t)} style={{ padding: "12px 14px", borderRadius: 8, border: "1px solid var(--c-border)", marginBottom: 8, cursor: "pointer", background: "var(--c-bg2)", transition: "border-color 0.15s" }} onMouseOver={e => e.currentTarget.style.borderColor = "#1E2A3A"} onMouseOut={e => e.currentTarget.style.borderColor = ""}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text)" }}>{t.name}</div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: CATEGORY_COLORS[t.category] || "#E4E7EB", color: "#1F2428" }}>{t.category || "General"}{t.subType ? ` — ${t.subType}` : ""}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>by {t.createdByName} · {t.placeholders.length} field{t.placeholders.length !== 1 ? "s" : ""}</div>
                  {t.tags.length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                      {t.tags.map(tag => <span key={tag} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#E4E7EB", color: "#1F2428" }}>{tag}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {mode === "template" && !loading && selected && (() => {
            const isPleading = selected.category === "Pleadings";
            const headerTokens = new Set(PLEADING_HEADER_PLACEHOLDERS.map(p => p.token));
            const sigTokens = new Set(PLEADING_SIGNATURE_PLACEHOLDERS.map(p => p.token));
            const bodyPhs = selected.placeholders.filter(ph => !isPleading || (!headerTokens.has(ph.token) && !sigTokens.has(ph.token)));
            const sectionLabel = (label) => (
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-text2)", textTransform: "uppercase", letterSpacing: 0.5, padding: "8px 0 4px", borderTop: "1px solid var(--c-border)", marginTop: 10 }}>{label}</div>
            );
            const allFields = buildAllCaseFields(caseData, parties, experts);
            const fieldCategories = [...new Set(allFields.map(f => f.category))];
            const renderPh = (ph) => {
              const sugs = getPlaceholderSuggestions(ph.token, caseData, parties, experts);
              const isOpen = browseOpen === ph.token;
              return (
                <div key={ph.token} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)" }}>{ph.label}</label>
                    <button
                      onClick={() => setBrowseOpen(isOpen ? null : ph.token)}
                      style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, border: "1px solid var(--c-border)", background: isOpen ? "#1E2A3A" : "var(--c-bg2)", color: isOpen ? "#fff" : "var(--c-text2)", cursor: "pointer" }}
                    >{isOpen ? "Close Fields" : "Browse Fields"}</button>
                  </div>
                  {sugs.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
                      {sugs.map((s, i) => (
                        <button key={i} onClick={() => setValues(v => ({ ...v, [ph.token]: s.value }))}
                          style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, border: "1px solid var(--c-border)", background: values[ph.token] === s.value ? "#1E2A3A" : "var(--c-bg2)", color: values[ph.token] === s.value ? "#fff" : "var(--c-text)", cursor: "pointer" }}
                        >{s.label}</button>
                      ))}
                    </div>
                  )}
                  {isOpen && (
                    <div style={{ border: "1px solid var(--c-border)", borderRadius: 8, background: "var(--c-bg2)", maxHeight: 200, overflowY: "auto", marginBottom: 6 }}>
                      {fieldCategories.map(cat => {
                        const catFields = allFields.filter(f => f.category === cat);
                        if (!catFields.length) return null;
                        return (
                          <div key={cat}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--c-text2)", textTransform: "uppercase", letterSpacing: 0.5, padding: "6px 10px 2px", background: "var(--c-bg)", position: "sticky", top: 0 }}>{cat}</div>
                            {catFields.map((f, i) => (
                              <div
                                key={i}
                                onClick={() => { setValues(v => ({ ...v, [ph.token]: f.value })); setBrowseOpen(null); }}
                                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px", cursor: "pointer", fontSize: 11, borderBottom: "1px solid var(--c-border)" }}
                                onMouseEnter={e => e.currentTarget.style.background = "var(--c-hover)"}
                                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                              >
                                <span style={{ color: "var(--c-text2)", marginRight: 8, flexShrink: 0 }}>{f.label}</span>
                                <span style={{ color: "var(--c-text)", fontWeight: 500, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{f.value}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <input
                    value={values[ph.token] || ""}
                    onChange={e => setValues(v => ({ ...v, [ph.token]: e.target.value }))}
                    style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", boxSizing: "border-box" }}
                    placeholder={`Leave empty for <<${ph.token}>>`}
                  />
                </div>
              );
            };
            return (
              <>
                <div style={{ fontSize: 13, color: "var(--c-text2)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Template: <strong>{selected.name}</strong></span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: CATEGORY_COLORS[selected.category] || "#E4E7EB", color: "#1F2428" }}>{selected.category || "General"}</span>
                </div>
                <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 16 }}>
                  Fill in fields below. Empty fields will appear as {"<<PLACEHOLDER>>"} in the document.
                  {isPleading && <span style={{ display: "block", marginTop: 4, color: "var(--c-text2)" }}>Case Header and Signature Block will be automatically included.</span>}
                </div>
                {isPleading && sectionLabel("Case Caption")}
                {isPleading && PLEADING_HEADER_PLACEHOLDERS.map(renderPh)}
                {bodyPhs.length > 0 && isPleading && sectionLabel("Document Body")}
                {bodyPhs.map(renderPh)}
                {isPleading && sectionLabel("Signature Block")}
                {isPleading && PLEADING_SIGNATURE_PLACEHOLDERS.map(renderPh)}
                {!isPleading && selected.placeholders.map(renderPh)}
                {isPleading && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--c-text2)", padding: "12px 0", borderTop: "1px solid var(--c-border)", marginTop: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={includeCoS} onChange={e => setIncludeCoS(e.target.checked)} />
                    Include Certificate of Service
                  </label>
                )}
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", padding: "10px", fontSize: 14, marginTop: 8 }}
                  disabled={generating}
                  onClick={handleGenerate}
                >{generating ? "Generating..." : "Generate & Download"}</button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function DocumentsView({ currentUser, allCases, onMenuToggle }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(null);

  useEffect(() => {
    apiGetTemplates().then(t => { setTemplates(t); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const allTags = [...new Set(templates.flatMap(t => t.tags))].sort();
  const allCategories = [...new Set(templates.map(t => t.category || "General"))].sort();
  const [filter, setFilter] = useState("all");
  const [catFilter, setCatFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [search, setSearch] = useState("");

  const filtered = templates.filter(t => {
    if (filter === "mine" && t.createdBy !== currentUser.id) return false;
    if (catFilter && (t.category || "General") !== catFilter) return false;
    if (tagFilter && !t.tags.includes(tagFilter)) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="topbar">
        <div className="topbar-row" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div><div className="topbar-title">Document Templates</div><div className="topbar-subtitle">{templates.length} template{templates.length !== 1 ? "s" : ""}</div></div>
          <button className="btn btn-primary" onClick={() => document.getElementById("docUploadInput").click()}>+ New Template</button>
          <input id="docUploadInput" type="file" accept=".docx,.doc" style={{ display: "none" }} onChange={async e => {
            const file = e.target.files[0]; if (!file) return; e.target.value = "";
            try {
              const parsed = await apiUploadTemplateFile(file);
              const detected = (parsed.detectedPlaceholders || []).map(ph => ({
                ...ph, id: Date.now() + Math.random(), autoDetected: true,
                start: parsed.text.indexOf(`<<${ph.token}>>`),
                end: parsed.text.indexOf(`<<${ph.token}>>`) + `<<${ph.token}>>`.length,
                original: "",
              }));
              setWizard({ step: 1, file, text: parsed.text, paragraphs: parsed.paragraphs, placeholders: detected, name: file.name.replace(/\.(docx?|doc)$/i, ""), tags: [], newTag: "", isDoc: parsed.isDoc, category: "General", subType: "" });
            } catch (err) { alert("Failed to parse document: " + err.message); }
          }} />
        </div>
      </div>
      <div className="content">

      {!wizard && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "20px 0", flexWrap: "wrap" }}>
            <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 150, fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }} />
            <select value={filter} onChange={e => setFilter(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }}>
              <option value="all">All</option>
              <option value="mine">My Templates</option>
            </select>
            {allCategories.length > 1 && (
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }}>
                <option value="">All Categories</option>
                {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {allTags.length > 0 && (
              <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }}>
                <option value="">All Tags</option>
                {allTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          {loading && <div style={{ color: "#8A9096", fontSize: 13, padding: 20 }}>Loading...</div>}
          {!loading && filtered.length === 0 && <div style={{ color: "#8A9096", fontSize: 13, fontStyle: "italic", padding: 20 }}>No templates yet. Click "+ New Template" to upload a .doc or .docx file and create your first template.</div>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {filtered.map(t => {
              const canEdit = t.createdBy === currentUser.id || hasRole(currentUser, "Public Defender") || hasRole(currentUser, "Chief Deputy Public Defender") || hasRole(currentUser, "Deputy Public Defender");
              return (
              <div key={t.id} style={{ padding: 16, borderRadius: 10, border: "1px solid var(--c-border)", background: "var(--c-bg2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "var(--c-text)" }}>{t.name}</div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: CATEGORY_COLORS[t.category] || "#E4E7EB", color: "#1F2428" }}>{t.category || "General"}{t.subType ? ` — ${t.subType}` : ""}</span>
                  </div>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: t.visibility === "personal" ? "#fef3c7" : "#ecfdf5", color: "#1F2428", flexShrink: 0, marginLeft: 8 }}>
                    {t.visibility === "personal" ? "Personal" : "Global"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#8A9096" }}>by {t.createdByName} · {t.placeholders.length} field{t.placeholders.length !== 1 ? "s" : ""}</div>
                {t.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                    {t.tags.map(tag => <span key={tag} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: "#E4E7EB", color: "#1F2428" }}>{tag}</span>)}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {canEdit && (
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={async () => {
                      try {
                        const source = await apiGetTemplateSource(t.id);
                        setWizard({
                          step: 2,
                          editingId: t.id,
                          text: source.text,
                          placeholders: source.placeholders,
                          name: t.name,
                          tags: [...(t.tags || [])],
                          newTag: "",
                          visibility: t.visibility || "global",
                          category: t.category || "General",
                          subType: t.subType || "",
                          file: null,
                        });
                      } catch (err) { alert("Failed to load template: " + err.message); }
                    }}>Edit</button>
                  )}
                  {canEdit && (
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 11, color: "#e05252", borderColor: "#e05252" }} onClick={async () => {
                      if (!window.confirm(`Delete template "${t.name}"?`)) return;
                      try { await apiDeleteTemplate(t.id); setTemplates(p => p.filter(x => x.id !== t.id)); } catch (err) { alert(err.message); }
                    }}>Delete</button>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Template Creation Wizard ── */}
      {wizard && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
            {(wizard.editingId ? ["Placeholders", "Review & Save"] : ["Name & Category", "Placeholders", "Review & Save"]).map((label, i) => {
              const stepNum = wizard.editingId ? i + 2 : i + 1;
              return <div key={i} style={{ flex: 1, textAlign: "center", padding: "8px 0", fontSize: 12, fontWeight: wizard.step === stepNum ? 700 : 400, color: wizard.step === stepNum ? "#1E2A3A" : "#8A9096", borderBottom: `2px solid ${wizard.step === stepNum ? "#1E2A3A" : "var(--c-border)"}` }}>{i + 1}. {label}</div>;
            })}
          </div>

          {wizard.isDoc && wizard.step >= 1 && (
            <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#92400e" }}>
              This .doc file has been converted to .docx format. The text content is preserved, but some formatting may be simplified. For best results, use .docx files.
            </div>
          )}

          {/* Step 1: Name, Category, Tags (new templates only) */}
          {!wizard.editingId && wizard.step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 260px)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 4, flexShrink: 0 }}>Step 1: Name & Category</div>
              <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 16, flexShrink: 0 }}>Name your template and choose a category.</div>

              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Template Name</label>
                  <input value={wizard.name} onChange={e => setWizard(w => ({ ...w, name: e.target.value }))} style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", boxSizing: "border-box" }} autoFocus />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 6 }}>Category</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {TEMPLATE_CATEGORIES.map(cat => (
                      <button key={cat} onClick={async () => {
                        setWizard(w => ({ ...w, category: cat, subType: cat !== "Letters" ? "" : w.subType }));
                        if (cat === "Pleadings" && wizard.file && !wizard.detectionDone) {
                          setWizard(w => ({ ...w, category: cat, subType: "", detectingPleading: true }));
                          try {
                            const result = await apiDetectPleadingSections(wizard.file);
                            setWizard(w => ({ ...w, detectingPleading: false, detectionDone: true, detectedSections: result, useSystemHeader: !result.hasHeader, useSystemSignature: !result.hasSignature, useSystemCos: !result.hasCos }));
                          } catch { setWizard(w => ({ ...w, detectingPleading: false, detectionDone: true, detectedSections: { hasHeader: false, hasSignature: false, hasCos: false } })); }
                        }
                      }}
                        style={{ padding: "8px 16px", borderRadius: 8, border: `2px solid ${wizard.category === cat ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.category === cat ? CATEGORY_COLORS[cat] : "var(--c-bg2)", cursor: "pointer", fontSize: 13, fontWeight: wizard.category === cat ? 700 : 400, color: "var(--c-text)" }}
                      >{cat}</button>
                    ))}
                  </div>
                </div>

                {wizard.category === "Pleadings" && wizard.detectingPleading && (
                  <div style={{ background: "#EFF6FF", border: "1px solid #93C5FD", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#1E40AF" }}>
                    Analyzing document for existing pleading sections...
                  </div>
                )}

                {wizard.category === "Pleadings" && wizard.detectionDone && wizard.detectedSections && (wizard.detectedSections.hasHeader || wizard.detectedSections.hasSignature || wizard.detectedSections.hasCos) && (
                  <div style={{ background: "var(--c-bg2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)", marginBottom: 4 }}>Pleading Sections Detected</div>
                    <div style={{ fontSize: 12, color: "var(--c-text3)", marginBottom: 12 }}>Your document appears to contain some standard pleading sections. For each one, choose whether to use the system-provided version or keep what's in your document.</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {wizard.detectedSections.hasHeader && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)" }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)" }}>Case Header (Caption Block)</div>
                            <div style={{ fontSize: 11, color: "var(--c-text3)" }}>Court name, parties, case number</div>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => setWizard(w => ({ ...w, useSystemHeader: true }))} style={{ padding: "4px 10px", borderRadius: 5, border: `2px solid ${wizard.useSystemHeader ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.useSystemHeader ? "#d1fae5" : "var(--c-bg2)", cursor: "pointer", fontSize: 11, fontWeight: wizard.useSystemHeader ? 600 : 400, color: "var(--c-text)" }}>Use System</button>
                            <button onClick={() => setWizard(w => ({ ...w, useSystemHeader: false }))} style={{ padding: "4px 10px", borderRadius: 5, border: `2px solid ${!wizard.useSystemHeader ? "#1E2A3A" : "var(--c-border)"}`, background: !wizard.useSystemHeader ? "#FEF3C7" : "var(--c-bg2)", cursor: "pointer", fontSize: 11, fontWeight: !wizard.useSystemHeader ? 600 : 400, color: "var(--c-text)" }}>Use Document's Own</button>
                          </div>
                        </div>
                      )}
                      {wizard.detectedSections.hasSignature && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)" }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)" }}>Signature Block</div>
                            <div style={{ fontSize: 11, color: "var(--c-text3)" }}>Attorney name, firm, address</div>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => setWizard(w => ({ ...w, useSystemSignature: true }))} style={{ padding: "4px 10px", borderRadius: 5, border: `2px solid ${wizard.useSystemSignature ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.useSystemSignature ? "#d1fae5" : "var(--c-bg2)", cursor: "pointer", fontSize: 11, fontWeight: wizard.useSystemSignature ? 600 : 400, color: "var(--c-text)" }}>Use System</button>
                            <button onClick={() => setWizard(w => ({ ...w, useSystemSignature: false }))} style={{ padding: "4px 10px", borderRadius: 5, border: `2px solid ${!wizard.useSystemSignature ? "#1E2A3A" : "var(--c-border)"}`, background: !wizard.useSystemSignature ? "#FEF3C7" : "var(--c-bg2)", cursor: "pointer", fontSize: 11, fontWeight: !wizard.useSystemSignature ? 600 : 400, color: "var(--c-text)" }}>Use Document's Own</button>
                          </div>
                        </div>
                      )}
                      {wizard.detectedSections.hasCos && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg)" }}>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text)" }}>Certificate of Service</div>
                            <div style={{ fontSize: 11, color: "var(--c-text3)" }}>Service attestation with party list</div>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => setWizard(w => ({ ...w, useSystemCos: true }))} style={{ padding: "4px 10px", borderRadius: 5, border: `2px solid ${wizard.useSystemCos ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.useSystemCos ? "#d1fae5" : "var(--c-bg2)", cursor: "pointer", fontSize: 11, fontWeight: wizard.useSystemCos ? 600 : 400, color: "var(--c-text)" }}>Use System</button>
                            <button onClick={() => setWizard(w => ({ ...w, useSystemCos: false }))} style={{ padding: "4px 10px", borderRadius: 5, border: `2px solid ${!wizard.useSystemCos ? "#1E2A3A" : "var(--c-border)"}`, background: !wizard.useSystemCos ? "#FEF3C7" : "var(--c-bg2)", cursor: "pointer", fontSize: 11, fontWeight: !wizard.useSystemCos ? 600 : 400, color: "var(--c-text)" }}>Use Document's Own</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {wizard.category === "Letters" && (
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 6 }}>Letter Type</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {LETTER_SUB_TYPES.map(st => (
                        <button key={st} onClick={() => setWizard(w => ({ ...w, subType: st }))}
                          style={{ padding: "6px 14px", borderRadius: 6, border: `2px solid ${wizard.subType === st ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.subType === st ? "#fef3c7" : "var(--c-bg2)", cursor: "pointer", fontSize: 12, fontWeight: wizard.subType === st ? 700 : 400, color: "var(--c-text)" }}
                        >{st}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Tags</label>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                    {wizard.tags.map(tag => (
                      <span key={tag} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 10, background: "#E4E7EB", color: "#1F2428", cursor: "pointer" }} onClick={() => setWizard(w => ({ ...w, tags: w.tags.filter(t => t !== tag) }))}>
                        {tag} ✕
                      </span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input placeholder="Add a tag (e.g., Discovery, Motions)" value={wizard.newTag || ""} onChange={e => setWizard(w => ({ ...w, newTag: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter" && wizard.newTag?.trim()) { setWizard(w => ({ ...w, tags: [...w.tags, w.newTag.trim()], newTag: "" })); } }}
                      style={{ flex: 1, fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }} />
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={() => { if (wizard.newTag?.trim()) setWizard(w => ({ ...w, tags: [...w.tags, w.newTag.trim()], newTag: "" })); }}>Add Tag</button>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 6 }}>Visibility</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setWizard(w => ({ ...w, visibility: "global" }))}
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `2px solid ${(wizard.visibility || "global") === "global" ? "#1E2A3A" : "var(--c-border)"}`, background: (wizard.visibility || "global") === "global" ? "#E4E7EB" : "var(--c-bg2)", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>Everyone</div>
                      <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>All staff can use this template</div>
                    </button>
                    <button onClick={() => setWizard(w => ({ ...w, visibility: "personal" }))}
                      style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `2px solid ${wizard.visibility === "personal" ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.visibility === "personal" ? "#E4E7EB" : "var(--c-bg2)", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>Only Me</div>
                      <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>Only visible to you</div>
                    </button>
                  </div>
                </div>

                {wizard.placeholders.length > 0 && (
                  <div style={{ background: "#d1fae5", border: "1px solid #10b981", borderRadius: 6, padding: "8px 14px", fontSize: 12, color: "#065f46" }}>
                    {wizard.placeholders.length} placeholder{wizard.placeholders.length !== 1 ? "s" : ""} auto-detected from {"<<"} {">> markers in your document."}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, flexShrink: 0, paddingTop: 8 }}>
                <button className="btn btn-outline" onClick={() => setWizard(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={!wizard.name?.trim()} onClick={() => setWizard(w => ({ ...w, step: 2 }))}>Next: Placeholders</button>
              </div>
            </div>
          )}

          {/* Step 2: Select Placeholders */}
          {wizard.step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 260px)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 4, flexShrink: 0 }}>{wizard.editingId ? "Edit Placeholders" : "Step 2: Placeholders"}</div>
              <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 16, flexShrink: 0 }}>
                {wizard.editingId ? "Your existing placeholders are shown below. Add new ones or remove existing ones." : "Auto-detected placeholders are shown. You can also highlight text and click \"Make Placeholder\" to add more."}
              </div>

              <div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0, overflow: "hidden" }}>
                <div style={{ flex: 2, display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div
                    id="docPreviewPane"
                    style={{ background: "var(--c-bg2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: 20, flex: 1, minHeight: 0, overflow: "auto", fontSize: 13, lineHeight: 1.8, color: "var(--c-text)", whiteSpace: "pre-wrap", userSelect: "text" }}
                  >
                    {(() => {
                      let displayText = wizard.text;
                      const manualPhs = wizard.placeholders.filter(p => !p.autoDetected && p.start >= 0);
                      const sorted = [...manualPhs].sort((a, b) => b.start - a.start);
                      const parts = [];
                      let lastEnd = displayText.length;
                      for (const ph of sorted) {
                        if (ph.start < lastEnd) {
                          parts.unshift({ text: displayText.slice(ph.end, lastEnd), type: "text" });
                          parts.unshift({ text: `[${ph.label}]`, type: "placeholder", id: ph.id });
                          lastEnd = ph.start;
                        }
                      }
                      parts.unshift({ text: displayText.slice(0, lastEnd), type: "text" });
                      return parts.map((p, i) =>
                        p.type === "placeholder"
                          ? <span key={i} style={{ background: "#E4E7EB", color: "#1e40af", padding: "1px 4px", borderRadius: 3, fontWeight: 600, cursor: "pointer" }} title="Click to remove" onClick={() => setWizard(w => ({ ...w, placeholders: w.placeholders.filter(x => x.id !== p.id) }))}>{p.text}</span>
                          : <span key={i}>{p.text}</span>
                      );
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn btn-gold" style={{ fontSize: 12 }} onClick={() => {
                    const sel = window.getSelection();
                    if (!sel || sel.isCollapsed) return alert("Highlight some text first, then click this button.");
                    const text = sel.toString().trim();
                    if (!text) return;
                    const pane = document.getElementById("docPreviewPane");
                    if (!pane || !pane.contains(sel.anchorNode)) return alert("Please select text from the document preview.");
                    const fullText = wizard.text;
                    const range = sel.getRangeAt(0);
                    const preRange = document.createRange();
                    preRange.selectNodeContents(pane);
                    preRange.setEnd(range.startContainer, range.startOffset);
                    const preText = preRange.toString();
                    let idx = -1;
                    const manualPhs = wizard.placeholders.filter(p => !p.autoDetected && p.start >= 0);
                    const sortedPhs = [...manualPhs].sort((a, b) => a.start - b.start);
                    let offset = 0;
                    let visualPos = 0;
                    for (const ph of sortedPhs) {
                      if (visualPos + (ph.start - offset) > preText.length) break;
                      const labelLen = `[${ph.label}]`.length;
                      visualPos += (ph.start - offset);
                      visualPos += labelLen;
                      offset = ph.end;
                    }
                    const remainingVisual = preText.length - visualPos;
                    const charOffset = offset + remainingVisual;
                    const searchStart = Math.max(0, charOffset - 5);
                    idx = fullText.indexOf(text, searchStart);
                    if (idx === -1) idx = fullText.indexOf(text);
                    if (idx === -1) return alert("Could not locate the selected text. Try selecting a more unique phrase.");
                    const overlap = manualPhs.some(p => !(idx + text.length <= p.start || idx >= p.end));
                    if (overlap) return alert("This selection overlaps with an existing placeholder.");
                    const label = prompt("Name this placeholder (e.g., 'Client Name', 'Charge Description'):");
                    if (!label || !label.trim()) return;
                    const token = label.trim().replace(/[^a-zA-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
                    setWizard(w => ({
                      ...w,
                      placeholders: [...w.placeholders, { id: Date.now(), label: label.trim(), token, original: text, start: idx, end: idx + text.length, autoDetected: false }],
                    }));
                    sel.removeAllRanges();
                  }}>Make Placeholder</button>
                  </div>
                </div>

                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", marginBottom: 8 }}>Placeholders ({wizard.placeholders.length})</div>
                  {wizard.placeholders.length === 0 && <div style={{ fontSize: 12, color: "#8A9096", fontStyle: "italic" }}>None yet. Use {"<<NAME>>"} markers in your document or highlight text to add placeholders.</div>}
                  {wizard.placeholders.map(ph => (
                    <div key={ph.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--c-border2)", fontSize: 12 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600, color: "var(--c-text)" }}>{ph.label}</span>
                          {ph.autoDetected && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "#d1fae5", color: "#065f46" }}>auto</span>}
                        </div>
                        {ph.original && <div style={{ color: "#8A9096", fontSize: 11 }}>replaces: "{(ph.original || "").substring(0, 40)}{(ph.original || "").length > 40 ? "..." : ""}"</div>}
                        {!ph.original && ph.autoDetected && <div style={{ color: "#8A9096", fontSize: 11 }}>{"<<"}{ph.token}{">>"}</div>}
                      </div>
                      <button onClick={() => setWizard(w => ({ ...w, placeholders: w.placeholders.filter(x => x.id !== ph.id) }))} style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, flexShrink: 0, paddingTop: 8 }}>
                <button className="btn btn-outline" onClick={() => { if (wizard.editingId) { setWizard(null); } else { setWizard(w => ({ ...w, step: 1 })); } }}>{wizard.editingId ? "Cancel" : "Back"}</button>
                <button className="btn btn-primary" onClick={() => setWizard(w => ({ ...w, step: 3 }))}>Next: Review & Save</button>
              </div>
            </div>
          )}

          {/* Step 3: Review & Save */}
          {wizard.step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 260px)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-text-h)", marginBottom: 4, flexShrink: 0 }}>Review & Save</div>
              <div style={{ fontSize: 12, color: "#8A9096", marginBottom: 16, flexShrink: 0 }}>Review your template settings and placeholders, then save.</div>

              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {wizard.editingId && (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Template Name</label>
                      <input value={wizard.name} onChange={e => setWizard(w => ({ ...w, name: e.target.value }))} style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", boxSizing: "border-box" }} />
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 6 }}>Category</label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {TEMPLATE_CATEGORIES.map(cat => (
                          <button key={cat} onClick={() => setWizard(w => ({ ...w, category: cat, subType: cat !== "Letters" ? "" : w.subType }))}
                            style={{ padding: "6px 14px", borderRadius: 6, border: `2px solid ${wizard.category === cat ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.category === cat ? CATEGORY_COLORS[cat] : "var(--c-bg2)", cursor: "pointer", fontSize: 12, fontWeight: wizard.category === cat ? 700 : 400, color: "var(--c-text)" }}
                          >{cat}</button>
                        ))}
                      </div>
                    </div>

                    {wizard.category === "Letters" && (
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 6 }}>Letter Type</label>
                        <div style={{ display: "flex", gap: 8 }}>
                          {LETTER_SUB_TYPES.map(st => (
                            <button key={st} onClick={() => setWizard(w => ({ ...w, subType: st }))}
                              style={{ padding: "4px 12px", borderRadius: 6, border: `2px solid ${wizard.subType === st ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.subType === st ? "#fef3c7" : "var(--c-bg2)", cursor: "pointer", fontSize: 12, fontWeight: wizard.subType === st ? 700 : 400, color: "var(--c-text)" }}
                            >{st}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Tags</label>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                        {wizard.tags.map(tag => (
                          <span key={tag} style={{ fontSize: 11, padding: "3px 10px", borderRadius: 10, background: "#E4E7EB", color: "#1F2428", cursor: "pointer" }} onClick={() => setWizard(w => ({ ...w, tags: w.tags.filter(t => t !== tag) }))}>
                            {tag} ✕
                          </span>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input placeholder="Add a tag" value={wizard.newTag || ""} onChange={e => setWizard(w => ({ ...w, newTag: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter" && wizard.newTag?.trim()) { setWizard(w => ({ ...w, tags: [...w.tags, w.newTag.trim()], newTag: "" })); } }}
                          style={{ flex: 1, fontSize: 12, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)" }} />
                        <button className="btn btn-outline btn-sm" style={{ fontSize: 11 }} onClick={() => { if (wizard.newTag?.trim()) setWizard(w => ({ ...w, tags: [...w.tags, w.newTag.trim()], newTag: "" })); }}>Add Tag</button>
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 6 }}>Visibility</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setWizard(w => ({ ...w, visibility: "global" }))}
                          style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `2px solid ${(wizard.visibility || "global") === "global" ? "#1E2A3A" : "var(--c-border)"}`, background: (wizard.visibility || "global") === "global" ? "#E4E7EB" : "var(--c-bg2)", cursor: "pointer", textAlign: "left" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>Everyone</div>
                          <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>All staff can use this template</div>
                        </button>
                        <button onClick={() => setWizard(w => ({ ...w, visibility: "personal" }))}
                          style={{ flex: 1, padding: "10px 12px", borderRadius: 8, border: `2px solid ${wizard.visibility === "personal" ? "#1E2A3A" : "var(--c-border)"}`, background: wizard.visibility === "personal" ? "#E4E7EB" : "var(--c-bg2)", cursor: "pointer", textAlign: "left" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>Only Me</div>
                          <div style={{ fontSize: 11, color: "#8A9096", marginTop: 2 }}>Only visible to you</div>
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div style={{ background: "var(--c-bg2)", border: "1px solid var(--c-border)", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)", marginBottom: 8 }}>Summary</div>
                  <div style={{ fontSize: 12, color: "var(--c-text2)", lineHeight: 1.8 }}>
                    <div><strong>Name:</strong> {wizard.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}><strong>Category:</strong> <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: CATEGORY_COLORS[wizard.category] || "#E4E7EB", color: "#1F2428" }}>{wizard.category || "General"}{wizard.subType ? ` — ${wizard.subType}` : ""}</span></div>
                    <div><strong>Placeholders:</strong> {wizard.placeholders.length} ({wizard.placeholders.filter(p => p.autoDetected).length} auto-detected, {wizard.placeholders.filter(p => !p.autoDetected).length} manual)</div>
                    {wizard.tags.length > 0 && <div><strong>Tags:</strong> {wizard.tags.join(", ")}</div>}
                    <div><strong>Visibility:</strong> {(wizard.visibility || "global") === "global" ? "Everyone" : "Only Me"}</div>
                    {wizard.category === "Pleadings" && wizard.detectedSections && (wizard.detectedSections.hasHeader || wizard.detectedSections.hasSignature || wizard.detectedSections.hasCos) && (
                      <div style={{ marginTop: 4 }}>
                        <strong>Pleading Sections:</strong>
                        {wizard.detectedSections.hasHeader && <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 6px", borderRadius: 4, background: wizard.useSystemHeader ? "#d1fae5" : "#FEF3C7" }}>Header: {wizard.useSystemHeader ? "System" : "Document"}</span>}
                        {wizard.detectedSections.hasSignature && <span style={{ marginLeft: 4, fontSize: 11, padding: "1px 6px", borderRadius: 4, background: wizard.useSystemSignature ? "#d1fae5" : "#FEF3C7" }}>Signature: {wizard.useSystemSignature ? "System" : "Document"}</span>}
                        {wizard.detectedSections.hasCos && <span style={{ marginLeft: 4, fontSize: 11, padding: "1px 6px", borderRadius: 4, background: wizard.useSystemCos ? "#d1fae5" : "#FEF3C7" }}>CoS: {wizard.useSystemCos ? "System" : "Document"}</span>}
                      </div>
                    )}
                  </div>
                  {wizard.placeholders.length > 0 && (
                    <div style={{ marginTop: 12, borderTop: "1px solid var(--c-border)", paddingTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--c-text3)", marginBottom: 4 }}>Placeholder List:</div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {wizard.placeholders.map(ph => (
                          <span key={ph.id} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: ph.autoDetected ? "#d1fae5" : "#E4E7EB", color: "#1F2428" }}>{ph.label}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, flexShrink: 0, paddingTop: 8 }}>
                <button className="btn btn-outline" onClick={() => setWizard(w => ({ ...w, step: 2 }))}>Back</button>
                <button className="btn btn-primary" disabled={!wizard.name?.trim()} onClick={async () => {
                  try {
                    const phData = wizard.placeholders.map(p => ({
                      token: p.token, label: p.label, original: p.original || "",
                    }));

                    if (wizard.editingId) {
                      const updated = await apiUpdateTemplate(wizard.editingId, {
                        name: wizard.name.trim(),
                        tags: wizard.tags,
                        placeholders: phData,
                        visibility: wizard.visibility || "global",
                        category: wizard.category || "General",
                        subType: wizard.subType || "",
                        reprocessDocx: true,
                      });
                      setTemplates(p => p.map(t => t.id === updated.id ? updated : t));
                    } else {
                      const systemPrefs = wizard.category === "Pleadings" ? { useSystemHeader: wizard.useSystemHeader !== false, useSystemSignature: wizard.useSystemSignature !== false, useSystemCos: wizard.useSystemCos !== false } : null;
                      const saved = await apiSaveTemplate(wizard.file, wizard.name.trim(), wizard.tags, phData, wizard.visibility || "global", wizard.category || "General", wizard.subType || "", systemPrefs);
                      setTemplates(p => [...p, saved]);
                    }
                    setWizard(null);
                  } catch (err) { alert("Failed to save template: " + err.message); }
                }}>{wizard.editingId ? "Save Changes" : "Save Template"}</button>
              </div>
            </div>
          )}
        </div>
      )}

      </div>
    </>
  );
}

function StaffView({ allCases, currentUser, setCurrentUser, allUsers, setAllUsers, onMenuToggle }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const canAdmin = isAppAdmin(currentUser);
  const [roleFilter, setRoleFilter] = useState("All");
  const [pinnedIds, setPinnedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lextrack-pinned-staff") || "[]"); } catch { return []; }
  });
  const [pinnedExpanded, setPinnedExpanded] = useState(true);

  const [allStaffExpanded, setAllStaffExpanded] = useState(true);

  const savePins = (next) => { setPinnedIds(next); localStorage.setItem("lextrack-pinned-staff", JSON.stringify(next)); };
  const togglePin = (id) => { const next = pinnedIds.includes(id) ? pinnedIds.filter(x => x !== id) : [...pinnedIds, id]; savePins(next); };

  const activeUsers = allUsers.filter(u => !u.deletedAt);
  const deletedUsers = allUsers.filter(u => u.deletedAt);
  const filteredStaff = roleFilter === "All" ? activeUsers : activeUsers.filter(u => (u.roles && u.roles.length ? u.roles : [u.role]).includes(roleFilter));
  const pinnedStaff = filteredStaff.filter(u => pinnedIds.includes(u.id));
  const [showDeletedStaff, setShowDeletedStaff] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [colCount, setColCount] = useState(3);
  const allGridRef = useRef(null);
  const pinnedGridRef = useRef(null);

  useEffect(() => {
    const measure = () => {
      const el = allGridRef.current || pinnedGridRef.current;
      if (!el) return;
      const cols = getComputedStyle(el).gridTemplateColumns.split(" ").length;
      setColCount(cols);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (allGridRef.current) ro.observe(allGridRef.current);
    if (pinnedGridRef.current) ro.observe(pinnedGridRef.current);
    return () => ro.disconnect();
  });

  const isRowExpanded = (section, index) => expandedRow && expandedRow.section === section && expandedRow.row === Math.floor(index / colCount);
  const toggleRow = (section, index) => {
    const row = Math.floor(index / colCount);
    setExpandedRow(prev => prev && prev.section === section && prev.row === row ? null : { section, row });
  };

  const handleAddStaff = async (formData) => {
    const saved = await apiCreateUser(formData);
    const newUser = { ...saved, offices: saved.offices || [] };
    USERS.push(newUser);
    setAllUsers(prev => [...prev, newUser]);
    try {
      await apiSendTempPassword(saved.id);
    } catch (e) {
      console.error("Failed to send temp password:", e);
    }
    return newUser;
  };

  const handleDeleteStaff = async (userId) => {
    try {
      await apiDeleteUser(userId);
      setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, deletedAt: new Date().toISOString() } : u));
      setConfirmDeleteId(null);
      setExpandedRow(null);
    } catch (err) {
      alert("Failed to remove staff: " + err.message);
    }
  };

  const handleRestoreStaff = async (userId) => {
    try {
      const restored = await apiRestoreUser(userId);
      setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, ...restored, deletedAt: null } : u));
      const existing = USERS.find(u => u.id === userId);
      if (!existing) {
        USERS.push({ ...restored, deletedAt: null });
      }
    } catch (err) {
      alert("Failed to restore staff: " + err.message);
    }
  };

  const handleToggleRole = async (userId, role, currentRoles) => {
    const next = currentRoles.includes(role)
      ? currentRoles.filter(r => r !== role)
      : [...currentRoles, role];
    if (next.length === 0) return;
    try {
      const updated = await apiUpdateUserRoles(userId, next);
      const merged = { roles: updated.roles, role: updated.role };
      USERS.forEach(u => { if (u.id === userId) Object.assign(u, merged); });
      setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, ...merged } : u));
    } catch (err) {
      alert("Failed to update roles: " + err.message);
    }
  };

  const handleEditStaff = async (userId, data) => {
    const updated = await apiUpdateUser(userId, data);
    USERS.forEach(u => { if (u.id === userId) Object.assign(u, updated); });
    setAllUsers(prev => prev.map(u => u.id === userId ? { ...u, ...updated } : u));
    if (userId === currentUser.id) setCurrentUser(prev => ({ ...prev, ...updated }));
    return updated;
  };

  return (
    <>
      {showAddModal && (
        <AddStaffModal
          onSave={handleAddStaff}
          onClose={() => setShowAddModal(false)}
        />
      )}
      {editingUser && (
        <EditContactModal
          user={editingUser}
          onSave={handleEditStaff}
          onClose={() => setEditingUser(null)}
        />
      )}
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="hamburger-btn" onClick={onMenuToggle}>☰</button>
          <div>
            <div className="topbar-title">Staff Directory</div>
            <div className="topbar-subtitle">{filteredStaff.length} of {activeUsers.length} team members</div>
          </div>
        </div>
        <div className="topbar-actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-card)", color: "var(--c-text)" }}>
            <option value="All">All Roles</option>
            {STAFF_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {canAdmin && (
            <button className="btn btn-gold" onClick={() => setShowAddModal(true)}>+ Add Staff</button>
          )}
        </div>
      </div>
      <div className="content">
        {pinnedStaff.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <button
              onClick={() => setPinnedExpanded(!pinnedExpanded)}
              style={{ background: "transparent", border: "none", padding: "0 0 12px 0", fontSize: 14, fontWeight: 600, color: "var(--c-text-h)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "'Playfair Display',serif" }}
            >
              {pinnedExpanded ? "▾" : "▸"} Pinned ({pinnedStaff.length})
            </button>
            {pinnedExpanded && (
              <div ref={pinnedGridRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(290px,100%),1fr))", gap: 16 }}>
                {pinnedStaff.map((u, idx) => {
                  const mine = allCases.filter(c => c.assignedAttorney === u.id || c.secondAttorney === u.id || c.trialCoordinator === u.id || c.investigator === u.id || c.socialWorker === u.id);
                  const isExpanded = isRowExpanded("pinned", idx);
                  return (
                    <div key={u.id} className="card" style={{ padding: "20px 22px", position: "relative", cursor: "pointer", borderLeft: "3px solid #C9A84C" }} onClick={() => toggleRow("pinned", idx)}>
                      <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 4, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => togglePin(u.id)} title="Unpin" style={{ background: "transparent", border: "none", color: "#C9A84C", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 4px" }}>📌</button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: isExpanded ? 14 : 0 }}>
                        <div style={{ width: 48, height: 48, borderRadius: "50%", background: u.avatar, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{u.initials}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "var(--c-text-h)", fontWeight: 600 }}>{u.name}</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                            {(u.roles && u.roles.length ? u.roles : [u.role]).map(r => <Badge key={r} label={r} />)}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: "#8A9096", flexShrink: 0 }}>{isExpanded ? "▾" : "▸"}</span>
                      </div>
                      {isExpanded && (
                        <>
                          {[
                            ["Extension", u.ext || "—"],
                            ["Direct Line", u.phone || "—"],
                            ["Cell", u.cell || "—"],
                            ["Email", u.email || "—"],
                            ["Active Cases", `${mine.filter(c => c.status === "Active").length} (${mine.length} total)`]
                          ].map(([k, v]) => (
                            <div key={k} className="info-row"><span className="info-key">{k}</span><span className="info-val" style={{ fontSize: 12 }}>{v}</span></div>
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        <div style={{ marginBottom: 0 }}>
          <button
            onClick={() => setAllStaffExpanded(!allStaffExpanded)}
            style={{ background: "transparent", border: "none", padding: "0 0 12px 0", fontSize: 14, fontWeight: 600, color: "var(--c-text-h)", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "'Playfair Display',serif" }}
          >
            {allStaffExpanded ? "▾" : "▸"} All Staff ({filteredStaff.length})
          </button>
        </div>
        {allStaffExpanded && <div ref={allGridRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(290px,100%),1fr))", gap: 16 }}>
          {filteredStaff.map((u, idx) => {
            const mine = allCases.filter(c => c.assignedAttorney === u.id || c.secondAttorney === u.id || c.trialCoordinator === u.id || c.investigator === u.id || c.socialWorker === u.id);
            const isConfirming = confirmDeleteId === u.id;
            const isExpanded = isRowExpanded("all", idx);
            return (
              <div key={u.id} className="card" style={{ padding: "20px 22px", position: "relative", cursor: "pointer" }} onClick={() => toggleRow("all", idx)}>
                {isExpanded && (
                  <div style={{ position: "absolute", top: 10, right: 12, display: "flex", gap: 4, alignItems: "center" }} onClick={e => e.stopPropagation()}>
                    {isConfirming ? (
                      <>
                        <span style={{ fontSize: 11, color: "#e05252" }}>Remove?</span>
                        <button onClick={() => handleDeleteStaff(u.id)} style={{ padding: "2px 8px", background: "#e05252", color: "#fff", border: "none", borderRadius: 3, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Yes</button>
                        <button onClick={() => setConfirmDeleteId(null)} style={{ padding: "2px 8px", background: "transparent", color: "#8A9096", border: "1px solid var(--c-border)", borderRadius: 3, fontSize: 11, cursor: "pointer" }}>No</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => togglePin(u.id)} title={pinnedIds.includes(u.id) ? "Unpin" : "Pin to top"} style={{ background: "transparent", border: "none", color: pinnedIds.includes(u.id) ? "#C9A84C" : "#8A9096", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 4px" }}>📌</button>
                        {(canAdmin || currentUser.id === u.id) && (
                          <button onClick={() => setEditingUser(u)} title="Edit contact info" style={{ background: "transparent", border: "none", color: "#8A9096", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: "2px 4px" }}>✎</button>
                        )}
                        {canAdmin && (
                          <button onClick={async () => { if (!window.confirm(`Send a temporary password to ${u.email}?`)) return; try { const r = await apiSendTempPassword(u.id); alert(r.message || "Sent!"); } catch (e) { alert(e.message || "Failed"); } }} title="Send temporary password" style={{ background: "transparent", border: "none", color: "#8A9096", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "2px 4px" }}>🔑</button>
                        )}
                        {canAdmin && (
                          <button onClick={() => setConfirmDeleteId(u.id)} title="Remove staff member" style={{ background: "transparent", border: "none", color: "var(--c-border)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 4px" }}>✕</button>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: isExpanded ? 14 : 0 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: u.avatar, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{u.initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: "var(--c-text-h)", fontWeight: 600 }}>{u.name}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                      {(u.roles && u.roles.length ? u.roles : [u.role]).map(r => <Badge key={r} label={r} />)}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: "#8A9096", flexShrink: 0 }}>{isExpanded ? "▾" : "▸"}</span>
                </div>
                {isExpanded && (
                  <>
                    {[
                      ["Extension", u.ext || "—"],
                      ["Direct Line", u.phone || "—"],
                      ["Cell", u.cell || "—"],
                      ["Email", u.email || "—"],
                      ["Active Cases", `${mine.filter(c => c.status === "Active").length} (${mine.length} total)`]
                    ].map(([k, v]) => (
                      <div key={k} className="info-row"><span className="info-key">{k}</span><span className="info-val" style={{ fontSize: 12 }}>{v}</span></div>
                    ))}
                    {canAdmin && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--c-border)" }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 11, color: "#8A9096", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                          Roles <span style={{ fontWeight: 400, color: "var(--c-border)" }}>— click to toggle</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {STAFF_ROLES.map(r => {
                            const on = (u.roles && u.roles.length ? u.roles : [u.role]).includes(r);
                            return (
                              <button
                                key={r}
                                onClick={() => handleToggleRole(u.id, r, u.roles && u.roles.length ? u.roles : [u.role])}
                                style={{ padding: "2px 10px", borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none", background: on ? "#fef3c7" : "transparent", color: on ? "#1F2428" : "var(--c-border)", transition: "all 0.15s" }}
                              >{r}</button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>}
        {canAdmin && deletedUsers.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <button
              onClick={() => setShowDeletedStaff(!showDeletedStaff)}
              style={{ background: "transparent", border: "1px solid var(--c-border)", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#8A9096", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
            >
              {showDeletedStaff ? "▾" : "▸"} Deactivated Staff ({deletedUsers.length})
            </button>
            {showDeletedStaff && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(290px,100%),1fr))", gap: 16, marginTop: 16 }}>
                {deletedUsers.map(u => (
                  <div key={u.id} className="card" style={{ padding: "20px 22px", opacity: 0.7, position: "relative" }}>
                    <div style={{ position: "absolute", top: 10, right: 12 }}>
                      <button
                        onClick={() => handleRestoreStaff(u.id)}
                        style={{ padding: "4px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                      >Restore</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                      <div style={{ width: 42, height: 42, borderRadius: "50%", background: "#8A9096", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{u.initials}</div>
                      <div>
                        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, color: "var(--c-text-h)", fontWeight: 600 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: "#8A9096" }}>Deactivated {new Date(u.deletedAt).toLocaleDateString()}</div>
                      </div>
                    </div>
                    <div className="info-row"><span className="info-key">Email</span><span className="info-val" style={{ fontSize: 12 }}>{u.email || "—"}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
