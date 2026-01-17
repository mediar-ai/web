import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback, useRef } from "react";
import { generateStepName } from "@/lib/workflow-io";

// Matches CapturedLogEntry from Rust
interface CapturedLogEntry {
  timestamp: string | null;
  level: string;
  message: string;
}

// Matches StandaloneToolExecution from Rust
interface StandaloneToolExecution {
  id: string;
  toolName: string;
  arguments: any;
  result: any;
  error: string | null;
  durationMs: number;
  succeeded: boolean;
  timestamp: string;
  filePath: string;
  definition: string | null;
  logs: CapturedLogEntry[] | null;
}

export interface PoolStep {
  id: string;
  tool_name: string;
  arguments: any;
  result: any;
  error: any;
  duration_ms: number;
  succeeded: boolean;

  // Context
  workflow_id?: number;
  workflow_name?: string;
  step_id?: string;
  step_name?: string;

  // Application info
  app_name?: string;
  window_title?: string;
  element_path?: string;

  // Pool metadata
  pool_order: number;
  is_selected: boolean;
  is_starred: boolean;
  user_notes?: string;
  tags?: string[];

  // Timestamps
  created_at: string;
  updated_at: string;

  // TypeScript definition from .ts file
  definition?: string;

  // Captured console logs from execution
  logs?: Array<{ timestamp: string | null; level: string; message: string }>;
}

export interface StepPoolStats {
  total_steps: number;
  selected_steps: number;
  successful_steps: number;
  failed_steps: number;
  total_duration_ms: number;
  unique_tools: number;
  unique_apps: number;
}

interface UseStepPoolReturn {
  steps: PoolStep[];
  stats: StepPoolStats | null;
  sessionId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadSteps: () => Promise<void>;
  addStep: (step: Omit<PoolStep, "id" | "created_at" | "updated_at" | "pool_order">) => Promise<void>;
  toggleSelection: (stepId: string) => Promise<void>;
  toggleStar: (stepId: string) => Promise<void>;
  updateOrder: (stepId: string, newOrder: number) => Promise<void>;
  updateNotes: (stepId: string, notes: string) => Promise<void>;
  deleteStep: (stepId: string) => Promise<void>;
  clearPool: () => Promise<void>;
  clearSession: () => Promise<void>;

  // Workflow operations
  addToWorkflow: (workflowId: number | string, stepIds?: string[], insertAtIndex?: number) => Promise<void>;
  addFromWorkflow: (
    workflowId: number | string,
    workflowName: string,
    steps: Array<{
      id?: string;
      name?: string;
      tool_name: string;
      arguments?: Record<string, unknown>;
    }>,
    insertAtOrder?: number
  ) => Promise<any>;
  createWorkflow: (name: string, description: string, stepIds?: string[]) => Promise<{ id: number; name: string }>;
}

// Convert standalone execution to PoolStep format
function toPoolStep(exec: StandaloneToolExecution, index: number): PoolStep {
  const stepName = generateStepName({ tool_name: exec.toolName, arguments: exec.arguments });
  return {
    id: exec.id,
    tool_name: exec.toolName,
    arguments: exec.arguments,
    result: exec.result,
    error: exec.error,
    duration_ms: exec.durationMs,
    succeeded: exec.succeeded,
    step_id: exec.id,
    step_name: stepName,
    pool_order: index,
    is_selected: false,
    is_starred: false,
    created_at: exec.timestamp,
    updated_at: exec.timestamp,
    definition: exec.definition ?? undefined,
    logs: exec.logs ?? undefined,
  };
}

export function useStepPool(_workflowId?: number | string): UseStepPoolReturn {
  const [steps, setSteps] = useState<PoolStep[]>([]);
  const [stats, setStats] = useState<StepPoolStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to store latest loadSteps function for event listener
  const loadStepsRef = useRef<(() => Promise<void>) | null>(null);

  // Load steps from local filesystem (standalone executions)
  const loadSteps = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log("[STEP-POOL] Loading standalone tool history from local filesystem...");
      const executions = await invoke<StandaloneToolExecution[]>("get_standalone_tool_history", {
        limit: 50,
      });

      console.log(`[STEP-POOL] Loaded ${executions.length} standalone executions`);
      const poolSteps = executions.map(toPoolStep);
      setSteps(poolSteps);

      // Calculate stats
      if (poolSteps.length > 0) {
        const uniqueTools = new Set(poolSteps.map(s => s.tool_name));
        setStats({
          total_steps: poolSteps.length,
          selected_steps: 0,
          successful_steps: poolSteps.filter(s => s.succeeded).length,
          failed_steps: poolSteps.filter(s => !s.succeeded).length,
          total_duration_ms: poolSteps.reduce((sum, s) => sum + s.duration_ms, 0),
          unique_tools: uniqueTools.size,
          unique_apps: 0, // Not tracked in standalone executions
        });
      } else {
        setStats(null);
      }
    } catch (err) {
      console.error("[STEP-POOL] Error loading standalone tool history:", err);
      setError(err instanceof Error ? err.message : "Failed to load tool history");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Keep loadStepsRef up to date
  useEffect(() => {
    loadStepsRef.current = loadSteps;
  }, [loadSteps]);

  // Listen for step pool update events
  useEffect(() => {
    let reloadTimeout: NodeJS.Timeout | null = null;

    const handleStepPoolUpdate = (event: CustomEvent) => {
      const detail = event.detail;
      console.log("[STEP-POOL] Received update event:", detail);

      // Reload on any update event (standalone executions are global)
      console.log("[STEP-POOL] Scheduling reload after update from:", detail.source);

      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
      }

      reloadTimeout = setTimeout(() => {
        console.log("[STEP-POOL] Executing delayed reload");
        if (loadStepsRef.current) {
          loadStepsRef.current();
        }
      }, 500);
    };

    window.addEventListener("step-pool-updated", handleStepPoolUpdate as EventListener);

    return () => {
      window.removeEventListener("step-pool-updated", handleStepPoolUpdate as EventListener);
      if (reloadTimeout) {
        clearTimeout(reloadTimeout);
      }
    };
  }, []);

  // Load steps on mount
  useEffect(() => {
    console.log("[STEP-POOL] Initial load of standalone tool history");
    loadSteps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No-op implementations for local-only mode (these actions don't make sense for read-only local files)
  const addStep = useCallback(async () => {
    console.log("[STEP-POOL] addStep not supported in local mode");
  }, []);

  const toggleSelection = useCallback(async (stepId: string) => {
    // Local-only: toggle in memory
    setSteps(prev => prev.map(s => (s.id === stepId ? { ...s, is_selected: !s.is_selected } : s)));
  }, []);

  const toggleStar = useCallback(async (stepId: string) => {
    // Local-only: toggle in memory
    setSteps(prev => prev.map(s => (s.id === stepId ? { ...s, is_starred: !s.is_starred } : s)));
  }, []);

  const updateOrder = useCallback(async () => {
    console.log("[STEP-POOL] updateOrder not supported in local mode");
  }, []);

  const updateNotes = useCallback(async (stepId: string, notes: string) => {
    // Local-only: update in memory
    setSteps(prev => prev.map(s => (s.id === stepId ? { ...s, user_notes: notes } : s)));
  }, []);

  const deleteStep = useCallback(async (stepId: string) => {
    // Local-only: remove from memory (doesn't delete file)
    setSteps(prev => prev.filter(s => s.id !== stepId));
  }, []);

  const clearPool = useCallback(async () => {
    // Local-only: clear from memory
    setSteps([]);
    setStats(null);
  }, []);

  const clearSession = useCallback(async () => {
    // Same as clearPool for local mode
    setSteps([]);
    setStats(null);
  }, []);

  const addToWorkflow = useCallback(async () => {
    console.log("[STEP-POOL] addToWorkflow not supported in local mode");
  }, []);

  const createWorkflow = useCallback(async (): Promise<{ id: number; name: string }> => {
    console.log("[STEP-POOL] createWorkflow not supported in local mode");
    throw new Error("Not supported in local mode");
  }, []);

  const addFromWorkflow = useCallback(async () => {
    console.log("[STEP-POOL] addFromWorkflow not supported in local mode");
    return {};
  }, []);

  return {
    steps,
    stats,
    sessionId: null,
    isLoading,
    error,

    loadSteps,
    addStep,
    toggleSelection,
    toggleStar,
    updateOrder,
    updateNotes,
    deleteStep,
    clearPool,
    clearSession,

    addToWorkflow,
    addFromWorkflow,
    createWorkflow,
  };
}
