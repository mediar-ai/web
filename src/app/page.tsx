'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  saveScreenshot
} from '../lib/db';
import EventsTabContent from '../components/tabs/EventsTabContent';
import ActivityTabContent from '../components/tabs/ActivityTabContent';
import SettingsTabContent from '../components/tabs/SettingsTabContent';
import DebugTabContent from '../components/tabs/DebugTabContent';
import PageHeaderControls from '../components/capture/PageHeaderControls';
import VideoPreviewArea from '../components/capture/VideoPreviewArea';
import ErrorNotification from '../components/capture/ErrorNotification';
import ExportStatusDialog from '../components/capture/ExportStatusDialog';
import { useAutoDetection } from '../hooks/useAutoDetection';
import { useFrameAnalysisDispatcher } from '../hooks/useFrameAnalysisDispatcher';
import { useEventGenerator } from '../hooks/useEventGenerator';
import ScreenshotPreviewPane from '@/components/capture/ScreenshotPreviewPane';
import TimelineSlider from '@/components/capture/TimelineSlider';

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
    '[Supabase] URL or Anon Key is not set. Supabase client not initialized.',
  );
}

export default function Home() {
  const EVENTS_MODEL_NAME = 'gemini-2.5-pro-preview-05-06';
  const MAX_PARALLEL_ANALYSES = 5;

  const [screenshotQuality, setScreenshotQuality] = useState<number>(0.6);
  const [maxScreenshots, setMaxScreenshots] = useState<number>(50);

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
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
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
    `You are analyzing user workflow activities to create a concise event summary for the LATEST activity only. Previous activities are provided only for context.

CRITICAL RULES:
- Focus ONLY on the most recent/latest activity captured
- Use previous activities only to understand context and progression
- NEVER truncate messages, names, or content from the latest activity
- Distinguish between user actions vs system/other person actions  
- Focus on completed actions, not observations
- Be specific about what was accomplished in this latest step

OUTPUT FORMAT: Create a single concise sentence that captures the complete latest action.

EXAMPLES:
❌ Bad: "User sent a new chat m.."
✅ Good: "User sent message 'Can we schedule the meeting for tomorrow at 2pm?' to John Smith in Slack"

❌ Bad: "User observing email interface"  
✅ Good: "User opened email from sarah@company.com with subject 'Q4 Budget Review Meeting'"

❌ Bad: "User typing in form"
✅ Good: "User filled out contact form with name 'Alice Johnson' and email 'alice@example.com'"

❌ Bad: "User clicked button"
✅ Good: "User clicked 'Submit Payment' button to complete $299 order"
FOCUS ON THE LATEST ACTIVITY:
- Complete messages/content (never truncate)
- Recipient/sender names when available
- Specific document/file names opened/created
- Exact button/link text clicked
- Form field values entered
- Email subjects, senders, recipients
- Chat participants and full message content
- Completed transactions or submissions

Analyze the activity sequence for context, then create ONE clear, complete event summary that captures what the user accomplished in the LATEST activity only.`,
  );
  const [mainStatus, setMainStatus] = useState<string>('Idle');
  const [frontendLogs, setFrontendLogs] = useState<string[]>([]);
  const [exportInProgress, setExportInProgress] = useState<boolean>(false); 
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [previewCollapsed, setPreviewCollapsed] = useState(false);

  const initialFrameCapturedRef = useRef(false);
  const streamActiveBeforeSleep = useRef(false);
  const lastHeartbeat = useRef(Date.now());

  const [promptSaveStatus, setPromptSaveStatus] = useState<
    'idle' | 'saving' | 'saved'
  >('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

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
          if (newBufferFull.length > 10) { 
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
            await saveScreenshot(newFrame.id, tempCanvasForSave);
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

  const activeAnalysesCountRef = useRef(activeAnalysesCount);
  useEffect(() => {
    activeAnalysesCountRef.current = activeAnalysesCount;
  }, [activeAnalysesCount]);

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

  useEventGenerator({
    stream,
    activityItems,
    events,
    setEvents,
    activeAnalysesCount,
    setActiveAnalysesCount,
    logToUI,
    logError,
    setMainStatus,
    MAX_PARALLEL_ANALYSES,
    EVENTS_MODEL_NAME,
    eventsPrompt,
  });

  const handleEventSelect = (event: Event) => {
    setSelectedEvent(event);

    if (event.activity_ids && event.activity_ids.length > 0) {
      // The activities are sorted newest first, so the first ID is the most relevant
      const mostRecentActivityId = event.activity_ids[0];
      const relatedActivity = activityItems.find(a => a.id === mostRecentActivityId);

      if (relatedActivity) {
        setSelectedActivity(relatedActivity);
      } else {
        // If the specific activity isn't found, clear the selection
        setSelectedActivity(null);
      }
    } else {
      setSelectedActivity(null);
    }
  };

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
      await clearPersistedData();
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
      const allLocalData = await getAllPersistedDataForExport();
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
    setReconnectRequired(false);

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
    if (selectedActivity) {
      const parentEvent = events.find(e => e.activity_ids?.includes(selectedActivity.id));
      if (parentEvent && parentEvent.id !== selectedEvent?.id) {
        setSelectedEvent(parentEvent);
      }
    }
  }, [selectedActivity, events, selectedEvent]);

  // Auto-select the most recent activity when items are available but nothing is selected
  useEffect(() => {
    if (!selectedActivity && activityItems.length > 0) {
      setSelectedActivity(activityItems[0]); // Most recent is first in the array
    }
  }, [activityItems, selectedActivity]);

  // Auto-select the most recent event when items are available but nothing is selected
  useEffect(() => {
    if (!selectedEvent && events.length > 0) {
      setSelectedEvent(events[0]); // Most recent is first in the array
    }
  }, [events, selectedEvent]);

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

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastHeartbeat.current;
      lastHeartbeat.current = now;

      // If a long time has passed since the last check, we assume the computer was asleep.
      if (delta > 10000) { // 10 second threshold
        logToUI('[SleepDetector] Detected potential wake from sleep.');
        if (streamActiveBeforeSleep.current && !(streamRef.current && streamRef.current.active)) {
          logToUI('[SleepDetector] Stream was active before sleep, but is now disconnected. Prompting to reconnect.');
          setReconnectRequired(true);
          // The 'ended' event on the track should have already triggered cleanup.
          // This state just ensures the user sees a clear way to restart.
        }
      }

      // Continuously track if the stream is active.
      streamActiveBeforeSleep.current = !!(streamRef.current && streamRef.current.active);
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [logToUI]);

  return (
    <div className='container mx-auto px-4 py-2 flex flex-col items-center min-h-screen antialiased max-w-7xl'>
      <ExportStatusDialog exportInProgress={exportInProgress} />

      <PageHeaderControls
        stream={stream}
        handleStartScreenShare={handleStartScreenShare}
        handleStopScreenShare={handleStopScreenShare}
        mainStatus={mainStatus}
        autoDetectionEnabled={autoDetectionEnabled}
        isMonitoring={isMonitoring}
        displayChangePercent={displayChangePercent}
        activeAnalysesCount={activeAnalysesCount}
        error={error}
        streamRef={streamRef}
        MAX_PARALLEL_ANALYSES={MAX_PARALLEL_ANALYSES}
        reconnectRequired={reconnectRequired}
      />

      <ErrorNotification error={error} showError={showError} dismissError={dismissError} />

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <canvas ref={monitoringCanvasRef} style={{ display: 'none' }} />

      <div className={`w-full max-w-7xl grid grid-cols-1 gap-4 ${
        previewCollapsed ? 'lg:grid-cols-[auto_1fr]' : 'lg:grid-cols-3'
      }`}>
        <VideoPreviewArea 
          stream={stream} 
          videoRef={videoRef} 
          onCollapseChange={setPreviewCollapsed}
        />

        <div className={previewCollapsed ? 'flex flex-col gap-4' : 'lg:col-span-2 flex flex-col gap-4'}>
          <Tabs defaultValue='events' className='w-full -mt-2'>
            <TabsList className='grid w-full grid-cols-4 mb-1'>
              <TabsTrigger value='events'>Events</TabsTrigger>
              <TabsTrigger value='recent'>Recent Activity</TabsTrigger>
              <TabsTrigger value='settings'>Settings</TabsTrigger>
              <TabsTrigger value='debug'>Debug Logs</TabsTrigger>
            </TabsList>

            <TabsContent value='events' className='-mt-3'>
              <EventsTabContent
                events={events}
                selectedEvent={selectedEvent}
                onEventSelect={handleEventSelect}
              />
            </TabsContent>

            <TabsContent value='recent' className='-mt-3'>
              <ActivityTabContent
                activityItems={activityItems}
                selectedActivity={selectedActivity}
                onActivitySelect={setSelectedActivity}
              />
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
      {selectedActivity && (
        <div className="w-full max-w-7xl mt-4">
          <TimelineSlider
            activityItems={activityItems}
            selectedActivity={selectedActivity}
            onActivitySelect={setSelectedActivity}
          />
          <ScreenshotPreviewPane 
            selectedActivity={selectedActivity} 
            activityItems={activityItems}
            onActivitySelect={setSelectedActivity}
          />
        </div>
      )}
    </div>
  );
}
