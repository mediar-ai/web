import { emit, listen } from "@tauri-apps/api/event";
import React, { useEffect, useState, useCallback } from "react";
import { useBarWindow } from "./hooks/useBarWindow";

interface ExecutionProgress {
  currentStep: number;
  totalSteps: number;
  stepName: string;
  mode: "single" | "full";
}

export const ExecutionBar: React.FC = () => {
  const [progress, setProgress] = useState<ExecutionProgress>({
    currentStep: 0,
    totalSteps: 0,
    stepName: "Initializing...",
    mode: "single",
  });
  const [isHovered, setIsHovered] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isPausing, setIsPausing] = useState(false);

  // Handle window becoming visible - reset state for new execution session
  const handleWindowVisible = useCallback(() => {
    console.log("[EXECUTION BAR] Window shown, ready for execution");
    setIsStopping(false);
    setIsPausing(false);
  }, []);

  useBarWindow(handleWindowVisible);

  // Listen for progress updates
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setupListener = async () => {
      unlisten = await listen<ExecutionProgress>("execution-progress-update", event => {
        console.log("📊 [EXECUTION BAR] Progress update:", event.payload);
        setProgress(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const handleStopExecution = async () => {
    // Prevent multiple stop requests (debouncing)
    if (isStopping || isPausing) {
      console.log("⏳ Action already in progress, ignoring duplicate click");
      return;
    }

    try {
      setIsStopping(true);
      console.log("🛑 Stop execution button clicked from execution bar");

      // Generate unique event ID to help with deduplication on receiver side
      const eventId = Date.now().toString();

      // Emit stop signal to main window
      await emit("stop-execution-from-bar", {
        action: "stop",
        eventId,
        timestamp: Date.now(),
      });
      console.log("✅ Stop execution signal emitted with ID:", eventId);
    } catch (error) {
      console.error("❌ Failed to stop execution:", error);
      // Reset stopping state on error so user can retry
      setIsStopping(false);
    }
    // Note: Don't reset isStopping on success - window will close anyway
  };

  const handlePauseExecution = async () => {
    // Prevent multiple pause requests
    if (isStopping || isPausing) {
      console.log("⏳ Action already in progress, ignoring duplicate click");
      return;
    }

    try {
      setIsPausing(true);
      console.log("⏸️ Pause execution button clicked from execution bar");

      const eventId = Date.now().toString();

      await emit("pause-execution-from-bar", {
        action: "pause",
        eventId,
        timestamp: Date.now(),
      });
      console.log("✅ Pause execution signal emitted with ID:", eventId);
    } catch (error) {
      console.error("❌ Failed to pause execution:", error);
      setIsPausing(false);
    }
  };

  const getProgressPercentage = (): number => {
    if (progress.totalSteps === 0) return 0;
    return ((progress.currentStep + 1) / progress.totalSteps) * 100;
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
        {/* Top row: Execution indicator and controls */}
        <div className="flex items-center justify-between gap-3">
          {/* Execution indicator */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <div className="w-3 h-3 bg-black rounded-full animate-pulse" />
              <div className="absolute inset-0 w-3 h-3 bg-black rounded-full animate-ping opacity-75" />
            </div>
            <span className="text-black font-semibold text-sm tracking-wide">
              {progress.mode === "full" ? "AUTO" : "EXEC"}
            </span>
          </div>

          {/* Control buttons */}
          <div className="flex items-center gap-2">
            {/* Pause button - only show in full workflow mode */}
            {progress.mode === "full" && (
              <button
                onClick={handlePauseExecution}
                disabled={isStopping || isPausing}
                className={`
                  px-3 py-1.5 rounded-md font-medium text-xs
                  transition-all duration-200
                  border border-black
                  ${
                    isPausing ? "bg-black/50 text-white/50 cursor-not-allowed" : "bg-black text-white hover:bg-black/90"
                  }
                  flex items-center gap-1.5
                  disabled:opacity-50 disabled:cursor-not-allowed
                `}
                title="Pause execution"
              >
                {isPausing ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Pausing...
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
                    </svg>
                    Pause
                  </>
                )}
              </button>
            )}

            {/* Stop button */}
            <button
              onClick={handleStopExecution}
              disabled={isStopping || isPausing}
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
        </div>

        {/* Step name */}
        <div className="text-black text-xs truncate" title={progress.stepName}>
          {progress.stepName}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-white border border-black rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-black h-full transition-all duration-300 ease-out"
            style={{ width: `${getProgressPercentage()}%` }}
          />
        </div>
      </div>
    </div>
  );
};
