import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { useEffect, useState } from "react";

interface RecordedAction {
  rawEvent: Record<string, unknown> | null;
  // TypeScript SDK code generated from the event
  typescriptCode?: string;
  description?: string;
  eventType: string;
  // Fields for pending action (shown immediately before full data available)
  isPending?: boolean;
  pendingActionType?: "click" | "keyboard" | "hotkey";
  position?: { x: number; y: number } | null;
}

export const ActionReview: React.FC = () => {
  const [action, setAction] = useState<RecordedAction | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    console.log("🎯 [ACTION-REVIEW] Component mounted, setting up listener...");

    // Listen for action data from main app - stable listener, no dependencies
    const unlisten = listen<RecordedAction>("action-review-data", event => {
      console.log("📥 Received action for review:", event.payload);
      setAction(event.payload);
      setIsProcessing(false);
    });

    // Signal to backend that we're ready to receive data
    emit("action-review-ready", {}).then(() => {
      console.log("✅ [ACTION-REVIEW] Signaled ready to backend");
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []); // Empty deps - listener should be stable, not recreated on action change

  useEffect(() => {
    // Request current action data when window becomes visible (separate effect)
    const checkVisibility = async () => {
      const window = getCurrentWindow();
      const isVisible = await window.isVisible();
      if (isVisible && !action) {
        // Request action data
        await emit("action-review-ready", {});
      }
    };

    const visibilityInterval = setInterval(checkVisibility, 100);

    return () => {
      clearInterval(visibilityInterval);
    };
  }, [action]);

  const handleStartDragging = async () => {
    const window = getCurrentWindow();
    await window.startDragging();
  };

  const handleSaveAndContinue = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    console.log("✅ Save & Continue clicked, rawEvent:", action?.rawEvent ? "present" : "missing");
    console.log("✅ [DEBUG] rawEvent keys:", action?.rawEvent ? Object.keys(action.rawEvent) : "null");
    const rawEventCopy = action?.rawEvent ? JSON.parse(JSON.stringify(action.rawEvent)) : null;
    await emit("action-review-response", { action: "save-continue", rawEvent: rawEventCopy });
    // Clear action state to prevent stale data on next event
    setAction(null);
  };

  const handleSaveAndStop = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    console.log("✅ Save & Stop clicked, rawEvent:", action?.rawEvent ? "present" : "missing");
    console.log("✅ [DEBUG] rawEvent keys:", action?.rawEvent ? Object.keys(action.rawEvent) : "null");
    const rawEventCopy = action?.rawEvent ? JSON.parse(JSON.stringify(action.rawEvent)) : null;
    await emit("action-review-response", { action: "save-stop", rawEvent: rawEventCopy });
    // Clear action state to prevent stale data on next event
    setAction(null);
  };

  const handleDiscardAndPause = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    console.log("❌ Discard & Pause clicked");
    await emit("action-review-response", { action: "discard-pause" });
  };

  const handleDiscardAndContinue = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    console.log("❌ Discard & Continue clicked");
    await emit("action-review-response", { action: "discard-continue" });
  };

  const formatJson = (obj: Record<string, unknown>): string => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  // Show loading state when no action yet OR when action is pending (waiting for full data)
  if (!action || action.isPending) {
    const actionTypeLabel = action?.pendingActionType
      ? action.pendingActionType.charAt(0).toUpperCase() + action.pendingActionType.slice(1)
      : null;
    const statusMessage = action?.isPending ? `Processing ${actionTypeLabel || "action"}...` : "Waiting for action...";

    return (
      <div className="fixed inset-0 flex items-start justify-center p-2 theme-classic">
        <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 rounded-lg shadow-xl border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white w-full h-full flex flex-col overflow-hidden">
          {/* Draggable Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-white cursor-move select-none shrink-0"
            onMouseDown={handleStartDragging}
          >
            <h2 className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white font-medium text-sm">
              Processing Action
            </h2>
            <div className="flex items-center gap-1 [.theme-classic_&]:text-black/40 [.theme-inverted_&]:text-white/40">
              <span className="text-xs">drag to move</span>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
            {/* Spinner and status */}
            <div className="flex items-center gap-3">
              <svg
                className="w-5 h-5 animate-spin [.theme-classic_&]:text-black [.theme-inverted_&]:text-white"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white text-sm font-medium">
                {statusMessage}
              </span>
            </div>

            {/* Position info if available */}
            {action?.position && (
              <div className="[.theme-classic_&]:text-black/60 [.theme-inverted_&]:text-white/60 text-xs font-mono">
                Position: ({action.position.x}, {action.position.y})
              </div>
            )}

            {/* Warning message */}
            <div className="[.theme-classic_&]:bg-black/5 [.theme-inverted_&]:bg-white/5 rounded-md p-4 border [.theme-classic_&]:border-black/20 [.theme-inverted_&]:border-white/20 max-w-sm text-center">
              <p className="[.theme-classic_&]:text-black/80 [.theme-inverted_&]:text-white/80 text-sm">
                Please do not interact with your computer while the action is being processed.
              </p>
              <p className="[.theme-classic_&]:text-black/50 [.theme-inverted_&]:text-white/50 text-xs mt-2">
                Capturing UI state for accurate workflow recording...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-start justify-center p-2 theme-classic">
      <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 rounded-lg shadow-xl border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white w-full h-full flex flex-col overflow-hidden">
        {/* Draggable Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b [.theme-classic_&]:border-black [.theme-inverted_&]:border-white cursor-move select-none shrink-0"
          onMouseDown={handleStartDragging}
        >
          <h2 className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white font-medium text-sm">
            Action Recorded
          </h2>
          <div className="flex items-center gap-1 [.theme-classic_&]:text-black/40 [.theme-inverted_&]:text-white/40">
            <span className="text-xs">drag to move</span>
          </div>
        </div>

        {/* Content - flex column to share height */}
        <div className="flex-1 flex flex-col p-4 gap-4 min-h-0">
          {/* Raw Event */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white text-xs font-medium mb-2 uppercase tracking-wide shrink-0">
              Raw Event:
            </h3>
            <pre className="flex-1 [.theme-classic_&]:bg-black/5 [.theme-inverted_&]:bg-white/5 rounded-md p-3 text-xs [.theme-classic_&]:text-black [.theme-inverted_&]:text-white overflow-auto font-mono border [.theme-classic_&]:border-black/20 [.theme-inverted_&]:border-white/20">
              {action.rawEvent ? formatJson(action.rawEvent) : "Loading..."}
            </pre>
          </div>

          {/* TypeScript Code */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white text-xs font-medium mb-2 uppercase tracking-wide shrink-0">
              TypeScript Code:
            </h3>
            {action.typescriptCode ? (
              <div className="flex-1 flex flex-col [.theme-classic_&]:bg-black/5 [.theme-inverted_&]:bg-white/5 rounded-md p-3 border [.theme-classic_&]:border-black/20 [.theme-inverted_&]:border-white/20 min-h-0">
                {action.description && (
                  <div className="flex items-center gap-2 mb-2 shrink-0">
                    <span className="[.theme-classic_&]:text-gray-600 [.theme-inverted_&]:text-gray-400 text-xs">
                      {action.description}
                    </span>
                  </div>
                )}
                <pre className="flex-1 text-xs [.theme-classic_&]:text-green-700 [.theme-inverted_&]:text-green-400 overflow-auto font-mono whitespace-pre-wrap">
                  {action.typescriptCode}
                </pre>
              </div>
            ) : (
              <div className="flex-1 [.theme-classic_&]:bg-black/5 [.theme-inverted_&]:bg-white/5 rounded-md p-3 border [.theme-classic_&]:border-black/20 [.theme-inverted_&]:border-white/20">
                <span className="[.theme-classic_&]:text-yellow-700 [.theme-inverted_&]:text-yellow-400 text-xs">
                  Could not convert to TypeScript
                </span>
              </div>
            )}
          </div>

          {/* Expected UI Changes - removed with MCP tool deprecation */}
        </div>

        {/* Footer with buttons */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t [.theme-classic_&]:border-black [.theme-inverted_&]:border-white shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscardAndPause}
              disabled={isProcessing}
              className={`
                px-3 py-2 rounded-md text-xs font-medium
                transition-all duration-200
                border border-red-600
                bg-transparent text-red-600
                hover:bg-red-600 hover:text-white
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              Discard & Pause
            </button>
            <button
              onClick={handleDiscardAndContinue}
              disabled={isProcessing}
              className={`
                px-3 py-2 rounded-md text-xs font-medium
                transition-all duration-200
                border border-red-600
                bg-red-600 text-white
                hover:bg-red-700 hover:border-red-700
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              Discard & Continue
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAndStop}
              disabled={isProcessing}
              className={`
                px-4 py-2 rounded-md text-sm font-medium
                transition-all duration-200
                border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white
                [.theme-classic_&]:bg-transparent [.theme-inverted_&]:bg-transparent
                [.theme-classic_&]:text-black [.theme-inverted_&]:text-white
                [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:hover:bg-white/10
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
            >
              Save & Stop
            </button>
            <button
              onClick={handleSaveAndContinue}
              disabled={isProcessing}
              className={`
                px-4 py-2 rounded-md text-sm font-medium
                transition-all duration-200
                border [.theme-classic_&]:border-black [.theme-inverted_&]:border-black
                [.theme-classic_&]:bg-black [.theme-inverted_&]:bg-white
                [.theme-classic_&]:text-white [.theme-inverted_&]:text-black
                [.theme-classic_&]:hover:bg-black/90 [.theme-inverted_&]:hover:bg-white/90
                disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center gap-2
              `}
            >
              {isProcessing ? (
                <>
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save & Continue"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
