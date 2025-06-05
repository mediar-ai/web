'use client';

// import { Button } from '@/components/ui/button'; // Removing unused import
// import { Card } from '@/components/ui/card'; // Removing unused import
// import { Textarea } from '@/components/ui/textarea'; // This was already removed
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  BufferedFrame,
  Event,
  ParsedAnalysis,
  ActivityItem,
} from '../types';
import {
  loadWorkflowSteps,
  loadEvents,
  loadFrontendLogs,
  loadActivityItems,
  saveWorkflowSteps,
  saveEvents,
  saveFrontendLogs,
  saveActivityItems,
  clearPersistedData,
  getAllPersistedDataForExport,
  saveScreenshot // only saveScreenshot is directly called from page.tsx that uses canvas
} from '../lib/db';
import MemoizedScrollAreaContent from '../components/common/MemoizedScrollAreaContent'; // Import the new component
// import MemoizedDebugLogsScrollArea from '../components/common/MemoizedDebugLogsScrollArea'; // Removing unused import
import EventsTabContent from '../components/tabs/EventsTabContent'; // Import the new component
import ActivityTabContent from '../components/tabs/ActivityTabContent'; // Import the new component
import SettingsTabContent from '../components/tabs/SettingsTabContent'; // Import the new component
import DebugTabContent from '../components/tabs/DebugTabContent'; // Import the new component
import PageHeaderControls from '../components/capture/PageHeaderControls'; // Import the new component
import VideoPreviewArea from '../components/capture/VideoPreviewArea'; // Import the new component
import ErrorNotification from '../components/capture/ErrorNotification'; // Import the new component
import ExportStatusDialog from '../components/capture/ExportStatusDialog'; // Import the new component
import { useAutoDetection } from '../hooks/useAutoDetection';
import { useFrameAnalysisDispatcher } from '../hooks/useFrameAnalysisDispatcher';

// Initialize Supabase client (outside component for module-level scope)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase: SupabaseClient | null = null;
if (supabaseUrl && supabaseAnonKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('[Supabase] Client initialized successfully.');
  } catch (e) {
    console.error('[Supabase] Error initializing client:', e);
  }
} else {
  console.warn(
    '[Supabase] URL or Anon Key is missing in environment variables. Supabase client not initialized.',
  );
}

export default function Home() {
  // Model configurations
  const EVENTS_MODEL_NAME = 'gemini-2.5-pro-preview-05-06';
  const MAX_PARALLEL_ANALYSES = 5;

  // Auto-detection configuration is now managed by useAutoDetection hook
  // const [autoDetectionEnabled, setAutoDetectionEnabled] = useState<boolean>(
  //   true,
  // );
  // const [monitoringFrequency, setMonitoringFrequency] = useState<number>(200); // ms
  // const [changeThreshold, setChangeThreshold] = useState<number>(1.0); // percentage
  // const [stabilityDelay, setStabilityDelay] = useState<number>(500); // ms
  const [screenshotQuality, setScreenshotQuality] = useState<number>(0.6);
  const [maxScreenshots, setMaxScreenshots] = useState<number>(50);
  // const [pixelDifferenceThreshold, setPixelDifferenceThreshold] = useState<
  //   number
  // >(20); // NEW: Threshold for pixel comparison (0-255)

  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null); 
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); 
  const monitoringCanvasRef = useRef<HTMLCanvasElement>(null); 
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState<boolean>(false);
  const [isCapturingForBuffer, setIsCapturingForBuffer] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<
    Array<{
      id: string;
      analysis: string;
      parsed: ParsedAnalysis | null;
      timestamp: string;
    }>
  >([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [frameBuffer, setFrameBuffer] = useState<BufferedFrame[]>([]);
  const [activeAnalysesCount, setActiveAnalysesCount] = useState<number>(0);
  // MOVED TO useFrameAnalysisDispatcher: const [baselineFrameForDiff, setBaselineFrameForDiff] = useState<BufferedFrame | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>(
    `You are an expert business workflow assistant that analyzes screen data to identify business processes. Provide your analysis in the following structured format:

workflow_name_best_guess_latest: [Best guess of the overall workflow/process name based on what you see]
step_name: [Concise name for this specific step, 3-5 words max]
step_description: [What is happening in 10 or less words. Focus on fresh and unique information compared to previous logs, what has changed]
step_facts: [Key observable facts from the screen - buttons, text, UI elements, data visible]
step_logic: [Business rules or logic you can infer from this step]
step_metadata: [Technical details like application, browser, file types, etc.]
Opened_apps: [List of applications, windows, or programs visible on screen]
Tab_name_Url_filename_chatname_etc: [Specific context like browser tab titles, URLs, file names, chat names, document titles, etc. if available]

Context: You have access to previous analysis results for reference. Focus on identifying the progression of the workflow and any changes from previous steps.`,
  );
  const [eventsPrompt] = useState<string>(
    `Analyze the sequence of activities to determine the user's current workflow action. Focus on what the user is actively doing across these UI changes and interactions. Consider mouse movements, typing, clicks, new windows, and content changes to understand the overall workflow action.`,
  );
  const [mainStatus, setMainStatus] = useState<string>('Idle');
  const [frontendLogs, setFrontendLogs] = useState<string[]>([]);
  // MOVED TO useFrameAnalysisDispatcher: const [initialDumpInProgress, setInitialDumpInProgress] = useState<boolean>(false); 
  // MOVED TO useFrameAnalysisDispatcher: const [pendingFrameForDiff, setPendingFrameForDiff] = useState<BufferedFrame | null>(null); 
  // MOVED TO useFrameAnalysisDispatcher: const [diffAnalysisInProgress, setDiffAnalysisInProgress] = useState<boolean>(false); 
  const [exportInProgress, setExportInProgress] = useState<boolean>(false); 

  const initialFrameCapturedRef = useRef(false); // MOVED EARLIER

  // Auto-detection state & refs for stable callbacks are now managed by useAutoDetection hook
  // const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  // const [lastFrameData, setLastFrameData] = useState<Uint8ClampedArray | null>(
  //   null,
  // );
  // const [activityDetected, setActivityDetected] = useState<boolean>(false);
  // const [lastActivityTime, setLastActivityTime] = useState<number>(0);
  // const monitoringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // const currentChangePercentRef = useRef<number>(0);
  // const [displayChangePercent, setDisplayChangePercent] = useState<number>(0);
  // const lastDisplayChangeRef = useRef<number>(0);

  // const activityDetectedRef = useRef(activityDetected);
  // useEffect(() => {
  //   activityDetectedRef.current = activityDetected;
  // }, [activityDetected]);
  // const lastActivityTimeRef = useRef(lastActivityTime);
  // useEffect(() => {
  //   lastActivityTimeRef.current = lastActivityTime;
  // }, [lastActivityTime]);
  // const stabilityDelayRef = useRef(stabilityDelay);
  // useEffect(() => {
  //   stabilityDelayRef.current = stabilityDelay;
  // }, [stabilityDelay]);
  // const autoDetectionEnabledRef = useRef(autoDetectionEnabled);
  // useEffect(() => {
  //   autoDetectionEnabledRef.current = autoDetectionEnabled;
  // }, [autoDetectionEnabled]);
  // const changeThresholdRef = useRef(changeThreshold);
  // useEffect(() => {
  //   changeThresholdRef.current = changeThreshold;
  // }, [changeThreshold]);
  // const monitoringFrequencyRef = useRef(monitoringFrequency);
  // useEffect(() => {
  //   monitoringFrequencyRef.current = monitoringFrequency;
  // }, [monitoringFrequency]);
  // const isMonitoringRef = useRef<boolean>(isMonitoring);
  // useEffect(() => {
  //   isMonitoringRef.current = isMonitoring;
  // }, [isMonitoring]);
  // const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  // useEffect(() => {
  //   lastFrameDataRef.current = lastFrameData;
  // }, [lastFrameData]);

  // Prompt autosave animation
  const [promptSaveStatus, setPromptSaveStatus] = useState<
    'idle' | 'saving' | 'saved'
  >('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  // 1. Logging utilities
  const logToUI = useCallback((...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args.map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    const logEntry = `${timestamp} ${message}`;
    setFrontendLogs((prevLogs) => [logEntry, ...prevLogs].slice(0, 100));
    console.log(...args);
  }, []);

  const logError = useCallback((...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args.map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    const logEntry = `${timestamp} [ERROR] ${message}`;
    setFrontendLogs((prevLogs) => [logEntry, ...prevLogs].slice(0, 100));
    console.error(...args);
  }, []);

  // 3. Core capture and analysis function
  const captureFrameToBuffer = useCallback(async (changePercent: number) => {
    if (!streamRef.current) { 
      logError('[captureFrameToBuffer] Stream not active.'); 
      return;
    }
    if (isCapturingForBuffer) return; 

    if (
      videoRef.current && canvasRef.current &&
      videoRef.current.readyState >= videoRef.current.HAVE_METADATA &&
      videoRef.current.videoWidth > 0
    ) {
      setIsCapturingForBuffer(true);
      logToUI(
        '[captureFrameToBuffer] 🎞️ Capturing frame for buffer - Change:',
        changePercent.toFixed(2) + '%',
      );

      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (
        canvas.width !== video.videoWidth || canvas.height !== video.videoHeight
      ) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataUrl = canvas.toDataURL('image/png', screenshotQuality);
        const timestamp = Date.now();
        const newFrame: BufferedFrame = {
          id: new Date(timestamp).toISOString() +
            `-change-${changePercent.toFixed(2)}`,
          imageDataUrl,
          timestamp,
          percentChange: changePercent,
        };

        setFrameBuffer((prevBuffer: BufferedFrame[]) => {
          const newBufferFull = [...prevBuffer, newFrame]; 
          let newBufferTrimmed = newBufferFull;
          if (newBufferFull.length > 10) { // MAX_BUFFER_SIZE = 10
            const sortedForEviction = [...newBufferFull].sort((a, b) => {
              if (a.percentChange !== b.percentChange) {
                return a.percentChange - b.percentChange;
              }
              return a.timestamp - b.timestamp;
            });
            sortedForEviction.shift(); 
            newBufferTrimmed = sortedForEviction;
            logToUI(
              '[captureFrameToBuffer] Buffer full. Evicted frame with least change.',
            );
          }
          return newBufferTrimmed.sort((a, b) => a.timestamp - b.timestamp);
        });
        logToUI(
          '[captureFrameToBuffer] Frame added to buffer. Current buffer size will be reflected in next render cycle.',
        );

        try {
          const tempCanvasForSave = document.createElement('canvas');
          const tempCtx = tempCanvasForSave.getContext('2d');
          const img = new Image();
          img.onload = async () => {
            tempCanvasForSave.width = img.width;
            tempCanvasForSave.height = img.height;
            tempCtx?.drawImage(img, 0, 0);
            await saveScreenshot(newFrame.id, tempCanvasForSave); // Uses imported saveScreenshot
            logToUI(
              '[captureFrameToBuffer] Screenshot for buffered frame saved:',
              newFrame.id,
            );
          };
          img.onerror = () => {
            logError(
              '[captureFrameToBuffer] Failed to load image from data URL for saving screenshot.',
            );
          };
          img.src = imageDataUrl;
        } catch (screenshotErr) {
          logError(
            '[captureFrameToBuffer] Screenshot save for buffered frame failed:',
            screenshotErr,
          );
        }
      } else {
        logError(
          '[captureFrameToBuffer] Error: Could not get 2D context for buffer capture.',
        );
      }
      setIsCapturingForBuffer(false);
    } else {
      if (streamRef.current && videoRef.current) {
        logToUI(
          '[captureFrameToBuffer] Video not ready for capture to buffer. State:',
          {
            readyState: videoRef.current.readyState,
            videoWidth: videoRef.current.videoWidth,
          },
        );
      }
    }
  }, [
    isCapturingForBuffer,
    screenshotQuality,
    logToUI,
    logError,
    setFrameBuffer,
    setIsCapturingForBuffer,
    streamRef,
  ]);

  // Place useAutoDetection hook call here, after its dependencies are defined
  const {
    autoDetectionEnabled,
    setAutoDetectionEnabled,
    monitoringFrequency,
    setMonitoringFrequency,
    changeThreshold,
    setChangeThreshold,
    stabilityDelay,
    setStabilityDelay,
    pixelDifferenceThreshold,
    setPixelDifferenceThreshold,
    isMonitoring,
    displayChangePercent,
  } = useAutoDetection({
    stream,
    streamRef,
    videoRef,
    monitoringCanvasRef,
    logToUI,
    captureFrameToBuffer,
  });

  // MOVED TO useFrameAnalysisDispatcher: processUIDiffRequest
  // MOVED TO useFrameAnalysisDispatcher: processInitialFrameDump

  const activeAnalysesCountRef = useRef(activeAnalysesCount);
  useEffect(() => {
    activeAnalysesCountRef.current = activeAnalysesCount;
  }, [activeAnalysesCount]);

  // MOVED TO useFrameAnalysisDispatcher: The main dispatcher useEffect for frame analysis
  // useEffect(() => {
  //   if (activeAnalysesCountRef.current >= MAX_PARALLEL_ANALYSES) {
  //     return;
  //   }
  //   if (
  //     !baselineFrameForDiff && !initialDumpInProgress && frameBuffer.length >= 1
  //   ) {
  //     const frameToDump = frameBuffer[0];
  //     logToUI(
  //       '[Dispatcher] Picking oldest frame for Initial Raw Content Dump:',
  //       frameToDump.id,
  //     );
  //     setFrameBuffer((prevBuffer) => prevBuffer.slice(1));
  //     processInitialFrameDump(frameToDump);
  //     return; 
  //   }
  //   if (
  //     baselineFrameForDiff && !pendingFrameForDiff && frameBuffer.length >= 1
  //   ) {
  //     const nextFrame = frameBuffer[0];
  //     if (baselineFrameForDiff.id !== nextFrame.id) {
  //       logToUI(
  //         '[Dispatcher] Setting pending frame for diff:',
  //         nextFrame.id,
  //         'against baseline:',
  //         baselineFrameForDiff.id,
  //       );
  //       setPendingFrameForDiff(nextFrame);
  //       setFrameBuffer((prevBuffer) => prevBuffer.slice(1));
  //     } else if (
  //       frameBuffer.length === 1 && baselineFrameForDiff.id === nextFrame.id
  //     ) {
  //       logToUI(
  //         '[Dispatcher] Buffer only contains baseline frame. Waiting for new frames.',
  //       );
  //     }
  //     return; 
  //   }
  //   if (
  //     baselineFrameForDiff && pendingFrameForDiff && !diffAnalysisInProgress
  //   ) {
  //     logToUI(
  //       '[Dispatcher] Processing UI Diff. Baseline:',
  //       baselineFrameForDiff.id,
  //       'Pending:',
  //       pendingFrameForDiff.id,
  //     );
  //     const frame1 = baselineFrameForDiff;
  //     const frame2 = pendingFrameForDiff;
  //     setPendingFrameForDiff(null); 
  //     processUIDiffRequest(frame1, frame2);
  //   }
  // }, [
  //   frameBuffer,
  //   activeAnalysesCount,
  //   baselineFrameForDiff,
  //   pendingFrameForDiff,
  //   initialDumpInProgress,
  //   diffAnalysisInProgress,
  //   processInitialFrameDump,
  //   processUIDiffRequest,
  //   logToUI,
  //   setFrameBuffer,
  //   setBaselineFrameForDiff,
  //   setPendingFrameForDiff, 
  //   activityItems, 
  // ]);

  // Initialize the frame analysis dispatcher hook
  useFrameAnalysisDispatcher({
    frameBuffer,
    setFrameBuffer,
    setActivityItems,
    activeAnalysesCount,
    setActiveAnalysesCount,
    logToUI,
    logError,
    setMainStatus,
    MAX_PARALLEL_ANALYSES,
  });

  const memoizedEventsContent = useMemo(() => {
    return events.length > 0
      ? (
        <div className='relative'>
          <div className='absolute left-2 top-0 bottom-0 w-0.5 bg-border'></div>
          {events.map((event) => (
            <div
              key={event.id}
              className='relative flex items-center gap-3 pb-3'
            >
              <div className='relative z-10 w-4 h-4 bg-primary rounded-full border-2 border-background flex-shrink-0'>
              </div>
              <div className='flex-1 min-w-0'>
                <div
                  className='flex items-center gap-2'
                  title={event.thoughts
                    ? `Thoughts: ${event.thoughts}`
                    : undefined}
                >
                  <span className='text-[10px] text-muted-foreground font-mono'>
                    {event.timestamp}
                  </span>
                  <span className='text-xs text-foreground truncate'>
                    {event.summary}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )
      : (
        <p className='text-muted-foreground italic p-8 text-center'>
          No events captured yet. Start recording to see workflow events.
        </p>
      );
  }, [events]);

  const memoizedActivityContent = useMemo(() => {
    return activityItems.length > 0
      ? (
        <ul className='space-y-3'>
          {activityItems.slice(0, 20).map((item) => {
            if (item.type === 'initial_dump') {
              return (
                <li
                  key={item.id}
                  className='p-3 border rounded-md bg-white text-xs text-black'
                >
                  <p className='font-medium text-[10px] mb-1.5'>
                    {item.timestamp}
                    <span className='ml-2 text-black font-semibold'>
                      Initial Frame Content
                    </span>{' '}
                    <span className='ml-2 text-black text-[9px] dwindling_opacity'>
                      (Frame:{' '}
                      {item.image_id?.split('-change-')[0].substring(11, 19)})
                    </span>{' '}
                  </p>
                  <MemoizedScrollAreaContent 
                    className='whitespace-pre-wrap p-2 bg-gray-100 rounded text-black max-h-40'
                    content={<div className="text-black">{item.raw_content}</div>} 
                  />
                </li>
              );
            } else if (item.type === 'ui_diff') {
              return (
                <li
                  key={item.id}
                  className='p-3 border rounded-md bg-white text-xs text-black'
                >
                  <p className='font-medium text-[10px] mb-1.5'>
                    {item.timestamp}
                    <span className='ml-2 text-black text-[9px] dwindling_opacity'>
                      (Diff:{' '}
                      {item.image1_id?.split('-change-')[0].substring(11, 19)}
                      {' '}
                      vs{' '}
                      {item.image2_id?.split('-change-')[0].substring(11, 19)})
                    </span>
                  </p>
                  <div className='space-y-1'>
                    <div>
                      <strong className='text-black'>Change Detected:</strong>
                      {' '}
                      <span
                        className={item.change_detected === 'yes'
                          ? 'text-black font-semibold'
                          : 'text-black'}
                      >
                        {item.change_detected}
                      </span>
                    </div>{' '}
                    {item.change_detected === 'yes' && (
                      <>
                        {item.change_description && (
                          <div>
                            <strong className='text-black'>Description:</strong>
                            {' '}
                            {item.change_description}
                          </div>
                        )} 
                        {item.identified_change_types &&
                          item.identified_change_types.length > 0 && (
                            <div className='mt-1'>
                              <strong className='text-black'>Types:</strong>
                              {' '}
                              {item.identified_change_types.join(', ')}
                            </div> 
                          )}
                        <div className='mt-1.5 space-y-0.5 pl-2 border-l-2 border-slate-700'>
                          {item.mouse_movement_details && (
                            <div>
                              <strong className='text-black'>Mouse:</strong>
                              {' '}
                              From:{' '}
                              <span className='text-black'>
                                {item.mouse_movement_details.from_object ||
                                  'N/A'}{' '}
                                ({item.mouse_movement_details.from_coordinate ||
                                  'N/A'})
                              </span>{' '}
                              {' -> '}To:{' '}
                              <span className='text-black'>
                                {item.mouse_movement_details.to_object || 'N/A'}
                                {' '}
                                ({item.mouse_movement_details.to_coordinate ||
                                  'N/A'})
                              </span>{' '}
                            </div>
                          )}
                          {item.typing_details && (
                            <div>
                              <strong className='text-black'>Typed:</strong>
                              {' '}
                              <span className='text-black'>
                                {item.typing_details}
                              </span>
                            </div>
                          )}{' '}
                          {item.click_details && (
                            <div>
                              <strong className='text-black'>Clicked:</strong>
                              {' '}
                              <span className='text-black'>
                                {item.click_details}
                              </span>
                            </div>
                          )}{' '}
                          {item.new_window_details && (
                            <div>
                              <strong className='text-black'>
                                Window Change:
                              </strong>{' '}
                              Old:{' '}
                              <span className='text-black'>
                                {item.new_window_details.old_window_name ||
                                  'N/A'}
                              </span>, {' '}
                              New:{' '}
                              <span className='text-black'>
                                {item.new_window_details.new_window_name ||
                                  'N/A'}
                              </span>{' '}
                            </div>
                          )}
                          {item.new_app_details && (
                            <div>
                              <strong className='text-black'>New App:</strong>
                              {' '}
                              <span className='text-black'>
                                {item.new_app_details}
                              </span>
                            </div>
                          )}{' '}
                          {item.scroll_details && (
                            <div>
                              <strong className='text-black'>
                                Scrolled - New Content:
                              </strong>{' '}
                              <span className='text-black'>
                                {item.scroll_details.new_content_summary}
                              </span>
                            </div>
                          )}{' '}
                          {item.other_change_details &&
                            item.other_change_details.map((other, idx) => (
                              <div key={idx}>
                                <strong className='text-black'>
                                  Other ({other.type_description || 'N/A'}):
                                </strong>{' '}
                                <span className='text-black'>
                                  {other.details}
                                </span>{' '}
                              </div>
                            ))}
                        </div>
                        {item.new_content_detected && (
                          <div className='mt-1.5 pt-1 border-t border-slate-700'>
                            <strong className='text-black'>
                              Newly Detected Content:
                            </strong>
                            <MemoizedScrollAreaContent 
                              className='whitespace-pre-wrap p-2 mt-1 bg-gray-100 rounded text-black max-h-40'
                              content={<div className="text-black">{item.new_content_detected}</div>}
                            />
                          </div>
                        )}
                        {item.unidentified_changes_explanation && (
                          <div className='mt-1.5 pt-1 border-t border-slate-700'>
                            <strong className='text-black'>
                              Model Explanation:
                            </strong>{' '}
                            {item.unidentified_changes_explanation}
                          </div>
                        )} 
                      </>
                    )}
                  </div>
                </li>
              );
            }
            return null;
          })}
        </ul>
      )
      : (
        <p className='text-muted-foreground italic p-8 text-center'>
          No activity captured yet. Start recording.
        </p>
      );
  }, [activityItems, MemoizedScrollAreaContent]); // Added MemoizedScrollAreaContent to dependency array

  const handlePromptChange = useCallback((newPrompt: string) => {
    setCustomPrompt(newPrompt);
    setPromptSaveStatus('saving');
    setTimeout(() => {
      setPromptSaveStatus('saved');
      setTimeout(() => setPromptSaveStatus('idle'), 1500);
    }, 500);
  }, []);

  const copyLogsToClipboard = useCallback(async () => {
    try {
      const logsText = frontendLogs.join('\n');
      await navigator.clipboard.writeText(logsText);
      logToUI('[copyLogsToClipboard] Logs copied to clipboard');
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      logError('[copyLogsToClipboard] Failed to copy logs:', err);
    }
  }, [frontendLogs, logToUI, logError]);

  const clearAllData = useCallback(async () => {
    try {
      await clearPersistedData(); // Uses imported function
      setWorkflowSteps([]);
      setEvents([]);
      setFrontendLogs([]);
      setActivityItems([]); 
      logToUI('[clearAllData] All persisted data cleared');
    } catch (err) {
      logError('[clearAllData] Failed to clear data:', err);
    }
  }, [logToUI, logError, setActivityItems]);

  const handleExportAllData = useCallback(async () => {
    logToUI('[handleExportAllData] Starting data export via Supabase...');
    setExportInProgress(true);

    if (!supabase) {
      logError(
        '[handleExportAllData] Supabase client is not initialized. Cannot send data. Check console for errors during initialization.',
      );
      setError(
        'Supabase client not available. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.',
      );
      setExportInProgress(false);
      return;
    }

    try {
      const allLocalData = await getAllPersistedDataForExport(); // Uses imported function
      logToUI(
        '[handleExportAllData] Successfully retrieved all local data for sending. Size (approx characters):',
        JSON.stringify(allLocalData).length,
      );

      let sessionId = localStorage.getItem('app_session_id');
      if (!sessionId) {
        sessionId = crypto.randomUUID(); 
        localStorage.setItem('app_session_id', sessionId);
        logToUI(
          '[handleExportAllData] Generated new session ID for export:',
          sessionId,
        );
      } else {
        logToUI(
          '[handleExportAllData] Using existing session ID for export:',
          sessionId,
        );
      }

      const payload = {
        sessionId: sessionId,
        exportedData: allLocalData,
      };

      logToUI(
        "[handleExportAllData] Attempting to invoke Supabase Edge Function 'ingest-data' with session ID...",
      );

      const { data: functionInvokeData, error: functionError } = await supabase
        .functions.invoke('ingest-data', {
          body: payload, 
        });

      if (functionError) {
        logError(
          "[handleExportAllData] Error invoking Supabase Edge Function 'ingest-data':",
          functionError.message,
          functionError,
        );
        setError(
          `Failed to send data via Edge Function: ${functionError.message}. Check logs.`,
        );
      } else {
        logToUI(
          "[handleExportAllData] Supabase Edge Function 'ingest-data' invoked successfully. Response:",
          functionInvokeData,
        );
      }
    } catch (err) {
      let errorMessage = 'Unknown error during export process';
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      logError('[handleExportAllData] Error during data export process:', err);
      setError(`Error during export: ${errorMessage}. Check console.`);
    } finally {
      setExportInProgress(false);
    }
  }, [logToUI, logError, setError]); 

  const dismissError = useCallback(() => {
    setShowError(false);
    setTimeout(() => setError(null), 300);
  }, []);

  const handleStopScreenShare = useCallback(() => {
    logToUI('[handleStopScreenShare] Stopping screen share.');
    const currentStream = streamRef.current || stream;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => {
        logToUI(
          '[handleStopScreenShare] Stopping track:',
          track.kind,
          track.readyState,
        );
        track.stop();
      });
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.load();
    }
    setStream(null);
    streamRef.current = null;
    setIsCapturingForBuffer(false);
    setMainStatus('Idle');
    setFrameBuffer([]);
    if (initialFrameCapturedRef) {
        initialFrameCapturedRef.current = false;
    }
    logToUI(
      '[handleStopScreenShare] Buffer and baselines cleared for fresh start.',
    );
  }, [
    stream,
    logToUI,
    setFrameBuffer,
    initialFrameCapturedRef,
  ]); 

  const handleStartScreenShare = useCallback(async () => {
    logToUI('[handleStartScreenShare] Attempting start...');
    setError(null);

    if (streamRef.current || stream) {
      const currentStream = streamRef.current || stream;
      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }
    }
    setStream(null);
    streamRef.current = null;
    setIsCapturingForBuffer(false);
    setFrameBuffer([]); 
    if (initialFrameCapturedRef) {
        initialFrameCapturedRef.current = false;
    }
    logToUI(
      '[handleStartScreenShare] Cleared buffers and baselines for new session.',
    );

    setMainStatus('Initializing...');
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 5 },
          displaySurface: 'monitor',
        },
        audio: false,
      });
      logToUI('[handleStartScreenShare] Media stream obtained.');
      setStream(mediaStream);
      streamRef.current = mediaStream;
    } catch (err: unknown) {
      let message = 'Unknown start error.';
      if (err instanceof Error) {
        message = err.name === 'NotAllowedError'
          ? 'Permission denied by user.'
          : `Start error: ${err.message}`;
      }
      logError('[handleStartScreenShare] Error:', message, err);
      setError(message);
      setStream(null);
      streamRef.current = null;
      setMainStatus('Error starting share');
    }
  }, [stream, logToUI, logError]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [savedSteps, savedEvents, savedLogs, savedActivityItemsFromDB] =
          await Promise.all([
            loadWorkflowSteps(),
            loadEvents(),
            loadFrontendLogs(),
            loadActivityItems(), 
          ]);
        if (savedSteps.length > 0) {
          setWorkflowSteps(savedSteps);
          console.log(
            `[loadPersistedData] Loaded ${savedSteps.length} workflow steps`,
          );
        }
        if (savedEvents.length > 0) {
          setEvents(savedEvents);
          console.log(
            `[loadPersistedData] Loaded ${savedEvents.length} events`,
          );
        }
        if (savedLogs.length > 0) {
          setFrontendLogs(savedLogs);
          console.log(
            `[loadPersistedData] Loaded ${savedLogs.length} frontend logs`,
          );
        }
        if (savedActivityItemsFromDB.length > 0) {
          setActivityItems(savedActivityItemsFromDB);
          console.log(
            `[loadPersistedData] Loaded ${savedActivityItemsFromDB.length} activity items`,
          );
        }
      } catch (err) {
        logError('[loadPersistedData] Failed to load persisted data:', err);
      }
    };
    loadData();
  }, [logError]); 

  useEffect(() => {
    if (workflowSteps.length > 0) saveWorkflowSteps(workflowSteps);
  }, [workflowSteps]);
  useEffect(() => {
    if (events.length > 0) saveEvents(events);
  }, [events]);
  useEffect(() => {
    if (frontendLogs.length > 0) saveFrontendLogs(frontendLogs);
  }, [frontendLogs]);
  useEffect(() => {
    if (activityItems.length > 0) saveActivityItems(activityItems);
  }, [activityItems]);

  useEffect(() => {
    if (error) {
      setShowError(true);
      const timer = setTimeout(() => {
        setShowError(false);
        setTimeout(() => setError(null), 300); 
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const updateMainStatus = useCallback(() => {
    if (activeAnalysesCount > 0) {
      setMainStatus(`Analyzing (${activeAnalysesCount})...`);
    } else if (streamRef.current) {
      setMainStatus(
        videoRef.current && videoRef.current.videoWidth > 0
          ? 'Recording (Preview Active)'
          : 'Recording (Video Not Ready)',
      );
    } else {
      setMainStatus('Idle');
    }
  }, [stream, error, activeAnalysesCount, setMainStatus, videoRef, streamRef]); 

  useEffect(() => {
    updateMainStatus();
  }, [stream, error, activeAnalysesCount, setMainStatus]);

  useEffect(() => {
    logToUI('[useEffect stream] Main effect RUNNING. Stream active:', !!stream);
    const currentVideoElement = videoRef.current;
    const onMetadataLoadedHandler = () => {
      if (!currentVideoElement) return;
      logToUI("[useEffect stream] 'loadedmetadata' - Dimensions:", {
        w: currentVideoElement.videoWidth,
        h: currentVideoElement.videoHeight,
      });
      if (currentVideoElement.videoWidth > 0) {
        setMainStatus('Recording (Preview Active)');
      } else {
        setError('Video has no width after metadata loaded.');
        setMainStatus('Error: Video dimensions');
      }
    };
    const onVideoErrorHandler = (event: globalThis.Event) => {
      if (!currentVideoElement || !stream) return;
      logError(
        "[useEffect stream] 'error' event:",
        event,
        currentVideoElement.error,
      );
      setError(
        `Video error: ${currentVideoElement.error?.message || 'Unknown'}`,
      );
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      setMainStatus('Error: Video stream');
    };
    const onPlayingHandler = () => {
      logToUI("[useEffect stream] 'playing' event.");
      setMainStatus('Recording (Preview Active)');
    };
    const onStalledHandler = () => {
      logToUI("[useEffect stream] 'stalled' event.");
      setMainStatus('Video stalled');
    };
    const onTrackEndedHandler = () => {
      logToUI('[useEffect stream] Track ended.');
      setError('Sharing stopped via browser UI.');
      handleStopScreenShare();
    };

    if (stream && currentVideoElement) {
      streamRef.current = stream;
      currentVideoElement.srcObject = stream;
      currentVideoElement.muted = true;
      currentVideoElement.playsInline = true;
      currentVideoElement.play().catch((playErr) => {
        logToUI('[useEffect stream] video.play() failed:', playErr);
        let message = 'Video playback error.';
        if (playErr instanceof Error) {
          message = `Video playback error: ${playErr.message}`;
        }
        setError(message);
        setMainStatus('Error: Video playback');
      });
      currentVideoElement.addEventListener(
        'loadedmetadata',
        onMetadataLoadedHandler,
      );
      currentVideoElement.addEventListener('error', onVideoErrorHandler);
      currentVideoElement.addEventListener('playing', onPlayingHandler);
      currentVideoElement.addEventListener('stalled', onStalledHandler);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.addEventListener('ended', onTrackEndedHandler);
    } else if (!stream) {
      streamRef.current = null;
      setMainStatus('Idle');
    }

    return () => {
      logToUI('[useEffect stream] Cleanup. Stream active:', !!stream);
      if (currentVideoElement) {
        currentVideoElement.srcObject = null;
      }
    };
  }, [stream, handleStopScreenShare, logToUI, logError]);

  const handleManualInitialDump = useCallback(async () => {
    logToUI('[[VERIFY_CLICK]] Attempting manual initial dump...'); 

    if (
      !streamRef.current || !videoRef.current || !canvasRef.current ||
      videoRef.current.readyState < videoRef.current.HAVE_METADATA ||
      videoRef.current.videoWidth <= 0
    ) {
      logError(
        '[Manual Initial Dump] Cannot capture, stream/video not ready or canvas not available.',
      );
      setError(
        'Cannot manually capture for initial dump: Preview not active or ready.',
      );
      return;
    }

    logToUI(
      '[Manual Initial Dump] 🚀 Triggered. Capturing current view, will be processed by dispatcher.',
    );

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (
      canvas.width !== video.videoWidth || canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL('image/png', screenshotQuality); 
      const timestamp = Date.now();
      const newFrameId = `manual-dump-${new Date(timestamp).toISOString()}`;
      const newFrame: BufferedFrame = {
        id: newFrameId,
        imageDataUrl,
        timestamp,
        percentChange: 100,
      };

      try {
        await saveScreenshot(newFrame.id, canvas); 
        logToUI(
          '[Manual Initial Dump] Screenshot for manual dump saved:',
          newFrame.id,
        );
      } catch (screenshotErr) {
        logError(
          '[Manual Initial Dump] Screenshot save failed:',
          screenshotErr,
        );
      }
      setFrameBuffer((prevBuffer) => [...prevBuffer, newFrame].sort((a,b) => a.timestamp - b.timestamp));
      logToUI('[Manual Initial Dump] Frame added to buffer for dispatcher processing.');

    } else {
      logError(
        '[Manual Initial Dump] Error: Could not get 2D context for capture.',
      );
      setError('Failed to get canvas context for manual capture.');
    }
  }, [
    screenshotQuality,
    logToUI,
    logError,
    setError,
    streamRef,
    videoRef,
    canvasRef,
    setFrameBuffer,
    saveScreenshot,
  ]); 

  const eventGenerationInProgressRef = useRef<boolean>(false);

  const processMultiActivityEvent = useCallback(async () => {
    if (
      eventGenerationInProgressRef.current ||
      activeAnalysesCount >= MAX_PARALLEL_ANALYSES
    ) {
      logToUI(
        '[processMultiActivityEvent] Already processing or max analyses running, skipping',
      );
      return;
    }

    eventGenerationInProgressRef.current = true;

    const activityItemsCopy = [...activityItems];

    const last10Activities = activityItemsCopy.slice(0, 10);

    const mostRecentInitialDump = activityItemsCopy.find((item) =>
      item.type === 'initial_dump'
    );

    const activitiesToAnalyze: ActivityItem[] = [...last10Activities];
    if (
      mostRecentInitialDump &&
      !last10Activities.some((item) => item.id === mostRecentInitialDump.id)
    ) {
      activitiesToAnalyze.push(mostRecentInitialDump);
    }

    if (activitiesToAnalyze.length === 0) {
      logToUI('[processMultiActivityEvent] No activities to analyze for event');
      eventGenerationInProgressRef.current = false;
      return;
    }

    setActiveAnalysesCount((prev) => prev + 1);
    const currentActiveCount = activeAnalysesCountRef.current + 1;
    setMainStatus(`Analyzing Event (${currentActiveCount})...`);
    logToUI(
      '[processMultiActivityEvent] 🎯 Analyzing',
      activitiesToAnalyze.length,
      'activities for event generation',
    );

    try {
      const activitiesSummary = activitiesToAnalyze.map((item) => {
        if (item.type === 'initial_dump') {
          return {
            type: 'initial_dump',
            timestamp: item.timestamp,
            content_preview: item.raw_content.substring(0, 500) + '...',
          };
        } else {
          return {
            type: 'ui_diff',
            timestamp: item.timestamp,
            change_detected: item.change_detected,
            change_description: item.change_description,
            change_types: item.identified_change_types,
            new_content_preview: item.new_content_detected
              ? item.new_content_detected.substring(0, 200) + '...'
              : null,
          };
        }
      });

      const response = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysisType: 'multi_activity_event',
          activitiesSummary: activitiesSummary,
          prompt: eventsPrompt,
          model: EVENTS_MODEL_NAME,
          previousEvents: events.slice(0, 50).map((e) => ({
            summary: e.summary,
            timestamp: e.timestamp,
            isNewWorkflow: e.thoughts?.includes('yes') || false,
          })),
        }),
      });

      const result = await response.json();

      if (response.ok && result.analysis) {
        const { is_distinct_event, description } = result.analysis;

        if (is_distinct_event === 'yes') {
          const eventId = new Date().toISOString() + '-event';
          const newEvent: Event = {
            id: eventId,
            summary: description,
            thoughts: `Distinct event`, 
            timestamp: new Date().toISOString(), 
          };

          setEvents((prevEvents) =>
            [newEvent, ...prevEvents]
              .sort((a, b) => {
                const timeA = new Date(a.id.split('-event')[0]).getTime();
                const timeB = new Date(b.id.split('-event')[0]).getTime();
                return timeB - timeA;
              })
              .slice(0, 100) 
          );

          logToUI(
            '[processMultiActivityEvent] ✅ Distinct event generated:',
            description,
          );
        } else {
          logToUI(
            '[processMultiActivityEvent] ⏭️ No distinct event identified - similar to recent activity. Description:',
            description,
          );
          const eventId = new Date().toISOString() + '-event-non-distinct';
          const newEvent: Event = {
            id: eventId,
            summary: description || 'No distinct event identified',
            thoughts: 'Non-distinct activity based on backend analysis.',
            timestamp: new Date().toISOString(), 
          };
          setEvents((prevEvents) =>
            [newEvent, ...prevEvents]
              .sort((a, b) => {
                const timeA = new Date(a.id.split('-event')[0]).getTime();
                const timeB = new Date(b.id.split('-event')[0]).getTime();
                return timeB - timeA;
              })
              .slice(0, 100)
          );
        }
      } else {
        logError(
          '[processMultiActivityEvent] Backend error:',
          result.error || 'Unknown error',
        );
      }
    } catch (err) {
      logError('[processMultiActivityEvent] Network error:', err);
    } finally {
      setActiveAnalysesCount((prev) => Math.max(0, prev - 1));
      eventGenerationInProgressRef.current = false;
    }
  }, [
    activityItems,
    activeAnalysesCount,
    eventsPrompt,
    EVENTS_MODEL_NAME,
    logToUI,
    logError,
    setActiveAnalysesCount,
    setMainStatus,
    setEvents,
    events,
  ]);

  useEffect(() => {
    if (eventGenerationInProgressRef.current) {
      return;
    }

    if (stream && activeAnalysesCount < MAX_PARALLEL_ANALYSES) {
      processMultiActivityEvent();
    }

  }, [stream, activityItems, activeAnalysesCount, processMultiActivityEvent]); 

  return (
    <div className='container mx-auto px-4 py-2 flex flex-col items-center min-h-screen antialiased max-w-7xl'>
      <ExportStatusDialog exportInProgress={exportInProgress} />

      <PageHeaderControls
        stream={stream}
        handleStartScreenShare={handleStartScreenShare}
        handleStopScreenShare={handleStopScreenShare}
        handleManualInitialDump={handleManualInitialDump}
        mainStatus={mainStatus}
        autoDetectionEnabled={autoDetectionEnabled}
        isMonitoring={isMonitoring}
        displayChangePercent={displayChangePercent}
        activeAnalysesCount={activeAnalysesCount}
        error={error}
        streamRef={streamRef}
        MAX_PARALLEL_ANALYSES={MAX_PARALLEL_ANALYSES}
      />

      <ErrorNotification error={error} showError={showError} dismissError={dismissError} />

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <canvas ref={monitoringCanvasRef} style={{ display: 'none' }} />

      <div className='w-full max-w-7xl grid grid-cols-1 lg:grid-cols-3 gap-4'>
        <VideoPreviewArea stream={stream} videoRef={videoRef} />

        <div className='lg:col-span-2 flex flex-col gap-4'>
          <Tabs defaultValue='events' className='w-full -mt-2'>
            <TabsList className='grid w-full grid-cols-4 mb-1'>
              <TabsTrigger value='events'>Events</TabsTrigger>
              <TabsTrigger value='recent'>Recent Activity</TabsTrigger>
              <TabsTrigger value='settings'>Settings</TabsTrigger>
              <TabsTrigger value='debug'>Debug Logs</TabsTrigger>
            </TabsList>

            <TabsContent value='events' className='-mt-3'>
              <EventsTabContent memoizedEventsContent={memoizedEventsContent} />
            </TabsContent>

            <TabsContent value='recent' className='-mt-3'>
              <ActivityTabContent memoizedActivityContent={memoizedActivityContent} />
            </TabsContent>

            <TabsContent value='settings' className='-mt-3'>
              <SettingsTabContent
                customPrompt={customPrompt}
                handlePromptChange={handlePromptChange}
                promptSaveStatus={promptSaveStatus}
                eventsPrompt={eventsPrompt}
                EVENTS_MODEL_NAME={EVENTS_MODEL_NAME}
                autoDetectionEnabled={autoDetectionEnabled}
                setAutoDetectionEnabled={setAutoDetectionEnabled}
                monitoringFrequency={monitoringFrequency}
                setMonitoringFrequency={setMonitoringFrequency}
                changeThreshold={changeThreshold}
                setChangeThreshold={setChangeThreshold}
                stabilityDelay={stabilityDelay}
                setStabilityDelay={setStabilityDelay}
                screenshotQuality={screenshotQuality}
                setScreenshotQuality={setScreenshotQuality}
                maxScreenshots={maxScreenshots}
                setMaxScreenshots={setMaxScreenshots}
                pixelDifferenceThreshold={pixelDifferenceThreshold}
                setPixelDifferenceThreshold={setPixelDifferenceThreshold}
                stream={stream}
                activeAnalysesCount={activeAnalysesCount}
              />
            </TabsContent>

            <TabsContent value='debug' className='-mt-3'>
              <DebugTabContent
                frontendLogs={frontendLogs}
                copyLogsToClipboard={copyLogsToClipboard}
                copyStatus={copyStatus}
                clearAllData={clearAllData}
                handleExportAllData={handleExportAllData}
                exportInProgress={exportInProgress}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
