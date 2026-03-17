import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Trash2, X, Copy, Sparkles, Check, ClipboardList, Calendar, FileText, Scale, Mail, Users } from "lucide-react";
import useDraggableWindow from "./hooks/useDraggableWindow.js";

const RenderIcon = ({ icon: Icon, size = 14, style, ...props }) => Icon ? <Icon size={size} style={style} {...props} /> : null;

const AdvocateAIPanel = memo(function AdvocateAIPanel({
  visible,
  onClose,
  view,
  collaborateView,
  advocateMessages,
  advocateLoading,
  advocateInput,
  setAdvocateInput,
  advocateSend,
  advocateClearConversation,
  advocateCaseId,
  setAdvocateCaseId,
  advocateStats,
  advocateScreenChips,
  setAdvocateScreenChips,
  advocateFromHelpCenter,
  advocateTasksAdded,
  setAdvocateTasksAdded,
  allCases,
  pinnedCaseIds,
  SCREEN_LABELS,
  ADVOCATE_SCREEN_CHIPS,
  isDarkMode,
  apiCreateNote,
  apiCreateTask,
  setTasks,
  CaseSearchField,
  advocateEndRef,
}) {
  const { titleBarHandlers, panelStyle: dragPanelStyle } = useDraggableWindow("advocate-panel-pos", 400, 580);
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

  const baseStyle = collaborateView && !dragPanelStyle
    ? { bottom: "auto", top: 62 }
    : undefined;

  const combinedStyle = isMobile
    ? undefined
    : { ...baseStyle, ...dragPanelStyle };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="advocate-panel"
          data-advocate-panel
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.97 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          style={{ ...combinedStyle, zIndex: 9999, animation: "none" }}
        >
          <div
            className="advocate-panel-header"
            style={{ cursor: isMobile ? undefined : "grab", userSelect: "none" }}
            {...(isMobile ? {} : titleBarHandlers)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              <Bot size={18} className="text-indigo-500" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="!text-[15px] !font-semibold !text-slate-900 dark:!text-slate-100">Advocate AI</div>
                <div style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {advocateFromHelpCenter ? <span><RenderIcon icon={SCREEN_LABELS.helpcenter?.icon} size={14} style={{display:"inline",verticalAlign:"middle",marginRight:4}} /> {SCREEN_LABELS.helpcenter?.label}</span> : SCREEN_LABELS[view] && <span><RenderIcon icon={SCREEN_LABELS[view].icon} size={14} style={{display:"inline",verticalAlign:"middle",marginRight:4}} /> {SCREEN_LABELS[view].label}</span>}
                  {advocateCaseId && (() => { const ac = allCases.find(cs => cs.id === advocateCaseId); return ac ? <span style={{ fontWeight: 600 }}>· {ac.case_num || ac.title}</span> : null; })()}
                </div>
              </div>
            </div>
            <div className="advocate-header-actions" style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
              {advocateMessages.length > 0 && advocateCaseId && (
                <button className="btn btn-outline btn-sm" style={{ fontSize: 9, padding: "2px 6px" }} onClick={() => {
                  const thread = advocateMessages.map(m => m.role === "user" ? `**You:** ${m.content}` : `**Advocate AI:** ${m.content}`).join("\n\n---\n\n");
                  apiCreateNote({ caseId: advocateCaseId, body: thread, type: "AI Consultation" }).then(() => alert("Saved as case note.")).catch(e => alert("Failed: " + e.message));
                }}>Save as Note</button>
              )}
              {advocateMessages.length > 0 && (
                <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#64748b", padding: "2px 4px" }} title="New conversation" onClick={advocateClearConversation}><Trash2 size={14} /></button>
              )}
              <button style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#64748b", padding: "2px 4px" }} onClick={onClose}><X size={14} /></button>
            </div>
          </div>
          <div className="advocate-case-search" style={{ padding: "6px 14px", borderBottom: "1px solid var(--c-border)", flexShrink: 0 }}>
            <CaseSearchField
              allCases={allCases}
              value={advocateCaseId ? String(advocateCaseId) : ""}
              onChange={val => {
                const newId = val ? Number(val) : null;
                if (newId !== advocateCaseId) {
                  advocateClearConversation();
                  setAdvocateCaseId(newId);
                }
              }}
              placeholder="Search cases or type for general help…"
              pinnedCaseIds={pinnedCaseIds}
            />
          </div>
          {advocateStats && (
            <div className="advocate-stats-bar" style={{ padding: "4px 14px", fontSize: 10, color: "#64748b", borderBottom: "1px solid var(--c-border)", flexShrink: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {advocateStats.notes > 0 && <span><ClipboardList size={12} style={{display:"inline",verticalAlign:"middle",marginRight:2}} /> {advocateStats.notes}</span>}
              {advocateStats.tasks > 0 && <span><Check size={12} style={{display:"inline",verticalAlign:"middle",marginRight:2}} /> {advocateStats.tasks}</span>}
              {advocateStats.deadlines > 0 && <span><Calendar size={12} style={{display:"inline",verticalAlign:"middle",marginRight:2}} /> {advocateStats.deadlines}</span>}
              {advocateStats.documents > 0 && <span><FileText size={12} style={{display:"inline",verticalAlign:"middle",marginRight:2}} /> {advocateStats.documents}</span>}
              {advocateStats.filings > 0 && <span><Scale size={12} style={{display:"inline",verticalAlign:"middle",marginRight:2}} /> {advocateStats.filings}</span>}
              {advocateStats.emails > 0 && <span><Mail size={12} style={{display:"inline",verticalAlign:"middle",marginRight:2}} /> {advocateStats.emails}</span>}
              {advocateStats.parties > 0 && <span><Users size={12} style={{display:"inline",verticalAlign:"middle",marginRight:2}} /> {advocateStats.parties}</span>}
            </div>
          )}
          <MessageArea
            advocateMessages={advocateMessages}
            advocateLoading={advocateLoading}
            advocateScreenChips={advocateScreenChips}
            setAdvocateScreenChips={setAdvocateScreenChips}
            advocateCaseId={advocateCaseId}
            advocateSend={advocateSend}
            advocateTasksAdded={advocateTasksAdded}
            setAdvocateTasksAdded={setAdvocateTasksAdded}
            allCases={allCases}
            view={view}
            SCREEN_LABELS={SCREEN_LABELS}
            ADVOCATE_SCREEN_CHIPS={ADVOCATE_SCREEN_CHIPS}
            isDarkMode={isDarkMode}
            apiCreateTask={apiCreateTask}
            setTasks={setTasks}
            advocateEndRef={advocateEndRef}
          />
          <div className="advocate-input-bar" style={{ padding: "10px 14px", borderTop: "1px solid var(--c-border)", flexShrink: 0, display: "flex", gap: 6 }}>
            <input
              style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--c-border)", background: "var(--c-bg)", color: "var(--c-text)", fontSize: 12, outline: "none" }}
              placeholder={advocateCaseId ? "Ask about this case..." : "Ask anything..."}
              value={advocateInput}
              onChange={e => setAdvocateInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey && advocateInput.trim() && !advocateLoading) {
                  e.preventDefault();
                  advocateSend(advocateInput);
                }
              }}
              disabled={advocateLoading}
            />
            <button
              className="btn btn-sm"
              style={{ background: advocateInput.trim() && !advocateLoading ? "#4f46e5" : "#64748b", color: "#fff", border: "none", padding: "7px 14px", borderRadius: 8, cursor: advocateInput.trim() && !advocateLoading ? "pointer" : "not-allowed", fontSize: 12 }}
              disabled={!advocateInput.trim() || advocateLoading}
              onClick={() => advocateSend(advocateInput)}
            >Send</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

function MessageArea({
  advocateMessages, advocateLoading, advocateScreenChips, setAdvocateScreenChips,
  advocateCaseId, advocateSend, advocateTasksAdded, setAdvocateTasksAdded,
  allCases, view, SCREEN_LABELS, ADVOCATE_SCREEN_CHIPS, isDarkMode,
  apiCreateTask, setTasks, advocateEndRef,
}) {
  return (
    <div className="advocate-msg-area" style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      {advocateMessages.length === 0 && !advocateLoading && !advocateScreenChips && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <div style={{ opacity: 0.3 }}><Bot size={36} /></div>
          <div style={{ fontSize: 12, color: "#64748b", textAlign: "center", maxWidth: 320, lineHeight: 1.5 }}>
            {advocateCaseId ? "Ask me anything about this case. I have access to all case data." : "Ask me anything — Alabama law, office procedures, or how to use MattrMindr."}
          </div>
          <div className="advocate-starter-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 360 }}>
            {(advocateCaseId ? ["Analyze defense strategies", "Summarize key evidence", "What motions should I consider?"] : (ADVOCATE_SCREEN_CHIPS[view] || ADVOCATE_SCREEN_CHIPS.dashboard)).map(prompt => (
              <button key={prompt} style={{ padding: "5px 10px", fontSize: 11, borderRadius: 14, border: "1px solid #a5b4fc", background: "rgba(99,102,241,0.08)", color: "#818cf8", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.18)"; }}
                onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.08)"; }}
                onClick={() => advocateSend(prompt)}>{prompt}</button>
            ))}
          </div>
        </div>
      )}
      {advocateMessages.map((msg, i) => {
        const displayText = msg.content;
        const parsedTasks = msg.suggestedTasks && Array.isArray(msg.suggestedTasks) && msg.suggestedTasks.length > 0 ? msg.suggestedTasks : null;
        const msgAdded = advocateTasksAdded[i] || {};
        const priorityColors = { Urgent: "#e05252", High: "#e88c30", Medium: "#d97706", Low: "#2F7A5F" };
        const priorityDarkBg = { Urgent: "#fca5a5", High: "#fdba74", Medium: "#93c5fd", Low: "#cbd5e1" };
        const dk = isDarkMode();
        return (
        <div key={i}>
        <div style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
          <div style={{
            maxWidth: "88%", padding: "8px 12px", borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
            background: msg.role === "user" ? "#0f172a" : "var(--c-card-alt, #1a2332)",
            color: msg.role === "user" ? "#fff" : "#E6EDF3",
            fontSize: 12, lineHeight: 1.6, position: "relative",
            border: msg.role === "user" ? "none" : "1px solid var(--c-border)"
          }}>
            {msg.role === "assistant" && (
              <button style={{ position: "absolute", top: 3, right: 3, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#64748b", opacity: 0.5, padding: "2px" }}
                title="Copy" onClick={() => { navigator.clipboard.writeText(displayText); }}><Copy size={14} /></button>
            )}
            {msg.role === "user" ? (
              <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
            ) : (
              <div>
                {displayText.split("\n").map((line, li) => {
                  if (line.startsWith("## ")) return <div key={li} style={{ fontWeight: 700, fontSize: 13, marginTop: 8, marginBottom: 3 }}>{line.replace(/^## /, "")}</div>;
                  if (line.startsWith("### ")) return <div key={li} style={{ fontWeight: 600, fontSize: 12, marginTop: 6, marginBottom: 2 }}>{line.replace(/^### /, "")}</div>;
                  if (line.startsWith("**") && line.endsWith("**")) return <div key={li} style={{ fontWeight: 700, marginTop: 5, marginBottom: 2 }}>{line.replace(/\*\*/g, "")}</div>;
                  if (line.startsWith("- ") || line.startsWith("* ")) return <div key={li} style={{ paddingLeft: 10, position: "relative" }}><span style={{ position: "absolute", left: 0 }}>•</span>{line.replace(/^[-*] /, "").replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
                  if (line.match(/^\d+\.\s/)) return <div key={li} style={{ paddingLeft: 4 }}>{line.replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
                  if (line.trim() === "") return <div key={li} style={{ height: 3 }} />;
                  return <div key={li}>{line.replace(/\*\*(.+?)\*\*/g, "$1")}</div>;
                })}
              </div>
            )}
          </div>
        </div>
        {parsedTasks && parsedTasks.length > 0 && advocateCaseId && (
          <div style={{ maxWidth: "88%", marginTop: 4, padding: "8px 10px", borderRadius: 8, background: "var(--c-card)", border: "1px solid var(--c-border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1"><Sparkles size={11} className="text-amber-500" /> Suggested Tasks</span>
              {Object.keys(msgAdded).length < parsedTasks.length && (
                <button className="btn btn-sm" style={{ fontSize: 9, padding: "1px 8px", background: "#6366f1", color: "#fff", border: "none" }} onClick={async () => {
                  for (let ti = 0; ti < parsedTasks.length; ti++) {
                    if (msgAdded[ti]) continue;
                    const t = parsedTasks[ti];
                    const dueDate = t.dueInDays ? new Date(Date.now() + t.dueInDays * 86400000).toISOString().split("T")[0] : null;
                    try {
                      const saved = await apiCreateTask({ caseId: advocateCaseId, title: t.title, priority: t.priority || "Medium", assignedRole: t.assignedRole || "", due: dueDate, notes: t.rationale || "", isGenerated: true });
                      setTasks(p => [...p, saved]);
                      setAdvocateTasksAdded(p => ({ ...p, [i]: { ...(p[i] || {}), [ti]: true } }));
                    } catch (err) { alert("Failed: " + err.message); break; }
                  }
                }}>+ Add All</button>
              )}
            </div>
            {parsedTasks.map((t, ti) => {
              const added = msgAdded[ti];
              return (
                <div key={ti} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderTop: ti > 0 ? "1px solid var(--c-border)" : "none", opacity: added ? 0.45 : 1 }}>
                  <span style={{ fontSize: 11, marginTop: 1 }}>{added ? <Check size={11} /> : ""}{!added && <Sparkles size={11} className="text-amber-500" />}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--c-text-h)", fontWeight: 500 }}>{t.title}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 3, background: dk ? (priorityDarkBg[t.priority] || "#cbd5e1") : (priorityColors[t.priority] || "#d97706") + "18", color: dk ? "#1a1a1a" : (priorityColors[t.priority] || "#d97706") }}>{t.priority}</span>
                      {t.assignedRole && <span style={{ fontSize: 9, color: "#64748b" }}>{t.assignedRole}</span>}
                      {t.dueInDays && <span style={{ fontSize: 9, color: "#64748b" }}>{t.dueInDays}d</span>}
                    </div>
                  </div>
                  {!added && (
                    <button className="btn btn-outline btn-sm" style={{ fontSize: 9, padding: "1px 6px", flexShrink: 0 }} onClick={async () => {
                      const dueDate = t.dueInDays ? new Date(Date.now() + t.dueInDays * 86400000).toISOString().split("T")[0] : null;
                      try {
                        const saved = await apiCreateTask({ caseId: advocateCaseId, title: t.title, priority: t.priority || "Medium", assignedRole: t.assignedRole || "", due: dueDate, notes: t.rationale || "", isGenerated: true });
                        setTasks(p => [...p, saved]);
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
      {advocateScreenChips && !advocateLoading && ADVOCATE_SCREEN_CHIPS[advocateScreenChips] && (
        <div style={{ padding: "6px 0" }}>
          {advocateMessages.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
              <span style={{ fontSize: 10, color: "#64748b", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                <RenderIcon icon={SCREEN_LABELS[advocateScreenChips]?.icon} size={12} style={{display:"inline",verticalAlign:"middle",marginRight:3}} /> Navigated to {SCREEN_LABELS[advocateScreenChips]?.label || advocateScreenChips}
              </span>
              <div style={{ flex: 1, height: 1, background: "var(--c-border)" }} />
            </div>
          )}
          <div className="advocate-nav-chips" style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center" }}>
            {ADVOCATE_SCREEN_CHIPS[advocateScreenChips].map(prompt => (
              <button key={prompt} style={{ padding: "4px 9px", fontSize: 11, borderRadius: 14, border: "1px solid #a5b4fc", background: "rgba(99,102,241,0.08)", color: "#818cf8", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.18)"; }}
                onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.08)"; }}
                onClick={() => { setAdvocateScreenChips(null); advocateSend(prompt); }}>{prompt}</button>
            ))}
          </div>
        </div>
      )}
      {advocateLoading && (
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div style={{ padding: "10px 14px", borderRadius: "12px 12px 12px 4px", background: "var(--c-card-alt, #1a2332)", border: "1px solid var(--c-border)", display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#818cf8", animation: "pulse 1s ease-in-out infinite" }} />
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#818cf8", animation: "pulse 1s ease-in-out 0.2s infinite" }} />
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#818cf8", animation: "pulse 1s ease-in-out 0.4s infinite" }} />
          </div>
        </div>
      )}
      <div ref={advocateEndRef} />
    </div>
  );
}

export default AdvocateAIPanel;
