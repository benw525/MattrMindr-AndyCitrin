const BASE = "";

async function portalFetch(path, opts = {}) {
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

export const portalLogin = (email, password) => portalFetch("/api/portal/auth/login", { method: "POST", body: { email, password } });
export const portalLogout = () => portalFetch("/api/portal/auth/logout", { method: "POST" });
export const portalMe = () => portalFetch("/api/portal/auth/me");
export const portalChangePassword = (currentPassword, newPassword) => portalFetch("/api/portal/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });

export const portalGetCase = () => portalFetch("/api/portal/case");
export const portalGetMessages = () => portalFetch("/api/portal/case/messages");
export const portalSendMessage = (body) => portalFetch("/api/portal/case/messages", { method: "POST", body: { body } });
export const portalGetDocuments = () => portalFetch("/api/portal/case/documents");

export async function portalUploadDocument(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/portal/case/documents/upload", { method: "POST", credentials: "include", body: form });
  if (!res.ok) { let msg = `Upload error ${res.status}`; try { const j = await res.json(); msg = j.error || msg; } catch {} throw new Error(msg); }
  return res.json();
}

export const portalGetTreatments = () => portalFetch("/api/portal/case/treatments");

export async function portalDownloadDocument(docId) {
  const res = await fetch(`/api/portal/case/documents/${docId}/download`, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
}
