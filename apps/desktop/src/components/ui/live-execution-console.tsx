import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { X, Play, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface SchedulerEvent {
  event_type: string;
  workflow_id: string;
  workflow_name: string;
  message: string;
  timestamp: string;
}

interface SchedulerStepEvent {
  event_type: string; // "step_started", "step_completed", "step_failed", "progress"
  workflow_id: string;
  workflow_name: string;
  step_index: number | null;
  step_name: string | null;
  total_steps: number | null;
  duration_ms: number | null;
  message: string | null;
  error: string | null;
  progress_current: number | null;
  progress_total: number | null;
  timestamp: string;
}

interface StepLog {
  type: "started" | "completed" | "failed" | "progress";
  stepName: string;
  stepIndex?: number;
  totalSteps?: number;
  durationMs?: number;
  error?: string;
  message?: string;
  timestamp: Date;
}

interface ExecutionState {
  workflowId: string;
  workflowName: string;
  status: "running" | "completed" | "failed";
  startTime: Date;
  endTime?: Date;
  currentStep?: number;
  totalSteps?: number;
  currentStepName?: string;
  steps: StepLog[];
  error?: string;
}

export function LiveExecutionConsole() {
  const [executions, setExecutions] = useState<Map<string, ExecutionState>>(new Map());
  const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set());
  const [dismissedExecutions, setDismissedExecutions] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((workflowId: string) => {
    setExpandedExecutions(prev => {
      const next = new Set(prev);
      if (next.has(workflowId)) {
        next.delete(workflowId);
      } else {
        next.add(workflowId);
      }
      return next;
    });
  }, []);

  const dismissExecution = useCallback((workflowId: string) => {
    setDismissedExecutions(prev => new Set(prev).add(workflowId));
    // Clean up after animation
    setTimeout(() => {
      setExecutions(prev => {
        const next = new Map(prev);
        next.delete(workflowId);
        return next;
      });
      setDismissedExecutions(prev => {
        const next = new Set(prev);
        next.delete(workflowId);
        return next;
      });
    }, 300);
  }, []);

  useEffect(() => {
    let unlistenExecuting: (() => void) | undefined;
    let unlistenCompleted: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;
    let unlistenStepProgress: (() => void) | undefined;

    const setup = async () => {
      // Listen for workflow execution start
      unlistenExecuting = await listen<SchedulerEvent>("scheduler:workflow_executing", event => {
        const { workflow_id, workflow_name, timestamp } = event.payload;
        console.log(`🚀 [LIVE-CONSOLE] Workflow executing: ${workflow_name}`);

        setExecutions(prev => {
          const next = new Map(prev);
          next.set(workflow_id, {
            workflowId: workflow_id,
            workflowName: workflow_name,
            status: "running",
            startTime: new Date(timestamp),
            steps: [],
          });
          return next;
        });
        // Auto-expand new executions
        setExpandedExecutions(prev => new Set(prev).add(workflow_id));
      });

      // Listen for workflow completion
      unlistenCompleted = await listen<SchedulerEvent>("scheduler:workflow_completed", event => {
        const { workflow_id, timestamp } = event.payload;
        console.log(`✅ [LIVE-CONSOLE] Workflow completed: ${workflow_id}`);

        setExecutions(prev => {
          const next = new Map(prev);
          const existing = next.get(workflow_id);
          if (existing) {
            next.set(workflow_id, {
              ...existing,
              status: "completed",
              endTime: new Date(timestamp),
            });
          }
          return next;
        });
      });

      // Listen for workflow failure
      unlistenFailed = await listen<SchedulerEvent>("scheduler:workflow_failed", event => {
        const { workflow_id, message, timestamp } = event.payload;
        console.log(`❌ [LIVE-CONSOLE] Workflow failed: ${workflow_id}`);

        setExecutions(prev => {
          const next = new Map(prev);
          const existing = next.get(workflow_id);
          if (existing) {
            next.set(workflow_id, {
              ...existing,
              status: "failed",
              endTime: new Date(timestamp),
              error: message,
            });
          }
          return next;
        });
      });

      // Listen for step-level progress
      unlistenStepProgress = await listen<SchedulerStepEvent>("scheduler:step_progress", event => {
        const { event_type, workflow_id, step_index, step_name, total_steps, duration_ms, error, message, timestamp } =
          event.payload;

        console.log(`📍 [LIVE-CONSOLE] Step event: ${event_type} - ${step_name || "unknown"}`);

        setExecutions(prev => {
          const next = new Map(prev);
          const existing = next.get(workflow_id);
          if (!existing) return prev;

          const newStep: StepLog = {
            type: event_type as StepLog["type"],
            stepName: step_name || "Unknown step",
            stepIndex: step_index ?? undefined,
            totalSteps: total_steps ?? undefined,
            durationMs: duration_ms ?? undefined,
            error: error ?? undefined,
            message: message ?? undefined,
            timestamp: new Date(timestamp),
          };

          const updatedExecution: ExecutionState = {
            ...existing,
            steps: [...existing.steps, newStep],
          };

          // Update current step info
          if (event_type === "step_started" && step_index != null) {
            updatedExecution.currentStep = step_index;
            updatedExecution.currentStepName = step_name ?? undefined;
            if (total_steps != null) {
              updatedExecution.totalSteps = total_steps;
            }
          }

          next.set(workflow_id, updatedExecution);
          return next;
        });
      });
    };

    setup();

    return () => {
      unlistenExecuting?.();
      unlistenCompleted?.();
      unlistenFailed?.();
      unlistenStepProgress?.();
    };
  }, []);

  // Filter out dismissed executions
  const visibleExecutions = Array.from(executions.entries()).filter(([id]) => !dismissedExecutions.has(id));

  if (visibleExecutions.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      {visibleExecutions.map(([id, execution]) => (
        <ExecutionCard
          key={id}
          execution={execution}
          isExpanded={expandedExecutions.has(id)}
          onToggleExpand={() => toggleExpanded(id)}
          onDismiss={() => dismissExecution(id)}
          isDismissing={dismissedExecutions.has(id)}
        />
      ))}
    </div>
  );
}

interface ExecutionCardProps {
  execution: ExecutionState;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDismiss: () => void;
  isDismissing: boolean;
}

function ExecutionCard({ execution, isExpanded, onToggleExpand, onDismiss, isDismissing }: ExecutionCardProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  // Update elapsed time for running executions
  useEffect(() => {
    if (execution.status !== "running") return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - execution.startTime.getTime()) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [execution.status, execution.startTime]);

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const totalDuration = execution.endTime
    ? Math.floor((execution.endTime.getTime() - execution.startTime.getTime()) / 1000)
    : elapsedTime;

  const progress =
    execution.totalSteps && execution.currentStep
      ? Math.round((execution.currentStep / execution.totalSteps) * 100)
      : 0;

  const statusColors = {
    running: "border-border bg-background",
    completed: "border-border bg-background",
    failed: "border-border bg-background",
  };

  const statusIcons = {
    running: <Loader2 className="h-4 w-4 animate-spin text-foreground" />,
    completed: <CheckCircle2 className="h-4 w-4 text-foreground" />,
    failed: <XCircle className="h-4 w-4 text-foreground" />,
  };

  // Get recent steps for display
  const recentSteps = execution.steps.slice(-5);

  return (
    <div
      className={cn(
        "rounded-lg border shadow-lg transition-all duration-300 backdrop-blur-sm",
        statusColors[execution.status],
        isDismissing && "opacity-0 translate-x-full"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={onToggleExpand}>
        {statusIcons[execution.status]}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{execution.workflowName}</span>
            <span className="text-xs text-muted-foreground">{formatDuration(totalDuration)}</span>
          </div>
          {execution.status === "running" && execution.currentStepName && (
            <div className="text-xs text-muted-foreground truncate">
              {execution.currentStep}/{execution.totalSteps}: {execution.currentStepName}
            </div>
          )}
          {execution.status === "completed" && (
            <div className="text-xs text-muted-foreground">
              Completed {execution.steps.filter(s => s.type === "completed").length} steps
            </div>
          )}
          {execution.status === "failed" && execution.error && (
            <div className="text-xs text-muted-foreground truncate">{execution.error}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <button
            onClick={e => {
              e.stopPropagation();
              onDismiss();
            }}
            className="p-1 hover:bg-muted rounded"
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Progress bar for running */}
      {execution.status === "running" && execution.totalSteps && (
        <div className="px-3 pb-2">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-foreground transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Expanded step logs */}
      {isExpanded && recentSteps.length > 0 && (
        <div className="px-3 pb-3 space-y-1 max-h-48 overflow-y-auto border-t border-border">
          <div className="pt-2">
            {recentSteps.map((step, i) => (
              <div key={i} className="flex items-start gap-2 text-xs py-1">
                <span className="text-muted-foreground w-16 flex-shrink-0">
                  {step.timestamp.toLocaleTimeString("en-US", {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span
                  className={cn(
                    "flex-shrink-0",
                    step.type === "started" && "text-muted-foreground",
                    step.type === "completed" && "text-foreground",
                    step.type === "failed" && "text-foreground",
                    step.type === "progress" && "text-muted-foreground"
                  )}
                >
                  {step.type === "started" && "▸"}
                  {step.type === "completed" && "✓"}
                  {step.type === "failed" && "✗"}
                  {step.type === "progress" && "◆"}
                </span>
                <span className="flex-1 truncate">
                  {step.stepName}
                  {step.durationMs != null && <span className="text-muted-foreground ml-1">[{step.durationMs}ms]</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
