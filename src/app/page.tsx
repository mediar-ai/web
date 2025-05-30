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
const DB_VERSION = 3; // Incremented to add screenshots store
const WORKFLOW_STORE = 'workflowSteps';
const LOGS_STORE = 'frontendLogs';
const EVENTS_STORE = 'events';
const SCREENSHOTS_STORE = 'screenshots';
const MAX_SCREENSHOTS = 50; // Keep only last 50 screenshots

// Stable style object for ScrollAreas, defined globally for the module
const scrollAreaStyle = { overflow: 'scroll', scrollbarWidth: 'thin' } as const;

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
    const transaction = db.transaction([WORKFLOW_STORE, LOGS_STORE, EVENTS_STORE, SCREENSHOTS_STORE], 'readwrite');
    await transaction.objectStore(WORKFLOW_STORE).clear();
    await transaction.objectStore(LOGS_STORE).clear();
    await transaction.objectStore(EVENTS_STORE).clear();
    await transaction.objectStore(SCREENSHOTS_STORE).clear();
  } catch (err) {
    console.error('[clearPersistedData] Failed to clear:', err);
  }
};

// interface ProcessedInsights { // No longer using this specific structure for display
//   guessedApplication?: string;
//   keywords?: string[];
// }

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

const saveEvents = async (events: Array<{id: string, summary: string, timestamp: string}>) => {
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
        // Sort by timestamp descending (newest first)
        events.sort((a, b) => new Date(b.id).getTime() - new Date(a.id).getTime());
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
  const [stabilityDelay, setStabilityDelay] = useState<number>(3000); // ms
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
  const [isProcessingFrame, setIsProcessingFrame] = useState(false); // More specific than isProcessing
  const [workflowSteps, setWorkflowSteps] = useState<Array<{id: string, analysis: string, parsed: ParsedAnalysis | null, timestamp: string}>>([]); // Added parsed field
  const [events, setEvents] = useState<Array<{id: string, summary: string, timestamp: string}>>([]); // New events state
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

  // 2. Analysis parsing
  const parseAnalysis = useCallback((analysisText: string): ParsedAnalysis | null => {
    try {
      const lines = analysisText.split('\n').filter(line => line.trim());
      const parsed: Partial<ParsedAnalysis> = {};
      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const key = line.substring(0, colonIndex).trim().toLowerCase();
        const value = line.substring(colonIndex + 1).trim();
        if (key.includes('workflow_name') || key.includes('workflow')) parsed.workflow = value;
        else if (key.includes('step_name') || key === 'step') parsed.step = value;
        else if (key.includes('step_description') || key === 'description') parsed.description = value;
        else if (key.includes('step_facts') || key === 'facts') parsed.facts = value;
        else if (key.includes('step_logic') || key === 'logic') parsed.logic = value;
        else if (key.includes('step_metadata') || key === 'metadata' || key === 'tech') parsed.tech = value;
        else if (key.includes('opened_apps')) parsed.apps = value;
        else if (key.includes('tab_name_url_filename_chatname_etc')) parsed.context = value;
      }
      if (Object.keys(parsed).length > 0) {
        return {
          workflow: parsed.workflow || 'Unknown',
          step: parsed.step || 'Unknown',
          description: parsed.description || 'No description',
          facts: parsed.facts || 'No facts',
          logic: parsed.logic || 'No logic',
          tech: parsed.tech || 'No tech info',
          apps: parsed.apps || 'No apps',
          context: parsed.context || 'No context'
        };
      }
      return null;
    } catch (err) {
      logError("[parseAnalysis] Error parsing analysis:", err);
      return null;
    }
  }, [logError]);

  // 3. Core capture and analysis function
  const captureFrameAndSend = useCallback(async () => {
    if (!stream) {
      setError("Screen sharing is not active."); setMainStatus("Error: Share not active"); return;
    }
    if (isProcessingFrame) return;
    if (videoRef.current && canvasRef.current && videoRef.current.readyState >= videoRef.current.HAVE_METADATA && videoRef.current.videoWidth > 0) {
      setIsProcessingFrame(true); setMainStatus("Capturing frame..."); setError(null); 
      logToUI("[captureFrameAndSend] 🎯 Frame capture triggered - Change:", currentChangePercentRef.current.toFixed(2) + "%");
      const video = videoRef.current; const canvas = canvasRef.current;
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      }
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataUrl = canvas.toDataURL("image/png", screenshotQuality); // Use state for quality
        
        const screenshotId = new Date().toISOString();
        try {
          await saveScreenshot(screenshotId, canvas); // saveScreenshot uses its own quality param for blob
          logToUI("[captureFrameAndSend] Screenshot saved with ID:", screenshotId);
        } catch (screenshotErr) {
          logError("[captureFrameAndSend] Screenshot save failed:", screenshotErr);
        }
        
        const historyForPrompt = workflowSteps.map(step => step.analysis).slice(-5).reverse();
        logToUI("[captureFrameAndSend] Sending frame for analysis. History items:", historyForPrompt.length);
        
        setMainStatus("Sending to Gemini AI...");
        try {
          const response = await fetch("/api/capture", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: imageDataUrl, timestamp: new Date().toISOString(), prompt: customPrompt, history: historyForPrompt }),
          });
          
          setMainStatus("Processing AI response...");
          const result = await response.json();
          if (!response.ok) {
            logError("[captureFrameAndSend] Backend error:", result);
            setError(`Analysis failed: ${result.error || 'Unknown error'} (Details: ${result.details || 'N/A'})`);
          } else {
            const newAnalysis = result.analysis || "No analysis text returned.";
            const parsedAnalysis = parseAnalysis(newAnalysis);
            logToUI("[captureFrameAndSend] Analysis received:", newAnalysis.substring(0, 50) + "...");
            logToUI("[captureFrameAndSend] Parsed fields:", parsedAnalysis ? Object.keys(parsedAnalysis).length : 0);
            setError(null);
            setMainStatus("Generating event summary...");
            setWorkflowSteps(prevSteps => [{ 
              id: new Date().toISOString(), 
              analysis: newAnalysis, 
              parsed: parsedAnalysis,
              timestamp: new Date().toLocaleTimeString() 
            }, ...prevSteps].slice(0, 10)); 
            
            try {
              const eventHistory = events.map(event => event.summary).slice(-3);
              const eventsResponse = await fetch("/api/capture", {
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                  analysisText: newAnalysis, 
                  prompt: eventsPrompt, 
                  model: EVENTS_MODEL_NAME,
                  history: eventHistory,
                  isEventsSummary: true
                }),
              });
              
              const eventsResult = await eventsResponse.json();
              if (eventsResponse.ok) {
                const eventSummary = eventsResult.analysis || "No event summary generated.";
                logToUI("[captureFrameAndSend] Event summary received:", eventSummary);
                setEvents(prevEvents => [{
                  id: new Date().toISOString(),
                  summary: eventSummary,
                  timestamp: new Date().toLocaleTimeString()
                }, ...prevEvents].slice(0, 20));
                setMainStatus("Analysis complete!");
              } else {
                logError("[captureFrameAndSend] Events API error:", eventsResult);
                setMainStatus("Analysis complete (events failed)!");
              }
            } catch (eventsErr) {
              logError("[captureFrameAndSend] Events network error:", eventsErr);
              setMainStatus("Analysis complete (events failed)!");
            }
            
            setTimeout(() => {
              setMainStatus(stream ? "Recording (Preview Active)" : "Idle");
            }, 1500);
          }
        } catch (err) { 
          let errorMessage = "Network error during analysis.";
          if (err instanceof Error) errorMessage = err.message;
          logError("[captureFrameAndSend] Network error:", errorMessage, err);
          setError(errorMessage);
          setMainStatus("Error during analysis");
        }
      } else {
        logError("[captureFrameAndSend] Error: Could not get 2D context.");
        setError("Failed to capture frame from video context.");
        setMainStatus("Error: Canvas context");
      }
      setIsProcessingFrame(false);
    } else {
       if (stream && videoRef.current) {
           logToUI("[captureFrameAndSend] Video not ready for capture. State:", { readyState: videoRef.current.readyState, videoWidth: videoRef.current.videoWidth });
           setError("Video not ready. Ensure preview is active.");
       }
       setMainStatus(stream ? "Recording (Video Not Ready)" : "Idle");
    }
  }, [stream, isProcessingFrame, customPrompt, workflowSteps, events, eventsPrompt, EVENTS_MODEL_NAME, screenshotQuality, logToUI, logError, parseAnalysis, currentChangePercentRef, setError, setMainStatus, setIsProcessingFrame, setWorkflowSteps, setEvents]);

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
    const now = Date.now();
    setLastActivityTime(now); 
    if (!activityDetectedRef.current) { 
      setActivityDetected(true); 
      logToUI("[Auto-Detection] 🟡 Activity period started - Change:", currentChangePercentRef.current.toFixed(2) + "%");
    }
  }, [logToUI, currentChangePercentRef, setLastActivityTime, setActivityDetected]);

  const checkForStability = useCallback(() => {
    const now = Date.now();
    if (activityDetectedRef.current && (now - lastActivityTimeRef.current > stabilityDelayRef.current)) {
      setActivityDetected(false); 
      logToUI("[Auto-Detection] 🟢 Stability detected after", Math.round((now - lastActivityTimeRef.current) / 1000) + "s - Triggering analysis");
      captureFrameAndSend();
    }
  }, [logToUI, captureFrameAndSend, setActivityDetected]);
 
  // 5. Memoized UI content
  const memoizedEventsContent = useMemo(() => {
    return events.length > 0 ? (
      <div className="relative">
        <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-border"></div>
        {events.slice(0, 10).map((event) => (
          <div key={event.id} className="relative flex items-center gap-3 pb-3">
            <div className="relative z-10 w-4 h-4 bg-primary rounded-full border-2 border-background flex-shrink-0"></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
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

  const memoizedWorkflowStepsContent = useMemo(() => {
    return workflowSteps.length > 0 ? (
      <ul className="space-y-4">
        {workflowSteps.slice(0, 10).map(step => (
          <li key={step.id} className="p-4 border rounded-md bg-background">
            <p className="font-medium text-muted-foreground text-[10px] mb-3">{step.timestamp}</p>
            {step.parsed ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2">
                  <div><span className="font-semibold text-blue-600">Workflow:</span> <span className="text-foreground">{step.parsed.workflow}</span></div>
                  <div><span className="font-semibold text-green-600">Step:</span> <span className="text-foreground">{step.parsed.step}</span></div>
                  <div><span className="font-semibold text-purple-600">Description:</span> <span className="text-foreground">{step.parsed.description}</span></div>
                  <div><span className="font-semibold text-orange-600">Facts:</span> <span className="text-foreground">{step.parsed.facts}</span></div>
                  <div><span className="font-semibold text-cyan-600">Logic:</span> <span className="text-foreground">{step.parsed.logic}</span></div>
                  <div><span className="font-semibold text-red-600">Tech:</span> <span className="text-foreground">{step.parsed.tech}</span></div>
                  <div><span className="font-semibold text-yellow-600">Apps:</span> <span className="text-foreground">{step.parsed.apps}</span></div>
                  <div><span className="font-semibold text-gray-600">Context:</span> <span className="text-foreground">{step.parsed.context}</span></div>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground italic">Raw: {step.analysis}</p>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-muted-foreground italic p-8 text-center">No workflow steps captured yet. Start recording to see activity.</p>
    );
  }, [workflowSteps]);

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
    setIsProcessingFrame(false);
    setMainStatus("Idle");
  }, [stream, logToUI]);

  const handleStartScreenShare = useCallback(async () => {
    logToUI("[handleStartScreenShare] Attempting start...");
    setError(null);
    if (streamRef.current || stream) {
      const currentStream = streamRef.current || stream;
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    }
    setStream(null);
    streamRef.current = null;
    setIsProcessingFrame(false);
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
        const [savedSteps, savedEvents, savedLogs] = await Promise.all([loadWorkflowSteps(), loadEvents(), loadFrontendLogs()]);
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
    if (isProcessingFrame) { return; } // Handled by captureFrameAndSend
    if (error) { return; } // Handled by error effect or captureFrameAndSend
    if (stream) { setMainStatus("Recording"); }
    else { setMainStatus("Idle"); }
  }, [stream, error, isProcessingFrame]);

  useEffect(() => {
    updateMainStatus();
  }, [stream, error, isProcessingFrame, updateMainStatus]);
  
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
    const onVideoErrorHandler = (event: Event) => {
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
    
    const currentFrame = getFrameDataForComparison(video);
    
    if (lastFrameDataRef.current) {
      const changePercent = calculateChangePercentage(currentFrame, lastFrameDataRef.current, pixelDifferenceThreshold);
      currentChangePercentRef.current = changePercent;
      
      if (Math.abs(changePercent - lastDisplayChangeRef.current) > 0.1) {
        lastDisplayChangeRef.current = changePercent;
        setDisplayChangePercent(changePercent);
      }
      
      if (changePercent > changeThresholdRef.current) {
        handleActivityDetection();
      }
    }
    
    setLastFrameData(currentFrame);
    checkForStability();
  }, [
    autoDetectionEnabledRef, changeThresholdRef, // These are stable refs updated by their own useEffects
    getFrameDataForComparison, calculateChangePercentage, 
    handleActivityDetection, checkForStability, // These are stable callbacks
    setDisplayChangePercent, setLastFrameData, // These are stable state setters
    pixelDifferenceThreshold // This is a new state
  ]);

  const startMonitoring = useCallback(() => {
    if (!autoDetectionEnabledRef.current || isMonitoringRef.current) return;
    isMonitoringRef.current = true;
    setIsMonitoring(true);
    logToUI("[Auto-Detection] 🔄 Monitoring started ...");
    monitoringIntervalRef.current = setInterval(monitoringLoop, monitoringFrequencyRef.current);
  }, [logToUI, monitoringLoop, monitoringFrequencyRef]); // isMonitoringRef is stable

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
  }, [logToUI]); // isMonitoringRef is stable

  // Main monitoring useEffect
  useEffect(() => {
    if (streamRef.current && autoDetectionEnabledRef.current) {
      startMonitoring();
    } else {
      if (isMonitoringRef.current) { 
        stopMonitoring();
      }
    }
    return () => {
      if (isMonitoringRef.current) { 
         stopMonitoring();
      }
    };
  }, [stream, autoDetectionEnabled, startMonitoring, stopMonitoring]); // autoDetectionEnabled is a direct dep

  return (
    <div className="container mx-auto px-4 py-2 flex flex-col items-center min-h-screen antialiased max-w-7xl">
      {/* Header with Controls - All in one line */}
      <div className="w-full max-w-7xl mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Workflow Capture</h1>
          <p className="text-sm text-muted-foreground">Insights from your screen</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button 
              onClick={stream ? handleStopScreenShare : handleStartScreenShare} 
              size="default" 
              className={`w-24 ${stream ? 'bg-red-600 hover:bg-red-700 animate-pulse text-white' : ''}`}
            >
              {stream ? "Stop" : "Start"}
            </Button>
            <Button onClick={captureFrameAndSend} size="default" variant="outline" className="w-32" disabled={!stream || isProcessingFrame}>
              {isProcessingFrame ? "Analyzing..." : "Analyze"}
            </Button>
          </div>
          <div className={`text-sm rounded-md px-3 py-1.5 min-w-[280px] text-center bg-background flex items-center justify-between ${isProcessingFrame ? 'text-blue-600 bg-blue-50 animate-pulse border border-blue-200' : error ? 'text-red-600 bg-red-50 border border-red-200' : 'text-muted-foreground'}`}>
            <span className="truncate">Status: {mainStatus}</span>
            {autoDetectionEnabled && (
              <span className="text-xs opacity-75 pl-2 ml-2 border-l whitespace-nowrap" style={{ minWidth: '85px' }}>
                %Ch: [{isMonitoring ? displayChangePercent.toFixed(1).padStart(3, ' ') : ' --'}]
              </span>
            )}
          </div>
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
                <MemoizedScrollAreaContent content={memoizedWorkflowStepsContent} />
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
                        disabled={!!stream && isProcessingFrame} 
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
                <Button onClick={clearAllData} size="sm" variant="destructive" className="absolute bottom-3 right-3 h-7 text-xs">
                  Permanently Erase All Data
                </Button>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
