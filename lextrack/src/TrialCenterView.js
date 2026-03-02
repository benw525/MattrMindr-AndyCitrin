import React, { useState, useEffect, useCallback, useRef } from "react";
import { Scale, Users, Search, Plus, Trash2, ChevronUp, ChevronDown, Loader2, AlertTriangle, FileText, ClipboardList, Sparkles, Download, Pin, X, Edit3 as Pencil, Menu, Mic, Upload, Eye } from "lucide-react";
import {
  apiCreateTrialSession,
  apiGetTrialWitnesses, apiCreateTrialWitness, apiUpdateTrialWitness, apiDeleteTrialWitness, apiReorderTrialWitnesses,
  apiGetTrialExhibits, apiCreateTrialExhibit, apiUpdateTrialExhibit, apiDeleteTrialExhibit, apiUploadTrialExhibit,
  apiGetTrialJurors, apiCreateTrialJuror, apiUpdateTrialJuror, apiDeleteTrialJuror,
  apiGetTrialMotions, apiCreateTrialMotion, apiUpdateTrialMotion, apiDeleteTrialMotion,
  apiGetTrialOutlines, apiCreateTrialOutline, apiUpdateTrialOutline, apiDeleteTrialOutline,
  apiGetTrialJuryInstructions, apiCreateTrialJuryInstruction, apiUpdateTrialJuryInstruction, apiDeleteTrialJuryInstruction,
  apiGetTrialTimelineEvents, apiCreateTrialTimelineEvent, apiUpdateTrialTimelineEvent, apiDeleteTrialTimelineEvent,
  apiUploadDemonstrative, apiDownloadDemonstrative,
  apiGetTrialPinnedDocs, apiCreateTrialPinnedDoc, apiDeleteTrialPinnedDoc,
  apiGetTrialLogEntries, apiCreateTrialLogEntry, apiDeleteTrialLogEntry,
  apiTrialAiWitnessPrep, apiTrialAiJurySelection, apiTrialAiObjectionCoach, apiTrialAiClosingBuilder, apiTrialAiOpeningBuilder, apiTrialAiJuryInstructions, apiTrialAiCaseLawSearch,
  apiGetCaseDocuments, apiDownloadDocument, apiSummarizeDocument,
  apiExportWitnessPrep, apiGetWitnessDocuments, apiLinkWitnessDocument, apiUnlinkWitnessDocument, apiGetDocumentText,
  apiGetTranscripts, apiDownloadTranscriptAudio, apiGetTranscriptDetail,
  apiExtractOutlineFile,
  apiSavePreferences,
} from "./api.js";

const TABS = ["Witnesses","Exhibits","Jury","Motions","Outlines","Jury Instructions","Demonstratives","Quick Docs","Trial Log","AI Agents"];

const AI_AGENTS = [
  { id: "witness-prep", title: "Witness Prep", desc: "Generate cross-examination questions and impeachment points", Icon: Users, color: "text-indigo-600", bg: "bg-indigo-100 dark:bg-indigo-900/30" },
  { id: "jury-selection", title: "Jury Selection", desc: "Analyze juror responses for bias and red flags", Icon: Scale, color: "text-violet-600", bg: "bg-violet-100 dark:bg-violet-900/30" },
  { id: "objection-coach", title: "Objection Coach", desc: "Get objection suggestions with Alabama Rules of Evidence", Icon: AlertTriangle, color: "text-rose-600", bg: "bg-rose-100 dark:bg-rose-900/30" },
  { id: "closing-builder", title: "Closing Builder", desc: "Build closing argument from trial evidence", Icon: FileText, color: "text-emerald-600", bg: "bg-emerald-100 dark:bg-emerald-900/30" },
  { id: "opening-builder", title: "Opening Builder", desc: "Draft a compelling opening statement", Icon: FileText, color: "text-teal-600", bg: "bg-teal-100 dark:bg-teal-900/30" },
  { id: "jury-instructions-ai", title: "Jury Instructions", desc: "Review charges and suggest Alabama pattern instructions", Icon: ClipboardList, color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
  { id: "case-law", title: "Case Law Search", desc: "Find relevant Alabama case law and rules of evidence", Icon: Search, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
];

const INPUT_CLS = "w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500";
const BTN_CLS = "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-md px-4 py-2 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-200";
const CARD_CLS = "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm";
const BADGE_CLS = "rounded-full px-2.5 py-0.5 text-xs font-medium border";
const LABEL_CLS = "text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1";

function fmtDate(d) {
  if (!d) return "\u2014";
  const dt = new Date(d.includes("T") ? d : d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function TrialCenterView({ currentUser, users, cases, onMenuToggle, pinnedCaseIds = [] }) {
  const [caseSearch, setCaseSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState("Witnesses");
  const [loading, setLoading] = useState(false);
  const [restoredOnce, setRestoredOnce] = useState(false);

  const [witnesses, setWitnesses] = useState([]);
  const [exhibits, setExhibits] = useState([]);
  const [jurors, setJurors] = useState([]);
  const [motions, setMotions] = useState([]);
  const [outlines, setOutlines] = useState([]);
  const [juryInstructions, setJuryInstructions] = useState([]);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [pinnedDocs, setPinnedDocs] = useState([]);
  const [logEntries, setLogEntries] = useState([]);

  const [showWitnessForm, setShowWitnessForm] = useState(false);
  const [editWitness, setEditWitness] = useState(null);
  const [wForm, setWForm] = useState({ name: "", type: "prosecution", contact_info: "", expected_testimony: "", impeachment_notes: "", call_order: 1, status: "pending" });

  const [showExhibitForm, setShowExhibitForm] = useState(false);
  const [editExhibit, setEditExhibit] = useState(null);
  const [eForm, setEForm] = useState({ exhibit_number: "", description: "", type: "physical", status: "pending", notes: "" });

  const [showJurorForm, setShowJurorForm] = useState(false);
  const [editJuror, setEditJuror] = useState(null);
  const [jForm, setJForm] = useState({ seat_number: 1, name: "", notes: "", demographics: "", strike_type: "none", is_selected: false });

  const [showMotionForm, setShowMotionForm] = useState(false);
  const [editMotion, setEditMotion] = useState(null);
  const [mForm, setMForm] = useState({ title: "", type: "defense", status: "pending", ruling_summary: "", notes: "" });

  const [showInstructionForm, setShowInstructionForm] = useState(false);
  const [editInstruction, setEditInstruction] = useState(null);
  const [iForm, setIForm] = useState({ instruction_text: "", status: "requested", objection_notes: "", source: "" });

  const [showEventForm, setShowEventForm] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [tForm, setTForm] = useState({ event_date: "", title: "", description: "" });

  const [logDay, setLogDay] = useState(1);
  const [showLogForm, setShowLogForm] = useState(false);
  const [lForm, setLForm] = useState({ category: "note", content: "" });

  const [caseDocs, setCaseDocs] = useState([]);
  const [showDocPicker, setShowDocPicker] = useState(false);

  const [exhibitFile, setExhibitFile] = useState(null);

  const [demoFile, setDemoFile] = useState(null);
  const [demoForm, setDemoForm] = useState({ title: "", description: "", association: "general" });
  const [showDemoForm, setShowDemoForm] = useState(false);

  const [witnessAiId, setWitnessAiId] = useState(null);
  const [witnessAiLoading, setWitnessAiLoading] = useState(false);
  const [witnessAiResult, setWitnessAiResult] = useState("");

  const [jiAiLoading, setJiAiLoading] = useState(false);
  const [jiAiResult, setJiAiResult] = useState("");

  const [docViewerId, setDocViewerId] = useState(null);
  const [docViewerUrl, setDocViewerUrl] = useState(null);
  const [docSummaries, setDocSummaries] = useState({});
  const [docSummaryLoading, setDocSummaryLoading] = useState(null);

  const speechSupported = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const speechRecRef = useRef(null);
  const [isListening, setIsListening] = useState(false);

  const [witnessDocuments, setWitnessDocuments] = useState({});
  const [showWitnessDocPicker, setShowWitnessDocPicker] = useState(null);
  const [witnessDocLabel, setWitnessDocLabel] = useState("");
  const [caseTranscripts, setCaseTranscripts] = useState([]);

  const [transcriptSegments, setTranscriptSegments] = useState([]);
  const [viewerTitle, setViewerTitle] = useState("");

  const [outlineAiType, setOutlineAiType] = useState(null);
  const [outlineAiLoading, setOutlineAiLoading] = useState(false);
  const [outlineAiResult, setOutlineAiResult] = useState("");
  const [outlineAiFile, setOutlineAiFile] = useState(null);
  const [outlineAiInstructions, setOutlineAiInstructions] = useState("");
  const [outlineAiCrossId, setOutlineAiCrossId] = useState(null);

  const [activeAgent, setActiveAgent] = useState(null);
  const [aiInput, setAiInput] = useState("");
  const [aiInput2, setAiInput2] = useState("");
  const [aiWitnessId, setAiWitnessId] = useState("");
  const [aiJurorId, setAiJurorId] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState("");

  const dropdownRef = useRef(null);

  const filteredCases = (() => {
    const q = caseSearch.trim().toLowerCase();
    if (!q) return [];
    const all = (cases || []).filter(c =>
      (c.title || "").toLowerCase().includes(q)
      || (c.case_num || "").toLowerCase().includes(q)
      || (c.defendant_name || "").toLowerCase().includes(q)
    );
    const pinSet = new Set(pinnedCaseIds);
    const pinned = all.filter(c => pinSet.has(c.id));
    const rest = all.filter(c => !pinSet.has(c.id));
    return [...pinned, ...rest].slice(0, 15);
  })();

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (restoredOnce || !cases || cases.length === 0) return;
    setRestoredOnce(true);
    const savedId = currentUser?.preferences?.trialCenterCaseId;
    if (savedId) {
      const found = cases.find(c => c.id === savedId);
      if (found) selectCase(found);
    }
  }, [cases, restoredOnce, currentUser?.preferences?.trialCenterCaseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAllData = useCallback(async (sid) => {
    try {
      const [w, ex, ju, mo, ol, ji, te, pd, le] = await Promise.all([
        apiGetTrialWitnesses(sid),
        apiGetTrialExhibits(sid),
        apiGetTrialJurors(sid),
        apiGetTrialMotions(sid),
        apiGetTrialOutlines(sid),
        apiGetTrialJuryInstructions(sid),
        apiGetTrialTimelineEvents(sid),
        apiGetTrialPinnedDocs(sid),
        apiGetTrialLogEntries(sid),
      ]);
      setWitnesses(w || []);
      setExhibits(ex || []);
      setJurors(ju || []);
      setMotions(mo || []);
      setOutlines(ol || []);
      setJuryInstructions(ji || []);
      setTimelineEvents((te || []).sort((a, b) => (a.event_date || "").localeCompare(b.event_date || "")));
      setPinnedDocs(pd || []);
      setLogEntries(le || []);
    } catch (err) {
      console.error("Load trial data error:", err);
    }
  }, []);

  const selectCase = useCallback(async (c) => {
    setSelectedCase(c);
    setCaseSearch(c.title || c.case_num || "");
    setShowDropdown(false);
    setLoading(true);
    try {
      const sess = await apiCreateTrialSession({ caseId: c.id });
      setSession(sess);
      await loadAllData(sess.id);
      apiSavePreferences({ trialCenterCaseId: c.id }).catch(() => {});
    } catch (err) {
      console.error("Load session error:", err);
    }
    setLoading(false);
  }, [loadAllData]);

  const refreshTab = useCallback(async (tab) => {
    if (!session) return;
    const sid = session.id;
    try {
      if (tab === "Witnesses") { const d = await apiGetTrialWitnesses(sid); setWitnesses(d || []); }
      if (tab === "Exhibits") { const d = await apiGetTrialExhibits(sid); setExhibits(d || []); }
      if (tab === "Jury") { const d = await apiGetTrialJurors(sid); setJurors(d || []); }
      if (tab === "Motions") { const d = await apiGetTrialMotions(sid); setMotions(d || []); }
      if (tab === "Outlines") { const d = await apiGetTrialOutlines(sid); setOutlines(d || []); }
      if (tab === "Jury Instructions") { const d = await apiGetTrialJuryInstructions(sid); setJuryInstructions(d || []); }
      if (tab === "Demonstratives") { const d = await apiGetTrialTimelineEvents(sid); setTimelineEvents((d || []).sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""))); }
      if (tab === "Quick Docs") { const d = await apiGetTrialPinnedDocs(sid); setPinnedDocs(d || []); }
      if (tab === "Trial Log") { const d = await apiGetTrialLogEntries(sid); setLogEntries(d || []); }
    } catch {}
  }, [session]);

  const handleWitnessSave = async () => {
    if (!session) return;
    try {
      if (editWitness) {
        await apiUpdateTrialWitness(editWitness.id, wForm);
      } else {
        await apiCreateTrialWitness({ sessionId: session.id, ...wForm });
      }
      setShowWitnessForm(false);
      setEditWitness(null);
      setWForm({ name: "", type: "prosecution", contact_info: "", expected_testimony: "", impeachment_notes: "", call_order: witnesses.length + 1, status: "pending" });
      await refreshTab("Witnesses");
    } catch (err) { console.error(err); }
  };

  const handleWitnessReorder = async (idx, dir) => {
    const arr = [...witnesses];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    const order = arr.map(w => w.id);
    try {
      const result = await apiReorderTrialWitnesses(session.id, order);
      setWitnesses(result || arr);
    } catch {}
  };

  const handleExhibitSave = async () => {
    if (!session) return;
    try {
      if (editExhibit) {
        await apiUpdateTrialExhibit(editExhibit.id, eForm);
      } else if (exhibitFile) {
        const fd = new FormData();
        fd.append("file", exhibitFile);
        fd.append("sessionId", session.id);
        fd.append("exhibit_number", eForm.exhibit_number);
        fd.append("description", eForm.description);
        fd.append("type", eForm.type);
        fd.append("status", eForm.status);
        fd.append("notes", eForm.notes);
        await apiUploadTrialExhibit(fd);
      } else {
        await apiCreateTrialExhibit({ sessionId: session.id, ...eForm });
      }
      setShowExhibitForm(false);
      setEditExhibit(null);
      setExhibitFile(null);
      setEForm({ exhibit_number: "", description: "", type: "physical", status: "pending", notes: "" });
      await refreshTab("Exhibits");
    } catch (err) { console.error(err); }
  };

  const handleJurorSave = async () => {
    if (!session) return;
    try {
      if (editJuror) {
        await apiUpdateTrialJuror(editJuror.id, jForm);
      } else {
        await apiCreateTrialJuror({ sessionId: session.id, ...jForm });
      }
      setShowJurorForm(false);
      setEditJuror(null);
      setJForm({ seat_number: jurors.length + 1, name: "", notes: "", demographics: "", strike_type: "none", is_selected: false });
      await refreshTab("Jury");
    } catch (err) { console.error(err); }
  };

  const handleMotionSave = async () => {
    if (!session) return;
    try {
      if (editMotion) {
        await apiUpdateTrialMotion(editMotion.id, mForm);
      } else {
        await apiCreateTrialMotion({ sessionId: session.id, ...mForm });
      }
      setShowMotionForm(false);
      setEditMotion(null);
      setMForm({ title: "", type: "defense", status: "pending", ruling_summary: "", notes: "" });
      await refreshTab("Motions");
    } catch (err) { console.error(err); }
  };

  const handleInstructionSave = async () => {
    if (!session) return;
    try {
      if (editInstruction) {
        await apiUpdateTrialJuryInstruction(editInstruction.id, iForm);
      } else {
        await apiCreateTrialJuryInstruction({ sessionId: session.id, ...iForm });
      }
      setShowInstructionForm(false);
      setEditInstruction(null);
      setIForm({ instruction_text: "", status: "requested", objection_notes: "", source: "" });
      await refreshTab("Jury Instructions");
    } catch (err) { console.error(err); }
  };

  const handleEventSave = async () => {
    if (!session) return;
    try {
      if (editEvent) {
        await apiUpdateTrialTimelineEvent(editEvent.id, tForm);
      } else {
        await apiCreateTrialTimelineEvent({ sessionId: session.id, ...tForm });
      }
      setShowEventForm(false);
      setEditEvent(null);
      setTForm({ event_date: "", title: "", description: "" });
      await refreshTab("Demonstratives");
    } catch (err) { console.error(err); }
  };

  const handleLogSave = async () => {
    if (!session) return;
    try {
      await apiCreateTrialLogEntry({ sessionId: session.id, trial_day: logDay, category: lForm.category, content: lForm.content, entry_time: new Date().toISOString() });
      setShowLogForm(false);
      setLForm({ category: "note", content: "" });
      await refreshTab("Trial Log");
    } catch (err) { console.error(err); }
  };

  const handlePinDoc = async (docId) => {
    if (!session) return;
    try {
      const doc = caseDocs.find(d => d.id === docId);
      await apiCreateTrialPinnedDoc({ sessionId: session.id, case_document_id: docId, label: doc?.name || "" });
      setShowDocPicker(false);
      await refreshTab("Quick Docs");
    } catch (err) { console.error(err); }
  };

  const openDocPicker = async () => {
    if (!selectedCase) return;
    try {
      const docs = await apiGetCaseDocuments(selectedCase.id);
      setCaseDocs(docs || []);
      setShowDocPicker(true);
    } catch (err) { console.error(err); }
  };

  const handleDownloadDoc = async (docId) => {
    try {
      const blob = await apiDownloadDocument(docId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "document";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
  };

  const handleDemoUpload = async () => {
    if (!session) return;
    try {
      const fd = new FormData();
      if (demoFile) fd.append("file", demoFile);
      fd.append("sessionId", session.id);
      fd.append("title", demoForm.title);
      fd.append("description", demoForm.description);
      fd.append("association", demoForm.association);
      await apiUploadDemonstrative(fd);
      setShowDemoForm(false);
      setDemoFile(null);
      setDemoForm({ title: "", description: "", association: "general" });
      await refreshTab("Demonstratives");
    } catch (err) { console.error(err); }
  };

  const handleDemoDownload = async (item) => {
    try {
      const blob = await apiDownloadDemonstrative(item.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.file_name || "file";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
  };

  const runWitnessAi = async (w) => {
    setWitnessAiId(w.id);
    setWitnessAiLoading(true);
    setWitnessAiResult("");
    try {
      const res = await apiTrialAiWitnessPrep({
        sessionId: session.id,
        witnessName: w.name || "",
        witnessType: w.type || "",
        expectedTestimony: w.expected_testimony || "",
        impeachmentNotes: w.impeachment_notes || "",
      });
      setWitnessAiResult(res?.result || "No result returned.");
    } catch (err) {
      setWitnessAiResult("Error: " + (err.message || "AI request failed"));
    }
    setWitnessAiLoading(false);
  };

  const runJiAi = async () => {
    setJiAiLoading(true);
    setJiAiResult("");
    try {
      const res = await apiTrialAiJuryInstructions({
        sessionId: session.id,
        charges: chargesStr || "",
        defenseTheory: "",
      });
      setJiAiResult(res?.result || "No result returned.");
    } catch (err) {
      setJiAiResult("Error: " + (err.message || "AI request failed"));
    }
    setJiAiLoading(false);
  };

  const openDocViewer = async (pd) => {
    if (!pd.case_document_id) return;
    if (docViewerUrl) URL.revokeObjectURL(docViewerUrl);
    setDocViewerUrl(null);
    setTranscriptSegments([]);
    setDocViewerId(pd.id);
    setViewerTitle(pd.label || pd.document_name || "Document");
    try {
      const blob = await apiDownloadDocument(pd.case_document_id);
      const ft = (pd.file_type || pd.document_content_type || blob.type || "").toLowerCase();
      if (ft.includes("pdf") || ft.includes("image")) {
        setDocViewerUrl(URL.createObjectURL(blob));
      } else {
        const res = await apiGetDocumentText(pd.case_document_id);
        const extractedText = res?.text || "";
        const displayText = extractedText || "No text could be extracted from this document. Try downloading the file to view it in its native application.";
        setDocViewerUrl(URL.createObjectURL(new Blob([displayText], { type: "text/plain" })));
      }
    } catch (err) {
      console.error(err);
      setDocViewerId(null);
    }
  };

  const closeDocViewer = () => {
    if (docViewerUrl) URL.revokeObjectURL(docViewerUrl);
    setDocViewerUrl(null);
    setDocViewerId(null);
    setTranscriptSegments([]);
    setViewerTitle("");
  };

  const runDocSummary = async (pd) => {
    if (!pd.case_document_id) return;
    if (pd.document_summary) {
      setDocSummaries(prev => ({ ...prev, [pd.id]: pd.document_summary }));
      return;
    }
    setDocSummaryLoading(pd.id);
    try {
      const res = await apiSummarizeDocument(pd.case_document_id);
      setDocSummaries(prev => ({ ...prev, [pd.id]: res?.summary || "No summary available." }));
    } catch (err) {
      setDocSummaries(prev => ({ ...prev, [pd.id]: "Error: " + (err.message || "Summary failed") }));
    }
    setDocSummaryLoading(null);
  };

  const toggleSpeech = () => {
    if (isListening) {
      if (speechRecRef.current) speechRecRef.current.stop();
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
        setLForm(p => ({ ...p, content: p.content + (p.content && !p.content.endsWith(" ") ? " " : "") + transcript }));
      }
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    speechRecRef.current = rec;
    rec.start();
    setIsListening(true);
  };

  useEffect(() => {
    return () => { if (speechRecRef.current) speechRecRef.current.stop(); };
  }, []);

  const loadWitnessDocuments = useCallback(async (witnessList) => {
    if (!witnessList?.length) return;
    const results = {};
    await Promise.all(witnessList.map(async (w) => {
      try { results[w.id] = await apiGetWitnessDocuments(w.id); } catch { results[w.id] = []; }
    }));
    setWitnessDocuments(results);
  }, []);

  useEffect(() => {
    if (activeTab === "Witnesses" && witnesses.length > 0) {
      loadWitnessDocuments(witnesses);
    }
  }, [activeTab, witnesses, loadWitnessDocuments]);

  const handleLinkWitnessDoc = async (witnessId, docId, transcriptId) => {
    try {
      await apiLinkWitnessDocument(witnessId, {
        case_document_id: docId || null,
        transcript_id: transcriptId || null,
        label: witnessDocLabel || "",
      });
      setShowWitnessDocPicker(null);
      setWitnessDocLabel("");
      loadWitnessDocuments(witnesses);
    } catch (err) { console.error(err); }
  };

  const handleUnlinkWitnessDoc = async (linkId) => {
    try {
      await apiUnlinkWitnessDocument(linkId);
      loadWitnessDocuments(witnesses);
    } catch (err) { console.error(err); }
  };

  const exportWitnessPrep = async (witnessName) => {
    try {
      const blob = await apiExportWitnessPrep({
        witnessName,
        caseName: selectedCase?.title || "",
        caseNumber: selectedCase?.case_num || "",
        content: witnessAiResult,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Witness_Prep_${(witnessName || "Unknown").replace(/[^a-zA-Z0-9]/g, "_")}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
  };

  const openDocPickerWithTranscripts = async () => {
    if (!selectedCase) return;
    try {
      const [docs, transcripts] = await Promise.all([
        apiGetCaseDocuments(selectedCase.id),
        apiGetTranscripts(selectedCase.id).catch(() => []),
      ]);
      setCaseDocs(docs || []);
      setCaseTranscripts((transcripts || []).filter(t => t.status === "completed"));
      setShowDocPicker(true);
    } catch (err) { console.error(err); }
  };

  const openWitnessDocPicker = async (witnessId) => {
    if (!selectedCase) return;
    try {
      const [docs, transcripts] = await Promise.all([
        apiGetCaseDocuments(selectedCase.id),
        apiGetTranscripts(selectedCase.id).catch(() => []),
      ]);
      setCaseDocs(docs || []);
      setCaseTranscripts((transcripts || []).filter(t => t.status === "completed"));
      setShowWitnessDocPicker(witnessId);
      setWitnessDocLabel("");
    } catch (err) { console.error(err); }
  };

  const handlePinTranscript = async (transcriptId, name) => {
    if (!session) return;
    try {
      await apiCreateTrialPinnedDoc({ sessionId: session.id, transcript_id: transcriptId, label: name || "Transcript" });
      setShowDocPicker(false);
      await refreshTab("Quick Docs");
    } catch (err) { console.error(err); }
  };

  const handleDownloadTranscriptAudio = async (transcriptId, filename) => {
    try {
      const blob = await apiDownloadTranscriptAudio(transcriptId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "audio";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error(err); }
  };

  const viewTranscript = async (pd) => {
    if (!pd.transcript_id) return;
    if (docViewerUrl) URL.revokeObjectURL(docViewerUrl);
    setDocViewerUrl(null);
    setTranscriptSegments([]);
    setDocViewerId(pd.id);
    setViewerTitle(pd.label || pd.transcript_name || "Transcription");
    try {
      const detail = await apiGetTranscriptDetail(pd.transcript_id);
      const segments = detail?.transcript || [];
      setTranscriptSegments(segments);
    } catch (err) {
      console.error(err);
      setDocViewerId(null);
      setTranscriptSegments([]);
    }
  };

  const runOutlineAi = async (type, crossOutlineId) => {
    if (!session) return;
    setOutlineAiType(type);
    setOutlineAiCrossId(crossOutlineId || null);
    setOutlineAiLoading(true);
    setOutlineAiResult("");
    try {
      let existingDraft = "";
      if (outlineAiFile) {
        const extracted = await apiExtractOutlineFile(outlineAiFile);
        existingDraft = extracted?.extractedText || "";
      }
      if (!existingDraft) {
        if (type === "opening") existingDraft = openingText || "";
        else if (type === "closing") existingDraft = closingText || "";
        else if (type === "cross-examination" && crossOutlineId) existingDraft = crossTexts[crossOutlineId] || "";
      }

      let res;
      if (type === "opening") {
        res = await apiTrialAiOpeningBuilder({
          sessionId: session.id,
          existingDraft: existingDraft || undefined,
          customInstructions: outlineAiInstructions || undefined,
        });
      } else if (type === "closing") {
        res = await apiTrialAiClosingBuilder({
          sessionId: session.id,
          existingDraft: existingDraft || undefined,
          customInstructions: outlineAiInstructions || undefined,
        });
      } else if (type === "cross-examination") {
        const crossOutline = outlines.find(o => o.id === crossOutlineId);
        const linkedWitness = crossOutline?.linked_witness_id ? witnesses.find(w => w.id === crossOutline.linked_witness_id) : null;
        res = await apiTrialAiWitnessPrep({
          sessionId: session.id,
          witnessName: linkedWitness?.name || crossOutline?.title || "Unknown",
          witnessType: linkedWitness?.type || "",
          expectedTestimony: linkedWitness?.expected_testimony || "",
          impeachmentNotes: linkedWitness?.impeachment_notes || "",
          existingDraft: existingDraft || undefined,
        });
      }
      setOutlineAiResult(res?.result || "No result returned.");
    } catch (err) {
      setOutlineAiResult("Error: " + (err.message || "AI request failed"));
    }
    setOutlineAiLoading(false);
  };

  const insertOutlineAiResult = async (type, crossOutlineId) => {
    if (!outlineAiResult) return;
    if (type === "opening") {
      setOpeningText(outlineAiResult);
      await saveOutline("opening", outlineAiResult, openingOutline?.id);
    } else if (type === "closing") {
      setClosingText(outlineAiResult);
      await saveOutline("closing", outlineAiResult, closingOutline?.id);
    } else if (type === "cross-examination" && crossOutlineId) {
      setCrossTexts(prev => ({ ...prev, [crossOutlineId]: outlineAiResult }));
      await apiUpdateTrialOutline(crossOutlineId, { content: outlineAiResult });
      await refreshTab("Outlines");
    }
    setOutlineAiType(null);
    setOutlineAiResult("");
    setOutlineAiFile(null);
    setOutlineAiInstructions("");
  };

  const saveJiAiSuggestions = async () => {
    if (!jiAiResult || !session) return;
    const lines = jiAiResult.split("\n").filter(l => l.trim());
    const instructions = [];
    let currentInstruction = "";
    let currentSource = "";

    for (const line of lines) {
      const trimmed = line.trim();
      const isHeading = trimmed.startsWith("# ") || trimmed.startsWith("## ") || trimmed.startsWith("### ") || (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80 && /[A-Z]/.test(trimmed));
      if (isHeading) {
        if (currentInstruction.trim()) {
          instructions.push({ text: currentInstruction.trim(), source: currentSource });
        }
        currentInstruction = "";
        currentSource = "";
        continue;
      }
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.match(/^\d+\.\s/)) {
        if (currentInstruction.trim()) {
          instructions.push({ text: currentInstruction.trim(), source: currentSource });
        }
        currentInstruction = trimmed.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "");
        const apjiMatch = currentInstruction.match(/APJI\s+[\d.]+/i);
        currentSource = apjiMatch ? apjiMatch[0] : "";
      } else if (trimmed) {
        currentInstruction += " " + trimmed;
      }
    }
    if (currentInstruction.trim()) {
      instructions.push({ text: currentInstruction.trim(), source: currentSource });
    }

    if (instructions.length === 0) {
      instructions.push({ text: jiAiResult, source: "" });
    }

    try {
      for (const instr of instructions) {
        await apiCreateTrialJuryInstruction({
          sessionId: session.id,
          instruction_text: instr.text,
          source: instr.source,
          status: "requested",
        });
      }
      setJiAiResult("");
      await refreshTab("Jury Instructions");
    } catch (err) { console.error(err); }
  };

  const runAiAgent = async () => {
    if (!session || !activeAgent) return;
    setAiLoading(true);
    setAiResult("");
    try {
      let res;
      if (activeAgent === "witness-prep") {
        const w = witnesses.find(wt => String(wt.id) === String(aiWitnessId));
        res = await apiTrialAiWitnessPrep({ sessionId: session.id, witnessName: w?.name || "", witnessType: w?.type || "", expectedTestimony: w?.expected_testimony || "", impeachmentNotes: w?.impeachment_notes || "" });
      } else if (activeAgent === "jury-selection") {
        const j = jurors.find(jr => String(jr.id) === String(aiJurorId));
        res = await apiTrialAiJurySelection({ sessionId: session.id, jurorName: j?.name || "", jurorNotes: aiInput || j?.notes || "", demographics: j?.demographics || "", seatNumber: j?.seat_number || "" });
      } else if (activeAgent === "objection-coach") {
        res = await apiTrialAiObjectionCoach({ scenario: aiInput, sessionId: session.id });
      } else if (activeAgent === "closing-builder") {
        res = await apiTrialAiClosingBuilder({ sessionId: session.id });
      } else if (activeAgent === "opening-builder") {
        res = await apiTrialAiOpeningBuilder({ sessionId: session.id });
      } else if (activeAgent === "jury-instructions-ai") {
        res = await apiTrialAiJuryInstructions({ sessionId: session.id, charges: aiInput, defenseTheory: aiInput2 });
      } else if (activeAgent === "case-law") {
        res = await apiTrialAiCaseLawSearch({ legalIssue: aiInput, sessionId: session.id });
      }
      setAiResult(res?.result || "No result returned.");
    } catch (err) {
      setAiResult("Error: " + (err.message || "AI request failed"));
    }
    setAiLoading(false);
  };

  const openEditWitness = (w) => {
    setEditWitness(w);
    setWForm({ name: w.name || "", type: w.type || "prosecution", contact_info: w.contact_info || "", expected_testimony: w.expected_testimony || "", impeachment_notes: w.impeachment_notes || "", call_order: w.call_order || 1, status: w.status || "pending" });
    setShowWitnessForm(true);
  };

  const openEditExhibit = (ex) => {
    setEditExhibit(ex);
    setEForm({ exhibit_number: ex.exhibit_number || "", description: ex.description || "", type: ex.type || "physical", status: ex.status || "pending", notes: ex.notes || "" });
    setShowExhibitForm(true);
  };

  const openEditJuror = (j) => {
    setEditJuror(j);
    setJForm({ seat_number: j.seat_number || 1, name: j.name || "", notes: j.notes || "", demographics: j.demographics || "", strike_type: j.strike_type || "none", is_selected: j.is_selected || false });
    setShowJurorForm(true);
  };

  const openEditMotion = (m) => {
    setEditMotion(m);
    setMForm({ title: m.title || "", type: m.type || "defense", status: m.status || "pending", ruling_summary: m.ruling_summary || "", notes: m.notes || "" });
    setShowMotionForm(true);
  };

  const openEditInstruction = (inst) => {
    setEditInstruction(inst);
    setIForm({ instruction_text: inst.instruction_text || "", status: inst.status || "requested", objection_notes: inst.objection_notes || "", source: inst.source || "" });
    setShowInstructionForm(true);
  };

  const openEditEvent = (ev) => {
    setEditEvent(ev);
    setTForm({ event_date: ev.event_date ? ev.event_date.split("T")[0] : "", title: ev.title || "", description: ev.description || "" });
    setShowEventForm(true);
  };

  const c = selectedCase;
  const charges = c?.charges;
  const chargesStr = Array.isArray(charges) ? charges.map(ch => ch.description || ch.statute || "").filter(Boolean).join(", ") : (c?.charge_description || "");

  const dayEntries = logEntries.filter(e => e.trial_day === logDay).sort((a, b) => (b.entry_time || b.created_at || "").localeCompare(a.entry_time || a.created_at || ""));
  const maxDay = logEntries.length > 0 ? Math.max(...logEntries.map(e => e.trial_day || 1)) : 1;
  const dayOptions = [];
  for (let i = 1; i <= Math.max(maxDay, logDay) + 1; i++) dayOptions.push(i);

  const jurorSummary = {
    total: jurors.length,
    selected: jurors.filter(j => j.is_selected).length,
    peremptory: jurors.filter(j => j.strike_type === "peremptory").length,
    cause: jurors.filter(j => j.strike_type === "cause").length,
  };
  jurorSummary.remaining = jurorSummary.total - jurorSummary.selected - jurorSummary.peremptory - jurorSummary.cause;

  const openingOutline = outlines.find(o => o.type === "opening");
  const closingOutline = outlines.find(o => o.type === "closing");
  const crossOutlines = outlines.filter(o => o.type === "cross-examination");

  const [openingText, setOpeningText] = useState("");
  const [closingText, setClosingText] = useState("");
  const [crossTexts, setCrossTexts] = useState({});

  useEffect(() => {
    setOpeningText(openingOutline?.content || "");
  }, [openingOutline?.id, openingOutline?.content]);

  useEffect(() => {
    setClosingText(closingOutline?.content || "");
  }, [closingOutline?.id, closingOutline?.content]);

  useEffect(() => {
    const obj = {};
    outlines.filter(o => o.type === "cross-examination").forEach(o => { obj[o.id] = o.content || ""; });
    setCrossTexts(obj);
  }, [outlines]);

  const saveOutline = async (type, content, id) => {
    if (!session) return;
    try {
      if (id) {
        await apiUpdateTrialOutline(id, { content });
      } else {
        await apiCreateTrialOutline({ sessionId: session.id, type, title: type === "opening" ? "Opening Statement" : "Closing Argument", content });
      }
      await refreshTab("Outlines");
    } catch (err) { console.error(err); }
  };

  const addCrossOutline = async () => {
    if (!session) return;
    try {
      await apiCreateTrialOutline({ sessionId: session.id, type: "cross-examination", title: "New Cross-Examination", content: "" });
      await refreshTab("Outlines");
    } catch (err) { console.error(err); }
  };

  const categoryColors = { ruling: "bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800/50", objection: "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50", testimony: "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50", note: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600", followup: "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50" };

  return (
    <>
      <div className="topbar !bg-white dark:!bg-slate-900 !border-b-slate-200 dark:!border-b-slate-700">
        <div className="flex items-center gap-3">
          <button className="hamburger-btn" onClick={onMenuToggle}><Menu size={20} /></button>
          <div>
            <h1 className="!text-xl !font-semibold !text-slate-900 dark:!text-slate-100 !font-['Inter']">Trial Center</h1>
            <p className="!text-xs !text-slate-500 dark:!text-slate-400 !mt-0.5">Prepare and manage active trials</p>
          </div>
        </div>
        <div className="relative flex-1 max-w-md" ref={dropdownRef}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" size={16} />
          <input
            className={INPUT_CLS + " !pl-10"}
            placeholder="Search cases..."
            value={caseSearch}
            onChange={e => { setCaseSearch(e.target.value); setShowDropdown(true); }}
            onFocus={() => { if (caseSearch.trim()) setShowDropdown(true); }}
          />
          {showDropdown && filteredCases.length > 0 && (() => {
            const pinSet = new Set(pinnedCaseIds);
            const pinned = filteredCases.filter(c => pinSet.has(c.id));
            const rest = filteredCases.filter(c => !pinSet.has(c.id));
            return (
              <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {pinned.length > 0 && (
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 flex items-center gap-1">
                    <Pin size={10} /> Pinned
                  </div>
                )}
                {pinned.map(fc => (
                  <div key={fc.id} onClick={() => selectCase(fc)} className="px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-1.5">
                      <Pin size={11} className="text-amber-500 flex-shrink-0" />
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{fc.title || fc.case_num}</span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 ml-[17px]">{fc.case_num} {fc.defendant_name ? `\u2014 ${fc.defendant_name}` : ""}</div>
                  </div>
                ))}
                {pinned.length > 0 && rest.length > 0 && (
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50">All Cases</div>
                )}
                {rest.map(fc => (
                  <div key={fc.id} onClick={() => selectCase(fc)} className="px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-b-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{fc.title || fc.case_num}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{fc.case_num} {fc.defendant_name ? `\u2014 ${fc.defendant_name}` : ""}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
      <div className="content">
      <div className="space-y-4">

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-slate-400" size={32} />
        </div>
      )}

      {session && c && !loading && (
        <>
          <div className={CARD_CLS + " p-5"}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{c.title || c.case_num}</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">{c.case_num}</p>
              </div>
              {c.status && <span className={BADGE_CLS + " bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50"}>{c.status}</span>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className={LABEL_CLS}>Charges</span>
                <p className="text-slate-900 dark:text-slate-100 text-xs">{chargesStr || "\u2014"}</p>
              </div>
              <div>
                <span className={LABEL_CLS}>Court</span>
                <p className="text-slate-900 dark:text-slate-100">{c.court || "\u2014"}</p>
              </div>
              <div>
                <span className={LABEL_CLS}>Judge</span>
                <p className="text-slate-900 dark:text-slate-100">{c.judge || "\u2014"}</p>
              </div>
              <div>
                <span className={LABEL_CLS}>Next Court Date</span>
                <p className="text-slate-900 dark:text-slate-100">{fmtDate(c.next_court_date)}</p>
              </div>
              <div>
                <span className={LABEL_CLS}>Client</span>
                <p className="text-slate-900 dark:text-slate-100">{c.defendant_name || "\u2014"}</p>
              </div>
              <div>
                <span className={LABEL_CLS}>Custody Status</span>
                <p className="text-slate-900 dark:text-slate-100">{c.custody_status || "\u2014"}</p>
              </div>
              <div>
                <span className={LABEL_CLS}>Bond</span>
                <p className="text-slate-900 dark:text-slate-100">{c.bond_amount ? `$${Number(c.bond_amount).toLocaleString()}` : "\u2014"}</p>
              </div>
            </div>
          </div>

          <div className="border-b border-slate-200 dark:border-slate-700 flex overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-2">
            {activeTab === "Witnesses" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Witnesses ({witnesses.length})</h3>
                  <button onClick={() => { setEditWitness(null); setWForm({ name: "", type: "prosecution", contact_info: "", expected_testimony: "", impeachment_notes: "", call_order: witnesses.length + 1, status: "pending" }); setShowWitnessForm(true); }} className={BTN_CLS + " flex items-center gap-1.5"}><Plus size={14} /> Add Witness</button>
                </div>
                {showWitnessForm && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LABEL_CLS}>Name</label><input className={INPUT_CLS} value={wForm.name} onChange={e => setWForm({ ...wForm, name: e.target.value })} /></div>
                      <div><label className={LABEL_CLS}>Type</label><select className={INPUT_CLS} value={wForm.type} onChange={e => setWForm({ ...wForm, type: e.target.value })}><option value="prosecution">Prosecution</option><option value="defense">Defense</option></select></div>
                      <div><label className={LABEL_CLS}>Contact Info</label><input className={INPUT_CLS} value={wForm.contact_info} onChange={e => setWForm({ ...wForm, contact_info: e.target.value })} /></div>
                      <div><label className={LABEL_CLS}>Call Order</label><input type="number" className={INPUT_CLS} value={wForm.call_order} onChange={e => setWForm({ ...wForm, call_order: parseInt(e.target.value) || 1 })} /></div>
                      <div><label className={LABEL_CLS}>Status</label><select className={INPUT_CLS} value={wForm.status} onChange={e => setWForm({ ...wForm, status: e.target.value })}><option value="pending">Pending</option><option value="called">Called</option><option value="excused">Excused</option></select></div>
                    </div>
                    <div><label className={LABEL_CLS}>Expected Testimony</label><textarea className={INPUT_CLS + " h-20"} value={wForm.expected_testimony} onChange={e => setWForm({ ...wForm, expected_testimony: e.target.value })} /></div>
                    <div><label className={LABEL_CLS}>Impeachment Notes</label><textarea className={INPUT_CLS + " h-20"} value={wForm.impeachment_notes} onChange={e => setWForm({ ...wForm, impeachment_notes: e.target.value })} /></div>
                    <div className="flex gap-2">
                      <button onClick={handleWitnessSave} className={BTN_CLS}>{editWitness ? "Update" : "Save"}</button>
                      <button onClick={() => { setShowWitnessForm(false); setEditWitness(null); }} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {witnesses.map((w, idx) => (
                    <React.Fragment key={w.id}>
                    <div className={CARD_CLS + " p-3"}>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono text-slate-400 w-6 text-center">{w.call_order || idx + 1}</span>
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{w.name}</span>
                            <span className={BADGE_CLS + (w.type === "prosecution" ? " bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50" : " bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50")}>{w.type}</span>
                            <span className={BADGE_CLS + (w.status === "called" ? " bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50" : w.status === "excused" ? " bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600" : " bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50")}>{w.status}</span>
                          </div>
                          {w.expected_testimony && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{w.expected_testimony}</p>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => openWitnessDocPicker(w.id)} className="p-1 text-indigo-500 hover:text-indigo-700" title="Link Document"><Pin size={14} /></button>
                          <button onClick={() => runWitnessAi(w)} className="px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1" title="Witness Prep AI"><Sparkles size={10} /> Prep</button>
                          <button onClick={() => handleWitnessReorder(idx, -1)} className="p-1 text-slate-400 hover:text-slate-600"><ChevronUp size={14} /></button>
                          <button onClick={() => handleWitnessReorder(idx, 1)} className="p-1 text-slate-400 hover:text-slate-600"><ChevronDown size={14} /></button>
                          <button onClick={() => openEditWitness(w)} className="p-1 text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>
                          <button onClick={async () => { await apiDeleteTrialWitness(w.id); refreshTab("Witnesses"); }} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      {(witnessDocuments[w.id] || []).length > 0 && (
                        <div className="ml-9 mt-2 flex flex-wrap gap-1.5">
                          {witnessDocuments[w.id].map(wd => (
                            <div key={wd.id} className="flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 text-xs">
                              <FileText size={10} className="text-indigo-500 flex-shrink-0" />
                              <span className="text-indigo-700 dark:text-indigo-300 truncate max-w-[150px]">{wd.document_name || wd.transcript_name || wd.label || "Document"}</span>
                              {wd.label && <span className="text-indigo-400 dark:text-indigo-500">({wd.label})</span>}
                              {wd.case_document_id && <button onClick={() => { apiDownloadDocument(wd.case_document_id).then(blob => { const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = wd.document_name || "file"; a.click(); URL.revokeObjectURL(u); }); }} className="text-indigo-400 hover:text-indigo-600"><Download size={10} /></button>}
                              {wd.transcript_id && <button onClick={() => handleDownloadTranscriptAudio(wd.transcript_id, wd.transcript_name)} className="text-indigo-400 hover:text-indigo-600"><Download size={10} /></button>}
                              <button onClick={() => handleUnlinkWitnessDoc(wd.id)} className="text-red-400 hover:text-red-600"><X size={10} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      {showWitnessDocPicker === w.id && (
                        <div className="ml-9 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-medium text-slate-700 dark:text-slate-300">Link Document to {w.name}</h4>
                            <button onClick={() => setShowWitnessDocPicker(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                          </div>
                          <div className="mb-2">
                            <select className={INPUT_CLS + " text-xs"} value={witnessDocLabel} onChange={e => setWitnessDocLabel(e.target.value)}>
                              <option value="">No Label</option>
                              <option value="Police Report">Police Report</option>
                              <option value="Medical Report">Medical Report</option>
                              <option value="Witness Statement">Witness Statement</option>
                              <option value="Audio Recording">Audio Recording</option>
                              <option value="Transcript">Transcript</option>
                              <option value="Lab Report">Lab Report</option>
                              <option value="Expert Report">Expert Report</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                          <div className="max-h-48 overflow-y-auto space-y-0.5">
                            {pinnedDocs.filter(pd => pd.case_document_id || pd.transcript_id).length > 0 && <p className="text-[10px] font-semibold uppercase text-emerald-500 px-2 pt-1">Quick Docs</p>}
                            {pinnedDocs.filter(pd => pd.case_document_id || pd.transcript_id).map(pd => (
                              <div key={`qd-${pd.id}`} onClick={() => handleLinkWitnessDoc(w.id, pd.case_document_id || null, pd.transcript_id || null)} className="px-2 py-1.5 rounded cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                <Pin size={10} className="text-emerald-500 flex-shrink-0" />{pd.label || pd.document_name || pd.transcript_name || "Document"}
                              </div>
                            ))}
                            {caseDocs.length > 0 && <p className="text-[10px] font-semibold uppercase text-slate-400 px-2 pt-1">Documents</p>}
                            {caseDocs.map(doc => (
                              <div key={`doc-${doc.id}`} onClick={() => handleLinkWitnessDoc(w.id, doc.id, null)} className="px-2 py-1.5 rounded cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                <FileText size={10} className="text-slate-400 flex-shrink-0" />{doc.name || doc.filename}
                              </div>
                            ))}
                            {caseTranscripts.length > 0 && <p className="text-[10px] font-semibold uppercase text-slate-400 px-2 pt-1">Transcriptions</p>}
                            {caseTranscripts.map(t => (
                              <div key={`tr-${t.id}`} onClick={() => handleLinkWitnessDoc(w.id, null, t.id)} className="px-2 py-1.5 rounded cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                <Mic size={10} className="text-violet-400 flex-shrink-0" />{t.filename}
                              </div>
                            ))}
                            {caseDocs.length === 0 && caseTranscripts.length === 0 && pinnedDocs.length === 0 && <p className="text-xs text-slate-400 text-center py-2">No documents found.</p>}
                          </div>
                        </div>
                      )}
                    </div>
                    {witnessAiId === w.id && (
                      <div className="ml-9 mb-2">
                        {witnessAiLoading ? (
                          <div className="flex items-center gap-2 text-sm text-slate-500 py-3"><Loader2 size={14} className="animate-spin" /> Generating witness prep...</div>
                        ) : witnessAiResult && (
                          <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100 max-h-[400px] overflow-y-auto">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1"><Sparkles size={10} /> Witness Prep AI</span>
                              <div className="flex items-center gap-1">
                                <button onClick={() => exportWitnessPrep(w.name)} className="px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center gap-1" title="Save as Word Doc"><Download size={10} /> .docx</button>
                                <button onClick={() => { setWitnessAiId(null); setWitnessAiResult(""); }} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                              </div>
                            </div>
                            {witnessAiResult}
                          </div>
                        )}
                      </div>
                    )}
                    </React.Fragment>
                  ))}
                  {witnesses.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No witnesses added yet.</p>}
                </div>
              </div>
            )}

            {activeTab === "Exhibits" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Exhibits ({exhibits.length})</h3>
                  <button onClick={() => { setEditExhibit(null); setEForm({ exhibit_number: "", description: "", type: "physical", status: "pending", notes: "" }); setShowExhibitForm(true); }} className={BTN_CLS + " flex items-center gap-1.5"}><Plus size={14} /> Add Exhibit</button>
                </div>
                {showExhibitForm && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LABEL_CLS}>Exhibit Number</label><input className={INPUT_CLS} value={eForm.exhibit_number} onChange={e => setEForm({ ...eForm, exhibit_number: e.target.value })} /></div>
                      <div><label className={LABEL_CLS}>Type</label><select className={INPUT_CLS} value={eForm.type} onChange={e => setEForm({ ...eForm, type: e.target.value })}><option value="physical">Physical</option><option value="documentary">Documentary</option><option value="demonstrative">Demonstrative</option><option value="digital">Digital</option></select></div>
                      <div><label className={LABEL_CLS}>Status</label><select className={INPUT_CLS} value={eForm.status} onChange={e => setEForm({ ...eForm, status: e.target.value })}><option value="pending">Pending</option><option value="admitted">Admitted</option><option value="objected">Objected</option><option value="excluded">Excluded</option></select></div>
                    </div>
                    <div><label className={LABEL_CLS}>Description</label><input className={INPUT_CLS} value={eForm.description} onChange={e => setEForm({ ...eForm, description: e.target.value })} /></div>
                    <div><label className={LABEL_CLS}>Notes</label><textarea className={INPUT_CLS + " h-20"} value={eForm.notes} onChange={e => setEForm({ ...eForm, notes: e.target.value })} /></div>
                    {!editExhibit && (
                      <div>
                        <label className={LABEL_CLS}>Attach Document</label>
                        <div className="flex items-center gap-2">
                          <label className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-1.5">
                            <Upload size={12} /> Choose File
                            <input type="file" className="hidden" onChange={e => setExhibitFile(e.target.files?.[0] || null)} />
                          </label>
                          {exhibitFile && <span className="text-xs text-slate-500 truncate max-w-[200px]">{exhibitFile.name}</span>}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button onClick={handleExhibitSave} className={BTN_CLS}>{editExhibit ? "Update" : "Save"}</button>
                      <button onClick={() => { setShowExhibitForm(false); setEditExhibit(null); setExhibitFile(null); }} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className={CARD_CLS + " overflow-x-auto"}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">No.</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Description</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Type</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Document</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exhibits.map(ex => (
                        <tr key={ex.id} className="border-b border-slate-100 dark:border-slate-700 last:border-b-0">
                          <td className="px-4 py-2.5 font-mono text-slate-900 dark:text-slate-100">{ex.exhibit_number}</td>
                          <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">{ex.description}</td>
                          <td className="px-4 py-2.5"><span className={BADGE_CLS + " bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600"}>{ex.type}</span></td>
                          <td className="px-4 py-2.5"><span className={BADGE_CLS + (ex.status === "admitted" ? " bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50" : ex.status === "objected" ? " bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50" : ex.status === "excluded" ? " bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600" : " bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50")}>{ex.status}</span></td>
                          <td className="px-4 py-2.5">
                            {ex.linked_document_id ? (
                              <button onClick={() => handleDownloadDoc(ex.linked_document_id)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"><Download size={12} /> {ex.document_name || "Download"}</button>
                            ) : <span className="text-xs text-slate-400">&mdash;</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button onClick={() => openEditExhibit(ex)} className="p-1 text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>
                            <button onClick={async () => { await apiDeleteTrialExhibit(ex.id); refreshTab("Exhibits"); }} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {exhibits.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No exhibits added yet.</p>}
                </div>
              </div>
            )}

            {activeTab === "Jury" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Jury Panel</h3>
                  <button onClick={() => { setEditJuror(null); setJForm({ seat_number: jurors.length + 1, name: "", notes: "", demographics: "", strike_type: "none", is_selected: false }); setShowJurorForm(true); }} className={BTN_CLS + " flex items-center gap-1.5"}><Plus size={14} /> Add Juror</button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <div className={CARD_CLS + " p-3 text-center"}><p className="text-xs text-slate-500 dark:text-slate-400">Total</p><p className="text-xl font-bold text-slate-900 dark:text-slate-100">{jurorSummary.total}</p></div>
                  <div className={CARD_CLS + " p-3 text-center"}><p className="text-xs text-emerald-600">Selected</p><p className="text-xl font-bold text-emerald-600">{jurorSummary.selected}</p></div>
                  <div className={CARD_CLS + " p-3 text-center"}><p className="text-xs text-red-600">Peremptory</p><p className="text-xl font-bold text-red-600">{jurorSummary.peremptory}</p></div>
                  <div className={CARD_CLS + " p-3 text-center"}><p className="text-xs text-amber-600">Cause</p><p className="text-xl font-bold text-amber-600">{jurorSummary.cause}</p></div>
                  <div className={CARD_CLS + " p-3 text-center"}><p className="text-xs text-slate-500 dark:text-slate-400">Remaining</p><p className="text-xl font-bold text-slate-900 dark:text-slate-100">{jurorSummary.remaining}</p></div>
                </div>
                {showJurorForm && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LABEL_CLS}>Seat Number</label><input type="number" className={INPUT_CLS} value={jForm.seat_number} onChange={e => setJForm({ ...jForm, seat_number: parseInt(e.target.value) || 1 })} /></div>
                      <div><label className={LABEL_CLS}>Name</label><input className={INPUT_CLS} value={jForm.name} onChange={e => setJForm({ ...jForm, name: e.target.value })} /></div>
                      <div><label className={LABEL_CLS}>Demographics</label><input className={INPUT_CLS} value={jForm.demographics} onChange={e => setJForm({ ...jForm, demographics: e.target.value })} /></div>
                      <div><label className={LABEL_CLS}>Strike Type</label><select className={INPUT_CLS} value={jForm.strike_type} onChange={e => setJForm({ ...jForm, strike_type: e.target.value })}><option value="none">None</option><option value="peremptory">Peremptory</option><option value="cause">Cause</option></select></div>
                    </div>
                    <div><label className={LABEL_CLS}>Notes</label><textarea className={INPUT_CLS + " h-20"} value={jForm.notes} onChange={e => setJForm({ ...jForm, notes: e.target.value })} /></div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={jForm.is_selected} onChange={e => setJForm({ ...jForm, is_selected: e.target.checked })} className="rounded" />
                      <label className="text-sm text-slate-700 dark:text-slate-300">Selected for Jury</label>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleJurorSave} className={BTN_CLS}>{editJuror ? "Update" : "Save"}</button>
                      <button onClick={() => { setShowJurorForm(false); setEditJuror(null); }} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {jurors.map(j => (
                    <div key={j.id} className={`bg-white dark:bg-slate-800 rounded-xl shadow-sm p-3 border-2 ${j.is_selected ? "border-emerald-500" : j.strike_type === "peremptory" ? "border-red-500" : j.strike_type === "cause" ? "border-amber-500" : "border-slate-200 dark:border-slate-700"}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono text-slate-400">Seat {j.seat_number}</span>
                        <div className="flex gap-1">
                          <button onClick={() => openEditJuror(j)} className="text-slate-400 hover:text-slate-600"><Pencil size={12} /></button>
                          <button onClick={async () => { await apiDeleteTrialJuror(j.id); refreshTab("Jury"); }} className="text-red-500 hover:text-red-700"><Trash2 size={12} /></button>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{j.name}</p>
                      {j.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{j.notes}</p>}
                      {j.strike_type && j.strike_type !== "none" && <span className={BADGE_CLS + " mt-1 inline-block " + (j.strike_type === "peremptory" ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50" : "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50")}>{j.strike_type} strike</span>}
                      {j.is_selected && <span className={BADGE_CLS + " mt-1 inline-block bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50"}>Selected</span>}
                    </div>
                  ))}
                </div>
                {jurors.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No jurors added yet.</p>}
              </div>
            )}

            {activeTab === "Motions" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Motions ({motions.length})</h3>
                  <button onClick={() => { setEditMotion(null); setMForm({ title: "", type: "defense", status: "pending", ruling_summary: "", notes: "" }); setShowMotionForm(true); }} className={BTN_CLS + " flex items-center gap-1.5"}><Plus size={14} /> Add Motion</button>
                </div>
                {showMotionForm && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LABEL_CLS}>Title</label><input className={INPUT_CLS} value={mForm.title} onChange={e => setMForm({ ...mForm, title: e.target.value })} /></div>
                      <div><label className={LABEL_CLS}>Type</label><select className={INPUT_CLS} value={mForm.type} onChange={e => setMForm({ ...mForm, type: e.target.value })}><option value="defense">Defense</option><option value="prosecution">Prosecution</option></select></div>
                      <div><label className={LABEL_CLS}>Status</label><select className={INPUT_CLS} value={mForm.status} onChange={e => setMForm({ ...mForm, status: e.target.value })}><option value="pending">Pending</option><option value="granted">Granted</option><option value="denied">Denied</option></select></div>
                    </div>
                    <div><label className={LABEL_CLS}>Ruling Summary</label><textarea className={INPUT_CLS + " h-20"} value={mForm.ruling_summary} onChange={e => setMForm({ ...mForm, ruling_summary: e.target.value })} /></div>
                    <div><label className={LABEL_CLS}>Notes</label><textarea className={INPUT_CLS + " h-20"} value={mForm.notes} onChange={e => setMForm({ ...mForm, notes: e.target.value })} /></div>
                    <div className="flex gap-2">
                      <button onClick={handleMotionSave} className={BTN_CLS}>{editMotion ? "Update" : "Save"}</button>
                      <button onClick={() => { setShowMotionForm(false); setEditMotion(null); }} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {motions.map(m => (
                    <div key={m.id} className={CARD_CLS + " p-3 flex items-center gap-3"}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{m.title}</span>
                          <span className={BADGE_CLS + (m.type === "defense" ? " bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50" : " bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50")}>{m.type}</span>
                          <span className={BADGE_CLS + (m.status === "granted" ? " bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50" : m.status === "denied" ? " bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50" : " bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50")}>{m.status}</span>
                        </div>
                        {m.ruling_summary && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{m.ruling_summary}</p>}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => openEditMotion(m)} className="p-1 text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>
                        <button onClick={async () => { await apiDeleteTrialMotion(m.id); refreshTab("Motions"); }} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                  {motions.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No motions added yet.</p>}
                </div>
              </div>
            )}

            {activeTab === "Outlines" && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Opening Statement</h3>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setOutlineAiType(outlineAiType === "opening" ? null : "opening"); setOutlineAiResult(""); setOutlineAiFile(null); setOutlineAiInstructions(""); }} className="px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1"><Sparkles size={10} /> AI Assist</button>
                      <button onClick={() => saveOutline("opening", openingText, openingOutline?.id)} className={BTN_CLS + " text-xs"}>Save</button>
                    </div>
                  </div>
                  {outlineAiType === "opening" && (
                    <div className="mb-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md cursor-pointer hover:bg-slate-100">
                          <Upload size={10} /> Upload .docx
                          <input type="file" accept=".docx,.txt" className="hidden" onChange={e => setOutlineAiFile(e.target.files?.[0] || null)} />
                        </label>
                        {outlineAiFile && <span className="text-xs text-slate-500 truncate max-w-[200px]">{outlineAiFile.name}</span>}
                      </div>
                      <textarea className={INPUT_CLS + " h-16 text-xs"} value={outlineAiInstructions} onChange={e => setOutlineAiInstructions(e.target.value)} placeholder="Optional: specific instructions for the AI..." />
                      <button onClick={() => runOutlineAi("opening")} disabled={outlineAiLoading} className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md flex items-center gap-1">{outlineAiLoading && outlineAiType === "opening" ? <><Loader2 size={10} className="animate-spin" /> Generating...</> : "Generate"}</button>
                      {outlineAiResult && outlineAiType === "opening" && (
                        <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 whitespace-pre-wrap text-xs text-slate-900 dark:text-slate-100 max-h-[300px] overflow-y-auto">
                          {outlineAiResult}
                          <div className="flex gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                            <button onClick={() => insertOutlineAiResult("opening")} className="px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md">Insert into Outline</button>
                            <button onClick={() => { setOutlineAiType(null); setOutlineAiResult(""); }} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700">Dismiss</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <textarea className={INPUT_CLS + " h-40"} value={openingText} onChange={e => setOpeningText(e.target.value)} placeholder="Draft your opening statement outline..." />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Closing Argument</h3>
                    <div className="flex items-center gap-1">
                      <button onClick={() => { setOutlineAiType(outlineAiType === "closing" ? null : "closing"); setOutlineAiResult(""); setOutlineAiFile(null); setOutlineAiInstructions(""); }} className="px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1"><Sparkles size={10} /> AI Assist</button>
                      <button onClick={() => saveOutline("closing", closingText, closingOutline?.id)} className={BTN_CLS + " text-xs"}>Save</button>
                    </div>
                  </div>
                  {outlineAiType === "closing" && (
                    <div className="mb-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md cursor-pointer hover:bg-slate-100">
                          <Upload size={10} /> Upload .docx
                          <input type="file" accept=".docx,.txt" className="hidden" onChange={e => setOutlineAiFile(e.target.files?.[0] || null)} />
                        </label>
                        {outlineAiFile && <span className="text-xs text-slate-500 truncate max-w-[200px]">{outlineAiFile.name}</span>}
                      </div>
                      <textarea className={INPUT_CLS + " h-16 text-xs"} value={outlineAiInstructions} onChange={e => setOutlineAiInstructions(e.target.value)} placeholder="Optional: specific instructions for the AI..." />
                      <button onClick={() => runOutlineAi("closing")} disabled={outlineAiLoading} className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md flex items-center gap-1">{outlineAiLoading && outlineAiType === "closing" ? <><Loader2 size={10} className="animate-spin" /> Generating...</> : "Generate"}</button>
                      {outlineAiResult && outlineAiType === "closing" && (
                        <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 whitespace-pre-wrap text-xs text-slate-900 dark:text-slate-100 max-h-[300px] overflow-y-auto">
                          {outlineAiResult}
                          <div className="flex gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                            <button onClick={() => insertOutlineAiResult("closing")} className="px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md">Insert into Outline</button>
                            <button onClick={() => { setOutlineAiType(null); setOutlineAiResult(""); }} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700">Dismiss</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <textarea className={INPUT_CLS + " h-40"} value={closingText} onChange={e => setClosingText(e.target.value)} placeholder="Draft your closing argument outline..." />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cross-Examination Outlines</h3>
                    <button onClick={addCrossOutline} className={BTN_CLS + " flex items-center gap-1.5 text-xs"}><Plus size={14} /> Add Outline</button>
                  </div>
                  <div className="space-y-3">
                    {crossOutlines.map(o => (
                      <div key={o.id} className={CARD_CLS + " p-4"}>
                        <div className="flex items-center justify-between mb-2">
                          <input className={INPUT_CLS + " max-w-xs text-sm font-medium"} value={o.title} onChange={async (e) => { await apiUpdateTrialOutline(o.id, { title: e.target.value }); refreshTab("Outlines"); }} />
                          <div className="flex gap-1">
                            <button onClick={() => { setOutlineAiType(outlineAiType === `cross-${o.id}` ? null : `cross-${o.id}`); setOutlineAiCrossId(o.id); setOutlineAiResult(""); setOutlineAiFile(null); setOutlineAiInstructions(""); }} className="px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1"><Sparkles size={10} /> AI Assist</button>
                            <button onClick={() => { const val = crossTexts[o.id] || ""; apiUpdateTrialOutline(o.id, { content: val }).then(() => refreshTab("Outlines")); }} className={BTN_CLS + " text-xs"}>Save</button>
                            <button onClick={async () => { await apiDeleteTrialOutline(o.id); refreshTab("Outlines"); }} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                          </div>
                        </div>
                        {outlineAiType === `cross-${o.id}` && (
                          <div className="mb-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md cursor-pointer hover:bg-slate-100">
                                <Upload size={10} /> Upload .docx
                                <input type="file" accept=".docx,.txt" className="hidden" onChange={e => setOutlineAiFile(e.target.files?.[0] || null)} />
                              </label>
                              {outlineAiFile && <span className="text-xs text-slate-500 truncate max-w-[200px]">{outlineAiFile.name}</span>}
                            </div>
                            <textarea className={INPUT_CLS + " h-16 text-xs"} value={outlineAiInstructions} onChange={e => setOutlineAiInstructions(e.target.value)} placeholder="Optional: specific instructions for the AI..." />
                            <button onClick={() => runOutlineAi("cross-examination", o.id)} disabled={outlineAiLoading} className="px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md flex items-center gap-1">{outlineAiLoading && outlineAiType === `cross-${o.id}` ? <><Loader2 size={10} className="animate-spin" /> Generating...</> : "Generate"}</button>
                            {outlineAiResult && outlineAiType === `cross-${o.id}` && (
                              <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 whitespace-pre-wrap text-xs text-slate-900 dark:text-slate-100 max-h-[300px] overflow-y-auto">
                                {outlineAiResult}
                                <div className="flex gap-2 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                  <button onClick={() => insertOutlineAiResult("cross-examination", o.id)} className="px-2 py-1 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md">Insert into Outline</button>
                                  <button onClick={() => { setOutlineAiType(null); setOutlineAiResult(""); }} className="px-2 py-1 text-xs text-slate-500 hover:text-slate-700">Dismiss</button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <textarea className={INPUT_CLS + " h-32"} value={crossTexts[o.id] || ""} onChange={e => setCrossTexts({ ...crossTexts, [o.id]: e.target.value })} placeholder="Cross-examination outline..." />
                      </div>
                    ))}
                    {crossOutlines.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No cross-examination outlines yet.</p>}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "Jury Instructions" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Jury Instructions ({juryInstructions.length})</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={runJiAi} disabled={jiAiLoading} className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800/50 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/50 flex items-center gap-1">{jiAiLoading ? <><Loader2 size={10} className="animate-spin" /> Suggesting...</> : <><Sparkles size={10} /> Suggest Instructions</>}</button>
                    <button onClick={() => { setEditInstruction(null); setIForm({ instruction_text: "", status: "requested", objection_notes: "", source: "" }); setShowInstructionForm(true); }} className={BTN_CLS + " flex items-center gap-1.5"}><Plus size={14} /> Add Instruction</button>
                  </div>
                </div>
                {jiAiResult && (
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700 whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100 max-h-[400px] overflow-y-auto">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1"><Sparkles size={10} /> AI Suggested Instructions</span>
                      <div className="flex items-center gap-1">
                        <button onClick={saveJiAiSuggestions} className="px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800/50 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/50 flex items-center gap-1"><Download size={10} /> Save All Suggestions</button>
                        <button onClick={() => setJiAiResult("")} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                      </div>
                    </div>
                    {jiAiResult}
                  </div>
                )}
                {showInstructionForm && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <div><label className={LABEL_CLS}>Instruction Text</label><textarea className={INPUT_CLS + " h-24"} value={iForm.instruction_text} onChange={e => setIForm({ ...iForm, instruction_text: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LABEL_CLS}>Status</label><select className={INPUT_CLS} value={iForm.status} onChange={e => setIForm({ ...iForm, status: e.target.value })}><option value="requested">Requested</option><option value="given">Given</option><option value="refused">Refused</option></select></div>
                      <div><label className={LABEL_CLS}>Source</label><input className={INPUT_CLS} value={iForm.source} onChange={e => setIForm({ ...iForm, source: e.target.value })} placeholder="e.g., APJI 1.01" /></div>
                    </div>
                    <div><label className={LABEL_CLS}>Objection Notes</label><textarea className={INPUT_CLS + " h-20"} value={iForm.objection_notes} onChange={e => setIForm({ ...iForm, objection_notes: e.target.value })} /></div>
                    <div className="flex gap-2">
                      <button onClick={handleInstructionSave} className={BTN_CLS}>{editInstruction ? "Update" : "Save"}</button>
                      <button onClick={() => { setShowInstructionForm(false); setEditInstruction(null); }} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {juryInstructions.map(inst => (
                    <div key={inst.id} className={CARD_CLS + " p-3 flex items-center gap-3"}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={BADGE_CLS + (inst.status === "given" ? " bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50" : inst.status === "refused" ? " bg-red-50 text-red-600 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50" : " bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50")}>{inst.status}</span>
                          {inst.source && <span className="text-xs text-slate-400">{inst.source}</span>}
                        </div>
                        <p className="text-sm text-slate-900 dark:text-slate-100 truncate">{inst.instruction_text}</p>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => openEditInstruction(inst)} className="p-1 text-slate-400 hover:text-slate-600"><Pencil size={14} /></button>
                        <button onClick={async () => { await apiDeleteTrialJuryInstruction(inst.id); refreshTab("Jury Instructions"); }} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                  {juryInstructions.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No jury instructions added yet.</p>}
                </div>
              </div>
            )}

            {activeTab === "Demonstratives" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Demonstratives ({timelineEvents.length})</h3>
                  <button onClick={() => { setShowDemoForm(true); setDemoFile(null); setDemoForm({ title: "", description: "", association: "general" }); }} className={BTN_CLS + " flex items-center gap-1.5"}><Plus size={14} /> Add Demonstrative</button>
                </div>
                {showDemoForm && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={LABEL_CLS}>Title</label><input className={INPUT_CLS} value={demoForm.title} onChange={e => setDemoForm({ ...demoForm, title: e.target.value })} /></div>
                      <div>
                        <label className={LABEL_CLS}>Association</label>
                        <select className={INPUT_CLS} value={demoForm.association} onChange={e => setDemoForm({ ...demoForm, association: e.target.value })}>
                          <option value="general">General</option>
                          <option value="opening">Opening Statement</option>
                          <option value="closing">Closing Argument</option>
                          {witnesses.map(w => <option key={w.id} value={`witness-${w.id}`}>{w.name} (Witness)</option>)}
                        </select>
                      </div>
                    </div>
                    <div><label className={LABEL_CLS}>Description</label><textarea className={INPUT_CLS + " h-20"} value={demoForm.description} onChange={e => setDemoForm({ ...demoForm, description: e.target.value })} /></div>
                    <div>
                      <label className={LABEL_CLS}>Upload File</label>
                      <div className="flex items-center gap-2">
                        <label className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-600 flex items-center gap-1.5">
                          <Upload size={12} /> Choose File
                          <input type="file" className="hidden" onChange={e => setDemoFile(e.target.files?.[0] || null)} />
                        </label>
                        {demoFile && <span className="text-xs text-slate-500 truncate max-w-[200px]">{demoFile.name}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleDemoUpload} className={BTN_CLS}>Upload</button>
                      <button onClick={() => { setShowDemoForm(false); setDemoFile(null); }} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {timelineEvents.map(ev => {
                    const assocLabel = ev.association === "opening" ? "Opening Statement" : ev.association === "closing" ? "Closing Argument" : ev.association === "general" ? "General" : ev.association?.startsWith("witness-") ? (witnesses.find(w => String(w.id) === ev.association.split("-")[1])?.name || "Witness") : "General";
                    return (
                      <div key={ev.id} className={CARD_CLS + " p-4"}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{ev.title}</p>
                            <span className={BADGE_CLS + " bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800/50 mt-1 inline-block"}>{assocLabel}</span>
                          </div>
                          <div className="flex gap-1 flex-shrink-0">
                            {ev.file_name && <button onClick={() => handleDemoDownload(ev)} className="p-1 text-slate-400 hover:text-slate-600" title="Download"><Download size={14} /></button>}
                            <button onClick={async () => { await apiDeleteTrialTimelineEvent(ev.id); refreshTab("Demonstratives"); }} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                          </div>
                        </div>
                        {ev.description && <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{ev.description}</p>}
                        {ev.file_name && <p className="text-xs text-slate-400 flex items-center gap-1"><FileText size={10} /> {ev.file_name}</p>}
                      </div>
                    );
                  })}
                </div>
                {timelineEvents.length === 0 && !showDemoForm && <p className="text-sm text-slate-400 text-center py-8">No demonstratives uploaded yet.</p>}
              </div>
            )}

            {activeTab === "Quick Docs" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Quick Docs ({pinnedDocs.length})</h3>
                  <button onClick={openDocPickerWithTranscripts} className={BTN_CLS + " flex items-center gap-1.5"}><Pin size={14} /> Pin Document</button>
                </div>
                {showDocPicker && (
                  <div className={CARD_CLS + " p-4"}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Select Document or Transcription to Pin</h4>
                      <button onClick={() => setShowDocPicker(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-1">
                      {caseDocs.length > 0 && <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-3 pt-1">Documents</p>}
                      {caseDocs.map(doc => (
                        <div key={`doc-${doc.id}`} onClick={() => handlePinDoc(doc.id)} className="px-3 py-2 rounded-md cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          <FileText size={12} className="text-slate-400 flex-shrink-0" />{doc.name || doc.filename}
                        </div>
                      ))}
                      {caseTranscripts.length > 0 && <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-400 px-3 pt-2">Transcriptions</p>}
                      {caseTranscripts.map(t => (
                        <div key={`tr-${t.id}`} onClick={() => handlePinTranscript(t.id, t.filename)} className="px-3 py-2 rounded-md cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                          <Mic size={12} className="text-violet-400 flex-shrink-0" />{t.filename}
                        </div>
                      ))}
                      {caseDocs.length === 0 && caseTranscripts.length === 0 && <p className="text-sm text-slate-400 text-center py-4">No documents or transcriptions found for this case.</p>}
                    </div>
                  </div>
                )}
                {docViewerId && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeDocViewer}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{viewerTitle || "Viewer"}</h4>
                        <button onClick={closeDocViewer} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><X size={18} /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-5">
                        {!docViewerUrl && transcriptSegments.length === 0 && (
                          <div className="flex items-center justify-center py-20"><Loader2 size={28} className="animate-spin text-slate-400" /></div>
                        )}
                        {docViewerUrl && transcriptSegments.length === 0 && (
                          <iframe src={docViewerUrl} className="w-full h-[70vh] rounded-lg border border-slate-200 dark:border-slate-700" title="Document Viewer" />
                        )}
                        {transcriptSegments.length > 0 && (() => {
                          const speakerColors = ["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#ec4899","#0ea5e9","#f97316"];
                          const speakers = [...new Set(transcriptSegments.map(s => s.speaker || "Speaker"))];
                          const getSpeakerColor = (sp) => speakerColors[speakers.indexOf(sp) % speakerColors.length];
                          const fmtTime = (sec) => { if (sec == null) return ""; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`; };
                          return (
                            <div className="space-y-0.5">
                              <div className="flex flex-wrap gap-2 mb-4">
                                {speakers.map(sp => (
                                  <span key={sp} className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: getSpeakerColor(sp) + "18", color: getSpeakerColor(sp), border: `1px solid ${getSpeakerColor(sp)}30` }}>{sp}</span>
                                ))}
                              </div>
                              {transcriptSegments.map((seg, idx) => (
                                <div key={idx} className="flex gap-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700/30 rounded px-2">
                                  {seg.startTime != null && <span className="text-[11px] font-mono text-slate-400 flex-shrink-0 w-12 pt-0.5">{fmtTime(seg.startTime)}</span>}
                                  <span className="text-[11px] font-semibold flex-shrink-0 w-24 truncate pt-0.5" style={{ color: getSpeakerColor(seg.speaker || "Speaker") }}>{seg.speaker || "Speaker"}</span>
                                  <span className="text-sm text-slate-800 dark:text-slate-200 flex-1">{seg.text || ""}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pinnedDocs.map(pd => (
                    <div key={pd.id} className={CARD_CLS + " p-4"}>
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{pd.label || pd.document_name || pd.transcript_name || "Document"}</p>
                          {pd.file_type && <p className="text-xs text-slate-400 mt-0.5">{pd.file_type}</p>}
                          {pd.transcript_id && !pd.case_document_id && <span className={BADGE_CLS + " bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800/50 mt-0.5"}>Transcription</span>}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          {pd.case_document_id && <button onClick={() => openDocViewer(pd)} className="p-1 text-indigo-500 hover:text-indigo-700" title="View"><Eye size={14} /></button>}
                          {pd.transcript_id && !pd.case_document_id && <button onClick={() => viewTranscript(pd)} className="p-1 text-violet-500 hover:text-violet-700" title="View Transcript"><Eye size={14} /></button>}
                          {pd.case_document_id && <button onClick={() => runDocSummary(pd)} className="p-1 text-amber-500 hover:text-amber-700" title="AI Summary">{docSummaryLoading === pd.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}</button>}
                          {pd.case_document_id && <button onClick={() => handleDownloadDoc(pd.case_document_id)} className="p-1 text-slate-400 hover:text-slate-600" title="Download"><Download size={14} /></button>}
                          {pd.transcript_id && !pd.case_document_id && <button onClick={() => handleDownloadTranscriptAudio(pd.transcript_id, pd.transcript_name || "audio")} className="p-1 text-slate-400 hover:text-slate-600" title="Download Audio"><Download size={14} /></button>}
                          <button onClick={async () => { await apiDeleteTrialPinnedDoc(pd.id); refreshTab("Quick Docs"); }} className="p-1 text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      {(docSummaries[pd.id] || pd.document_summary) && (
                        <div className="mt-3 bg-amber-50/50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-800/50">
                          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-1"><Sparkles size={10} /> AI Summary</p>
                          <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap max-h-[200px] overflow-y-auto">{docSummaries[pd.id] || pd.document_summary}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {pinnedDocs.length === 0 && !showDocPicker && <p className="text-sm text-slate-400 text-center py-8">No documents pinned yet.</p>}
              </div>
            )}

            {activeTab === "Trial Log" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Trial Log</h3>
                    <div className="flex items-center gap-1">
                      {dayOptions.map(d => (
                        <button key={d} onClick={() => setLogDay(d)} className={`px-3 py-1 text-xs font-medium rounded-full ${logDay === d ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"}`}>Day {d}</button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setShowLogForm(true)} className={BTN_CLS + " flex items-center gap-1.5"}><Plus size={14} /> Add Entry</button>
                </div>
                {showLogForm && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <div><label className={LABEL_CLS}>Category</label><select className={INPUT_CLS} value={lForm.category} onChange={e => setLForm({ ...lForm, category: e.target.value })}><option value="ruling">Ruling</option><option value="objection">Objection</option><option value="testimony">Testimony</option><option value="note">Note</option><option value="followup">Follow-up</option></select></div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className={LABEL_CLS + " !mb-0"}>Content</label>
                        {speechSupported && (
                          <button onClick={toggleSpeech} className={`px-2 py-1 text-xs font-medium rounded-md flex items-center gap-1 ${isListening ? "bg-red-100 text-red-700 border border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50" : "bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600"}`}>
                            <Mic size={10} className={isListening ? "animate-pulse" : ""} />
                            {isListening ? "Listening..." : "Dictate"}
                          </button>
                        )}
                      </div>
                      <textarea className={INPUT_CLS + " h-24"} value={lForm.content} onChange={e => setLForm({ ...lForm, content: e.target.value })} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleLogSave} className={BTN_CLS}>Save</button>
                      <button onClick={() => { setShowLogForm(false); if (isListening && speechRecRef.current) { speechRecRef.current.stop(); setIsListening(false); } }} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {dayEntries.map(entry => (
                    <div key={entry.id} className={CARD_CLS + " p-3 flex items-start gap-3"}>
                      <span className={BADGE_CLS + " flex-shrink-0 " + (categoryColors[entry.category] || "bg-slate-100 text-slate-700")}>{entry.category}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-900 dark:text-slate-100">{entry.content}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{entry.entry_time ? new Date(entry.entry_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</p>
                      </div>
                      <button onClick={async () => { await apiDeleteTrialLogEntry(entry.id); refreshTab("Trial Log"); }} className="p-1 text-red-500 hover:text-red-700 flex-shrink-0"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  {dayEntries.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No entries for Day {logDay}.</p>}
                </div>
              </div>
            )}

            {activeTab === "AI Agents" && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI Trial Agents</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {AI_AGENTS.map(agent => (
                    <div key={agent.id} onClick={() => { setActiveAgent(activeAgent === agent.id ? null : agent.id); setAiResult(""); setAiInput(""); setAiInput2(""); setAiWitnessId(""); setAiJurorId(""); }} className={`${CARD_CLS} p-4 cursor-pointer transition-colors hover:border-slate-300 dark:hover:border-slate-600 ${activeAgent === agent.id ? "ring-2 ring-slate-900 dark:ring-slate-100" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${agent.bg}`}>
                          <agent.Icon size={20} className={agent.color} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{agent.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{agent.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {activeAgent && (
                  <div className={CARD_CLS + " p-4 space-y-3"}>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{AI_AGENTS.find(a => a.id === activeAgent)?.title}</h4>

                    {activeAgent === "witness-prep" && (
                      <div>
                        <label className={LABEL_CLS}>Select Witness</label>
                        <select className={INPUT_CLS} value={aiWitnessId} onChange={e => setAiWitnessId(e.target.value)}>
                          <option value="">Choose a witness...</option>
                          {witnesses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.type})</option>)}
                        </select>
                      </div>
                    )}

                    {activeAgent === "jury-selection" && (
                      <>
                        <div>
                          <label className={LABEL_CLS}>Select Juror</label>
                          <select className={INPUT_CLS} value={aiJurorId} onChange={e => setAiJurorId(e.target.value)}>
                            <option value="">Choose a juror...</option>
                            {jurors.map(j => <option key={j.id} value={j.id}>Seat {j.seat_number} - {j.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Additional Notes</label>
                          <textarea className={INPUT_CLS + " h-20"} value={aiInput} onChange={e => setAiInput(e.target.value)} placeholder="Additional juror observations or voir dire notes..." />
                        </div>
                      </>
                    )}

                    {activeAgent === "objection-coach" && (
                      <div>
                        <label className={LABEL_CLS}>Scenario</label>
                        <textarea className={INPUT_CLS + " h-24"} value={aiInput} onChange={e => setAiInput(e.target.value)} placeholder="Describe the trial scenario for objection analysis..." />
                      </div>
                    )}

                    {activeAgent === "closing-builder" && (
                      <p className="text-sm text-slate-500 dark:text-slate-400">This agent will automatically compile trial data (witnesses, exhibits, log entries) to build a closing argument outline.</p>
                    )}

                    {activeAgent === "jury-instructions-ai" && (
                      <>
                        <div>
                          <label className={LABEL_CLS}>Charges</label>
                          <textarea className={INPUT_CLS + " h-20"} value={aiInput} onChange={e => setAiInput(e.target.value)} placeholder="Enter or modify charges..." />
                        </div>
                        <div>
                          <label className={LABEL_CLS}>Defense Theory</label>
                          <textarea className={INPUT_CLS + " h-20"} value={aiInput2} onChange={e => setAiInput2(e.target.value)} placeholder="Describe your defense theory..." />
                        </div>
                      </>
                    )}

                    {activeAgent === "case-law" && (
                      <div>
                        <label className={LABEL_CLS}>Legal Issue</label>
                        <textarea className={INPUT_CLS + " h-24"} value={aiInput} onChange={e => setAiInput(e.target.value)} placeholder="Describe the legal issue to research..." />
                      </div>
                    )}

                    <button onClick={runAiAgent} disabled={aiLoading} className={BTN_CLS + " flex items-center gap-2"}>
                      {aiLoading ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Sparkles size={14} /> Run Agent</>}
                    </button>

                    {aiResult && (
                      <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 whitespace-pre-wrap text-sm text-slate-900 dark:text-slate-100 max-h-[500px] overflow-y-auto">
                        {aiResult}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {!session && !loading && (
        <div className="text-center py-16">
          <Scale className="mx-auto text-slate-300 dark:text-slate-600 mb-4" size={48} />
          <h3 className="text-lg font-medium text-slate-600 dark:text-slate-400">Trial Center</h3>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Search for a case above to open or create a trial session.</p>
        </div>
      )}
      </div>
      </div>
    </>
  );
}
