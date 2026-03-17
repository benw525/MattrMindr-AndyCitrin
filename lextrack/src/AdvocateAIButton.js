import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot } from "lucide-react";
import useDraggablePosition from "./hooks/useDraggablePosition.js";

const AdvocateAIButton = memo(function AdvocateAIButton({ visible, onClick, collaborateView }) {
  const { ref, dragging, didDrag, pointerHandlers, style: dragStyle } = useDraggablePosition("advocate-fab-pos", 52);

  const baseStyle = collaborateView && !dragStyle
    ? { bottom: "auto", top: 62 }
    : undefined;

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          ref={ref}
          className="advocate-fab"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          onClick={() => { if (!didDrag && !dragging) onClick(); }}
          title="Advocate AI"
          style={{
            ...baseStyle,
            ...dragStyle,
            touchAction: "none",
            zIndex: 9998,
          }}
          {...pointerHandlers}
        >
          <Bot size={22} className="text-white" />
        </motion.button>
      )}
    </AnimatePresence>
  );
});

export default AdvocateAIButton;
