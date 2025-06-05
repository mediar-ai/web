import { useCallback, useEffect, useState } from 'react';
import type { BufferedFrame, ActivityItem, UIDiffAnalysis } from '../types'; // Assuming types are exported

interface UseFrameAnalysisDispatcherProps {
  frameBuffer: BufferedFrame[];
  setFrameBuffer: React.Dispatch<React.SetStateAction<BufferedFrame[]>>;
  setActivityItems: React.Dispatch<React.SetStateAction<ActivityItem[]>>;
  activeAnalysesCount: number;
  setActiveAnalysesCount: React.Dispatch<React.SetStateAction<number>>;
  logToUI: (...args: unknown[]) => void;
  logError: (...args: unknown[]) => void;
  setMainStatus: React.Dispatch<React.SetStateAction<string>>;
  MAX_PARALLEL_ANALYSES: number;
}

export function useFrameAnalysisDispatcher({
  frameBuffer,
  setFrameBuffer,
  setActivityItems,
  activeAnalysesCount,
  setActiveAnalysesCount,
  logToUI,
  logError,
  setMainStatus,
  MAX_PARALLEL_ANALYSES,
}: UseFrameAnalysisDispatcherProps): void { // This hook might not need to return anything directly
  const [baselineFrameForDiff, setBaselineFrameForDiff] = useState<BufferedFrame | null>(null);
  const [pendingFrameForDiff, setPendingFrameForDiff] = useState<BufferedFrame | null>(null);
  const [initialDumpInProgress, setInitialDumpInProgress] = useState<boolean>(false);
  const [diffAnalysisInProgress, setDiffAnalysisInProgress] = useState<boolean>(false);

  const processInitialFrameDump = useCallback(
    async (frameToDump: BufferedFrame) => {
      if (initialDumpInProgress) return;
      setInitialDumpInProgress(true);
      setActiveAnalysesCount((prev) => prev + 1);
      // Use current prop value for status. If activeAnalysesCount itself triggers re-render of parent, this will be up-to-date.
      setMainStatus(`Analyzing Initial Frame (${activeAnalysesCount + 1})...`);
      logToUI(
        '[processInitialFrameDump] 🖼️ Starting raw content dump for initial frame:',
        frameToDump.id,
      );
      try {
        const response = await fetch('/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: frameToDump.imageDataUrl,
            timestamp: new Date(frameToDump.timestamp).toISOString(),
            prompt:
              'List in maximum detail all visible text and UI elements from the screenshot. Describe layout and objects.',
            analysisType: 'initial_frame_dump',
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        if (
          result.analysis &&
          typeof result.analysis.raw_content === 'string'
        ) {
          logToUI(
            '[processInitialFrameDump] ✅ Initial frame dump successful...',
          );
          const newActivityItem: ActivityItem = {
            type: 'initial_dump',
            id: frameToDump.id,
            timestamp: new Date(frameToDump.timestamp).toISOString(),
            raw_content: result.analysis.raw_content,
            image_id: frameToDump.id,
          };
          setActivityItems((prev) =>
            [newActivityItem, ...prev].sort(
              (a, b) => {
                const idA = a.type === 'ui_diff' ? a.image2_id : a.image_id;
                const idB = b.type === 'ui_diff' ? b.image2_id : b.image_id;
                const timeA = new Date(
                  idA!.split('-diff')[0].split('-change-')[0],
                ).getTime();
                const timeB = new Date(
                  idB!.split('-diff')[0].split('-change-')[0],
                ).getTime();
                return timeB - timeA;
              },
            )
          );
          setBaselineFrameForDiff(frameToDump);
        } else {
          logError(
            '[processInitialFrameDump] Backend error for initial dump:',
            result.error || 'Unknown error',
            result.details || '',
          );
        }
      } catch (err) {
        logError(
          '[processInitialFrameDump] Network error during initial dump:',
          err,
        );
      } finally {
        setActiveAnalysesCount((prev) => Math.max(0, prev - 1));
        setInitialDumpInProgress(false);
      }
    },
    [
      initialDumpInProgress, // Internal state
      setActiveAnalysesCount, // Prop setter
      activeAnalysesCount,    // Prop value (for status string)
      setMainStatus,          // Prop setter
      logToUI,                // Prop
      logError,               // Prop
      setActivityItems,       // Prop setter
      setBaselineFrameForDiff,// Internal setter
      // No need for initialDumpInProgress in deps for setInitialDumpInProgress(true/false)
    ],
  );

  const processUIDiffRequest = useCallback(
    async (frame1: BufferedFrame, frame2: BufferedFrame) => {
      if (diffAnalysisInProgress) return;
      setDiffAnalysisInProgress(true);
      setActiveAnalysesCount((prev) => prev + 1);
      setMainStatus(`Analyzing UI Diff (${activeAnalysesCount + 1})...`);
      const newDiffId = frame2.id + '-diff';
      const displayTimestamp = new Date(frame2.timestamp).toISOString();
      logToUI(
        '[processUIDiffRequest] 🚀 Starting UI Diff analysis between:',
        frame1.id,
        'and',
        frame2.id,
      );

      try {
        const response = await fetch('/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image1_dataUrl: frame1.imageDataUrl,
            image2_dataUrl: frame2.imageDataUrl,
            analysisType: 'ui_diff',
            prompt: 'Perform UI difference analysis',
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        if (response.ok && typeof result.analysis === 'object') {
          const diffData = result.analysis as Omit<
            UIDiffAnalysis,
            'type' | 'id' | 'timestamp' | 'image1_id' | 'image2_id'
          >;

          const newActivityItem: ActivityItem = {
            type: 'ui_diff',
            ...diffData,
            id: newDiffId,
            timestamp: displayTimestamp,
            image1_id: frame1.id,
            image2_id: frame2.id,
          };

          setActivityItems((prevItems) =>
            [newActivityItem, ...prevItems]
              .sort((a, b) => {
                const idA = a.type === 'ui_diff' ? a.image2_id : a.image_id;
                const idB = b.type === 'ui_diff' ? b.image2_id : b.image_id;
                const timeA = new Date(
                  idA!.split('-diff')[0].split('-change-')[0],
                ).getTime();
                const timeB = new Date(
                  idB!.split('-diff')[0].split('-change-')[0],
                ).getTime();
                return timeB - timeA;
              })
              .slice(0, 100)
          );
          logToUI(
            '[processUIDiffRequest] ✅ UI Diff analysis successful for:',
            newDiffId,
          );
          setBaselineFrameForDiff(frame2);
        } else {
          logError(
            '[processUIDiffRequest] Backend error for UI Diff:',
            result.error || 'Unknown error',
            result.details || '',
          );
        }
      } catch (err) {
        logError('[processUIDiffRequest] Network error during UI Diff:', err);
      }
      setActiveAnalysesCount((prev) => Math.max(0, prev - 1));
      setDiffAnalysisInProgress(false);
    },
    [
      diffAnalysisInProgress, // Internal state
      logToUI,                // Prop
      logError,               // Prop
      setActivityItems,       // Prop setter
      setActiveAnalysesCount, // Prop setter
      activeAnalysesCount,    // Prop value (for status string)
      setMainStatus,          // Prop setter
      setBaselineFrameForDiff,// Internal setter
      // No need for diffAnalysisInProgress in deps for setDiffAnalysisInProgress(true/false)
    ],
  );

  useEffect(() => {
    // This is the main dispatcher effect
    if (activeAnalysesCount >= MAX_PARALLEL_ANALYSES) {
      return; // Max capacity, wait for an analysis to complete
    }

    // Scenario 1: No baseline, buffer has frames -> Process oldest for initial dump
    if (
      !baselineFrameForDiff && !initialDumpInProgress && frameBuffer.length >= 1
    ) {
      const frameToDump = frameBuffer[0];
      logToUI(
        '[Dispatcher] Picking oldest frame for Initial Raw Content Dump:',
        frameToDump.id,
      );
      setFrameBuffer((prevBuffer) => prevBuffer.slice(1)); // Consume the frame
      processInitialFrameDump(frameToDump);
      return; // Return early as an action was taken
    }

    // Scenario 2: Baseline exists, no frame pending for diff, buffer has frames -> Set next frame as pending
    if (
      baselineFrameForDiff && !pendingFrameForDiff && frameBuffer.length >= 1
    ) {
      const nextFrame = frameBuffer[0];
      if (baselineFrameForDiff.id !== nextFrame.id) { // Ensure it's not the same frame
        logToUI(
          '[Dispatcher] Setting pending frame for diff:',
          nextFrame.id,
          'against baseline:',
          baselineFrameForDiff.id,
        );
        setPendingFrameForDiff(nextFrame);
        setFrameBuffer((prevBuffer) => prevBuffer.slice(1)); // Consume the frame
      } else if (frameBuffer.length === 1 && baselineFrameForDiff.id === nextFrame.id) {
        // This case means the buffer only contains the baseline frame itself.
        // It's not an error, just waiting for new, different frames.
        logToUI(
          '[Dispatcher] Buffer only contains baseline frame. Waiting for new frames.',
        );
      }
      return; // Return early, either set pending or logged waiting
    }

    // Scenario 3: Baseline and pending frame exist, diff not in progress -> Process diff
    if (
      baselineFrameForDiff && pendingFrameForDiff && !diffAnalysisInProgress
    ) {
      logToUI(
        '[Dispatcher] Processing UI Diff. Baseline:',
        baselineFrameForDiff.id,
        'Pending:',
        pendingFrameForDiff.id,
      );
      const frame1 = baselineFrameForDiff;
      const frame2 = pendingFrameForDiff;
      setPendingFrameForDiff(null); // Clear pending frame
      processUIDiffRequest(frame1, frame2);
      // No return here, let subsequent logic run if any (though not in this structure)
    }
  }, [
    frameBuffer,
    activeAnalysesCount,
    baselineFrameForDiff,
    pendingFrameForDiff,
    initialDumpInProgress,
    diffAnalysisInProgress,
    processInitialFrameDump,
    processUIDiffRequest,
    logToUI,
    setFrameBuffer,
    // setBaselineFrameForDiff is implicitly handled by processInitialFrameDump/processUIDiffRequest
    setPendingFrameForDiff,
    MAX_PARALLEL_ANALYSES,
  ]);
} 