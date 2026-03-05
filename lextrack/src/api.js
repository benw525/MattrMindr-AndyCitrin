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
export const apiLogin   = (email, password, rememberMe) => apiFetch("/api/auth/login",  { method: "POST", body: { email, password, rememberMe } });
export const apiLogout  = ()             => apiFetch("/api/auth/logout", { method: "POST" });
export const apiMe      = ()             => apiFetch("/api/auth/me");

export const apiChangePassword    = (currentPassword, newPassword) => apiFetch("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
export const apiForgotPassword    = (email)                        => apiFetch("/api/auth/forgot-password",  { method: "POST", body: { email } });
export const apiResetPassword     = (email, code, newPassword)     => apiFetch("/api/auth/reset-password",   { method: "POST", body: { email, code, newPassword } });
export const apiSendTempPassword  = (userId)                       => apiFetch("/api/auth/send-temp-password", { method: "POST", body: { userId } });
export const apiGetPreferences    = ()                               => apiFetch("/api/auth/preferences");
export const apiSavePreferences   = (prefs)                          => apiFetch("/api/auth/preferences", { method: "PUT", body: prefs });

// Users
export const apiGetUsers          = ()              => apiFetch("/api/users");
export const apiCreateUser        = (data)          => apiFetch("/api/users",              { method: "POST",   body: data });
export const apiDeleteUser        = (id)            => apiFetch(`/api/users/${id}`,        { method: "DELETE" });
export const apiGetDeletedUsers   = ()              => apiFetch("/api/users?deleted=true");
export const apiRestoreUser       = (id)            => apiFetch(`/api/users/${id}/restore`, { method: "POST" });
export const apiUpdateUserRoles   = (id, roles)     => apiFetch(`/api/users/${id}/roles`,   { method: "PUT",    body: { roles } });
export const apiUpdateUser        = (id, data)      => apiFetch(`/api/users/${id}`,          { method: "PUT",    body: data });

// Cases
export const apiGetCases        = ()         => apiFetch("/api/cases");
export const apiGetDeletedCases = ()         => apiFetch("/api/cases?deleted=true");
export const apiGetCasesAll     = ()         => apiFetch("/api/cases?includeDeleted=true");
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
export const apiGetDeadlines    = ()         => apiFetch("/api/deadlines");
export const apiCreateDeadline  = (data)     => apiFetch("/api/deadlines", { method: "POST", body: data });
export const apiUpdateDeadline  = (id, data) => apiFetch(`/api/deadlines/${id}`, { method: "PUT", body: data });
export const apiDeleteDeadline  = (id)       => apiFetch(`/api/deadlines/${id}`, { method: "DELETE" });

// Notes
export const apiGetNotes    = (caseId) => apiFetch(`/api/notes/${caseId}`);
export const apiGetQuickNotes = ()     => apiFetch("/api/notes/quick");
export const apiCreateNote  = (data)   => apiFetch("/api/notes",     { method: "POST",   body: data });
export const apiUpdateNote  = (id, data) => apiFetch(`/api/notes/${id}`, { method: "PUT",    body: data });
export const apiDeleteNote  = (id)     => apiFetch(`/api/notes/${id}`, { method: "DELETE" });

// Links
export const apiGetLinks    = (caseId) => apiFetch(`/api/links/${caseId}`);
export const apiCreateLink  = (data)   => apiFetch("/api/links",     { method: "POST",   body: data });
export const apiDeleteLink  = (id)     => apiFetch(`/api/links/${id}`, { method: "DELETE" });

// Activity
export const apiGetActivity       = (caseId) => apiFetch(`/api/activity/${caseId}`);
export const apiGetRecentActivity = (userId, limit) => apiFetch(`/api/activity?userId=${userId}&limit=${limit || 20}`);
export const apiCreateActivity    = (data)   => apiFetch("/api/activity", { method: "POST", body: data });

// Contacts
export const apiGetContacts        = ()         => apiFetch("/api/contacts");
export const apiGetDeletedContacts = ()         => apiFetch("/api/contacts?deleted=true");
export const apiCreateContact      = (data)     => apiFetch("/api/contacts",             { method: "POST",   body: data });
export const apiUpdateContact      = (id, data) => apiFetch(`/api/contacts/${id}`,       { method: "PUT",    body: data });
export const apiDeleteContact      = (id)       => apiFetch(`/api/contacts/${id}`,       { method: "DELETE" });
export const apiRestoreContact     = (id)       => apiFetch(`/api/contacts/${id}/restore`, { method: "POST" });

export const apiMergeContacts      = (data)       => apiFetch("/api/contacts/merge",        { method: "POST",   body: data });
export const apiGetContactCases   = (id)         => apiFetch(`/api/contacts/${id}/associated-cases`);
export const apiGetContactCaseCounts = ()        => apiFetch("/api/contacts/case-counts/batch");

export const apiGetContactPhones    = (contactId)       => apiFetch(`/api/contacts/${contactId}/phones`);
export const apiAddContactPhone     = (contactId, data) => apiFetch(`/api/contacts/${contactId}/phones`, { method: "POST", body: data });
export const apiUpdateContactPhone  = (phoneId, data)   => apiFetch(`/api/contacts/phones/${phoneId}`,   { method: "PUT",  body: data });
export const apiDeleteContactPhone  = (phoneId)         => apiFetch(`/api/contacts/phones/${phoneId}`,   { method: "DELETE" });

export const apiGetContactCaseLinks    = (contactId)       => apiFetch(`/api/contacts/${contactId}/case-links`);
export const apiAddContactCaseLink     = (contactId, caseId) => apiFetch(`/api/contacts/${contactId}/case-links`, { method: "POST", body: { caseId } });
export const apiDeleteContactCaseLink  = (linkId)          => apiFetch(`/api/contacts/case-links/${linkId}`,     { method: "DELETE" });

// AI Search
export const apiAiSearch = (query) => apiFetch("/api/ai-search", { method: "POST", body: { query } });

// AI Agents
export const apiLiabilityAnalysis = (data) => apiFetch("/api/ai-agents/liability-analysis", { method: "POST", body: data });
export const apiChargeAnalysis   = apiLiabilityAnalysis;
export const apiGetChargeClass   = (data) => apiFetch("/api/ai-agents/charge-class",     { method: "POST", body: data });
export const apiMedicalRecordSummary = (data) => apiFetch("/api/ai-agents/medical-record-summary", { method: "POST", body: data });
export const apiCaseValuation    = (data) => apiFetch("/api/ai-agents/case-valuation",    { method: "POST", body: data });
export const apiDemandLetter     = (data) => apiFetch("/api/ai-agents/demand-letter",     { method: "POST", body: data });
export const apiDeadlineGenerator = (data) => apiFetch("/api/ai-agents/deadline-generator", { method: "POST", body: data });
export const apiCaseStrategy     = (data) => apiFetch("/api/ai-agents/case-strategy",     { method: "POST", body: data });
export const apiDraftDocument    = (data) => apiFetch("/api/ai-agents/draft-document",    { method: "POST", body: data });
export const apiCaseTriage       = ()     => apiFetch("/api/ai-agents/case-triage",       { method: "POST", body: {} });
export const apiClientSummary    = (data) => apiFetch("/api/ai-agents/client-summary",    { method: "POST", body: data });
export const apiDocSummary       = (data) => apiFetch("/api/ai-agents/doc-summary",       { method: "POST", body: data });
export const apiTaskSuggestions  = (data) => apiFetch("/api/ai-agents/task-suggestions",  { method: "POST", body: data });
export const apiAdvocateChat    = (data) => apiFetch("/api/ai-agents/advocate",          { method: "POST", body: data });

// AI Training
export const apiGetTraining     = ()     => apiFetch("/api/ai-training");
export const apiCreateTraining  = (data) => apiFetch("/api/ai-training",               { method: "POST", body: data });
export async function apiUploadTrainingDoc(formData) {
  const res = await fetch("/api/ai-training/upload", { method: "POST", credentials: "include", body: formData });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}
export const apiUpdateTraining  = (id, data) => apiFetch(`/api/ai-training/${id}`,     { method: "PUT", body: data });
export const apiDeleteTraining  = (id) => apiFetch(`/api/ai-training/${id}`,           { method: "DELETE" });

// Insurance Policies
export const apiGetInsurancePolicies = (caseId) => apiFetch(`/api/insurance/${caseId}`);
export const apiCreateInsurancePolicy = (caseId, data) => apiFetch(`/api/insurance/${caseId}`, { method: "POST", body: data });
export const apiUpdateInsurancePolicy = (caseId, id, data) => apiFetch(`/api/insurance/${caseId}/${id}`, { method: "PUT", body: data });
export const apiDeleteInsurancePolicy = (caseId, id) => apiFetch(`/api/insurance/${caseId}/${id}`, { method: "DELETE" });

// Medical Treatments
export const apiGetMedicalTreatments = (caseId) => apiFetch(`/api/medical-treatments/${caseId}`);
export const apiCreateMedicalTreatment = (caseId, data) => apiFetch(`/api/medical-treatments/${caseId}`, { method: "POST", body: data });
export const apiUpdateMedicalTreatment = (caseId, id, data) => apiFetch(`/api/medical-treatments/${caseId}/${id}`, { method: "PUT", body: data });
export const apiDeleteMedicalTreatment = (caseId, id) => apiFetch(`/api/medical-treatments/${caseId}/${id}`, { method: "DELETE" });

// Medical Records
export const apiGetMedicalRecords = (caseId, treatmentId) => apiFetch(`/api/medical-treatments/${caseId}/records/${treatmentId}`);
export async function apiUploadMedicalRecord(caseId, treatmentId, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/medical-treatments/${caseId}/records/${treatmentId}/upload`, { method: "POST", credentials: "include", body: form });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}
export const apiUpdateMedicalRecord = (caseId, treatmentId, id, data) => apiFetch(`/api/medical-treatments/${caseId}/records/${treatmentId}/${id}`, { method: "PUT", body: data });
export const apiDeleteMedicalRecord = (caseId, treatmentId, id) => apiFetch(`/api/medical-treatments/${caseId}/records/${treatmentId}/${id}`, { method: "DELETE" });
export const apiMedicalRecordFromDocument = (caseId, treatmentId, documentId) => apiFetch(`/api/medical-treatments/${caseId}/records/${treatmentId}/from-document`, { method: "POST", body: { documentId } });

// Liens
export const apiGetLiens = (caseId) => apiFetch(`/api/liens/${caseId}`);
export const apiCreateLien = (caseId, data) => apiFetch(`/api/liens/${caseId}`, { method: "POST", body: data });
export const apiUpdateLien = (caseId, id, data) => apiFetch(`/api/liens/${caseId}/${id}`, { method: "PUT", body: data });
export const apiDeleteLien = (caseId, id) => apiFetch(`/api/liens/${caseId}/${id}`, { method: "DELETE" });

// Damages
export const apiGetDamages = (caseId) => apiFetch(`/api/damages/${caseId}`);
export const apiCreateDamage = (caseId, data) => apiFetch(`/api/damages/${caseId}`, { method: "POST", body: data });
export const apiUpdateDamage = (caseId, id, data) => apiFetch(`/api/damages/${caseId}/${id}`, { method: "PUT", body: data });
export const apiDeleteDamage = (caseId, id) => apiFetch(`/api/damages/${caseId}/${id}`, { method: "DELETE" });

// Expenses
export const apiGetExpenses = (caseId) => apiFetch(`/api/expenses/${caseId}`);
export const apiCreateExpense = (caseId, data) => apiFetch(`/api/expenses/${caseId}`, { method: "POST", body: data });
export const apiUpdateExpense = (caseId, id, data) => apiFetch(`/api/expenses/${caseId}/${id}`, { method: "PUT", body: data });
export const apiDeleteExpense = (caseId, id) => apiFetch(`/api/expenses/${caseId}/${id}`, { method: "DELETE" });

// Negotiations
export const apiGetNegotiations = (caseId) => apiFetch(`/api/negotiations/${caseId}`);
export const apiCreateNegotiation = (caseId, data) => apiFetch(`/api/negotiations/${caseId}`, { method: "POST", body: data });
export const apiUpdateNegotiation = (caseId, id, data) => apiFetch(`/api/negotiations/${caseId}/${id}`, { method: "PUT", body: data });
export const apiDeleteNegotiation = (caseId, id) => apiFetch(`/api/negotiations/${caseId}/${id}`, { method: "DELETE" });

// Case Documents
export const apiGetCaseDocuments = (caseId) => apiFetch(`/api/case-documents/${caseId}`);
export async function apiUploadCaseDocument(formData) {
  const res = await fetch("/api/case-documents/upload", { method: "POST", credentials: "include", body: formData });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}
export const apiSummarizeDocument = (docId) => apiFetch(`/api/case-documents/${docId}/summarize`, { method: "POST", body: {} });
export async function apiDownloadDocument(docId) {
  const res = await fetch(`/api/case-documents/${docId}/download`, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}
export const apiGetDocumentText = (docId) => apiFetch(`/api/case-documents/${docId}/text`);
export const apiDeleteCaseDocument = (docId) => apiFetch(`/api/case-documents/${docId}`, { method: "DELETE" });
export const apiUpdateCaseDocument = (docId, data) => apiFetch(`/api/case-documents/${docId}`, { method: "PUT", body: data });

// Transcripts
export const apiGetTranscripts = (caseId) => apiFetch(`/api/transcripts/case/${caseId}`);
export const apiGetTranscriptDetail = (id) => apiFetch(`/api/transcripts/${id}/detail`);
export async function apiUploadTranscript(formData) {
  const res = await fetch("/api/transcripts/upload", { method: "POST", credentials: "include", body: formData });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}
const UPLOAD_CHUNK_SIZE = 20 * 1024 * 1024;
export async function apiUploadTranscriptChunked(file, caseId, onProgress) {
  const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
  const initRes = await fetch("/api/transcripts/upload/init", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, filename: file.name, contentType: file.type, fileSize: file.size, totalChunks }),
  });
  if (!initRes.ok) { let msg = `API error ${initRes.status}`; try { const j = await initRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  const { uploadId } = await initRes.json();
  for (let i = 0; i < totalChunks; i++) {
    const start = i * UPLOAD_CHUNK_SIZE;
    const end = Math.min(start + UPLOAD_CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const fd = new FormData();
    fd.append("chunk", chunk, `chunk_${i}`);
    fd.append("uploadId", uploadId);
    fd.append("chunkIndex", String(i));
    const chunkRes = await fetch("/api/transcripts/upload/chunk", { method: "POST", credentials: "include", body: fd });
    if (!chunkRes.ok) { let msg = `Chunk ${i} failed: ${chunkRes.status}`; try { const j = await chunkRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
    if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }
  const completeRes = await fetch("/api/transcripts/upload/complete", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });
  if (!completeRes.ok) { let msg = `API error ${completeRes.status}`; try { const j = await completeRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return completeRes.json();
}
export const apiUpdateTranscript = (id, data) => apiFetch(`/api/transcripts/${id}`, { method: "PUT", body: data });
export const apiDeleteTranscript = (id) => apiFetch(`/api/transcripts/${id}`, { method: "DELETE" });
export async function apiDownloadTranscriptAudio(id) {
  const res = await fetch(`/api/transcripts/${id}/download-audio`, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}
export async function apiExportTranscript(id, format = "txt") {
  const res = await fetch(`/api/transcripts/${id}/export?format=${format}`, { credentials: "include" });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}

// Filings
export const apiGetFilings = (caseId) => apiFetch(`/api/filings/${caseId}`);
export async function apiUploadFiling(formData) {
  const res = await fetch("/api/filings/upload", { method: "POST", credentials: "include", body: formData });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}
export async function apiDownloadFiling(id) {
  const res = await fetch(`/api/filings/${id}/download`, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}
export const apiDeleteFiling = (id) => apiFetch(`/api/filings/${id}`, { method: "DELETE" });
export const apiSummarizeFiling = (id) => apiFetch(`/api/filings/${id}/summarize`, { method: "POST", body: {} });
export const apiUpdateFiling = (id, data) => apiFetch(`/api/filings/${id}`, { method: "PUT", body: data });
export const apiClassifyFiling = (filingId) => apiFetch("/api/ai-agents/classify-filing", { method: "POST", body: { filingId } });

// Contact Notes
export const apiGetContactNotes    = (contactId) => apiFetch(`/api/contact-notes/${contactId}`);
export const apiCreateContactNote  = (data)      => apiFetch("/api/contact-notes",       { method: "POST",   body: data });
export const apiDeleteContactNote  = (id)        => apiFetch(`/api/contact-notes/${id}`, { method: "DELETE" });

// Contact Staff
export const apiGetContactStaff    = (contactId) => apiFetch(`/api/contact-staff/${contactId}`);
export const apiCreateContactStaff = (data)      => apiFetch("/api/contact-staff",       { method: "POST",   body: data });
export const apiUpdateContactStaff = (id, data)  => apiFetch(`/api/contact-staff/${id}`, { method: "PUT",    body: data });
export const apiDeleteContactStaff = (id)        => apiFetch(`/api/contact-staff/${id}`, { method: "DELETE" });

// Voicemails
export const apiGetVoicemails = (caseId) => apiFetch(`/api/voicemails/${caseId}`);
export const apiCreateVoicemail = (caseId, data) => apiFetch(`/api/voicemails/${caseId}`, { method: "POST", body: data });
export const apiUpdateVoicemail = (id, data) => apiFetch(`/api/voicemails/${id}`, { method: "PUT", body: data });
export const apiDeleteVoicemail = (id) => apiFetch(`/api/voicemails/${id}`, { method: "DELETE" });

// Correspondence
export const apiGetCorrespondence    = (caseId) => apiFetch(`/api/correspondence/${caseId}`);
export const apiDeleteCorrespondence = (id)     => apiFetch(`/api/correspondence/${id}`, { method: "DELETE" });
export const apiGetAllCorrespondence = ()       => apiFetch("/api/correspondence/all/summary");
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

export async function apiSaveTemplate(file, name, tags, placeholders, visibility, category, subType, systemPrefs) {
  const form = new FormData();
  form.append("file", file);
  form.append("name", name);
  form.append("tags", JSON.stringify(tags));
  form.append("placeholders", JSON.stringify(placeholders));
  form.append("visibility", visibility || "global");
  form.append("category", category || "General");
  form.append("subType", subType || "");
  if (systemPrefs) {
    form.append("useSystemHeader", String(systemPrefs.useSystemHeader !== false));
    form.append("useSystemSignature", String(systemPrefs.useSystemSignature !== false));
    form.append("useSystemCos", String(systemPrefs.useSystemCos !== false));
  }
  const res = await fetch("/api/templates", { method: "POST", credentials: "include", body: form });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Save error ${res.status}`); }
  return res.json();
}

export async function apiDetectPleadingSections(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/templates/detect-pleading-sections", { method: "POST", credentials: "include", body: form });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Detect error ${res.status}`); }
  return res.json();
}

export async function apiGenerateDocument(templateId, values, caseId, includeCoS) {
  const res = await fetch(`/api/templates/${templateId}/generate`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values, caseId: caseId || null, includeCoS: !!includeCoS }),
  });
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Generate error ${res.status}`); }
  return res.blob();
}

// Parties
export const apiGetParties    = (caseId) => apiFetch(`/api/parties/${caseId}`);
export const apiCreateParty   = (data)   => apiFetch("/api/parties",       { method: "POST",   body: data });
export const apiUpdateParty   = (id, data) => apiFetch(`/api/parties/${id}`, { method: "PUT",    body: data });
export const apiDeleteParty   = (id)     => apiFetch(`/api/parties/${id}`, { method: "DELETE" });

// Intake PDF Parsing
export async function apiParseIntake(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/cases/parse-intake", { method: "POST", credentials: "include", body: form });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}

// Conflict Check
export const apiConflictCheck  = (name)   => apiFetch(`/api/cases/conflict-check?name=${encodeURIComponent(name)}`);

// Experts
export const apiGetExperts    = (caseId) => apiFetch(`/api/experts/${caseId}`);
export const apiCreateExpert  = (data)   => apiFetch("/api/experts",       { method: "POST",   body: data });
export const apiUpdateExpert  = (id, data) => apiFetch(`/api/experts/${id}`, { method: "PUT",    body: data });
export const apiDeleteExpert  = (id)     => apiFetch(`/api/experts/${id}`, { method: "DELETE" });

// Misc Contacts
export const apiGetMiscContacts    = (caseId) => apiFetch(`/api/misc-contacts/${caseId}`);
export const apiCreateMiscContact  = (data)   => apiFetch("/api/misc-contacts",       { method: "POST",   body: data });
export const apiUpdateMiscContact  = (id, data) => apiFetch(`/api/misc-contacts/${id}`, { method: "PUT",    body: data });
export const apiDeleteMiscContact  = (id)     => apiFetch(`/api/misc-contacts/${id}`, { method: "DELETE" });

// Time Entries
export const apiGetTimeEntries    = (userId, from, to) => apiFetch(`/api/time-entries?userId=${userId}&from=${from}&to=${to}`);
export const apiCreateTimeEntry   = (data)   => apiFetch("/api/time-entries",       { method: "POST",   body: data });
export const apiUpdateTimeEntry   = (id, data) => apiFetch(`/api/time-entries/${id}`, { method: "PUT",    body: data });
export const apiDeleteTimeEntry   = (id)     => apiFetch(`/api/time-entries/${id}`, { method: "DELETE" });

// Pinned Cases
export const apiGetPinnedCases    = ()        => apiFetch("/api/cases/pinned");
export const apiSetPinnedCases    = (pinnedIds) => apiFetch("/api/cases/pinned", { method: "PUT", body: { pinnedIds } });

// Batch Case Operations
export const apiBatchPreview = (data) => apiFetch("/api/batch-cases/preview", { method: "POST", body: data });
export const apiBatchApply   = (data) => apiFetch("/api/batch-cases",         { method: "POST", body: data });

// Calendar Feeds
export const apiGetCalendarFeeds    = ()         => apiFetch("/api/calendar-feeds");
export const apiCreateCalendarFeed  = (data)     => apiFetch("/api/calendar-feeds", { method: "POST", body: data });
export const apiUpdateCalendarFeed  = (id, data) => apiFetch(`/api/calendar-feeds/${id}`, { method: "PATCH", body: data });
export const apiDeleteCalendarFeed  = (id)       => apiFetch(`/api/calendar-feeds/${id}`, { method: "DELETE" });

// Linked Cases
export const apiGetLinkedCases    = (caseId) => apiFetch(`/api/linked-cases/${caseId}`);
export const apiCreateLinkedCase  = (data)   => apiFetch("/api/linked-cases", { method: "POST", body: data });
export const apiDeleteLinkedCase  = (id)     => apiFetch(`/api/linked-cases/${id}`, { method: "DELETE" });

// SMS / Auto Text
export const apiGetSmsStatus       = ()         => apiFetch("/api/sms/status");
export const apiGetSmsConfigs      = (caseId)   => apiFetch(`/api/sms/configs/${caseId}`);
export const apiCreateSmsConfig    = (data)     => apiFetch("/api/sms/configs",       { method: "POST",   body: data });
export const apiUpdateSmsConfig    = (id, data) => apiFetch(`/api/sms/configs/${id}`,  { method: "PUT",    body: data });
export const apiDeleteSmsConfig    = (id)       => apiFetch(`/api/sms/configs/${id}`,  { method: "DELETE" });
export const apiGetSmsMessages     = (caseId)   => apiFetch(`/api/sms/messages/${caseId}`);
export const apiGetSmsScheduled    = (caseId)   => apiFetch(`/api/sms/scheduled/${caseId}`);
export const apiSendSms            = (data)     => apiFetch("/api/sms/send",           { method: "POST",   body: data });
export const apiDraftSmsMessage    = (data)     => apiFetch("/api/sms/draft",          { method: "POST",   body: data });
export const apiSuggestSmsNumbers  = (caseId)   => apiFetch(`/api/sms/suggest-numbers/${caseId}`);

// Support
export const apiSendSupport = (data) => apiFetch("/api/support", { method: "POST", body: data });


// Collaborate
export const apiGetCollabChannels       = ()            => apiFetch("/api/collaborate/channels");
export const apiCreateCollabChannel     = (data)        => apiFetch("/api/collaborate/channels",          { method: "POST",   body: data });
export const apiDeleteCollabChannel     = (id)          => apiFetch(`/api/collaborate/channels/${id}`,    { method: "DELETE" });
export const apiGetCollabMessages       = (id, before)  => apiFetch(`/api/collaborate/channels/${id}/messages${before ? `?before=${before}` : ""}`);
export const apiSendCollabMessage       = (id, data)    => apiFetch(`/api/collaborate/channels/${id}/messages`, { method: "POST", body: data });
export const apiMarkCollabRead          = (id)          => apiFetch(`/api/collaborate/channels/${id}/read`,     { method: "PUT" });
export const apiSearchCollabMessages    = (q)           => apiFetch(`/api/collaborate/search?q=${encodeURIComponent(q)}`);
export const apiGetCaseChannels         = ()            => apiFetch("/api/collaborate/case-channels");
export const apiCreateCollabGroup       = (data)        => apiFetch("/api/collaborate/groups",            { method: "POST",   body: data });
export const apiUpdateCollabGroup       = (id, data)    => apiFetch(`/api/collaborate/groups/${id}`,      { method: "PUT",    body: data });
export const apiGetCollabGroupMembers   = (id)          => apiFetch(`/api/collaborate/groups/${id}/members`);
export const apiAddCollabGroupMembers   = (id, data)    => apiFetch(`/api/collaborate/groups/${id}/members`, { method: "POST", body: data });
export const apiRemoveCollabGroupMember = (id, userId)  => apiFetch(`/api/collaborate/groups/${id}/members/${userId}`, { method: "DELETE" });
export const apiGetPrivateChats         = ()            => apiFetch("/api/collaborate/private");
export const apiStartPrivateChat        = (data)        => apiFetch("/api/collaborate/private",           { method: "POST",   body: data });
export const apiCollabTyping            = (id)          => apiFetch(`/api/collaborate/channels/${id}/typing`, { method: "POST" });
export const apiGetCollabTyping         = (id)          => apiFetch(`/api/collaborate/channels/${id}/typing`);
export const apiGetCollabUnreadCount    = ()            => apiFetch("/api/collaborate/unread");
export const apiGetSmsWatch              = (caseId)          => apiFetch(`/api/sms/watch/${caseId}`);
export const apiAddSmsWatch              = (caseId, data)     => apiFetch(`/api/sms/watch/${caseId}`, { method: "POST", body: data });
export const apiDeleteSmsWatch           = (watchId)          => apiFetch(`/api/sms/watch/${watchId}`, { method: "DELETE" });
export const apiGetUnmatchedSms          = ()                 => apiFetch("/api/sms/unmatched");
export const apiAssignSms                = (messageId, caseId) => apiFetch(`/api/sms/assign/${messageId}`, { method: "PUT", body: { caseId } });

// Trial Center
export const apiGetTrialSession = (caseId) => apiFetch(`/api/trial-center/sessions/${caseId}`);
export const apiCreateTrialSession = (data) => apiFetch("/api/trial-center/sessions", { method: "POST", body: data });
export const apiUpdateTrialSession = (id, data) => apiFetch(`/api/trial-center/sessions/${id}`, { method: "PUT", body: data });

export const apiGetTrialWitnesses = (sessionId) => apiFetch(`/api/trial-center/witnesses/${sessionId}`);
export const apiCreateTrialWitness = (data) => apiFetch("/api/trial-center/witnesses", { method: "POST", body: data });
export const apiUpdateTrialWitness = (id, data) => apiFetch(`/api/trial-center/witnesses/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialWitness = (id) => apiFetch(`/api/trial-center/witnesses/${id}`, { method: "DELETE" });
export const apiReorderTrialWitnesses = (sessionId, order) => apiFetch(`/api/trial-center/witnesses/reorder/${sessionId}`, { method: "PUT", body: { order } });

export const apiGetTrialExhibits = (sessionId) => apiFetch(`/api/trial-center/exhibits-full/${sessionId}`);
export const apiCreateTrialExhibit = (data) => apiFetch("/api/trial-center/exhibits", { method: "POST", body: data });
export const apiUpdateTrialExhibit = (id, data) => apiFetch(`/api/trial-center/exhibits/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialExhibit = (id) => apiFetch(`/api/trial-center/exhibits/${id}`, { method: "DELETE" });
export async function apiUploadTrialExhibit(formData) {
  const res = await fetch("/api/trial-center/exhibits/upload", { method: "POST", credentials: "include", body: formData });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}

export const apiGetTrialJurors = (sessionId) => apiFetch(`/api/trial-center/jurors/${sessionId}`);
export const apiCreateTrialJuror = (data) => apiFetch("/api/trial-center/jurors", { method: "POST", body: data });
export const apiUpdateTrialJuror = (id, data) => apiFetch(`/api/trial-center/jurors/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialJuror = (id) => apiFetch(`/api/trial-center/jurors/${id}`, { method: "DELETE" });

export const apiGetTrialMotions = (sessionId) => apiFetch(`/api/trial-center/motions/${sessionId}`);
export const apiCreateTrialMotion = (data) => apiFetch("/api/trial-center/motions", { method: "POST", body: data });
export const apiUpdateTrialMotion = (id, data) => apiFetch(`/api/trial-center/motions/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialMotion = (id) => apiFetch(`/api/trial-center/motions/${id}`, { method: "DELETE" });

export const apiGetTrialOutlines = (sessionId) => apiFetch(`/api/trial-center/outlines/${sessionId}`);
export const apiCreateTrialOutline = (data) => apiFetch("/api/trial-center/outlines", { method: "POST", body: data });
export const apiUpdateTrialOutline = (id, data) => apiFetch(`/api/trial-center/outlines/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialOutline = (id) => apiFetch(`/api/trial-center/outlines/${id}`, { method: "DELETE" });

export const apiGetTrialJuryInstructions = (sessionId) => apiFetch(`/api/trial-center/jury-instructions/${sessionId}`);
export const apiCreateTrialJuryInstruction = (data) => apiFetch("/api/trial-center/jury-instructions", { method: "POST", body: data });
export const apiUpdateTrialJuryInstruction = (id, data) => apiFetch(`/api/trial-center/jury-instructions/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialJuryInstruction = (id) => apiFetch(`/api/trial-center/jury-instructions/${id}`, { method: "DELETE" });

export const apiGetTrialTimelineEvents = (sessionId) => apiFetch(`/api/trial-center/timeline-events/${sessionId}`);
export const apiCreateTrialTimelineEvent = (data) => apiFetch("/api/trial-center/timeline-events", { method: "POST", body: data });
export const apiUpdateTrialTimelineEvent = (id, data) => apiFetch(`/api/trial-center/timeline-events/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialTimelineEvent = (id) => apiFetch(`/api/trial-center/timeline-events/${id}`, { method: "DELETE" });
export async function apiUploadDemonstrative(formData) {
  const res = await fetch("/api/trial-center/demonstratives/upload", { method: "POST", credentials: "include", body: formData });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}
export async function apiDownloadDemonstrative(id) {
  const res = await fetch(`/api/trial-center/demonstratives/${id}/download`, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}

export const apiGetTrialPinnedDocs = (sessionId) => apiFetch(`/api/trial-center/pinned-docs-full/${sessionId}`);
export const apiCreateTrialPinnedDoc = (data) => apiFetch("/api/trial-center/pinned-docs", { method: "POST", body: data });
export const apiDeleteTrialPinnedDoc = (id) => apiFetch(`/api/trial-center/pinned-docs/${id}`, { method: "DELETE" });

export const apiGetTrialLogEntries = (sessionId) => apiFetch(`/api/trial-center/log-entries/${sessionId}`);
export const apiCreateTrialLogEntry = (data) => apiFetch("/api/trial-center/log-entries", { method: "POST", body: data });
export const apiUpdateTrialLogEntry = (id, data) => apiFetch(`/api/trial-center/log-entries/${id}`, { method: "PUT", body: data });
export const apiDeleteTrialLogEntry = (id) => apiFetch(`/api/trial-center/log-entries/${id}`, { method: "DELETE" });

export const apiTrialAiWitnessPrep = (data) => apiFetch("/api/trial-center/ai/witness-prep", { method: "POST", body: data });
export const apiTrialAiJurySelection = (data) => apiFetch("/api/trial-center/ai/jury-selection", { method: "POST", body: data });
export const apiTrialAiObjectionCoach = (data) => apiFetch("/api/trial-center/ai/objection-coach", { method: "POST", body: data });
export const apiTrialAiClosingBuilder = (data) => apiFetch("/api/trial-center/ai/closing-builder", { method: "POST", body: data });
export const apiTrialAiOpeningBuilder = (data) => apiFetch("/api/trial-center/ai/opening-builder", { method: "POST", body: data });
export const apiTrialAiJuryInstructions = (data) => apiFetch("/api/trial-center/ai/jury-instructions", { method: "POST", body: data });
export const apiTrialAiCaseLawSearch = (data) => apiFetch("/api/trial-center/ai/case-law-search", { method: "POST", body: data });

export async function apiExportWitnessPrep(data) {
  const res = await fetch("/api/trial-center/witness-prep/export", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}

export const apiGetWitnessDocuments = (witnessId) => apiFetch(`/api/trial-center/witnesses/${witnessId}/documents`);
export const apiLinkWitnessDocument = (witnessId, data) => apiFetch(`/api/trial-center/witnesses/${witnessId}/documents`, { method: "POST", body: data });
export const apiUnlinkWitnessDocument = (linkId) => apiFetch(`/api/trial-center/witness-documents/${linkId}`, { method: "DELETE" });

export async function apiExtractOutlineFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/trial-center/outlines/ai-assist", { method: "POST", credentials: "include", body: fd });
  if (!res.ok) { let msg = `API error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}

export async function apiUploadCollabFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/collaborate/upload", { method: "POST", body: fd, credentials: "include" });
  if (!res.ok) { let msg = `Upload error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}

// Portal Admin
export const apiGetPortalSettings    = (caseId)        => apiFetch(`/api/portal-admin/${caseId}/settings`);
export const apiUpdatePortalSettings = (caseId, data)  => apiFetch(`/api/portal-admin/${caseId}/settings`, { method: "PUT", body: data });
export const apiGetPortalClients     = (caseId)        => apiFetch(`/api/portal-admin/${caseId}/clients`);
export const apiCreatePortalClient   = (caseId, data)  => apiFetch(`/api/portal-admin/${caseId}/clients`, { method: "POST", body: data });
export const apiDeletePortalClient   = (caseId, clientId) => apiFetch(`/api/portal-admin/${caseId}/clients/${clientId}`, { method: "DELETE" });
export const apiGetPortalMessages    = (caseId)        => apiFetch(`/api/portal-admin/${caseId}/messages`);
export const apiSendPortalMessage    = (caseId, body)  => apiFetch(`/api/portal-admin/${caseId}/messages`, { method: "POST", body: { body } });
export const apiMarkPortalMsgRead   = (caseId, msgId) => apiFetch(`/api/portal-admin/${caseId}/messages/${msgId}/read`, { method: "PUT" });

// MFA
export const apiMfaSetup       = ()       => apiFetch("/api/auth/mfa/setup",        { method: "POST" });
export const apiMfaVerifySetup = (token)   => apiFetch("/api/auth/mfa/verify-setup", { method: "POST", body: { token } });
export const apiMfaVerify      = (token)   => apiFetch("/api/auth/mfa/verify",       { method: "POST", body: { token } });
export const apiMfaDisable     = (password) => apiFetch("/api/auth/mfa/disable",     { method: "POST", body: { password } });

// Profile Picture
export const apiUploadProfilePicture = async (userId, file) => {
  const fd = new FormData();
  fd.append("picture", file);
  const res = await fetch(`/api/users/${userId}/profile-picture`, { method: "POST", credentials: "include", body: fd });
  if (!res.ok) { let msg = `Upload error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
};
export const apiDeleteProfilePicture = (userId) => apiFetch(`/api/users/${userId}/profile-picture`, { method: "DELETE" });

// Document Folders
export const apiGetDocFolders     = (caseId)       => apiFetch(`/api/case-documents/${caseId}/folders`);
export const apiCreateDocFolder   = (caseId, name)  => apiFetch(`/api/case-documents/${caseId}/folders`, { method: "POST", body: { name } });
export const apiUpdateDocFolder   = (folderId, data) => apiFetch(`/api/case-documents/folders/${folderId}`, { method: "PUT", body: data });
export const apiDeleteDocFolder   = (folderId)       => apiFetch(`/api/case-documents/folders/${folderId}`, { method: "DELETE" });
export const apiMoveDocument      = (docId, folderId) => apiFetch(`/api/case-documents/${docId}/move`, { method: "PUT", body: { folderId } });
export const apiReorderDocFolders = (caseId, order)   => apiFetch(`/api/case-documents/${caseId}/reorder-folders`, { method: "PUT", body: { order } });

// Transcript Folders
export const apiGetTranscriptFolders     = (caseId)       => apiFetch(`/api/transcripts/case/${caseId}/folders`);
export const apiCreateTranscriptFolder   = (caseId, name)  => apiFetch(`/api/transcripts/case/${caseId}/folders`, { method: "POST", body: { name } });
export const apiUpdateTranscriptFolder   = (folderId, data) => apiFetch(`/api/transcripts/folders/${folderId}`, { method: "PUT", body: data });
export const apiDeleteTranscriptFolder   = (folderId)       => apiFetch(`/api/transcripts/folders/${folderId}`, { method: "DELETE" });
export const apiMoveTranscript           = (tId, folderId)  => apiFetch(`/api/transcripts/${tId}/move`, { method: "PUT", body: { folderId } });
export const apiReorderTranscriptFolders = (caseId, order)  => apiFetch(`/api/transcripts/case/${caseId}/reorder-folders`, { method: "PUT", body: { order } });

// Unread Client Communication
export const apiGetUnreadClientComm       = ()    => apiFetch("/api/portal-admin/unread-summary");

// Batch Delete
export const apiBatchDeleteDocuments      = (ids) => apiFetch("/api/case-documents/batch-delete",  { method: "POST", body: { ids } });
export const apiBatchDeleteTranscripts    = (ids) => apiFetch("/api/transcripts/batch-delete",     { method: "POST", body: { ids } });
export const apiBatchDeleteCorrespondence = (ids) => apiFetch("/api/correspondence/batch-delete",  { method: "POST", body: { ids } });

// Chunked Upload for Documents
const DOC_CHUNK_SIZE = 20 * 1024 * 1024;
export async function apiUploadCaseDocumentChunked(file, caseId, docType, onProgress) {
  const totalChunks = Math.ceil(file.size / DOC_CHUNK_SIZE);
  const initRes = await fetch("/api/case-documents/upload/init", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, filename: file.name, fileSize: file.size, totalChunks, docType: docType || "" }),
  });
  if (!initRes.ok) { let msg = `Init error ${initRes.status}`; try { const j = await initRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  const { uploadId } = await initRes.json();
  for (let i = 0; i < totalChunks; i++) {
    const start = i * DOC_CHUNK_SIZE;
    const end = Math.min(start + DOC_CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const fd = new FormData();
    fd.append("chunk", chunk, `chunk_${i}`);
    fd.append("uploadId", uploadId);
    fd.append("chunkIndex", String(i));
    const chunkRes = await fetch("/api/case-documents/upload/chunk", { method: "POST", credentials: "include", body: fd });
    if (!chunkRes.ok) { let msg = `Chunk ${i} failed`; try { const j = await chunkRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
    if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }
  const completeRes = await fetch("/api/case-documents/upload/complete", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });
  if (!completeRes.ok) { let msg = `Complete error`; try { const j = await completeRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return completeRes.json();
}

// Chunked Upload for Filings
export async function apiUploadFilingChunked(file, caseId, filedBy, filingDate, docType, onProgress) {
  const totalChunks = Math.ceil(file.size / DOC_CHUNK_SIZE);
  const initRes = await fetch("/api/filings/upload/init", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, filename: file.name, fileSize: file.size, totalChunks, filedBy, filingDate, docType }),
  });
  if (!initRes.ok) { let msg = `Init error ${initRes.status}`; try { const j = await initRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  const { uploadId } = await initRes.json();
  for (let i = 0; i < totalChunks; i++) {
    const start = i * DOC_CHUNK_SIZE;
    const end = Math.min(start + DOC_CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const fd = new FormData();
    fd.append("chunk", chunk, `chunk_${i}`);
    fd.append("uploadId", uploadId);
    fd.append("chunkIndex", String(i));
    const chunkRes = await fetch("/api/filings/upload/chunk", { method: "POST", credentials: "include", body: fd });
    if (!chunkRes.ok) { let msg = `Chunk ${i} failed`; try { const j = await chunkRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
    if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }
  const completeRes = await fetch("/api/filings/upload/complete", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });
  if (!completeRes.ok) { let msg = `Complete error`; try { const j = await completeRes.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return completeRes.json();
}

// Jury Analysis
export const apiGetJuryAnalysis    = (caseId)        => apiFetch(`/api/trial-center/jury-analysis/${caseId}`);
export const apiUpdateJurorStrike  = (caseId, data)  => apiFetch(`/api/trial-center/jury-analysis/${caseId}/juror-strike`, { method: "PATCH", body: data });
export const apiDeleteJuryAnalysis = (caseId)        => apiFetch(`/api/trial-center/jury-analysis/${caseId}`, { method: "DELETE" });


// Deleted Data
export const apiGetDeletedData     = ()             => apiFetch("/api/deleted-data");
export const apiRestoreDeletedItem = (type, id)     => apiFetch("/api/deleted-data/restore", { method: "POST", body: { type, id } });
