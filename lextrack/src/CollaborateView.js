import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  apiGetCollabChannels, apiCreateCollabChannel, apiGetCollabMessages, apiSendCollabMessage,
  apiMarkCollabRead, apiSearchCollabMessages,
  apiCreateCollabGroup, apiUpdateCollabGroup, apiGetCollabGroupMembers,
  apiAddCollabGroupMembers, apiRemoveCollabGroupMember,
  apiStartPrivateChat, apiDeleteCollabChannel,
  apiCollabTyping, apiGetCollabTyping, apiUploadCollabFile,
} from "./api";

function formatTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return timeStr;
  if (isYesterday) return `Yesterday ${timeStr}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + timeStr;
}

function dateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function Avatar({ name, avatar, initials, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", background: avatar || "#4C7AC9",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontSize: size * 0.38, fontWeight: 700, flexShrink: 0, letterSpacing: 0.5,
    }}>
      {initials || (name ? name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase() : "?")}
    </div>
  );
}

function renderBody(body, allUsers) {
  if (!body) return null;
  const parts = [];
  let key = 0;
  const mentionRegex = /@([A-Za-z][A-Za-z .'-]+)/g;
  let lastIdx = 0;
  const matches = [];
  for (const m of body.matchAll(mentionRegex)) {
    const mentioned = allUsers.find(u => u.name === m[1]);
    if (mentioned) matches.push({ start: m.index, end: m.index + m[0].length, name: m[1] });
  }
  if (matches.length === 0) return body;
  for (const mt of matches) {
    if (mt.start > lastIdx) parts.push(<span key={key++}>{body.substring(lastIdx, mt.start)}</span>);
    parts.push(<span key={key++} style={{ background: "rgba(99,102,241,0.15)", color: "#6366f1", borderRadius: 4, padding: "1px 4px", fontWeight: 600 }}>@{mt.name}</span>);
    lastIdx = mt.end;
  }
  if (lastIdx < body.length) parts.push(<span key={key++}>{body.substring(lastIdx)}</span>);
  return parts;
}

export default function CollaborateView({ currentUser, allUsers, allCases, pinnedCaseIds, onMenuToggle }) {
  const [tab, setTab] = useState("cases");
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgInput, setMsgInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [caseFilter, setCaseFilter] = useState("");
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState([]);
  const [showNewPrivate, setShowNewPrivate] = useState(false);
  const [privateSearch, setPrivateSearch] = useState("");
  const [typingUsers, setTypingUsers] = useState([]);
  const [mentionDropdown, setMentionDropdown] = useState(null);
  const [groupSettings, setGroupSettings] = useState(null);
  const [groupMembers, setGroupMembers] = useState([]);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupDesc, setEditGroupDesc] = useState("");
  const [addMemberSearch, setAddMemberSearch] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [newGroupSearch, setNewGroupSearch] = useState("");
  const [newGroupDropdown, setNewGroupDropdown] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const fileInputRef = useRef(null);

  const activeUsers = (allUsers || []).filter(u => !u.deletedAt && !u.deleted_at);

  const loadChannels = useCallback(async () => {
    try {
      const data = await apiGetCollabChannels();
      setChannels(data);
    } catch (err) { console.error("Load channels:", err); }
  }, []);

  useEffect(() => { loadChannels(); }, [loadChannels]);
  useEffect(() => {
    const interval = setInterval(loadChannels, 15000);
    return () => clearInterval(interval);
  }, [loadChannels]);

  const loadMessages = useCallback(async (channelId) => {
    try {
      setLoading(true);
      const data = await apiGetCollabMessages(channelId);
      setMessages(data);
      await apiMarkCollabRead(channelId);
      loadChannels();
    } catch (err) { console.error("Load messages:", err); }
    finally { setLoading(false); }
  }, [loadChannels]);

  useEffect(() => {
    if (!activeChannel) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiGetCollabMessages(activeChannel);
        setMessages(data);
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [activeChannel]);

  useEffect(() => {
    if (!activeChannel) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiGetCollabTyping(activeChannel);
        setTypingUsers(data);
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [activeChannel]);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const openChannel = useCallback((channelId) => {
    setActiveChannel(channelId);
    setMessages([]);
    setTypingUsers([]);
    setSearchResults(null);
    setMobileShowChat(true);
    loadMessages(channelId);
  }, [loadMessages]);

  const openCaseChannel = useCallback(async (caseId) => {
    const existing = channels.find(c => c.type === "case" && c.caseId === caseId);
    if (existing) { openChannel(existing.id); return; }
    try {
      const cs = allCases.find(c => c.id === caseId);
      const res = await apiCreateCollabChannel({ type: "case", caseId, name: cs?.case_num || cs?.title || `Case ${caseId}`, memberIds: activeUsers.map(u => u.id) });
      await loadChannels();
      openChannel(res.id);
    } catch (err) { console.error("Open case channel:", err); }
  }, [channels, allCases, activeUsers, openChannel, loadChannels]);

  const handleSend = useCallback(async () => {
    if ((!msgInput.trim()) || !activeChannel || sending) return;
    setSending(true);
    try {
      await apiSendCollabMessage(activeChannel, { body: msgInput.trim() });
      setMsgInput("");
      const data = await apiGetCollabMessages(activeChannel);
      setMessages(data);
      loadChannels();
    } catch (err) { console.error("Send:", err); }
    finally { setSending(false); }
  }, [msgInput, activeChannel, sending, loadChannels]);

  const handleFileUpload = useCallback(async (file) => {
    if (!activeChannel || !file) return;
    setSending(true);
    try {
      const uploaded = await apiUploadCollabFile(file);
      await apiSendCollabMessage(activeChannel, {
        body: `Shared a file: ${uploaded.attachmentName}`,
        attachmentName: uploaded.attachmentName,
        attachmentUrl: uploaded.attachmentUrl,
      });
      const data = await apiGetCollabMessages(activeChannel);
      setMessages(data);
      loadChannels();
    } catch (err) { console.error("Upload:", err); }
    finally { setSending(false); }
  }, [activeChannel, loadChannels]);

  const handleTyping = useCallback(() => {
    if (!activeChannel) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 3000) return;
    lastTypingSentRef.current = now;
    apiCollabTyping(activeChannel).catch(() => {});
  }, [activeChannel]);

  const handleSearch = useCallback(async (q) => {
    setSearchQuery(q);
    if (q.trim().length < 2) { setSearchResults(null); return; }
    try {
      const data = await apiSearchCollabMessages(q);
      setSearchResults(data);
    } catch (err) { console.error("Search:", err); }
  }, []);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;
    try {
      const res = await apiCreateCollabGroup({ name: newGroupName.trim(), description: newGroupDesc, memberIds: newGroupMembers });
      setShowNewGroup(false);
      setNewGroupName(""); setNewGroupDesc(""); setNewGroupMembers([]);
      await loadChannels();
      openChannel(res.id);
    } catch (err) { console.error("Create group:", err); }
  }, [newGroupName, newGroupDesc, newGroupMembers, loadChannels, openChannel]);

  const handleStartPrivate = useCallback(async (otherUserId) => {
    try {
      const res = await apiStartPrivateChat({ otherUserId });
      setShowNewPrivate(false); setPrivateSearch("");
      await loadChannels();
      openChannel(res.channelId);
    } catch (err) { console.error("Start private:", err); }
  }, [loadChannels, openChannel]);

  const handleOpenGroupSettings = useCallback(async (channel) => {
    setGroupSettings(channel);
    setEditGroupName(channel.groupName || channel.name || "");
    setEditGroupDesc(channel.groupDescription || "");
    try {
      const members = await apiGetCollabGroupMembers(channel.id);
      setGroupMembers(members);
    } catch {}
  }, []);

  const handleSaveGroupSettings = useCallback(async () => {
    if (!groupSettings) return;
    try {
      await apiUpdateCollabGroup(groupSettings.id, { name: editGroupName, description: editGroupDesc });
      setGroupSettings(null);
      loadChannels();
    } catch (err) { console.error("Save group:", err); }
  }, [groupSettings, editGroupName, editGroupDesc, loadChannels]);

  const handleMentionInput = useCallback((val) => {
    setMsgInput(val);
    const atIdx = val.lastIndexOf("@");
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === " ")) {
      const after = val.substring(atIdx + 1);
      if (after.length > 0 && !after.includes(" ")) {
        const filtered = activeUsers.filter(u => u.id !== currentUser?.id && u.name.toLowerCase().startsWith(after.toLowerCase()));
        if (filtered.length > 0) { setMentionDropdown({ users: filtered.slice(0, 6), atIdx }); return; }
      }
    }
    setMentionDropdown(null);
  }, [activeUsers, currentUser]);

  const insertMention = useCallback((user) => {
    if (!mentionDropdown) return;
    const before = msgInput.substring(0, mentionDropdown.atIdx);
    const newVal = before + `@${user.name} `;
    setMsgInput(newVal);
    setMentionDropdown(null);
    inputRef.current?.focus();
  }, [mentionDropdown, msgInput]);

  const pinnedIds = pinnedCaseIds || [];
  const uid = currentUser?.id;
  const casesForTab = allCases.filter(c =>
    (c.status === "Active" && [c.assignedAttorney, c.secondAttorney, c.trialCoordinator, c.investigator, c.socialWorker].includes(uid))
    || channels.some(ch => ch.type === "case" && ch.caseId === c.id)
  );
  const allActiveCases = allCases.filter(c => c.status === "Active");
  const filteredCasesPre = caseFilter.trim()
    ? allActiveCases.filter(c => (c.case_num || "").toLowerCase().includes(caseFilter.toLowerCase()) || (c.defendant_name || "").toLowerCase().includes(caseFilter.toLowerCase()) || (c.title || "").toLowerCase().includes(caseFilter.toLowerCase()))
    : casesForTab;
  const filteredCases = [...filteredCasesPre].sort((a, b) => {
    const aPin = pinnedIds.includes(a.id) ? 0 : 1;
    const bPin = pinnedIds.includes(b.id) ? 0 : 1;
    if (aPin !== bPin) return aPin - bPin;
    return (a.defendant_name || a.title || "").localeCompare(b.defendant_name || b.title || "");
  });
  const groupChannels = channels.filter(c => c.type === "group");
  const privateChannels = channels.filter(c => c.type === "private");
  const activeChannelData = channels.find(c => c.id === activeChannel);

  const channelTitle = activeChannelData
    ? activeChannelData.type === "case" ? `${activeChannelData.caseName || ""} ${activeChannelData.defendantName ? `— ${activeChannelData.defendantName}` : ""}`.trim()
    : activeChannelData.type === "group" ? (activeChannelData.groupName || activeChannelData.name || "Group")
    : activeChannelData.type === "private" ? (activeChannelData.otherUser?.name || "Private")
    : "Chat"
    : "";

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", background: "var(--c-bg)", overflow: "hidden" }}>
      {(!isMobile || !mobileShowChat) && (
        <div style={{ width: isMobile ? "100%" : 300, minWidth: isMobile ? "100%" : 300, borderRight: "1px solid var(--c-border)", display: "flex", flexDirection: "column", background: "var(--c-bg)", overflow: "hidden" }}>
          <div style={{ padding: "16px 16px 0", display: "flex", alignItems: "center", gap: 8 }}>
            {onMenuToggle && <button className="sidebar-toggle" onClick={onMenuToggle} style={{ display: "none", background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "var(--c-text2)", padding: 4 }}>☰</button>}
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 18, fontWeight: 700, color: "var(--c-text-h)", flex: 1 }}>Collaborate</div>
          </div>

          <div style={{ padding: "12px 16px 8px" }}>
            <input
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search messages..."
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 12, boxSizing: "border-box" }}
            />
          </div>

          {searchResults !== null ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
              <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--c-text3)", fontWeight: 600 }}>
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                <button onClick={() => { setSearchQuery(""); setSearchResults(null); }} style={{ float: "right", background: "transparent", border: "none", color: "var(--c-accent, #1e3a5f)", fontSize: 11, cursor: "pointer" }}>Clear</button>
              </div>
              {searchResults.map(r => (
                <div key={r.id} onClick={() => openChannel(r.channelId)} style={{ padding: "8px 10px", borderRadius: 6, cursor: "pointer", marginBottom: 2, border: "1px solid transparent" }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg2)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <div style={{ fontSize: 11, color: "var(--c-text3)", marginBottom: 2 }}>
                    {r.channelType === "case" ? `Case: ${r.caseName || ""}` : r.channelType === "group" ? `Group: ${r.groupName || ""}` : `DM: ${r.otherUserName || ""}`}
                    <span style={{ float: "right" }}>{formatTime(r.createdAt)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--c-text)", fontWeight: 600 }}>{r.senderName}</div>
                  <div style={{ fontSize: 12, color: "var(--c-text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.body}</div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div style={{ display: "flex", borderBottom: "1px solid var(--c-border)", padding: "0 12px" }}>
                {[{ id: "cases", label: "Cases" }, { id: "groups", label: "Groups" }, { id: "private", label: "Private" }].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    flex: 1, padding: "8px 0", fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
                    color: tab === t.id ? "var(--c-accent, #1e3a5f)" : "var(--c-text3)",
                    background: "transparent", border: "none", borderBottom: tab === t.id ? "2px solid var(--c-accent, #1e3a5f)" : "2px solid transparent",
                    cursor: "pointer", transition: "all 0.15s",
                  }}>{t.label}</button>
                ))}
              </div>

              <div style={{ flex: 1, overflowY: "auto" }}>
                {tab === "cases" && (
                  <div>
                    <div style={{ padding: "8px 12px" }}>
                      <input value={caseFilter} onChange={e => setCaseFilter(e.target.value)} placeholder="Filter cases..."
                        style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 11, boxSizing: "border-box" }} />
                    </div>
                    {filteredCases.map(c => {
                      const ch = channels.find(ch2 => ch2.type === "case" && ch2.caseId === c.id);
                      const unread = ch?.unreadCount || 0;
                      return (
                        <div key={c.id} onClick={() => openCaseChannel(c.id)} style={{
                          padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--c-border)",
                          background: activeChannel && ch && ch.id === activeChannel ? "var(--c-bg2)" : "transparent",
                          display: "flex", alignItems: "center", gap: 10,
                        }}
                          onMouseEnter={e => { if (!(activeChannel && ch && ch.id === activeChannel)) e.currentTarget.style.background = "var(--c-bg2)"; }}
                          onMouseLeave={e => { if (!(activeChannel && ch && ch.id === activeChannel)) e.currentTarget.style.background = "transparent"; }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: "#1e3a5f", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, flexShrink: 0, position: "relative" }}>⚖️{pinnedIds.includes(c.id) && <span style={{ position: "absolute", top: -2, right: -2, fontSize: 10 }}>📌</span>}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.case_num || c.title}</div>
                            <div style={{ fontSize: 11, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.defendant_name || ""}</div>
                            {ch?.lastMessage && <div style={{ fontSize: 11, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{ch.lastSenderName}: {ch.lastMessage.substring(0, 40)}</div>}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                            {ch?.lastMessageAt && <div style={{ fontSize: 10, color: "var(--c-text3)" }}>{formatTime(ch.lastMessageAt)}</div>}
                            {unread > 0 && <div style={{ background: "#e05252", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{unread}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {tab === "groups" && (
                  <div>
                    <div style={{ padding: "8px 12px" }}>
                      <button onClick={() => { setShowNewGroup(true); setNewGroupSearch(""); setNewGroupDropdown(false); setNewGroupName(""); setNewGroupDesc(""); setNewGroupMembers([]); }} style={{ width: "100%", padding: "8px", borderRadius: 6, border: "1px dashed var(--c-border)", background: "transparent", color: "var(--c-accent, #1e3a5f)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ New Group</button>
                    </div>
                    {groupChannels.map(ch => (
                      <div key={ch.id} onClick={() => openChannel(ch.id)} style={{
                        padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--c-border)",
                        background: activeChannel === ch.id ? "var(--c-bg2)" : "transparent",
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                        onMouseEnter={e => { if (activeChannel !== ch.id) e.currentTarget.style.background = "var(--c-bg2)"; }}
                        onMouseLeave={e => { if (activeChannel !== ch.id) e.currentTarget.style.background = "transparent"; }}>
                        <Avatar name={ch.groupName || ch.name} avatar={ch.groupAvatar || "#4C7AC9"} initials={(ch.groupName || ch.name || "G").substring(0, 2).toUpperCase()} size={36} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>{ch.groupName || ch.name}</div>
                          <div style={{ fontSize: 11, color: "var(--c-text3)" }}>{ch.memberCount || 0} members</div>
                          {ch.lastMessage && <div style={{ fontSize: 11, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{ch.lastSenderName}: {ch.lastMessage.substring(0, 40)}</div>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          {ch.lastMessageAt && <div style={{ fontSize: 10, color: "var(--c-text3)" }}>{formatTime(ch.lastMessageAt)}</div>}
                          {ch.unreadCount > 0 && <div style={{ background: "#e05252", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{ch.unreadCount}</div>}
                          {ch.groupCreatedBy === currentUser?.id && (
                            <button onClick={e => { e.stopPropagation(); handleOpenGroupSettings(ch); }} style={{ background: "transparent", border: "none", fontSize: 14, cursor: "pointer", color: "var(--c-text3)", padding: 0 }}>⚙️</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {groupChannels.length === 0 && <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--c-text3)", fontSize: 12 }}>No groups yet. Create one to get started.</div>}
                  </div>
                )}

                {tab === "private" && (
                  <div>
                    <div style={{ padding: "8px 12px" }}>
                      <button onClick={() => setShowNewPrivate(true)} style={{ width: "100%", padding: "8px", borderRadius: 6, border: "1px dashed var(--c-border)", background: "transparent", color: "var(--c-accent, #1e3a5f)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>+ New Message</button>
                    </div>
                    {privateChannels.map(ch => (
                      <div key={ch.id} onClick={() => openChannel(ch.id)} style={{
                        padding: "10px 16px", cursor: "pointer", borderBottom: "1px solid var(--c-border)",
                        background: activeChannel === ch.id ? "var(--c-bg2)" : "transparent",
                        display: "flex", alignItems: "center", gap: 10,
                      }}
                        onMouseEnter={e => { if (activeChannel !== ch.id) e.currentTarget.style.background = "var(--c-bg2)"; }}
                        onMouseLeave={e => { if (activeChannel !== ch.id) e.currentTarget.style.background = "transparent"; }}>
                        {ch.otherUser && <Avatar name={ch.otherUser.name} avatar={ch.otherUser.avatar} initials={ch.otherUser.initials} size={36} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>{ch.otherUser?.name || "Unknown"}</div>
                          {ch.lastMessage && <div style={{ fontSize: 11, color: "var(--c-text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.lastMessage.substring(0, 50)}</div>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                          {ch.lastMessageAt && <div style={{ fontSize: 10, color: "var(--c-text3)" }}>{formatTime(ch.lastMessageAt)}</div>}
                          {ch.unreadCount > 0 && <div style={{ background: "#e05252", color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 700, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{ch.unreadCount}</div>}
                        </div>
                      </div>
                    ))}
                    {privateChannels.length === 0 && <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--c-text3)", fontSize: 12 }}>No conversations yet.</div>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {(!isMobile || mobileShowChat) && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {activeChannel ? (
            <>
              <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 10, background: "var(--c-bg)", flexShrink: 0 }}>
                {isMobile && <button onClick={() => setMobileShowChat(false)} style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer", color: "var(--c-text2)", padding: 0 }}>←</button>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-text-h)", fontFamily: "'Playfair Display',serif" }}>{channelTitle}</div>
                  {activeChannelData?.type === "group" && <div style={{ fontSize: 11, color: "var(--c-text3)" }}>{activeChannelData.memberCount || 0} members</div>}
                </div>
                {activeChannelData?.type === "group" && activeChannelData.groupCreatedBy === currentUser?.id && (
                  <button onClick={() => handleOpenGroupSettings(activeChannelData)} style={{ background: "transparent", border: "none", fontSize: 16, cursor: "pointer", color: "var(--c-text3)" }}>⚙️</button>
                )}
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                {loading && <div style={{ textAlign: "center", padding: 20, color: "var(--c-text3)", fontSize: 12 }}>Loading messages...</div>}
                {!loading && messages.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "var(--c-text3)", fontSize: 13 }}>No messages yet. Start the conversation!</div>}
                {messages.map((msg, i) => {
                  const prevMsg = i > 0 ? messages[i - 1] : null;
                  const showDateLabel = !prevMsg || dateLabel(msg.createdAt) !== dateLabel(prevMsg.createdAt);
                  const isOwn = msg.senderId === currentUser?.id;
                  return (
                    <React.Fragment key={msg.id}>
                      {showDateLabel && (
                        <div style={{ textAlign: "center", padding: "12px 0 8px", fontSize: 11, color: "var(--c-text3)", fontWeight: 600 }}>
                          {dateLabel(msg.createdAt)}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexDirection: isOwn ? "row-reverse" : "row" }}>
                        <Avatar name={msg.senderName} avatar={msg.senderAvatar} initials={msg.senderInitials} size={32} />
                        <div style={{ maxWidth: "70%", minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2, flexDirection: isOwn ? "row-reverse" : "row" }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--c-text)" }}>{msg.senderName}</span>
                            <span style={{ fontSize: 10, color: "var(--c-text3)" }}>{formatTime(msg.createdAt)}</span>
                          </div>
                          <div style={{
                            padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, color: "var(--c-text)",
                            background: isOwn ? "rgba(99,102,241,0.1)" : "var(--c-bg2)",
                            borderTopRightRadius: isOwn ? 4 : 12, borderTopLeftRadius: isOwn ? 12 : 4,
                            wordBreak: "break-word",
                          }}>
                            {renderBody(msg.body, activeUsers)}
                            {msg.attachmentName && msg.attachmentUrl && (
                              <div style={{ marginTop: 6, padding: "6px 10px", background: "var(--c-bg)", borderRadius: 6, border: "1px solid var(--c-border)", display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 16 }}>📎</span>
                                <a href={msg.attachmentUrl} download={msg.attachmentName} style={{ fontSize: 12, color: "var(--c-accent, #1e3a5f)", textDecoration: "none", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.attachmentName}</a>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {typingUsers.length > 0 && (
                  <div style={{ fontSize: 12, color: "var(--c-text3)", fontStyle: "italic", padding: "4px 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ display: "inline-flex", gap: 2 }}>
                      <span className="typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--c-text3)", animation: "pulse 1.2s infinite" }} />
                      <span className="typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--c-text3)", animation: "pulse 1.2s infinite 0.2s" }} />
                      <span className="typing-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--c-text3)", animation: "pulse 1.2s infinite 0.4s" }} />
                    </span>
                    {typingUsers.map(u => u.name).join(" and ")} {typingUsers.length === 1 ? "is" : "are"} typing...
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--c-border)", background: "var(--c-bg)", flexShrink: 0, position: "relative" }}>
                {mentionDropdown && (
                  <div style={{ position: "absolute", bottom: "100%", left: 16, right: 16, background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: 8, boxShadow: "0 -4px 12px rgba(0,0,0,0.1)", maxHeight: 200, overflowY: "auto", zIndex: 10 }}>
                    {mentionDropdown.users.map(u => (
                      <div key={u.id} onClick={() => insertMention(u)} style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--c-border)" }}
                        onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg2)"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <Avatar name={u.name} avatar={u.avatar} initials={u.initials} size={24} />
                        <span style={{ fontSize: 13, color: "var(--c-text)" }}>{u.name}</span>
                        <span style={{ fontSize: 11, color: "var(--c-text3)" }}>{u.role}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="file" ref={fileInputRef} style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleFileUpload(e.target.files[0]); e.target.value = ""; }} />
                  <button onClick={() => fileInputRef.current?.click()} style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer", color: "var(--c-text3)", padding: 4, flexShrink: 0 }} title="Attach file">📎</button>
                  <input
                    ref={inputRef}
                    value={msgInput}
                    onChange={e => { handleMentionInput(e.target.value); handleTyping(); }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Type a message... (@ to mention)"
                    style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 13, outline: "none" }}
                  />
                  <button onClick={handleSend} disabled={!msgInput.trim() || sending} style={{
                    background: msgInput.trim() ? "var(--c-accent, #1e3a5f)" : "var(--c-border)",
                    color: "#fff", border: "none", borderRadius: 8, padding: "10px 16px", fontSize: 13,
                    fontWeight: 600, cursor: msgInput.trim() ? "pointer" : "default", flexShrink: 0,
                    opacity: sending ? 0.6 : 1,
                  }}>{sending ? "..." : "Send"}</button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "var(--c-text3)" }}>
              <div style={{ fontSize: 48 }}>💬</div>
              <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "'Playfair Display',serif" }}>Collaborate</div>
              <div style={{ fontSize: 13, maxWidth: 300, textAlign: "center", lineHeight: 1.6 }}>
                Select a case, group, or private conversation to start chatting with your team.
              </div>
            </div>
          )}
        </div>
      )}

      {showNewGroup && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowNewGroup(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--c-bg)", borderRadius: 12, width: 420, maxWidth: "95vw", maxHeight: "80vh", overflow: "auto", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--c-text-h)", marginBottom: 16, fontFamily: "'Playfair Display',serif" }}>Create Group</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Group Name</label>
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="e.g., Trial Team A" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Description</label>
              <input value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)} placeholder="Optional description" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Members ({newGroupMembers.length} selected)</label>
              {newGroupMembers.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                  {newGroupMembers.map(uid => {
                    const u = activeUsers.find(x => x.id === uid);
                    if (!u) return null;
                    return (
                      <span key={uid} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--c-bg2)", border: "1px solid var(--c-border)", borderRadius: 16, padding: "3px 8px 3px 4px", fontSize: 12, color: "var(--c-text)" }}>
                        <Avatar name={u.name} avatar={u.avatar} initials={u.initials} size={18} />
                        {u.name}
                        <button onClick={() => setNewGroupMembers(p => p.filter(x => x !== uid))} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text3)", fontSize: 14, padding: 0, marginLeft: 2, lineHeight: 1 }}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
              <div style={{ position: "relative" }}>
                <input
                  value={newGroupSearch}
                  onChange={e => { setNewGroupSearch(e.target.value); setNewGroupDropdown(e.target.value.trim().length > 0); }}
                  onFocus={() => { if (newGroupSearch.trim()) setNewGroupDropdown(true); }}
                  onBlur={() => setTimeout(() => setNewGroupDropdown(false), 200)}
                  placeholder="Search staff to add..."
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 13, boxSizing: "border-box" }}
                />
                {newGroupDropdown && (() => {
                  const results = activeUsers.filter(u => u.id !== currentUser?.id && !newGroupMembers.includes(u.id) && u.name.toLowerCase().includes(newGroupSearch.toLowerCase()));
                  return results.length > 0 ? (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--c-bg)", border: "1px solid var(--c-border)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.15)", zIndex: 10, maxHeight: 200, overflowY: "auto" }}>
                      {results.map(u => (
                        <div key={u.id} onMouseDown={e => e.preventDefault()} onClick={() => {
                          setNewGroupMembers(p => [...p, u.id]);
                          setNewGroupSearch("");
                          setNewGroupDropdown(false);
                        }} style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderBottom: "1px solid var(--c-border)", fontSize: 12 }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg2)"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <Avatar name={u.name} avatar={u.avatar} initials={u.initials} size={24} />
                          <div>
                            <div style={{ fontWeight: 600, color: "var(--c-text)" }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: "var(--c-text3)" }}>{u.role}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setShowNewGroup(false)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--c-border)", background: "transparent", color: "var(--c-text2)", fontSize: 12, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleCreateGroup} disabled={!newGroupName.trim()} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--c-accent, #1e3a5f)", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600, opacity: newGroupName.trim() ? 1 : 0.5 }}>Create Group</button>
            </div>
          </div>
        </div>
      )}

      {showNewPrivate && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowNewPrivate(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--c-bg)", borderRadius: 12, width: 380, maxWidth: "95vw", maxHeight: "80vh", overflow: "auto", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--c-text-h)", marginBottom: 16, fontFamily: "'Playfair Display',serif" }}>New Message</div>
            <input value={privateSearch} onChange={e => setPrivateSearch(e.target.value)} placeholder="Search staff..." style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 13, boxSizing: "border-box", marginBottom: 12 }} />
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {activeUsers.filter(u => u.id !== currentUser?.id && (!privateSearch.trim() || u.name.toLowerCase().includes(privateSearch.toLowerCase()))).map(u => (
                <div key={u.id} onClick={() => handleStartPrivate(u.id)} style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderRadius: 6, marginBottom: 2 }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg2)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <Avatar name={u.name} avatar={u.avatar} initials={u.initials} size={32} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: "var(--c-text3)" }}>{u.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {groupSettings && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setGroupSettings(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "var(--c-bg)", borderRadius: 12, width: 420, maxWidth: "95vw", maxHeight: "80vh", overflow: "auto", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--c-text-h)", marginBottom: 16, fontFamily: "'Playfair Display',serif" }}>Group Settings</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Name</label>
              <input value={editGroupName} onChange={e => setEditGroupName(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Description</label>
              <input value={editGroupDesc} onChange={e => setEditGroupDesc(e.target.value)} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Members ({groupMembers.length})</label>
              <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 6 }}>
                {groupMembers.map(m => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--c-border)" }}>
                    <Avatar name={m.name} avatar={m.avatar} initials={m.initials} size={24} />
                    <span style={{ flex: 1, fontSize: 12, color: "var(--c-text)" }}>{m.name}</span>
                    {m.id !== currentUser?.id && (
                      <button onClick={async () => {
                        await apiRemoveCollabGroupMember(groupSettings.id, m.id);
                        setGroupMembers(p => p.filter(x => x.id !== m.id));
                      }} style={{ background: "transparent", border: "none", fontSize: 12, cursor: "pointer", color: "#e05252" }}>Remove</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--c-text2)", display: "block", marginBottom: 4 }}>Add Members</label>
              <input value={addMemberSearch} onChange={e => setAddMemberSearch(e.target.value)} placeholder="Search staff..." style={{ width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid var(--c-border)", background: "var(--c-bg2)", color: "var(--c-text)", fontSize: 12, boxSizing: "border-box", marginBottom: 4 }} />
              {addMemberSearch.trim() && (
                <div style={{ maxHeight: 120, overflowY: "auto", border: "1px solid var(--c-border)", borderRadius: 6 }}>
                  {activeUsers.filter(u => !groupMembers.some(m => m.id === u.id) && u.name.toLowerCase().includes(addMemberSearch.toLowerCase())).map(u => (
                    <div key={u.id} onClick={async () => {
                      await apiAddCollabGroupMembers(groupSettings.id, { userIds: [u.id] });
                      setGroupMembers(p => [...p, u]);
                      setAddMemberSearch("");
                    }} style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderBottom: "1px solid var(--c-border)", fontSize: 12 }}
                      onMouseEnter={e => e.currentTarget.style.background = "var(--c-bg2)"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <Avatar name={u.name} avatar={u.avatar} initials={u.initials} size={20} />
                      <span style={{ color: "var(--c-text)" }}>{u.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <button onClick={async () => { await apiDeleteCollabChannel(groupSettings.id); setGroupSettings(null); setActiveChannel(null); loadChannels(); }} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #e05252", background: "transparent", color: "#e05252", fontSize: 12, cursor: "pointer" }}>Delete Group</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setGroupSettings(null)} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid var(--c-border)", background: "transparent", color: "var(--c-text2)", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                <button onClick={handleSaveGroupSettings} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: "var(--c-accent, #1e3a5f)", color: "#fff", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
