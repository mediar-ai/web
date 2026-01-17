import { emit, listen } from "@tauri-apps/api/event";
import React, { useEffect, useState, useCallback } from "react";
import { useBarWindow } from "./hooks/useBarWindow";

interface AiThinkingState {
  userMessage: string;
  currentTool: string;
  toolIndex: number;
  totalTools: number;
}

export const AiThinkingBar: React.FC = () => {
  const [state, setState] = useState<AiThinkingState>({
    userMessage: "Processing...",
    currentTool: "",
    toolIndex: 0,
    totalTools: 0,
  });
  const [isHovered, setIsHovered] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Handle window becoming visible - reset state for new AI session
  const handleWindowVisible = useCallback(() => {
    console.log("[AI THINKING BAR] Window shown, ready for AI session");
    setIsStopping(false);
  }, []);

  useBarWindow(handleWindowVisible);

  // Listen for AI thinking updates
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      unlisten = await listen<AiThinkingState>("ai-thinking-update", event => {
        console.log("📊 [AI THINKING BAR] Update:", event.payload);
        setState(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleStop = async () => {
    if (isStopping) {
      console.log("⏳ Stop already in progress, ignoring duplicate click");
      return;
    }

    try {
      setIsStopping(true);
      console.log("🛑 Stop AI button clicked from AI thinking bar");

      const eventId = Date.now().toString();

      await emit("stop-ai-from-bar", {
        action: "stop",
        eventId,
        timestamp: Date.now(),
      });
      console.log("✅ Stop AI signal emitted with ID:", eventId);
    } catch (error) {
      console.error("❌ Failed to stop AI:", error);
      setIsStopping(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center p-2">
      <div
        className={`
          bg-white rounded-lg px-4 py-2.5
          flex flex-col gap-2
          shadow-xl border border-black
          transition-all duration-200
          ${isHovered ? "shadow-2xl" : ""}
          min-w-[340px]
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Top row: AI indicator and stop button */}
        <div className="flex items-center justify-between gap-3">
          {/* AI thinking indicator */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-3 h-3 bg-black rounded-full animate-pulse" />
              <div className="absolute inset-0 w-3 h-3 bg-black rounded-full animate-ping opacity-75" />
            </div>
            <span className="text-black font-semibold text-sm tracking-wide">AI THINKING</span>
          </div>

          {/* Tool progress (if executing tools) */}
          {state.totalTools > 0 && (
            <div className="text-black font-mono text-xs">
              Tool {state.toolIndex + 1} / {state.totalTools}
            </div>
          )}

          {/* Stop button */}
          <button
            onClick={handleStop}
            disabled={isStopping}
            className={`
              px-3 py-1.5 rounded-md font-medium text-xs
              transition-all duration-200
              border border-black
              ${
                isStopping
                  ? "bg-white/50 text-black/50 cursor-not-allowed"
                  : "bg-black text-white hover:bg-white hover:text-black"
              }
              flex items-center gap-1.5
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isStopping ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Stopping...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                  <rect width="16" height="16" rx="2" />
                </svg>
                Stop
              </>
            )}
          </button>
        </div>

        {/* User message */}
        <div className="flex items-center gap-2">
          <span className="text-black text-xs font-semibold shrink-0">→</span>
          <div className="text-black text-xs truncate" title={state.userMessage}>
            {state.userMessage}
          </div>
        </div>

        {/* Current tool (if executing) */}
        {state.currentTool && (
          <div className="flex items-center gap-2">
            <span className="text-black text-xs font-semibold shrink-0">⚙</span>
            <div className="text-black text-xs truncate font-mono" title={state.currentTool}>
              {state.currentTool}
            </div>
          </div>
        )}

        {/* Thinking animation bar */}
        <div className="w-full bg-white border border-black rounded-full h-1.5 overflow-hidden">
          <div className="bg-black h-full animate-pulse" style={{ width: "100%" }} />
        </div>
      </div>
    </div>
  );
};
