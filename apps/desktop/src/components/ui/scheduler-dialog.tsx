import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, Check, XCircle, Trash2, ChevronDown, ChevronRight, Shuffle } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CronBuilder, describeCron, getNextExecution } from "./cron-builder";
import type { ParsedInputField } from "@/lib/typescript-workflow-parser";

// Types matching the Rust backend
interface TriggerConfig {
  type: "cron" | "manual" | "webhook";
  schedule?: string;
  timezone?: string;
  path?: string;
  enabled?: boolean;
}

interface ScheduledWorkflow {
  workflow_id: string;
  workflow_name: string;
  workflow_path: string;
  trigger: TriggerConfig;
  enabled: boolean;
  last_executed: string | null;
  next_execution: string | null;
  execution_count: number;
  default_inputs: Record<string, unknown>;
}

interface ExecutionLogEntry {
  id: string;
  workflow_id: string;
  started_at: string;
  completed_at: string | null;
  status: string; // "success" | "failed" | "running"
  duration_ms: number | null;
  error: string | null;
}

interface SchedulerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workflow: {
    id: string;
    name: string;
    path: string;
  } | null;
  existingSchedule?: ScheduledWorkflow | null;
  onScheduled?: () => void;
}

export function SchedulerDialog({ isOpen, onClose, workflow, existingSchedule, onScheduled }: SchedulerDialogProps) {
  const [cronExpression, setCronExpression] = useState("0 9 * * *");
  const [isEnabled, setIsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultInputs, setDefaultInputs] = useState<string>("{}");

  // Schema-based input form
  const [inputSchema, setInputSchema] = useState<ParsedInputField[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);

  // Jitter/randomness to avoid detection (in minutes)
  const [jitterMinutes, setJitterMinutes] = useState(0);

  // Initialize from existing schedule
  useEffect(() => {
    if (existingSchedule) {
      if (existingSchedule.trigger.type === "cron" && existingSchedule.trigger.schedule) {
        setCronExpression(existingSchedule.trigger.schedule);
      }
      setIsEnabled(existingSchedule.enabled);
      setDefaultInputs(JSON.stringify(existingSchedule.default_inputs, null, 2));
    } else {
      // Reset to defaults
      setCronExpression("0 9 * * *");
      setIsEnabled(true);
      setDefaultInputs("{}");
    }
  }, [existingSchedule, isOpen]);

  // Load and parse workflow schema when dialog opens
  useEffect(() => {
    if (!isOpen || !workflow) {
      setInputSchema([]);
      setInputValues({});
      return;
    }

    const loadSchema = async () => {
      setIsLoadingSchema(true);
      try {
        // Read the workflow's terminator.ts file
        const content = await invoke<string>("read_typescript_workflow_file", {
          input: {
            workflow_id: workflow.id,
            file_path: "src/terminator.ts",
          },
        });

        // Parse the schema
        const { TypeScriptWorkflowParser } = await import("@/lib/typescript-workflow-parser");
        const parser = new TypeScriptWorkflowParser();
        const parsed = parser.parseWorkflow(content);

        setInputSchema(parsed.inputSchema);

        // Initialize input values from existing schedule or defaults
        const initialValues: Record<string, unknown> = {};
        const existingInputs = existingSchedule?.default_inputs || {};

        for (const field of parsed.inputSchema) {
          if (existingInputs[field.name] !== undefined) {
            initialValues[field.name] = existingInputs[field.name];
          } else if (field.defaultValue !== undefined) {
            initialValues[field.name] = field.defaultValue;
          } else if (field.type === "boolean") {
            initialValues[field.name] = false;
          } else {
            initialValues[field.name] = "";
          }
        }
        setInputValues(initialValues);
      } catch (err) {
        console.warn("[SchedulerDialog] Failed to parse workflow schema:", err);
        // Fall back to JSON mode
        setInputSchema([]);
      } finally {
        setIsLoadingSchema(false);
      }
    };

    loadSchema();
  }, [isOpen, workflow?.id, existingSchedule?.default_inputs]);

  // Handle input field changes
  const handleInputChange = useCallback((name: string, value: unknown) => {
    setInputValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleSave = async () => {
    if (!workflow) return;

    setIsLoading(true);
    setError(null);

    try {
      // Use schema-based inputs if available, otherwise parse JSON
      let parsedInputs: Record<string, unknown> = {};
      if (inputSchema.length > 0) {
        // Convert values to proper types
        for (const field of inputSchema) {
          const value = inputValues[field.name];
          if (field.type === "number" && value !== "" && value !== undefined) {
            parsedInputs[field.name] = Number(value);
          } else if (field.type === "boolean") {
            parsedInputs[field.name] = Boolean(value);
          } else if (value !== "" && value !== undefined) {
            parsedInputs[field.name] = value;
          }
        }
      } else {
        try {
          parsedInputs = JSON.parse(defaultInputs);
        } catch {
          throw new Error("Invalid JSON in default inputs");
        }
      }

      // Build trigger config with optional jitter
      const triggerConfig: Record<string, unknown> = {
        type: "cron",
        schedule: cronExpression,
      };
      if (jitterMinutes > 0) {
        triggerConfig.jitter_minutes = jitterMinutes;
      }

      // Call Tauri command to schedule workflow
      console.log("[SchedulerPanel] Calling schedule_workflow with enabled:", isEnabled, "jitter:", jitterMinutes);
      await invoke("schedule_workflow", {
        workflowId: workflow.id,
        workflowName: workflow.name,
        workflowPath: workflow.path,
        trigger: triggerConfig,
        defaultInputs: parsedInputs,
        enabled: isEnabled,
      });
      console.log("[SchedulerPanel] schedule_workflow completed");

      onScheduled?.();
      onClose();
    } catch (err) {
      console.error("Failed to schedule workflow:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleBackdropClick}>
      <div
        className={cn(
          "w-full max-w-lg max-h-[90vh] overflow-auto rounded-lg shadow-lg border",
          "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black",
          "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white"
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between p-4 border-b",
            "[.theme-classic_&]:border-black",
            "[.theme-inverted_&]:border-white"
          )}
        >
          <div>
            <h2
              className={cn("text-lg font-medium", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}
            >
              Schedule Workflow
            </h2>
            <p className={cn("text-sm", "[.theme-classic_&]:text-black/60", "[.theme-inverted_&]:text-white/60")}>
              {workflow?.name || "Unknown workflow"}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className={cn(
              "p-1 rounded border border-transparent transition-colors",
              "[.theme-classic_&]:hover:bg-black/5 [.theme-classic_&]:hover:border-black",
              "[.theme-inverted_&]:hover:bg-white/10 [.theme-inverted_&]:hover:border-white",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="Close"
          >
            <X className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Enable Toggle */}
          <div
            className={cn(
              "flex items-center justify-between p-3 rounded border",
              "[.theme-classic_&]:border-black",
              "[.theme-inverted_&]:border-white"
            )}
          >
            <div
              className={cn("font-medium text-sm", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}
            >
              {isEnabled ? "Schedule Enabled" : "Schedule Paused"}
            </div>
            <button
              onClick={() => setIsEnabled(!isEnabled)}
              className={cn(
                "relative w-9 h-5 rounded-full transition-colors border flex-shrink-0",
                isEnabled
                  ? "[.theme-classic_&]:bg-black [.theme-classic_&]:border-black [.theme-inverted_&]:bg-white [.theme-inverted_&]:border-white"
                  : "[.theme-classic_&]:bg-black/20 [.theme-classic_&]:border-black/40 [.theme-inverted_&]:bg-white/20 [.theme-inverted_&]:border-white/40"
              )}
            >
              <span
                className={cn(
                  "absolute top-[3px] left-[3px] w-3 h-3 rounded-full transition-transform",
                  isEnabled
                    ? "translate-x-4 [.theme-classic_&]:bg-white [.theme-inverted_&]:bg-black"
                    : "translate-x-0 [.theme-classic_&]:bg-black [.theme-inverted_&]:bg-white"
                )}
              />
            </button>
          </div>

          {/* Cron Builder */}
          <div>
            <h3
              className={cn(
                "text-sm font-medium mb-2",
                "[.theme-classic_&]:text-black",
                "[.theme-inverted_&]:text-white"
              )}
            >
              Schedule
            </h3>
            <CronBuilder value={cronExpression} onChange={setCronExpression} />
          </div>

          {/* Default Inputs (Advanced) */}
          <div>
            <details className="group">
              <summary
                className={cn(
                  "flex items-center gap-2 cursor-pointer text-sm font-medium",
                  "[.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:text-white"
                )}
              >
                <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                Advanced: Default Inputs
              </summary>
              <div className="mt-2">
                <textarea
                  value={defaultInputs}
                  onChange={e => setDefaultInputs(e.target.value)}
                  rows={3}
                  placeholder="{}"
                  className={cn(
                    "w-full px-3 py-2 text-sm font-mono rounded-md border",
                    "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black [.theme-classic_&]:text-black",
                    "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white [.theme-inverted_&]:text-white",
                    "focus:outline-none focus:ring-1 [.theme-classic_&]:focus:ring-black [.theme-inverted_&]:focus:ring-white"
                  )}
                />
                <p
                  className={cn(
                    "text-xs mt-1",
                    "[.theme-classic_&]:text-black/60",
                    "[.theme-inverted_&]:text-white/60"
                  )}
                >
                  JSON object with default input values.
                </p>
              </div>
            </details>
          </div>

          {/* Error Message */}
          {error && (
            <div
              className={cn(
                "p-3 rounded border text-sm",
                "[.theme-classic_&]:border-black [.theme-classic_&]:text-black",
                "[.theme-inverted_&]:border-white [.theme-inverted_&]:text-white"
              )}
            >
              Error: {error}
            </div>
          )}

          {/* Existing Schedule Info */}
          {existingSchedule && (
            <div
              className={cn(
                "p-3 rounded-lg text-sm border",
                "[.theme-classic_&]:border-black [.theme-classic_&]:bg-black/5",
                "[.theme-inverted_&]:border-white [.theme-inverted_&]:bg-white/5"
              )}
            >
              <div
                className={cn("font-medium mb-1", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}
              >
                Current Schedule
              </div>
              <div
                className={cn("space-y-0.5", "[.theme-classic_&]:text-black/70", "[.theme-inverted_&]:text-white/70")}
              >
                <div>Runs: {describeCron(existingSchedule.trigger.schedule || "")}</div>
                <div>Total executions: {existingSchedule.execution_count}</div>
                {existingSchedule.last_executed && (
                  <div>Last run: {new Date(existingSchedule.last_executed).toLocaleString()}</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={cn(
            "flex items-center justify-end gap-2 p-4 border-t",
            "[.theme-classic_&]:border-black",
            "[.theme-inverted_&]:border-white"
          )}
        >
          <Button onClick={onClose} disabled={isLoading} variant="secondary" size="sm">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading} size="sm">
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {existingSchedule ? "Update Schedule" : "Save Schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export type { ScheduledWorkflow, TriggerConfig };

// Inline scheduler panel (for embedding in main content area)
interface SchedulerPanelProps {
  workflow: {
    id: string;
    name: string;
    path: string;
  } | null;
  onScheduled?: () => void;
  onFileChange?: (filePath: string, content: string) => void;
  triggerFromCode?: { type: string; schedule?: string; timezone?: string; enabled?: boolean };
  terminatorContent?: string; // Content of terminator.ts for editing
}

export function SchedulerPanel({
  workflow,
  onScheduled,
  onFileChange,
  triggerFromCode,
  terminatorContent,
}: SchedulerPanelProps) {
  // Check if trigger exists in code
  const hasTriggerInCode = !!triggerFromCode || (terminatorContent ? /trigger:\s*\{/.test(terminatorContent) : false);

  const [cronExpression, setCronExpression] = useState(triggerFromCode?.schedule || "0 9 * * *");
  // Default to false. If trigger exists with enabled: true (or enabled not specified), useEffect will set it.
  const [isEnabled, setIsEnabled] = useState(() => {
    if (!hasTriggerInCode) return false;
    return triggerFromCode?.enabled === true || (triggerFromCode && triggerFromCode.enabled === undefined);
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [defaultInputs, setDefaultInputs] = useState<string>("{}");
  const [existingSchedule, setExistingSchedule] = useState<ScheduledWorkflow | null>(null);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([]);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Schema-based input form
  const [inputSchema, setInputSchema] = useState<ParsedInputField[]>([]);
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);

  // Jitter/randomness to avoid detection (in minutes)
  const [jitterMinutes, setJitterMinutes] = useState(0);

  // Ref to track latest terminatorContent for saves
  const terminatorContentRef = useRef(terminatorContent);
  useEffect(() => {
    terminatorContentRef.current = terminatorContent;
  }, [terminatorContent]);

  // Initialize from TypeScript code (source of truth)
  useEffect(() => {
    if (triggerFromCode?.schedule) {
      setCronExpression(triggerFromCode.schedule);
    }
    if (!hasTriggerInCode) {
      setIsEnabled(false);
    } else {
      setIsEnabled(triggerFromCode?.enabled === true || (triggerFromCode && triggerFromCode.enabled === undefined));
    }
  }, [triggerFromCode, hasTriggerInCode]);

  // Load runtime stats from triggers.json (execution count, last run only)
  useEffect(() => {
    if (!workflow?.id) return;

    const loadRuntimeStats = async () => {
      try {
        const schedules = await invoke<ScheduledWorkflow[]>("get_scheduled_workflows");
        const existing = schedules.find(s => s.workflow_id === workflow.id);
        setExistingSchedule(existing || null);
        if (existing) {
          setDefaultInputs(JSON.stringify(existing.default_inputs, null, 2));
        }
      } catch (err) {
        console.error("Failed to load runtime stats:", err);
      }
    };

    loadRuntimeStats();
  }, [workflow?.id]);

  // Load and parse workflow schema
  useEffect(() => {
    if (!workflow?.id) {
      setInputSchema([]);
      setInputValues({});
      return;
    }

    const loadSchema = async () => {
      setIsLoadingSchema(true);
      try {
        // Parse the schema from terminatorContent if available
        if (terminatorContent) {
          const { TypeScriptWorkflowParser } = await import("@/lib/typescript-workflow-parser");
          const parser = new TypeScriptWorkflowParser();
          const parsed = parser.parseWorkflow(terminatorContent);

          setInputSchema(parsed.inputSchema);

          // Initialize input values from existing schedule or defaults
          const initialValues: Record<string, unknown> = {};
          const existingInputs = existingSchedule?.default_inputs || {};

          for (const field of parsed.inputSchema) {
            if (existingInputs[field.name] !== undefined) {
              initialValues[field.name] = existingInputs[field.name];
            } else if (field.defaultValue !== undefined) {
              initialValues[field.name] = field.defaultValue;
            } else if (field.type === "boolean") {
              initialValues[field.name] = false;
            } else {
              initialValues[field.name] = "";
            }
          }
          setInputValues(initialValues);
        }
      } catch (err) {
        console.warn("[SchedulerPanel] Failed to parse workflow schema:", err);
        setInputSchema([]);
      } finally {
        setIsLoadingSchema(false);
      }
    };

    loadSchema();
  }, [workflow?.id, terminatorContent, existingSchedule?.default_inputs]);

  // Handle input field changes
  const handleInputChange = useCallback((name: string, value: unknown) => {
    setInputValues(prev => ({ ...prev, [name]: value }));
  }, []);

  // Load execution logs with polling and event listening
  useEffect(() => {
    if (!workflow?.path) return;

    const loadExecutionLogs = async () => {
      try {
        const logs = await invoke<ExecutionLogEntry[]>("get_workflow_execution_logs", {
          workflowPath: workflow.path,
          limit: 20,
        });
        setExecutionLogs(logs);
      } catch (err) {
        console.error("Failed to load execution logs:", err);
      }
    };

    // Initial load
    loadExecutionLogs();

    // Poll every 30 seconds for updates
    const pollInterval = setInterval(loadExecutionLogs, 30000);

    // Listen for scheduler events to refresh immediately
    let unlistenCompleted: (() => void) | undefined;
    let unlistenFailed: (() => void) | undefined;

    const setupListeners = async () => {
      const { listen } = await import("@tauri-apps/api/event");

      unlistenCompleted = await listen(
        "scheduler:workflow_completed",
        (event: { payload: { workflow_id: string } }) => {
          if (event.payload?.workflow_id === workflow.id) {
            loadExecutionLogs();
          }
        }
      );

      unlistenFailed = await listen("scheduler:workflow_failed", (event: { payload: { workflow_id: string } }) => {
        if (event.payload?.workflow_id === workflow.id) {
          loadExecutionLogs();
        }
      });
    };

    setupListeners();

    return () => {
      clearInterval(pollInterval);
      unlistenCompleted?.();
      unlistenFailed?.();
    };
  }, [workflow?.path, workflow?.id]);

  const handleClearLogs = async () => {
    if (!workflow?.path) return;
    try {
      await invoke("clear_workflow_execution_logs", { workflowPath: workflow.path });
      setExecutionLogs([]);
    } catch (err) {
      console.error("Failed to clear execution logs:", err);
    }
  };

  const formatDuration = (ms: number | null): string => {
    if (ms === null) return "-";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  // Auto-save function - saves to TypeScript code and updates scheduler
  const saveChanges = useCallback(
    async (newCron: string, newEnabled: boolean) => {
      if (!workflow) return;

      const content = terminatorContentRef.current;
      if (!content) {
        console.warn("[SchedulerPanel] No terminatorContent, cannot save");
        return;
      }

      setIsSaving(true);
      setSaveStatus("saving");
      setError(null);

      try {
        // 1. Update the TypeScript file
        const updatedContent = updateTriggerInCode(content, newCron, newEnabled, hasTriggerInCode);

        await invoke("write_typescript_workflow_file", {
          input: {
            workflow_id: workflow.id,
            file_path: "src/terminator.ts",
            content: updatedContent,
          },
        });

        // Update in-memory state
        onFileChange?.("src/terminator.ts", updatedContent);
        terminatorContentRef.current = updatedContent;

        // 2. Update scheduler runtime state
        let parsedInputs = {};
        try {
          parsedInputs = JSON.parse(defaultInputs);
        } catch {
          parsedInputs = {};
        }

        await invoke("schedule_workflow", {
          workflowId: workflow.id,
          workflowName: workflow.name,
          workflowPath: workflow.path,
          trigger: { type: "cron", schedule: newCron },
          defaultInputs: parsedInputs,
          enabled: newEnabled,
        });

        setSaveStatus("saved");
        onScheduled?.();

        // Reset status after brief display
        setTimeout(() => setSaveStatus("idle"), 1500);
      } catch (err) {
        console.error("Failed to save schedule:", err);
        setError(err instanceof Error ? err.message : String(err));
        setSaveStatus("error");
        // Revert state on error
        if (triggerFromCode?.schedule) setCronExpression(triggerFromCode.schedule);
        setIsEnabled(triggerFromCode?.enabled ?? false);
      } finally {
        setIsSaving(false);
      }
    },
    [workflow, hasTriggerInCode, defaultInputs, onFileChange, onScheduled, triggerFromCode]
  );

  // Handle toggle change - save immediately
  const handleToggleChange = useCallback(() => {
    const newEnabled = !isEnabled;
    setIsEnabled(newEnabled);
    saveChanges(cronExpression, newEnabled);
  }, [isEnabled, cronExpression, saveChanges]);

  // Handle cron expression change - save immediately
  const handleCronChange = useCallback(
    (newCron: string) => {
      setCronExpression(newCron);
      saveChanges(newCron, isEnabled);
    },
    [isEnabled, saveChanges]
  );

  if (!workflow) {
    return (
      <div className={cn("p-4 text-sm", "[.theme-classic_&]:text-black/60", "[.theme-inverted_&]:text-white/60")}>
        No workflow selected
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* Header with save status */}
      <div className={cn("pb-4 border-b", "[.theme-classic_&]:border-black", "[.theme-inverted_&]:border-white")}>
        <div className="flex items-center justify-between">
          <h2 className={cn("text-lg font-medium", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}>
            Schedule
          </h2>
          {/* Save status indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            {saveStatus === "saving" && (
              <>
                <Loader2 className="w-3 h-3 animate-spin [.theme-classic_&]:text-black/60 [.theme-inverted_&]:text-white/60" />
                <span className="[.theme-classic_&]:text-black/60 [.theme-inverted_&]:text-white/60">Saving...</span>
              </>
            )}
            {saveStatus === "saved" && (
              <>
                <Check className="w-3 h-3 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                <span className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white">Saved</span>
              </>
            )}
            {saveStatus === "error" && (
              <>
                <XCircle className="w-3 h-3 text-red-600" />
                <span className="text-red-600">Error</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status Card - shows current state clearly */}
      {(() => {
        const nextRun = isEnabled ? getNextExecution(cronExpression) : null;
        const scheduleDesc = describeCron(cronExpression);

        return (
          <div
            className={cn(
              "p-4 rounded border",
              "[.theme-classic_&]:border-black [.theme-classic_&]:bg-black/5",
              "[.theme-inverted_&]:border-white [.theme-inverted_&]:bg-white/5"
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    isEnabled
                      ? "[.theme-classic_&]:bg-black [.theme-inverted_&]:bg-white"
                      : "[.theme-classic_&]:bg-black/30 [.theme-inverted_&]:bg-white/30"
                  )}
                />
                <span
                  className={cn("font-medium text-sm", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}
                >
                  {isEnabled ? "Active" : "Paused"}
                </span>
              </div>
              <button
                onClick={handleToggleChange}
                disabled={isSaving}
                className={cn(
                  "relative w-10 h-6 rounded-full transition-colors border flex-shrink-0",
                  isSaving && "opacity-50",
                  isEnabled
                    ? "[.theme-classic_&]:bg-black [.theme-classic_&]:border-black [.theme-inverted_&]:bg-white [.theme-inverted_&]:border-white"
                    : "[.theme-classic_&]:bg-black/20 [.theme-classic_&]:border-black/30 [.theme-inverted_&]:bg-white/20 [.theme-inverted_&]:border-white/30"
                )}
              >
                <span
                  className={cn(
                    "absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform shadow-sm",
                    isEnabled
                      ? "translate-x-4 [.theme-classic_&]:bg-white [.theme-inverted_&]:bg-black"
                      : "[.theme-classic_&]:bg-black [.theme-inverted_&]:bg-white"
                  )}
                />
              </button>
            </div>

            <div className={cn("text-sm", "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white")}>
              {scheduleDesc}
            </div>

            {isEnabled && nextRun && (
              <div className={cn("mt-2 text-xs", "[.theme-classic_&]:text-black/70 [.theme-inverted_&]:text-white/70")}>
                Next run:{" "}
                {nextRun.toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            )}

            {!isEnabled && (
              <div className={cn("mt-2 text-xs", "[.theme-classic_&]:text-black/50 [.theme-inverted_&]:text-white/50")}>
                Enable to start running automatically
              </div>
            )}
          </div>
        );
      })()}

      {/* Cron Builder */}
      <div className={cn(isSaving && "opacity-50 pointer-events-none")}>
        <h3
          className={cn("text-sm font-medium mb-2", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}
        >
          Schedule
        </h3>
        <CronBuilder value={cronExpression} onChange={handleCronChange} />
      </div>

      {/* Default Inputs - Schema-based form or JSON fallback */}
      <div>
        <details className="group" open={inputSchema.length > 0}>
          <summary
            className={cn(
              "flex items-center gap-2 cursor-pointer text-sm font-medium",
              "[.theme-classic_&]:text-black",
              "[.theme-inverted_&]:text-white"
            )}
          >
            <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
            {inputSchema.length > 0 ? "Workflow Inputs" : "Advanced: Default Inputs"}
          </summary>
          <div className="mt-2 space-y-3">
            {isLoadingSchema ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading input schema...
              </div>
            ) : inputSchema.length > 0 ? (
              // Schema-based form fields
              inputSchema.map(field => (
                <div key={field.name} className="space-y-1">
                  <label
                    className={cn(
                      "block text-sm font-medium",
                      "[.theme-classic_&]:text-black",
                      "[.theme-inverted_&]:text-white"
                    )}
                  >
                    {field.name}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {field.type === "boolean" ? (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={Boolean(inputValues[field.name])}
                        onCheckedChange={checked => handleInputChange(field.name, checked)}
                      />
                      <span
                        className={cn(
                          "text-sm",
                          "[.theme-classic_&]:text-black/70",
                          "[.theme-inverted_&]:text-white/70"
                        )}
                      >
                        {inputValues[field.name] ? "Yes" : "No"}
                      </span>
                    </div>
                  ) : field.type === "enum" && field.enumValues ? (
                    <select
                      value={String(inputValues[field.name] ?? "")}
                      onChange={e => handleInputChange(field.name, e.target.value)}
                      className={cn(
                        "w-full px-3 py-2 text-sm rounded border",
                        "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black [.theme-classic_&]:text-black",
                        "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white [.theme-inverted_&]:text-white",
                        "focus:outline-none focus:ring-1"
                      )}
                    >
                      <option value="">Select...</option>
                      {field.enumValues.map(opt => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={field.type === "number" ? "number" : "text"}
                      value={String(inputValues[field.name] ?? "")}
                      onChange={e => handleInputChange(field.name, e.target.value)}
                      className={cn(
                        "w-full",
                        "[.theme-classic_&]:border-black [.theme-classic_&]:text-black",
                        "[.theme-inverted_&]:border-white [.theme-inverted_&]:text-white"
                      )}
                    />
                  )}
                  {field.description && (
                    <p
                      className={cn("text-xs", "[.theme-classic_&]:text-black/60", "[.theme-inverted_&]:text-white/60")}
                    >
                      {field.description}
                    </p>
                  )}
                </div>
              ))
            ) : (
              // Fallback to JSON textarea
              <>
                <textarea
                  value={defaultInputs}
                  onChange={e => setDefaultInputs(e.target.value)}
                  rows={3}
                  placeholder="{}"
                  className={cn(
                    "w-full px-3 py-2 text-sm font-mono rounded border",
                    "[.theme-classic_&]:bg-white [.theme-classic_&]:border-black [.theme-classic_&]:text-black",
                    "[.theme-inverted_&]:bg-gray-900 [.theme-inverted_&]:border-white [.theme-inverted_&]:text-white",
                    "focus:outline-none focus:ring-1 [.theme-classic_&]:focus:ring-black [.theme-inverted_&]:focus:ring-white"
                  )}
                />
                <p className={cn("text-xs", "[.theme-classic_&]:text-black/60", "[.theme-inverted_&]:text-white/60")}>
                  JSON object with default input values.
                </p>
              </>
            )}
          </div>
        </details>
      </div>

      {/* Jitter/Randomness Settings */}
      <div>
        <details className="group">
          <summary
            className={cn(
              "flex items-center gap-2 cursor-pointer text-sm font-medium",
              "[.theme-classic_&]:text-black",
              "[.theme-inverted_&]:text-white"
            )}
          >
            <Shuffle className="w-3 h-3 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
            Randomness (Anti-detection)
          </summary>
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={0}
                max={60}
                value={jitterMinutes}
                onChange={e => setJitterMinutes(Math.max(0, Math.min(60, parseInt(e.target.value) || 0)))}
                className={cn(
                  "w-20",
                  "[.theme-classic_&]:border-black [.theme-classic_&]:text-black",
                  "[.theme-inverted_&]:border-white [.theme-inverted_&]:text-white"
                )}
              />
              <span className={cn("text-sm", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}>
                minutes
              </span>
            </div>
            <p className={cn("text-xs", "[.theme-classic_&]:text-black/60", "[.theme-inverted_&]:text-white/60")}>
              Add random delay (0-{jitterMinutes || "N"} min) to each run to avoid detection patterns.
              {jitterMinutes > 0 && (
                <span className="block mt-1">
                  Example: 9:00 AM schedule may run anytime between 9:00-9:{String(jitterMinutes).padStart(2, "0")} AM
                </span>
              )}
            </p>
          </div>
        </details>
      </div>

      {/* Execution History */}
      {(executionLogs.length > 0 || (existingSchedule && existingSchedule.execution_count > 0)) && (
        <div
          className={cn(
            "rounded border text-sm",
            "[.theme-classic_&]:border-black",
            "[.theme-inverted_&]:border-white"
          )}
        >
          <div
            className={cn(
              "flex items-center justify-between p-3 border-b",
              "[.theme-classic_&]:border-black",
              "[.theme-inverted_&]:border-white"
            )}
          >
            <div className={cn("font-medium", "[.theme-classic_&]:text-black", "[.theme-inverted_&]:text-white")}>
              Execution History
              {existingSchedule && (
                <span
                  className={cn(
                    "ml-2 font-normal",
                    "[.theme-classic_&]:text-black/60",
                    "[.theme-inverted_&]:text-white/60"
                  )}
                >
                  ({existingSchedule.execution_count} total)
                </span>
              )}
            </div>
            {executionLogs.length > 0 && (
              <button
                onClick={handleClearLogs}
                className={cn(
                  "p-1 rounded hover:bg-black/5 transition-colors",
                  "[.theme-inverted_&]:hover:bg-white/10"
                )}
                title="Clear history"
              >
                <Trash2 className="w-3.5 h-3.5 [.theme-classic_&]:text-black/60 [.theme-inverted_&]:text-white/60" />
              </button>
            )}
          </div>

          {executionLogs.length > 0 ? (
            <div className="max-h-60 overflow-y-auto">
              {executionLogs.map(log => (
                <div
                  key={log.id}
                  className={cn(
                    "border-b last:border-b-0",
                    "[.theme-classic_&]:border-black/10",
                    "[.theme-inverted_&]:border-white/10"
                  )}
                >
                  <button
                    onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                    className={cn(
                      "w-full flex items-center gap-2 p-2 text-left hover:bg-black/5 transition-colors",
                      "[.theme-inverted_&]:hover:bg-white/5"
                    )}
                  >
                    {log.status === "success" || log.status === "executed_without_error" ? (
                      <Check className="w-4 h-4 flex-shrink-0 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
                    ) : (
                      <XCircle className="w-4 h-4 flex-shrink-0 [.theme-classic_&]:text-black/60 [.theme-inverted_&]:text-white/60" />
                    )}
                    <span
                      className={cn(
                        "flex-1 text-xs font-medium",
                        "[.theme-classic_&]:text-black/80",
                        "[.theme-inverted_&]:text-white/80"
                      )}
                    >
                      {formatRelativeTime(log.started_at)}
                    </span>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        "[.theme-classic_&]:text-black/50",
                        "[.theme-inverted_&]:text-white/50"
                      )}
                    >
                      {formatDuration(log.duration_ms)}
                    </span>
                    {expandedLogId === log.id ? (
                      <ChevronDown className="w-3.5 h-3.5 [.theme-classic_&]:text-black/40 [.theme-inverted_&]:text-white/40" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 [.theme-classic_&]:text-black/40 [.theme-inverted_&]:text-white/40" />
                    )}
                  </button>
                  {expandedLogId === log.id && (
                    <div
                      className={cn(
                        "px-3 pb-2 space-y-1",
                        log.error
                          ? "[.theme-classic_&]:bg-red-50 [.theme-inverted_&]:bg-red-900/20"
                          : "[.theme-classic_&]:bg-black/5 [.theme-inverted_&]:bg-white/5"
                      )}
                    >
                      <div
                        className={cn(
                          "text-xs",
                          "[.theme-classic_&]:text-black/60",
                          "[.theme-inverted_&]:text-white/60"
                        )}
                      >
                        <span className="font-medium">Started:</span>{" "}
                        {new Date(log.started_at).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </div>
                      {log.completed_at && (
                        <div
                          className={cn(
                            "text-xs",
                            "[.theme-classic_&]:text-black/60",
                            "[.theme-inverted_&]:text-white/60"
                          )}
                        >
                          <span className="font-medium">Duration:</span> {formatDuration(log.duration_ms)}
                        </div>
                      )}
                      <div
                        className={cn(
                          "text-xs",
                          "[.theme-classic_&]:text-black/60",
                          "[.theme-inverted_&]:text-white/60"
                        )}
                      >
                        <span className="font-medium">Status:</span>{" "}
                        <span
                          className={cn(
                            log.status === "success" || log.status === "executed_without_error"
                              ? "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white"
                              : "[.theme-classic_&]:text-black/60 [.theme-inverted_&]:text-white/60"
                          )}
                        >
                          {log.status}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "text-xs",
                          "[.theme-classic_&]:text-black/60",
                          "[.theme-inverted_&]:text-white/60"
                        )}
                      >
                        <span className="font-medium">Trigger:</span> Cron schedule
                      </div>
                      {log.error && (
                        <div
                          className={cn(
                            "text-xs font-mono break-all mt-2 p-2 rounded",
                            "[.theme-classic_&]:text-red-700 [.theme-classic_&]:bg-red-100",
                            "[.theme-inverted_&]:text-red-300 [.theme-inverted_&]:bg-red-900/30"
                          )}
                        >
                          <span className="font-medium font-sans">Error:</span> {log.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={cn("p-3", "[.theme-classic_&]:text-black/50", "[.theme-inverted_&]:text-white/50")}>
              No execution logs yet
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div
          className={cn(
            "p-3 rounded border text-sm",
            "[.theme-classic_&]:border-red-300 [.theme-classic_&]:bg-red-50 [.theme-classic_&]:text-red-700",
            "[.theme-inverted_&]:border-red-700 [.theme-inverted_&]:bg-red-900/20 [.theme-inverted_&]:text-red-300"
          )}
        >
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Update or add trigger configuration in terminator.ts code
 */
function updateTriggerInCode(code: string, schedule: string, enabled: boolean, _hasTrigger: boolean): string {
  const newTrigger = `trigger: {
    type: "cron",
    schedule: "${schedule}",
    enabled: ${enabled},
  }`;

  // Always try to replace existing trigger first (check code directly, not hasTrigger flag)
  // Match trigger: { ... } block - handles multiline with type, schedule, enabled fields
  const triggerRegex = /trigger:\s*\{[\s\S]*?type:\s*["']cron["'][\s\S]*?\},?/;

  if (triggerRegex.test(code)) {
    console.log("[updateTriggerInCode] Found existing trigger, replacing");
    return code.replace(triggerRegex, newTrigger + ",");
  }

  console.log("[updateTriggerInCode] No existing trigger found, adding new one");

  // Add trigger to createWorkflow call after input:
  const inputMatch = code.match(/(input:\s*\w+,?\s*\n)/);
  if (inputMatch) {
    return code.replace(inputMatch[0], `${inputMatch[0]}\n  ${newTrigger},\n`);
  }

  // Fallback: add before steps:
  const stepsMatch = code.match(/(steps:\s*\[)/);
  if (stepsMatch) {
    return code.replace(stepsMatch[0], `${newTrigger},\n\n  ${stepsMatch[0]}`);
  }

  return code;
}
