import { useState, useRef, useCallback, useEffect } from "react";

const HOLD_DELAY = 400;
const MOVE_THRESHOLD = 5;

export default function useDraggablePosition(storageKey, elementSize = 52) {
  const [position, setPosition] = useState(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const [dragging, setDragging] = useState(false);
  const [didDrag, setDidDrag] = useState(false);

  const ref = useRef(null);
  const state = useRef({
    active: false,
    holdTimer: null,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    moved: false,
  });

  const clamp = useCallback((clientX, clientY) => {
    const x = Math.max(0, Math.min(window.innerWidth - elementSize, clientX - state.current.offsetX));
    const y = Math.max(0, Math.min(window.innerHeight - elementSize, clientY - state.current.offsetY));
    return { x, y };
  }, [elementSize]);

  const persistPosition = useCallback((pos) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(pos)); } catch {}
  }, [storageKey]);

  const resetPosition = useCallback(() => {
    setPosition(null);
    try { sessionStorage.removeItem(storageKey); } catch {}
  }, [storageKey]);

  const cancelHold = useCallback(() => {
    if (state.current.holdTimer) {
      clearTimeout(state.current.holdTimer);
      state.current.holdTimer = null;
    }
  }, []);

  const activateDrag = useCallback((clientX, clientY) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    state.current.active = true;
    state.current.offsetX = clientX - rect.left;
    state.current.offsetY = clientY - rect.top;
    state.current.moved = false;
    setDragging(true);
    setDidDrag(false);
  }, []);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    state.current.startX = e.clientX;
    state.current.startY = e.clientY;
    state.current.moved = false;
    setDidDrag(false);

    state.current.holdTimer = setTimeout(() => {
      state.current.holdTimer = null;
      activateDrag(e.clientX, e.clientY);
      if (ref.current) {
        try { ref.current.setPointerCapture(e.pointerId); } catch {}
      }
    }, HOLD_DELAY);
  }, [activateDrag]);

  const onPointerMove = useCallback((e) => {
    if (state.current.holdTimer) {
      const dx = Math.abs(e.clientX - state.current.startX);
      const dy = Math.abs(e.clientY - state.current.startY);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        cancelHold();
      }
      return;
    }

    if (!state.current.active) return;
    e.preventDefault();

    const dx = Math.abs(e.clientX - state.current.startX);
    const dy = Math.abs(e.clientY - state.current.startY);
    if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
      state.current.moved = true;
    }

    const pos = clamp(e.clientX, e.clientY);
    setPosition(pos);
  }, [clamp, cancelHold]);

  const onPointerUp = useCallback((e) => {
    cancelHold();

    if (!state.current.active) return;
    state.current.active = false;
    setDragging(false);

    if (ref.current) {
      try { ref.current.releasePointerCapture(e.pointerId); } catch {}
    }

    if (state.current.moved) {
      const pos = clamp(e.clientX, e.clientY);
      setPosition(pos);
      persistPosition(pos);
      setDidDrag(true);
      setTimeout(() => setDidDrag(false), 50);
    }
  }, [clamp, persistPosition, cancelHold]);

  useEffect(() => {
    return () => cancelHold();
  }, [cancelHold]);

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        const x = Math.max(0, Math.min(window.innerWidth - elementSize, prev.x));
        const y = Math.max(0, Math.min(window.innerHeight - elementSize, prev.y));
        const clamped = { x, y };
        persistPosition(clamped);
        return clamped;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [elementSize, persistPosition]);

  const onPointerCancel = useCallback(() => {
    cancelHold();
    state.current.active = false;
    state.current.moved = false;
    setDragging(false);
  }, [cancelHold]);

  const pointerHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };

  const style = position
    ? { left: position.x, top: position.y, right: "auto", bottom: "auto", ...(dragging ? { animation: "none", cursor: "grabbing", transition: "none" } : {}) }
    : undefined;

  return { ref, position, dragging, didDrag, pointerHandlers, style, resetPosition };
}
