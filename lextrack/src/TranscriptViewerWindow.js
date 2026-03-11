import { useState, useRef, useEffect, useCallback } from "react";
import { X, Minus, Download, FileText, ChevronDown, Pencil, Loader2, RotateCcw, Eye, Check, Merge, Sparkles, ChevronRight, Scale, FileAudio, SkipBack, SkipForward, Play, Pause, Volume2 } from "lucide-react";

export default function TranscriptViewerWindow({
  viewer,
  zIndex,
  onClose,
  onMinimize,
  onBringToFront,
  onPositionChange,
  onSizeChange,
  onSave,
  onTranscriptEditsChange,
  apiDownloadTranscriptAudio,
  apiExportTranscript,
  apiGetTranscriptHistory,
  apiSaveTranscriptHistory,
  apiUpdateTranscript,
  apiRevertTranscript,
  apiGetTranscriptDetail,
  ScribeTranscriptButtons,
}) {
  const [transcriptEdits, setTranscriptEdits] = useState(viewer.transcriptEdits || []);
  const [editingSpeaker, setEditingSpeaker] = useState(null);
  const [editingSegmentIdx, setEditingSegmentIdx] = useState(null);
  const [selectedSegments, setSelectedSegments] = useState(new Set());
  const [mergeUndoStack, setMergeUndoStack] = useState([]);
  const [transcriptSaving, setTranscriptSaving] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState(null);
  const [showTranscriptHistory, setShowTranscriptHistory] = useState(false);
  const [transcriptHistory, setTranscriptHistory] = useState([]);
  const [transcriptHistoryLoading, setTranscriptHistoryLoading] = useState(false);
  const [revertingHistoryId, setRevertingHistoryId] = useState(null);
  const [transcriptReadingView, setTranscriptReadingView] = useState(false);
  const [exportDropdownId, setExportDropdownId] = useState(false);
  const [showSummaries, setShowSummaries] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(viewer.durationSeconds || 0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef(null);
  const progressRef = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0, ex: 0, ey: 0 });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  useEffect(() => {
    if (viewer.transcriptEdits && JSON.stringify(viewer.transcriptEdits) !== JSON.stringify(transcriptEdits)) {
      setTranscriptEdits(viewer.transcriptEdits);
    }
  }, [viewer.transcriptEdits]);

  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (!viewer.transcriptDetail || !transcriptEdits.length) return;
    if (JSON.stringify(transcriptEdits) === JSON.stringify(viewer.transcriptDetail.transcript)) return;
    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus("saving");
      try {
        const prevState = viewer.transcriptDetail.transcript;
        await apiUpdateTranscript(viewer.transcriptId, { transcript: transcriptEdits });
        if (onTranscriptEditsChange) onTranscriptEditsChange(transcriptEdits);
        apiSaveTranscriptHistory(viewer.transcriptId, { changeType: "edit", changeDescription: "Auto-save edit", previousState: prevState }).catch(() => {});
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus(null), 2000);
      } catch {
        setAutoSaveStatus(null);
      }
    }, 3000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [transcriptEdits]);

  const handleDragStart = (e) => {
    if (isMobile) return;
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest("select") || e.target.closest("textarea")) return;
    e.preventDefault();
    const el = e.currentTarget.closest("[data-transcript-window]");
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
    const el = e.currentTarget.closest("[data-transcript-window]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
    const startX = e.clientX, startY = e.clientY;
    const startW = rect.width, startH = rect.height;
    const onMove = (ev) => {
      ev.preventDefault();
      const nw = Math.max(480, startW + (ev.clientX - startX));
      const nh = Math.max(400, startH + (ev.clientY - startY));
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

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); }
    else { audioRef.current.play().catch(() => {}); }
    setIsPlaying(!isPlaying);
  };

  const skipBack = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
  };

  const skipForward = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5);
  };

  const handleProgressClick = (e) => {
    if (!audioRef.current || !progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * (audioRef.current.duration || 0);
  };

  const changeSpeed = (rate) => {
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const fmtTime = (sec) => {
    if (sec == null || isNaN(sec)) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const escHtml = (str) => String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const speakers = [...new Set(transcriptEdits.map(s => s.speaker))];
  const speakerColors = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#f97316"];
  const getSpeakerColor = (sp) => speakerColors[speakers.indexOf(sp) % speakerColors.length];

  const handlePresent = () => {
    const speakerColorsMap = {};
    speakers.forEach((sp, i) => { speakerColorsMap[sp] = speakerColors[i % speakerColors.length]; });
    const pw = window.open("", "_blank", "width=1200,height=800");
    if (!pw) { alert("Pop-up blocked. Please allow pop-ups for this site."); return; }
    const title = escHtml(viewer.filename || "Transcript");
    pw.document.write(`<!DOCTYPE html><html><head><title>${title} — Present Mode</title><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; padding-top: 16px; transition: background 0.3s, color 0.3s; }
body.dark { background: #0f172a; color: #e2e8f0; }
body.light { background: #ffffff; color: #1e293b; }
.theme-bar { display: flex; justify-content: flex-end; margin-bottom: 12px; gap: 4px; }
.theme-btn { padding: 4px 14px; font-size: 12px; font-weight: 500; border: 1px solid #94a3b8; border-radius: 6px; cursor: pointer; font-family: inherit; transition: all 0.2s; }
body.dark .theme-btn { background: transparent; color: #94a3b8; border-color: #475569; }
body.dark .theme-btn.active { background: #334155; color: #f8fafc; border-color: #6366f1; }
body.light .theme-btn { background: transparent; color: #64748b; border-color: #cbd5e1; }
body.light .theme-btn.active { background: #e0e7ff; color: #3730a3; border-color: #6366f1; }
.header { text-align: center; margin-bottom: 32px; padding-bottom: 24px; }
body.dark .header { border-bottom: 1px solid #334155; }
body.light .header { border-bottom: 1px solid #e2e8f0; }
.title { font-size: 24px; font-weight: 700; margin-bottom: 8px; }
body.dark .title { color: #f8fafc; }
body.light .title { color: #0f172a; }
.meta { font-size: 14px; }
body.dark .meta { color: #94a3b8; }
body.light .meta { color: #64748b; }
.legend { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 32px; }
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 13px; }
body.dark .legend-item { color: #cbd5e1; }
body.light .legend-item { color: #475569; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; }
.segments { max-width: 900px; margin: 0 auto; }
.segment { display: flex; gap: 16px; padding: 12px 16px; border-radius: 8px; margin-bottom: 4px; align-items: flex-start; }
body.dark .segment:nth-child(even) { background: rgba(30, 41, 59, 0.5); }
body.light .segment:nth-child(even) { background: #f8fafc; }
.timestamp { flex-shrink: 0; width: 60px; font-size: 13px; font-family: monospace; padding-top: 3px; }
body.dark .timestamp { color: #64748b; }
body.light .timestamp { color: #94a3b8; }
.speaker { flex-shrink: 0; width: 140px; font-size: 14px; font-weight: 600; padding-top: 2px; }
.text { flex: 1; font-size: 18px; line-height: 1.7; }
body.dark .text { color: #e2e8f0; }
body.light .text { color: #1e293b; }
</style></head><body class="dark">
<div class="theme-bar"><button class="theme-btn active" id="darkBtn" onclick="setTheme('dark')">Dark</button><button class="theme-btn" id="lightBtn" onclick="setTheme('light')">Light</button></div>
<div class="header"><div class="title">${title}</div><div class="meta">${transcriptEdits.length} segments${viewer.durationSeconds ? ' · ' + Math.floor(viewer.durationSeconds / 60) + 'm ' + Math.round(viewer.durationSeconds % 60) + 's' : ''}</div></div>
<div class="legend">${speakers.map(sp => `<div class="legend-item"><div class="legend-dot" style="background:${speakerColorsMap[sp]}"></div>${escHtml(sp)}</div>`).join("")}</div>
<div class="segments">${transcriptEdits.map(seg => `<div class="segment"><div class="timestamp">${fmtTime(seg.startTime)}</div><div class="speaker" style="color:${speakerColorsMap[seg.speaker] || '#94a3b8'}">${escHtml(seg.speaker)}</div><div class="text">${escHtml(seg.text)}</div></div>`).join("")}</div>
<script>
function setTheme(t){document.body.className=t;document.getElementById('darkBtn').className='theme-btn'+(t==='dark'?' active':'');document.getElementById('lightBtn').className='theme-btn'+(t==='light'?' active':'');}
document.addEventListener("keydown",function(e){if(e.key==="Escape")window.close();});
<\/script>
</body></html>`);
    pw.document.close();
  };

  const containerStyle = isMobile
    ? { position: "fixed", inset: 0, zIndex: 10002, display: "flex", flexDirection: "column", background: "var(--c-bg, #fff)", overflow: "hidden" }
    : {
        position: "fixed",
        top: viewer.position?.y ?? 60,
        left: viewer.position?.x ?? 80,
        width: viewer.size?.width ?? "75vw",
        height: viewer.size?.height ?? "80vh",
        maxWidth: "95vw",
        maxHeight: "90vh",
        minWidth: 480,
        minHeight: 400,
        zIndex,
        display: "flex",
        flexDirection: "column",
        background: "var(--c-bg, #fff)",
        borderRadius: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.1)",
        border: "1px solid var(--c-border, #e2e8f0)",
        overflow: "hidden",
      };

  const speedRates = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const btnStyle = { fontSize: 11, display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "1px solid var(--c-border, #e2e8f0)", color: "var(--c-text3, #64748b)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 500 };

  return (
    <div data-transcript-window onClick={onBringToFront} style={containerStyle}>
      <div style={{ flexShrink: 0 }}>
        <div onMouseDown={handleDragStart} style={{ display: "flex", alignItems: "center", padding: "8px 14px", borderBottom: "1px solid var(--c-border, #e2e8f0)", background: "var(--c-bg, #fff)", cursor: isMobile ? "default" : "move", userSelect: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <FileAudio size={15} style={{ color: "#6366f1", flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--c-text-h, #0f172a)" }}>
              {viewer.filename || "Transcript"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button onClick={onMinimize} title="Minimize" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#64748b" }}><Minus size={15} /></button>
            <button onClick={onClose} title="Close" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#94a3b8" }}><X size={15} /></button>
          </div>
        </div>

        {!viewer.isVideo && (
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--c-border, #e2e8f0)", background: "var(--c-bg2, #f8fafc)" }}>
            <audio
              ref={audioRef}
              src={`/api/transcripts/${viewer.transcriptId}/audio`}
              preload="metadata"
              onTimeUpdate={() => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
              onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
              onEnded={() => setIsPlaying(false)}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={skipBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#475569" }} title="Back 5s"><SkipBack size={16} /></button>
              <button onClick={togglePlay} style={{ background: "#6366f1", border: "none", cursor: "pointer", padding: 6, borderRadius: "50%", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }} title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 1 }} />}
              </button>
              <button onClick={skipForward} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#475569" }} title="Forward 5s"><SkipForward size={16} /></button>
              <div
                ref={progressRef}
                onClick={handleProgressClick}
                style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 3, cursor: "pointer", position: "relative" }}
              >
                <div style={{ height: "100%", background: "#6366f1", borderRadius: 3, width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`, transition: "width 0.1s" }} />
                <div style={{ position: "absolute", top: -4, left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`, width: 14, height: 14, borderRadius: "50%", background: "#6366f1", border: "2px solid #fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transform: "translateX(-50%)", transition: "left 0.1s" }} />
              </div>
              <span style={{ fontSize: 12, color: "#64748b", fontFamily: "monospace", flexShrink: 0 }}>{fmtTime(currentTime)} / {fmtTime(duration)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <Volume2 size={13} style={{ color: "#64748b" }} />
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500 }}>Speed:</span>
              {speedRates.map(rate => (
                <button
                  key={rate}
                  onClick={() => changeSpeed(rate)}
                  style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontWeight: 600, border: "1px solid",
                    background: playbackRate === rate ? "#6366f1" : "transparent",
                    color: playbackRate === rate ? "#fff" : "#64748b",
                    borderColor: playbackRate === rate ? "#6366f1" : "#e2e8f0"
                  }}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>
        )}

        {viewer.isVideo && (
          <div style={{ borderBottom: "1px solid var(--c-border, #e2e8f0)", background: "#000" }}>
            <video
              ref={audioRef}
              controls
              style={{ width: "100%", maxHeight: 250, display: "block" }}
              src={`/api/transcripts/${viewer.transcriptId}/video`}
              onTimeUpdate={() => { if (audioRef.current) setCurrentTime(audioRef.current.currentTime); }}
              onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
            />
          </div>
        )}

        <div style={{ padding: "6px 14px", borderBottom: "1px solid var(--c-border, #e2e8f0)", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", background: "var(--c-bg, #fff)" }}>
          <button onClick={async () => {
            try {
              const blob = await apiDownloadTranscriptAudio(viewer.transcriptId);
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = viewer.filename; a.click();
              URL.revokeObjectURL(url);
            } catch (err) { alert("Download failed: " + err.message); }
          }} style={btnStyle}><Download size={11} /> Audio</button>

          <div style={{ position: "relative" }}>
            <button onClick={() => setExportDropdownId(!exportDropdownId)} style={btnStyle}>
              <FileText size={11} /> Export <ChevronDown size={9} />
            </button>
            {exportDropdownId && (
              <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "var(--c-bg)", border: "1px solid var(--c-border2)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 50, minWidth: 140, overflow: "hidden" }}>
                {[{ label: "Text (.txt)", fmt: "txt", ext: "_transcript.txt" }, { label: "Word (.docx)", fmt: "docx", ext: "_transcript.docx" }, { label: "PDF (.pdf)", fmt: "pdf", ext: "_transcript.pdf" }].map(opt => (
                  <button key={opt.fmt} onClick={async () => {
                    setExportDropdownId(false);
                    try {
                      const blob = await apiExportTranscript(viewer.transcriptId, opt.fmt);
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a"); a.href = url; a.download = (viewer.filename || "transcript").replace(/\.[^.]+$/, "") + opt.ext; a.click();
                      URL.revokeObjectURL(url);
                    } catch (err) { alert("Export failed: " + err.message); }
                  }} style={{ display: "block", width: "100%", padding: "8px 14px", fontSize: 11, border: "none", background: "transparent", color: "var(--c-text)", cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={(e) => e.target.style.background = "var(--c-bg2)"} onMouseLeave={(e) => e.target.style.background = "transparent"}>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => {
              setShowTranscriptHistory(!showTranscriptHistory);
              if (!showTranscriptHistory) {
                setTranscriptHistoryLoading(true);
                apiGetTranscriptHistory(viewer.transcriptId).then(setTranscriptHistory).catch(() => setTranscriptHistory([])).finally(() => setTranscriptHistoryLoading(false));
              }
            }}
            style={{ ...btnStyle, background: showTranscriptHistory ? "#ede9fe" : undefined, borderColor: showTranscriptHistory ? "#a78bfa" : undefined, color: showTranscriptHistory ? "#5b21b6" : undefined }}
          ><RotateCcw size={11} /> History</button>

          <button
            onClick={() => setTranscriptReadingView(!transcriptReadingView)}
            style={{ ...btnStyle, background: transcriptReadingView ? "#6366f1" : undefined, color: transcriptReadingView ? "#fff" : undefined, borderColor: transcriptReadingView ? "#6366f1" : undefined }}
          ><Eye size={11} /> Reading View</button>

          <button onClick={handlePresent} style={{ ...btnStyle, background: "#0f172a", color: "#f8fafc", borderColor: "#334155" }}>
            <Scale size={11} /> Present
          </button>

          {ScribeTranscriptButtons && (
            <ScribeTranscriptButtons
              transcriptId={viewer.transcriptId}
              scribeTranscriptId={viewer.scribeTranscriptId}
              scribeStatus={viewer.scribeStatus}
              onRefreshed={() => {
                apiGetTranscriptDetail(viewer.transcriptId).then(d => {
                  setTranscriptEdits(JSON.parse(JSON.stringify(d.transcript)));
                  if (onTranscriptEditsChange) onTranscriptEditsChange(d.transcript);
                }).catch(() => {});
              }}
            />
          )}

          <div style={{ flex: 1 }} />

          {autoSaveStatus && (
            <span style={{ fontSize: 10, color: autoSaveStatus === "saved" ? "#10b981" : "#94a3b8", display: "flex", alignItems: "center", gap: 3 }}>
              {autoSaveStatus === "saving" ? <><Loader2 size={10} className="animate-spin" /> Saving...</> : <><Check size={10} /> Saved</>}
            </span>
          )}

          <button
            disabled={transcriptSaving}
            onClick={async () => {
              if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
              setTranscriptSaving(true);
              try {
                const prevState = viewer.transcriptDetail?.transcript;
                await apiUpdateTranscript(viewer.transcriptId, { transcript: transcriptEdits });
                if (onTranscriptEditsChange) onTranscriptEditsChange(transcriptEdits);
                apiSaveTranscriptHistory(viewer.transcriptId, { changeType: "manual_save", changeDescription: "Manual save", previousState: prevState }).catch(() => {});
              } catch (err) { alert("Save failed: " + err.message); }
              setTranscriptSaving(false);
            }}
            style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, background: "#1e293b", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer", fontWeight: 600 }}
          >
            {transcriptSaving ? <Loader2 size={11} className="animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
        {showTranscriptHistory && (
          <div style={{ marginBottom: 12, border: "1px solid #e9d5ff", borderRadius: 8, background: "#faf5ff", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #e9d5ff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#5b21b6" }}>Version History</span>
              <button onClick={() => setShowTranscriptHistory(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ maxHeight: 200, overflowY: "auto", padding: 8 }}>
              {transcriptHistoryLoading ? <p style={{ fontSize: 11, color: "#94a3b8", padding: 8 }}>Loading history...</p> :
               transcriptHistory.length === 0 ? <p style={{ fontSize: 11, color: "#94a3b8", padding: 8 }}>No version history yet.</p> :
               transcriptHistory.map(h => {
                 const typeColors = { edit: { bg: "#dbeafe", color: "#1d4ed8", label: "Edit" }, manual_save: { bg: "#dcfce7", color: "#15803d", label: "Save" }, revert: { bg: "#fef3c7", color: "#92400e", label: "Revert" }, merge: { bg: "#e0e7ff", color: "#4338ca", label: "Merge" } };
                 const tc = typeColors[h.changeType] || { bg: "#f1f5f9", color: "#64748b", label: h.changeType };
                 return (
                   <div key={h.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: 6, marginBottom: 4, background: "#fff", border: "1px solid #f1f5f9" }}>
                     <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                       <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: tc.bg, color: tc.color, whiteSpace: "nowrap" }}>{tc.label}</span>
                       <span style={{ fontSize: 11, color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.changeDescription || h.changeType}</span>
                       <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap" }}>by {h.changedBy}</span>
                       <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap" }}>{new Date(h.createdAt).toLocaleString()}</span>
                     </div>
                     <button
                       disabled={revertingHistoryId === h.id}
                       onClick={async () => {
                         if (!window.confirm("Revert to this version? Current changes will be saved as a history entry.")) return;
                         setRevertingHistoryId(h.id);
                         try {
                           const reverted = await apiRevertTranscript(viewer.transcriptId, h.id);
                           setTranscriptEdits(JSON.parse(JSON.stringify(reverted.transcript)));
                           if (onTranscriptEditsChange) onTranscriptEditsChange(reverted.transcript);
                           const freshHistory = await apiGetTranscriptHistory(viewer.transcriptId);
                           setTranscriptHistory(freshHistory);
                         } catch (err) { alert("Revert failed: " + err.message); }
                         setRevertingHistoryId(null);
                       }}
                       style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid #f59e0b", background: "#fffbeb", color: "#92400e", cursor: revertingHistoryId === h.id ? "wait" : "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 3, flexShrink: 0, opacity: revertingHistoryId === h.id ? 0.6 : 1 }}
                     >
                       {revertingHistoryId === h.id ? <Loader2 size={10} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={10} />} Revert
                     </button>
                   </div>
                 );
               })
              }
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {speakers.map(sp => (
              <div key={sp} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 10px", borderRadius: 12, background: getSpeakerColor(sp) + "18", color: getSpeakerColor(sp), fontWeight: 600, cursor: "pointer", border: `1px solid ${getSpeakerColor(sp)}30` }}
                onClick={() => setEditingSpeaker(editingSpeaker === sp ? null : sp)}
              >
                {editingSpeaker === sp ? (
                  <input
                    autoFocus
                    defaultValue={sp}
                    style={{ background: "transparent", border: "none", outline: "none", color: "inherit", fontSize: 11, fontWeight: 600, width: 100 }}
                    onBlur={(e) => {
                      const newName = e.target.value.trim() || sp;
                      if (newName !== sp) {
                        setTranscriptEdits(prev => prev.map(seg => seg.speaker === sp ? { ...seg, speaker: newName } : seg));
                      }
                      setEditingSpeaker(null);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <><Pencil size={10} /> {sp}</>
                )}
              </div>
            ))}
          </div>
        </div>

        {selectedSegments.size >= 2 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 8, background: "#6366f118", border: "1px solid #6366f130", borderRadius: 6 }}>
            <Merge size={13} style={{ color: "#6366f1" }} />
            <span style={{ fontSize: 11, color: "var(--c-text)", fontWeight: 500 }}>{selectedSegments.size} lines selected</span>
            <button
              onClick={() => {
                const sorted = [...selectedSegments].sort((a, b) => a - b);
                setMergeUndoStack(prev => [...prev, transcriptEdits.map(s => ({ ...s }))]);
                setTranscriptEdits(prev => {
                  const updated = [...prev];
                  const first = sorted[0];
                  const mergedText = sorted.map(i => updated[i].text).join(" ");
                  updated[first] = { ...updated[first], text: mergedText };
                  const toRemove = new Set(sorted.slice(1));
                  return updated.filter((_, i) => !toRemove.has(i));
                });
                setSelectedSegments(new Set());
              }}
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #6366f1", background: "#6366f1", color: "#fff", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}
            ><Merge size={11} /> Merge</button>
            {mergeUndoStack.length > 0 && (
              <button
                onClick={() => {
                  const prev = mergeUndoStack[mergeUndoStack.length - 1];
                  setMergeUndoStack(stack => stack.slice(0, -1));
                  setTranscriptEdits(prev);
                  setSelectedSegments(new Set());
                }}
                style={{ fontSize: 11, padding: "3px 10px", borderRadius: 6, border: "1px solid #f59e0b", background: "#fffbeb", color: "#92400e", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}
              ><RotateCcw size={11} /> Undo</button>
            )}
          </div>
        )}

        {transcriptReadingView ? (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20, maxHeight: "none" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", lineHeight: "22px" }}>Speakers:</span>
              {speakers.map((sp, i) => (
                <div key={sp} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: speakerColors[i % speakerColors.length], flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#1e293b", fontWeight: 500 }}>{sp}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {transcriptEdits.map((seg, idx) => (
                <div key={idx} style={{ display: "flex", gap: 14, padding: "10px 14px", borderRadius: 6, background: idx % 2 === 0 ? "#f8fafc" : "transparent", alignItems: "flex-start", borderLeft: `3px solid ${getSpeakerColor(seg.speaker)}` }}>
                  <div style={{ flexShrink: 0, width: 52, fontSize: 11, color: "#94a3b8", fontFamily: "monospace", paddingTop: 3 }}>{fmtTime(seg.startTime)}</div>
                  <div style={{ flexShrink: 0, width: 120 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: getSpeakerColor(seg.speaker) }}>{seg.speaker}</span>
                  </div>
                  <div style={{ flex: 1, fontSize: 13, lineHeight: 1.6, color: "#1e293b" }}>{seg.text}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {transcriptEdits.map((seg, idx) => (
              <div key={idx} style={{ display: "flex", gap: 10, padding: "8px 10px", borderRadius: 6, background: selectedSegments.has(idx) ? "#6366f110" : (idx % 2 === 0 ? "var(--c-bg2)" : "transparent"), alignItems: "flex-start", border: selectedSegments.has(idx) ? "1px solid #6366f130" : "1px solid transparent" }}>
                <div style={{ flexShrink: 0, paddingTop: 2 }}>
                  <input
                    type="checkbox"
                    checked={selectedSegments.has(idx)}
                    onChange={() => {
                      setSelectedSegments(prev => {
                        const next = new Set(prev);
                        if (next.has(idx)) next.delete(idx);
                        else next.add(idx);
                        return next;
                      });
                    }}
                    style={{ cursor: "pointer", accentColor: "#6366f1", width: 14, height: 14 }}
                  />
                </div>
                <div style={{ flexShrink: 0, width: 48, fontSize: 10, color: "#94a3b8", fontFamily: "monospace", paddingTop: 2 }}>{fmtTime(seg.startTime)}</div>
                <div style={{ flexShrink: 0, width: 100 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: getSpeakerColor(seg.speaker), cursor: "pointer" }}
                    onClick={() => {
                      const currentSpeakers = [...new Set(transcriptEdits.map(s => s.speaker))];
                      const currentIdx = currentSpeakers.indexOf(seg.speaker);
                      const nextSpeaker = currentSpeakers[(currentIdx + 1) % currentSpeakers.length];
                      setTranscriptEdits(prev => prev.map((s, i) => i === idx ? { ...s, speaker: nextSpeaker } : s));
                    }}
                    title="Click to cycle speaker"
                  >{seg.speaker}</span>
                </div>
                <div style={{ flex: 1 }}>
                  {editingSegmentIdx === idx ? (
                    <textarea
                      autoFocus
                      defaultValue={seg.text}
                      style={{ width: "100%", fontSize: 12, lineHeight: 1.5, padding: 4, border: "1px solid #6366f1", borderRadius: 4, background: "var(--c-bg)", color: "var(--c-text)", resize: "vertical", minHeight: 40, fontFamily: "inherit" }}
                      onBlur={(e) => {
                        const newText = e.target.value.trim();
                        if (newText !== seg.text) {
                          setTranscriptEdits(prev => prev.map((s, i) => i === idx ? { ...s, text: newText } : s));
                        }
                        setEditingSegmentIdx(null);
                      }}
                      onKeyDown={(e) => { if (e.key === "Escape") setEditingSegmentIdx(null); }}
                    />
                  ) : (
                    <div
                      style={{ fontSize: 12, lineHeight: 1.5, color: "var(--c-text)", cursor: "pointer", padding: "2px 4px", borderRadius: 4 }}
                      onClick={() => setEditingSegmentIdx(idx)}
                      title="Click to edit"
                    >{seg.text}</div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                  <button
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#94a3b8", fontSize: 10 }}
                    title="Move up"
                    disabled={idx === 0}
                    onClick={() => {
                      setTranscriptEdits(prev => {
                        const arr = [...prev];
                        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                        return arr;
                      });
                    }}
                  >↑↕</button>
                  <button
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#94a3b8", fontSize: 10 }}
                    title="Move down"
                    disabled={idx === transcriptEdits.length - 1}
                    onClick={() => {
                      setTranscriptEdits(prev => {
                        const arr = [...prev];
                        [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                        return arr;
                      });
                    }}
                  >↓↕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {viewer.transcriptDetail?.summaries && Array.isArray(viewer.transcriptDetail.summaries) && viewer.transcriptDetail.summaries.length > 0 && (
          <div style={{ marginTop: 16, border: "1px solid #c4b5fd", borderRadius: 8, overflow: "hidden" }}>
            <div
              onClick={() => setShowSummaries(!showSummaries)}
              style={{ padding: "10px 14px", background: "#ede9fe", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles size={14} style={{ color: "#7c3aed" }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "#5b21b6" }}>AI Summaries</span>
                <span style={{ fontSize: 11, color: "#7c3aed", fontWeight: 400 }}>({viewer.transcriptDetail.summaries.length})</span>
              </div>
              <ChevronRight size={14} style={{ color: "#7c3aed", transform: showSummaries ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
            </div>
            {showSummaries && (
              <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, background: "#faf5ff" }}>
                {viewer.transcriptDetail.summaries.map((summary, si) => (
                  <div key={si} style={{ border: "1px solid #e9d5ff", borderRadius: 6, padding: "12px 14px", background: "#fff" }}>
                    {(summary.title || summary.type) && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#5b21b6", marginBottom: 6 }}>{summary.title || summary.type}</div>
                    )}
                    <div style={{ fontSize: 12, lineHeight: 1.7, color: "#334155", whiteSpace: "pre-wrap" }}>
                      {summary.content || summary.text || summary.summary || JSON.stringify(summary)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!isMobile && (
        <div
          onMouseDown={handleResizeStart}
          style={{ position: "absolute", bottom: 0, right: 0, width: 18, height: 18, cursor: "nwse-resize" }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ opacity: 0.3 }}>
            <line x1="14" y1="4" x2="4" y2="14" stroke="#64748b" strokeWidth="1.5" />
            <line x1="14" y1="8" x2="8" y2="14" stroke="#64748b" strokeWidth="1.5" />
            <line x1="14" y1="12" x2="12" y2="14" stroke="#64748b" strokeWidth="1.5" />
          </svg>
        </div>
      )}
    </div>
  );
}
