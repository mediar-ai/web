import { emit, listen } from "@tauri-apps/api/event";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useBarWindow } from "./hooks/useBarWindow";

type RecordingState = "recording" | "paused";

export const RecordingBar: React.FC = () => {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [recordingState, setRecordingState] = useState<RecordingState>("recording");
  const [actionCount, setActionCount] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Handle window becoming visible - reset state for new recording session
  const handleWindowVisible = useCallback(() => {
    console.log("[RECORDING BAR] Window shown, resetting state");
    setElapsedTime(0);
    setIsStopping(false);
    setRecordingState("recording");
    setActionCount(0);

    // Clear any existing interval
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }

    // Start new interval
    timerIntervalRef.current = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
  }, []);

  useBarWindow(handleWindowVisible);

  // Listen for state updates from main app
  useEffect(() => {
    const unlistenPause = listen("recording-bar-pause", () => {
      console.log("[RECORDING BAR] Received pause signal");
      setRecordingState("paused");
      // Stop the timer when paused
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    });

    const unlistenResume = listen("recording-bar-resume", () => {
      console.log("[RECORDING BAR] Received resume signal");
      setRecordingState("recording");
      // Restart the timer
      if (!timerIntervalRef.current) {
        timerIntervalRef.current = setInterval(() => {
          setElapsedTime(prev => prev + 1);
        }, 1000);
      }
    });

    const unlistenActionCount = listen<{ count: number }>("recording-bar-action-count", event => {
      console.log("[RECORDING BAR] Action count updated:", event.payload.count);
      setActionCount(event.payload.count);
    });

    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      unlistenPause.then(fn => fn());
      unlistenResume.then(fn => fn());
      unlistenActionCount.then(fn => fn());
    };
  }, []);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleStopRecording = async () => {
    // Prevent multiple stop requests (debouncing)
    if (isStopping) {
      console.log("⏳ Stop already in progress, ignoring duplicate click");
      return;
    }

    try {
      setIsStopping(true);
      console.log("🛑 Stop recording button clicked from recording bar");

      // Stop the timer immediately
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
        console.log("⏱️ Timer stopped at:", formatTime(elapsedTime));
      }

      // Need to emit to all windows since we're in a separate window
      // Use emit with a unique event ID to prevent duplicates
      // Generate unique event ID to help with deduplication on receiver side
      const eventId = Date.now().toString();

      // Use global emit (not emitTo) to avoid multiple emissions
      await emit("stop-recording-from-bar", {
        action: "stop",
        eventId, // Include unique ID for deduplication
        timestamp: Date.now(),
      });
      console.log("✅ Stop recording signal emitted with ID:", eventId);
    } catch (error) {
      console.error("❌ Failed to stop recording:", error);
      // Reset stopping state on error so user can retry
      setIsStopping(false);
    }
    // Note: Don't reset isStopping on success - window will close anyway
  };

  const handleResumeRecording = async () => {
    console.log("▶️ Resume recording button clicked from recording bar");
    try {
      await emit("resume-recording-from-bar", {
        timestamp: Date.now(),
      });
      console.log("✅ Resume recording signal emitted");
    } catch (error) {
      console.error("❌ Failed to resume recording:", error);
    }
  };

  const isPaused = recordingState === "paused";

  return (
    <div className="fixed inset-0 flex items-center justify-center p-1.5">
      <div
        className={`
          bg-neutral-900 rounded-md px-3 py-1.5
          flex items-center gap-2
          shadow-lg border border-neutral-700
          transition-all duration-200
          ${isHovered ? "bg-neutral-800 shadow-xl" : ""}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Recording/Paused indicator */}
        <div className="flex items-center gap-1.5">
          {isPaused ? (
            <>
              <div className="w-2.5 h-2.5 bg-neutral-400 rounded-sm" />
              <span className="text-neutral-300 font-semibold text-xs tracking-wide">PAUSED</span>
            </>
          ) : (
            <>
              <div className="relative">
                <div className="w-2.5 h-2.5 bg-white rounded-full animate-pulse" />
                <div className="absolute inset-0 w-2.5 h-2.5 bg-white rounded-full animate-ping opacity-50" />
              </div>
              <span className="text-neutral-200 font-semibold text-xs tracking-wide">REC</span>
            </>
          )}
        </div>

        {/* Timer */}
        <div className="text-neutral-300 font-mono text-xs min-w-[42px] text-center">{formatTime(elapsedTime)}</div>

        {/* Action count */}
        {actionCount > 0 && (
          <div className="flex items-center text-neutral-400 text-xs">
            <span className="bg-neutral-800 px-1.5 py-0.5 rounded text-[11px]">
              {actionCount} {actionCount === 1 ? "action" : "actions"}
            </span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Resume button (only when paused) */}
          {isPaused && (
            <button
              onClick={handleResumeRecording}
              className={`
                px-2 py-1 rounded font-medium text-xs
                transition-all duration-200 transform
                bg-neutral-700 text-neutral-200
                hover:bg-neutral-600 active:scale-95
                flex items-center gap-1
              `}
            >
              <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M3 2.5l10 5.5L3 13.5V2.5z" />
              </svg>
              Resume
            </button>
          )}

          {/* Stop button */}
          <button
            onClick={handleStopRecording}
            disabled={isStopping}
            className={`
              px-2 py-1 rounded font-medium text-xs
              transition-all duration-200 transform
              ${
                isStopping
                  ? "bg-neutral-600 text-neutral-400 cursor-not-allowed"
                  : isHovered
                    ? "bg-red-600 text-white scale-105 shadow-lg"
                    : "bg-red-600/90 text-white"
              }
              ${!isStopping && "hover:bg-red-500 active:scale-95"}
              flex items-center gap-1
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isStopping ? (
              <>
                <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 16 16">
                  <rect width="16" height="16" rx="2" />
                </svg>
                Stop
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
