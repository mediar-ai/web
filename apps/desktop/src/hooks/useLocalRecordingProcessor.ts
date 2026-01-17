import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Progress data for local recording processing
 */
export interface LocalProcessingProgress {
  stage: "step_analysis" | "labeling" | "synthesis" | "generation";
  current: number;
  total: number;
  message: string;
  /** Index of current stage (0-3) */
  stageIndex: number;
  /** Total number of stages (always 4) */
  totalStages: number;
  /** Totals for all stages [step_analysis, labeling, synthesis, generation] */
  stageTotals: number[];
}

/**
 * Result of local processing
 */
export interface LocalProcessingResult {
  success: boolean;
  workflowFolder: string | null;
  error: string | null;
  eventCount: number;
  stepCount: number;
  workflowCount: number;
}

/**
 * Stats for streaming analysis during recording
 */
export interface StreamingStats {
  meaningfulEventCount: number;
  completedAnalyses: number;
  completedLabels: number;
  isStreaming: boolean;
}

/**
 * Hook for local recording processing
 *
 * This hook provides functions to process recordings locally using Gemini Vertex AI
 * without sending data to the web app or Modal containers.
 *
 * Streaming analysis runs automatically during recording to speed up post-processing:
 * - Step analyses run in parallel as events arrive
 * - Labeling runs once enough neighbors are analyzed
 *
 * Usage:
 * ```tsx
 * const {
 *   progress,
 *   isProcessing,
 *   result,
 *   error,
 *   streamingStats,
 *   processLocally,
 *   getEventCount,
 *   clear
 * } = useLocalRecordingProcessor();
 *
 * // Process after recording stops
 * const handleStop = async () => {
 *   const result = await processLocally(workflowFolder);
 *   if (result.success) {
 *     console.log("Workflow generated at:", result.workflowFolder);
 *   }
 * };
 * ```
 */
export function useLocalRecordingProcessor() {
  const [progress, setProgress] = useState<LocalProcessingProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<LocalProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingStats, setStreamingStats] = useState<StreamingStats | null>(null);

  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Set up event listener for progress updates
  useEffect(() => {
    const setupListener = async () => {
      unlistenRef.current = await listen<LocalProcessingProgress>("local-processing-progress", event => {
        setProgress(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  /**
   * Start streaming analysis mode
   * Analyses will run in parallel as events arrive during recording
   */
  const startStreaming = useCallback(async () => {
    try {
      console.log("[LocalProcessor] Starting streaming analysis");
      await invoke("start_streaming_analysis");
    } catch (e) {
      console.error("[LocalProcessor] Failed to start streaming:", e);
    }
  }, []);

  /**
   * Stop streaming analysis mode
   */
  const stopStreaming = useCallback(async () => {
    try {
      console.log("[LocalProcessor] Stopping streaming analysis");
      await invoke("stop_streaming_analysis");
    } catch (e) {
      console.error("[LocalProcessor] Failed to stop streaming:", e);
    }
  }, []);

  /**
   * Get current streaming analysis stats
   */
  const getStreamingStats = useCallback(async (): Promise<StreamingStats | null> => {
    try {
      const stats = await invoke<StreamingStats>("get_streaming_analysis_stats");
      setStreamingStats(stats);
      return stats;
    } catch (e) {
      console.error("[LocalProcessor] Failed to get streaming stats:", e);
      return null;
    }
  }, []);

  /**
   * Initialize the local processor for a session and start streaming analysis
   */
  const init = useCallback(
    async (sessionId: string) => {
      try {
        await invoke("init_local_recording_processor", { input: { sessionId } });
        // Start streaming analysis automatically when initializing
        await startStreaming();
      } catch (e) {
        console.error("[LocalProcessor] Failed to initialize:", e);
        setError(String(e));
      }
    },
    [startStreaming]
  );

  /**
   * Get current event count in the processor
   */
  const getEventCount = useCallback(async (): Promise<number> => {
    try {
      return await invoke<number>("get_local_processor_event_count");
    } catch (e) {
      console.error("[LocalProcessor] Failed to get event count:", e);
      return 0;
    }
  }, []);

  /**
   * Process the recording locally and generate workflow files
   * Automatically stops streaming and uses any completed analyses
   */
  const processLocally = useCallback(
    async (workflowFolder: string): Promise<LocalProcessingResult> => {
      setIsProcessing(true);
      setError(null);
      setResult(null);
      setProgress(null);

      try {
        // Stop streaming before processing to finalize any pending work
        await stopStreaming();

        // Log streaming stats before processing
        const stats = await getStreamingStats();
        if (stats) {
          console.log(
            `[LocalProcessor] Streaming stats before processing: ${stats.completedAnalyses} analyses, ${stats.completedLabels} labels completed during recording`
          );
        }

        console.log("[LocalProcessor] Starting local processing to:", workflowFolder);
        const processingResult = await invoke<LocalProcessingResult>("process_recording_locally", {
          workflowFolder,
        });

        setResult(processingResult);

        if (!processingResult.success && processingResult.error) {
          setError(processingResult.error);
        }

        return processingResult;
      } catch (e) {
        const errorMsg = String(e);
        console.error("[LocalProcessor] Processing failed:", errorMsg);
        setError(errorMsg);
        return {
          success: false,
          workflowFolder: null,
          error: errorMsg,
          eventCount: 0,
          stepCount: 0,
          workflowCount: 0,
        };
      } finally {
        setIsProcessing(false);
      }
    },
    [stopStreaming, getStreamingStats]
  );

  /**
   * Clear the processor
   */
  const clear = useCallback(async () => {
    try {
      await invoke("clear_local_recording_processor");
      setProgress(null);
      setResult(null);
      setError(null);
      setStreamingStats(null);
    } catch (e) {
      console.error("[LocalProcessor] Failed to clear:", e);
    }
  }, []);

  return {
    // State
    progress,
    isProcessing,
    result,
    error,
    streamingStats,

    // Actions
    init,
    getEventCount,
    processLocally,
    clear,
    startStreaming,
    stopStreaming,
    getStreamingStats,
  };
}
