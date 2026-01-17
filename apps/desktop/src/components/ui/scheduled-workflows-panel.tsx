import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Clock,
  Play,
  Pause,
  Trash2,
  Calendar,
  RefreshCw,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { describeCron } from "./cron-builder";
import type { ScheduledWorkflow } from "./scheduler-dialog";

interface ScheduledWorkflowsPanelProps {
  className?: string;
  onWorkflowClick?: (workflowId: string) => void;
}

interface SchedulerEvent {
  event_type: string;
  workflow_id: string;
  workflow_name: string;
  message: string;
  timestamp: string;
}

export function ScheduledWorkflowsPanel({ className, onWorkflowClick }: ScheduledWorkflowsPanelProps) {
  const [workflows, setWorkflows] = useState<ScheduledWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<string>>(new Set());
  const [recentEvents, setRecentEvents] = useState<SchedulerEvent[]>([]);

  const loadWorkflows = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await invoke<ScheduledWorkflow[]>("get_scheduled_workflows");
      setWorkflows(result);
    } catch (err) {
      console.error("Failed to load scheduled workflows:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load workflows on mount
  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  // Listen for scheduler events
  useEffect(() => {
    const unlistenExecuting = listen<SchedulerEvent>("scheduler:workflow_executing", event => {
      setExecutingWorkflows(prev => new Set(prev).add(event.payload.workflow_id));
      setRecentEvents(prev => [event.payload, ...prev].slice(0, 5));
    });

    const unlistenCompleted = listen<SchedulerEvent>("scheduler:workflow_completed", event => {
      setExecutingWorkflows(prev => {
        const next = new Set(prev);
        next.delete(event.payload.workflow_id);
        return next;
      });
      setRecentEvents(prev => [event.payload, ...prev].slice(0, 5));
      loadWorkflows(); // Refresh to get updated execution count
    });

    const unlistenFailed = listen<SchedulerEvent>("scheduler:workflow_failed", event => {
      setExecutingWorkflows(prev => {
        const next = new Set(prev);
        next.delete(event.payload.workflow_id);
        return next;
      });
      setRecentEvents(prev => [event.payload, ...prev].slice(0, 5));
      loadWorkflows();
    });

    return () => {
      unlistenExecuting.then(fn => fn());
      unlistenCompleted.then(fn => fn());
      unlistenFailed.then(fn => fn());
    };
  }, [loadWorkflows]);

  const handleToggleEnabled = async (workflow: ScheduledWorkflow) => {
    try {
      await invoke("set_workflow_schedule_enabled", {
        workflowId: workflow.workflow_id,
        workflowPath: workflow.workflow_path,
        enabled: !workflow.enabled,
      });
      loadWorkflows();
    } catch (err) {
      console.error("Failed to toggle workflow:", err);
    }
  };

  const handleRemoveSchedule = async (workflow: ScheduledWorkflow) => {
    try {
      await invoke("unschedule_workflow", {
        workflowId: workflow.workflow_id,
        workflowPath: workflow.workflow_path,
      });
      loadWorkflows();
    } catch (err) {
      console.error("Failed to remove schedule:", err);
    }
  };

  const getStatusIcon = (workflow: ScheduledWorkflow) => {
    if (executingWorkflows.has(workflow.workflow_id)) {
      return (
        <RefreshCw className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white animate-spin" />
      );
    }
    if (!workflow.enabled) {
      return <Pause className="w-4 h-4 text-yellow-600" />;
    }
    return <Play className="w-4 h-4 text-green-600" />;
  };

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "workflow_executing":
        return <RefreshCw className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />;
      case "workflow_completed":
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case "workflow_failed":
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return <AlertCircle className="w-4 h-4 [.theme-classic_&]:text-black/50 [.theme-inverted_&]:text-white/50" />;
    }
  };

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-8", className)}>
        <RefreshCw className="w-6 h-6 animate-spin [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "p-4 rounded-lg",
          "[.theme-classic_&]:bg-red-50 [.theme-classic_&]:text-red-700",
          "[.theme-inverted_&]:bg-red-900/20 [.theme-inverted_&]:text-red-300",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          <span>Failed to load scheduled workflows: {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          <h3 className={cn("font-semibold", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}>
            Scheduled Workflows
          </h3>
          <span
            className={cn(
              "text-sm px-2 py-0.5 rounded-full border",
              "[.theme-classic_&]:border-black [.theme-classic_&]:bg-black/5 [.theme-classic_&]:text-black",
              "[.theme-inverted_&]:border-white [.theme-inverted_&]:bg-white/5 [.theme-inverted_&]:text-white"
            )}
          >
            {workflows.length}
          </span>
        </div>
        <button
          onClick={loadWorkflows}
          className={cn(
            "p-2 rounded-lg border border-transparent transition-colors",
            "[.theme-classic_&]:hover:bg-black/5 [.theme-classic_&]:hover:border-black",
            "[.theme-inverted_&]:hover:bg-white/10 [.theme-inverted_&]:hover:border-white"
          )}
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
        </button>
      </div>

      {/* Workflows List */}
      {workflows.length === 0 ? (
        <div
          className={cn(
            "text-center py-8 rounded-lg border",
            "[.theme-classic_&]:border-black [.theme-classic_&]:bg-black/5 [.theme-classic_&]:text-black/60",
            "[.theme-inverted_&]:border-white [.theme-inverted_&]:bg-white/5 [.theme-inverted_&]:text-white/60"
          )}
        >
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          <p className="font-medium [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
            No scheduled workflows
          </p>
          <p className="text-sm mt-1">Schedule a workflow to see it here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map(workflow => (
            <div
              key={workflow.workflow_id}
              className={cn(
                "p-4 rounded-lg border transition-colors",
                "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black [.theme-classic_&]:hover:bg-black/5",
                "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white [.theme-inverted_&]:hover:bg-white/5"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 cursor-pointer" onClick={() => onWorkflowClick?.(workflow.workflow_id)}>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(workflow)}
                    <span
                      className={cn("font-medium", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}
                    >
                      {workflow.workflow_name}
                    </span>
                    <ChevronRight className="w-4 h-4 [.theme-classic_&]:text-black/50 [.theme-inverted_&]:text-white/50" />
                  </div>
                  <div
                    className={cn(
                      "mt-1 text-sm",
                      "[.theme-classic_&]:text-black/60",
                      "[.theme-inverted_&]:text-white/60"
                    )}
                  >
                    {workflow.trigger.type === "cron" && workflow.trigger.schedule
                      ? describeCron(workflow.trigger.schedule)
                      : "Manual trigger"}
                  </div>
                  <div
                    className={cn(
                      "mt-2 flex items-center gap-4 text-xs",
                      "[.theme-classic_&]:text-black/50",
                      "[.theme-inverted_&]:text-white/50"
                    )}
                  >
                    <span>Runs: {workflow.execution_count}</span>
                    {workflow.last_executed && <span>Last: {new Date(workflow.last_executed).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleToggleEnabled(workflow);
                    }}
                    className={cn(
                      "p-2 rounded-lg border border-transparent transition-colors",
                      "[.theme-classic_&]:hover:bg-black/5 [.theme-classic_&]:hover:border-black [.theme-classic_&]:text-black",
                      "[.theme-inverted_&]:hover:bg-white/10 [.theme-inverted_&]:hover:border-white [.theme-inverted_&]:text-white"
                    )}
                    title={workflow.enabled ? "Pause schedule" : "Resume schedule"}
                  >
                    {workflow.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleRemoveSchedule(workflow);
                    }}
                    className={cn(
                      "p-2 rounded-lg border border-transparent transition-colors text-red-600",
                      "[.theme-classic_&]:hover:bg-red-50 [.theme-classic_&]:hover:border-red-600",
                      "[.theme-inverted_&]:hover:bg-red-900/20 [.theme-inverted_&]:hover:border-red-600"
                    )}
                    title="Remove schedule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Activity */}
      {recentEvents.length > 0 && (
        <div>
          <h4
            className={cn(
              "text-sm font-medium mb-2",
              "[.theme-classic_&]:text-black",
              "[.theme-inverted_&]:text-white"
            )}
          >
            Recent Activity
          </h4>
          <div className="space-y-1">
            {recentEvents.map((event, index) => (
              <div
                key={`${event.workflow_id}-${event.timestamp}-${index}`}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm border",
                  "[.theme-classic_&]:border-black/20 [.theme-classic_&]:bg-black/5 [.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:border-white/20 [.theme-inverted_&]:bg-white/5 [.theme-inverted_&]:text-white"
                )}
              >
                {getEventIcon(event.event_type)}
                <span className="flex-1 truncate">{event.message}</span>
                <span
                  className={cn("text-xs", "[.theme-classic_&]:text-black/50", "[.theme-inverted_&]:text-white/50")}
                >
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
