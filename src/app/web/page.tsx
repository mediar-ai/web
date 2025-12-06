'use client';

import LiveAnalysesPanel from '@/components/capture/LiveAnalysesPanel';
import PipView from '@/components/capture/PipView';
import ScreenshotPreviewPane from '@/components/capture/ScreenshotPreviewPane';
import TimelineSlider from '@/components/capture/TimelineSlider';
import VideoPreviewArea from '@/components/capture/VideoPreviewArea';
import ScrollHint from '@/components/onboarding/ScrollHint';
import LowLevelLogsTabContent from '@/components/tabs/LowLevelLogsTabContent';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EVENTS_PROMPT, TEXT_EXTRACTION_PROMPT } from '@/lib/prompts';
import { uploadScreenshot } from '@/lib/screenshotUploader';
import { Bug, MoreHorizontal, Settings, Zap } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { usePostHog } from 'posthog-js/react';
import ErrorNotification from '../../components/capture/ErrorNotification';
import ExportStatusDialog from '../../components/capture/ExportStatusDialog';
import PageHeaderControls from '../../components/capture/PageHeaderControls';
import ActivityTabContent from '../../components/tabs/ActivityTabContent';
import DebugTabContent from '../../components/tabs/DebugTabContent';
import EventsTabContent from '../../components/tabs/EventsTabContent';
import SettingsTabContent from '../../components/tabs/SettingsTabContent';
import WorkflowTabContent from '../../components/tabs/WorkflowTabContent';
import { useAutoDetection } from '../../hooks/useAutoDetection';
import { useEventGenerator } from '../../hooks/useEventGenerator';
import { useFrameAnalysisDispatcher } from '../../hooks/useFrameAnalysisDispatcher';
import { RemoteDataProvider } from '../../lib/dataProviders';
import {
  saveScreenshot,
} from '../../lib/db';
import type {
  ActivityItem,
  BufferedFrame,
  DataProvider,
  Event,
  RunningAnalysis,
} from '../../types';

function HomeComponent() {
  const EVENTS_MODEL_NAME = 'gemini-2.5-flash'; // 🔥 Updated to stable Vertex AI model name
  const MAX_PARALLEL_ANALYSES = 5;

  const posthog = usePostHog();
  const [dataProvider, setDataProvider] = useState<DataProvider | null>(null);

  const [screenshotQuality, setScreenshotQuality] = useState<number>(0.95);
  const [maxScreenshots, setMaxScreenshots] = useState<number>(50);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const monitoringCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState<boolean>(false);
  const [isCapturingForBuffer, setIsCapturingForBuffer] = useState(false);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityPagination, setActivityPagination] = useState<{ offset: number; limit: number; total: number; hasMore: boolean } | null>(null);
  const [isLoadingMoreActivities, setIsLoadingMoreActivities] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const [frameBuffer, setFrameBuffer] = useState<BufferedFrame[]>([]);
  const [activeAnalysesCount, setActiveAnalysesCount] = useState<number>(0);
  const [runningAnalyses, setRunningAnalyses] = useState<RunningAnalysis[]>([]);
  const [completedAnalyses, setCompletedAnalyses] = useState<RunningAnalysis[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>(TEXT_EXTRACTION_PROMPT);
  const [eventsPrompt] = useState<string>(EVENTS_PROMPT);
  const [mainStatus, setMainStatus] = useState<string>('Idle');
  const [frontendLogs, setFrontendLogs] = useState<string[]>([]);
  const [reconnectRequired, setReconnectRequired] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [analysesPanelCollapsed, setAnalysesPanelCollapsed] = useState(false);
  const [selectedMoreOption, setSelectedMoreOption] = useState<string | null>(null);
  const [selectedMainTab, setSelectedMainTab] = useState<string>('recent');
  const [showScrollHint, setShowScrollHint] = useState<boolean>(false);
  const [hasTriggeredScrollHint, setHasTriggeredScrollHint] = useState<boolean>(false);
  const [isHoveringScrollableArea, setIsHoveringScrollableArea] = useState<boolean>(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(false);
  const [resolutionWarning, setResolutionWarning] = useState<string | null>(null);

  const initialFrameCapturedRef = useRef<boolean>(false);
  const streamActiveBeforeSleep = useRef<boolean>(false);
  const lastHeartbeat = useRef<number>(Date.now());
  const currentCaptureSessionIdRef = useRef<number>(0);
  const streamedItemIds = useRef(new Set<string>());

  const [promptSaveStatus, setPromptSaveStatus] = useState<
    'idle' | 'saving' | 'saved'
  >('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const [userId, setUserId] = useState<string | null>(null);
  const [appSessionId, setAppSessionId] = useState<string>(() => {
    // Load from localStorage or generate a new one
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('app_session_id');
      if (stored) return stored;
      const newId = crypto.randomUUID();
      localStorage.setItem('app_session_id', newId);
      return newId;
    }
    return '';
  });

  // Screenshot sequence tracking
  const [captureSessionId, setCaptureSessionId] = useState(() => {
    // Load from localStorage or start at 1
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('capture_session_id');
      return stored ? parseInt(stored, 10) : 1;
    }
    return 1;
  });
  const [screenshotCounter, setScreenshotCounter] = useState(0);

  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [lowLevelLogsCount, setLowLevelLogsCount] = useState<number>(0);

  // Calculate screenshot count
  const screenshotCount = useMemo(() => {
    return activityItems.filter(item => 
      (item.type === 'initial_dump' && item.image_id) || 
      (item.type === 'ui_diff' && (item.image1_id || item.image2_id))
    ).length;
  }, [activityItems]);

  // Calculate average time between events
  const avgTimeBetweenEvents = useMemo(() => {
    if (events.length < 2) return null;
    const sortedEvents = [...events].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    let totalDiff = 0;
    for (let i = 1; i < sortedEvents.length; i++) {
      totalDiff += new Date(sortedEvents[i].timestamp).getTime() - 
                   new Date(sortedEvents[i-1].timestamp).getTime();
    }
    return Math.round(totalDiff / (sortedEvents.length - 1) / 1000); // in seconds
  }, [events]);

  const logToUI = useCallback((...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args.map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    const logEntry = `${timestamp} ${message}`;
    setFrontendLogs((prevLogs) => {
      const newLogs = [logEntry, ...prevLogs].slice(0, 100);
      return newLogs;
    });
    console.log(...args);
  }, []);

  const logError = useCallback((...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args.map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    const logEntry = `${timestamp} [ERROR] ${message}`;
    setFrontendLogs((prevLogs) => {
      const newLogs = [logEntry, ...prevLogs].slice(0, 100);
      return newLogs;
    });
    console.error(...args);
  }, []);

  const streamData = useCallback(async <T extends {id: string, timestamp: string}>(itemType: string, item: T) => {
    const appSessionId = localStorage.getItem('app_session_id');
    if (!userId || !appSessionId) {
      // Don't log an error here, as this can happen normally on startup
      return;
    }
    
    // Prevent re-streaming the same item
    if (streamedItemIds.current.has(item.id)) {
      return;
    }

    try {
      const response = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sessionId: appSessionId,
          itemType,
          item,
        }),
      });

      if (response.ok) {
        streamedItemIds.current.add(item.id);
      } else {
        const errorData = await response.json();
        logError(`[streamData] API error for ${itemType} (${item.id}):`, errorData.details || response.statusText);
      }
    } catch (err) {
      logError(`[streamData] Network error for ${itemType} (${item.id}):`, err);
    }
  }, [logError, userId]);

  const videoRefCallback = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
  }, []);

  const loadData = useCallback(async (provider: DataProvider) => {
    if (!provider) return;
    logToUI(`[loadData] Loading data from Supabase...`);
    try {
      const [_savedSteps, savedEvents, activityResult, savedCompletedAnalyses] =
        await Promise.all([
          provider.loadWorkflowSteps(),
          provider.loadEvents(),
          provider.loadActivityItemsWithPagination(),
          provider.loadCompletedAnalyses(),
        ]);

      const paginationInfo = activityResult.pagination;

      // De-duplicate data on the client-side to prevent key errors
      const uniqueActivityItems = Array.from(new Map(activityResult.activityItems.map(item => [item.id, item])).values());
      const uniqueEvents = Array.from(new Map(savedEvents.map(item => [item.id, item])).values());
      const uniqueCompletedAnalyses = Array.from(new Map(savedCompletedAnalyses.map(item => [item.id, item])).values());

      // Always set the data, even if it's empty, to clear out old state.
      setActivityItems(uniqueActivityItems);
      setActivityPagination(paginationInfo);
      logToUI(
        `[loadData] Loaded ${uniqueActivityItems.length} of ${paginationInfo?.total || 0} activity items`
      );

      setEvents(uniqueEvents);
      logToUI(`[loadData] Loaded ${uniqueEvents.length} events`);

      setCompletedAnalyses(uniqueCompletedAnalyses);
      logToUI(`[loadData] Loaded ${uniqueCompletedAnalyses.length} completed analyses`);

    } catch (err) {
      logError('[loadData] Failed to load data:', err);
    }
  }, [logError, logToUI]);

  // Callback to load more activity items for infinite scroll
  const loadMoreActivities = useCallback(async () => {
    if (isLoadingMoreActivities || !activityPagination?.hasMore || !dataProvider) {
      return;
    }

    setIsLoadingMoreActivities(true);
    try {
      const newOffset = activityItems.length;
      const result = await dataProvider.loadMoreActivityItems(newOffset);

      if (result.activityItems.length > 0) {
        // Append new items (older) to existing items
        setActivityItems(prev => {
          // De-duplicate when merging
          const existingIds = new Set(prev.map(item => item.id));
          const newItems = result.activityItems.filter(item => !existingIds.has(item.id));
          return [...prev, ...newItems];
        });
        setActivityPagination(result.pagination);
        logToUI(`[loadMoreActivities] Loaded ${result.activityItems.length} more activities`);
      }
    } catch (err) {
      logError('[loadMoreActivities] Failed to load more:', err);
    } finally {
      setIsLoadingMoreActivities(false);
    }
  }, [isLoadingMoreActivities, activityPagination, dataProvider, activityItems.length, logToUI, logError]);

  // Initialize user and load data from Supabase
  useEffect(() => {
    // Get or create user ID
    let storedUserId = localStorage.getItem('user_id');
    if (!storedUserId) {
      storedUserId = crypto.randomUUID();
      localStorage.setItem('user_id', storedUserId);
      logToUI(`[Auth] New anonymous user ID generated: ${storedUserId}`);
    } else {
      logToUI(`[Auth] Found existing user ID: ${storedUserId}`);
    }
    setUserId(storedUserId);

    // Create provider and load data
    const provider = new RemoteDataProvider(storedUserId);
    setDataProvider(provider);
    logToUI(`[Init] Loading data for user ${storedUserId}`);
    loadData(provider);
  }, [logToUI, loadData]);

  // Show welcome modal on first visit
  useEffect(() => {
    const hasVisited = localStorage.getItem('mediar-web-visited');
    if (!hasVisited) {
      setShowWelcomeModal(true);
    }
  }, []);

  // Stream new activity items as they're created
  useEffect(() => {
    if (!streamRef.current || !userId) {
      return;
    }

    const appSessionId = localStorage.getItem('app_session_id');
    if (!appSessionId) {
      return;
    }

    // Find items not yet streamed
    const newItems = activityItems.filter(item => !streamedItemIds.current.has(item.id));

    if (newItems.length > 0) {
      logToUI(`[Stream] Found ${newItems.length} new activity items to stream`);
      newItems.forEach(item => {
        streamData('activity_item', item);
      });
    }
  }, [activityItems, userId, streamData, logToUI]);

  // Stream new events as they're created
  useEffect(() => {
    if (!streamRef.current || !userId) {
      return;
    }

    const appSessionId = localStorage.getItem('app_session_id');
    if (!appSessionId) {
      return;
    }

    // Find items not yet streamed
    const newItems = events.filter(item => !streamedItemIds.current.has(item.id));

    if (newItems.length > 0) {
      logToUI(`[Stream] Found ${newItems.length} new events to stream`);
      newItems.forEach(item => {
        streamData('event', item);
      });
    }
  }, [events, userId, streamData, logToUI]);

  // Stream new completed analyses as they're created
  useEffect(() => {
    if (!streamRef.current || !userId) {
      return;
    }

    const appSessionId = localStorage.getItem('app_session_id');
    if (!appSessionId) {
      return;
    }

    // Find items not yet streamed - only stream completed analyses with endTime
    const newItems = completedAnalyses.filter(
      item => !streamedItemIds.current.has(item.id) &&
              item.status === 'completed' &&
              item.endTime
    );

    if (newItems.length > 0) {
      logToUI(`[Stream] Found ${newItems.length} new completed analyses to stream`);
      newItems.forEach(item => {
        const itemToStream = { ...item, timestamp: new Date(item.endTime!).toISOString() };
        streamData('completed_analysis', itemToStream);
      });
    }
  }, [completedAnalyses, userId, streamData, logToUI]);

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
        const imageDataUrl = canvas.toDataURL('image/jpeg', screenshotQuality);
        const timestamp = Date.now();
        
        // Ensure we only store the pure base64 part for uploads and API calls
        const base64Data = imageDataUrl.split(';base64,')[1];
        
        // Increment screenshot counter
        const newScreenshotNumber = screenshotCounter + 1;
        setScreenshotCounter(newScreenshotNumber);
        const sequenceId = `${currentCaptureSessionIdRef.current}-${newScreenshotNumber}`;
        
        const newFrame: BufferedFrame = {
          id: `${timestamp}-change-${changePercent.toFixed(2)}`,
          imageDataUrl: `data:image/jpeg;base64,${base64Data}`, // Keep prefix for local display
          base64Data, // Store pure base64 for processing
          timestamp,
          percentChange: changePercent,
          sequenceId,
        };

        logToUI(
          '[captureFrameToBuffer] Creating frame with sequence ID:', sequenceId,
        );

        // Asynchronously upload the screenshot to Supabase Storage via signed URL
        if (userId) {
          const appSessionId = localStorage.getItem('app_session_id');
          if (appSessionId) {
            // Use the pure base64 data for the upload function, which will construct the data URL internally
            uploadScreenshot(base64Data, userId, appSessionId, newFrame.id)
              .catch(err => logError('[captureFrameToBuffer] Screenshot upload failed:', err));
          }
        }

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
              '[captureFrameToBuffer] Buffer full. Evicted with least change.',
            );
          }
          return newBufferTrimmed.sort((a, b) => a.timestamp - b.timestamp);
        });
        logToUI(
          '[captureFrameToBuffer] Frame added to buffer. Size reflects next render.',
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
              '[captureFrameToBuffer] Failed to load image from data URL for saving.',
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
          '[captureFrameToBuffer] Video not ready. State:',
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
    currentCaptureSessionIdRef,
    screenshotCounter,
    userId,
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
    setRunningAnalyses,
    setCompletedAnalyses,
    activeAnalysesCount,
    setActiveAnalysesCount,
    logToUI,
    logError,
    setMainStatus,
    MAX_PARALLEL_ANALYSES,
    userId,
    sessionId: appSessionId,
  });

  useEventGenerator({
    stream,
    activityItems,
    setActivityItems,
    events,
    setEvents,
    setRunningAnalyses,
    setCompletedAnalyses,
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
      const mostRecentActivityId = event.activity_ids[0];
      const relatedActivity = activityItems.find(a => a.id === mostRecentActivityId);

      if (relatedActivity) {
        setSelectedActivity(relatedActivity);
      } else {
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
    posthog?.capture('web_app_copy_logs', {
      logs_count: frontendLogs.length,
      timestamp: new Date().toISOString(),
    });
    try {
      const logsText = frontendLogs.join('\n');
      await navigator.clipboard.writeText(logsText);
      logToUI('[copyLogsToClipboard] Logs copied to clipboard');
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      logError('[copyLogsToClipboard] Failed to copy logs:', err);
    }
  }, [frontendLogs, logToUI, logError, posthog]);

  const clearAllData = useCallback(() => {
    posthog?.capture('web_app_clear_all_data', {
      activity_items_count: activityItems.length,
      events_count: events.length,
      logs_count: frontendLogs.length,
      timestamp: new Date().toISOString(),
    });
    setEvents([]);
    setFrontendLogs([]);
    setActivityItems([]);
    setCompletedAnalyses([]);
    setCaptureSessionId(1);
    localStorage.setItem('capture_session_id', '1');
    logToUI('[clearAllData] All local state cleared, session ID reset to 1');
  }, [logToUI, setActivityItems, activityItems.length, events.length, frontendLogs.length, posthog]);

  const dismissError = useCallback(() => {
    setShowError(false);
    setTimeout(() => setError(null), 300);
  }, []);

  const handleStopScreenShare = useCallback(() => {
    posthog?.capture('web_app_stop_recording', {
      timestamp: new Date().toISOString(),
      activity_items_count: activityItems.length,
      events_count: events.length,
    });
    logToUI('[handleStopScreenShare] Stopping screen share.');
    if (pipWindow) {
      pipWindow.close();
      setPipWindow(null);
    }
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
    logToUI(
      '[handleStopScreenShare] Screen share stopped. Queued analyses will continue.',
    );
    if (initialFrameCapturedRef) {
        initialFrameCapturedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    stream,
    logToUI,
    initialFrameCapturedRef,
    pipWindow,
  ]); // Intentionally omit posthog - external ref that doesn't affect callback logic

  const handleStartScreenShare = useCallback(async () => {
    posthog?.capture('web_app_start_recording', {
      timestamp: new Date().toISOString(),
    });
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

    // Generate a new, unique session ID for this recording session
    const newAppSessionId = crypto.randomUUID();
    localStorage.setItem('app_session_id', newAppSessionId);
    setAppSessionId(newAppSessionId);
    logToUI(`[handleStartScreenShare] New session started with ID: ${newAppSessionId}`);

    const currentSessionId = captureSessionId;
    currentCaptureSessionIdRef.current = currentSessionId;
    const nextSessionId = captureSessionId + 1;
    setCaptureSessionId(nextSessionId);
    localStorage.setItem('capture_session_id', String(nextSessionId));
    setScreenshotCounter(0);

    logToUI(
      '[handleStartScreenShare] Cleared buffers for new session. ID:', currentSessionId,
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
      logToUI('[handleStartScreenShare] Media stream obtained successfully.');
      setStream(mediaStream);
      streamRef.current = mediaStream;
    } catch (err: unknown) {
      // Don't log or show errors for NotAllowedError - this happens when browser is
      // still processing the permission request or user hasn't interacted yet
      if (err instanceof Error && err.name === 'NotAllowedError') {
        logToUI('[handleStartScreenShare] Permission prompt dismissed or not yet granted.');
        setStream(null);
        streamRef.current = null;
        setMainStatus('Idle');
        return;
      }

      // For all other errors, log and display them
      logError('[handleStartScreenShare] Error obtaining media stream:', err);
      let message = 'Unknown start error.';
      if (err instanceof Error) {
        message = `Start error: ${err.message}`;
        logError(`[handleStartScreenShare] Error details: Name: ${err.name}, Message: ${err.message}, Stack: ${err.stack}`);
      }
      logError('[handleStartScreenShare] Error:', message, err);
      setError(message);
      setStream(null);
      streamRef.current = null;
      setMainStatus('Error starting share');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, logToUI, logError, captureSessionId]); // Intentionally omit posthog - stable ref

  const handleWelcomeStartRecording = useCallback(() => {
    localStorage.setItem('mediar-web-visited', 'true');
    setShowWelcomeModal(false);
    handleStartScreenShare();
  }, [handleStartScreenShare]);

  useEffect(() => {
    if (selectedActivity) {
      const parentEvent = events.find(e => e.activity_ids?.includes(selectedActivity.id));
      if (parentEvent && parentEvent.id !== selectedEvent?.id) {
        setSelectedEvent(parentEvent);
      }
    }
  }, [selectedActivity, events, selectedEvent]);

  useEffect(() => {
    if (!selectedActivity && activityItems.length > 0) {
      setSelectedActivity(activityItems[0]); 
    }
  }, [activityItems, selectedActivity]);

  useEffect(() => {
    if (!selectedEvent && events.length > 0) {
      setSelectedEvent(events[0]); 
    }
  }, [events, selectedEvent]);

  useEffect(() => {
    if (selectedMainTab === 'recent' && activityItems.length > 0) {
      setSelectedActivity(activityItems[0]);
      logToUI('[Tab Switch] Auto-selected most recent activity for Recent tab');
    } else if (selectedMainTab === 'events' && events.length > 0) {
      setSelectedEvent(events[0]);
      logToUI('[Tab Switch] Auto-selected most recent event for Events tab');
    }
  }, [selectedMainTab, activityItems, events, logToUI]);


  useEffect(() => {
    const hasSeenScrollHint = localStorage.getItem('hasSeenScrollHint');
    
    if (!hasSeenScrollHint && selectedMainTab === 'recent' && activityItems.length > 0 && isHoveringScrollableArea && !hasTriggeredScrollHint) {
      logToUI('[ScrollHint] Triggering hint for first time');
      setShowScrollHint(true);
      setHasTriggeredScrollHint(true);
    }
  }, [selectedMainTab, activityItems.length, isHoveringScrollableArea, hasTriggeredScrollHint, logToUI]);

  const handleDismissScrollHint = () => {
    setShowScrollHint(false);
    localStorage.setItem('hasSeenScrollHint', 'true');
    logToUI('[ScrollHint] User dismissed scroll hint');
  };

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
  }, [activeAnalysesCount, setMainStatus, videoRef, streamRef]); 

  useEffect(() => {
    updateMainStatus();
  }, [stream, error, activeAnalysesCount, setMainStatus, updateMainStatus]);

  useEffect(() => {
    logToUI(`[useEffect stream] Main effect RUNNING. Stream active: ${!!stream}`);
    const currentVideoElement = videoRef.current;
    const onMetadataLoadedHandler = () => {
      if (!currentVideoElement) return;
      const width = currentVideoElement.videoWidth;
      const height = currentVideoElement.videoHeight;
      logToUI("[useEffect stream] 'loadedmetadata' - Dimensions:", {
        w: width,
        h: height,
      });
      if (width > 0) {
        setMainStatus('Recording (Preview Active)');
        // Check for high resolution (> Full HD 1920x1080)
        const FULL_HD_WIDTH = 1920;
        const FULL_HD_HEIGHT = 1080;
        if (width > FULL_HD_WIDTH || height > FULL_HD_HEIGHT) {
          const warningMsg = `High resolution detected (${width}x${height}). For best AI recognition quality, consider sharing a smaller window or reducing display resolution. Resolutions above 1920x1080 may result in lower content recognition accuracy.`;
          setResolutionWarning(warningMsg);
          logToUI('[Resolution Warning]', warningMsg);
        } else {
          setResolutionWarning(null);
        }
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

      if (delta > 10000) { 
        logToUI('[SleepDetector] Potential wake from sleep.');
        if (streamActiveBeforeSleep.current && !(streamRef.current && streamRef.current.active)) {
          logToUI('[SleepDetector] Stream disconnected. Prompting to reconnect.');
          setReconnectRequired(true);
        }
      }

      streamActiveBeforeSleep.current = !!(streamRef.current && streamRef.current.active);
    }, 2000); 

    return () => clearInterval(interval);
  }, [logToUI]);

  useEffect(() => {
    const storedDetailsCollapsed = localStorage.getItem('detailsCollapsed');
    if (storedDetailsCollapsed) {
      setDetailsCollapsed(storedDetailsCollapsed === 'true');
    }
    const storedAnalysesPanelCollapsed = localStorage.getItem('analysesPanelCollapsed');
    if (storedAnalysesPanelCollapsed) {
      setAnalysesPanelCollapsed(storedAnalysesPanelCollapsed === 'true');
    }
  }, []);

  const toggleDetailsPanel = () => {
    setDetailsCollapsed(prevState => {
      const newState = !prevState;
      posthog?.capture('web_app_toggle_details_panel', {
        action: newState ? 'collapse' : 'expand',
        timestamp: new Date().toISOString(),
      });
      localStorage.setItem('detailsCollapsed', String(newState));
      return newState;
    });
  };

  const toggleAnalysesPanel = () => {
    setAnalysesPanelCollapsed(prevState => {
      const newState = !prevState;
      posthog?.capture('web_app_toggle_analyses_panel', {
        action: newState ? 'collapse' : 'expand',
        timestamp: new Date().toISOString(),
      });
      localStorage.setItem('analysesPanelCollapsed', String(newState));
      return newState;
    });
  };

  const queuedAnalyses: RunningAnalysis[] = frameBuffer.map(frame => ({
    id: frame.id,
    type: 'UI Difference Analysis',
    status: 'queued',
    payloadType: 'image',
    payloadSize: frame.imageDataUrl.length,
    sequenceId: frame.sequenceId,
  }));

  const pendingEventAnalyses: RunningAnalysis[] = frameBuffer.map(frame => ({
    id: `event-gen-pending-${frame.id}`,
    type: 'Event Generation',
    status: 'queued',
    payloadType: 'text',
    sequenceId: frame.sequenceId
  }));

  const allAnalyses = [...queuedAnalyses, ...pendingEventAnalyses, ...runningAnalyses, ...completedAnalyses];

  // Debug logging for LLM traces
  useEffect(() => {
    console.log('[LLM Traces Debug]', {
      selectedMainTab,
      selectedActivity: !!selectedActivity,
      selectedMoreOption,
      showCondition: (selectedMainTab === 'events' || (selectedMainTab === 'recent' && selectedActivity)) && !selectedMoreOption,
      analysesCounts: {
        queued: queuedAnalyses.length,
        pending: pendingEventAnalyses.length,
        running: runningAnalyses.length,
        completed: completedAnalyses.length,
        total: allAnalyses.length
      },
      frameBufferLength: frameBuffer.length,
      analysesPanelCollapsed
    });
  }, [selectedMainTab, selectedActivity, selectedMoreOption, allAnalyses.length, analysesPanelCollapsed, completedAnalyses.length, frameBuffer.length, pendingEventAnalyses.length, queuedAnalyses.length, runningAnalyses.length]);

  // Debug: Check IndexedDB directly
  useEffect(() => {
    const checkIndexedDB = async () => {
      try {
        const dbRequest = indexedDB.open('WorkflowCaptureDB', 5);
        dbRequest.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const transaction = db.transaction(['completedAnalyses'], 'readonly');
          const store = transaction.objectStore('completedAnalyses');
          const getAllRequest = store.getAll();
          
          getAllRequest.onsuccess = () => {
            console.log('[IndexedDB Check] Completed analyses in DB:', getAllRequest.result?.length || 0);
            if (getAllRequest.result && getAllRequest.result.length > 0) {
              console.log('[IndexedDB Check] Sample:', getAllRequest.result[0]);
            }
          };
        };
      } catch (err) {
        console.error('[IndexedDB Check] Error:', err);
      }
    };
    
    checkIndexedDB();
  }, []);

  useEffect(() => {
    logToUI(`[App] Starting with capture session ID: ${captureSessionId} (next capture will use this ID)`);
  }, [captureSessionId, logToUI]); 

  useEffect(() => {
    if (pipWindow) {
      const root = document.createElement('div');
      pipWindow.document.body.innerHTML = '';
      pipWindow.document.body.appendChild(root);
      const style = document.createElement('style');
      style.textContent = `
        body { margin: 0; background-color: #2E2E2E; color: #FFFFFF; }
        button { background-color: #444; color: white; border: 1px solid #555; border-radius: 5px; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
      `;
      pipWindow.document.head.appendChild(style);
      const reactRoot = ReactDOM.createRoot(root);
      reactRoot.render(<PipView events={events} onStart={handleStartScreenShare} onStop={handleStopScreenShare} isCapturing={!!stream} mainStatus={mainStatus} error={error} />);
    }
  }, [events, pipWindow, stream, mainStatus, error, handleStartScreenShare, handleStopScreenShare]);

  const handleTogglePip = async (open?: boolean) => {
    posthog?.capture('web_app_toggle_pip', {
      action: open === true ? 'open' : open === false ? 'close' : 'toggle',
      timestamp: new Date().toISOString(),
    });
    if (open === false && pipWindow) {
      pipWindow.close();
      setPipWindow(null);
      return;
    }

    if (open === true && !pipWindow && window.documentPictureInPicture) {
      try {
        const newPipWindow = await window.documentPictureInPicture.requestWindow({
          width: 600,
          height: 50,
          disallowReturnToOpener: false,
        });
        setPipWindow(newPipWindow);
        newPipWindow.addEventListener('pagehide', () => {
          setPipWindow(null);
        });
      } catch (err) {
        logError('Failed to open PiP window:', err);
      }
      return;
    }

    if (pipWindow) {
      pipWindow.close();
      setPipWindow(null);
      return;
    }

    if (window.documentPictureInPicture) {
      try {
        const newPipWindow = await window.documentPictureInPicture.requestWindow({
          width: 600,
          height: 50,
          disallowReturnToOpener: false,
        });
        setPipWindow(newPipWindow);
        newPipWindow.addEventListener('pagehide', () => {
          setPipWindow(null);
        });
      } catch (err) {
        logError('Failed to open PiP window:', err);
      }
    } else {
      logError('Document Picture-in-Picture API is not supported.');
    }
  };

  return (
    <div className='bg-background stable-container px-4 py-2 flex flex-col items-center min-h-screen antialiased'>
      <ExportStatusDialog exportInProgress={false} />

      {/* Welcome Modal for first-time visitors */}
      <Dialog open={showWelcomeModal} onOpenChange={setShowWelcomeModal}>
        <DialogContent size="sm" hideClose>
          <DialogHeader className="text-center">
            <DialogTitle className="text-xl font-mono">Screen Recording</DialogTitle>
            <DialogDescription className="text-base mt-2">
              Record your screen to capture workflows. We&apos;ll analyze your actions and help you turn them into automations.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center mt-4">
            <Button
              onClick={handleWelcomeStartRecording}
              className="bg-black text-white hover:bg-gray-800 font-mono"
              size="lg"
            >
              <Zap className="mr-2 h-4 w-4" /> Try Recording
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PageHeaderControls
        stream={stream}
        handleStartScreenShare={() => {
          handleStartScreenShare();
          handleTogglePip(true);
        }}
        handleStopScreenShare={handleStopScreenShare}
        onTogglePip={() => handleTogglePip()}
        isPipOpen={!!pipWindow}
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

      {/* Resolution Warning Banner */}
      {resolutionWarning && (
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-40 transition-all duration-300">
          <Card className="bg-yellow-500/90 border-yellow-600 text-black p-3 shadow-lg backdrop-blur-sm max-w-lg">
            <div className="flex items-start gap-2">
              <div className="text-sm font-medium">⚠️ {resolutionWarning}</div>
              <Button
                onClick={() => setResolutionWarning(null)}
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 text-black hover:bg-black/20 ml-auto flex-shrink-0"
              >
                ✕
              </Button>
            </div>
          </Card>
        </div>
      )}

              <Card className="w-full mt-4 hidden">
        <CardHeader>
          <CardTitle>Live Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <VideoPreviewArea 
            stream={stream} 
            videoRef={videoRefCallback}
          />
        </CardContent>
      </Card>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <canvas ref={monitoringCanvasRef} style={{ display: 'none' }} />

      <div 
        className="w-full mt-4 space-y-4"
        onMouseEnter={() => setIsHoveringScrollableArea(true)}
        onMouseLeave={() => setIsHoveringScrollableArea(false)}
      >
        {activityItems.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Timeline & Screenshot Preview ({screenshotCount})</h2>
              <Button variant="ghost" size="sm" onClick={toggleDetailsPanel}>
                {detailsCollapsed ? 'Show' : 'Hide'}
              </Button>
            </div>
            {!detailsCollapsed && dataProvider && (
              <div className="space-y-4">
                <ScreenshotPreviewPane
                  selectedActivity={selectedActivity}
                  activityItems={activityItems}
                  onActivitySelect={setSelectedActivity}
                  dataProvider={dataProvider}
                />
                <TimelineSlider
                  activityItems={activityItems}
                  selectedActivity={selectedActivity}
                  onActivitySelect={setSelectedActivity}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="w-full grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Tabs defaultValue='recent' className='w-full -mt-2' value={selectedMoreOption || selectedMainTab} onValueChange={(value) => {
            posthog?.capture('web_app_tab_change', {
              tab: value,
              timestamp: new Date().toISOString(),
            });
            if (value === 'settings' || value === 'debug' || value === 'low-level') {
              setSelectedMoreOption(value);
            } else {
              setSelectedMainTab(value);
            }
          }}>
            <div className='flex items-center justify-between mb-1'>
              <TabsList className='grid grid-cols-3 flex-1 mr-2'>
                <TabsTrigger value='recent' onClick={() => {
                  setSelectedMoreOption(null);
                  setSelectedMainTab('recent');
                }}>Recent Activity ({activityItems.length})</TabsTrigger>
                <TabsTrigger value='events' onClick={() => {
                  setSelectedMoreOption(null);
                  setSelectedMainTab('events');
                }}>Events ({events.length}){avgTimeBetweenEvents !== null && ` • ~${avgTimeBetweenEvents}s`}</TabsTrigger>
                <TabsTrigger value='workflow' onClick={() => {
                  setSelectedMoreOption(null);
                  setSelectedMainTab('workflow');
                }}>Workflow</TabsTrigger>
              </TabsList>
              
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant='outline' size='sm' className='h-9 px-2 flex-shrink-0'>
                      <MoreHorizontal className='h-4 w-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem onClick={() => {
                      setSelectedMoreOption('low-level');
                      setSelectedMainTab('low-level');
                    }}>
                      <Bug className='mr-2 h-4 w-4' />
                      Low-level Logs{lowLevelLogsCount > 0 && ` (${lowLevelLogsCount})`}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      setSelectedMoreOption('settings');
                      setSelectedMainTab('settings');
                    }}>
                      <Settings className='mr-2 h-4 w-4' />
                      Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      setSelectedMoreOption('debug');
                      setSelectedMainTab('debug');
                    }}>
                      <Bug className='mr-2 h-4 w-4' />
                      Debug Logs
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ThemeSwitcher />
              </div>
            </div>

            <TabsContent value='recent' className='-mt-3'>
              <ActivityTabContent
                activityItems={activityItems}
                selectedActivity={selectedActivity}
                onActivitySelect={setSelectedActivity}
                pagination={activityPagination}
                onLoadMore={loadMoreActivities}
                isLoadingMore={isLoadingMoreActivities}
              />
            </TabsContent>

            <TabsContent value='events' className='-mt-3'>
              <EventsTabContent
                events={events}
                selectedEvent={selectedEvent}
                onEventSelect={handleEventSelect}
              />
            </TabsContent>

            <TabsContent value='workflow' className='-mt-3'>
              <WorkflowTabContent
                userId={userId}
                eventsCount={events.length}
                activityItemsCount={activityItems.length}
              />
            </TabsContent>

            <TabsContent value='low-level' className='-mt-3'>
              <LowLevelLogsTabContent onLogsCountChange={setLowLevelLogsCount} />
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
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      
      {(selectedMainTab === 'recent' || selectedMainTab === 'events') && !selectedMoreOption && (
        <div className="w-full mt-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">LLM traces {allAnalyses.length > 0 && `(${allAnalyses.length})`}</h2>
              <Button variant="ghost" size="sm" onClick={toggleAnalysesPanel}>
                {analysesPanelCollapsed ? 'Show' : 'Hide'}
              </Button>
            </div>
            {!analysesPanelCollapsed && (
              <LiveAnalysesPanel runningAnalyses={allAnalyses} />
            )}
          </div>
        </div>
      )}
      <ScrollHint show={showScrollHint} onDismiss={handleDismissScrollHint} />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <HomeComponent />
    </Suspense>
  );
}
