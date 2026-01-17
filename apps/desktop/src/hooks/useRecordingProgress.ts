import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Recording progress data from the backend
 */
export interface RecordingProgress {
  sessionId: string;
  status: "recording" | "processing" | "ready_for_synthesis" | "synthesizing" | "complete";
  eventCount: number;
  uiTreeEventCount: number;
  processedCount: number;
  pendingCount: number;
  progressPercent: number;
  estimatedSecondsRemaining: number | null;
  firstEventAt: string | null;
  lastEventAt: string | null;
  recordingDurationSeconds: number;
}

/**
 * Synthesis event from the backend
 */
export interface SynthesisEvent {
  status?: string;
  progress?: number;
  step?: number;
  error?: string;
  details?: string;
  result?: unknown;
}

/**
 * Hook for tracking recording progress and managing synthesis
 *
 * Usage:
 * ```tsx
 * const { progress, error, isPolling, startPolling, stopAndSynthesize } = useRecordingProgress();
 *
 * // Start polling when recording begins
 * useEffect(() => {
 *   if (isRecording && sessionId) {
 *     startPolling(sessionId);
 *   }
 * }, [isRecording, sessionId]);
 *
 * // Stop recording and synthesize
 * const handleStop = () => stopAndSynthesize(userId);
 * ```
 */
export function useRecordingProgress() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<RecordingProgress | null>(null);
  const [synthesisProgress, setSynthesisProgress] = useState<SynthesisEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  const pollingRef = useRef<boolean>(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Get session ID from backend
  const fetchSessionId = useCallback(async (): Promise<string | null> => {
    try {
      const id = await invoke<string | null>("get_recording_session_id");
      setSessionId(id);
      return id;
    } catch (e) {
      console.error("[useRecordingProgress] Failed to get session ID:", e);
      return null;
    }
  }, []);

  // Poll progress once
  const pollOnce = useCallback(async (sid: string): Promise<RecordingProgress | null> => {
    try {
      const prog = await invoke<RecordingProgress>("poll_recording_progress", {
        sessionId: sid,
      });
      setProgress(prog);
      setError(null);
      return prog;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[useRecordingProgress] Poll error:", msg);
      setError(msg);
      return null;
    }
  }, []);

  // Start polling
  const startPolling = useCallback(
    async (sid?: string) => {
      // Get session ID if not provided
      let targetSessionId = sid;
      if (!targetSessionId) {
        targetSessionId = (await fetchSessionId()) ?? undefined;
      }

      if (!targetSessionId) {
        console.warn("[useRecordingProgress] Cannot start polling: no session ID");
        return;
      }

      setSessionId(targetSessionId);
      pollingRef.current = true;
      setIsPolling(true);
      setError(null);

      console.log("[useRecordingProgress] Starting progress polling for session:", targetSessionId);

      // Initial poll
      await pollOnce(targetSessionId);

      // Set up interval polling (every 2 seconds)
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      pollIntervalRef.current = setInterval(async () => {
        if (!pollingRef.current) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          return;
        }
        await pollOnce(targetSessionId!);
      }, 2000);
    },
    [fetchSessionId, pollOnce]
  );

  // Stop polling
  const stopPolling = useCallback(() => {
    console.log("[useRecordingProgress] Stopping progress polling");
    pollingRef.current = false;
    setIsPolling(false);

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Stop recording and trigger synthesis
  const stopAndSynthesize = useCallback(
    async (userId: string) => {
      if (!sessionId) {
        setError("No session ID available");
        return;
      }

      console.log("[useRecordingProgress] Stopping recording and starting synthesis");
      stopPolling();
      setIsSynthesizing(true);

      try {
        // This will wait for processing and trigger synthesis
        await invoke("stop_recording_and_synthesize", {
          sessionId,
          userId,
        });
        console.log("[useRecordingProgress] Synthesis complete");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[useRecordingProgress] Synthesis error:", msg);
        setError(msg);
      } finally {
        setIsSynthesizing(false);
      }
    },
    [sessionId, stopPolling]
  );

  // Notify backend recording stopped (without waiting for synthesis)
  const notifyRecordingStopped = useCallback(
    async (userId: string): Promise<number> => {
      if (!sessionId) {
        throw new Error("No session ID available");
      }

      try {
        const pendingCount = await invoke<number>("notify_recording_stopped", {
          sessionId,
          userId,
        });
        return pendingCount;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[useRecordingProgress] Failed to notify recording stopped:", msg);
        throw new Error(msg);
      }
    },
    [sessionId]
  );

  // Listen for progress events from backend
  useEffect(() => {
    let unlistenProgress: UnlistenFn | null = null;
    let unlistenSynthesis: UnlistenFn | null = null;

    const setupListeners = async () => {
      unlistenProgress = await listen<RecordingProgress>("recording_progress", event => {
        console.log("[useRecordingProgress] Received progress event:", event.payload);
        setProgress(event.payload);
      });

      unlistenSynthesis = await listen<SynthesisEvent>("synthesis_event", event => {
        console.log("[useRecordingProgress] Received synthesis event:", event.payload);
        setSynthesisProgress(event.payload);
      });
    };

    setupListeners();

    return () => {
      unlistenProgress?.();
      unlistenSynthesis?.();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pollingRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  return {
    // State
    sessionId,
    progress,
    synthesisProgress,
    error,
    isPolling,
    isSynthesizing,

    // Actions
    fetchSessionId,
    startPolling,
    stopPolling,
    pollOnce,
    stopAndSynthesize,
    notifyRecordingStopped,

    // Computed
    isProcessingComplete: progress?.pendingCount === 0 && progress?.status !== "recording",
    isReadyForSynthesis: progress?.status === "ready_for_synthesis",
  };
}

/**
 * Format seconds to human readable duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
