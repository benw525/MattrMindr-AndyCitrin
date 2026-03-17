import { useState, useRef, useCallback, useEffect } from "react";

const MIN_VISIBLE_H = 80;
const MIN_VISIBLE_V = 40;

export default function useDraggableWindow(storageKey, panelWidth = 400, panelHeight = 580) {
  const [position, setPosition] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const [dragging, setDragging] = useState(false);

  const state = useRef({
    active: false,
    offsetX: 0,
    offsetY: 0,
  });

  const clamp = useCallback((clientX, clientY) => {
    const x = Math.max(MIN_VISIBLE_H - panelWidth, Math.min(window.innerWidth - MIN_VISIBLE_H, clientX - state.current.offsetX));
    const y = Math.max(MIN_VISIBLE_V - panelHeight, Math.min(window.innerHeight - MIN_VISIBLE_V, clientY - state.current.offsetY));
    return { x, y };
  }, [panelWidth, panelHeight]);

  const persistPosition = useCallback((pos) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(pos)); } catch {}
  }, [storageKey]);

  const onTitleBarPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const target = e.target;
    if (target.closest("button, a, input, select, textarea, [role='button']")) return;

    const el = e.currentTarget.closest("[data-advocate-panel]");
    if (!el) return;

    const rect = el.getBoundingClientRect();
    state.current.active = true;
    state.current.offsetX = e.clientX - rect.left;
    state.current.offsetY = e.clientY - rect.top;
    setDragging(true);

    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }, []);

  const onTitleBarPointerMove = useCallback((e) => {
    if (!state.current.active) return;
    e.preventDefault();
    const pos = clamp(e.clientX, e.clientY);
    setPosition(pos);
  }, [clamp]);

  const onTitleBarPointerUp = useCallback((e) => {
    if (!state.current.active) return;
    state.current.active = false;
    setDragging(false);

    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}

    const pos = clamp(e.clientX, e.clientY);
    setPosition(pos);
    persistPosition(pos);
  }, [clamp, persistPosition]);

  const resetPosition = useCallback(() => {
    setPosition(null);
    try { sessionStorage.removeItem(storageKey); } catch {}
  }, [storageKey]);

  useEffect(() => {
    const s = state.current;
    return () => { s.active = false; };
  }, []);

  const onTitleBarPointerCancel = useCallback(() => {
    state.current.active = false;
    setDragging(false);
  }, []);

  const titleBarHandlers = {
    onPointerDown: onTitleBarPointerDown,
    onPointerMove: onTitleBarPointerMove,
    onPointerUp: onTitleBarPointerUp,
    onPointerCancel: onTitleBarPointerCancel,
  };

  const panelStyle = position
    ? { left: position.x, top: position.y, right: "auto", bottom: "auto", ...(dragging ? { transition: "none" } : {}) }
    : undefined;

  return { position, dragging, titleBarHandlers, panelStyle, resetPosition };
}
