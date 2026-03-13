import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  portalLogin, portalLogout, portalMe, portalChangePassword,
  portalGetCase, portalGetMessages, portalSendMessage,
  portalGetDocuments, portalUploadDocument, portalDownloadDocument,
} from "./portalApi";

const PI_PROCESS_INFO = [
  { stage: "Case Opened", desc: "Your attorney has accepted your case and is gathering initial information. You may be asked to provide details about the incident, your injuries, and any witnesses." },
  { stage: "Investigation", desc: "Your legal team is investigating the facts of your case — collecting police reports, witness statements, and other evidence to build the strongest case possible." },
  { stage: "Medical Treatment", desc: "You are receiving medical treatment for your injuries. It's important to follow your doctor's advice and attend all appointments. Your attorney will track your treatment progress." },
  { stage: "Demand Sent", desc: "Your attorney has sent a demand letter to the insurance company, outlining your injuries, treatment, and the compensation you deserve." },
  { stage: "Negotiation", desc: "Your attorney is negotiating with the insurance company to reach a fair settlement. This process can involve multiple rounds of offers and counter-offers." },
  { stage: "Lawsuit Filed", desc: "A lawsuit has been filed on your behalf. This does not mean your case will go to trial — most cases still settle, but filing protects your rights." },
  { stage: "Discovery", desc: "Both sides are exchanging information and evidence. You may be asked to answer written questions (interrogatories) or give a deposition." },
  { stage: "Mediation", desc: "A neutral mediator will help both sides try to reach a settlement agreement. This is a confidential process designed to resolve cases without trial." },
  { stage: "Trial Preparation", desc: "Your attorney is preparing for trial — organizing evidence, preparing witnesses, and developing trial strategy." },
  { stage: "Trial", desc: "Your case is being presented before a judge or jury. Your attorney will advocate for you throughout the trial process." },
  { stage: "Resolution", desc: "Your case has been resolved through settlement or verdict. Your attorney will explain the outcome and handle the disbursement of funds." },
  { stage: "Case Closed", desc: "Your case is closed. All matters have been resolved and final disbursements completed." },
];

export default function PortalApp() {
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("dashboard");

  useEffect(() => {
    portalMe().then(c => { setClient(c); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#f1f5f9" }}><div style={{ color: "#64748b" }}>Loading...</div></div>;
  if (!client) return <LoginPage onLogin={setClient} />;
  if (client.mustChangePassword) return <ChangePasswordPage client={client} onDone={() => setClient({ ...client, mustChangePassword: false })} />;

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <Header client={client} onLogout={() => { portalLogout(); setClient(null); }} />
      <Nav page={page} setPage={setPage} />
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
        {page === "dashboard" && <DashboardPage />}
        {page === "messages" && <MessagesPage />}
        {page === "documents" && <DocumentsPage />}
      </main>
    </div>
  );
}

function Header({ client, onLogout }) {
  return (
    <header style={{ background: "#1e293b", color: "#fff", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, background: "#334155", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: "#94a3b8" }}>M</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>MATTRMINDR</div>
          <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: 0.5 }}>CLIENT PORTAL</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span style={{ fontSize: 14, color: "#cbd5e1" }}>{client.name}</span>
        <button onClick={onLogout} style={{ background: "none", border: "1px solid #475569", color: "#94a3b8", padding: "6px 14px", borderRadius: 6, fontSize: 13, cursor: "pointer" }}>Sign Out</button>
      </div>
    </header>
  );
}

function Nav({ page, setPage }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "messages", label: "Messages" },
    { id: "documents", label: "Documents" },
  ];
  return (
    <nav style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 24px", display: "flex", gap: 0 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setPage(t.id)} style={{
          background: "none", border: "none", padding: "14px 20px", fontSize: 14, fontWeight: page === t.id ? 600 : 400,
          color: page === t.id ? "#1e3a5f" : "#64748b", borderBottom: page === t.id ? "2px solid #1e3a5f" : "2px solid transparent",
          cursor: "pointer", transition: "all 0.15s"
        }}>{t.label}</button>
      ))}
    </nav>
  );
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const c = await portalLogin(email, password);
      onLogin(c);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "48px 40px", width: 420, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 44, height: 44, background: "#1e293b", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 18, color: "#fff" }}>M</div>
            <span style={{ fontWeight: 800, fontSize: 22, color: "#1e293b", letterSpacing: 2 }}>MATTRMINDR</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e3a5f", letterSpacing: 1.5, textTransform: "uppercase" }}>Client Portal</div>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            style={{ width: "100%", padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: "border-box" }}
            placeholder="your.email@example.com" />
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            style={{ width: "100%", padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, marginBottom: 20, boxSizing: "border-box" }}
            placeholder="Enter your password" />
          {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12, textAlign: "center" }}>{error}</div>}
          <button type="submit" disabled={busy} style={{
            width: "100%", padding: "12px", background: "#1e293b", color: "#fff", border: "none", borderRadius: 8,
            fontSize: 15, fontWeight: 600, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.7 : 1
          }}>{busy ? "Signing In..." : "Sign In"}</button>
        </form>
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <a href="/" style={{ fontSize: 13, color: "#64748b", textDecoration: "none" }}>Back to firm login</a>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordPage({ client, onDone }) {
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPw.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPw !== confirm) { setError("Passwords do not match"); return; }
    setError("");
    setBusy(true);
    try {
      await portalChangePassword(null, newPw);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "48px 40px", width: 420, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <h2 style={{ textAlign: "center", color: "#1e293b", marginBottom: 8 }}>Change Your Password</h2>
        <p style={{ textAlign: "center", color: "#64748b", fontSize: 14, marginBottom: 28 }}>Welcome, {client.name}! Please set a new password to continue.</p>
        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>New Password</label>
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} required
            style={{ width: "100%", padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, marginBottom: 16, boxSizing: "border-box" }} />
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>Confirm Password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
            style={{ width: "100%", padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, marginBottom: 20, boxSizing: "border-box" }} />
          {error && <div style={{ color: "#dc2626", fontSize: 13, marginBottom: 12 }}>{error}</div>}
          <button type="submit" disabled={busy} style={{
            width: "100%", padding: "12px", background: "#1e293b", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: busy ? "wait" : "pointer"
          }}>{busy ? "Saving..." : "Set Password"}</button>
        </form>
      </div>
    </div>
  );
}

function DashboardPage() {
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFaq, setShowFaq] = useState(false);

  useEffect(() => {
    portalGetCase().then(d => { setCaseData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>Loading case information...</div>;
  if (!caseData) return <div style={{ textAlign: "center", color: "#dc2626", padding: 40 }}>Unable to load case information.</div>;

  const currentStageInfo = PI_PROCESS_INFO.find(p => p.stage === caseData.currentStage);

  return (
    <div>
      {caseData.statusMessage && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "18px 20px", marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: "#1e40af", marginBottom: 6 }}>Update from Your Legal Team</div>
          <div style={{ fontSize: 14, color: "#1e3a5f", lineHeight: 1.6 }}>{caseData.statusMessage}</div>
        </div>
      )}

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "24px", marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 16px", color: "#1e293b", fontSize: 16 }}>Case Progress</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto", padding: "8px 0" }}>
          {(caseData.timeline || []).map((step, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", flex: step.status === "current" ? "none" : 1, minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: step.status === "current" ? 100 : 20 }}>
                <div style={{
                  width: step.status === "current" ? 28 : 20,
                  height: step.status === "current" ? 28 : 20,
                  borderRadius: "50%",
                  background: step.status === "completed" ? "#22c55e" : step.status === "current" ? "#2563eb" : "#e2e8f0",
                  border: step.status === "current" ? "3px solid #bfdbfe" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {step.status === "completed" ? "✓" : step.status === "current" ? "●" : ""}
                </div>
                {step.status === "current" && (
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#2563eb", marginTop: 6, textAlign: "center", whiteSpace: "nowrap" }}>{step.label}</div>
                )}
              </div>
              {i < (caseData.timeline || []).length - 1 && (
                <div style={{ flex: 1, height: 2, background: step.status === "completed" ? "#22c55e" : "#e2e8f0", minWidth: 12 }} />
              )}
            </div>
          ))}
        </div>
        {currentStageInfo && (
          <div style={{ marginTop: 16, padding: "14px 16px", background: "#f8fafc", borderRadius: 8, fontSize: 13, color: "#475569", lineHeight: 1.6 }}>
            {currentStageInfo.desc}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        {caseData.caseType && (
          <InfoCard label="Case Type" value={caseData.caseType} />
        )}
        {(caseData.attorneyName || caseData.caseManagerName || caseData.paralegalName) && (
          <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "16px 20px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Staff</div>
            {caseData.attorneyName && <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b" }}>{caseData.attorneyName} <span style={{ fontSize: 11, fontWeight: 400, color: "#64748b" }}>Attorney</span></div>}
            {caseData.caseManagerName && <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b", marginTop: caseData.attorneyName ? 4 : 0 }}>{caseData.caseManagerName} <span style={{ fontSize: 11, fontWeight: 400, color: "#64748b" }}>Case Manager</span></div>}
            {caseData.paralegalName && <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b", marginTop: caseData.attorneyName ? 4 : 0 }}>{caseData.paralegalName} <span style={{ fontSize: 11, fontWeight: 400, color: "#64748b" }}>Paralegal</span></div>}
          </div>
        )}
        {caseData.accidentDate && (
          <InfoCard label="Date of Incident" value={new Date(caseData.accidentDate).toLocaleDateString()} />
        )}
        {caseData.nextCourtDate && (
          <InfoCard label="Next Court Date" value={new Date(caseData.nextCourtDate).toLocaleDateString()} />
        )}
        {caseData.mediationDate && (
          <InfoCard label="Mediation Date" value={new Date(caseData.mediationDate).toLocaleDateString()} />
        )}
        {caseData.trialDate && (
          <InfoCard label="Trial Date" value={new Date(caseData.trialDate).toLocaleDateString()} />
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "20px 24px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setShowFaq(!showFaq)}>
          <h3 style={{ margin: 0, color: "#1e293b", fontSize: 16 }}>What to Expect</h3>
          <span style={{ color: "#64748b", fontSize: 18, transform: showFaq ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
        </div>
        {showFaq && (
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 16, padding: "14px 16px", background: "#fef3c7", borderRadius: 8, fontSize: 13, color: "#92400e", lineHeight: 1.5 }}>
              <strong>Important:</strong> Do not post about your case on social media. Do not give recorded statements to insurance companies without consulting your attorney. Keep all medical appointments and follow your doctor's instructions. If your contact information changes or you have any concerns, contact us immediately.
            </div>
            {PI_PROCESS_INFO.map((item, i) => (
              <div key={i} style={{ padding: "12px 0", borderBottom: i < PI_PROCESS_INFO.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#1e293b", marginBottom: 4 }}>{item.stage}</div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "16px 20px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b" }}>{value}</div>
    </div>
  );
}

function MessagesPage() {
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadMessages = useCallback(() => {
    portalGetMessages().then(m => { setMessages(m); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadMessages(); const iv = setInterval(loadMessages, 15000); return () => clearInterval(iv); }, [loadMessages]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMsg.trim() || sending) return;
    setSending(true);
    try {
      const msg = await portalSendMessage(newMsg.trim());
      setMessages(prev => [...prev, msg]);
      setNewMsg("");
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>Loading messages...</div>;

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", height: "calc(100vh - 200px)", minHeight: 400 }}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
        <h3 style={{ margin: 0, color: "#1e293b", fontSize: 16 }}>Messages</h3>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>Send a message to your legal team</p>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: 40, fontSize: 14 }}>No messages yet. Send a message to get started.</div>
        )}
        {messages.map(m => (
          <div key={m.id} style={{ marginBottom: 12, display: "flex", justifyContent: m.sender_type === "client" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "75%", padding: "10px 14px", borderRadius: 12,
              background: m.sender_type === "client" ? "#1e293b" : "#f1f5f9",
              color: m.sender_type === "client" ? "#fff" : "#1e293b",
            }}>
              {m.sender_type === "firm" && <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>{m.sender_name}</div>}
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>{m.body}</div>
              <div style={{ fontSize: 11, marginTop: 4, opacity: 0.6, textAlign: "right" }}>
                {new Date(m.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 8 }}>
        <input
          value={newMsg} onChange={e => setNewMsg(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: 1, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 14, outline: "none" }}
        />
        <button type="submit" disabled={sending || !newMsg.trim()} style={{
          padding: "10px 20px", background: "#1e293b", color: "#fff", border: "none", borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: sending ? "wait" : "pointer", opacity: sending || !newMsg.trim() ? 0.6 : 1
        }}>Send</button>
      </form>
    </div>
  );
}

function DocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    portalGetDocuments().then(d => { setDocuments(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const total = files.length;
    let uploaded = 0;
    const errors = [];
    for (const file of files) {
      setUploadProgress(`Uploading ${uploaded + 1} of ${total}: ${file.name}`);
      try {
        const doc = await portalUploadDocument(file);
        setDocuments(prev => [doc, ...prev]);
      } catch (err) {
        errors.push(`${file.name}: ${err.message}`);
      }
      uploaded++;
    }
    setUploading(false);
    setUploadProgress("");
    if (errors.length > 0) alert(`Some uploads failed:\n${errors.join("\n")}`);
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = "";
    await uploadFiles(files);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    await uploadFiles(files);
  };

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); };

  const handleDownload = async (doc) => {
    try {
      const blob = await portalDownloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = doc.filename; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Download failed: " + err.message);
    }
  };

  const clientDocs = documents.filter(d => d.source === "client");
  const firmDocs = documents.filter(d => d.source === "firm");

  if (loading) return <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>Loading documents...</div>;

  return (
    <div>
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "20px 24px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: "#1e293b", fontSize: 16 }}>My Uploads</h3>
          <label style={{
            padding: "8px 16px", background: "#1e293b", color: "#fff", borderRadius: 8, fontSize: 13,
            fontWeight: 600, cursor: uploading ? "wait" : "pointer", opacity: uploading ? 0.7 : 1
          }}>
            {uploading ? "Uploading..." : "Upload Documents"}
            <input type="file" ref={fileRef} onChange={handleUpload} style={{ display: "none" }}
              accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png,.tiff,.tif" multiple />
          </label>
        </div>
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          style={{
            border: `2px dashed ${dragOver ? "#3b82f6" : "#cbd5e1"}`,
            borderRadius: 10,
            padding: uploading ? "16px 20px" : "24px 20px",
            textAlign: "center",
            marginBottom: 16,
            background: dragOver ? "#eff6ff" : "#f8fafc",
            transition: "all 0.2s ease",
            cursor: uploading ? "wait" : "pointer"
          }}
          onClick={() => { if (!uploading && fileRef.current) fileRef.current.click(); }}
        >
          {uploading ? (
            <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 500 }}>{uploadProgress || "Uploading..."}</div>
          ) : (
            <>
              <div style={{ fontSize: 28, marginBottom: 4 }}>📄</div>
              <div style={{ fontSize: 14, color: "#475569", fontWeight: 500 }}>Drag & drop files here</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>or click to browse — you can select multiple files</div>
              <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 6 }}>PDF, DOC, DOCX, TXT, JPG, PNG, TIFF</div>
            </>
          )}
        </div>
        {clientDocs.length === 0 ? (
          <div style={{ textAlign: "center", color: "#94a3b8", padding: 20, fontSize: 14 }}>No documents uploaded yet.</div>
        ) : (
          <div>
            {clientDocs.map(d => (
              <DocRow key={d.id} doc={d} onDownload={handleDownload} />
            ))}
          </div>
        )}
      </div>

      {firmDocs.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "20px 24px" }}>
          <h3 style={{ margin: "0 0 16px", color: "#1e293b", fontSize: 16 }}>Case Documents</h3>
          {firmDocs.map(d => (
            <DocRow key={d.id} doc={d} onDownload={handleDownload} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocRow({ doc, onDownload }) {
  const sizeStr = doc.file_size ? (doc.file_size < 1024 * 1024 ? `${(doc.file_size / 1024).toFixed(0)} KB` : `${(doc.file_size / (1024 * 1024)).toFixed(1)} MB`) : "";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.filename}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          {doc.doc_type && doc.doc_type !== "Other" ? doc.doc_type + " · " : ""}
          {sizeStr}{sizeStr ? " · " : ""}{new Date(doc.created_at).toLocaleDateString()}
        </div>
      </div>
      <button onClick={() => onDownload(doc)} style={{
        background: "none", border: "1px solid #e2e8f0", color: "#1e293b", padding: "6px 12px", borderRadius: 6,
        fontSize: 12, cursor: "pointer", whiteSpace: "nowrap"
      }}>Download</button>
    </div>
  );
}
