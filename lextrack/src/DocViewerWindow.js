import { useState, useRef, useEffect } from "react";
import { X, Minus, Download, MonitorPlay, Pencil } from "lucide-react";

export default function DocViewerWindow({
  viewer,
  zIndex,
  ooStatus,
  msStatus,
  onClose,
  onMinimize,
  onBringToFront,
  onPositionChange,
  onSizeChange,
  onViewerUpdate,
}) {
  const [officeViewMode, setOfficeViewMode] = useState(!!viewer.officeViewUrl);
  const [officeFailed, setOfficeFailed] = useState(false);
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const officeTimerRef = useRef(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, ex: 0, ey: 0 });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  useEffect(() => {
    if (viewer.officeViewUrl && officeViewMode === false) {
      setOfficeViewMode(true);
    }
  }, [viewer.officeViewUrl]);

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

    if (viewer.officeViewUrl && officeViewMode && (t === "docx" || t === "xlsx" || t === "pptx")) {
      pw.document.write(`<!DOCTYPE html><html><head><title>Presenting: ${viewer.filename}</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#000;display:flex;flex-direction:column;height:100vh;overflow:hidden;}#viewer{flex:1;border:none;width:100%;height:100%;}</style></head><body><iframe id="viewer" src="${viewer.officeViewUrl}" allowfullscreen></iframe><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script></body></html>`);
      pw.document.close();
      return;
    }

    if (t === "pdf") {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>*{margin:0;padding:0;}body{background:#000;height:100vh;display:flex;justify-content:center;align-items:center;}</style></head><body><embed src="${viewer.blobUrl}#toolbar=0&navpanes=0" type="application/pdf" width="100%" height="100%"/><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script></body></html>`);
    } else if (t === "image") {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>*{margin:0;}body{background:#000;height:100vh;display:flex;justify-content:center;align-items:center;}</style></head><body><img src="${viewer.blobUrl}" style="max-width:100%;max-height:100vh;object-fit:contain;"/><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script></body></html>`);
    } else if (t === "video") {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>*{margin:0;}body{background:#000;height:100vh;display:flex;justify-content:center;align-items:center;}</style></head><body><video src="${viewer.blobUrl}" controls autoplay style="max-width:100%;max-height:100vh;"/><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script></body></html>`);
    } else if (t === "docx" && viewer.docxHtml) {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>body{background:#1e293b;min-height:100vh;display:flex;justify-content:center;padding:40px 20px;}#doc{background:#fff;max-width:850px;width:100%;padding:64px 72px;font-family:'Times New Roman',Georgia,serif;font-size:15px;line-height:1.8;color:#1e293b;border-radius:8px;}</style></head><body><div id="doc">${viewer.docxHtml}</div><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script></body></html>`);
    } else {
      pw.document.write(`<!DOCTYPE html><html><head><title>${viewer.filename}</title><style>body{background:#1e293b;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;}</style></head><body><div>Preview not available for presentation.</div><script>document.addEventListener("keydown",e=>{if(e.key==="Escape")window.close();});<\/script></body></html>`);
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
  const canEdit = isOfficeType && viewer.docId && ((msStatus && msStatus.connected) || (ooStatus && ooStatus.available));

  const handleEditWith = async (provider) => {
    setEditMenuOpen(false);
    if (!viewer.docId) return;
    setEditLoading(true);
    try {
      const { apiMsUploadForEdit, apiMsSyncBack, apiMsCleanup, apiOnlyofficeUploadForEdit, apiOnlyofficeSyncBack, apiOnlyofficeCleanup } = await import("./api");
      if (provider === "microsoft") {
        const upRes = await apiMsUploadForEdit(viewer.docId);
        if (upRes.editUrl && upRes.driveItemId) {
          const editWin = window.open(upRes.editUrl, "_blank");
          const checkClosed = setInterval(async () => {
            if (editWin && editWin.closed) {
              clearInterval(checkClosed);
              try {
                await apiMsSyncBack(viewer.docId, upRes.driveItemId);
                if (onViewerUpdate) onViewerUpdate(viewer.docId);
              } catch (e) { console.error("Sync-back error:", e); }
              try { await apiMsCleanup(upRes.driveItemId); } catch {}
            }
          }, 1500);
        }
      } else if (provider === "onlyoffice") {
        const upRes = await apiOnlyofficeUploadForEdit(viewer.docId);
        if (upRes.editUrl && upRes.fileId) {
          const editWin = window.open(upRes.editUrl, "_blank");
          const checkClosed = setInterval(async () => {
            if (editWin && editWin.closed) {
              clearInterval(checkClosed);
              try {
                await apiOnlyofficeSyncBack(viewer.docId, upRes.fileId);
                if (onViewerUpdate) onViewerUpdate(viewer.docId);
              } catch (e) { console.error("Sync-back error:", e); }
              try { await apiOnlyofficeCleanup(upRes.fileId); } catch {}
            }
          }, 1500);
        }
      }
    } catch (err) {
      console.error("Edit error:", err);
    } finally {
      setEditLoading(false);
    }
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
    if (officeViewMode && viewer.officeViewUrl && isOfficeType && !officeFailed) {
      return <iframe src={viewer.officeViewUrl} onLoad={handleOfficeLoad} onError={handleOfficeIframeError} style={{ width: "100%", height: "100%", border: "none" }} title="Office Viewer" />;
    }

    if (officeFailed && isOfficeType) {
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
      <div onMouseDown={handleDragStart} style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--c-border, #e2e8f0)", cursor: isMobile ? "default" : "move", flexShrink: 0, userSelect: "none", gap: 8 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--c-text-h, #0f172a)" }}>
          {viewer.filename || "Document"}
        </span>

        {viewer.officeViewUrl && isOfficeType && !officeFailed && (
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid var(--c-border, #e2e8f0)" }}>
            <button onClick={(e) => { e.stopPropagation(); setOfficeViewMode(true); }} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, background: officeViewMode ? "#6366f1" : "transparent", color: officeViewMode ? "#fff" : "var(--c-text3, #64748b)", border: "none", cursor: "pointer" }}>Office</button>
            <button onClick={(e) => { e.stopPropagation(); setOfficeViewMode(false); }} style={{ padding: "2px 8px", fontSize: 10, fontWeight: 600, background: !officeViewMode ? "#6366f1" : "transparent", color: !officeViewMode ? "#fff" : "var(--c-text3, #64748b)", border: "none", cursor: "pointer" }}>Built-in</button>
          </div>
        )}

        <button onClick={(e) => { e.stopPropagation(); handlePresent(); }} title="Present" style={btnStyle}><MonitorPlay size={13} /></button>

        {canEdit && (
          <div style={{ position: "relative" }}>
            <button onClick={(e) => { e.stopPropagation(); setEditMenuOpen(!editMenuOpen); }} title="Edit document" style={{ ...btnStyle, color: editLoading ? "#6366f1" : btnStyle.color }} disabled={editLoading}>
              <Pencil size={13} />
            </button>
            {editMenuOpen && (
              <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "var(--c-bg, #fff)", border: "1px solid var(--c-border, #e2e8f0)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 100, minWidth: 160, overflow: "hidden" }}>
                {msStatus && msStatus.connected && (
                  <button onClick={(e) => { e.stopPropagation(); handleEditWith("microsoft"); }} style={{ display: "block", width: "100%", padding: "8px 12px", background: "transparent", border: "none", textAlign: "left", cursor: "pointer", fontSize: 12, color: "var(--c-text, #334155)" }} onMouseEnter={e => e.target.style.background = "var(--c-bg-h, #f1f5f9)"} onMouseLeave={e => e.target.style.background = "transparent"}>
                    Edit with Microsoft 365
                  </button>
                )}
                {ooStatus && ooStatus.available && (
                  <button onClick={(e) => { e.stopPropagation(); handleEditWith("onlyoffice"); }} style={{ display: "block", width: "100%", padding: "8px 12px", background: "transparent", border: "none", textAlign: "left", cursor: "pointer", fontSize: 12, color: "var(--c-text, #334155)" }} onMouseEnter={e => e.target.style.background = "var(--c-bg-h, #f1f5f9)"} onMouseLeave={e => e.target.style.background = "transparent"}>
                    Edit with ONLYOFFICE
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {viewer.blobUrl && (
          <a href={viewer.blobUrl} download={viewer.filename} onClick={e => e.stopPropagation()} style={{ ...btnStyle, textDecoration: "none" }} title="Download"><Download size={13} /></a>
        )}

        {!isMobile && <button onClick={(e) => { e.stopPropagation(); onMinimize(); }} title="Minimize" style={btnStyle}><Minus size={13} /></button>}
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close" style={btnStyle}><X size={13} /></button>
      </div>

      <div style={{ flex: 1, overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", overflow: "auto", background: "#1F2428" }}>
          {renderContent()}
        </div>
      </div>

      {!isMobile && (
        <div onMouseDown={handleResizeStart} style={{ position: "absolute", bottom: 0, right: 0, width: 16, height: 16, cursor: "nwse-resize", zIndex: 1 }} />
      )}
    </div>
  );
}
