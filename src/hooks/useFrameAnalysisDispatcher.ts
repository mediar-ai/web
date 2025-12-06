import { useCallback, useEffect, useState } from 'react';
import type { BufferedFrame, ActivityItem, UIDiffAnalysis, RunningAnalysis } from '../types';

interface UseFrameAnalysisDispatcherProps {
  frameBuffer: BufferedFrame[];
  setFrameBuffer: React.Dispatch<React.SetStateAction<BufferedFrame[]>>;
  setActivityItems: React.Dispatch<React.SetStateAction<ActivityItem[]>>;
  setRunningAnalyses: React.Dispatch<React.SetStateAction<RunningAnalysis[]>>;
  setCompletedAnalyses: React.Dispatch<React.SetStateAction<RunningAnalysis[]>>;
  activeAnalysesCount: number;
  setActiveAnalysesCount: (count: number | ((prev: number) => number)) => void;
  logToUI: (...args: unknown[]) => void;
  logError: (...args: unknown[]) => void;
  setMainStatus: (status: string) => void;
  MAX_PARALLEL_ANALYSES: number;
  userId: string | null;
  sessionId: string;
}

export const useFrameAnalysisDispatcher = ({
  frameBuffer,
  setFrameBuffer,
  setActivityItems,
  setRunningAnalyses,
  setCompletedAnalyses,
  activeAnalysesCount,
  setActiveAnalysesCount,
  logToUI,
  logError,
  setMainStatus,
  MAX_PARALLEL_ANALYSES,
  userId,
  sessionId,
}: UseFrameAnalysisDispatcherProps): void => {
  const [baselineFrameForDiff, setBaselineFrameForDiff] = useState<BufferedFrame | null>(null);
  const [pendingFrameForDiff, setPendingFrameForDiff] = useState<BufferedFrame | null>(null);
  const [initialDumpInProgress, setInitialDumpInProgress] = useState<boolean>(false);
  const [diffAnalysisInProgress, setDiffAnalysisInProgress] = useState<boolean>(false);

  const processInitialFrameDump = useCallback(
    async (frameToDump: BufferedFrame) => {
      if (initialDumpInProgress) return;
      setInitialDumpInProgress(true);
      setActiveAnalysesCount((prev) => prev + 1);

      const analysisId = `dump-${frameToDump.id}`;
      const analysisPayload = {
        image: `data:image/jpeg;base64,${frameToDump.base64Data}`,
        timestamp: new Date(frameToDump.timestamp).toISOString(),
        prompt:
          'List in maximum detail all visible text and UI elements from the screenshot. Describe layout and objects.',
        analysisType: 'initial_frame_dump',
      };
      const newRunningAnalysis: RunningAnalysis = { 
        id: analysisId, 
        type: 'Initial Frame Dump', 
        startTime: Date.now(),
        model: 'gemini-2.5-flash', // 🔥 Updated to stable Vertex AI model name
        status: 'running',
        payloadType: 'image',
        payloadSize: analysisPayload.image.length,
        sequenceId: frameToDump.sequenceId,
      };
      setRunningAnalyses(prev => [...prev, newRunningAnalysis]);
      
      setMainStatus(`Analyzing Initial Frame (${activeAnalysesCount + 1})...`);
      logToUI(
        '[processInitialFrameDump] 🖼️ Starting raw content dump for initial frame:',
        frameToDump.id,
      );
      try {
        const response = await fetch('/api/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(analysisPayload),
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let rawContent = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          rawContent += decoder.decode(value, { stream: true });
        }
        
        // The stream is complete, now process the final text
        logToUI(
          `[processInitialFrameDump] ✅ Stream finished. Total content length: ${rawContent.length}`,
        );

        const newActivityItem: ActivityItem = {
          type: 'initial_dump',
          id: frameToDump.id,
          timestamp: new Date(frameToDump.timestamp).toISOString(),
          raw_content: rawContent,
          image_id: frameToDump.id,
          sequenceId: frameToDump.sequenceId,
          user_id: userId || undefined,
          session_id: sessionId || undefined,
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
        const completed: RunningAnalysis = { ...newRunningAnalysis, status: 'completed', endTime: Date.now() };
        setCompletedAnalyses(prev => [completed, ...prev].slice(0, 100));
      } catch (err) {
        logError(
          '[processInitialFrameDump] Network error during initial dump:',
          err,
        );
        const failed: RunningAnalysis = { ...newRunningAnalysis, status: 'failed', endTime: Date.now() };
        setRunningAnalyses(prev => prev.map(a => a.id === analysisId ? failed : a));
        setCompletedAnalyses(prev => [failed, ...prev].slice(0, 100));
      } finally {
        setActiveAnalysesCount((prev) => Math.max(0, prev - 1));
        setRunningAnalyses(prev => prev.filter(a => a.id !== analysisId));
        setInitialDumpInProgress(false);
      }
    },
    [
      initialDumpInProgress,
      setActiveAnalysesCount,
      activeAnalysesCount,
      setMainStatus,
      logToUI,
      logError,
      setActivityItems,
      setBaselineFrameForDiff,
      setRunningAnalyses,
      setCompletedAnalyses,
      userId,
      sessionId,
    ],
  );

  const processUIDiffRequest = useCallback(
    async (frame1: BufferedFrame, frame2: BufferedFrame) => {
      if (diffAnalysisInProgress) return;
      setDiffAnalysisInProgress(true);
      setActiveAnalysesCount((prev) => prev + 1);

      const analysisId = `diff-${frame1.id}-to-${frame2.id}`;
      const analysisPayload = {
        image1_dataUrl: `data:image/jpeg;base64,${frame1.base64Data}`,
        image2_dataUrl: `data:image/jpeg;base64,${frame2.base64Data}`,
        analysisType: 'ui_diff',
        prompt: 'Perform UI difference analysis',
      };
      const newRunningAnalysis: RunningAnalysis = { 
        id: analysisId, 
        type: 'UI Difference Analysis', 
        startTime: Date.now(),
        model: 'gemini-2.5-flash', // 🔥 Updated to stable Vertex AI model name
        status: 'running',
        payloadType: 'image',
        payloadSize: analysisPayload.image1_dataUrl.length + analysisPayload.image2_dataUrl.length,
        sequenceId: frame2.sequenceId,
      };
      setRunningAnalyses(prev => [...prev, newRunningAnalysis]);
      
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
          body: JSON.stringify(analysisPayload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        
        if (result && result.analysis) {
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
            sequenceId: frame2.sequenceId,
            user_id: userId || undefined,
            session_id: sessionId || undefined,
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
          const completed: RunningAnalysis = { ...newRunningAnalysis, status: 'completed', endTime: Date.now() };
          setCompletedAnalyses(prev => [completed, ...prev].slice(0, 100));
        } else {
          logError(
            '[processUIDiffRequest] Backend error for UI Diff:',
            result.error || 'Unknown error',
            result.details || '',
          );
          const completed: RunningAnalysis = { ...newRunningAnalysis, status: 'completed', endTime: Date.now() };
          setCompletedAnalyses(prev => [completed, ...prev].slice(0, 100));
        }
      } catch (err) {
        logError('[processUIDiffRequest] Network error during UI Diff:', err);
        const failed: RunningAnalysis = { ...newRunningAnalysis, status: 'failed', endTime: Date.now() };
        setRunningAnalyses(prev => prev.map(a => a.id === analysisId ? failed : a));
        setCompletedAnalyses(prev => [failed, ...prev].slice(0, 100));
      } finally {
        setActiveAnalysesCount((prev) => Math.max(0, prev - 1));
        setRunningAnalyses(prev => prev.filter(a => a.id !== analysisId));
        setDiffAnalysisInProgress(false);
      }
    },
    [
      diffAnalysisInProgress,
      logToUI,
      logError,
      setActivityItems,
      setActiveAnalysesCount,
      activeAnalysesCount,
      setMainStatus,
      setBaselineFrameForDiff,
      setRunningAnalyses,
      setCompletedAnalyses,
      userId,
      sessionId,
    ],
  );

  useEffect(() => {
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
    setPendingFrameForDiff,
    MAX_PARALLEL_ANALYSES,
  ]);
};
