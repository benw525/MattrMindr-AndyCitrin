const BASE = "";

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try { const j = await res.json(); msg = j.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Auth
export const apiLogin   = (email, password) => apiFetch("/api/auth/login",  { method: "POST", body: { email, password } });
export const apiLogout  = ()             => apiFetch("/api/auth/logout", { method: "POST" });
export const apiMe      = ()             => apiFetch("/api/auth/me");

export const apiChangePassword    = (currentPassword, newPassword) => apiFetch("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
export const apiForgotPassword    = (email)                        => apiFetch("/api/auth/forgot-password",  { method: "POST", body: { email } });
export const apiResetPassword     = (email, code, newPassword)     => apiFetch("/api/auth/reset-password",   { method: "POST", body: { email, code, newPassword } });
export const apiSendTempPassword  = (userId)                       => apiFetch("/api/auth/send-temp-password", { method: "POST", body: { userId } });

// Users
export const apiGetUsers          = ()              => apiFetch("/api/users");
export const apiCreateUser        = (data)          => apiFetch("/api/users",              { method: "POST",   body: data });
export const apiDeleteUser        = (id)            => apiFetch(`/api/users/${id}`,        { method: "DELETE" });
export const apiGetDeletedUsers   = ()              => apiFetch("/api/users?deleted=true");
export const apiRestoreUser       = (id)            => apiFetch(`/api/users/${id}/restore`, { method: "POST" });
export const apiUpdateUserOffices = (id, offices)   => apiFetch(`/api/users/${id}/offices`, { method: "PUT",    body: { offices } });
export const apiUpdateUserRoles   = (id, roles)     => apiFetch(`/api/users/${id}/roles`,   { method: "PUT",    body: { roles } });
export const apiUpdateUser        = (id, data)      => apiFetch(`/api/users/${id}`,          { method: "PUT",    body: data });

// Cases
export const apiGetCases        = ()         => apiFetch("/api/cases");
export const apiGetDeletedCases = ()         => apiFetch("/api/cases?deleted=true");
export const apiGetCase         = (id)       => apiFetch(`/api/cases/${id}`);
export const apiCreateCase      = (data)     => apiFetch("/api/cases",           { method: "POST",   body: data });
export const apiUpdateCase      = (id, data) => apiFetch(`/api/cases/${id}`,     { method: "PUT",    body: data });
export const apiDeleteCase      = (id)       => apiFetch(`/api/cases/${id}`,     { method: "DELETE" });
export const apiRestoreCase     = (id)       => apiFetch(`/api/cases/${id}/restore`, { method: "POST" });

// Tasks
export const apiGetTasks             = ()                       => apiFetch("/api/tasks");
export const apiGetCaseTasks         = (caseId)                 => apiFetch(`/api/tasks?caseId=${caseId}`);
export const apiCreateTask           = (data)                   => apiFetch("/api/tasks",                  { method: "POST", body: data });
export const apiCreateTasks          = (arr)                    => apiFetch("/api/tasks/bulk",             { method: "POST", body: arr });
export const apiUpdateTask           = (id, data)               => apiFetch(`/api/tasks/${id}`,            { method: "PUT",  body: data });
export const apiCompleteTask         = (id, timeLogged, completedBy, timeLogUser) => apiFetch(`/api/tasks/${id}/complete`, { method: "POST", body: { timeLogged: timeLogged || null, completedBy: completedBy || null, timeLogUser: timeLogUser || null } });
export const apiReassignTasksByRole  = (caseId, role, userId)  => apiFetch("/api/tasks/reassign-by-role", { method: "PUT",  body: { caseId, role, userId } });

// Deadlines
export const apiGetDeadlines   = ()     => apiFetch("/api/deadlines");
export const apiCreateDeadline = (data) => apiFetch("/api/deadlines", { method: "POST", body: data });

// Notes
export const apiGetNotes    = (caseId) => apiFetch(`/api/notes/${caseId}`);
export const apiCreateNote  = (data)   => apiFetch("/api/notes",     { method: "POST",   body: data });
export const apiDeleteNote  = (id)     => apiFetch(`/api/notes/${id}`, { method: "DELETE" });

// Links
export const apiGetLinks    = (caseId) => apiFetch(`/api/links/${caseId}`);
export const apiCreateLink  = (data)   => apiFetch("/api/links",     { method: "POST",   body: data });
export const apiDeleteLink  = (id)     => apiFetch(`/api/links/${id}`, { method: "DELETE" });

// Activity
export const apiGetActivity    = (caseId) => apiFetch(`/api/activity/${caseId}`);
export const apiCreateActivity = (data)   => apiFetch("/api/activity", { method: "POST", body: data });

// Contacts
export const apiGetContacts        = ()         => apiFetch("/api/contacts");
export const apiGetDeletedContacts = ()         => apiFetch("/api/contacts?deleted=true");
export const apiCreateContact      = (data)     => apiFetch("/api/contacts",             { method: "POST",   body: data });
export const apiUpdateContact      = (id, data) => apiFetch(`/api/contacts/${id}`,       { method: "PUT",    body: data });
export const apiDeleteContact      = (id)       => apiFetch(`/api/contacts/${id}`,       { method: "DELETE" });
export const apiRestoreContact     = (id)       => apiFetch(`/api/contacts/${id}/restore`, { method: "POST" });

export const apiMergeContacts      = (data)       => apiFetch("/api/contacts/merge",        { method: "POST",   body: data });

// AI Search
export const apiAiSearch = (query) => apiFetch("/api/ai-search", { method: "POST", body: { query } });

// Contact Notes
export const apiGetContactNotes    = (contactId) => apiFetch(`/api/contact-notes/${contactId}`);
export const apiCreateContactNote  = (data)      => apiFetch("/api/contact-notes",       { method: "POST",   body: data });
export const apiDeleteContactNote  = (id)        => apiFetch(`/api/contact-notes/${id}`, { method: "DELETE" });

// Correspondence
export const apiGetCorrespondence    = (caseId) => apiFetch(`/api/correspondence/${caseId}`);
export const apiDeleteCorrespondence = (id)     => apiFetch(`/api/correspondence/${id}`, { method: "DELETE" });
// Templates
export const apiGetTemplates      = ()         => apiFetch("/api/templates");
export const apiDeleteTemplate    = (id)       => apiFetch(`/api/templates/${id}`, { method: "DELETE" });
export const apiUpdateTemplate    = (id, data) => apiFetch(`/api/templates/${id}`, { method: "PUT", body: data });
export const apiGetTemplateSource = (id)       => apiFetch(`/api/templates/${id}/source`);

export async function apiUploadTemplateFile(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/templates/upload", { method: "POST", credentials: "include", body: form });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Upload error ${res.status}`); }
  return res.json();
}

export async function apiSaveTemplate(file, name, tags, placeholders, visibility) {
  const form = new FormData();
  form.append("file", file);
  form.append("name", name);
  form.append("tags", JSON.stringify(tags));
  form.append("placeholders", JSON.stringify(placeholders));
  form.append("visibility", visibility || "global");
  const res = await fetch("/api/templates", { method: "POST", credentials: "include", body: form });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Save error ${res.status}`); }
  return res.json();
}

export async function apiGenerateDocument(templateId, values) {
  const res = await fetch(`/api/templates/${templateId}/generate`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Generate error ${res.status}`); }
  return res.blob();
}
