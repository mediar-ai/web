import { useEffect, useState, useRef } from "react";

interface WorkflowProgress {
  current?: number;
  total?: number;
  message?: string;
  stepName?: string;
  timestamp: number;
}

interface WorkflowProgressIndicatorProps {
  isExecuting: boolean;
  /** Optional loading status for basic AI chat (no workflow progress events) */
  loadingStatus?: {
    phase: string;
    detail: string;
    startTime: number;
  } | null;
}

export function WorkflowProgressIndicator({ isExecuting, loadingStatus }: WorkflowProgressIndicatorProps) {
  const [progress, setProgress] = useState<WorkflowProgress | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  // Reset on execution start
  useEffect(() => {
    if (isExecuting) {
      startTimeRef.current = loadingStatus?.startTime || Date.now();
      setProgress(null);
      setElapsedMs(0);
    }
  }, [isExecuting, loadingStatus?.startTime]);

  // Update elapsed time continuously while executing
  useEffect(() => {
    if (!isExecuting) return;

    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);

    return () => clearInterval(interval);
  }, [isExecuting]);

  // Listen for progress events
  useEffect(() => {
    if (!isExecuting) return;

    const handleProgress = (e: CustomEvent<WorkflowProgress>) => {
      console.log("📊 [PROGRESS-INDICATOR] Received workflow-progress event:", e.detail);
      setProgress(e.detail);
    };

    const handleStepStarted = (e: CustomEvent<{ stepIndex: number; stepName: string; totalSteps?: number }>) => {
      console.log("📊 [PROGRESS-INDICATOR] Received workflow-step-started event:", e.detail);
      setProgress(prev => ({
        ...prev,
        current: e.detail.stepIndex + 1,
        total: e.detail.totalSteps,
        stepName: e.detail.stepName,
        timestamp: Date.now(),
      }));
    };

    window.addEventListener("workflow-progress", handleProgress as EventListener);
    window.addEventListener("workflow-step-started", handleStepStarted as EventListener);

    return () => {
      window.removeEventListener("workflow-progress", handleProgress as EventListener);
      window.removeEventListener("workflow-step-started", handleStepStarted as EventListener);
    };
  }, [isExecuting]);

  // Don't render if not executing
  if (!isExecuting) return null;

  const formatElapsedTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return `${seconds}.${tenths}s`;
  };

  const hasProgress = progress?.current !== undefined && progress?.total !== undefined;
  const percentage = hasProgress ? Math.round((progress.current! / progress.total!) * 100) : null;

  // Determine what to show:
  // 1. If we have workflow progress with steps -> show progress bar
  // 2. If we have progress message only -> show message
  // 3. If we have loadingStatus -> show that
  // 4. Fallback -> show basic "Running..."

  const displayMessage = progress?.message || loadingStatus?.detail || "Running...";
  const showProgressBar = hasProgress;

  return (
    <div className="px-4 py-3 mx-auto max-w-3xl w-full">
      <div className="bg-white border border-black rounded-2xl px-4 py-3 shadow-sm">
        {/* Header with step info */}
        <div className={`flex items-center justify-between ${showProgressBar ? "mb-2" : ""}`}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex gap-1 shrink-0">
              <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 bg-black rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            {hasProgress ? (
              <>
                <span className="text-xs font-medium text-black shrink-0">
                  Step {progress.current} of {progress.total}
                </span>
                {progress.stepName && <span className="text-xs text-gray-500 truncate">{progress.stepName}</span>}
              </>
            ) : (
              <span className="text-xs text-black truncate">{displayMessage}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-gray-500 font-mono">{formatElapsedTime(elapsedMs)}</span>
          </div>
        </div>

        {/* Progress bar - only when we have step progress */}
        {showProgressBar && (
          <div className="mb-2">
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-black rounded-full transition-all duration-300 ease-out"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        )}

        {/* Message below progress bar */}
        {showProgressBar && progress?.message && (
          <div className="text-xs text-gray-600 truncate">{progress.message}</div>
        )}
      </div>
    </div>
  );
}
