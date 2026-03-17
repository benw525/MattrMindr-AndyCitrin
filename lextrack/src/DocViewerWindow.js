import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Minus, Download, MonitorPlay, Pencil, FileText, Printer, RefreshCw, LayoutGrid, Briefcase, ChevronRight, User, MapPin, Scale, Calendar, DollarSign, Shield, AlertTriangle } from "lucide-react";

function loadOOScript(url) {
  return new Promise((resolve, reject) => {
    if (window.DocsAPI) return resolve();
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      const check = setInterval(() => {
        if (window.DocsAPI) { clearInterval(check); resolve(); }
      }, 200);
      setTimeout(() => { clearInterval(check); reject(new Error("Script load timeout")); }, 15000);
      return;
    }
    const s = document.createElement("script");
    s.src = url;
    s.async = true;
    s.onload = () => {
      const check = setInterval(() => {
        if (window.DocsAPI) { clearInterval(check); resolve(); }
      }, 200);
      setTimeout(() => { clearInterval(check); reject(new Error("DocsAPI not found after load")); }, 10000);
    };
    s.onerror = () => reject(new Error("Failed to load ONLYOFFICE script"));
    document.head.appendChild(s);
  });
}

function CaseInfoPanel({ caseData, onClose }) {
  if (!caseData) return null;
  const c = caseData;
  const fmt = (v) => v || "—";
  const fmtDate = (v) => v ? new Date(v).toLocaleDateString() : "—";
  const fmtMoney = (v) => v != null && v !== "" ? `$${Number(v).toLocaleString()}` : "—";
  const solDate = c.statute_of_limitations_date ? new Date(c.statute_of_limitations_date) : null;
  const solDays = solDate ? Math.ceil((solDate - new Date()) / 86400000) : null;
  const solUrgent = solDays !== null && solDays < 60;
  const solWarn = solDays !== null && solDays < 180 && !solUrgent;

  const Section = ({ icon: Icon, title, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, paddingBottom: 4, borderBottom: "1px solid var(--c-border, #e2e8f0)" }}>
        <Icon size={13} style={{ color: "#6366f1", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--c-text3, #64748b)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
  const Field = ({ label, value, highlight }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "3px 0", gap: 8 }}>
      <span style={{ fontSize: 11, color: "var(--c-text3, #94a3b8)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: highlight || "var(--c-text, #334155)", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--c-border, #e2e8f0)", background: "var(--c-bg, #fff)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--c-border, #e2e8f0)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Briefcase size={13} style={{ color: "#6366f1" }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text-h, #0f172a)" }}>Case Info</span>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--c-text3, #64748b)", display: "inline-flex" }}><X size={14} /></button>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 12px 20px" }}>
        <div style={{ marginBottom: 12, padding: "8px 10px", background: "var(--c-bg-h, #f8fafc)", borderRadius: 6, border: "1px solid var(--c-border, #e2e8f0)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-text-h, #0f172a)", marginBottom: 2 }}>{fmt(c.title)}</div>
          <div style={{ fontSize: 11, color: "var(--c-text3, #64748b)" }}>{fmt(c.case_num)}</div>
        </div>

        <Section icon={User} title="Client & Parties">
          <Field label="Client" value={fmt(c.client_name)} />
          <Field label="Case Type" value={fmt(c.case_type)} />
          <Field label="Status" value={fmt(c.status)} />
          <Field label="Stage" value={fmt(c.stage)} />
          {c.confidential && <Field label="Confidential" value="Yes" highlight="#dc2626" />}
        </Section>

        <Section icon={Scale} title="Jurisdiction & Court">
          <Field label="State" value={fmt(c.state_jurisdiction)} />
          <Field label="Court" value={fmt(c.court)} />
          <Field label="Judge" value={fmt(c.judge)} />
        </Section>

        <Section icon={Calendar} title="Key Dates">
          <Field label="Accident Date" value={fmtDate(c.accident_date)} />
          <Field label="SOL Date" value={
            solDate ? (
              <span style={{ color: solUrgent ? "#dc2626" : solWarn ? "#d97706" : "var(--c-text, #334155)" }}>
                {fmtDate(c.statute_of_limitations_date)}
                {solDays !== null && ` (${solDays}d)`}
              </span>
            ) : "—"
          } />
          <Field label="Trial Date" value={fmtDate(c.trial_date)} />
          <Field label="Mediation" value={fmtDate(c.mediation_date)} />
        </Section>

        <Section icon={AlertTriangle} title="Injury & Incident">
          <Field label="Injury Type" value={fmt(c.injury_type)} />
          {c.injury_description && <div style={{ fontSize: 11, color: "var(--c-text, #334155)", padding: "4px 0", lineHeight: 1.5 }}>{c.injury_description}</div>}
          <Field label="Location" value={fmt(c.incident_location)} />
          {c.incident_description && <div style={{ fontSize: 11, color: "var(--c-text, #334155)", padding: "4px 0", lineHeight: 1.5 }}>{c.incident_description}</div>}
          <Field label="Police Report #" value={fmt(c.police_report_number)} />
        </Section>

        <Section icon={DollarSign} title="Financials">
          <Field label="Case Value" value={fmtMoney(c.case_value_estimate)} />
          <Field label="Demand" value={fmtMoney(c.demand_amount)} />
          <Field label="Settlement" value={fmtMoney(c.settlement_amount)} />
          <Field label="Property Damage" value={fmtMoney(c.property_damage_amount)} />
          {c.fee_structure && <Field label="Fee Structure" value={fmt(c.fee_structure)} />}
          {c.contingency_fee != null && c.contingency_fee !== "" && <Field label="Contingency Fee" value={`${c.contingency_fee}%`} />}
        </Section>

        <Section icon={Shield} title="Liability">
          <Field label="Assessment" value={fmt(c.liability_assessment)} />
          <Field label="Comp. Fault" value={c.comparative_fault_pct != null && c.comparative_fault_pct !== "" ? `${c.comparative_fault_pct}%` : "—"} />
        </Section>

        <Section icon={User} title="Team">
          <Field label="Lead Attorney" value={fmt(c.lead_attorney_name || c.lead_attorney)} />
          <Field label="2nd Attorney" value={fmt(c.second_attorney_name || c.second_attorney)} />
          <Field label="Paralegal" value={fmt(c.paralegal_name || c.paralegal)} />
          <Field label="Case Manager" value={fmt(c.case_manager_name || c.case_manager)} />
          <Field label="Investigator" value={fmt(c.investigator_name || c.investigator)} />
        </Section>
      </div>
    </div>
  );
}

export default function DocViewerWindow({
  viewer,
  zIndex,
  ooStatus,
  msStatus,
  allCases,
  onClose,
  onMinimize,
  onBringToFront,
  onPositionChange,
  onSizeChange,
  onViewerUpdate,
}) {
  const [officeViewMode, setOfficeViewMode] = useState(!!viewer.officeViewUrl);
  const [officeFailed, setOfficeFailed] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [ooEditMode, setOoEditMode] = useState(false);
  const [ooEditData, setOoEditData] = useState(null);
  const [ooSyncing, setOoSyncing] = useState(false);
  const [showCasePanel, setShowCasePanel] = useState(false);
  const [ooViewMode, setOoViewMode] = useState(!!viewer.ooViewConfig);
  const [ooViewFailed, setOoViewFailed] = useState(false);

  const caseData = useMemo(() => {
    if (viewer.caseId == null || !allCases) return null;
    return allCases.find(c => String(c.id) === String(viewer.caseId)) || null;
  }, [viewer.caseId, allCases]);
  const ooEditorRef = useRef(null);
  const ooContainerRef = useRef(null);
  const ooViewContainerRef = useRef(null);
  const ooViewerRef = useRef(null);
  const officeTimerRef = useRef(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, ex: 0, ey: 0 });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  useEffect(() => {
    if (viewer.officeViewUrl && officeViewMode === false) {
      setOfficeViewMode(true);
    }
  }, [viewer.officeViewUrl]);

  useEffect(() => {
    return () => {
      if (ooEditorRef.current) {
        try { ooEditorRef.current.destroyEditor(); } catch {}
        ooEditorRef.current = null;
      }
      if (ooViewerRef.current) {
        try { ooViewerRef.current.destroyEditor(); } catch {}
        ooViewerRef.current = null;
      }
    };
  }, []);

  const initOOViewer = useCallback(async (editorUrl, editorConfig) => {
    try {
      await loadOOScript(editorUrl);

      if (ooViewerRef.current) {
        try { ooViewerRef.current.destroyEditor(); } catch {}
        ooViewerRef.current = null;
      }

      const containerId = "oo-viewer-container";
      const container = ooViewContainerRef.current;
      if (container) {
        container.innerHTML = "";
        const viewDiv = document.createElement("div");
        viewDiv.id = containerId;
        viewDiv.style.width = "100%";
        viewDiv.style.height = "100%";
        container.appendChild(viewDiv);
      }

      await new Promise(r => setTimeout(r, 100));

      const config = {
        document: editorConfig.document,
        documentType: editorConfig.documentType,
        editorConfig: {
          ...editorConfig.editorConfig,
          mode: "view",
          customization: {
            ...(editorConfig.editorConfig?.customization || {}),
            compactHeader: true,
            toolbarNoTabs: true,
            toolbarHideFileName: true,
          },
        },
        token: editorConfig.token,
        type: "embedded",
        width: "100%",
        height: "100%",
        events: {
          onReady: () => {
            console.log("ONLYOFFICE viewer ready");
          },
          onError: (e) => {
            console.error("ONLYOFFICE viewer error:", e);
            setOoViewFailed(true);
            setOoViewMode(false);
          },
        },
      };

      ooViewerRef.current = new window.DocsAPI.DocEditor(containerId, config);
    } catch (err) {
      console.error("Failed to init ONLYOFFICE viewer:", err);
      setOoViewFailed(true);
      setOoViewMode(false);
    }
  }, []);

  useEffect(() => {
    if (ooViewMode && viewer.ooViewConfig && !ooEditMode) {
      initOOViewer(viewer.ooViewConfig.editorUrl, viewer.ooViewConfig.editorConfig);
    }
  }, [ooViewMode, viewer.ooViewConfig, ooEditMode, initOOViewer]);

  const initOOEditor = useCallback(async (editorUrl, editorConfig) => {
    try {
      await loadOOScript(editorUrl);

      if (ooEditorRef.current) {
        try { ooEditorRef.current.destroyEditor(); } catch {}
        ooEditorRef.current = null;
      }

      const containerId = "oo-editor-container";
      const container = ooContainerRef.current;
      if (container) {
        container.innerHTML = "";
        const editorDiv = document.createElement("div");
        editorDiv.id = containerId;
        editorDiv.style.width = "100%";
        editorDiv.style.height = "100%";
        container.appendChild(editorDiv);
      }

      await new Promise(r => setTimeout(r, 100));

      const config = {
        document: editorConfig.document,
        documentType: editorConfig.documentType,
        editorConfig: {
          ...editorConfig.editorConfig,
          mode: "edit",
          customization: {
            ...(editorConfig.editorConfig?.customization || {}),
            forcesave: true,
            compactHeader: true,
            toolbarNoTabs: false,
          },
        },
        token: editorConfig.token,
        type: "desktop",
        width: "100%",
        height: "100%",
        events: {
          onReady: () => {
            console.log("ONLYOFFICE editor ready");
          },
          onError: (e) => {
            console.error("ONLYOFFICE editor error:", e);
          },
        },
      };

      ooEditorRef.current = new window.DocsAPI.DocEditor(containerId, config);
    } catch (err) {
      console.error("Failed to init ONLYOFFICE editor:", err);
      alert("Failed to open editor: " + err.message);
      setOoEditMode(false);
      setOoEditData(null);
    }
  }, []);

  const handleDragStart = (e) => {
    if (isMobile) return;
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select")) return;
    e.preventDefault();
    const el = e.currentTarget.closest("[data-docviewer-window]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    draggingRef.current = true;
    dragStartRef.current = { mx: e.clientX, my: e.clientY, ex: rect.left, ey: rect.top };
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";

    const onMove = (ev) => {
      if (!draggingRef.current) return;
      ev.preventDefault();
      const dx = ev.clientX - dragStartRef.current.mx;
      const dy = ev.clientY - dragStartRef.current.my;
      onPositionChange({ x: dragStartRef.current.ex + dx, y: dragStartRef.current.ey + dy });
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleResizeStart = (e) => {
    if (isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget.closest("[data-docviewer-window]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    const startX = e.clientX, startY = e.clientY;
    const startW = rect.width, startH = rect.height;

    const onMove = (ev) => {
      ev.preventDefault();
      const nw = Math.max(480, startW + (ev.clientX - startX));
      const nh = Math.max(320, startH + (ev.clientY - startY));
      onSizeChange({ width: nw, height: nh });
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handlePresent = () => {
    const t = getViewerType();
    const pw = window.open("", "_blank", "width=1280,height=720,menubar=no,toolbar=no,location=no,status=no");
    if (!pw) return;

    const themeCSS = `
.theme-bar{position:fixed;top:12px;right:16px;display:flex;gap:4px;z-index:9999;}
.theme-btn{padding:4px 14px;font-size:12px;font-weight:500;border:1px solid #94a3b8;border-radius:6px;cursor:pointer;font-family:inherit;transition:all 0.2s;}
body.dark .theme-btn{background:transparent;color:#94a3b8;border-color:#475569;}
body.dark .theme-btn.active{background:#334155;color:#f8fafc;border-color:#6366f1;}
body.light .theme-btn{background:transparent;color:#64748b;border-color:#cbd5e1;}
body.light .theme-btn.active{background:#e0e7ff;color:#3730a3;border-color:#6366f1;}`;
    const themeBar = `<div class="theme-bar"><button class="theme-btn active" id="darkBtn" onclick="setTheme('dark')">Dark</button><button class="theme-btn" id="lightBtn" onclick="setTheme('light')">Light</button></div>`;
    const themeScript = `<script>function setTheme(t){document.body.className=t;document.getElementById('darkBtn').className='theme-btn'+(t==='dark'?' active':'');document.getElementById('lightBtn').className='theme-btn'+(t==='light'?' active':'');}document.addEventListener("keydown",function(e){if(e.key==="Escape")window.close();});<\/script>`;

    if (viewer.officeViewUrl && officeViewMode && (t === "docx" || t === "xlsx" || t === "pptx")) {
      pw.document.write(`<!DOCTYPE html><html><head><title>Presenting: ${viewer.filename}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{display:flex;flex-direction:column;height:100vh;overflow:hidden;transition:background 0.3s;}body.dark{background:#000;}body.light{background:#f1f5f9;}#viewer{flex:1;border:none;width:100%;height:100%;}${themeCSS}</style></head><body class="dark">${themeBar}<iframe id="viewer" src="${viewer.officeViewUrl}" allowfullscreen></iframe>${themeScript}</body></html>`);
      pw.document.close();
      return;
    }

    if (t === "pdf") {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>*{margin:0;padding:0;}body{height:100vh;display:flex;justify-content:center;align-items:center;transition:background 0.3s;}body.dark{background:#000;}body.light{background:#f1f5f9;}${themeCSS}</style></head><body class="dark">${themeBar}<embed src="${viewer.blobUrl}#toolbar=0&navpanes=0" type="application/pdf" width="100%" height="100%"/>${themeScript}</body></html>`);
    } else if (t === "image") {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>*{margin:0;}body{height:100vh;display:flex;justify-content:center;align-items:center;transition:background 0.3s;}body.dark{background:#000;}body.light{background:#f1f5f9;}${themeCSS}</style></head><body class="dark">${themeBar}<img src="${viewer.blobUrl}" style="max-width:100%;max-height:100vh;object-fit:contain;"/>${themeScript}</body></html>`);
    } else if (t === "video") {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>*{margin:0;}body{height:100vh;display:flex;justify-content:center;align-items:center;transition:background 0.3s;}body.dark{background:#000;}body.light{background:#f1f5f9;}${themeCSS}</style></head><body class="dark">${themeBar}<video src="${viewer.blobUrl}" controls autoplay style="max-width:100%;max-height:100vh;"/>${themeScript}</body></html>`);
    } else if (t === "docx" && viewer.docxHtml) {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>body{min-height:100vh;display:flex;justify-content:center;padding:40px 20px;transition:background 0.3s;}body.dark{background:#1e293b;}body.light{background:#f1f5f9;}#doc{background:#fff;max-width:850px;width:100%;padding:64px 72px;font-family:'Times New Roman',Georgia,serif;font-size:15px;line-height:1.8;color:#1e293b;border-radius:8px;}${themeCSS}</style></head><body class="dark">${themeBar}<div id="doc">${viewer.docxHtml}</div>${themeScript}</body></html>`);
    } else {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>body{display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;transition:background 0.3s,color 0.3s;}body.dark{background:#1e293b;color:#fff;}body.light{background:#f1f5f9;color:#1e293b;}${themeCSS}</style></head><body class="dark">${themeBar}<div>Preview not available for presentation.</div>${themeScript}</body></html>`);
    }
    pw.document.close();
  };

  const getViewerType = () => {
    const ct = viewer.type || "";
    const ext = (viewer.filename || "").split(".").pop().toLowerCase();
    if (ct.includes("wordprocessingml") || ext === "docx" || ext === "doc") return "docx";
    if (ct.includes("spreadsheetml") || ext === "xlsx" || ext === "xls") return "xlsx";
    if (ct.includes("presentationml") || ext === "pptx" || ext === "ppt") return "pptx";
    if (ct === "application/pdf" || ext === "pdf") return "pdf";
    if (ct.startsWith("image/")) return "image";
    if (ct.startsWith("video/")) return "video";
    if (ct.startsWith("audio/")) return "audio";
    if (ct.startsWith("text/")) return "text";
    return "unknown";
  };

  const vType = getViewerType();
  const isOfficeType = vType === "docx" || vType === "xlsx" || vType === "pptx";
  const canEdit = isOfficeType && viewer.docId && (ooStatus && ooStatus.available);

  const handleEdit = async () => {
    if (!viewer.docId) return;
    setEditLoading(true);
    try {
      const { apiOnlyofficeUploadForEdit } = await import("./api");
      const upRes = await apiOnlyofficeUploadForEdit(viewer.docId);
      if (upRes.editorUrl && upRes.editorConfig && upRes.fileId) {
        if (ooViewerRef.current) {
          try { ooViewerRef.current.destroyEditor(); } catch {}
          ooViewerRef.current = null;
        }
        setOoViewMode(false);
        setOoEditData({ docId: viewer.docId, fileId: upRes.fileId, editorUrl: upRes.editorUrl, editorConfig: upRes.editorConfig });
        setOoEditMode(true);
        setTimeout(() => {
          initOOEditor(upRes.editorUrl, upRes.editorConfig);
        }, 200);
      } else {
        throw new Error("ONLYOFFICE editor configuration not available");
      }
    } catch (err) {
      console.error("Edit error:", err);
      alert("Failed to open editor: " + err.message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleOOSaveAndClose = async () => {
    if (!ooEditData) return;
    setOoSyncing(true);
    try {
      const { apiOnlyofficeSyncBack, apiOnlyofficeCleanup } = await import("./api");
      await apiOnlyofficeSyncBack(ooEditData.docId, ooEditData.fileId);
      if (onViewerUpdate) onViewerUpdate(ooEditData.docId);
      try { await apiOnlyofficeCleanup(ooEditData.fileId); } catch {}
      if (ooEditorRef.current) {
        try { ooEditorRef.current.destroyEditor(); } catch {}
        ooEditorRef.current = null;
      }
      setOoEditMode(false);
      setOoEditData(null);
    } catch (e) {
      console.error("Sync-back error:", e);
      alert("Failed to save changes: " + e.message + "\n\nYour edits are still open. Try again or discard.");
    } finally {
      setOoSyncing(false);
    }
  };

  const handleOODiscard = async () => {
    if (!ooEditData) return;
    try {
      const { apiOnlyofficeCleanup } = await import("./api");
      try { await apiOnlyofficeCleanup(ooEditData.fileId); } catch {}
    } catch {}
    if (ooEditorRef.current) {
      try { ooEditorRef.current.destroyEditor(); } catch {}
      ooEditorRef.current = null;
    }
    setOoEditMode(false);
    setOoEditData(null);
  };

  const btnStyle = { padding: "3px 8px", background: "transparent", border: "1px solid var(--c-border, #cbd5e1)", borderRadius: 4, cursor: "pointer", color: "var(--c-text3, #64748b)", display: "inline-flex", alignItems: "center" };

  const containerStyle = isMobile
    ? { position: "fixed", inset: 0, zIndex: 10002, display: "flex", flexDirection: "column", background: "var(--c-bg, #fff)", overflow: "hidden" }
    : {
        position: "fixed",
        top: viewer.position?.y ?? 60,
        left: viewer.position?.x ?? 80,
        width: viewer.size?.width ?? "80vw",
        height: viewer.size?.height ?? "80vh",
        maxWidth: "95vw",
        maxHeight: "90vh",
        minWidth: 480,
        minHeight: 320,
        zIndex,
        display: "flex",
        flexDirection: "column",
        background: "var(--c-bg, #fff)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)",
        border: "1px solid var(--c-border, #e2e8f0)",
        overflow: "hidden",
      };

  const handleOfficeIframeError = () => {
    setOfficeFailed(true);
    setOfficeViewMode(false);
  };

  useEffect(() => {
    if (officeViewMode && viewer.officeViewUrl && isOfficeType && !officeFailed) {
      officeTimerRef.current = setTimeout(() => {
        setOfficeFailed(true);
        setOfficeViewMode(false);
      }, 8000);
    }
    return () => { if (officeTimerRef.current) clearTimeout(officeTimerRef.current); };
  }, [officeViewMode, viewer.officeViewUrl, isOfficeType, officeFailed]);

  const handleOfficeLoad = () => {
    if (officeTimerRef.current) clearTimeout(officeTimerRef.current);
  };

  const renderContent = () => {
    if (ooEditMode) {
      return (
        <div ref={ooContainerRef} style={{ width: "100%", height: "100%", background: "#fff" }} />
      );
    }

    if (ooViewMode && viewer.ooViewConfig && isOfficeType && !ooViewFailed) {
      return (
        <div ref={ooViewContainerRef} style={{ width: "100%", height: "100%", background: "#fff" }} />
      );
    }

    if (officeViewMode && viewer.officeViewUrl && isOfficeType && !officeFailed) {
      return <iframe src={viewer.officeViewUrl} onLoad={handleOfficeLoad} onError={handleOfficeIframeError} style={{ width: "100%", height: "100%", border: "none" }} title="Office Viewer" />;
    }

    if ((officeFailed || ooViewFailed) && isOfficeType) {
      return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "6px 12px", background: "#fef3c7", color: "#92400e", fontSize: 11, textAlign: "center", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span>Office Online preview unavailable — showing built-in viewer</span>
            <button onClick={() => { setOfficeFailed(false); setOfficeViewMode(true); }} style={{ fontSize: 10, padding: "2px 8px", background: "#fbbf24", color: "#78350f", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600 }}>Retry</button>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>{renderBuiltInContent()}</div>
        </div>
      );
    }

    return renderBuiltInContent();
  };

  const renderBuiltInContent = () => {
    if (viewer.docxHtml !== null && viewer.docxHtml !== undefined) {
      return <div style={{ padding: 32, background: "#fff", color: "#1e293b", minHeight: "100%", fontSize: 14, lineHeight: 1.7, fontFamily: "Georgia, serif" }} dangerouslySetInnerHTML={{ __html: viewer.docxHtml }} />;
    }
    if (viewer.xlsxData !== null && viewer.xlsxData !== undefined) {
      return (
        <div style={{ padding: 16, background: "#fff", color: "#1e293b", overflow: "auto", height: "100%" }}>
          {(viewer.xlsxData || []).map((sheet, si) => (
            <div key={si} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 8, padding: "4px 0", borderBottom: "2px solid #6366f1" }}>{sheet.name}</div>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <tbody>
                  {(sheet.rows || []).map((row, ri) => (
                    <tr key={ri} style={{ background: ri === 0 ? "#f1f5f9" : ri % 2 === 0 ? "#fafafa" : "#fff" }}>
                      {(row || []).map((cell, ci) => (
                        <td key={ci} style={{ border: "1px solid #e2e8f0", padding: "4px 8px", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", fontWeight: ri === 0 ? 600 : 400 }}>{cell != null ? String(cell) : ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      );
    }
    if (viewer.pptxSlides !== null && viewer.pptxSlides !== undefined) {
      return (
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
          {(viewer.pptxSlides || []).map((slide, si) => (
            <div key={si} style={{ background: "#fff", borderRadius: 8, width: "100%", maxWidth: 800, minHeight: 200, padding: 24, position: "relative", boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
              <div style={{ position: "absolute", top: 8, right: 12, fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>Slide {si + 1}</div>
              {(slide.texts || []).map((t, ti) => (
                <div key={ti} style={{ fontSize: t.fontSize || 14, fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? "italic" : "normal", color: t.color || "#1e293b", marginBottom: 8 }}>{t.text}</div>
              ))}
              {(!slide.texts || slide.texts.length === 0) && <div style={{ color: "#94a3b8", fontStyle: "italic" }}>Empty slide</div>}
            </div>
          ))}
        </div>
      );
    }
    if (vType === "image") {
      return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><img src={viewer.blobUrl} alt={viewer.filename} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>;
    }
    if (vType === "pdf") {
      return <iframe src={viewer.blobUrl} title={viewer.filename} style={{ width: "100%", height: "100%", border: "none" }} />;
    }
    if (vType === "text") {
      return <iframe src={viewer.blobUrl} title={viewer.filename} style={{ width: "100%", height: "100%", border: "none", background: "#fff" }} />;
    }
    if (vType === "audio") {
      return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 12 }}><div style={{ fontSize: 48 }}>🔊</div><audio controls src={viewer.blobUrl} style={{ width: "80%", maxWidth: 500 }} /></div>;
    }
    if (vType === "video") {
      return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><video controls src={viewer.blobUrl} style={{ maxWidth: "100%", maxHeight: "100%" }} /></div>;
    }
    return (
      <div style={{ color: "#64748b", fontSize: 14, textAlign: "center", padding: 40, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📄</div>
        <div>Preview not available for this file type.</div>
        {viewer.blobUrl && <div style={{ marginTop: 8 }}><a href={viewer.blobUrl} download={viewer.filename} style={{ color: "#6366f1", textDecoration: "underline", fontSize: 14 }}>Download to view</a></div>}
      </div>
    );
  };

  return (
    <div data-docviewer-window onClick={onBringToFront} style={containerStyle}>
      <div style={{ flexShrink: 0 }}>
        <div onMouseDown={handleDragStart} style={{ display: "flex", alignItems: "center", padding: "6px 12px", borderBottom: ooEditMode ? "none" : "1px solid var(--c-border, #e2e8f0)", background: "var(--c-bg, #fff)", cursor: isMobile ? "default" : "move", userSelect: "none", gap: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <FileText size={15} style={{ color: "#64748b", flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--c-text-h, #0f172a)" }}>
              {viewer.filename || "Document"}
            </span>
            {!ooEditMode && isOfficeType && (ooViewMode || (viewer.officeViewUrl && !officeFailed)) && (
              <>
                <span style={{ padding: "1px 8px", fontSize: 10, fontWeight: 700, borderRadius: 4, background: (ooViewMode || officeViewMode) ? "#059669" : "#e2e8f0", color: (ooViewMode || officeViewMode) ? "#fff" : "#64748b", letterSpacing: "0.02em" }}>Office</span>
                <span style={{ padding: "1px 8px", fontSize: 10, fontWeight: 700, borderRadius: 4, background: !(ooViewMode || officeViewMode) ? "#64748b" : "#e2e8f0", color: !(ooViewMode || officeViewMode) ? "#fff" : "#94a3b8", letterSpacing: "0.02em" }}>Built-in</span>
              </>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {!ooEditMode && (
              <>
                {canEdit && (
                  <button onClick={(e) => { e.stopPropagation(); handleEdit(); }} style={{ padding: "4px 12px", background: "#059669", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }} title="Edit with ONLYOFFICE" disabled={editLoading}>
                    <Pencil size={12} /> Edit
                  </button>
                )}

                <div style={{ width: 1, height: 18, background: "var(--c-border, #e2e8f0)", margin: "0 4px" }} />
              </>
            )}

            {viewer.blobUrl && (
              <a href={viewer.blobUrl} download={viewer.filename} onClick={e => e.stopPropagation()} style={{ ...btnStyle, textDecoration: "none" }} title="Download"><Download size={14} /></a>
            )}

            <button onClick={(e) => { e.stopPropagation(); if (viewer.blobUrl) { const pw = window.open("", "_blank"); pw.document.write(`<html><head><title>Print: ${viewer.filename}</title></head><body onload="window.print()"><embed src="${viewer.blobUrl}" width="100%" height="100%" type="${viewer.type || 'application/pdf'}"/></body></html>`); pw.document.close(); }}} title="Print" style={btnStyle}><Printer size={14} /></button>

            <button onClick={(e) => { e.stopPropagation(); handlePresent(); }} title="Present" style={btnStyle}><MonitorPlay size={14} /></button>

            {isOfficeType && !ooEditMode && (ooViewMode || (viewer.officeViewUrl && !officeFailed)) && (
              <button onClick={(e) => {
                e.stopPropagation();
                if (ooViewMode) {
                  if (ooViewerRef.current) { try { ooViewerRef.current.destroyEditor(); } catch {} ooViewerRef.current = null; }
                  setOoViewMode(false);
                } else if (viewer.ooViewConfig && !ooViewFailed) {
                  setOoViewMode(true);
                } else if (viewer.officeViewUrl) {
                  setOfficeViewMode(!officeViewMode);
                }
              }} title={(ooViewMode || officeViewMode) ? "Switch to Built-in viewer" : "Switch to Office viewer"} style={btnStyle}><RefreshCw size={14} /></button>
            )}

            <button onClick={(e) => { e.stopPropagation(); if (viewer.docId && onViewerUpdate) onViewerUpdate(viewer.docId); }} title="Reload content" style={btnStyle}><LayoutGrid size={14} /></button>

            {caseData && !isMobile && (
              <button onClick={(e) => { e.stopPropagation(); setShowCasePanel(p => !p); }} title={showCasePanel ? "Hide case info" : "Show case info"} style={{ ...btnStyle, background: showCasePanel ? "#eef2ff" : "transparent", color: showCasePanel ? "#6366f1" : "var(--c-text3, #64748b)", borderColor: showCasePanel ? "#a5b4fc" : "var(--c-border, #cbd5e1)" }}><Briefcase size={14} /></button>
            )}

            <div style={{ width: 1, height: 18, background: "var(--c-border, #e2e8f0)", margin: "0 4px" }} />

            {!isMobile && <button onClick={(e) => { e.stopPropagation(); onMinimize(); }} title="Minimize" style={btnStyle}><Minus size={14} /></button>}
            <button onClick={(e) => { e.stopPropagation(); if (ooEditMode) { handleOODiscard(); } onClose(); }} title="Close" style={btnStyle}><X size={14} /></button>
          </div>
        </div>

        {ooEditMode && (
          <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", borderBottom: "2px solid #059669", background: "var(--c-bg, #fff)" }}>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#059669" }}>Editing</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleOOSaveAndClose} disabled={ooSyncing} style={{ padding: "5px 16px", background: "#059669", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, opacity: ooSyncing ? 0.6 : 1 }} title="Save changes back to case">
                {ooSyncing ? "Saving..." : "Save"}
              </button>
              <button onClick={handleOODiscard} disabled={ooSyncing} style={{ padding: "5px 16px", background: "transparent", color: "var(--c-text, #334155)", border: "1px solid var(--c-border, #cbd5e1)", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 500 }} title="Discard changes">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        <div style={{ flex: 1, overflow: "auto", background: "#1F2428" }}>
          {renderContent()}
        </div>
        {showCasePanel && caseData && !isMobile && (
          <CaseInfoPanel caseData={caseData} onClose={() => setShowCasePanel(false)} />
        )}
      </div>

      {!isMobile && (
        <div onMouseDown={handleResizeStart} style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 1 }} />
      )}
    </div>
  );
}
