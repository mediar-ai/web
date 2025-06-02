"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area"; // For log display
import { useRef, useState, useCallback, useEffect, useMemo, memo } from "react";

// import Image from "next/image"; // No longer needed after removing default content

// IndexedDB utilities for persistence
const DB_NAME = 'WorkflowCaptureDB';
const DB_VERSION = 4; // Incremented to add screenshots store and activity items store
const WORKFLOW_STORE = 'workflowSteps';
const LOGS_STORE = 'frontendLogs';
const EVENTS_STORE = 'events';
const SCREENSHOTS_STORE = 'screenshots';
const ACTIVITY_ITEMS_STORE = 'activityItems'; // New store for activity items
const MAX_SCREENSHOTS = 50; // Keep only last 50 screenshots

// Stable style object for ScrollAreas, defined globally for the module
const scrollAreaStyle = { overflow: 'scroll', scrollbarWidth: 'thin' } as const;

interface BufferedFrame {
  id: string;
  imageDataUrl: string;
  timestamp: number;
  percentChange: number;
}

// Updated Event interface
interface Event {
  id: string;
  summary: string; // The concise summary
  thoughts?: string; // Optional thought process from the model
  timestamp: string;
}

interface ParsedAnalysis {
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
}

interface InitialFrameDumpAnalysis {
  type: 'initial_dump';
  id: string; // Frame ID, can be the same as image_id for simplicity here
  timestamp: string;
  raw_content: string;
  image_id: string; // ID of the dumped frame from BufferedFrame
}

// UIDiffAnalysis now includes a type discriminator
interface UIDiffAnalysis {
  type: 'ui_diff';
  id: string; 
  timestamp: string; 
  change_detected: "yes" | "no";
  change_description?: string;
  identified_change_types?: string[];
  mouse_movement_details?: {
    from_object?: string;
    from_coordinate?: string;
    to_object?: string;
    to_coordinate?: string;
  };
  typing_details?: string;
  click_details?: string;
  new_window_details?: {
    old_window_name?: string;
    new_window_name?: string;
  };
  new_app_details?: string;
  scroll_details?: {
    new_content_summary?: string;
  };
  other_change_details?: Array<{
    type_description?: string;
    details?: string;
  }>;
  unidentified_changes_explanation?: string;
  new_content_detected?: string; // Added new field
  image1_id?: string; 
  image2_id?: string; 
}

type ActivityItem = InitialFrameDumpAnalysis | UIDiffAnalysis;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create workflow steps store
      if (!db.objectStoreNames.contains(WORKFLOW_STORE)) {
        const workflowStore = db.createObjectStore(WORKFLOW_STORE, { keyPath: 'id' });
        workflowStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      // Create logs store
      if (!db.objectStoreNames.contains(LOGS_STORE)) {
        const logsStore = db.createObjectStore(LOGS_STORE, { keyPath: 'id', autoIncrement: true });
        logsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      // Create events store
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
        eventsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
      
      // Create screenshots store
      if (!db.objectStoreNames.contains(SCREENSHOTS_STORE)) {
        const screenshotsStore = db.createObjectStore(SCREENSHOTS_STORE, { keyPath: 'id' });
        screenshotsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Create activity items store
      if (!db.objectStoreNames.contains(ACTIVITY_ITEMS_STORE)) {
        db.createObjectStore(ACTIVITY_ITEMS_STORE, { keyPath: 'id' }); // Corrected: removed unused variable
        // We will sort by timestamp derived from ID in the load function, similar to events
      }
    };
  });
};

const saveWorkflowSteps = async (steps: Array<{id: string, analysis: string, parsed: ParsedAnalysis | null, timestamp: string}>) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([WORKFLOW_STORE], 'readwrite');
    const store = transaction.objectStore(WORKFLOW_STORE);
    
    // Clear existing and add new
    await store.clear();
    for (const step of steps) {
      await store.add(step);
    }
  } catch (err) {
    console.error('[saveWorkflowSteps] Failed to save:', err);
  }
};

const loadWorkflowSteps = async (): Promise<Array<{id: string, analysis: string, parsed: ParsedAnalysis | null, timestamp: string}>> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([WORKFLOW_STORE], 'readonly');
    const store = transaction.objectStore(WORKFLOW_STORE);
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const steps = request.result || [];
        // Sort by timestamp descending (newest first)
        steps.sort((a, b) => new Date(b.id).getTime() - new Date(a.id).getTime());
        resolve(steps);
      };
    });
  } catch (err) {
    console.error('[loadWorkflowSteps] Failed to load:', err);
    return [];
  }
};

const saveFrontendLogs = async (logs: string[]) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([LOGS_STORE], 'readwrite');
    const store = transaction.objectStore(LOGS_STORE);
    
    // Clear existing and add new with timestamps
    await store.clear();
    for (let i = 0; i < logs.length; i++) {
      await store.add({ 
        message: logs[i], 
        timestamp: Date.now() - i, // Reverse timestamp to maintain order
        index: i 
      });
    }
  } catch (err) {
    console.error('[saveFrontendLogs] Failed to save:', err);
  }
};

const loadFrontendLogs = async (): Promise<string[]> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([LOGS_STORE], 'readonly');
    const store = transaction.objectStore(LOGS_STORE);
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const logEntries = request.result || [];
        // Sort by index to maintain original order
        logEntries.sort((a, b) => a.index - b.index);
        resolve(logEntries.map(entry => entry.message));
      };
    });
  } catch (err) {
    console.error('[loadFrontendLogs] Failed to load:', err);
    return [];
  }
};

const clearPersistedData = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([WORKFLOW_STORE, LOGS_STORE, EVENTS_STORE, SCREENSHOTS_STORE, ACTIVITY_ITEMS_STORE], 'readwrite');
    await transaction.objectStore(WORKFLOW_STORE).clear();
    await transaction.objectStore(LOGS_STORE).clear();
    await transaction.objectStore(EVENTS_STORE).clear();
    await transaction.objectStore(SCREENSHOTS_STORE).clear();
    await transaction.objectStore(ACTIVITY_ITEMS_STORE).clear(); // Clear new store
  } catch (err) {
    console.error('[clearPersistedData] Failed to clear:', err);
  }
};

const saveEvents = async (events: Array<Event>) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([EVENTS_STORE], 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);
    
    // Clear existing and add new
    await store.clear();
    for (const event of events) {
      await store.add(event);
    }
  } catch (err) {
    console.error('[saveEvents] Failed to save:', err);
  }
};

const loadEvents = async (): Promise<Array<{id: string, summary: string, timestamp: string}>> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([EVENTS_STORE], 'readonly');
    const store = transaction.objectStore(EVENTS_STORE);
    const request = store.getAll();
    
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const events = request.result || [];
        // Sort by timestamp descending (newest first), using robust ID parsing
        events.sort((a, b) => {
          const timeA = new Date(a.id.split('-change-')[0].split('-event')[0]).getTime();
          const timeB = new Date(b.id.split('-change-')[0].split('-event')[0]).getTime();
          return timeB - timeA;
        });
        resolve(events);
      };
    });
  } catch (err) {
    console.error('[loadEvents] Failed to load:', err);
    return [];
  }
};

// Compress canvas to JPEG blob for efficient storage
const compressCanvasToBlob = (canvas: HTMLCanvasElement, quality: number = 0.7): Promise<Blob> => {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob!);
    }, 'image/jpeg', quality);
  });
};

const saveScreenshot = async (id: string, canvas: HTMLCanvasElement) => {
  try {
    const db = await openDB();
    const blob = await compressCanvasToBlob(canvas, 0.6); // 60% quality for compression
    
    const screenshotData = {
      id,
      blob,
      timestamp: Date.now(),
      size: blob.size
    };
    
    const transaction = db.transaction([SCREENSHOTS_STORE], 'readwrite');
    const store = transaction.objectStore(SCREENSHOTS_STORE);
    
    // Add new screenshot
    await store.add(screenshotData);
    
    // Get all screenshots to check count
    const allRequest = store.getAll();
    const allScreenshots = await new Promise<{id: string, timestamp: number}[]>((resolve, reject) => {
      allRequest.onerror = () => reject(allRequest.error);
      allRequest.onsuccess = () => resolve(allRequest.result || []);
    });
    
    // If we exceed the limit, remove oldest ones
    if (allScreenshots.length > MAX_SCREENSHOTS) {
      allScreenshots.sort((a, b) => a.timestamp - b.timestamp); // Sort oldest first
      const toDelete = allScreenshots.slice(0, allScreenshots.length - MAX_SCREENSHOTS);
      
      for (const screenshot of toDelete) {
        await store.delete(screenshot.id);
      }
    }
  } catch (err) {
    console.error('[saveScreenshot] Failed to save:', err);
  }
};

// Memoized Child Components for Scrollable Content
interface MemoizedScrollAreaContentProps {
  content: React.ReactNode;
  className?: string;
}

const MemoizedScrollAreaContent = memo(({ content, className }: MemoizedScrollAreaContentProps) => {
  return (
    <ScrollArea className={className || "h-[350px] pr-3"} style={scrollAreaStyle}>
      <CardContent className="text-xs p-3">
        {content}
      </CardContent>
    </ScrollArea>
  );
});
MemoizedScrollAreaContent.displayName = 'MemoizedScrollAreaContent';

interface MemoizedDebugLogsScrollAreaProps {
  logs: string[];
}

const MemoizedDebugLogsScrollArea = memo(({ logs }: MemoizedDebugLogsScrollAreaProps) => {
  const content = useMemo(() => {
    return logs.length > 0 ? (
      logs.map((log, index) => 
        <div 
          key={index} 
          className={`whitespace-pre-wrap border-b border-slate-700 py-1 pr-16 ${
            log.includes('[ERROR]') ? 'text-red-400' : 'text-slate-200'
          }`}
        >
          {log}
        </div>
      )
    ) : (
      <p className="p-4 text-center">No UI logs yet.</p>
    );
  }, [logs]);

  return (
    <ScrollArea 
      className="h-[350px] w-full p-3 bg-slate-900 text-slate-200 font-mono text-[10px] leading-relaxed rounded-md" 
      style={scrollAreaStyle}
    >
      {content} {/* Render the memoized log divs directly */}
    </ScrollArea>
  );
});
MemoizedDebugLogsScrollArea.displayName = 'MemoizedDebugLogsScrollArea';

export default function Home() {
  // Model configurations
  const EVENTS_MODEL_NAME = "gemini-2.5-pro-preview-05-06";
  
  // Auto-detection configuration
  const [autoDetectionEnabled, setAutoDetectionEnabled] = useState<boolean>(true);
  const [monitoringFrequency, setMonitoringFrequency] = useState<number>(200); // ms
  const [changeThreshold, setChangeThreshold] = useState<number>(1.0); // percentage
  const [stabilityDelay, setStabilityDelay] = useState<number>(500); // ms
  const [screenshotQuality, setScreenshotQuality] = useState<number>(0.6);
  const [maxScreenshots, setMaxScreenshots] = useState<number>(50);
  const [pixelDifferenceThreshold, setPixelDifferenceThreshold] = useState<number>(20); // NEW: Threshold for pixel comparison (0-255)
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null); // Add ref to track current stream
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // Ref for the canvas
  const monitoringCanvasRef = useRef<HTMLCanvasElement>(null); // Ref for change detection
  const [error, setError] = useState<string | null>(null);
  const [showError, setShowError] = useState<boolean>(false);
  const [isCapturingForBuffer, setIsCapturingForBuffer] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<Array<{id: string, analysis: string, parsed: ParsedAnalysis | null, timestamp: string}>>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [frameBuffer, setFrameBuffer] = useState<BufferedFrame[]>([]);
  const [activeAnalysesCount, setActiveAnalysesCount] = useState<number>(0);
  const MAX_PARALLEL_ANALYSES = 5; // Changed back to const
  const [baselineFrameForDiff, setBaselineFrameForDiff] = useState<BufferedFrame | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>(`You are an expert business workflow assistant that analyzes screen data to identify business processes. Provide your analysis in the following structured format:

workflow_name_best_guess_latest: [Best guess of the overall workflow/process name based on what you see]
step_name: [Concise name for this specific step, 3-5 words max]
step_description: [What is happening in 10 or less words. Focus on fresh and unique information compared to previous logs, what has changed]
step_facts: [Key observable facts from the screen - buttons, text, UI elements, data visible]
step_logic: [Business rules or logic you can infer from this step]
step_metadata: [Technical details like application, browser, file types, etc.]
Opened_apps: [List of applications, windows, or programs visible on screen]
Tab_name_Url_filename_chatname_etc: [Specific context like browser tab titles, URLs, file names, chat names, document titles, etc. if available]

Context: You have access to previous analysis results for reference. Focus on identifying the progression of the workflow and any changes from previous steps.`);
  const [eventsPrompt] = useState<string>(`In 10 words or less describe what the user is actively DOING (not just viewing). Only say "Sending/Typing/Writing" if you see evidence of active input (cursor in text field, message being composed, unsent draft, typing indicator). If viewing existing content/messages, use "Reviewing/Browsing [what]". Focus on actual user actions, not past completed actions.`);
  const [mainStatus, setMainStatus] = useState<string>("Idle");
  const [frontendLogs, setFrontendLogs] = useState<string[]>([]);
  const [initialDumpInProgress, setInitialDumpInProgress] = useState<boolean>(false); // New state
  const [pendingFrameForDiff, setPendingFrameForDiff] = useState<BufferedFrame | null>(null); // New state
  const [diffAnalysisInProgress, setDiffAnalysisInProgress] = useState<boolean>(false); // New state

  // Auto-detection state & refs for stable callbacks
  const [isMonitoring, setIsMonitoring] = useState<boolean>(false);
  const [lastFrameData, setLastFrameData] = useState<Uint8ClampedArray | null>(null);
  const [activityDetected, setActivityDetected] = useState<boolean>(false);
  const [lastActivityTime, setLastActivityTime] = useState<number>(0);
  const monitoringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentChangePercentRef = useRef<number>(0);
  const [displayChangePercent, setDisplayChangePercent] = useState<number>(0);
  const lastDisplayChangeRef = useRef<number>(0);

  const activityDetectedRef = useRef(activityDetected);
  useEffect(() => { activityDetectedRef.current = activityDetected; }, [activityDetected]);
  const lastActivityTimeRef = useRef(lastActivityTime);
  useEffect(() => { lastActivityTimeRef.current = lastActivityTime; }, [lastActivityTime]);
  const stabilityDelayRef = useRef(stabilityDelay);
  useEffect(() => { stabilityDelayRef.current = stabilityDelay; }, [stabilityDelay]);
  const autoDetectionEnabledRef = useRef(autoDetectionEnabled);
  useEffect(() => { autoDetectionEnabledRef.current = autoDetectionEnabled; }, [autoDetectionEnabled]);
  const changeThresholdRef = useRef(changeThreshold);
  useEffect(() => { changeThresholdRef.current = changeThreshold; }, [changeThreshold]);
  const monitoringFrequencyRef = useRef(monitoringFrequency);
  useEffect(() => { monitoringFrequencyRef.current = monitoringFrequency; }, [monitoringFrequency]);
  const isMonitoringRef = useRef<boolean>(isMonitoring); 
  useEffect(() => { isMonitoringRef.current = isMonitoring; }, [isMonitoring]);
  const lastFrameDataRef = useRef<Uint8ClampedArray | null>(null);
  useEffect(() => { lastFrameDataRef.current = lastFrameData; }, [lastFrameData]);

  // Prompt autosave animation
  const [promptSaveStatus, setPromptSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  // 1. Logging utilities
  const logToUI = useCallback((...args: unknown[]) => {
    const timestamp = new Date().toLocaleTimeString();
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
    const logEntry = `${timestamp} ${message}`;
    setFrontendLogs(prevLogs => [logEntry, ...prevLogs].slice(0, 100));
    console.log(...args);
  }, []);

  const logError = useCallback((...args: unknown[]) => {
    const timestamp = new Date().toLocaleTimeString();
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
    const logEntry = `${timestamp} [ERROR] ${message}`;
    setFrontendLogs(prevLogs => [logEntry, ...prevLogs].slice(0, 100));
    console.error(...args);
  }, []);

  // 3. Core capture and analysis function
  const captureFrameToBuffer = useCallback(async (changePercent: number) => {
    if (!streamRef.current) { // Use streamRef.current for consistency
      logError("[captureFrameToBuffer] Stream not active."); // Log instead of setError for background operation
      return;
    }
    if (isCapturingForBuffer) return; // Prevent concurrent captures for buffer

    if (videoRef.current && canvasRef.current && videoRef.current.readyState >= videoRef.current.HAVE_METADATA && videoRef.current.videoWidth > 0) {
      setIsCapturingForBuffer(true); 
      logToUI("[captureFrameToBuffer] 🎞️ Capturing frame for buffer - Change:", changePercent.toFixed(2) + "%");
      
      const video = videoRef.current; 
      const canvas = canvasRef.current;
      
      // Ensure canvas dimensions match video for capture
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth; 
        canvas.height = video.videoHeight;
      }
      
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataUrl = canvas.toDataURL("image/png", screenshotQuality); // Use state for quality
        const timestamp = Date.now();
        const newFrame: BufferedFrame = {
          id: new Date(timestamp).toISOString() + `-change-${changePercent.toFixed(2)}`,
          imageDataUrl,
          timestamp,
          percentChange: changePercent
        };

        setFrameBuffer((prevBuffer: BufferedFrame[]) => {
          const newBufferFull = [...prevBuffer, newFrame]; // Use a different name to avoid conflict if prevBuffer is used later for size logging
          let newBufferTrimmed = newBufferFull;
          if (newBufferFull.length > 10) { // MAX_BUFFER_SIZE = 10
            // Sort by percentChange ascending, then by timestamp ascending for tie-breaking
            const sortedForEviction = [...newBufferFull].sort((a, b) => {
              if (a.percentChange !== b.percentChange) {
                return a.percentChange - b.percentChange;
              }
              return a.timestamp - b.timestamp;
            });
            sortedForEviction.shift(); // Remove the one with least change (or oldest if tie)
            newBufferTrimmed = sortedForEviction;
            logToUI("[captureFrameToBuffer] Buffer full. Evicted frame with least change.");
          }
          // Ensure buffer is sorted by timestamp for chronological processing later
          return newBufferTrimmed.sort((a,b) => a.timestamp - b.timestamp);
        });
        logToUI("[captureFrameToBuffer] Frame added to buffer. Current buffer size will be reflected in next render cycle.");
        
        // Optionally, save screenshot to DB immediately if desired, 
        // or do it when frame is picked for analysis. For now, let's do it here.
        try {
          // Need a temporary canvas to draw the image data URL back for saving blob
          const tempCanvasForSave = document.createElement('canvas');
          const tempCtx = tempCanvasForSave.getContext('2d');
          const img = new Image();
          img.onload = async () => {
            tempCanvasForSave.width = img.width;
            tempCanvasForSave.height = img.height;
            tempCtx?.drawImage(img, 0, 0);
            await saveScreenshot(newFrame.id, tempCanvasForSave);
            logToUI("[captureFrameToBuffer] Screenshot for buffered frame saved:", newFrame.id);
          };
          img.onerror = () => {
            logError("[captureFrameToBuffer] Failed to load image from data URL for saving screenshot.");
          };
          img.src = imageDataUrl;
        } catch (screenshotErr) {
          logError("[captureFrameToBuffer] Screenshot save for buffered frame failed:", screenshotErr);
        }

      } else {
        logError("[captureFrameToBuffer] Error: Could not get 2D context for buffer capture.");
      }
      setIsCapturingForBuffer(false);
    } else {
       if (streamRef.current && videoRef.current) {
           logToUI("[captureFrameToBuffer] Video not ready for capture to buffer. State:", { readyState: videoRef.current.readyState, videoWidth: videoRef.current.videoWidth });
       }
    }
  }, [isCapturingForBuffer, screenshotQuality, logToUI, logError, setFrameBuffer, setIsCapturingForBuffer, streamRef]); // Added streamRef

  // New function to process UI Diff for two frames
  const processUIDiffRequest = useCallback(async (frame1: BufferedFrame, frame2: BufferedFrame) => {
    if (diffAnalysisInProgress) return; // Should be guarded by dispatcher, but as an extra check
    setDiffAnalysisInProgress(true);
    setActiveAnalysesCount(prev => prev + 1);
    const currentActiveCount = activeAnalysesCountRef.current +1; 
    setMainStatus(`Analyzing UI Diff (${currentActiveCount})...`);
    const newDiffId = frame2.id + "-diff"; 
    const displayTimestamp = new Date(frame2.timestamp).toLocaleTimeString();
    logToUI("[processUIDiffRequest] 🚀 Starting UI Diff analysis between:", frame1.id, "and", frame2.id);

    try {
      const response = await fetch("/api/capture", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image1_dataUrl: frame1.imageDataUrl,
          image2_dataUrl: frame2.imageDataUrl,
          analysisType: 'ui_diff',
          prompt: "Perform UI difference analysis"
        }),
      });
      const result = await response.json();
      if (response.ok && typeof result.analysis === 'object') {
        const diffData = result.analysis as Omit<UIDiffAnalysis, 'type' | 'id' | 'timestamp' | 'image1_id' | 'image2_id'>;
        
        const newActivityItem: ActivityItem = {
          type: 'ui_diff',
          ...diffData,
          id: newDiffId,
          timestamp: displayTimestamp,
          image1_id: frame1.id,
          image2_id: frame2.id
        };

        setActivityItems(prevItems => // Changed from setUiDiffSteps
          [newActivityItem, ...prevItems]
            .sort((a, b) => { 
                // Ensure IDs are valid before splitting for robust sorting
                const idA = a.type === 'ui_diff' ? a.image2_id : a.image_id;
                const idB = b.type === 'ui_diff' ? b.image2_id : b.image_id;
                const timeA = new Date(idA!.split('-diff')[0].split('-change-')[0]).getTime();
                const timeB = new Date(idB!.split('-diff')[0].split('-change-')[0]).getTime();
                return timeB - timeA;
            })
            .slice(0, 100) 
        );
        logToUI("[processUIDiffRequest] ✅ UI Diff analysis successful for:", newDiffId);
        setBaselineFrameForDiff(frame2); 
      } else {
        logError("[processUIDiffRequest] Backend error for UI Diff:", result.error || 'Unknown error', result.details || '');
      }
    } catch (err) {
      logError("[processUIDiffRequest] Network error during UI Diff:", err);
    }
    setActiveAnalysesCount(prev => Math.max(0, prev - 1));
    setDiffAnalysisInProgress(false);
  }, [logToUI, logError, setActivityItems, setActiveAnalysesCount, setMainStatus, setBaselineFrameForDiff, diffAnalysisInProgress]); // Changed setUiDiffSteps to setActivityItems

  // New function for initial frame raw content dump
  const processInitialFrameDump = useCallback(async (frameToDump: BufferedFrame) => {
    if (initialDumpInProgress) return;
    setInitialDumpInProgress(true);
    setActiveAnalysesCount(prev => prev + 1);
    const currentActiveCount = activeAnalysesCountRef.current + 1;
    setMainStatus(`Analyzing Initial Frame (${currentActiveCount})...`);
    logToUI("[processInitialFrameDump] 🖼️ Starting raw content dump for initial frame:", frameToDump.id);
    try {
      const response = await fetch("/api/capture", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: frameToDump.imageDataUrl,
          timestamp: new Date(frameToDump.timestamp).toISOString(),
          prompt: "List in maximum detail all visible text and UI elements from the screenshot. Describe layout and objects.",
          analysisType: 'initial_frame_dump'
        }),
      });
      const result = await response.json();
      if (response.ok && result.analysis && typeof result.analysis.raw_content === 'string') {
        logToUI("[processInitialFrameDump] ✅ Initial frame dump successful...");
        const newActivityItem: ActivityItem = {
          type: 'initial_dump', id: frameToDump.id, timestamp: new Date(frameToDump.timestamp).toLocaleTimeString(),
          raw_content: result.analysis.raw_content, image_id: frameToDump.id
        };
        setActivityItems(prev => [newActivityItem, ...prev].sort(
          (a, b) => {
            const idA = a.type === 'ui_diff' ? a.image2_id : a.image_id;
            const idB = b.type === 'ui_diff' ? b.image2_id : b.image_id;
            const timeA = new Date(idA!.split('-diff')[0].split('-change-')[0]).getTime();
            const timeB = new Date(idB!.split('-diff')[0].split('-change-')[0]).getTime();
            return timeB - timeA;
          }
        ));
        setBaselineFrameForDiff(frameToDump); 
      } else {
        logError("[processInitialFrameDump] Backend error for initial dump:", result.error || 'Unknown error', result.details || '');
      }
    } catch (err) {
      logError("[processInitialFrameDump] Network error during initial dump:", err);
    } finally {
        setActiveAnalysesCount(prev => Math.max(0, prev - 1));
        setInitialDumpInProgress(false); 
    }
  }, [logToUI, logError, setActiveAnalysesCount, setMainStatus, setActivityItems, setBaselineFrameForDiff, initialDumpInProgress]);

  // useEffect for dispatching frames from buffer for analysis (NEW LOGIC)
  const activeAnalysesCountRef = useRef(activeAnalysesCount);
  useEffect(() => { activeAnalysesCountRef.current = activeAnalysesCount; }, [activeAnalysesCount]);

  useEffect(() => {
    // Condition to prevent starting new work if max analyses are running
    if (activeAnalysesCountRef.current >= MAX_PARALLEL_ANALYSES) {
      return;
    }

    // 1. Handle Initial Frame Dump if no baseline exists yet
    if (!baselineFrameForDiff && !initialDumpInProgress && frameBuffer.length >= 1) {
      const frameToDump = frameBuffer[0];
      logToUI("[Dispatcher] Picking oldest frame for Initial Raw Content Dump:", frameToDump.id);
      setFrameBuffer(prevBuffer => prevBuffer.slice(1)); 
      processInitialFrameDump(frameToDump);
      return; // Prioritize initial dump completion
    }

    // 2. If baseline exists, try to pick a pending frame for UI Diff
    if (baselineFrameForDiff && !pendingFrameForDiff && frameBuffer.length >= 1) {
      const nextFrame = frameBuffer[0];
      // Avoid picking the same frame as baseline if it somehow reappears or buffer is small
      if (baselineFrameForDiff.id !== nextFrame.id) {
        logToUI("[Dispatcher] Setting pending frame for diff:", nextFrame.id, "against baseline:", baselineFrameForDiff.id);
        setPendingFrameForDiff(nextFrame);
        setFrameBuffer(prevBuffer => prevBuffer.slice(1)); 
      } else if (frameBuffer.length === 1 && baselineFrameForDiff.id === nextFrame.id) {
        // Buffer only contains the baseline frame, do nothing, wait for more frames.
        logToUI("[Dispatcher] Buffer only contains baseline frame. Waiting for new frames.");
      }
      return; // Allow state to update before trying to process the diff
    }

    // 3. If baseline and a pending frame exist, and no diff is in progress, start UI Diff
    if (baselineFrameForDiff && pendingFrameForDiff && !diffAnalysisInProgress) {
      logToUI("[Dispatcher] Processing UI Diff. Baseline:", baselineFrameForDiff.id, "Pending:", pendingFrameForDiff.id);
      const frame1 = baselineFrameForDiff;
      const frame2 = pendingFrameForDiff;
      setPendingFrameForDiff(null); // Consume the pending frame for this operation
      processUIDiffRequest(frame1, frame2);
      // Note: baselineFrameForDiff will be updated by processUIDiffRequest on its success
    }

  }, [
    frameBuffer, activeAnalysesCount, 
    baselineFrameForDiff, pendingFrameForDiff, 
    initialDumpInProgress, diffAnalysisInProgress,
    processInitialFrameDump, processUIDiffRequest, 
    logToUI, setFrameBuffer, setBaselineFrameForDiff, setPendingFrameForDiff, /* setDiffAnalysisInProgress is not needed here */
    activityItems // Keep for the existingDiff check if that's re-added later
  ]);

  // 4. Auto-detection helper functions
  const getFrameDataForComparison = useCallback((video: HTMLVideoElement): Uint8ClampedArray | null => {
    if (!monitoringCanvasRef.current) return null;
    const canvas = monitoringCanvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    const smallWidth = 160;
    const smallHeight = 120;
    canvas.width = smallWidth;
    canvas.height = smallHeight;
    context.drawImage(video, 0, 0, smallWidth, smallHeight);
    return context.getImageData(0, 0, smallWidth, smallHeight).data;
  }, []);

  const calculateChangePercentage = useCallback((current: Uint8ClampedArray | null, previous: Uint8ClampedArray | null, threshold: number): number => {
    if (!current || !previous) return 0; // If either frame is null, no change
    if (current === previous) return 0; // Should not happen with pixel data but good check
    if (current.length !== previous.length) {
      // This case should ideally not happen if frames are always from the same size canvas
      // but if it does, it implies a 100% change or an error state.
      console.warn("[calculateChangePercentage] Frame lengths differ, returning 100% change.");
      return 100;
    }

    let changedPixels = 0;
    const pixelCount = current.length / 4; // Each pixel is 4 values (R,G,B,A)

    for (let i = 0; i < current.length; i += 4) {
      // Calculate the absolute difference for R, G, B channels
      const diffR = Math.abs(current[i] - previous[i]);
      const diffG = Math.abs(current[i + 1] - previous[i + 1]);
      const diffB = Math.abs(current[i + 2] - previous[i + 2]);
      // Alpha channel (current[i+3]) is ignored for now, but could be included

      // Average difference for the pixel
      const avgDifference = (diffR + diffG + diffB) / 3;

      if (avgDifference > threshold) {
        changedPixels++;
      }
    }
    return (changedPixels / pixelCount) * 100;
  }, []);

  const handleActivityDetection = useCallback(() => {
    // This function no longer directly triggers full analysis.
    // It's main role is to signal that a change occurred which might be captured.
    // The actual capture-to-buffer is now triggered by the monitoringLoop when change > threshold.
    const now = Date.now();
    setLastActivityTime(now); 
    if (!activityDetectedRef.current) { 
      setActivityDetected(true); 
      logToUI("[Auto-Detection] 🟡 Activity period started - Current Change:", currentChangePercentRef.current.toFixed(2) + "%");
    }
  }, [logToUI, setLastActivityTime, setActivityDetected]);

  const checkForStability = useCallback(() => {
    // This function's role changes. It no longer triggers analysis directly.
    // It still helps in identifying end of an activity burst for logging or other UI cues.
    const now = Date.now();
    if (activityDetectedRef.current && (now - lastActivityTimeRef.current > stabilityDelayRef.current)) {
      setActivityDetected(false); 
      logToUI("[Auto-Detection] 🟢 Screen relatively stable after activity burst. Last change:", currentChangePercentRef.current.toFixed(2) + "%");
      // No longer calls captureFrameAndSend() here.
    }
  }, [logToUI, stabilityDelayRef, activityDetectedRef, lastActivityTimeRef, currentChangePercentRef, setActivityDetected]); // Removed captureFrameAndSend
 
  // 5. Memoized UI content
  const memoizedEventsContent = useMemo(() => {
    return events.length > 0 ? (
      <div className="relative">
        <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-border"></div>
        {events.map((event) => (
          <div key={event.id} className="relative flex items-center gap-3 pb-3">
            <div className="relative z-10 w-4 h-4 bg-primary rounded-full border-2 border-background flex-shrink-0"></div>
            <div className="flex-1 min-w-0">
              <div 
                className="flex items-center gap-2" 
                title={event.thoughts ? `Thoughts: ${event.thoughts}` : undefined}
              >
                <span className="text-[10px] text-muted-foreground font-mono">{event.timestamp}</span>
                <span className="text-xs text-foreground truncate">{event.summary}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-muted-foreground italic p-8 text-center">No events captured yet. Start recording to see workflow events.</p>
    );
  }, [events]);

  // Memoized content for the "Recent Activity" tab - NOW DISPLAYS ActivityItems
  const memoizedActivityContent = useMemo(() => {
    return activityItems.length > 0 ? (
      <ul className="space-y-3">
        {activityItems.slice(0, 20).map((item) => {
          if (item.type === 'initial_dump') {
            return (
              <li key={item.id} className="p-3 border rounded-md bg-white text-xs text-black"> {/* Added text-black */}
                <p className="font-medium text-[10px] mb-1.5"> {/* Removed text-muted-foreground */}
                  {item.timestamp} 
                  <span className="ml-2 text-black font-semibold">Initial Frame Content</span> {/* Changed text-green-400 to text-black */}
                  <span className="ml-2 text-black text-[9px] dwindling_opacity">(Frame: {item.image_id?.split('-change-')[0].substring(11,19)})</span> {/* Changed text-slate-500 to text-black */}
                </p>
                <div className="whitespace-pre-wrap p-2 bg-gray-100 rounded text-black max-h-40 overflow-y-auto" style={scrollAreaStyle}> {/* Changed text-gray-800 to text-black */}
                  {item.raw_content}
                </div>
              </li>
            );
          } else if (item.type === 'ui_diff') {
            return (
              <li key={item.id} className="p-3 border rounded-md bg-white text-xs text-black"> {/* Added text-black */}
                <p className="font-medium text-[10px] mb-1.5"> {/* Removed text-muted-foreground */}
                  {item.timestamp} 
                  <span className="ml-2 text-black text-[9px] dwindling_opacity"> {/* Changed text-slate-500 to text-black */}
                    (Diff: {item.image1_id?.split('-change-')[0].substring(11,19)} vs {item.image2_id?.split('-change-')[0].substring(11,19)})
                  </span>
                </p>
                <div className="space-y-1">
                  <div><strong className="text-black">Change Detected:</strong> <span className={item.change_detected === 'yes' ? 'text-black font-semibold' : 'text-black'}>{item.change_detected}</span></div> {/* Changed text-sky-600 and status colors to text-black */}
                  {item.change_detected === 'yes' && (
                    <>
                      {item.change_description && <div><strong className="text-black">Description:</strong> {item.change_description}</div>} {/* Changed text-sky-600 to text-black */}
                      {item.identified_change_types && item.identified_change_types.length > 0 && (
                        <div className="mt-1"><strong className="text-black">Types:</strong> {item.identified_change_types.join(', ')}</div> /* Changed text-sky-600 to text-black */
                      )}
                      <div className="mt-1.5 space-y-0.5 pl-2 border-l-2 border-slate-700">
                        {item.mouse_movement_details && (
                          <div>
                            <strong className="text-black">Mouse:</strong> {/* Changed text-purple-500 to text-black */}
                            From: <span className="text-black">{item.mouse_movement_details.from_object || 'N/A'} ({item.mouse_movement_details.from_coordinate || 'N/A'})</span> {/* Changed text-gray-700 to text-black */}
                            {' -> '}To: <span className="text-black">{item.mouse_movement_details.to_object || 'N/A'} ({item.mouse_movement_details.to_coordinate || 'N/A'})</span> {/* Changed text-gray-700 to text-black */}
                          </div>
                        )}
                        {item.typing_details && <div><strong className="text-black">Typed:</strong> <span className="text-black">{item.typing_details}</span></div>} {/* Changed text-purple-500 and text-gray-700 to text-black */}
                        {item.click_details && <div><strong className="text-black">Clicked:</strong> <span className="text-black">{item.click_details}</span></div>} {/* Changed text-purple-500 and text-gray-700 to text-black */}
                        {item.new_window_details && (
                          <div>
                            <strong className="text-black">Window Change:</strong> {/* Changed text-purple-500 to text-black */}
                            Old: <span className="text-black">{item.new_window_details.old_window_name || 'N/A'}</span>, {/* Changed text-gray-700 to text-black */}
                            New: <span className="text-black">{item.new_window_details.new_window_name || 'N/A'}</span> {/* Changed text-gray-700 to text-black */}
                          </div>
                        )}
                        {item.new_app_details && <div><strong className="text-black">New App:</strong> <span className="text-black">{item.new_app_details}</span></div>} {/* Changed text-purple-500 and text-gray-700 to text-black */}
                        {item.scroll_details && <div><strong className="text-black">Scrolled - New Content:</strong> <span className="text-black">{item.scroll_details.new_content_summary}</span></div>} {/* Changed text-purple-500 and text-gray-700 to text-black */}
                        {item.other_change_details && item.other_change_details.map((other, idx) => (
                          <div key={idx}>
                            <strong className="text-black">Other ({other.type_description || 'N/A'}):</strong> <span className="text-black">{other.details}</span> {/* Changed text-purple-500 and text-gray-700 to text-black */}
                          </div>
                        ))}
                      </div>
                      {item.new_content_detected && (
                        <div className="mt-1.5 pt-1 border-t border-slate-700">
                          <strong className="text-black">Newly Detected Content:</strong>
                          <div className="whitespace-pre-wrap p-2 mt-1 bg-gray-100 rounded text-black max-h-40 overflow-y-auto" style={scrollAreaStyle}>
                            {item.new_content_detected}
                          </div>
                        </div>
                      )}
                      {item.unidentified_changes_explanation && <div className="mt-1.5 pt-1 border-t border-slate-700"><strong className="text-black">Model Explanation:</strong> {item.unidentified_changes_explanation}</div>} {/* Changed text-orange-500 to text-black */}
                    </>
                  )}
                </div>
              </li>
            );
          }
          return null;
        })}
      </ul>
    ) : (
      <p className="text-muted-foreground italic p-8 text-center">No activity captured yet. Start recording.</p>
    );
  }, [activityItems]);

  // 6. Other UI-related Callbacks
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
      logToUI("[copyLogsToClipboard] Logs copied to clipboard");
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      logError("[copyLogsToClipboard] Failed to copy logs:", err);
    }
  }, [frontendLogs, logToUI, logError]);

  const clearAllData = useCallback(async () => {
    try {
      await clearPersistedData();
      setWorkflowSteps([]);
      setEvents([]);
      setFrontendLogs([]);
      logToUI("[clearAllData] All persisted data cleared");
    } catch (err) {
      logError("[clearAllData] Failed to clear data:", err);
    }
  }, [logToUI, logError]);

  const dismissError = useCallback(() => {
    setShowError(false);
    setTimeout(() => setError(null), 300);
  }, []);

  const handleStopScreenShare = useCallback(() => {
    logToUI("[handleStopScreenShare] Stopping screen share.");
    const currentStream = streamRef.current || stream;
    if (currentStream) {
      currentStream.getTracks().forEach(track => {
        logToUI("[handleStopScreenShare] Stopping track:", track.kind, track.readyState);
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
    setMainStatus("Idle");
    // Clear buffer and reset baselines for a fresh start on next recording
    setFrameBuffer([]);
    setBaselineFrameForDiff(null);
    setPendingFrameForDiff(null);
    if (initialFrameCapturedRef) initialFrameCapturedRef.current = false; // Ensure it's reset
    logToUI("[handleStopScreenShare] Buffer and baselines cleared for fresh start.");
  }, [stream, logToUI, setFrameBuffer, setBaselineFrameForDiff, setPendingFrameForDiff]); // Added setters

  const handleStartScreenShare = useCallback(async () => {
    logToUI("[handleStartScreenShare] Attempting start...");
    setError(null);

    // Ensure a clean state before starting a new stream
    if (streamRef.current || stream) {
      const currentStream = streamRef.current || stream;
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    }
    setStream(null);
    streamRef.current = null;
    setIsCapturingForBuffer(false);
    setFrameBuffer([]); // Clear buffer
    setBaselineFrameForDiff(null); // Reset baseline
    setPendingFrameForDiff(null); // Reset pending diff
    if (initialFrameCapturedRef) initialFrameCapturedRef.current = false; // Reset initial capture flag
    logToUI("[handleStartScreenShare] Cleared buffers and baselines for new session.");

    setMainStatus("Initializing...");
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 5 }, displaySurface: "monitor" }, 
        audio: false
      });
      logToUI("[handleStartScreenShare] Media stream obtained.");
      setStream(mediaStream);
      streamRef.current = mediaStream;
    } catch (err: unknown) {
      let message = "Unknown start error.";
      if (err instanceof Error) {
        message = err.name === "NotAllowedError" ? "Permission denied by user." : `Start error: ${err.message}`;
      }
      logError("[handleStartScreenShare] Error:", message, err);
      setError(message);
      setStream(null);
      streamRef.current = null;
      setMainStatus("Error starting share");
    }
  }, [stream, logToUI, logError]);

  // 7. useEffects for lifecycle and side effects
  // Load persisted data on mount
  useEffect(() => {
    const loadPersistedData = async () => {
      try {
        const [savedSteps, savedEvents, savedLogs, savedActivityItems] = await Promise.all([ // Added savedActivityItems
          loadWorkflowSteps(), 
          loadEvents(), 
          loadFrontendLogs(),
          loadActivityItems() // Load activity items
        ]);
        if (savedSteps.length > 0) {
          setWorkflowSteps(savedSteps);
          console.log(`[loadPersistedData] Loaded ${savedSteps.length} workflow steps`);
        }
        if (savedEvents.length > 0) {
          setEvents(savedEvents);
          console.log(`[loadPersistedData] Loaded ${savedEvents.length} events`);
        }
        if (savedLogs.length > 0) {
          setFrontendLogs(savedLogs);
          console.log(`[loadPersistedData] Loaded ${savedLogs.length} frontend logs`);
        }
        if (savedActivityItems.length > 0) { // Set activity items state
          setActivityItems(savedActivityItems);
          console.log(`[loadPersistedData] Loaded ${savedActivityItems.length} activity items`);
        }
      } catch (err) {
        logError('[loadPersistedData] Failed to load persisted data:', err);
      }
    };
    loadPersistedData();
  }, [logError]); // logError is stable, so this runs once on mount

  // Save data when it changes
  useEffect(() => { if (workflowSteps.length > 0) saveWorkflowSteps(workflowSteps); }, [workflowSteps]);
  useEffect(() => { if (events.length > 0) saveEvents(events); }, [events]);
  useEffect(() => { if (frontendLogs.length > 0) saveFrontendLogs(frontendLogs); }, [frontendLogs]);
  useEffect(() => { if (activityItems.length > 0) saveActivityItems(activityItems); }, [activityItems]); // Save activity items when they change
  
  // Auto-dismiss error
  useEffect(() => {
    if (error) {
      setShowError(true);
      const timer = setTimeout(() => {
        setShowError(false);
        setTimeout(() => setError(null), 300); // Clear error after fade animation
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Update main status text
  const updateMainStatus = useCallback(() => {
    if (activeAnalysesCount > 0) {
      setMainStatus(`Analyzing (${activeAnalysesCount})...`);
    } else if (streamRef.current) {
      setMainStatus(videoRef.current && videoRef.current.videoWidth > 0 ? "Recording (Preview Active)" : "Recording (Video Not Ready)");
    } else {
      setMainStatus("Idle");
    }
  }, [stream, error, activeAnalysesCount, setMainStatus, videoRef, streamRef]); // Added activeAnalysesCount, streamRef, videoRef

  useEffect(() => {
    updateMainStatus();
  }, [stream, error, activeAnalysesCount, setMainStatus]);
  
  // Screen sharing and video element effects
  useEffect(() => {
    logToUI("[useEffect stream] Main effect RUNNING. Stream active:", !!stream);
    const currentVideoElement = videoRef.current;
    const onMetadataLoadedHandler = () => {
      if (!currentVideoElement) return;
      logToUI("[useEffect stream] 'loadedmetadata' - Dimensions:", { w: currentVideoElement.videoWidth, h: currentVideoElement.videoHeight });
      if (currentVideoElement.videoWidth > 0) setMainStatus("Recording (Preview Active)");
      else { setError("Video has no width after metadata loaded."); setMainStatus("Error: Video dimensions"); }
    };
    const onVideoErrorHandler = (event: globalThis.Event) => {
      if (!currentVideoElement || !stream) return;
      logError("[useEffect stream] 'error' event:", event, currentVideoElement.error);
      setError(`Video error: ${currentVideoElement.error?.message || 'Unknown'}`);
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
      setMainStatus("Error: Video stream");
    };
    const onPlayingHandler = () => { logToUI("[useEffect stream] 'playing' event."); setMainStatus("Recording (Preview Active)"); };
    const onStalledHandler = () => { logToUI("[useEffect stream] 'stalled' event."); setMainStatus("Video stalled"); };
    const onTrackEndedHandler = () => {
      logToUI("[useEffect stream] Track ended.");
      setError("Sharing stopped via browser UI.");
      handleStopScreenShare(); 
    };

    if (stream && currentVideoElement) {
      streamRef.current = stream;
      currentVideoElement.srcObject = stream;
      currentVideoElement.muted = true; 
      currentVideoElement.playsInline = true; 
      currentVideoElement.play().catch(playErr => {
          logToUI("[useEffect stream] video.play() failed:", playErr);
          let message = "Video playback error.";
          if (playErr instanceof Error) message = `Video playback error: ${playErr.message}`;
          setError(message);
          setMainStatus("Error: Video playback");
      });
      currentVideoElement.addEventListener('loadedmetadata', onMetadataLoadedHandler);
      currentVideoElement.addEventListener('error', onVideoErrorHandler);
      currentVideoElement.addEventListener('playing', onPlayingHandler);
      currentVideoElement.addEventListener('stalled', onStalledHandler);
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.addEventListener('ended', onTrackEndedHandler);
    } else if (!stream) {
        streamRef.current = null;
        setMainStatus("Idle");
    }

    return () => {
      logToUI("[useEffect stream] Cleanup. Stream active:", !!stream);
      if (currentVideoElement) {
        currentVideoElement.srcObject = null; 
      }
    };
  }, [stream, handleStopScreenShare, logToUI, logError]); 
  
  // Monitoring loop and controls
  const monitoringLoop = useCallback(() => {
    if (!streamRef.current || !videoRef.current || !autoDetectionEnabledRef.current) return;
    const video = videoRef.current;
    if (video.readyState < video.HAVE_METADATA) return; // Ensure video is ready
    
    const currentFrameData = getFrameDataForComparison(video); // Renamed for clarity
    
    if (lastFrameDataRef.current && currentFrameData) { // Ensure currentFrameData is not null
      const changePercent = calculateChangePercentage(currentFrameData, lastFrameDataRef.current, pixelDifferenceThreshold);
      currentChangePercentRef.current = changePercent;
      
      if (Math.abs(changePercent - lastDisplayChangeRef.current) > 0.1) {
        lastDisplayChangeRef.current = changePercent;
        setDisplayChangePercent(changePercent);
      }
      
      if (changePercent > changeThresholdRef.current) {
        handleActivityDetection(); // Signals activity has started or continues
        captureFrameToBuffer(changePercent); // Directly capture to buffer if change is significant
      }
    }
    
    setLastFrameData(currentFrameData); // Store the original Uint8ClampedArray
    checkForStability(); // Still useful for logging/UI cues about stability periods
  }, [
    getFrameDataForComparison, calculateChangePercentage, 
    handleActivityDetection, checkForStability, captureFrameToBuffer, // Added captureFrameToBuffer
    pixelDifferenceThreshold, changeThresholdRef, autoDetectionEnabledRef, // Added changeThresholdRef and autoDetectionEnabledRef
    setDisplayChangePercent, setLastFrameData, streamRef // Added streamRef
  ]);

  const startMonitoring = useCallback(() => {
    if (!autoDetectionEnabledRef.current || isMonitoringRef.current) return;
    isMonitoringRef.current = true;
    setIsMonitoring(true);
    logToUI("[Auto-Detection] 🔄 Monitoring started ...");
    monitoringIntervalRef.current = setInterval(monitoringLoop, monitoringFrequencyRef.current);
  }, [logToUI, monitoringLoop, monitoringFrequencyRef]);

  const stopMonitoring = useCallback(() => {
    if (monitoringIntervalRef.current) {
      clearInterval(monitoringIntervalRef.current);
      monitoringIntervalRef.current = null;
    }
    if (isMonitoringRef.current) { 
      logToUI("[Auto-Detection] ⏹️ Monitoring stopped");
      isMonitoringRef.current = false; 
    }
    setIsMonitoring(false); 
    setLastFrameData(null);
    lastFrameDataRef.current = null;
    setActivityDetected(false);
    currentChangePercentRef.current = 0;
    lastDisplayChangeRef.current = 0;
    setDisplayChangePercent(0);
  }, [logToUI]);

  // Main monitoring useEffect - Restoring this block
  useEffect(() => {
    if (stream && autoDetectionEnabled) {
      // startMonitoring is designed to be somewhat idempotent via isMonitoringRef check internally
      startMonitoring();
    } else {
      // stopMonitoring is also designed to be idempotent
      stopMonitoring();
    }
    // No explicit cleanup needed here as the conditions above handle transitions.
    // The main purpose of a cleanup would be for component unmount, 
    // but stopMonitoring would be called if stream becomes null before unmount.
    // If direct unmount while active, a general cleanup in a higher-level return could be considered,
    // but this effect covers lifecycle based on its dependencies.
  }, [stream, autoDetectionEnabled, startMonitoring, stopMonitoring]);

  // Screen sharing and video element effects - Add initial capture trigger
  const initialFrameCapturedRef = useRef(false); // Ref to ensure initial capture happens only once per stream session
  useEffect(() => {
    logToUI("[useEffect stream] Main effect RUNNING. Stream active:", !!stream);
    const currentVideoElement = videoRef.current;
    
    const onPlayingHandler = () => { 
      logToUI("[useEffect stream] 'playing' event."); 
      setMainStatus("Recording (Preview Active)");
      // Trigger initial frame capture if not already done for this stream session
      if (stream && autoDetectionEnabled && !initialFrameCapturedRef.current) {
        logToUI("[useEffect stream] Triggering initial frame capture for baseline.");
        captureFrameToBuffer(100); // High change % to ensure it gets processed by dispatcher if buffer logic changes
        initialFrameCapturedRef.current = true;
      }
    };
    // ... (rest of video event handlers and logic) ...
    if (stream && currentVideoElement) {
      // ... (existing stream setup) ...
      initialFrameCapturedRef.current = false; // Reset for new stream session
      currentVideoElement.addEventListener('playing', onPlayingHandler);
    } else if (!stream) {
        streamRef.current = null;
        setMainStatus("Idle");
        initialFrameCapturedRef.current = false; // Reset if stream stops
    }
    return () => { 
      if (currentVideoElement) {
        currentVideoElement.removeEventListener('playing', onPlayingHandler);
      }
      // Ensure other cleanup from the other useEffect for video events is also considered if this takes over all responsibility
      logToUI("[useEffect stream] Cleanup for playing handler. Stream active:", !!stream);
     }; 
  }, [stream, handleStopScreenShare, logToUI, logError, autoDetectionEnabled, captureFrameToBuffer]); // Added autoDetectionEnabled & captureFrameToBuffer

  // New functions for saving and loading ActivityItems
  const saveActivityItems = async (items: ActivityItem[]) => {
    try {
      const db = await openDB();
      const transaction = db.transaction([ACTIVITY_ITEMS_STORE], 'readwrite');
      const store = transaction.objectStore(ACTIVITY_ITEMS_STORE);
      
      await store.clear(); // Clear existing items
      for (const item of items) {
        await store.add(item); // Add new items
      }
      // console.log(`[saveActivityItems] Saved ${items.length} activity items.`);
    } catch (err) {
      console.error('[saveActivityItems] Failed to save:', err);
    }
  };

  const loadActivityItems = async (): Promise<ActivityItem[]> => {
    try {
      const db = await openDB();
      const transaction = db.transaction([ACTIVITY_ITEMS_STORE], 'readonly');
      const store = transaction.objectStore(ACTIVITY_ITEMS_STORE);
      const request = store.getAll();
      
      return new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const items = (request.result as ActivityItem[]) || [];
          // Sort by timestamp descending (newest first), using robust ID parsing
          items.sort((a, b) => {
            const idA = a.type === 'ui_diff' ? a.image2_id : a.image_id;
            const idB = b.type === 'ui_diff' ? b.image2_id : b.image_id;
            const timeA = idA ? new Date(idA.split('-diff')[0].split('-change-')[0].split('-event')[0]).getTime() : 0;
            const timeB = idB ? new Date(idB.split('-diff')[0].split('-change-')[0].split('-event')[0]).getTime() : 0;
            return timeB - timeA;
          });
          // console.log(`[loadActivityItems] Loaded ${items.length} activity items.`);
          resolve(items);
        };
      });
    } catch (err) {
      console.error('[loadActivityItems] Failed to load:', err);
      return [];
    }
  };

  // Function to handle manual initial dump request
  const handleManualInitialDump = useCallback(async () => {
    logToUI("[[VERIFY_CLICK]] Attempting manual initial dump..."); // New verification log

    if (!streamRef.current || !videoRef.current || !canvasRef.current || videoRef.current.readyState < videoRef.current.HAVE_METADATA || videoRef.current.videoWidth <= 0) {
      logError("[Manual Initial Dump] Cannot capture, stream/video not ready or canvas not available.");
      setError("Cannot manually capture for initial dump: Preview not active or ready.");
      return;
    }
    if (initialDumpInProgress) {
      logToUI("[Manual Initial Dump] Initial dump already in progress. Please wait.");
      return;
    }

    logToUI("[Manual Initial Dump] 🚀 Triggered. Capturing current view for initial dump.");
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageDataUrl = canvas.toDataURL("image/png", screenshotQuality); // Use state for quality
      const timestamp = Date.now();
      const newFrameId = `manual-dump-${new Date(timestamp).toISOString()}`;
      const newFrame: BufferedFrame = {
        id: newFrameId,
        imageDataUrl,
        timestamp,
        percentChange: 100 // Signify high importance, though not used by processInitialFrameDump directly for selection
      };

      try {
        await saveScreenshot(newFrame.id, canvas); // Save screenshot to DB
        logToUI("[Manual Initial Dump] Screenshot for manual dump saved:", newFrame.id);
      } catch (screenshotErr) {
        logError("[Manual Initial Dump] Screenshot save failed:", screenshotErr);
        // Continue with dump attempt even if screenshot save fails for some reason
      }

      processInitialFrameDump(newFrame); // Directly call processInitialFrameDump

    } else {
      logError("[Manual Initial Dump] Error: Could not get 2D context for capture.");
      setError("Failed to get canvas context for manual capture.");
    }
  }, [screenshotQuality, logToUI, logError, setError, processInitialFrameDump, initialDumpInProgress, streamRef]); // Added dependencies

  return (
    <div className="container mx-auto px-4 py-2 flex flex-col items-center min-h-screen antialiased max-w-7xl">
      {/* Header with Controls */}
      <div className="w-full max-w-7xl mb-6 flex items-center justify-between gap-4">
        {/* Left Group: Title, Subtitle, and Buttons */}
        <div className="flex items-center gap-3"> 
          <h1 className="text-2xl font-bold tracking-tight">Workflow Capture</h1>
          <p className="text-sm text-muted-foreground">Insights from your screen</p>
          {/* Button Group moved inside this left div */}
          <div className="flex items-center gap-2 pl-4"> {/* Added pl-4 for spacing from subtitle */}
            <Button 
              onClick={stream ? handleStopScreenShare : handleStartScreenShare} 
              size="default" 
              className={`w-24 ${stream ? 'bg-red-600 hover:bg-red-700 animate-pulse text-white' : ''}`}
            >
              {stream ? "Stop" : "Start"}
            </Button>
            <Button 
              onClick={handleManualInitialDump} // Changed to call handleManualInitialDump
              size="default" 
              variant="outline" 
              className="w-32" 
              disabled={!streamRef.current || activeAnalysesCount >= MAX_PARALLEL_ANALYSES || initialDumpInProgress} // Disable if stream not ready, max analyses reached or dump in progress
            >
              {initialDumpInProgress ? "Dumping..." : activeAnalysesCount >= MAX_PARALLEL_ANALYSES ? `Analyzing (${activeAnalysesCount})...` : "Capture Frame"} 
            </Button>
          </div>
        </div>
        
        {/* Right Group: Now only Status */}
        <div className={`text-sm rounded-md px-3 py-1.5 min-w-[280px] text-center bg-background flex items-center justify-between ${activeAnalysesCount > 0 ? 'text-blue-600 bg-blue-50 animate-pulse border border-blue-200' : error ? 'text-red-600 bg-red-50 border border-red-200' : 'text-muted-foreground'}`}>
          <span className="truncate">Status: {mainStatus}</span>
          {autoDetectionEnabled && (
            <span className="text-xs opacity-75 pl-2 ml-2 border-l whitespace-nowrap" style={{ minWidth: '85px' }}>
              %Ch: [{isMonitoring ? displayChangePercent.toFixed(1).padStart(3, ' ') : ' --'}]
            </span>
          )}
        </div>
      </div>

      {/* Error Overlay - Auto-dismissing */}
      {showError && error && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 transition-all duration-300 ${showError ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}>
          <Card className="bg-destructive/90 border-destructive text-white p-3 shadow-lg backdrop-blur-sm max-w-md">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">⚠ {error}</div>
              <Button onClick={dismissError} size="sm" variant="ghost" className="h-6 w-6 p-0 text-white hover:bg-white/20 ml-auto">✕</Button>
            </div>
          </Card>
        </div>
      )}
      
      {/* Hidden Canvas for capturing frames */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      
      {/* Hidden Canvas for change detection monitoring */}
      <canvas ref={monitoringCanvasRef} style={{ display: 'none' }} />

      {/* Main Content Area: Preview and Logs/Analysis */} 
      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Video Preview */} 
        <div className="lg:col-span-1">
          {stream && (
            <Card className="shadow-lg h-full">
              <CardHeader><CardTitle className="text-xl">Live Screen Preview</CardTitle></CardHeader>
              <CardContent className="aspect-video bg-slate-900 rounded-md overflow-hidden">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              </CardContent>
            </Card>
          )}
          {!stream && (
             <Card className="shadow-lg h-full flex flex-col items-center justify-center min-h-[300px] bg-slate-50">
                <CardContent><p className="text-muted-foreground">Start recording to see live preview.</p></CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Analysis, Workflow Log, Settings/Prompt, Debug Logs */} 
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Tabs defaultValue="events" className="w-full -mt-2">
            <TabsList className="grid w-full grid-cols-4 mb-1">
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="recent">Recent Activity</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="debug">Debug Logs</TabsTrigger>
            </TabsList>
            
            <TabsContent value="events" className="-mt-3">
              <Card className="shadow-sm border-0 p-0">
                <MemoizedScrollAreaContent content={memoizedEventsContent} />
              </Card>
            </TabsContent>
            
            <TabsContent value="recent" className="-mt-3">
              <Card className="shadow-sm border-0 p-0">
                <MemoizedScrollAreaContent content={memoizedActivityContent} className="h-[350px] pr-3 bg-white"/> {/* Changed bg-slate-950 to bg-white */}
              </Card>
            </TabsContent>
            
            <TabsContent value="settings" className="-mt-3">
              <Card className="shadow-sm border-0 p-0 relative">
                <div className="p-3 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Workflow Analysis Prompt</label>
                    <div className="relative">
                      <Textarea 
                        value={customPrompt} 
                        onChange={(e) => handlePromptChange(e.target.value)} 
                        placeholder="Enter analysis prompt..." 
                        className="text-xs min-h-[120px] resize-none overflow-y-scroll" 
                        style={{scrollbarWidth: 'thin'}}
                        disabled={!!stream && activeAnalysesCount > 0} 
                      />
                      {promptSaveStatus !== 'idle' && (
                        <div className={`absolute top-2 right-2 px-3 py-1 rounded-md text-xs font-medium transition-all duration-300 ${promptSaveStatus === 'saving' ? 'bg-blue-100 text-blue-700 animate-pulse' : 'bg-green-100 text-green-700'}`}>
                          {promptSaveStatus === 'saving' ? 'Saving...' : 'Saved!'}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">Events Summary Prompt</label>
                    <div className="p-2 bg-muted rounded-md">
                      <code className="text-xs text-foreground">{eventsPrompt}</code>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Uses model: {EVENTS_MODEL_NAME}</p>
                  </div>

                  <div className="border-t pt-3">
                    <h3 className="text-xs font-medium text-foreground mb-3">Auto-Detection Settings</h3>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">Enable Auto-Detection</label>
                        <button 
                          onClick={() => setAutoDetectionEnabled(!autoDetectionEnabled)}
                          className={`w-10 h-6 rounded-full transition-colors ${autoDetectionEnabled ? 'bg-primary' : 'bg-muted'}`}>
                          <div className={`w-4 h-4 rounded-full bg-white transition-transform ${autoDetectionEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Monitoring Frequency: {monitoringFrequency}ms</label>
                        <input type="range" min="100" max="1000" step="100" value={monitoringFrequency} onChange={(e) => setMonitoringFrequency(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>100ms</span><span>1000ms</span></div>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Change Threshold: {changeThreshold}%</label>
                        <input type="range" min="0.5" max="5" step="0.5" value={changeThreshold} onChange={(e) => setChangeThreshold(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>0.5%</span><span>5%</span></div>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Stability Delay: {stabilityDelay / 1000}s</label>
                        <input type="range" min="1000" max="10000" step="1000" value={stabilityDelay} onChange={(e) => setStabilityDelay(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>1s</span><span>10s</span></div>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Screenshot Quality: {Math.round(screenshotQuality * 100)}%</label>
                        <input type="range" min="0.1" max="1" step="0.1" value={screenshotQuality} onChange={(e) => setScreenshotQuality(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>10%</span><span>100%</span></div>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Max Screenshots (DB): {maxScreenshots}</label> {/* Clarified label */}
                        <input type="range" min="10" max="200" step="10" value={maxScreenshots} onChange={(e) => setMaxScreenshots(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>10</span><span>200</span></div>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Pixel Difference Threshold: {pixelDifferenceThreshold}</label>
                        <input type="range" min="0" max="255" step="1" value={pixelDifferenceThreshold} onChange={(e) => setPixelDifferenceThreshold(Number(e.target.value))} className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer" />
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-1"><span>0</span><span>255</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </TabsContent>
            
            <TabsContent value="debug" className="-mt-3">
              <Card className="shadow-sm border-0 p-0 relative">
                <Button onClick={copyLogsToClipboard} size="sm" variant={copyStatus === 'copied' ? 'default' : 'outline'} className={`absolute top-3 right-3 h-7 text-xs z-10 transition-all duration-200 ${copyStatus === 'copied' ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}>
                  {copyStatus === 'copied' ? '✓ Copied' : 'Copy'}
                </Button>
                <MemoizedDebugLogsScrollArea logs={frontendLogs} />
                <Button onClick={clearAllData} size="sm" variant="destructive" className="absolute bottom-3 right-3 h-7 text-xs z-10">
                  Erase All Data
                </Button>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
