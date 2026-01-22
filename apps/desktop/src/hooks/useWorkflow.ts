import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FileTreeNode } from "@/components/workflow/types";
import { useMcp } from "@/contexts/McpContext";
import { focusManager } from "@/lib/focus-manager";
import { mcpClient } from "@/lib/mcp-client";
import {
  canHighlightStep,
  createHighlightArgs,
  createInitialHighlightState,
  type HighlightState,
} from "@/lib/workflow-highlighting";
import { generateStepName } from "@/lib/workflow-io";
import { parseProgressFromConsole, type ConsoleLogEntry, type ProgressInfo } from "@/lib/workflow-progress-parser";
import type { WorkflowContent, WorkflowMetadata, SequenceStep } from "@/lib/workflow-schema";
import { useAuth } from "./useAuth";

// TypeScript workflow file - supports both flat files and tree structure
export interface TypeScriptWorkflowFile {
  name: string; // File/folder name, e.g., "terminator.ts"
  path: string; // Relative path, e.g., "src/terminator.ts"
  isDirectory: boolean; // True if this is a folder
  content?: string; // File content (undefined for directories, lazy-loaded)
  isStepFile?: boolean; // True if file is in steps/ directory
  mimeType?: string; // MIME type for images, e.g., "image/png"
  children?: TypeScriptWorkflowFile[]; // Child files/folders (for directories)
}

// Input field parsed from z.object schema
export interface ParsedInputField {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array" | "enum" | "unknown";
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  enumValues?: string[];
  lineStart?: number;
  lineEnd?: number;
}

// Parsed section with line numbers for highlighting
export interface ParsedSection {
  type: "input" | "steps" | "onError" | "onSuccess" | "trigger";
  lineStart: number;
  lineEnd: number;
}

export interface Workflow {
  id: string | null; // UUID for TypeScript workflows
  name: string;
  description: string;
  stepCount: number;
  lastModified: string;
  isOriginal: boolean;
  content: WorkflowContent; // Now typed as WorkflowContent (unwrapped)
  metadata?: WorkflowMetadata; // Metadata from YAML comments
  // NOTE: yamlContent removed - YAML workflows deprecated
  isModified?: boolean; // Track if edited from original
  parseError?: string; // NEW: Store YAML parse errors
  rawEvents?: any[]; // Raw events captured during recording
  isNewRecording?: boolean; // NEW: True for brand new recording workflows, false for loaded workflows
  // Permission/Ownership fields for frontend authorization
  createdBy?: string; // Workflow owner user ID
  organizationId?: string; // Owning organization ID
  isPublic?: boolean; // Whether workflow is publicly accessible to all organizations
  authorName?: string | null; // Author name (first user in organization)
  userAccessLevel?: "owner" | "admin" | "write" | "read" | "public_read" | null; // User's access level for this workflow
  // NEW: Integrated recording metadata
  recordingMetadata?: {
    originalStepCount: number; // Boundary between original and new steps
    recordingStartedAt: string; // ISO timestamp
    lowEnergyMode: boolean;
    conversionNotes: string[];
    highlightingEnabled: boolean;
  };
  // Version tracking for workflow history
  currentVersion?: string;
  latestVersion?: string; // Latest version available in cloud (for update detection)
  totalVersions?: number;
  // TypeScript workflow fields
  localPath?: string; // Full path to workflow folder
  cloudId?: string; // Cloud UUID (github_folder) - used for cloud sync operations like chat sessions
  files?: TypeScriptWorkflowFile[]; // File tree with lazy-loaded content
  // TypeScript parsed info
  inputs?: ParsedInputField[]; // Parsed input schema
  hasOnSuccess?: boolean;
  hasOnError?: boolean;
  trigger?: import("@/lib/typescript-workflow-parser").TriggerConfig; // Parsed trigger config
  sections?: ParsedSection[]; // Parsed sections with line numbers
  // Cloud TypeScript workflow fields
  githubFolder?: string; // UUID folder name for TypeScript workflows in cloud (legacy)
  uuid?: string; // Workflow UUID for zip download endpoint
  isCloudOnly?: boolean; // True if workflow exists in cloud but not locally (needs download)
  tags?: string[]; // Tags for filtering/categorization
  isFeatured?: boolean; // Featured workflows always appear in "My Workflows" regardless of org
}

// WorkflowContent is now imported from workflow-schema.ts

export interface StepResult {
  success: boolean;
  output: unknown; // Raw result object (not stringified) to preserve ui_tree newlines
  error?: string;
  partialFailure?: boolean;
  skipped?: boolean;
  failedTools?: Array<{
    tool_name: string;
    index: number;
    error: string;
  }>;
}

export type WorkflowState =
  | "idle"
  | "executing"
  | "awaiting_user_action"
  | "completed"
  | "interrupted"
  | "recording"
  | "stopping_recording";

// NOTE: stringifyWorkflow removed - YAML workflows deprecated

/**
 * Extract step code from workflow files given a step ID.
 * Looks up the step in content.steps to find sourceFile/lineStart/lineEnd,
 * then extracts the code from the corresponding file.
 */
function extractStepCode(
  stepId: string,
  steps: Array<{ id?: string; sourceFile?: string; lineStart?: number; lineEnd?: number }>,
  files: TypeScriptWorkflowFile[]
): string | null {
  // Find step by ID
  const step = steps.find(s => s.id === stepId);
  if (!step?.sourceFile || step.lineStart === undefined || step.lineEnd === undefined) {
    console.log("[WORKFLOW] extractStepCode: step not found or missing line info", { stepId, step });
    return null;
  }

  // Find file in tree (recursive search)
  const findFileInTree = (nodes: TypeScriptWorkflowFile[], targetPath: string): TypeScriptWorkflowFile | undefined => {
    for (const node of nodes) {
      const normalizedNodePath = node.path.replace(/\\/g, "/");
      const normalizedTargetPath = targetPath.replace(/\\/g, "/");
      if (
        !node.isDirectory &&
        (normalizedNodePath === normalizedTargetPath || normalizedNodePath.endsWith(normalizedTargetPath))
      ) {
        return node;
      }
      if (node.children) {
        const found = findFileInTree(node.children, targetPath);
        if (found) return found;
      }
    }
    return undefined;
  };

  const file = findFileInTree(files, step.sourceFile);
  if (!file?.content) {
    console.log("[WORKFLOW] extractStepCode: file not found or no content", { sourceFile: step.sourceFile });
    return null;
  }

  // Extract lines (1-indexed to 0-indexed)
  const lines = file.content.split("\n");
  const startIdx = Math.max(0, step.lineStart - 1);
  const endIdx = Math.min(lines.length, step.lineEnd);
  const stepCode = lines.slice(startIdx, endIdx).join("\n");

  console.log(`[WORKFLOW] extractStepCode: extracted ${endIdx - startIdx} lines from ${step.sourceFile}`);
  return stepCode;
}

/**
 * Parse MCP error string to extract the actual error message.
 * Handles format: "MCP error -32603: ...\nDetails: {JSON}"
 * Extracts workflow_result.result.error from the JSON details if available.
 */
function parseMcpError(errorString: string): string {
  if (typeof errorString !== "string") {
    return errorString;
  }

  // Check if it's a formatted error string like "MCP error -32603: ...\nDetails: {JSON}"
  const detailsMatch = errorString.match(/Details:\s*(\{[\s\S]*\})\s*$/);
  if (detailsMatch) {
    try {
      const details = JSON.parse(detailsMatch[1]);
      // Extract error from workflow_result.result.error if available (most specific)
      if (details.workflow_result?.result?.error) {
        return details.workflow_result.result.error;
      }
      // Fallback to other error fields
      if (details.error) {
        return details.error;
      }
      if (details.workflow_result?.error) {
        return details.workflow_result.error;
      }
    } catch (e) {
      // Not valid JSON, fall through to return original string
    }
  }

  // Return original string if no JSON details found or parsing failed
  return errorString;
}

// Helper function to filter out recording control steps
const filterRecordingControlSteps = (steps: SequenceStep[]): SequenceStep[] => {
  return steps.filter((step, index) => {
    // Remove "Stop Recording" button clicks
    if ((step as any).tool === "click_element" && (step as any).parameters?.selector?.includes("Stop Recording")) {
      console.log(`🧹 Removing recording control step: ${step.name}`);
      return false;
    }

    // Remove clicks on unnamed image/graphic in Mediar window (stop button)
    if ((step as any).tool === "click_element") {
      const selector = (step as any).parameters?.selector;
      if (
        selector &&
        selector.includes("name:contains:Mediar") &&
        (selector.includes(">> role:image") || selector.includes(">> role:graphic"))
      ) {
        console.log("🎯 Filtered out stop recording button click (unnamed image/graphic in Mediar)");
        return false;
      }
    }

    // Remove Mediar app activation (recording app)
    if ((step as any).tool === "activate_element" && (step as any).parameters?.selector?.includes("Mediar")) {
      console.log(`🧹 Removing recording app activation: ${step.name}`);
      return false;
    }

    // Remove Recording Bar window activations
    if ((step as any).tool === "activate_element") {
      const selector = (step as any).parameters?.selector;
      if (selector && selector.includes("Recording Bar")) {
        console.log(`🧹 Removing Recording Bar activation: ${step.name}`);
        return false;
      }
    }

    // Remove clicks on Recording Bar window elements
    if ((step as any).tool === "click_element") {
      const selector = (step as any).parameters?.selector;
      if (selector && selector.includes("Recording Bar")) {
        console.log(`🧹 Removing Recording Bar click: ${step.name}`);
        return false;
      }
    }

    // Remove immediate application activations after first user action
    // (These are usually redundant focus changes during recording)
    if ((step as any).tool === "activate_element" && index <= 2) {
      // Check if this is just switching back to the app the user was already using
      const prevStep = steps[index - 1];
      if (prevStep && (prevStep as any).tool === "click_element") {
        console.log(`🧹 Removing redundant app activation after click: ${step.name}`);
        return false;
      }
    }

    return true;
  });
};

// Helper function to remove exact duplicate steps
const removeDuplicateSteps = (steps: SequenceStep[]): SequenceStep[] => {
  const seen = new Set<string>();
  const uniqueSteps: SequenceStep[] = [];
  let removedCount = 0;

  for (const step of steps) {
    // Create a key that uniquely identifies the step based on tool and parameters
    const stepKey = JSON.stringify({
      tool: (step as any).tool || step.tool_name,
      parameters: (step as any).parameters || step.arguments,
    });

    if (!seen.has(stepKey)) {
      seen.add(stepKey);
      uniqueSteps.push(step);
    } else {
      removedCount++;
      console.log(`🧹 Removing duplicate step: ${step.name} (${(step as any).tool || step.tool_name})`);
    }
  }

  if (removedCount > 0) {
    console.log(`🎯 Removed ${removedCount} exact duplicate steps`);
  }

  return uniqueSteps;
};

// Convert MCP tool sequence to our workflow step format
const convertMcpToSequenceSteps = (mcpItems: any[]): SequenceStep[] => {
  const allSteps = mcpItems.map(item => {
    const stepName = generateStepName(item);
    const step: SequenceStep = {
      id: crypto.randomUUID(),
      name: stepName,
      tool_name: item.tool_name,
      arguments: {
        ...item.arguments,
        // Don't include delay_ms in arguments - it goes at step level
      },
    };

    // Add optional fields
    if (item.delay_ms) (step as any).delay_ms = item.delay_ms;
    if (item.timeout_ms) (step as any).timeout_ms = item.timeout_ms;
    if (typeof item.continue_on_error === "boolean") (step as any).continue_on_error = item.continue_on_error;
    if (item.description) (step as any).description = item.description;
    if (item.expected_ui_changes) (step as any).expected_ui_changes = item.expected_ui_changes;
    if (item.expected_dom_changes) (step as any).expected_dom_changes = item.expected_dom_changes;

    return step;
  });

  // Filter out unwanted recording-control steps
  const filteredSteps = filterRecordingControlSteps(allSteps);

  // Remove exact duplicate steps
  const finalSteps = removeDuplicateSteps(filteredSteps);

  // Enhanced logging with breakdown of reductions
  const controlStepsRemoved = allSteps.length - filteredSteps.length;
  const duplicatesRemoved = filteredSteps.length - finalSteps.length;
  const totalRemoved = allSteps.length - finalSteps.length;

  if (totalRemoved > 0) {
    console.log(`🧹 Step reduction summary:`);
    console.log(`  - Original steps: ${allSteps.length}`);
    if (controlStepsRemoved > 0) {
      console.log(`  - Removed ${controlStepsRemoved} recording control steps`);
    }
    if (duplicatesRemoved > 0) {
      console.log(`  - Removed ${duplicatesRemoved} duplicate steps`);
    }
    console.log(`  - Final steps: ${finalSteps.length} (${totalRemoved} total removed)`);
  }

  return finalSteps;
};

// Helper function to resequence step IDs
const resequenceStepIds = (steps: any[]): any[] => {
  return steps.map((step, index) => ({
    ...step,
    id: String(index + 1), // Sequential IDs starting from 1 (SequenceStep uses string id)
  }));
};

export interface UseWorkflowOptions {
  sendMessage?: (message: string) => Promise<void>;
}

export function useWorkflow(options: UseWorkflowOptions = {}) {
  const { sendMessage = async () => {} } = options;
  const { authStatus } = useAuth();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [currentWorkflow, setCurrentWorkflow] = useState<Workflow | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepResult, setStepResult] = useState<StepResult | undefined>();
  const [workflowState, setWorkflowState] = useState<WorkflowState>("idle");

  // Use ref to access current workflow without causing re-renders
  // This solves the stale closure issue without performance problems
  const currentWorkflowRef = useRef<Workflow | null>(null);

  // Keep ref in sync with state (this doesn't cause re-renders of callbacks)
  useEffect(() => {
    currentWorkflowRef.current = currentWorkflow;
  }, [currentWorkflow]);

  const [isLoading, setIsLoading] = useState(false);
  const [loadingWorkflowId, setLoadingWorkflowId] = useState<string | null>(null); // Track which workflow is being loaded
  const [isModifyingWorkflow, setIsModifyingWorkflow] = useState(false); // Track when modifying workflow (AI changes, step deletion)
  const [isInterrupted, setIsInterrupted] = useState(false);
  const [wasInterruptedByUser, setWasInterruptedByUser] = useState(false); // Track user-initiated interruptions
  const [highlightState, setHighlightState] = useState<HighlightState>(createInitialHighlightState());
  const [isFullWorkflowMode, setIsFullWorkflowMode] = useState(false); // Track when executing full workflow (all steps at once)
  const [executingRange, setExecutingRange] = useState<{ start: number; end: number } | null>(null); // Track range execution boundaries
  const [isPreparingWorkflow, setIsPreparingWorkflow] = useState(false); // Track when installing dependencies
  const workflowAbortControllerRef = useRef<AbortController | null>(null);

  // Progress tracking state
  const [stepProgress, setStepProgress] = useState<{
    consoleLogs: ConsoleLogEntry[];
    progressInfo: ProgressInfo;
    lastUpdate: number;
  }>({
    consoleLogs: [],
    progressInfo: {},
    lastUpdate: Date.now(),
  });

  // Store execution logs for entire workflow (for AI builder)
  const [workflowExecutionLogs, setWorkflowExecutionLogs] = useState<{
    [stepIndex: number]: {
      stepName: string;
      tool: string;
      consoleLogs: ConsoleLogEntry[];
      result?: StepResult;
      startTime: number;
      endTime?: number;
      error?: string;
    };
  }>({});

  // Counter to trigger logs reload in UI after step execution
  // Increment this after doExecuteStep completes to force SectionView to reload from file
  const [logsRefreshKey, setLogsRefreshKey] = useState(0);

  // Workflow execution state (env variables, inputs, etc. from state.json)
  const [workflowExecutionState, setWorkflowExecutionState] = useState<{
    lastUpdated: string | null;
    lastStepIndex: number | null;
    env: Record<string, unknown>;
  } | null>(null);

  // Use ref to always have access to the latest workflow state
  const workflowStateRef = useRef<WorkflowState>("idle");
  useEffect(() => {
    workflowStateRef.current = workflowState;
  }, [workflowState]);

  // Real-time step execution status from MCP notifications
  // Maps step index to current status: 'pending' | 'running' | 'completed' | 'failed'
  const [liveStepStatus, setLiveStepStatus] = useState<{
    [stepIndex: number]: "pending" | "running" | "completed" | "failed";
  }>({});

  // Listen for real-time step progress events from MCP server
  useEffect(() => {
    const handleStepStarted = (e: CustomEvent<{ stepIndex: number; stepName: string; totalSteps?: number }>) => {
      console.log(`🔄 [WORKFLOW] Live: Step ${e.detail.stepIndex} started - ${e.detail.stepName}`);
      setLiveStepStatus(prev => ({
        ...prev,
        [e.detail.stepIndex]: "running",
      }));
      // Also update currentStep for UI highlight
      setCurrentStep(e.detail.stepIndex);
    };

    const handleStepCompleted = (e: CustomEvent<{ stepIndex: number; stepName: string; durationMs?: number }>) => {
      console.log(`✅ [WORKFLOW] Live: Step ${e.detail.stepIndex} completed - ${e.detail.stepName}`);
      setLiveStepStatus(prev => ({
        ...prev,
        [e.detail.stepIndex]: "completed",
      }));
    };

    const handleStepFailed = (e: CustomEvent<{ stepName: string; error: string }>) => {
      console.log(`❌ [WORKFLOW] Live: Step failed - ${e.detail.stepName}: ${e.detail.error}`);
      // Find step index by name if available, otherwise mark current step as failed
      setLiveStepStatus(prev => {
        // Find the running step and mark it as failed
        const runningStepIndex = Object.entries(prev).find(([, status]) => status === "running")?.[0];
        if (runningStepIndex !== undefined) {
          return { ...prev, [runningStepIndex]: "failed" };
        }
        return prev;
      });
    };

    window.addEventListener("workflow-step-started", handleStepStarted as EventListener);
    window.addEventListener("workflow-step-completed", handleStepCompleted as EventListener);
    window.addEventListener("workflow-step-failed", handleStepFailed as EventListener);

    return () => {
      window.removeEventListener("workflow-step-started", handleStepStarted as EventListener);
      window.removeEventListener("workflow-step-completed", handleStepCompleted as EventListener);
      window.removeEventListener("workflow-step-failed", handleStepFailed as EventListener);
    };
  }, []);

  // FIX: Listen for MCP transport errors to reset UI state when connection dies unexpectedly
  // This prevents the spinner from staying stuck when the SSE stream or transport closes
  useEffect(() => {
    const handleTransportError = (e: CustomEvent<{ reason: string; message: string }>) => {
      console.log(`🔌 [WORKFLOW] MCP transport error detected: ${e.detail.reason} - ${e.detail.message}`);
      // Reset execution state to prevent stuck spinner
      if (workflowStateRef.current === "executing") {
        console.log("🔌 [WORKFLOW] Resetting state due to transport error");
        setLiveStepStatus({});
        setWorkflowState("idle");
        isExecutingRef.current = false;
        setExecutingRange(null);
        setIsFullWorkflowMode(false);
      }
    };

    window.addEventListener("mcp-transport-error", handleTransportError as EventListener);

    return () => {
      window.removeEventListener("mcp-transport-error", handleTransportError as EventListener);
    };
  }, []);

  // Add ref to track if recording toggle is in progress
  const isProcessingToggleRef = useRef(false);

  // Add ref to track if loadWorkflows is in progress to prevent race conditions
  const isLoadingWorkflowsRef = useRef(false);
  // Store the in-progress loadWorkflows promise so concurrent callers can await it
  const loadWorkflowsPromiseRef = useRef<Promise<Workflow[]> | null>(null);
  // Synchronous guard to prevent concurrent step executions (React state is async)
  const isExecutingRef = useRef(false);

  // Runtime execution options (not persisted to workflow)
  const runtimeExecutionOptionsRef = useRef<{
    skip_preflight_check?: boolean;
  }>({});

  const { callTool, tools, serverInfo, serverInstructions } = useMcp();

  // Helper to get workflow inputs with ORG_TOKEN injected for KV access
  // The auth token allows workflows to use createKVClient(ORG_TOKEN) for persistent storage
  const getInputsWithAuth = useCallback(
    async (workflowInputs?: Record<string, unknown>): Promise<Record<string, unknown>> => {
      try {
        const authToken = await invoke<string | null>("get_stored_auth_token");
        if (authToken) {
          return {
            ...workflowInputs,
            ORG_TOKEN: authToken,
          };
        }
      } catch (err) {
        console.warn("[WORKFLOW] Could not get auth token for KV access:", err);
      }
      return workflowInputs || {};
    },
    []
  );

  // Permission helper: Check if current user can edit a workflow
  // NOTE: Frontend does basic checks; backend enforces actual permissions via workflow_organization_access
  const canEditWorkflow = useCallback(
    (workflow: Workflow | null): boolean => {
      if (!workflow || !workflow.id) return true; // Unsaved workflows are always editable

      // Get current user info from auth (use camelCase - backend sends camelCase)
      const userId = authStatus.user?.userId || authStatus.user?.user_id;
      const userEmail = authStatus.user?.email;
      const userOrgId = authStatus.user?.orgId || authStatus.user?.org_id;

      if (!userId) return false; // Not authenticated

      // Check permissions based on workflow ownership and organization membership

      // Check if user is owner (by userId OR email since created_by can store either)
      // Note: Legacy workflows store email in created_by, newer ones store userId
      if (workflow.createdBy === userId || (userEmail && workflow.createdBy === userEmail)) {
        console.log(`✅ [WORKFLOW] User is owner of workflow ${workflow.id}`);
        return true;
      }

      // Check if workflow belongs to user's organization
      if (workflow.organizationId === userOrgId) {
        console.log(`✅ [WORKFLOW] Workflow ${workflow.id} belongs to user's organization`);
        return true;
      }

      // If workflow has an organization (owned or potentially shared), allow edit attempt
      // Backend will enforce actual access level (read/write/admin) via workflow_organization_access table
      if (workflow.organizationId) {
        console.log(
          `⚠️ [WORKFLOW] Workflow ${workflow.id} belongs to different org - allowing edit (backend will enforce access level)`
        );
        return true;
      }

      // Globally public workflows (is_public = true) are read-only for external users
      // Note: Mediar org members can edit public workflows they own (checked above)
      if (workflow.isPublic === true) {
        console.log(
          `🔒 [WORKFLOW] Workflow ${workflow.id} is globally public and user has no ownership/org access (read-only)`
        );
        return false;
      }

      // Workflows with no organization_id (legacy or orphaned) are read-only
      console.log(`🔒 [WORKFLOW] Workflow ${workflow.id} has no organization - treating as read-only`);
      return false;
    },
    [authStatus]
  );

  // Deprecated: Local file operations no longer used with cloud storage
  const getWorkflowsDirectory = useCallback(async (): Promise<string> => {
    console.warn("⚠️ [WORKFLOW] getWorkflowsDirectory is deprecated - using cloud storage");
    return "cloud://workflows"; // Return placeholder for compatibility
  }, []);

  // REMOVED: resolveAbsoluteWorkflowPath() - No longer needed with cloud storage
  // REMOVED: tryImportTool() - No longer needed, YAML workflows deprecated
  // REMOVED: tryExportTool() - No longer needed, YAML workflows deprecated

  // Highlight step target element for user preview
  const highlightStepTarget = useCallback(
    async (step: SequenceStep, stepIndex: number) => {
      // Reset highlighting state
      setHighlightState(prev => ({
        ...prev,
        isActive: true,
        error: null,
        stepId: stepIndex,
        startTime: Date.now(),
        retryCount: 0,
      }));

      // Check if step can be highlighted
      if (!canHighlightStep(step)) {
        const effectiveTool = (step as any).tool_name ?? (step as any).tool;
        console.log("ℹ️ [HIGHLIGHT] Step cannot be highlighted:", effectiveTool);
        setHighlightState(prev => ({ ...prev, isActive: false }));
        return false;
      }

      // WORKAROUND: Due to MCP server not respecting duration_ms properly,
      // we may need to re-highlight periodically to maintain visibility
      // This is a temporary fix until the MCP server issue is resolved
      // const REHIGHLIGHT_INTERVAL = 800; // Re-highlight every 800ms
      // const MAX_REHIGHLIGHTS = 35; // For ~30 seconds total (35 * 800ms ≈ 28s)

      // Debug: Check what tools are available
      if (tools && Object.keys(tools).length > 0) {
      } else {
        console.warn("⚠️ [HIGHLIGHT] No tools available or tools not loaded");
      }

      // Try different possible tool names
      const possibleToolNames = [
        "mcp_terminator-mcp-agent_highlight_element",
        "highlight_element",
        "terminator_highlight_element",
      ];

      // Single-pass highlight attempt across available tool names (no retries)
      for (const toolName of possibleToolNames) {
        // Check if this tool exists
        if (tools && !tools[toolName]) {
          continue;
        }

        try {
          // Pass workflow context for client-side template substitution in highlighting
          const workflowContext = currentWorkflow?.content
            ? {
                variables: currentWorkflow.content.variables || {},
                selectors:
                  typeof currentWorkflow.content.selectors === "object" &&
                  !Array.isArray(currentWorkflow.content.selectors)
                    ? currentWorkflow.content.selectors
                    : {},
              }
            : undefined;

          const highlightArgs = createHighlightArgs(step, undefined, workflowContext);

          const startTime = Date.now();
          const result = await callTool(
            toolName,
            highlightArgs,
            undefined,
            undefined,
            undefined,
            currentWorkflow?.name,
            step.name as string
          );

          // Log how long the highlight call took
          console.log(`⏱️ [HIGHLIGHT] Tool call completed in ${Date.now() - startTime}ms`);

          // Check if the tool call was successful
          if (result && result.isError) {
            // Extract just the error type for concise logging
            const errorType = result.content.includes("ElementNotFound")
              ? "Element not found"
              : result.content.split("\n")[0];
            console.warn(`⚠️ [HIGHLIGHT] ${toolName} failed: ${errorType}`);
            // Continue to next tool name
            continue;
          }

          console.log("✅ [HIGHLIGHT] Successfully highlighted element for step:", step.name);
          return true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          console.warn(`⚠️ [HIGHLIGHT] Tool ${toolName} failed with exception:`, errorMessage);
          // Continue to next tool name
        }
      }

      // Final failure after trying all tool names once
      setHighlightState(prev => ({
        ...prev,
        isActive: false,
        error: `Could not highlight element: No highlighting tools available`,
      }));
      console.error("❌ [HIGHLIGHT] All highlight attempts failed for step:", step.name);
      return false;
    },
    [callTool, tools]
  );

  // Clear highlighting state
  const clearHighlight = useCallback(() => {
    setHighlightState(createInitialHighlightState());
  }, []);

  // Stop any active MCP-driven visual highlights (preview overlays, recorder overlays)
  const stopActiveHighlights = useCallback(async (): Promise<boolean> => {
    try {
      const candidateNames = ["stop_highlighting", "mcp_terminator-mcp-agent_stop_highlighting"];

      // Prefer available tool variant if tools list is known
      const prioritized = tools
        ? [
            ...candidateNames.filter(name => (tools as any)[name]),
            ...candidateNames.filter(name => !(tools as any)[name]),
          ]
        : candidateNames;

      for (const name of prioritized) {
        try {
          const res = await callTool(name, {}, undefined, undefined, undefined, currentWorkflow?.name);

          // Try to extract the count from various possible response shapes
          let stopped: unknown = (res as any)?.content?.highlights_stopped;
          if (stopped === undefined && Array.isArray(res) && (res as any)[0]?.text) {
            try {
              const parsed = JSON.parse((res as any)[0].text);
              stopped = parsed?.highlights_stopped;
            } catch (_) {
              // ignore parse errors; logging minimal to avoid noise
            }
          }

          console.log("🛑 [HIGHLIGHT] stop_highlighting -> stopped:", stopped ?? "unknown");
          return true;
        } catch (_e) {
          // Try next candidate name
        }
      }

      console.warn("⚠️ [HIGHLIGHT] No stop_highlighting tool available");
      return false;
    } catch (e) {
      console.warn("⚠️ [HIGHLIGHT] stop_highlighting failed:", e);
      return false;
    }
  }, [callTool, tools]);

  // Utility function to resolve absolute path for a workflow file
  // Commented out - not currently used
  /* const resolveWorkflowAbsolutePath = useCallback(async (fileName: string): Promise<string | undefined> => {
    try {
      console.log('📍 [WORKFLOW] Resolving absolute path for:', fileName);
      const absolutePathResult = await callTool('run_command', {
        windows_command: `powershell -Command "Resolve-Path 'workflows/${fileName}' | Select-Object -ExpandProperty Path"`,
        unix_command: `realpath "workflows/${fileName}"`
      });

      if (!absolutePathResult.isError) {
        const output = absolutePathResult.content?.output || absolutePathResult.content || '';
        const absolutePath = typeof output === 'string' ? output.trim() : undefined;
        console.log('📍 [WORKFLOW] Successfully resolved absolute path:', absolutePath);
        return absolutePath;
      } else {
        console.warn('⚠️ [WORKFLOW] Could not resolve absolute path for', fileName);
        return undefined;
      }
    } catch (error) {
      console.warn('⚠️ [WORKFLOW] Error resolving absolute path for', fileName, ':', error);
      return undefined;
    }
  }, [callTool]); */

  // REMOVED: loadWorkflowsFromFileList() - No longer needed with cloud storage
  // REMOVED: createInitialWorkflowsOnDisk() - No longer needed with cloud storage

  // Save successful workflow execution to cloud (updates via API)
  const saveWorkflowExecution = useCallback(
    async (workflow: Workflow, executionSteps: any[], isSuccessful: boolean = true): Promise<void> => {
      try {
        // Merge executionSteps back into UI workflow model (if provided)
        if (Array.isArray(executionSteps) && executionSteps.length > 0) {
          const uiArgs = (workflow as any)?.content?.arguments;
          if (uiArgs && Array.isArray(uiArgs.steps)) {
            uiArgs.steps = uiArgs.steps.map((s: any, idx: number) => {
              const exec = executionSteps[idx];
              if (!exec) return s;
              return {
                ...s,
                tool_name: exec.tool_name ?? exec.tool ?? s.tool_name ?? s.tool,
                arguments: exec.arguments ?? exec.parameters ?? s.arguments ?? s.parameters ?? {},
              };
            });
          }
        }

        // TypeScript workflows are synced via file system, not cloud YAML export
        console.log("📁 TypeScript workflow - cloud sync handled separately, ID:", workflow.id);
      } catch (error) {
        console.error("❌ [WORKFLOW] Error updating workflow:", error);
        throw error;
      }
    },
    []
  );

  // REMOVED: parseYamlWorkflow() - No longer needed with cloud storage

  // Load workflows from cloud API
  // Returns the loaded workflows array for callers that need immediate access
  const loadWorkflows = useCallback(async (): Promise<Workflow[]> => {
    // If a load is already in progress, wait for it instead of returning []
    // This fixes race condition where concurrent downloads would get empty arrays
    if (isLoadingWorkflowsRef.current && loadWorkflowsPromiseRef.current) {
      console.log("⏳ [WORKFLOW] loadWorkflows already in progress, waiting for existing promise...");
      return loadWorkflowsPromiseRef.current;
    }

    isLoadingWorkflowsRef.current = true;
    setIsLoading(true);
    const allWorkflows: Workflow[] = [];

    // Create and store the promise so concurrent callers can await it
    const loadPromise = (async () => {
      try {
        // 1. Load local TypeScript workflows first
        try {
          console.log("📂 [WORKFLOW] Loading local TypeScript workflows...");
          const localWorkflows = await invoke<
            Array<{
              id: string;
              name: string;
              description: string | null;
              version: string | null;
              path: string;
              created_at: string;
              modified_at: string;
              cloud_id: string | null; // Cloud UUID from sync.json (github_folder)
            }>
          >("list_local_typescript_workflows");

          if (localWorkflows && localWorkflows.length > 0) {
            console.log(`✅ [WORKFLOW] Found ${localWorkflows.length} local TypeScript workflows`);

            // Parse step counts from terminator.ts for each workflow
            const { TypeScriptWorkflowParser } = await import("@/lib/typescript-workflow-parser");
            const parser = new TypeScriptWorkflowParser();

            const stepCounts = await Promise.all(
              localWorkflows.map(async ts => {
                try {
                  const files = await invoke<{
                    id: string;
                    terminator_ts: string;
                    steps: Array<{ path: string; content: string; is_step: boolean }>;
                    package_json: string;
                  }>("read_typescript_workflow_files", { workflowId: ts.id });
                  const parsed = parser.parseWorkflow(files.terminator_ts);
                  return parsed.steps.length;
                } catch {
                  return 0;
                }
              })
            );

            // Convert local TypeScript workflows to frontend Workflow format
            const tsWorkflows: Workflow[] = localWorkflows.map((ts, index) => ({
              id: ts.id, // Folder name - used for local file operations via Tauri commands
              name: ts.name,
              description: ts.description || "",
              stepCount: stepCounts[index],
              lastModified: ts.modified_at,
              isOriginal: true,
              content: { steps: [] }, // Will be populated when workflow is selected
              isModified: false,
              parseError: undefined,
              localPath: ts.path, // Store local path for TypeScript workflows
              cloudId: ts.cloud_id || undefined, // Cloud UUID for cloud sync (chat sessions, etc.)
              currentVersion: ts.version || "1.0.0",
              totalVersions: 1,
            }));

            allWorkflows.push(...tsWorkflows);
          } else {
            console.log("ℹ️ [WORKFLOW] No local TypeScript workflows found");
          }
        } catch (error) {
          console.warn("⚠️ [WORKFLOW] Failed to load local TypeScript workflows:", error);
          // Continue to load cloud workflows even if local fails
        }

        // 2. Load cloud TypeScript workflows (only those with github_folder)
        try {
          console.log("📂 [WORKFLOW] Loading TypeScript workflows from backend...");
          const summaries = await invoke<
            Array<{
              id: number;
              name: string;
              description: string;
              step_count: number;
              last_modified: string;
              created_at: string;
              created_by?: string;
              organization_id?: string;
              is_public?: boolean;
              author_name?: string | null;
              current_version?: string;
              latest_version?: string;
              total_versions?: number;
              github_folder?: string; // UUID folder name for TypeScript workflows (legacy)
              uuid?: string; // Workflow UUID for zip download endpoint
              tags?: string[]; // Tags for filtering/categorization
              is_featured?: boolean; // Featured workflows always appear for all users
            }>
          >("list_saved_workflows");

          if (summaries && summaries.length > 0) {
            // Filter to only TypeScript workflows (those with github_folder)
            const tsOnlySummaries = summaries.filter(s => s.github_folder);
            console.log(
              `✅ [WORKFLOW] Found ${tsOnlySummaries.length} TypeScript workflows from backend (filtered from ${summaries.length} total)`
            );

            // Convert backend summaries to frontend Workflow format
            const cloudWorkflows: Workflow[] = tsOnlySummaries.map(summary => ({
              id: summary.github_folder!, // Use github_folder as ID for TypeScript workflows
              name: summary.name,
              description: summary.description,
              stepCount: summary.step_count,
              lastModified: summary.last_modified,
              isOriginal: true,
              content: { steps: [] }, // Will be populated when workflow is selected
              isModified: false,
              parseError: undefined,
              // Map permission fields from backend
              createdBy: summary.created_by,
              organizationId: summary.organization_id,
              isPublic: summary.is_public,
              authorName: summary.author_name,
              // Map version fields from backend
              currentVersion: summary.latest_version || summary.current_version,
              latestVersion: summary.latest_version,
              totalVersions: summary.total_versions,
              // TypeScript workflow fields
              githubFolder: summary.github_folder,
              uuid: summary.uuid,
              tags: summary.tags,
              isFeatured: summary.is_featured,
            }));

            // Merge cloud metadata (isPublic, organizationId) into local workflows
            // Local workflows don't have these fields - they come from the cloud API
            const cloudWorkflowMap = new Map(
              cloudWorkflows.flatMap(cw => {
                const entries: [string, typeof cw][] = [[cw.id, cw]];
                if (cw.uuid) entries.push([cw.uuid, cw]);
                return entries;
              })
            );

            allWorkflows.forEach(w => {
              if (w.localPath) {
                const cloudVersion = cloudWorkflowMap.get(w.id);
                // Debug: trace version merge for local workflows
                console.log(
                  `[WORKFLOW] Version merge for ${w.id}: found=${!!cloudVersion}, cloud.latestVersion=${cloudVersion?.latestVersion}, local.currentVersion=${w.currentVersion}`
                );
                if (cloudVersion) {
                  // Cloud is source of truth for name/description - sync to local display
                  // This ensures renames from web dashboard are reflected in desktop app
                  if (cloudVersion.name && cloudVersion.name !== w.name) {
                    console.log(
                      `[WORKFLOW] Name sync: "${w.name}" -> "${cloudVersion.name}" (cloud is source of truth)`
                    );
                    w.name = cloudVersion.name;
                  }
                  if (cloudVersion.description && cloudVersion.description !== w.description) {
                    w.description = cloudVersion.description;
                  }
                  w.isPublic = cloudVersion.isPublic;
                  w.organizationId = cloudVersion.organizationId;
                  // Keep local currentVersion, set latestVersion from cloud for update detection
                  w.latestVersion = cloudVersion.latestVersion;
                  w.totalVersions = cloudVersion.totalVersions;
                  w.authorName = cloudVersion.authorName;
                  w.createdBy = cloudVersion.createdBy;
                  w.tags = cloudVersion.tags;
                }
              }
            });

            // Get local workflow IDs to filter out duplicates
            // Local folder names can match either github_folder (published from here) or uuid (downloaded from cloud)
            const localIds = new Set(allWorkflows.filter(w => w.localPath).map(w => w.id));

            // Only add cloud workflows that don't exist locally (cloud-only)
            // Check both id (github_folder) AND uuid since downloaded workflows use uuid as folder name
            const cloudOnlyWorkflows = cloudWorkflows.filter(
              cw => !localIds.has(cw.id) && (!cw.uuid || !localIds.has(cw.uuid))
            );
            allWorkflows.push(...cloudOnlyWorkflows);

            console.log(
              `📥 [WORKFLOW] Added ${cloudOnlyWorkflows.length} cloud-only workflows (${cloudWorkflows.length - cloudOnlyWorkflows.length} already local)`
            );
          } else {
            console.log("ℹ️ [WORKFLOW] No TypeScript workflows found in backend");
          }
        } catch (error) {
          console.error("❌ [WORKFLOW] Failed to load cloud workflows from backend:", error);
        }

        // 3. Identify cloud-only TypeScript workflows (exist in cloud but not locally)
        // Local TypeScript workflows have string IDs (the UUID folder name)
        const localTsIds = new Set(
          allWorkflows.filter(w => typeof w.id === "string" && w.localPath).map(w => w.id as string)
        );

        // Mark cloud workflows with uuid that don't exist locally as cloud-only
        // Use uuid for matching (new zip download uses uuid as folder name)
        allWorkflows.forEach(w => {
          if (w.uuid && !localTsIds.has(w.uuid)) {
            w.isCloudOnly = true;
          }
        });

        // Set combined workflows list
        setWorkflows(allWorkflows);

        // CRITICAL FIX: Update currentWorkflow if it's in the reloaded list
        // This ensures renames and other metadata changes persist through refresh
        if (currentWorkflowRef.current?.id) {
          const updatedCurrentWorkflow = allWorkflows.find(w => w.id === currentWorkflowRef.current?.id);
          if (updatedCurrentWorkflow) {
            // Preserve the full content from currentWorkflow (steps, yamlContent, etc.)
            // but update metadata (name, description, etc.) from the fresh backend data
            setCurrentWorkflow(prev => {
              const updated = prev
                ? {
                    ...prev,
                    name: updatedCurrentWorkflow.name,
                    description: updatedCurrentWorkflow.description,
                    stepCount: updatedCurrentWorkflow.stepCount,
                    lastModified: updatedCurrentWorkflow.lastModified,
                    createdBy: updatedCurrentWorkflow.createdBy,
                    organizationId: updatedCurrentWorkflow.organizationId,
                    isPublic: updatedCurrentWorkflow.isPublic,
                    localPath: updatedCurrentWorkflow.localPath,
                    // CRITICAL: Preserve rawEvents from recording (don't lose them when metadata is updated)
                    rawEvents: prev.rawEvents,
                  }
                : null;
              console.log(
                "✅ [WORKFLOW] Updated currentWorkflow metadata from reload (rawEvents preserved:",
                !!prev?.rawEvents,
                ")"
              );
              return updated;
            });
          }
        }
      } finally {
        setIsLoading(false);
        isLoadingWorkflowsRef.current = false;
        loadWorkflowsPromiseRef.current = null;
      }
      return allWorkflows;
    })();

    loadWorkflowsPromiseRef.current = loadPromise;
    return loadPromise;
  }, []);

  // Unified workflow initialization - handles both existing workflows and new recording workflows
  const initializeWorkflow = useCallback(
    async (
      workflowIdOrName: string | null,
      isNewWorkflow: boolean = false,
      customName?: string,
      actualLocalPath?: string,
      freshWorkflows?: Workflow[] // Optional fresh workflows array to avoid stale closure
    ) => {
      if (isNewWorkflow) {
        // Create new workflow
        const workflowId = workflowIdOrName;
        const isTypescriptWorkflow = typeof workflowIdOrName === "string";
        const workflowName = customName || (isTypescriptWorkflow ? workflowIdOrName : "New Workflow");

        // For TypeScript workflows, load the files
        let files: TypeScriptWorkflowFile[] = [];
        let parsedContent: any = { steps: [] };

        // Helper to convert FileTreeNode to TypeScriptWorkflowFile and inject content
        const convertTreeWithContent = (
          nodes: FileTreeNode[],
          contentMap: Map<string, { content: string; isStepFile: boolean }>
        ): TypeScriptWorkflowFile[] => {
          return nodes.map(node => {
            const normalizedPath = node.path.replace(/\\/g, "/");
            const fileData = contentMap.get(normalizedPath);
            return {
              name: node.name,
              path: normalizedPath,
              isDirectory: node.isDirectory,
              content: fileData?.content,
              isStepFile: fileData?.isStepFile,
              children: node.children ? convertTreeWithContent(node.children, contentMap) : undefined,
            };
          });
        };

        // Get workflows directory for constructing full path
        let workflowsDir: string | undefined;
        if (isTypescriptWorkflow && workflowIdOrName) {
          try {
            workflowsDir = await invoke<string>("get_workflows_directory");
          } catch (error) {
            console.warn("⚠️ [WORKFLOW] Failed to get workflows directory:", error);
          }
        }

        if (isTypescriptWorkflow && workflowIdOrName) {
          try {
            console.log("📂 [WORKFLOW] Loading TypeScript workflow:", workflowIdOrName);

            // Load file tree (metadata only, no content) - instant
            const treeResult = await invoke<{
              workflow_id: string;
              root: FileTreeNode[];
            }>("read_workflow_file_tree", {
              workflowId: workflowIdOrName,
            });
            console.log(`✅ [WORKFLOW] Loaded file tree with ${treeResult.root.length} root items`);

            // Load only terminator.ts, package.json, and step files for parsing
            const filesResult = await invoke<{
              id: string;
              terminator_ts: string;
              steps: Array<{ path: string; content: string; is_step: boolean }>;
              package_json: string;
            }>("read_typescript_workflow_files", {
              workflowId: workflowIdOrName,
            });

            // Prepare workflow (install dependencies) - don't block UI but track state
            setIsPreparingWorkflow(true);
            toast.loading("Installing dependencies...", { id: "workflow-prep", duration: Infinity });
            invoke<boolean>("prepare_typescript_workflow", { workflowId: workflowIdOrName })
              .then(async success => {
                if (success) {
                  console.log("✅ [WORKFLOW] Dependencies installed");
                  toast.dismiss("workflow-prep");

                  // Refresh file tree after deps install (node_modules events are filtered by Rust)
                  try {
                    const freshTree = await invoke<{ root: FileTreeNode[] }>("read_workflow_file_tree", {
                      workflowId: workflowIdOrName,
                    });
                    console.log(`🌳 [WORKFLOW] Refreshing tree after deps install: ${freshTree.root.length} items`);

                    setCurrentWorkflow(prev => {
                      if (!prev || prev.id !== workflowIdOrName) return prev;

                      // Collect existing content (including mimeType for images)
                      const existingContent = new Map<
                        string,
                        { content?: string; isStepFile?: boolean; mimeType?: string }
                      >();
                      const collect = (items: TypeScriptWorkflowFile[] | undefined) => {
                        if (!items) return;
                        for (const f of items) {
                          if (!f.isDirectory && f.content !== undefined) {
                            existingContent.set(f.path.replace(/\\/g, "/"), {
                              content: f.content,
                              isStepFile: f.isStepFile,
                              mimeType: f.mimeType,
                            });
                          }
                          if (f.children) collect(f.children);
                        }
                      };
                      collect(prev.files);

                      // Convert fresh tree, preserving content
                      const convert = (nodes: FileTreeNode[]): TypeScriptWorkflowFile[] =>
                        nodes.map(n => {
                          const p = n.path.replace(/\\/g, "/");
                          const existing = existingContent.get(p);
                          return {
                            name: n.name,
                            path: p,
                            isDirectory: n.isDirectory,
                            content: existing?.content,
                            isStepFile: existing?.isStepFile ?? p.includes("/steps/"),
                            mimeType: existing?.mimeType,
                            children: n.children ? convert(n.children) : undefined,
                          };
                        });

                      return { ...prev, files: convert(freshTree.root) };
                    });
                  } catch (e) {
                    console.error("❌ [WORKFLOW] Failed to refresh tree after deps:", e);
                  }
                } else {
                  console.warn("⚠️ [WORKFLOW] Dependency installation failed");
                  toast.error("Failed to install dependencies", { id: "workflow-prep" });
                }
              })
              .catch(err => {
                console.error("❌ [WORKFLOW] Failed to prepare workflow:", err);
                toast.error("Failed to install dependencies", { id: "workflow-prep" });
              })
              .finally(() => setIsPreparingWorkflow(false));

            // Build content map for injection into tree
            const contentMap = new Map<string, { content: string; isStepFile: boolean }>();
            contentMap.set("src/terminator.ts", { content: filesResult.terminator_ts, isStepFile: false });
            contentMap.set("package.json", { content: filesResult.package_json, isStepFile: false });
            for (const s of filesResult.steps) {
              contentMap.set(s.path.replace(/\\/g, "/"), { content: s.content, isStepFile: s.is_step });
            }

            // Convert tree and inject content
            files = convertTreeWithContent(treeResult.root, contentMap);
            console.log(`✅ [WORKFLOW] Loaded file tree with ${contentMap.size} files having content`);

            // Parse the workflow to extract steps, inputs, etc.
            // Use filesResult.terminator_ts directly to avoid race condition with tree content injection
            const { TypeScriptWorkflowParser } = await import("@/lib/typescript-workflow-parser");
            const parser = new TypeScriptWorkflowParser();
            if (filesResult.terminator_ts) {
              console.log("[WORKFLOW] Parsing terminator.ts directly from filesResult (new workflow)");
              const result = parser.parseWorkflow(filesResult.terminator_ts);
              // Enrich imported steps with line numbers by parsing their source files
              // Build flatFiles directly from filesResult to avoid tree content injection race
              const flatFiles: Array<{ path: string; content: string }> = [
                { path: "src/terminator.ts", content: filesResult.terminator_ts },
                { path: "package.json", content: filesResult.package_json },
                ...filesResult.steps.map(s => ({ path: s.path.replace(/\\/g, "/"), content: s.content })),
              ];
              parser.enrichStepsWithLineNumbers(result.steps, flatFiles);
              console.log("[WORKFLOW] Parsed sections:", result.sections);
              parsedContent = {
                steps: result.steps || [],
                inputs: result.inputSchema,
                hasOnSuccess: result.hasOnSuccess,
                hasOnError: result.hasOnError,
                trigger: result.trigger,
                sections: result.sections,
              };
            }
          } catch (error) {
            console.warn("⚠️ [WORKFLOW] Failed to load TypeScript workflow:", error);
          }
        }

        const newWorkflow: Workflow = {
          id: workflowId,
          name: workflowName,
          description: isTypescriptWorkflow
            ? `TypeScript workflow: ${workflowName}`
            : "Currently recording a new workflow",
          content: parsedContent,
          stepCount: parsedContent.steps?.length || 0,
          lastModified: new Date().toISOString(),
          isOriginal: false,
          isNewRecording: true,
          currentVersion: "1.0.0",
          totalVersions: 1,
          // TypeScript workflow specific fields
          files: isTypescriptWorkflow ? files : undefined,
          localPath: actualLocalPath
            ? actualLocalPath.replace(/\\/g, "/")
            : isTypescriptWorkflow && workflowsDir
              ? `${workflowsDir}/${workflowIdOrName}`.replace(/\\/g, "/")
              : undefined,
          inputs: parsedContent.inputs,
          hasOnSuccess: parsedContent.hasOnSuccess,
          hasOnError: parsedContent.hasOnError,
          trigger: parsedContent.trigger,
          sections: parsedContent.sections,
        };

        console.log(
          "📋 [WORKFLOW] Initialized workflow with ID:",
          workflowId,
          isTypescriptWorkflow ? "(TypeScript)" : "(Cloud)"
        );

        // Clear execution logs for new workflows (they shouldn't have any logs yet)
        setWorkflowExecutionLogs({});
        setLogsRefreshKey(prev => prev + 1);

        setCurrentWorkflow(newWorkflow);
        setCurrentStep(-1);
        setStepResult(undefined);
        setWorkflowState("idle");
        // Clear execution logs to prevent state bleeding from previous workflow
        setWorkflowExecutionLogs({});
        return;
      }

      // Handle existing workflow
      // Use freshWorkflows if provided to avoid stale closure issues after downloads
      const workflowsToSearch = freshWorkflows || workflows;
      const cachedWorkflow = workflowsToSearch.find(w => w.id === workflowIdOrName);
      if (!cachedWorkflow) {
        console.warn(
          `[WORKFLOW] initializeWorkflow: workflow ${workflowIdOrName} not found in ${freshWorkflows ? "fresh" : "cached"} workflows (count: ${workflowsToSearch.length})`
        );
        return;
      }
      console.log(
        `[WORKFLOW] initializeWorkflow: found workflow in ${freshWorkflows ? "fresh" : "cached"} list, localPath: ${cachedWorkflow.localPath || "undefined"}`
      );

      // Detect TypeScript workflow by string ID
      const isTypescriptWorkflow = typeof workflowIdOrName === "string";

      // Set loading state for this specific workflow (number for cloud, string for TypeScript)
      if (workflowIdOrName !== null) {
        setLoadingWorkflowId(workflowIdOrName);
      }

      try {
        // Try to reload the workflow to get the latest version
        let workflowToStart = cachedWorkflow; // Fallback to cached version

        // TypeScript workflow - load files from local folder
        if (isTypescriptWorkflow && workflowIdOrName) {
          try {
            console.log("📂 [WORKFLOW] Loading TypeScript workflow:", workflowIdOrName);

            // Load file tree (metadata only, no content) - instant
            const treeResult = await invoke<{
              workflow_id: string;
              root: FileTreeNode[];
            }>("read_workflow_file_tree", {
              workflowId: workflowIdOrName,
            });
            console.log(`✅ [WORKFLOW] Loaded file tree with ${treeResult.root.length} root items`);

            // Load essential files for parsing
            const filesResult = await invoke<{
              id: string;
              terminator_ts: string;
              steps: Array<{ path: string; content: string; is_step: boolean }>;
              package_json: string;
            }>("read_typescript_workflow_files", {
              workflowId: workflowIdOrName,
            });

            // Prepare workflow (install dependencies) - don't block UI but track state
            setIsPreparingWorkflow(true);
            toast.loading("Installing dependencies...", { id: "workflow-prep", duration: Infinity });
            invoke<boolean>("prepare_typescript_workflow", { workflowId: workflowIdOrName })
              .then(async success => {
                if (success) {
                  console.log("✅ [WORKFLOW] Dependencies installed");
                  toast.dismiss("workflow-prep");

                  // Refresh file tree after deps install (node_modules events are filtered by Rust)
                  try {
                    const freshTree = await invoke<{ root: FileTreeNode[] }>("read_workflow_file_tree", {
                      workflowId: workflowIdOrName,
                    });
                    console.log(`🌳 [WORKFLOW] Refreshing tree after deps install: ${freshTree.root.length} items`);

                    setCurrentWorkflow(prev => {
                      if (!prev || prev.id !== workflowIdOrName) return prev;

                      // Collect existing content (including mimeType for images)
                      const existingContent = new Map<
                        string,
                        { content?: string; isStepFile?: boolean; mimeType?: string }
                      >();
                      const collect = (items: TypeScriptWorkflowFile[] | undefined) => {
                        if (!items) return;
                        for (const f of items) {
                          if (!f.isDirectory && f.content !== undefined) {
                            existingContent.set(f.path.replace(/\\/g, "/"), {
                              content: f.content,
                              isStepFile: f.isStepFile,
                              mimeType: f.mimeType,
                            });
                          }
                          if (f.children) collect(f.children);
                        }
                      };
                      collect(prev.files);

                      // Convert fresh tree, preserving content
                      const convert = (nodes: FileTreeNode[]): TypeScriptWorkflowFile[] =>
                        nodes.map(n => {
                          const p = n.path.replace(/\\/g, "/");
                          const existing = existingContent.get(p);
                          return {
                            name: n.name,
                            path: p,
                            isDirectory: n.isDirectory,
                            content: existing?.content,
                            isStepFile: existing?.isStepFile ?? p.includes("/steps/"),
                            mimeType: existing?.mimeType,
                            children: n.children ? convert(n.children) : undefined,
                          };
                        });

                      return { ...prev, files: convert(freshTree.root) };
                    });
                  } catch (e) {
                    console.error("❌ [WORKFLOW] Failed to refresh tree after deps:", e);
                  }
                } else {
                  console.warn("⚠️ [WORKFLOW] Dependency installation failed");
                  toast.error("Failed to install dependencies", { id: "workflow-prep" });
                }
              })
              .catch(err => {
                console.error("❌ [WORKFLOW] Failed to prepare workflow:", err);
                toast.error("Failed to install dependencies", { id: "workflow-prep" });
              })
              .finally(() => setIsPreparingWorkflow(false));

            // Build content map for injection into tree
            const contentMap = new Map<string, { content: string; isStepFile: boolean }>();
            contentMap.set("src/terminator.ts", { content: filesResult.terminator_ts, isStepFile: false });
            contentMap.set("package.json", { content: filesResult.package_json, isStepFile: false });
            for (const s of filesResult.steps) {
              contentMap.set(s.path.replace(/\\/g, "/"), { content: s.content, isStepFile: s.is_step });
            }

            // Helper to convert FileTreeNode to TypeScriptWorkflowFile and inject content
            const convertTreeWithContent = (
              nodes: FileTreeNode[],
              cMap: Map<string, { content: string; isStepFile: boolean }>
            ): TypeScriptWorkflowFile[] => {
              return nodes.map(node => {
                const normalizedPath = node.path.replace(/\\/g, "/");
                const fileData = cMap.get(normalizedPath);
                return {
                  name: node.name,
                  path: normalizedPath,
                  isDirectory: node.isDirectory,
                  content: fileData?.content,
                  isStepFile: fileData?.isStepFile,
                  children: node.children ? convertTreeWithContent(node.children, cMap) : undefined,
                };
              });
            };

            // Convert tree and inject content
            const files = convertTreeWithContent(treeResult.root, contentMap);
            console.log(`✅ [WORKFLOW] Loaded file tree with ${contentMap.size} files having content`);

            // Parse the workflow to extract steps, inputs, etc.
            // Use filesResult.terminator_ts directly to avoid race condition with tree content injection
            const { TypeScriptWorkflowParser } = await import("@/lib/typescript-workflow-parser");
            const parser = new TypeScriptWorkflowParser();
            let parsedContent: any = { steps: [] };
            if (filesResult.terminator_ts) {
              console.log("[WORKFLOW] Parsing terminator.ts directly from filesResult");
              const result = parser.parseWorkflow(filesResult.terminator_ts);
              // Enrich imported steps with line numbers by parsing their source files
              // Build flatFiles directly from filesResult to avoid tree content injection race
              const flatFiles: Array<{ path: string; content: string }> = [
                { path: "src/terminator.ts", content: filesResult.terminator_ts },
                { path: "package.json", content: filesResult.package_json },
                ...filesResult.steps.map(s => ({ path: s.path.replace(/\\/g, "/"), content: s.content })),
              ];
              parser.enrichStepsWithLineNumbers(result.steps, flatFiles);
              console.log("[WORKFLOW] Parsed sections (startWorkflow):", result.sections);
              parsedContent = {
                steps: result.steps || [],
                inputs: result.inputSchema,
                hasOnSuccess: result.hasOnSuccess,
                hasOnError: result.hasOnError,
                trigger: result.trigger,
                sections: result.sections,
              };
            }

            const tsWorkflow: Workflow = {
              id: workflowIdOrName,
              name: cachedWorkflow.name,
              description: cachedWorkflow.description,
              stepCount: parsedContent.steps?.length || 0,
              lastModified: cachedWorkflow.lastModified,
              isOriginal: true,
              content: parsedContent,
              isModified: false,
              currentVersion: cachedWorkflow.currentVersion || "1.0.0",
              totalVersions: 1,
              // TypeScript workflow specific fields
              files,
              localPath: cachedWorkflow.localPath,
              inputs: parsedContent.inputs,
              hasOnSuccess: parsedContent.hasOnSuccess,
              hasOnError: parsedContent.hasOnError,
              trigger: parsedContent.trigger,
              sections: parsedContent.sections,
            };

            workflowToStart = tsWorkflow;
            console.log(
              "✅ [WORKFLOW] Successfully loaded TypeScript workflow with",
              parsedContent.steps?.length || 0,
              "steps"
            );
          } catch (error) {
            console.error("❌ [WORKFLOW] Failed to load TypeScript workflow:", error);
          }
        }

        // 🎯 CLEAR FOCUS STATE: Start fresh for new workflow
        // Focus will be captured after the first successful step execution

        try {
          await focusManager.clearFocusCache();
        } catch (focusError) {
          console.warn("⚠️ [WORKFLOW] Failed to clear focus cache, but continuing:", focusError);
        }

        // Clear execution logs when switching workflows (will be restored if available)
        const previousWorkflowId = currentWorkflow?.id;
        const newWorkflowId = workflowToStart.id;
        if (previousWorkflowId !== newWorkflowId) {
          console.log(
            `🧹 [WORKFLOW] Clearing execution logs - switching from workflow ${previousWorkflowId} to ${newWorkflowId}`
          );
          setWorkflowExecutionLogs({});
          setLogsRefreshKey(prev => prev + 1);
        }

        setCurrentWorkflow(workflowToStart);
        setCurrentStep(0);
        setStepResult(undefined);
        setWorkflowState("idle");

        // Fetch and restore latest execution logs if available (only for existing workflows with IDs)
        // NOTE: fetchLatestExecutionLogs function needs to be implemented in dev-log-uploader service
        // For now, logs are loaded on-demand per step via file system
        if (workflowToStart.id) {
          // Load execution state from local state.json file
          try {
            console.log(`📥 [WORKFLOW] Loading execution state for workflow ${workflowToStart.id}...`);
            const stateData = await invoke<{
              last_updated: string;
              last_step_id: string | null;
              last_step_index: number;
              workflow_id: string | null;
              env: Record<string, unknown>;
            } | null>("get_workflow_execution_state", {
              workflowId: workflowToStart.id.toString(),
            });

            if (stateData) {
              console.log(`✅ [WORKFLOW] Loaded execution state, last step index: ${stateData.last_step_index}`);
              setWorkflowExecutionState({
                lastUpdated: stateData.last_updated,
                lastStepIndex: stateData.last_step_index,
                env: stateData.env || {},
              });
            } else {
              console.log(`ℹ️ [WORKFLOW] No execution state found for workflow ${workflowToStart.id}`);
              setWorkflowExecutionState(null);
            }
          } catch (stateError) {
            console.warn(`⚠️ [WORKFLOW] Failed to load execution state:`, stateError);
            setWorkflowExecutionState(null);
          }
        } else {
          // No workflow ID, clear logs and state
          setWorkflowExecutionLogs({});
          setWorkflowExecutionState(null);
        }
      } catch (error) {
        console.error("❌ [WORKFLOW] Error initializing workflow:", error);
        throw error; // Re-throw to let caller handle
      } finally {
        // Always clear loading state, even on error
        setLoadingWorkflowId(null);
      }
    },
    [workflows, tools, callTool]
  );

  // Legacy wrapper for existing workflow start
  const startWorkflow = useCallback(
    async (workflowId: string | null, freshWorkflows?: Workflow[]) => {
      return initializeWorkflow(workflowId, false, undefined, undefined, freshWorkflows);
    },
    [initializeWorkflow]
  );

  // Create a new local TypeScript workflow project
  // Creates folder structure similar to `terminator init`
  const startRecordingWorkflow = useCallback(
    async (workflowName?: string) => {
      const name = workflowName || "New Workflow";

      // Create local TypeScript workflow folder
      console.log("🆕 [WORKFLOW] Creating new TypeScript workflow:", name);
      const result = await invoke<{ id: string; path: string; name: string }>("create_typescript_workflow", {
        input: { name, description: `Workflow: ${name}` },
      });

      console.log("✅ [WORKFLOW] Created TypeScript workflow:", result.id, "at", result.path);

      // Reload workflows to include the new one
      await loadWorkflows();

      // Initialize with the UUID and actual local path
      return initializeWorkflow(result.id, true, name, result.path);
    },
    [initializeWorkflow, loadWorkflows]
  );

  // NOTE: ensureWorkflowFile removed - was dead code (never called), used YAML stringification

  // Helper function to get step ID by index
  const getStepIdByIndex = useCallback((workflow: Workflow, index: number): string | undefined => {
    const step = workflow.content.steps[index];
    if (!step) return undefined;

    // Use the step's id field if it exists, otherwise generate one from the name
    if ("id" in step && typeof step.id === "string") {
      return step.id;
    }

    // Fallback: generate ID from name (snake_case) if name exists
    if ("name" in step && typeof step.name === "string") {
      return step.name
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
    }

    // Last fallback: use index
    return `step_${index}`;
  }, []);

  // Actually execute the step (called when user accepts or for auto-execution)
  // providedInputs: Optional inputs collected from the user before execution
  const doExecuteStep = useCallback(
    async (stepIndex?: number, providedInputs?: Record<string, unknown>) => {
      const doExecuteStepStart = performance.now();
      console.log("[PERF] doExecuteStep started");

      const stepToExecute = stepIndex ?? currentStep;
      if (!currentWorkflow || stepToExecute >= currentWorkflow.content.steps.length) return;

      // Reset terminator mode to "act" before execution (clears any ask/x mode restrictions from chat)
      // This ensures direct sidebar execution always works regardless of chat mode state
      const mcpPort = serverInfo?.port;
      if (mcpPort) {
        try {
          await invoke("set_terminator_mode", {
            mcpPort,
            mode: "act",
            blockedTools: [],
          });
          console.log("[WORKFLOW] Reset terminator mode to 'act' for direct execution");
        } catch (e) {
          console.warn("[WORKFLOW] Failed to reset terminator mode:", e);
        }
      }

      console.log("🚀 [WORKFLOW] Executing step using execute_sequence:", stepToExecute + 1);

      // Clear previous status and immediately mark new step as running
      // This prevents race condition where stale currentStep + stepResult shows wrong step as failed
      setLiveStepStatus({ [stepToExecute]: "running" });

      const step = currentWorkflow.content.steps[stepToExecute];
      setWorkflowState("executing");

      // Create new abort controller for this step execution
      workflowAbortControllerRef.current = new AbortController();

      // Check if app minimization is disabled
      const savedAppMinimization = localStorage.getItem("disable_app_minimization");
      const disableAppMinimization = savedAppMinimization === null ? true : savedAppMinimization === "true";

      const uiPrepStart = performance.now();
      if (!disableAppMinimization) {
        // Minimize main window and show execution bar
        try {
          const currentWindow = getCurrentWindow();
          await currentWindow.minimize();
          console.log("🪟 App window minimized - execution in progress");
        } catch (minimizeError) {
          console.warn("⚠️ Could not minimize window:", minimizeError);
        }

        // Show execution bar with initial progress
        try {
          await invoke("show_execution_bar");
          console.log("✅ Execution bar shown");

          // Emit initial progress
          await emit("execution-progress-update", {
            currentStep: stepToExecute,
            totalSteps: currentWorkflow.content.steps.length,
            stepName: step.name || step.id || `Step ${stepToExecute + 1}`,
            mode: "single",
          });
        } catch (barError) {
          console.warn("⚠️ Could not show execution bar:", barError);
        }
      } else {
        console.log("🔍 App minimization disabled - keeping main window visible");
      }

      console.log(`[PERF] UI prep (minimize): ${(performance.now() - uiPrepStart).toFixed(1)}ms`);

      // HIGHLIGHTING DISABLED - Commented out cleanup
      // Stop any active preview overlays immediately, then clear local state
      // await stopActiveHighlights();
      // Clear highlighting since we're now executing
      // clearHighlight();

      // Start tracking this step's execution (declare outside try for error handling)
      const stepStartTime = Date.now();
      const currentStepLogs: ConsoleLogEntry[] = [];

      try {
        // Get the step ID for execute_sequence
        const stepId = getStepIdByIndex(currentWorkflow, stepToExecute);
        if (!stepId) {
          throw new Error(`Could not determine step ID for step ${stepToExecute}`);
        }

        console.log(`🎯 Executing step ID: ${stepId} (workflow_id: ${currentWorkflow.id})`);

        // Clear previous progress when starting a new step
        setStepProgress({
          consoleLogs: [],
          progressInfo: {},
          lastUpdate: Date.now(),
        });

        // Create progress callback for execute_sequence
        const progressCallback = (progress: any) => {
          const newLog: ConsoleLogEntry = {
            timestamp: progress.timestamp || Date.now(),
            message: progress.message || "",
            level: progress.level || "log",
          };

          // Store in current step logs
          currentStepLogs.push(newLog);

          setStepProgress(prev => {
            const updatedLogs = [...prev.consoleLogs, newLog];
            const progressInfo = parseProgressFromConsole(updatedLogs);

            return {
              consoleLogs: updatedLogs,
              progressInfo,
              lastUpdate: Date.now(),
            };
          });
        };

        // Prepare steps with injected arguments (IDs should already be present from recording/cloud)
        const stepsWithLogsEnabled = currentWorkflow.content.steps.map((step: any) => {
          // Build up injected arguments without early returns (allows multiple injections per step)
          const injectedArgs = { ...(step.arguments || {}) };

          // Inject include_logs: true for run_command (always works correctly)
          if (step.tool_name === "run_command") {
            injectedArgs.include_logs = true;
          }

          // Conditionally inject include_logs for execute_browser_script based on global localStorage setting
          if (step.tool_name === "execute_browser_script") {
            const savedBrowserScriptLogs = localStorage.getItem("disable_browser_script_logs");
            const disableBrowserScriptLogs = savedBrowserScriptLogs === null ? true : savedBrowserScriptLogs === "true";
            injectedArgs.include_logs = !disableBrowserScriptLogs;
          }

          // Inject window management flags for tools with 'process' argument (matches server.rs logic)
          if (step.arguments?.process) {
            const disableWindowManagement = localStorage.getItem("disable_window_management") === "true";
            injectedArgs.enable_window_management = !disableWindowManagement;

            const disableBringToFront = localStorage.getItem("disable_bring_to_front") === "true";
            injectedArgs.bring_to_front = !disableBringToFront;

            const disableMaximizeTarget = localStorage.getItem("disable_maximize_target") === "true";
            injectedArgs.maximize_target = !disableMaximizeTarget;

            // Default to false (disabled) - only enable if user explicitly set disable_minimize_always_on_top to "false"
            const enableMinimizeAlwaysOnTop = localStorage.getItem("disable_minimize_always_on_top") === "false";
            injectedArgs.minimize_always_on_top = enableMinimizeAlwaysOnTop;
          }

          return { ...step, arguments: injectedArgs };
        });

        console.log(`🎯 Executing step: ${stepId}`);
        console.log(`📊 Total steps in workflow: ${stepsWithLogsEnabled.length}`);

        // Check if the step itself is an execute_sequence call (nested workflow)
        const stepToolName = step.tool_name ?? step.tool;
        const isNestedExecuteSequence = stepToolName === "execute_sequence";

        let result;
        const callToolStart = performance.now();

        if (isNestedExecuteSequence) {
          // For nested execute_sequence, call it directly with its arguments
          console.log("🔄 [WORKFLOW] Detected nested execute_sequence, calling directly");
          const nestedArgs = step.arguments || {};
          result = await callTool(
            "execute_sequence",
            nestedArgs,
            workflowAbortControllerRef.current?.signal,
            progressCallback,
            300000,
            currentWorkflow?.name,
            (step as any).name || ""
          );
          console.log(`[PERF] callTool (nested execute_sequence): ${(performance.now() - callToolStart).toFixed(1)}ms`);
        } else {
          // For regular steps, wrap in execute_sequence with start/end step
          // Use workflow_id for env state persistence (no temp files needed!)
          // Pass steps inline with include_logs injected
          const skipPreflightValue =
            runtimeExecutionOptionsRef.current.skip_preflight_check ?? currentWorkflow.content.skip_preflight_check;

          // Get inputs with ORG_TOKEN for KV access
          // Use provided inputs from dialog if available, otherwise fall back to workflow content inputs
          const inputsWithAuth = await getInputsWithAuth(
            providedInputs ?? (currentWorkflow.content.inputs as Record<string, unknown>)
          );

          // For TypeScript workflows, use URL-based execution (like web app's rust-executor)
          // For YAML workflows, pass steps inline
          const isTypeScriptWorkflow = !!currentWorkflow.localPath;
          const executeParams = isTypeScriptWorkflow
            ? {
                url: `file:///${currentWorkflow.localPath!.replace(/\\/g, "/")}/src/terminator.ts`,
                workflow_id: currentWorkflow.id?.toString(),
                inputs: inputsWithAuth,
                start_from_step: stepId,
                end_at_step: stepId,
                ...(skipPreflightValue !== undefined && { skip_preflight_check: skipPreflightValue }),
              }
            : {
                workflow_id: currentWorkflow.id?.toString(),
                steps: stepsWithLogsEnabled,
                variables: currentWorkflow.content.variables,
                inputs: inputsWithAuth,
                selectors: currentWorkflow.content.selectors,
                start_from_step: stepId,
                end_at_step: stepId,
                ...(skipPreflightValue !== undefined && { skip_preflight_check: skipPreflightValue }),
              };

          console.log("📦 [DEBUG] execute_sequence params:", {
            workflow_id: executeParams.workflow_id,
            isTypeScript: isTypeScriptWorkflow,
            url: isTypeScriptWorkflow ? (executeParams as any).url : undefined,
            steps_count: isTypeScriptWorkflow ? undefined : (executeParams as any).steps?.length,
            start_from_step: (executeParams as any).start_from_step,
            end_at_step: (executeParams as any).end_at_step,
            skip_preflight_check: (executeParams as any).skip_preflight_check,
          });

          result = await callTool(
            "execute_sequence",
            executeParams,
            workflowAbortControllerRef.current?.signal,
            progressCallback,
            300000,
            currentWorkflow?.name,
            (step as any).name || ""
          );
          console.log(`[PERF] callTool (execute_sequence): ${(performance.now() - callToolStart).toFixed(1)}ms`);
        }

        // Process the result from execute_sequence

        // Check for validation errors (invalid step) in the non-exception path
        // useMcp.ts returns { isError: true, originalError: {...} } instead of throwing
        if (result.isError && result.originalError?.data?.error_type === "invalid_step") {
          console.log("[WORKFLOW] Detected validation error - invalid step:", result.originalError.data);
          window.dispatchEvent(
            new CustomEvent("workflow-validation-error", {
              detail: {
                stepIndex: result.originalError.data.step_index,
                stepId: result.originalError.data.step_id,
                isInExecutionRange: result.originalError.data.is_in_execution_range,
                executionRange: result.originalError.data.execution_range,
                message: result.content || "Invalid step",
                workflowName: currentWorkflow?.name,
                workflowId: currentWorkflow?.id,
              },
            })
          );
        }

        // Check for workflow-level execution errors (module errors, syntax errors, etc.)
        // These have exit_code and stderr in originalError.data
        // Track if we show the execution error modal (to skip AI analysis)
        let showedExecutionErrorModal = false;
        if (
          result.isError &&
          result.originalError?.data &&
          result.originalError.data.error_type !== "invalid_step" &&
          (result.originalError.data.exit_code !== undefined || result.originalError.data.stderr)
        ) {
          console.log("[WORKFLOW] Detected workflow execution error:", result.originalError.data);
          showedExecutionErrorModal = true;
          window.dispatchEvent(
            new CustomEvent("workflow-execution-error", {
              detail: {
                errorData: result.originalError.data,
                message: result.content || "Workflow execution failed",
                workflowName: currentWorkflow?.name,
                workflowId: currentWorkflow?.id,
              },
            })
          );
        }

        // Extract logs and output from the result
        let outputValue: unknown = null; // Store raw object, not stringified
        let actualContent: any = null;
        if (!result.isError && result.content) {
          const toolName = step.tool_name ?? step.tool;

          // Handle array-wrapped content (MCP returns content as an array)
          actualContent = result.content;
          if (Array.isArray(actualContent) && actualContent.length > 0) {
            actualContent = actualContent[0];
          }

          // Handle text-wrapped JSON responses (MCP wraps responses in {type: 'text', text: '...'})
          if (
            actualContent &&
            typeof actualContent === "object" &&
            actualContent.type === "text" &&
            actualContent.text
          ) {
            try {
              actualContent = JSON.parse(actualContent.text);
            } catch (e) {
              console.warn("⚠️ [WORKFLOW] Failed to parse text content as JSON:", e);
            }
          }

          // Extract logs from the MCP response structure
          // For execute_sequence results, logs are in: content[0].results[n].logs
          if (actualContent && typeof actualContent === "object") {
            // Check if this is an execute_sequence response with logs
            if (actualContent.action === "execute_sequence" && actualContent.results) {
              // This is a full workflow execution result
              const results = actualContent.results;
              if (Array.isArray(results) && results.length > 0) {
                const lastResult = results[results.length - 1];
                if (lastResult.logs && Array.isArray(lastResult.logs)) {
                  // Add logs to currentStepLogs and update step progress
                  lastResult.logs.forEach((logMessage: string) => {
                    const newLog = {
                      timestamp: Date.now(),
                      message: logMessage,
                      level: "log" as const,
                    };
                    currentStepLogs.push(newLog);

                    // Also update step progress for real-time display
                    setStepProgress(prev => {
                      const updatedLogs = [...prev.consoleLogs, newLog];
                      const progressInfo = parseProgressFromConsole(updatedLogs);
                      return {
                        consoleLogs: updatedLogs,
                        progressInfo,
                        lastUpdate: Date.now(),
                      };
                    });
                  });
                  console.log(`📋 [WORKFLOW] Captured ${lastResult.logs.length} logs from step execution`);
                }
              }
            } else if (actualContent.logs && Array.isArray(actualContent.logs)) {
              // Direct logs array in the result
              actualContent.logs.forEach((logMessage: string) => {
                const newLog = {
                  timestamp: Date.now(),
                  message: logMessage,
                  level: "log" as const,
                };
                currentStepLogs.push(newLog);

                // Also update step progress for real-time display
                setStepProgress(prev => {
                  const updatedLogs = [...prev.consoleLogs, newLog];
                  const progressInfo = parseProgressFromConsole(updatedLogs);
                  return {
                    consoleLogs: updatedLogs,
                    progressInfo,
                    lastUpdate: Date.now(),
                  };
                });
              });
              console.log(`📋 [WORKFLOW] Captured ${actualContent.logs.length} logs from step execution`);
            }
          }

          if (toolName === "run_command" && typeof actualContent === "object") {
            // For run_command, extract stdout and stderr as string
            const stdout = actualContent.stdout || "";
            const stderr = actualContent.stderr || "";
            outputValue = stdout + (stderr ? "\n--- stderr ---\n" + stderr : "");

            // Also check for logs field in run_command result
            if (actualContent.logs && Array.isArray(actualContent.logs)) {
              // Add these logs to currentStepLogs if not already added
              actualContent.logs.forEach((logMessage: string) => {
                // Check if not already added (to avoid duplicates)
                if (!currentStepLogs.some(log => log.message === logMessage)) {
                  const newLog = {
                    timestamp: Date.now(),
                    message: logMessage,
                    level: "log" as const,
                  };
                  currentStepLogs.push(newLog);

                  // Also update step progress for real-time display
                  setStepProgress(prev => {
                    const updatedLogs = [...prev.consoleLogs, newLog];
                    const progressInfo = parseProgressFromConsole(updatedLogs);
                    return {
                      consoleLogs: updatedLogs,
                      progressInfo,
                      lastUpdate: Date.now(),
                    };
                  });
                }
              });
              console.log(`📋 [WORKFLOW] Captured ${actualContent.logs.length} logs from run_command`);
            }

            // Single concise log for output
            if (stdout || stderr) {
              const outputStr = outputValue as string;
              console.log(
                "📝 [WORKFLOW] Command output:",
                outputStr.substring(0, 200) + (outputStr.length > 200 ? "..." : "")
              );
            }
          } else {
            // For other tools, store the actual content (not stringified) to preserve ui_tree newlines
            outputValue = actualContent;
          }
        }

        // Check for partial failure (completed_with_errors) or full failure
        let partialFailure = false;
        let fullFailure = false;
        let wasCancelledByUser = false;
        const failedTools: Array<{ tool_name: string; index: number; error: string }> = [];

        if (!result.isError && actualContent && typeof actualContent === "object") {
          // Check if execute_sequence completed with errors
          if (actualContent.status === "completed_with_errors" && actualContent.results) {
            partialFailure = true;

            // Extract failed tool information
            if (Array.isArray(actualContent.results)) {
              actualContent.results.forEach((toolResult: any, idx: number) => {
                if (
                  toolResult.status === "execution_error" ||
                  toolResult.status === "error" ||
                  toolResult.status === "executed_with_error"
                ) {
                  // Use ?? not || - toolResult.index could be 0 which is falsy
                  failedTools.push({
                    tool_name: toolResult.tool_name || "Unknown tool",
                    index: toolResult.index ?? idx,
                    error: toolResult.error || "Unknown error",
                  });
                }
              });
            }

            console.warn("⚠️ [WORKFLOW] Step completed with errors:", failedTools);
          } else if (actualContent.status === "cancelled") {
            // Handle cancelled status for single step execution
            partialFailure = true;
            wasCancelledByUser = true;
            console.warn("⚠️ [WORKFLOW] Step execution was cancelled by user");
          } else if (actualContent.status === "failed" || actualContent.status === "executed_with_error") {
            // Handle full failure - entire execution failed
            fullFailure = true;

            // Extract error details from results if available
            if (actualContent.results && Array.isArray(actualContent.results)) {
              actualContent.results.forEach((toolResult: any, idx: number) => {
                if (toolResult.error) {
                  // Use ?? not || - toolResult.index could be 0 which is falsy
                  failedTools.push({
                    tool_name: toolResult.tool_name || "Unknown tool",
                    index: toolResult.index ?? idx,
                    error: toolResult.error || "Unknown error",
                  });
                }
              });
            }

            console.error("❌ [WORKFLOW] Step execution failed:", failedTools.length > 0 ? failedTools : actualContent);
          }
        }

        const stepResult: StepResult = {
          success: !result.isError && !partialFailure && !fullFailure,
          output: outputValue,
          // Error extraction priority: 1) MCP error (parsed), 2) failed tool error, 3) actualContent.error
          // Note: Don't use actualContent.message as error - it may be a success message like "Workflow completed"
          error: result.isError
            ? typeof result.content === "string"
              ? parseMcpError(result.content)
              : result.content
            : failedTools.length > 0
              ? failedTools[0].error
              : actualContent?.error || undefined,
          partialFailure,
          failedTools: failedTools.length > 0 ? failedTools : undefined,
        };

        if (!result.isError) {
          setTimeout(async () => {
            try {
              await focusManager.captureFocusState();
            } catch (focusError) {
              console.warn("⚠️ [WORKFLOW] Failed to capture focus state, but continuing:", focusError);
            }
          }, 200);
        }

        console.log(`[PERF] doExecuteStep total: ${(performance.now() - doExecuteStepStart).toFixed(1)}ms`);
        setStepResult(stepResult);

        // Store execution logs for this step
        const stepEndTime = Date.now();
        // Extract detailed error data from MCP response if available
        const errorData = result.originalError?.data;
        const stderr = errorData?.stderr;
        const stdout = errorData?.stdout;
        const errorLogs = errorData?.logs;
        const exitCode = errorData?.exit_code;
        setWorkflowExecutionLogs(prev => {
          const updatedLogs = {
            ...prev,
            [stepToExecute]: {
              stepName: "name" in step && typeof step.name === "string" ? step.name : `Step ${stepToExecute + 1}`,
              tool:
                "tool_name" in step && typeof step.tool_name === "string"
                  ? step.tool_name
                  : "tool" in step && typeof step.tool === "string"
                    ? step.tool
                    : "execute_sequence",
              consoleLogs: currentStepLogs,
              result: stepResult,
              fullResult: result, // Store the complete tool response
              startTime: stepStartTime,
              endTime: stepEndTime,
              error: stepResult.error,
              // Store detailed error data for display in Response tab
              stderr,
              stdout,
              errorLogs,
              exitCode,
            },
          };

          return updatedLogs;
        });

        // Trigger logs UI refresh - increment key so SectionView reloads from file
        setLogsRefreshKey(prev => prev + 1);

        // Update execution state from response (for single step execution)
        if (actualContent && (actualContent.state || actualContent.env)) {
          const envData = actualContent.state || actualContent.env;
          setWorkflowExecutionState({
            lastUpdated: new Date().toISOString(),
            lastStepIndex: actualContent.last_step_index ?? stepToExecute,
            env: envData,
          });
          console.log("✅ [WORKFLOW] Updated execution state from single step response");
        }

        setWorkflowState("idle");
        console.log("[WORKFLOW-AUTO-TRIGGER-REMOVED] Block 1 removed - use button in error dialog");

        // Close execution bar and restore window
        const savedAppMinimizationRestore = localStorage.getItem("disable_app_minimization");
        const disableAppMinimizationRestore =
          savedAppMinimizationRestore === null ? true : savedAppMinimizationRestore === "true";
        if (!disableAppMinimizationRestore) {
          try {
            await invoke("close_execution_bar");
            console.log("✅ Execution bar closed");
          } catch (barError) {
            console.warn("⚠️ Could not close execution bar:", barError);
          }
        }

        if (!disableAppMinimizationRestore) {
          try {
            const currentWindow = getCurrentWindow();
            await currentWindow.unminimize();
            await currentWindow.setFocus();
            console.log("🪟 App window restored after execution");
          } catch (restoreError) {
            console.warn("⚠️ Could not restore window:", restoreError);
          }
        }

        // Return the execution result for AI tools
        return { stepResult, fullResult: result };
      } catch (error) {
        console.log(`[PERF] doExecuteStep total (error): ${(performance.now() - doExecuteStepStart).toFixed(1)}ms`);

        // Check if this is a workflow validation error (invalid step)
        const errorAny = error as any;
        const originalErrorData = errorAny?.originalError?.data;
        const isValidationError = originalErrorData?.error_type === "invalid_step";

        // Check if this is a workflow execution error (module errors, syntax errors, etc.)
        // These have exit_code and stderr in originalError.data
        const isExecutionError =
          originalErrorData &&
          originalErrorData.error_type !== "invalid_step" &&
          (originalErrorData.exit_code !== undefined || originalErrorData.stderr);

        let showedExecutionErrorModalInCatch = false;

        if (isValidationError) {
          console.log("[WORKFLOW] Detected validation error - invalid step:", originalErrorData);
          window.dispatchEvent(
            new CustomEvent("workflow-validation-error", {
              detail: {
                stepIndex: originalErrorData.step_index,
                stepId: originalErrorData.step_id,
                isInExecutionRange: originalErrorData.is_in_execution_range,
                executionRange: originalErrorData.execution_range,
                message: error instanceof Error ? error.message : "Invalid step",
                workflowName: currentWorkflow?.name,
                workflowId: currentWorkflow?.id,
              },
            })
          );
        } else if (isExecutionError) {
          console.log("[WORKFLOW] Detected workflow execution error (exception path):", originalErrorData);
          showedExecutionErrorModalInCatch = true;
          window.dispatchEvent(
            new CustomEvent("workflow-execution-error", {
              detail: {
                errorData: originalErrorData,
                message: error instanceof Error ? error.message : "Workflow execution failed",
                workflowName: currentWorkflow?.name,
                workflowId: currentWorkflow?.id,
              },
            })
          );
        }

        const stepResult: StepResult = {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : "Unknown error occurred",
        };

        setStepResult(stepResult);
        setWorkflowState("idle");
        console.log("[WORKFLOW-AUTO-TRIGGER-REMOVED] Block 2 removed - use button in error dialog");

        // Upload execution logs even on error for AI debugging
        if (currentWorkflow?.id) {
          const stepEndTime = Date.now();
          const executionId = `${currentWorkflow.id}-${stepStartTime}`;

          // Create execution log entry for failed step
          // Extract detailed error data from originalErrorData (already extracted above)
          const stderrCatch = originalErrorData?.stderr;
          const stdoutCatch = originalErrorData?.stdout;
          const errorLogsCatch = originalErrorData?.logs;
          const exitCodeCatch = originalErrorData?.exit_code;
          console.log("[WORKFLOW] Storing failed execution log with errorData:", {
            hasErrorData: !!originalErrorData,
            stderr: stderrCatch?.slice(0, 100),
            exitCode: exitCodeCatch,
          });
          const failedStepLog = {
            [stepToExecute]: {
              stepName: "name" in step && typeof step.name === "string" ? step.name : `Step ${stepToExecute + 1}`,
              tool:
                "tool_name" in step && typeof step.tool_name === "string"
                  ? step.tool_name
                  : "tool" in step && typeof step.tool === "string"
                    ? step.tool
                    : "execute_sequence",
              consoleLogs: currentStepLogs,
              result: stepResult,
              fullResult: { isError: true, content: stepResult.error }, // Store error as fullResult
              startTime: stepStartTime,
              endTime: stepEndTime,
              error: stepResult.error,
              // Store detailed error data for display in Response tab
              stderr: stderrCatch,
              stdout: stdoutCatch,
              errorLogs: errorLogsCatch,
              exitCode: exitCodeCatch,
            },
          };

          // Update in-memory logs so UI can display the error immediately
          setWorkflowExecutionLogs(prev => ({
            ...prev,
            ...failedStepLog,
          }));

          // Trigger logs UI refresh - increment key so SectionView reloads from file
          setLogsRefreshKey(prev => prev + 1);
          console.log("[DEBUG logsRefreshKey] Incremented after failed step execution");
        }

        // Close execution bar and restore window on error
        const savedAppMinimizationError = localStorage.getItem("disable_app_minimization");
        const disableAppMinimizationError =
          savedAppMinimizationError === null ? true : savedAppMinimizationError === "true";
        if (!disableAppMinimizationError) {
          try {
            await invoke("close_execution_bar");
            console.log("✅ Execution bar closed");
          } catch (barError) {
            console.warn("⚠️ Could not close execution bar:", barError);
          }
        }

        if (!disableAppMinimizationError) {
          try {
            const currentWindow = getCurrentWindow();
            await currentWindow.unminimize();
            await currentWindow.setFocus();
            console.log("🪟 App window restored after execution error");
          } catch (restoreError) {
            console.warn("⚠️ Could not restore window:", restoreError);
          }
        }

        // Return error result for AI tools
        return {
          stepResult,
          fullResult: {
            isError: true,
            content: [{ type: "text", text: stepResult.error || "Unknown error" }],
          },
        };
      }
    },
    [currentWorkflow, currentStep, callTool, clearHighlight, getStepIdByIndex, serverInfo]
  );

  // Execute full workflow from beginning (for "Run All Steps" button)
  // providedInputs: Optional inputs collected from the user before execution
  const executeFullWorkflow = useCallback(
    async (providedInputs?: Record<string, unknown>) => {
      if (!currentWorkflow || currentWorkflow.content.steps.length === 0) {
        console.warn("[WORKFLOW] No workflow to execute");
        return;
      }

      // Guard: Prevent duplicate execution - same as executeStep
      if (isExecutingRef.current) {
        console.warn("⚠️ [WORKFLOW] Full workflow execution already in progress (ref guard), ignoring duplicate call");
        return;
      }

      // Reset terminator mode to "act" before execution (clears any ask/x mode restrictions from chat)
      const mcpPort = serverInfo?.port;
      if (mcpPort) {
        try {
          await invoke("set_terminator_mode", {
            mcpPort,
            mode: "act",
            blockedTools: [],
          });
          console.log("[WORKFLOW] Reset terminator mode to 'act' for full workflow execution");
        } catch (e) {
          console.warn("[WORKFLOW] Failed to reset terminator mode:", e);
        }
      }

      console.log("🚀 [WORKFLOW] Executing all workflow steps from beginning");

      // Clear previous status and immediately mark first step as running
      // This prevents race condition where stale currentStep + stepResult shows wrong step as failed
      setLiveStepStatus({ 0: "running" });

      // Reset state.json since we're starting from beginning
      try {
        console.log("🔄 [WORKFLOW] Resetting state.json for fresh execution");
        await invoke("reset_workflow_state", { workflowId: String(currentWorkflow.id) });
        setWorkflowExecutionState(null);
      } catch (resetError) {
        console.warn("⚠️ [WORKFLOW] Failed to reset state:", resetError);
      }

      const firstStep = currentWorkflow.content.steps[0];
      isExecutingRef.current = true; // Set ref BEFORE state to prevent race conditions
      setWorkflowState("executing");
      setCurrentStep(0);
      setIsFullWorkflowMode(true); // Enable full workflow mode for UI visualization

      // Create new abort controller for workflow execution
      workflowAbortControllerRef.current = new AbortController();

      // Check if app minimization is disabled
      const savedAppMinimization = localStorage.getItem("disable_app_minimization");
      const disableAppMinimization = savedAppMinimization === null ? true : savedAppMinimization === "true";

      if (!disableAppMinimization) {
        // Minimize main window and show execution bar
        try {
          const currentWindow = getCurrentWindow();
          await currentWindow.minimize();
          console.log("🪟 App window minimized - full workflow execution in progress");
        } catch (minimizeError) {
          console.warn("⚠️ Could not minimize window:", minimizeError);
        }

        // Show execution bar with initial progress
        try {
          await invoke("show_execution_bar");
          console.log("✅ Execution bar shown for full workflow");

          // Emit initial progress
          await emit("execution-progress-update", {
            currentStep: 0,
            totalSteps: currentWorkflow.content.steps.length,
            stepName: firstStep.name || firstStep.id || "Step 1",
            mode: "full",
          });
        } catch (barError) {
          console.warn("⚠️ Could not show execution bar:", barError);
        }
      } else {
        console.log("🔍 App minimization disabled - keeping main window visible during full workflow");
      }

      // HIGHLIGHTING DISABLED - Commented out cleanup
      // Stop any active preview overlays immediately
      // await stopActiveHighlights();
      // clearHighlight();

      // Start tracking workflow execution (declare outside try for error handling)
      const workflowStartTime = Date.now();
      const allStepLogs: ConsoleLogEntry[] = [];

      try {
        console.log(`🎯 Executing entire workflow from beginning to end (workflow_id: ${currentWorkflow.id})`);

        // Clear previous progress
        setStepProgress({
          consoleLogs: [],
          progressInfo: {},
          lastUpdate: Date.now(),
        });

        // Create progress callback for execute_sequence
        const progressCallback = (progress: any) => {
          const newLog: ConsoleLogEntry = {
            timestamp: progress.timestamp || Date.now(),
            message: progress.message || "",
            level: progress.level || "log",
          };

          allStepLogs.push(newLog);

          setStepProgress(prev => {
            const updatedLogs = [...prev.consoleLogs, newLog];
            const progressInfo = parseProgressFromConsole(updatedLogs);

            return {
              consoleLogs: updatedLogs,
              progressInfo,
              lastUpdate: Date.now(),
            };
          });
        };

        // Prepare steps with injected arguments (IDs should already be present from recording/cloud)
        const stepsWithLogsEnabled = (currentWorkflow.content.steps || []).map((step: any) => {
          // Build up injected arguments without early returns (allows multiple injections per step)
          const injectedArgs = { ...(step.arguments || {}) };

          // Inject include_logs: true for run_command (always works correctly)
          if (step.tool_name === "run_command") {
            injectedArgs.include_logs = true;
          }

          // Conditionally inject include_logs for execute_browser_script based on global localStorage setting
          if (step.tool_name === "execute_browser_script") {
            const savedBrowserScriptLogs = localStorage.getItem("disable_browser_script_logs");
            const disableBrowserScriptLogs = savedBrowserScriptLogs === null ? true : savedBrowserScriptLogs === "true";
            injectedArgs.include_logs = !disableBrowserScriptLogs;
          }

          // Inject window management flags for tools with 'process' argument (matches server.rs logic)
          if (step.arguments?.process) {
            const disableWindowManagement = localStorage.getItem("disable_window_management") === "true";
            injectedArgs.enable_window_management = !disableWindowManagement;

            const disableBringToFront = localStorage.getItem("disable_bring_to_front") === "true";
            injectedArgs.bring_to_front = !disableBringToFront;

            const disableMaximizeTarget = localStorage.getItem("disable_maximize_target") === "true";
            injectedArgs.maximize_target = !disableMaximizeTarget;

            // Default to false (disabled) - only enable if user explicitly set disable_minimize_always_on_top to "false"
            const enableMinimizeAlwaysOnTop = localStorage.getItem("disable_minimize_always_on_top") === "false";
            injectedArgs.minimize_always_on_top = enableMinimizeAlwaysOnTop;
          }

          return { ...step, arguments: injectedArgs };
        });

        // Execute full workflow - use workflow_id for env state persistence
        const skipPreflightValue =
          runtimeExecutionOptionsRef.current.skip_preflight_check ?? currentWorkflow.content.skip_preflight_check;

        // Get inputs with ORG_TOKEN for KV access
        // Use provided inputs from dialog if available, otherwise fall back to workflow content inputs
        const inputsWithAuth = await getInputsWithAuth(
          providedInputs ?? (currentWorkflow.content.inputs as Record<string, unknown>)
        );

        // For TypeScript workflows, use URL-based execution (like web app's rust-executor)
        // For YAML workflows, pass steps inline
        const isTypeScriptWorkflow = !!currentWorkflow.localPath;
        const executeParams = isTypeScriptWorkflow
          ? {
              url: `file:///${currentWorkflow.localPath!.replace(/\\/g, "/")}/src/terminator.ts`,
              workflow_id: currentWorkflow.id?.toString(),
              inputs: inputsWithAuth,
              ...(skipPreflightValue !== undefined && { skip_preflight_check: skipPreflightValue }),
              // No start_from_step or end_at_step - run entire workflow
            }
          : {
              workflow_id: currentWorkflow.id?.toString(),
              steps: stepsWithLogsEnabled,
              variables: currentWorkflow.content.variables,
              inputs: inputsWithAuth,
              selectors: currentWorkflow.content.selectors,
              ...(skipPreflightValue !== undefined && { skip_preflight_check: skipPreflightValue }),
              // No start_from_step or end_at_step - run entire workflow
            };

        console.log("📦 [DEBUG] execute_sequence params for full workflow:", {
          workflow_id: executeParams.workflow_id,
          isTypeScript: isTypeScriptWorkflow,
          url: isTypeScriptWorkflow ? (executeParams as any).url : undefined,
          steps_count: isTypeScriptWorkflow ? undefined : (executeParams as any).steps?.length,
          note: "Running entire workflow from beginning to end",
        });

        const result = await callTool(
          "execute_sequence",
          executeParams,
          workflowAbortControllerRef.current?.signal,
          progressCallback,
          600000,
          currentWorkflow?.name,
          "Full Workflow"
        );

        // Process the result from execute_sequence
        let outputValue: unknown = null; // Store raw object, not stringified
        let actualContent: any = null;

        // Parse content even when there's an error - failure details are often in the content
        if (result.content) {
          // Handle array-wrapped content
          actualContent = result.content;
          if (Array.isArray(actualContent) && actualContent.length > 0) {
            actualContent = actualContent[0];
          }

          // Handle text-wrapped JSON responses
          if (
            actualContent &&
            typeof actualContent === "object" &&
            actualContent.type === "text" &&
            actualContent.text
          ) {
            try {
              actualContent = JSON.parse(actualContent.text);
            } catch (e) {
              console.warn("⚠️ [WORKFLOW] Failed to parse text content as JSON:", e);
            }
          }

          // Extract logs from execute_sequence results
          if (
            actualContent &&
            typeof actualContent === "object" &&
            actualContent.results &&
            Array.isArray(actualContent.results)
          ) {
            // Process all step results
            actualContent.results.forEach((stepResult: any, index: number) => {
              if (stepResult.logs && Array.isArray(stepResult.logs)) {
                stepResult.logs.forEach((logMessage: string) => {
                  const newLog = {
                    timestamp: Date.now(),
                    message: logMessage,
                    level: "log" as const,
                  };
                  allStepLogs.push(newLog);
                });
              }

              // Store execution logs for each step
              // Use stepResult.index (actual step position) not forEach index
              const actualStepIndex = stepResult.index ?? index;
              const stepData = currentWorkflow.content.steps[actualStepIndex];

              // Extract full result from env if available
              const stepId = stepResult.step_id || `step_${actualStepIndex}`;
              const envResultKey = `${stepId}_result`;
              const fullEnvResult =
                actualContent.env && actualContent.env[envResultKey]
                  ? Array.isArray(actualContent.env[envResultKey])
                    ? actualContent.env[envResultKey][0]
                    : actualContent.env[envResultKey]
                  : null;

              setWorkflowExecutionLogs(prev => ({
                ...prev,
                [actualStepIndex]: {
                  stepName:
                    stepResult.step_name ||
                    stepResult.tool_name ||
                    (stepData && "name" in stepData ? stepData.name : `Step ${actualStepIndex + 1}`),
                  tool: stepResult.tool_name || "execute_sequence",
                  consoleLogs: stepResult.logs
                    ? stepResult.logs.map((msg: string) => ({
                        timestamp: Date.now(),
                        message: msg,
                        level: "log" as const,
                      }))
                    : [],
                  result: {
                    success: stepResult.status === "executed_without_error",
                    skipped: stepResult.status === "skipped" || stepResult.executed === false,
                    // Use raw result object (fullEnvResult or stepResult.result) to preserve ui_tree newlines
                    output: fullEnvResult || stepResult.result || stepResult.output || stepResult.stdout || null,
                    error: stepResult.error,
                  },
                  fullResult: fullEnvResult, // Store complete env result with all data
                  startTime: workflowStartTime,
                  endTime: Date.now(),
                  // Standardize error field: use top-level error (critical for logs tab and AI analysis)
                  error: stepResult.error || undefined,
                },
              }));
            });

            // Trigger logs UI refresh after storing all step logs
            setLogsRefreshKey(prev => prev + 1);

            // Use executed_tools count if available (from fixed MCP server), otherwise count non-skipped results
            const executedCount =
              actualContent.executed_tools ??
              actualContent.results.filter((r: any) => r.executed !== false && r.status !== "skipped").length;
            const totalCount = actualContent.total_results ?? actualContent.results.length;
            // Store the full actualContent to preserve ui_tree formatting
            outputValue = actualContent;
            console.log(
              `✅ [WORKFLOW] ${
                executedCount === totalCount
                  ? `Executed ${executedCount} steps successfully`
                  : `Executed ${executedCount} steps (${totalCount - executedCount} skipped)`
              }`
            );

            // Update execution state from response (state contains env variables)
            if (actualContent.state || actualContent.env) {
              const envData = actualContent.state || actualContent.env;
              setWorkflowExecutionState({
                lastUpdated: new Date().toISOString(),
                lastStepIndex: actualContent.last_step_index ?? null,
                env: envData,
              });
              console.log("✅ [WORKFLOW] Updated execution state from response");
            }
          } else {
            // Store actual content (not stringified) to preserve ui_tree newlines
            outputValue = actualContent;

            // If result.isError and we have error info but no results array, create a log entry for the error
            // This handles cases where the workflow fails before any steps execute (build errors, etc.)
            if (result.isError && typeof result.content === "string" && currentWorkflow.content.steps.length > 0) {
              // Parse MCP error string to extract actual error message
              const errorMessage = parseMcpError(result.content);

              // CRITICAL: Extract last_step_index from error response BEFORE setting error log
              // This prevents incorrectly logging error at step 0 when actual failure was at a later step
              let failedStepIndex = 0; // Default to first step for build errors
              const errorWorkflowResult = result.originalError?.data?.workflow_result;
              if (errorWorkflowResult?.result?.last_step_index !== undefined) {
                failedStepIndex = errorWorkflowResult.result.last_step_index;
                console.log(
                  `[WORKFLOW] Error at step ${failedStepIndex} (extracted from workflow_result.result.last_step_index)`
                );
              } else if (errorWorkflowResult?.state?.lastStepIndex !== undefined) {
                failedStepIndex = errorWorkflowResult.state.lastStepIndex;
                console.log(
                  `[WORKFLOW] Error at step ${failedStepIndex} (extracted from workflow_result.state.lastStepIndex)`
                );
              }

              // Get the actual failed step info
              const failedStep = currentWorkflow.content.steps[failedStepIndex];

              setWorkflowExecutionLogs(prev => ({
                ...prev,
                [failedStepIndex]: {
                  stepName:
                    failedStep && "name" in failedStep && typeof failedStep.name === "string"
                      ? failedStep.name
                      : `Step ${failedStepIndex + 1}`,
                  tool:
                    failedStep && "tool_name" in failedStep && typeof failedStep.tool_name === "string"
                      ? failedStep.tool_name
                      : "execute_sequence",
                  consoleLogs: [],
                  result: {
                    success: false,
                    output: null,
                    error: errorMessage,
                  },
                  fullResult: null,
                  startTime: workflowStartTime,
                  endTime: Date.now(),
                  error: errorMessage,
                },
              }));

              // Trigger logs UI refresh
              setLogsRefreshKey(prev => prev + 1);
            }
          }
        }

        // When MCP returns an error, workflow_result is in originalError.data, not in content
        // Extract it so lastStepIndex and other fields are available for error reporting
        if (result.isError && result.originalError?.data?.workflow_result) {
          const errorWorkflowResult = result.originalError.data.workflow_result;
          console.log("[WORKFLOW] Extracting workflow_result from error response:", {
            last_step_id: errorWorkflowResult.result?.last_step_id,
            last_step_index: errorWorkflowResult.result?.last_step_index,
          });
          // Merge error workflow_result into actualContent (or use it if actualContent is empty)
          if (!actualContent) {
            actualContent = errorWorkflowResult;
          } else if (typeof actualContent === "object" && actualContent !== null) {
            // Only merge if actualContent is an object (not a string error message from useMcp)
            // Preserve workflow_result data for step index lookups
            actualContent.workflow_result = errorWorkflowResult;
            // Also copy key fields to top level for easier access
            if (errorWorkflowResult.result?.last_step_index !== undefined) {
              actualContent.last_step_index = errorWorkflowResult.result.last_step_index;
            }
            if (errorWorkflowResult.result?.last_step_id) {
              actualContent.last_step_id = errorWorkflowResult.result.last_step_id;
            }
            if (errorWorkflowResult.state?.lastStepIndex !== undefined) {
              actualContent.state = actualContent.state || {};
              actualContent.state.lastStepIndex = errorWorkflowResult.state.lastStepIndex;
            }
          } else {
            // actualContent is a primitive (e.g., string error message) - use errorWorkflowResult instead
            actualContent = errorWorkflowResult;
          }
        }

        // Check for partial failure or full failure
        let partialFailure = false;
        let fullFailure = false;
        let wasCancelledByUser = false;
        const failedSteps: Array<{ step_name: string; index: number; error: string }> = [];

        // Process actualContent even when result.isError - failure details are in the content
        if (actualContent && typeof actualContent === "object") {
          if (actualContent.status === "completed_with_errors" && actualContent.results) {
            partialFailure = true;

            if (Array.isArray(actualContent.results)) {
              actualContent.results.forEach((stepResult: any, index: number) => {
                // Catch any step that isn't success or skipped (includes 'failed', 'error', 'unknown', undefined, etc.)
                if (stepResult.status !== "executed_without_error" && stepResult.status !== "skipped") {
                  // Use stepResult.index (actual step position) not forEach index
                  const actualIndex = stepResult.index ?? index;
                  failedSteps.push({
                    step_name:
                      stepResult.step_name || stepResult.name || stepResult.tool_name || `Step ${actualIndex + 1}`,
                    index: actualIndex,
                    error: stepResult.error || `Step ended with status: ${stepResult.status || "unknown"}`,
                  });
                }
              });
            }

            console.warn("⚠️ [WORKFLOW] Workflow completed with errors:", failedSteps);
          } else if (actualContent.status === "failed" || actualContent.status === "executed_with_error") {
            fullFailure = true;
            console.error("❌ [WORKFLOW] Workflow failed:", actualContent.error);

            // Also scan results to find which step failed
            if (Array.isArray(actualContent.results)) {
              actualContent.results.forEach((stepResult: any, index: number) => {
                // Catch any step that isn't success or skipped
                if (stepResult.status !== "executed_without_error" && stepResult.status !== "skipped") {
                  // Use stepResult.index (actual step position) not forEach index
                  const actualIndex = stepResult.index ?? index;
                  failedSteps.push({
                    step_name:
                      stepResult.step_name || stepResult.name || stepResult.tool_name || `Step ${actualIndex + 1}`,
                    index: actualIndex,
                    error: stepResult.error || `Step ended with status: ${stepResult.status || "unknown"}`,
                  });
                }
              });
            }
          } else if (actualContent.status === "cancelled") {
            // Handle cancelled status - treat as partial success since some steps completed
            partialFailure = true;
            wasCancelledByUser = true;
            console.warn("⚠️ [WORKFLOW] Workflow was cancelled by user");
          }
        }

        // Determine final step index based on actually executed steps (not skipped)
        // Find the highest step index from results, not just count of executed tools
        let finalStepIndex = currentWorkflow.content.steps.length;
        if (actualContent && actualContent.results && Array.isArray(actualContent.results)) {
          // Find the maximum index from executed steps (use stepResult.index, not array position)
          let maxExecutedIndex = -1;
          actualContent.results.forEach((r: any) => {
            if (r.executed !== false && r.status !== "skipped" && typeof r.index === "number") {
              maxExecutedIndex = Math.max(maxExecutedIndex, r.index);
            }
          });
          // Position at the step after the last executed one (or stay at max if at end)
          if (maxExecutedIndex >= 0) {
            finalStepIndex = Math.min(maxExecutedIndex + 1, currentWorkflow.content.steps.length);
          }
        }

        const workflowResult: StepResult = {
          success: !result.isError && !fullFailure && !partialFailure,
          output: outputValue,
          error: result.isError
            ? typeof result.content === "string"
              ? parseMcpError(result.content)
              : result.content
            : fullFailure && actualContent.error
              ? actualContent.error
              : failedSteps.length > 0
                ? failedSteps[0].error
                : undefined,
          partialFailure,
          failedTools:
            failedSteps.length > 0
              ? failedSteps.map(s => ({
                  tool_name: s.step_name,
                  index: s.index,
                  error: s.error,
                }))
              : undefined,
        };

        // Update current step to the last executed step
        setCurrentStep(finalStepIndex);
        setStepResult(workflowResult);

        // Capture focus state after successful execution
        if (!result.isError && !fullFailure) {
          setTimeout(async () => {
            try {
              await focusManager.captureFocusState();
            } catch (focusError) {
              console.warn("⚠️ [WORKFLOW] Failed to capture focus state:", focusError);
            }
          }, 200);
        }

        // Set state to completed or awaiting confirmation based on result
        if (workflowResult.success) {
          setWorkflowState("completed");
          console.log("✅ [WORKFLOW] Full workflow completed successfully");
        } else {
          setWorkflowState("idle");
          console.log("⚠️ [WORKFLOW] Workflow completed with errors, awaiting user action");

          // Dispatch workflow-execution-error event to show error modal
          const errorData = result.originalError?.data;
          if (errorData && (errorData.exit_code !== undefined || errorData.stderr || fullFailure || partialFailure)) {
            console.log("[WORKFLOW] Dispatching workflow-execution-error from executeFullWorkflow (Block 3)");
            window.dispatchEvent(
              new CustomEvent("workflow-execution-error", {
                detail: {
                  errorData: errorData,
                  message: workflowResult.error || "Workflow execution failed",
                  workflowName: currentWorkflow?.name,
                  workflowId: currentWorkflow?.id,
                },
              })
            );
          }
        }

        // Reset full workflow mode
        setIsFullWorkflowMode(false);

        // Close execution bar and restore window
        const savedAppMinimizationRestore = localStorage.getItem("disable_app_minimization");
        const disableAppMinimizationRestore =
          savedAppMinimizationRestore === null ? true : savedAppMinimizationRestore === "true";
        if (!disableAppMinimizationRestore) {
          try {
            await invoke("close_execution_bar");
            console.log("✅ Execution bar closed after full workflow");
          } catch (barError) {
            console.warn("⚠️ Could not close execution bar:", barError);
          }
        }

        if (!disableAppMinimizationRestore) {
          try {
            const currentWindow = getCurrentWindow();
            await currentWindow.unminimize();
            await currentWindow.setFocus();
            console.log("🪟 App window restored after full workflow");
          } catch (restoreError) {
            console.warn("⚠️ Could not restore window:", restoreError);
          }
        }

        // Always reset executing ref after completion
        isExecutingRef.current = false;
        // FIX: Clear live step status to stop spinner animation after completion
        setLiveStepStatus({});
      } catch (error) {
        console.error("❌ [WORKFLOW] Full workflow execution error:", error);

        const workflowResult: StepResult = {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : "Unknown error occurred",
        };

        setStepResult(workflowResult);
        setWorkflowState("idle");

        // Dispatch workflow-execution-error event to show error modal (exception path)
        const errorAny = error as any;
        const originalErrorData = errorAny?.originalError?.data;
        if (originalErrorData && (originalErrorData.exit_code !== undefined || originalErrorData.stderr)) {
          console.log("[WORKFLOW] Dispatching workflow-execution-error from executeFullWorkflow (Block 4 - exception)");
          window.dispatchEvent(
            new CustomEvent("workflow-execution-error", {
              detail: {
                errorData: originalErrorData,
                message: error instanceof Error ? error.message : "Workflow execution failed",
                workflowName: currentWorkflow?.name,
                workflowId: currentWorkflow?.id,
              },
            })
          );
        }

        // Reset full workflow mode
        setIsFullWorkflowMode(false);

        // Close execution bar and restore window on error
        const savedAppMinimizationError = localStorage.getItem("disable_app_minimization");
        const disableAppMinimizationError =
          savedAppMinimizationError === null ? true : savedAppMinimizationError === "true";
        if (!disableAppMinimizationError) {
          try {
            await invoke("close_execution_bar");
            console.log("✅ Execution bar closed after error");
          } catch (barError) {
            console.warn("⚠️ Could not close execution bar:", barError);
          }
        }

        if (!disableAppMinimizationError) {
          try {
            const currentWindow = getCurrentWindow();
            await currentWindow.unminimize();
            await currentWindow.setFocus();
            console.log("🪟 App window restored after full workflow error");
          } catch (restoreError) {
            console.warn("⚠️ Could not restore window:", restoreError);
          }
        }

        // Always reset executing ref after error
        isExecutingRef.current = false;
        // FIX: Clear live step status to stop spinner animation after error
        setLiveStepStatus({});
      }
    },
    [currentWorkflow, callTool, clearHighlight, getStepIdByIndex, stopActiveHighlights, focusManager, serverInfo]
  );

  // Execute a range of steps (for step range selection feature)
  // providedInputs: Optional inputs collected from the user before execution
  const executeStepRange = useCallback(
    async (options: {
      startIndex: number;
      endIndex: number;
      executeJumpsAtEnd?: boolean;
      followFallback?: boolean;
      providedInputs?: Record<string, unknown>;
    }) => {
      const { startIndex, endIndex, executeJumpsAtEnd, followFallback, providedInputs } = options;

      if (!currentWorkflow || currentWorkflow.content.steps.length === 0) {
        console.warn("[WORKFLOW] No workflow to execute");
        return;
      }

      // Guard: Prevent duplicate execution - same as executeStep
      if (isExecutingRef.current) {
        console.warn("⚠️ [WORKFLOW] Step range execution already in progress (ref guard), ignoring duplicate call");
        return;
      }

      // Reset terminator mode to "act" before execution (clears any ask/x mode restrictions from chat)
      const mcpPort = serverInfo?.port;
      if (mcpPort) {
        try {
          await invoke("set_terminator_mode", {
            mcpPort,
            mode: "act",
            blockedTools: [],
          });
          console.log("[WORKFLOW] Reset terminator mode to 'act' for step range execution");
        } catch (e) {
          console.warn("[WORKFLOW] Failed to reset terminator mode:", e);
        }
      }

      // Validate indices
      const steps = currentWorkflow.content.steps;
      if (startIndex < 0 || startIndex >= steps.length || endIndex < 0 || endIndex >= steps.length) {
        console.warn("[WORKFLOW] Invalid step range:", { startIndex, endIndex, stepsLength: steps.length });
        return;
      }

      // Ensure start <= end
      const actualStart = Math.min(startIndex, endIndex);
      const actualEnd = Math.max(startIndex, endIndex);

      console.log(`🎯 [WORKFLOW] Executing step range: ${actualStart} to ${actualEnd}`);

      // Clear previous status and immediately mark first step in range as running
      // This prevents race condition where stale currentStep + stepResult shows wrong step as failed
      setLiveStepStatus({ [actualStart]: "running" });

      // Reset state.json if starting from beginning
      if (actualStart === 0) {
        try {
          console.log("🔄 [WORKFLOW] Resetting state.json - range starts from beginning");
          await invoke("reset_workflow_state", { workflowId: String(currentWorkflow.id) });
          setWorkflowExecutionState(null);
        } catch (resetError) {
          console.warn("⚠️ [WORKFLOW] Failed to reset state:", resetError);
        }
      }

      const startStepId = getStepIdByIndex(currentWorkflow, actualStart);
      const endStepId = getStepIdByIndex(currentWorkflow, actualEnd);

      if (!startStepId || !endStepId) {
        console.error("[WORKFLOW] Could not get step IDs for range execution");
        return;
      }

      isExecutingRef.current = true; // Set ref BEFORE state to prevent race conditions
      setWorkflowState("executing");
      setCurrentStep(actualStart);
      setExecutingRange({ start: actualStart, end: actualEnd }); // Track range boundaries for UI

      // Create new abort controller for workflow execution
      workflowAbortControllerRef.current = new AbortController();

      // Check if app minimization is disabled
      const savedAppMinimization = localStorage.getItem("disable_app_minimization");
      const disableAppMinimization = savedAppMinimization === null ? true : savedAppMinimization === "true";

      if (!disableAppMinimization) {
        // Minimize main window and show execution bar
        try {
          const currentWindow = getCurrentWindow();
          await currentWindow.minimize();
          console.log("🪟 App window minimized - range execution in progress");
        } catch (minimizeError) {
          console.warn("⚠️ Could not minimize window:", minimizeError);
        }

        // Show execution bar with initial progress
        try {
          await invoke("show_execution_bar");
          console.log("✅ Execution bar shown for range execution");

          // Emit initial progress
          await emit("execution-progress-update", {
            currentStep: actualStart,
            totalSteps: actualEnd - actualStart + 1,
            stepName:
              steps[actualStart] && "name" in steps[actualStart]
                ? (steps[actualStart] as any).name
                : `Step ${actualStart + 1}`,
            status: "running",
          });
        } catch (barError) {
          console.warn("⚠️ Could not show execution bar:", barError);
        }
      }

      const workflowStartTime = Date.now();
      const allStepLogs: ConsoleLogEntry[] = [];

      try {
        console.log(
          `🎯 Executing workflow range from step ${actualStart} (${startStepId}) to step ${actualEnd} (${endStepId})`
        );

        // Clear previous progress
        setStepProgress({
          consoleLogs: [],
          progressInfo: {},
          lastUpdate: Date.now(),
        });

        // Create progress callback for execute_sequence
        const progressCallback = (progress: any) => {
          const newLog: ConsoleLogEntry = {
            timestamp: progress.timestamp || Date.now(),
            message: progress.message || "",
            level: progress.level || "log",
          };

          allStepLogs.push(newLog);

          setStepProgress(prev => {
            const updatedLogs = [...prev.consoleLogs, newLog];
            const progressInfo = parseProgressFromConsole(updatedLogs);

            return {
              consoleLogs: updatedLogs,
              progressInfo,
              lastUpdate: Date.now(),
            };
          });
        };

        // Prepare steps with injected arguments
        const stepsWithLogsEnabled = (currentWorkflow.content.steps || []).map((step: any) => {
          const injectedArgs = { ...(step.arguments || {}) };

          // Always enable logs for visibility
          if (step.tool_name === "run_command") {
            injectedArgs.include_logs = true;
          }

          return {
            ...step,
            arguments: injectedArgs,
          };
        });

        // Get inputs with ORG_TOKEN for KV access
        // Use provided inputs from dialog if available, otherwise fall back to workflow content inputs
        const inputsWithAuth = await getInputsWithAuth(
          providedInputs ?? (currentWorkflow.content.inputs as Record<string, unknown>)
        );

        // Execute step range with start_from_step and end_at_step
        const skipPreflightValue =
          runtimeExecutionOptionsRef.current.skip_preflight_check ?? currentWorkflow.content.skip_preflight_check;

        // For TypeScript workflows, use URL-based execution (like web app's rust-executor)
        // For YAML workflows, pass steps inline
        const isTypeScriptWorkflow = !!currentWorkflow.localPath;
        const executeParams: any = isTypeScriptWorkflow
          ? {
              url: `file:///${currentWorkflow.localPath!.replace(/\\/g, "/")}/src/terminator.ts`,
              workflow_id: currentWorkflow.id?.toString(),
              inputs: inputsWithAuth,
              start_from_step: startStepId,
              end_at_step: endStepId,
              ...(skipPreflightValue !== undefined && { skip_preflight_check: skipPreflightValue }),
              ...(executeJumpsAtEnd !== undefined && { execute_jumps_at_end: executeJumpsAtEnd }),
              ...(followFallback !== undefined && { follow_fallback: followFallback }),
            }
          : {
              workflow_id: currentWorkflow.id?.toString(),
              steps: stepsWithLogsEnabled,
              variables: currentWorkflow.content.variables,
              inputs: inputsWithAuth,
              selectors: currentWorkflow.content.selectors,
              start_from_step: startStepId,
              end_at_step: endStepId,
              ...(skipPreflightValue !== undefined && { skip_preflight_check: skipPreflightValue }),
              ...(executeJumpsAtEnd !== undefined && { execute_jumps_at_end: executeJumpsAtEnd }),
              ...(followFallback !== undefined && { follow_fallback: followFallback }),
            };

        console.log("📦 [DEBUG] execute_sequence params for step range:", {
          workflow_id: executeParams.workflow_id,
          isTypeScript: isTypeScriptWorkflow,
          url: isTypeScriptWorkflow ? executeParams.url : undefined,
          start_from_step: startStepId,
          end_at_step: endStepId,
          execute_jumps_at_end: executeJumpsAtEnd,
          follow_fallback: followFallback,
          steps_count: isTypeScriptWorkflow ? undefined : executeParams.steps?.length,
        });

        const result = await callTool(
          "execute_sequence",
          executeParams,
          workflowAbortControllerRef.current?.signal,
          progressCallback,
          600000,
          currentWorkflow?.name,
          `Steps ${actualStart + 1}-${actualEnd + 1}`
        );

        // Process the result from execute_sequence
        let actualContent: any = null;

        if (result.content) {
          actualContent = result.content;
          if (Array.isArray(actualContent) && actualContent.length > 0) {
            actualContent = actualContent[0];
          }

          if (
            actualContent &&
            typeof actualContent === "object" &&
            actualContent.type === "text" &&
            actualContent.text
          ) {
            try {
              actualContent = JSON.parse(actualContent.text);
            } catch (e) {
              console.warn("⚠️ [WORKFLOW] Failed to parse text content as JSON:", e);
            }
          }

          // Extract logs from execute_sequence results
          if (
            actualContent &&
            typeof actualContent === "object" &&
            actualContent.results &&
            Array.isArray(actualContent.results)
          ) {
            actualContent.results.forEach((stepResult: any, index: number) => {
              if (stepResult.logs && Array.isArray(stepResult.logs)) {
                stepResult.logs.forEach((logMessage: string) => {
                  const newLog = {
                    timestamp: Date.now(),
                    message: logMessage,
                    level: "log" as const,
                  };
                  allStepLogs.push(newLog);
                });
              }

              const actualStepIndex = stepResult.index ?? index;
              const stepData = currentWorkflow.content.steps[actualStepIndex];

              const stepId = stepResult.step_id || `step_${actualStepIndex}`;
              const envResultKey = `${stepId}_result`;
              const fullEnvResult =
                actualContent.env && actualContent.env[envResultKey]
                  ? Array.isArray(actualContent.env[envResultKey])
                    ? actualContent.env[envResultKey][0]
                    : actualContent.env[envResultKey]
                  : null;

              setWorkflowExecutionLogs(prev => ({
                ...prev,
                [actualStepIndex]: {
                  stepName:
                    stepResult.step_name ||
                    stepResult.tool_name ||
                    (stepData && "name" in stepData ? stepData.name : `Step ${actualStepIndex + 1}`),
                  tool: stepResult.tool_name || "execute_sequence",
                  consoleLogs: stepResult.logs
                    ? stepResult.logs.map((msg: string) => ({
                        timestamp: Date.now(),
                        message: msg,
                        level: "log" as const,
                      }))
                    : [],
                  result: {
                    success: stepResult.status === "executed_without_error",
                    skipped: stepResult.status === "skipped" || stepResult.executed === false,
                    output: stepResult.output || stepResult.stdout || "",
                    error: stepResult.error,
                  },
                  fullResult: fullEnvResult,
                  startTime: workflowStartTime,
                  endTime: Date.now(),
                },
              }));
            });
          }
        }

        // Determine success/failure
        const hasError =
          result.isError ||
          (actualContent && (actualContent.status === "failed" || actualContent.status === "executed_with_error"));

        if (hasError) {
          console.error("❌ [WORKFLOW] Step range execution failed:", actualContent?.error || result.content);
          setWorkflowState("idle");
        } else {
          console.log("✅ [WORKFLOW] Step range execution completed successfully");
          setWorkflowState("completed");
          setCurrentStep(actualEnd);
        }

        // Reset range execution mode
        setExecutingRange(null);

        // Clean up UI
        if (!disableAppMinimization) {
          try {
            await invoke("close_execution_bar");
            console.log("✅ Execution bar closed after range execution");
          } catch (barError) {
            console.warn("⚠️ Could not close execution bar:", barError);
          }
        }

        if (!disableAppMinimization) {
          try {
            const currentWindow = getCurrentWindow();
            await currentWindow.unminimize();
            await currentWindow.setFocus();
            console.log("🪟 App window restored after range execution");
          } catch (restoreError) {
            console.warn("⚠️ Could not restore window:", restoreError);
          }
        }

        // Always reset executing ref after completion
        isExecutingRef.current = false;
        // FIX: Clear live step status to stop spinner animation after range completion
        setLiveStepStatus({});
      } catch (error) {
        console.error("❌ [WORKFLOW] Step range execution error:", error);
        setWorkflowState("idle");
        setExecutingRange(null);

        // Clean up UI on error
        if (!disableAppMinimization) {
          try {
            await invoke("close_execution_bar");
          } catch (barError) {
            console.warn("⚠️ Could not close execution bar:", barError);
          }
        }

        if (!disableAppMinimization) {
          try {
            const currentWindow = getCurrentWindow();
            await currentWindow.unminimize();
            await currentWindow.setFocus();
          } catch (restoreError) {
            console.warn("⚠️ Could not restore window:", restoreError);
          }
        }

        // Always reset executing ref after error
        isExecutingRef.current = false;
        // FIX: Clear live step status to stop spinner animation after range error
        setLiveStepStatus({});
      }
    },
    [currentWorkflow, callTool, clearHighlight, getStepIdByIndex, stopActiveHighlights, focusManager, serverInfo]
  );

  // Execute current step - with safeguards
  // providedInputs: Optional inputs collected from the user before execution
  const executeStep = useCallback(
    async (stepIndex?: number, providedInputs?: Record<string, unknown>) => {
      const stepToExecute = stepIndex ?? currentStep;
      if (!currentWorkflow || stepToExecute >= currentWorkflow.content.steps.length) return;

      // If stepIndex was provided explicitly, update currentStep to stay in sync
      if (stepIndex !== undefined && stepIndex !== currentStep) {
        setCurrentStep(stepIndex);
      }

      // Synchronous guard: prevents race condition where two calls pass state check before either sets executing
      if (isExecutingRef.current) {
        console.warn(
          `⚠️ [WORKFLOW] Step execution already in progress (ref guard) for step ${stepToExecute} (human ${stepToExecute + 1}), ignoring duplicate call`
        );
        return;
      }
      isExecutingRef.current = true;

      // Safeguard: Don't execute if already executing (React state backup check)
      if (workflowState === "executing" || workflowState === "awaiting_user_action") {
        console.warn(
          `⚠️ [WORKFLOW] Step execution already in progress for step ${stepToExecute} (human ${stepToExecute + 1}), ignoring duplicate call`
        );
        isExecutingRef.current = false;
        return;
      }

      // Preparing step for user confirmation

      const step = currentWorkflow.content.steps[stepToExecute];

      // Clear any previous state
      setStepResult(undefined);
      setIsInterrupted(false);
      setWasInterruptedByUser(false); // Reset user interruption flag

      // Reset state.json if executing first step
      if (stepToExecute === 0) {
        try {
          console.log("🔄 [WORKFLOW] Resetting state.json - executing first step");
          await invoke("reset_workflow_state", { workflowId: String(currentWorkflow.id) });
          setWorkflowExecutionState(null);
        } catch (resetError) {
          console.warn("⚠️ [WORKFLOW] Failed to reset state:", resetError);
        }
      }

      // HIGHLIGHTING DISABLED - Uncomment below to re-enable
      // Check if this step can be highlighted
      // const canHighlight = canHighlightStep(step);

      // if (canHighlight) {
      //   // Set state to awaiting user action and try to highlight
      //   setWorkflowState('awaiting_user_action');

      //   // Non-blocking highlight preview; don't auto-retry here
      //   highlightStepTarget(step, stepToExecute).catch(error => {
      //     console.warn('⚠️ [HIGHLIGHT] Failed to highlight step target, but continuing:', error);
      //   });

      //   // The actual execution will happen when user executes the step
      //   // Return undefined for highlightable steps (execution pending user confirmation)
      //   return undefined;
      // } else {
      //   // Cannot highlight (e.g., window-level operations) - auto-execute immediately
      //   // Single concise line for auto-execution of non-highlightable steps
      //   console.log('⚡ [WORKFLOW] Auto-executing non-highlightable step', { name: step.name, tool: (step as any).tool_name ?? (step as any).tool });

      //   // Directly execute the step without waiting for user confirmation
      //   const result = await doExecuteStep(stepToExecute);
      //   return result;
      // }

      // TEMPORARY: Auto-execute all steps immediately (highlighting disabled)
      console.log("⚡ [WORKFLOW] Auto-executing step (highlighting disabled)", {
        name: step.name,
        tool: (step as any).tool_name ?? (step as any).tool,
      });
      try {
        const result = await doExecuteStep(stepToExecute, providedInputs);
        return result;
      } finally {
        isExecutingRef.current = false;
      }
    },
    [currentWorkflow, currentStep, workflowState, highlightStepTarget, doExecuteStep]
  );

  // Handle workflow tool execution results from chat system
  const handleToolExecutionResult = useCallback(
    async (result: any, success: boolean) => {
      // Check if user requested interruption during execution
      if (isInterrupted) {
        const interruptedResult: StepResult = {
          success: false,
          output: "",
          error: "Step execution was interrupted by user",
        };
        setStepResult(interruptedResult);
        setWorkflowState("idle");
        setIsInterrupted(false); // Reset interruption flag
        return;
      }

      const stepResult: StepResult = {
        success,
        output: success ? result : null, // Store raw object, not stringified
        error: success ? undefined : result?.error || "Tool execution failed",
      };

      // Set step result
      setStepResult(stepResult);

      // 🎯 CAPTURE FOCUS: Save current focus state after successful step execution
      if (success) {
        setTimeout(async () => {
          try {
            await focusManager.captureFocusState();
          } catch (focusError) {
            console.warn("⚠️ [WORKFLOW] Failed to capture focus state, but continuing:", focusError);
          }
        }, 200);
      }

      // Always go to idle after interruption
      setWorkflowState("idle");
    },
    [isInterrupted, focusManager]
  );

  // Interrupt current step execution
  const interruptStep = useCallback(async () => {
    if (workflowState === "executing") {
      console.log("🛑 [WORKFLOW] User requested step interruption");
      setIsInterrupted(true);
      setWasInterruptedByUser(true); // Mark this as user-initiated interruption

      // Abort the current request if in progress
      if (workflowAbortControllerRef.current) {
        console.log("🛑 [WORKFLOW] Aborting current MCP request");
        workflowAbortControllerRef.current.abort();
        workflowAbortControllerRef.current = null;
      }

      // FIX: Immediately reset state to idle to prevent stuck state
      // Don't wait for Promise rejection - that may not happen reliably
      // due to race conditions with transport close and async abort handlers
      console.log("🛑 [WORKFLOW] Immediately resetting state to idle");
      setWorkflowState("idle");
      isExecutingRef.current = false;
      setExecutingRange(null); // Clear any range execution
      setIsFullWorkflowMode(false); // Clear full workflow mode
      setLiveStepStatus({}); // Clear live step status to stop spinner animation
    }
  }, [workflowState]);

  // Handle user feedback about what went wrong

  // Handle workflow state change events
  useEffect(() => {
    const handleWorkflowSetState = (event: CustomEvent) => {
      const { state } = event.detail;
      console.log(`🔄 Setting workflow state to: ${state}`);
      setWorkflowState(state);
    };

    window.addEventListener("workflow-set-state", handleWorkflowSetState as EventListener);

    return () => {
      window.removeEventListener("workflow-set-state", handleWorkflowSetState as EventListener);
    };
  }, []);

  // Start workflow execution from step 1
  const startExecution = useCallback(() => {
    if (!currentWorkflow) return;

    setCurrentStep(0); // Start at array index 0
    setStepResult(undefined);
    setWorkflowState("idle");

    // Use timeout to ensure state is updated before executing
    setTimeout(() => {
      executeStep(0); // Explicitly start at step 0
    }, 100);
  }, [currentWorkflow, executeStep]);

  // Jump to a specific step (move execution pointer without auto-executing)
  const jumpToStep = useCallback(
    async (targetStepIndex: number) => {
      if (!currentWorkflow || targetStepIndex < 0 || targetStepIndex >= currentWorkflow.content.steps.length) {
        console.warn("⚠️ [WORKFLOW] Invalid step index for jump:", targetStepIndex);
        return;
      }

      // Don't jump if we're in the middle of execution
      if (workflowState === "executing" || workflowState === "awaiting_user_action") {
        console.warn("⚠️ [WORKFLOW] Cannot jump to step while workflow is busy. Current state:", workflowState);
        return;
      }

      console.log(`🎯 [WORKFLOW] Moving execution pointer from step ${currentStep + 1} to step ${targetStepIndex + 1}`);

      // Clear any existing state
      setStepResult(undefined);

      clearHighlight();

      // Clear retry count for the target step
      // TODO: setStepRetryCount is not defined, commenting out for now
      // setStepRetryCount(prev => {
      //   const newMap = new Map(prev);
      //   newMap.delete(targetStepIndex);
      //   return newMap;
      // });

      // Update current step and set to idle (ready for user to execute)
      setCurrentStep(targetStepIndex);
      setWorkflowState("idle");

      // User can now press Tab to execute or preview the step
      console.log(`✅ [WORKFLOW] Ready at step ${targetStepIndex + 1}. Press Tab to execute.`);
    },
    [currentWorkflow, currentStep, workflowState, invoke, clearHighlight]
  );

  // NOTE: deleteStep, duplicateStep, reorderStep were removed - they were YAML-only
  // TypeScript workflows use file-based updates instead

  // Go back to workflow list - with proper cleanup
  const backToList = useCallback(async () => {
    // Refresh workflow list from backend to ensure we have the latest data
    await loadWorkflows();

    setCurrentWorkflow(null);
    setCurrentStep(0);
    setStepResult(undefined);
    setWorkflowState("idle");
  }, [loadWorkflows]);

  // Reset workflow execution state without clearing the current workflow
  // Used for "New Chat" functionality to reset conversation while staying on the same workflow
  const resetWorkflowExecutionState = useCallback(() => {
    setCurrentStep(0);
    setStepResult(undefined);
    setWorkflowState("idle");
  }, []);

  // Reload execution state from state.json file (called when file watcher detects changes)
  const reloadExecutionState = useCallback(async () => {
    if (!currentWorkflow?.id) return;

    console.log(`🔄 [WORKFLOW] Reloading execution state for workflow ${currentWorkflow.id}...`);
    try {
      const stateData = await invoke<{
        last_updated: string;
        last_step_id: string | null;
        last_step_index: number;
        workflow_id: string | null;
        env: Record<string, unknown>;
      } | null>("get_workflow_execution_state", {
        workflowId: currentWorkflow.id.toString(),
      });

      if (stateData) {
        console.log(`✅ [WORKFLOW] Reloaded execution state, last step index: ${stateData.last_step_index}`);
        setWorkflowExecutionState({
          lastUpdated: stateData.last_updated,
          lastStepIndex: stateData.last_step_index,
          env: stateData.env || {},
        });
      } else {
        console.log(`ℹ️ [WORKFLOW] No execution state found after reload`);
        setWorkflowExecutionState(null);
      }
    } catch (stateError) {
      console.warn(`⚠️ [WORKFLOW] Failed to reload execution state:`, stateError);
    }
  }, [currentWorkflow?.id]);

  // Update recording workflow with captured steps - merge them into the main workflow steps
  const updateRecordingSteps = useCallback(
    (steps: SequenceStep[]) => {
      // Remove the condition to allow any workflow to be updated (not just recording-new-workflow)
      // This enables YAML edits to update the UI

      // Filter out null/undefined steps before processing
      const validSteps = steps.filter(step => step != null);

      setCurrentWorkflow(prev => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          content: {
            ...prev.content,
            // Store steps in canonical format (tool_name, arguments)
            steps: validSteps.map(step => {
              const stepAny = step as any;
              const stepId = stepAny.id || stepAny.stepId || crypto.randomUUID();
              const sequenceStep: SequenceStep = {
                id: stepId,
                name: stepAny.name,
                tool_name: stepAny.tool ?? stepAny.tool_name,
                arguments: stepAny.parameters ?? stepAny.arguments ?? {},
              };
              if (stepAny.description) (sequenceStep as any).description = stepAny.description;
              return sequenceStep;
            }),
          },
          stepCount: validSteps.length,
          isModified: true, // Mark as modified when updated from YAML
          // CRITICAL: Preserve rawEvents from recording (don't lose them when YAML is updated)
          rawEvents: prev.rawEvents,
        };
        return updated;
      });

      // Also update in the workflows list if we have the current workflow ID
      if (currentWorkflow) {
        setWorkflows(prevWorkflows =>
          prevWorkflows.map(w =>
            w.id === currentWorkflow.id
              ? {
                  ...w,
                  content: {
                    ...w.content,
                    steps: validSteps.map(step => {
                      const stepAny = step as any;
                      const stepId = stepAny.id || stepAny.stepId || crypto.randomUUID();
                      const sequenceStep: SequenceStep = {
                        id: stepId,
                        name: stepAny.name,
                        tool_name: stepAny.tool ?? stepAny.tool_name,
                        arguments: stepAny.parameters ?? stepAny.arguments ?? {},
                      };
                      if (stepAny.description) (sequenceStep as any).description = stepAny.description;
                      return sequenceStep;
                    }),
                  },
                  stepCount: validSteps.length,
                  isModified: true,
                  // CRITICAL: Preserve rawEvents from recording (don't lose them when YAML is updated)
                  rawEvents: w.rawEvents,
                }
              : w
          )
        );
      }
    },
    [currentWorkflow]
  );

  // Forward declaration for saveRecordedWorkflow since it's used in saveWorkflowWithBackup
  // eslint-disable-next-line prefer-const
  let saveRecordedWorkflow: any;

  // Save workflow (cloud storage - backups handled by version history)
  const saveWorkflowWithBackup = useCallback(
    async (workflow: Workflow) => {
      // Cloud storage automatically creates versions for backup
      // No need for manual backup files

      // Save updated workflow - preserve current workflow to stay on same page
      await saveRecordedWorkflow(
        workflow.name,
        workflow.description,
        workflow.content.steps,
        true // Preserve current workflow (don't navigate away)
      );
    },
    [saveRecordedWorkflow]
  );

  // Start recording flow
  const startRecording = useCallback(
    async (workflowIdOrName?: string, appendToExisting = false) => {
      try {
        console.log("🆕 [RECORDING] Starting recording:", { workflowIdOrName, appendToExisting });

        if (appendToExisting && currentWorkflow) {
          // Recording on existing workflow - append mode
          setCurrentWorkflow(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              recordingMetadata: {
                originalStepCount: prev.content.steps.length,
                recordingStartedAt: new Date().toISOString(),
                lowEnergyMode: false,
                conversionNotes: [],
                highlightingEnabled: true,
              },
            };
          });
        } else {
          // New workflow recording
          // NOTE: This path should rarely be hit - users normally click "New" button first
          // which calls startRecordingWorkflow and creates the workflow with a real ID
          const newWorkflow: Workflow = {
            id: null, // Recording workflows have no ID until saved
            name: workflowIdOrName || "New Recording",
            description: "Recording in progress...",
            content: {
              variables: {},
              selectors: {},
              steps: [],
            },
            recordingMetadata: {
              originalStepCount: 0,
              recordingStartedAt: new Date().toISOString(),
              lowEnergyMode: false,
              conversionNotes: [],
              highlightingEnabled: true,
            },
            stepCount: 0,
            lastModified: new Date().toISOString(),
            isOriginal: false,
            isNewRecording: true, // Mark as brand new recording workflow to enable in-memory rename
          };
          setCurrentWorkflow(newWorkflow);
        }

        setWorkflowState("recording");

        // Start recording to API (enables event collection)
        // Pass workflow path for screenshot saving (TypeScript workflows only)
        const workflowPath = currentWorkflow?.localPath || null;
        console.log("🔴 Starting recording to API backend (workflowPath:", workflowPath, ")");
        await invoke("start_recording_to_api", { workflowPath });

        // Initialize local recording processor and start streaming analysis
        // This enables parallel analysis during recording for faster post-processing
        try {
          const sessionId = crypto.randomUUID();
          console.log("🔄 [STREAMING] Initializing local processor with session:", sessionId);
          await invoke("init_local_recording_processor", { input: { session_id: sessionId } });
          await invoke("start_streaming_analysis");
          console.log("✅ [STREAMING] Streaming analysis started");
        } catch (streamingError) {
          console.warn("⚠️ Could not start streaming analysis:", streamingError);
          // Non-fatal - recording will still work, just without streaming optimization
        }

        // Minimize the app window after successfully starting recording
        try {
          const currentWindow = getCurrentWindow();
          await currentWindow.minimize();
          console.log("🪟 App window minimized - recording in progress");
        } catch (minimizeError) {
          console.warn("⚠️ Could not minimize window:", minimizeError);
        }

        // Show the recording bar
        try {
          await invoke("show_recording_bar");
          console.log("✅ Recording bar shown");
        } catch (barError) {
          console.warn("⚠️ Could not show recording bar:", barError);
        }
      } catch (error) {
        console.error("❌ Failed to start recording:", error);
        setWorkflowState("idle");
        throw error;
      }
    },
    [currentWorkflow, mcpClient]
  );

  // Simplified stop recording - treats "no recording in progress" as success
  const stopRecording = useCallback(
    async (fromRecordingBar = false) => {
      try {
        console.log("⏳ [RECORDING] Stopping recording...", { fromRecordingBar });

        // Set stopping state FIRST so UI updates before window restoration
        setWorkflowState("stopping_recording");
        console.log("📊 [RECORDING] State set to stopping_recording");

        // Close the recording bar first (only if not initiated from recording bar itself)
        if (!fromRecordingBar) {
          try {
            await invoke("close_recording_bar");
            console.log("✅ Recording bar closed");
          } catch (barError) {
            console.warn("⚠️ Could not close recording bar:", barError);
          }
        } else {
          console.log("📊 [RECORDING] Stop initiated from recording bar, will close after processing");
        }

        // Restore app window - UI will now show "stopping" state
        try {
          const currentWindow = getCurrentWindow();
          await currentWindow.unminimize();
          await currentWindow.setFocus();
        } catch (restoreError) {
          console.warn("⚠️ Could not restore window:", restoreError);
        }

        // NEW: Stop recording and convert to MCP using mediar-app backend
        const workflowName = currentWorkflow?.name || `workflow_${Date.now()}`;
        const result = await invoke<{ success: boolean; mcp_steps: any[]; raw_events: any[]; workflow_name: string }>(
          "stop_recording_and_convert",
          { workflowName }
        );
        console.log(
          "✅ [RECORDING] Stop command result:",
          JSON.stringify({
            success: result.success,
            raw_events_count: result.raw_events?.length || 0,
            has_raw_events: !!result.raw_events,
            raw_events_type: typeof result.raw_events,
          })
        );
        console.log(
          "[ts_gen] Recording stopped - got",
          result.raw_events?.length || 0,
          "raw events for TypeScript generation"
        );

        // Handle no events case (check raw_events, not mcp_steps)
        if (!result.raw_events || result.raw_events.length === 0) {
          console.log("ℹ️ [RECORDING] No events captured during recording");

          // Reset recording state
          if (workflowState === "recording" || workflowState === "stopping_recording") {
            setWorkflowState("idle");
          }

          // Clear recording metadata but keep the workflow structure
          if (currentWorkflow) {
            setCurrentWorkflow(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                recordingMetadata: {
                  ...prev.recordingMetadata,
                  isRecording: false,
                  recordingStartedAt: undefined,
                },
              };
            });
          }

          // Close recording bar if needed
          if (fromRecordingBar) {
            try {
              await invoke("close_recording_bar");
              console.log("✅ Recording bar closed after processing");
            } catch (barError) {
              console.warn("⚠️ Could not close recording bar:", barError);
            }
          }

          return {
            steps: [],
            mcpWorkflow: null,
            filePath: null,
            conversionNotes: [],
            message: "No actionable UI events were captured during recording",
          };
        }

        // Success - Got raw events for TypeScript generation
        console.log(`[ts_gen] Recording complete: ${result.raw_events?.length || 0} raw events captured`);

        // Update workflow with raw events (TypeScript generation happens on save)
        if (currentWorkflow) {
          setCurrentWorkflow(prev => {
            if (!prev) return prev;

            const updatedWorkflow: Workflow = {
              ...prev,
              // Keep existing steps unchanged - TypeScript code will be generated from rawEvents on save
              stepCount: result.raw_events?.length || 0, // Show event count as step count
              rawEvents: result.raw_events, // Store raw events for TypeScript generation
              recordingMetadata: prev.recordingMetadata
                ? {
                    ...prev.recordingMetadata,
                    recordingStartedAt: "",
                  }
                : undefined,
            };

            console.log(`📊 [STOP RECORDING] Updated workflow with ${result.raw_events?.length || 0} raw events`);
            console.log(`📊 [STOP RECORDING] Raw events details:`, {
              hasRawEvents: !!updatedWorkflow.rawEvents,
              rawEventsType: typeof updatedWorkflow.rawEvents,
              rawEventsIsArray: Array.isArray(updatedWorkflow.rawEvents),
              rawEventsCount: updatedWorkflow.rawEvents?.length || 0,
              firstEvent: updatedWorkflow.rawEvents?.[0] ? Object.keys(updatedWorkflow.rawEvents[0]) : "none",
            });
            console.log(`📊 [STOP RECORDING] Workflow state:`, {
              id: updatedWorkflow.id,
              name: updatedWorkflow.name,
              stepCount: updatedWorkflow.stepCount,
              rawEventsCount: updatedWorkflow.rawEvents?.length || 0,
            });

            return updatedWorkflow;
          });
        }

        // Reset recording state and initialize for execution
        setWorkflowState("idle");
        setCurrentStep(0); // Set to first step so workflow is ready to execute
        setStepResult(undefined);

        // Close recording bar if stop was initiated from the bar itself
        if (fromRecordingBar) {
          try {
            await invoke("close_recording_bar");
            console.log("✅ Recording bar closed after processing");
          } catch (barError) {
            console.warn("⚠️ Could not close recording bar:", barError);
          }
        }

        // AUTOSAVE: Automatically save the recorded workflow as TypeScript
        // This generates TypeScript code from raw events and saves to workflow folder
        console.log("[ts_gen] Auto-saving recorded workflow as TypeScript...");
        const autoSaveWorkflowName = currentWorkflow?.name || `workflow_${Date.now()}`;
        const autoSaveWorkflowDescription = currentWorkflow?.description || "Recorded workflow";

        try {
          const saveResult = await saveRecordedWorkflow(
            autoSaveWorkflowName,
            autoSaveWorkflowDescription,
            [], // Steps param not used - TypeScript generation uses rawEvents from workflow state
            true // preserveCurrentWorkflow = true to stay on the workflow page
          );

          if (saveResult?.success) {
            console.log("✅ [RECORDING] Workflow auto-saved successfully with ID:", saveResult.workflowId);

            // Trigger local processing with Gemini (parallel to cloud processing)
            // This generates step analysis, labels, and synthesis comments in the TS files
            if (saveResult.path) {
              // Stop streaming analysis before local processing
              // This finalizes any pending streaming work and logs stats
              try {
                console.log("[STREAMING] Stopping streaming analysis before local processing");
                const stats = await invoke<{
                  meaningfulEventCount: number;
                  completedAnalyses: number;
                  completedLabels: number;
                }>("get_streaming_analysis_stats");
                console.log(
                  `[STREAMING] Stats: ${stats.completedAnalyses} analyses, ${stats.completedLabels} labels completed during recording`
                );
                await invoke("stop_streaming_analysis");
              } catch (e) {
                console.warn("[STREAMING] Could not stop streaming:", e);
              }

              console.log("[LOCAL_PROCESSING] Starting local Gemini processing for:", saveResult.path);
              // Emit event to show processing modal immediately (don't wait for progress events)
              console.log("[LOCAL_PROCESSING] Emitting local-processing-started event...");
              emit("local-processing-started", { workflowFolder: saveResult.path })
                .then(() => console.log("[LOCAL_PROCESSING] local-processing-started event emitted successfully"))
                .catch(err => console.error("[LOCAL_PROCESSING] Failed to emit local-processing-started:", err));
              invoke<{ success: boolean; error?: string; eventCount: number }>("process_recording_locally", {
                workflowFolder: saveResult.path,
              })
                .then(localResult => {
                  if (localResult.success) {
                    console.log(
                      "[LOCAL_PROCESSING] Completed successfully, processed",
                      localResult.eventCount,
                      "events"
                    );
                  } else {
                    console.warn("[LOCAL_PROCESSING] Failed:", localResult.error);
                  }
                  // Emit event to refresh file tree (recordings/analysis.md was created)
                  console.log("[LOCAL_PROCESSING] Emitting recording-files-created event");
                  emit("recording-files-created", { workflowId: saveResult.workflowId });
                })
                .catch(err => {
                  console.warn("[LOCAL_PROCESSING] Error:", err);
                  // Still emit to refresh tree even on error - files may have been partially created
                  emit("recording-files-created", { workflowId: saveResult.workflowId });
                });
            }
          } else {
            console.error("❌ [RECORDING] Failed to auto-save workflow:", saveResult?.error);
            // Don't throw - let the user see the workflow and manually save if needed
          }
        } catch (saveError) {
          console.error("❌ [RECORDING] Exception during auto-save:", saveError);
          // Don't throw - let the user see the workflow and manually save if needed
        }

        // Return the workflow data for display
        const eventCount = result.raw_events?.length || 0;
        return {
          steps: [], // Steps not used for TypeScript workflows - code generated from rawEvents
          mcpWorkflow: null, // MCP workflows deprecated
          filePath: null,
          conversionNotes: [],
          message: `Successfully recorded ${eventCount} events for TypeScript generation`,
        };
      } catch (error) {
        console.error("❌ Failed to stop recording:", error);
        setWorkflowState("idle");

        // Close recording bar even on error if initiated from the bar
        if (fromRecordingBar) {
          try {
            await invoke("close_recording_bar");
            console.log("✅ Recording bar closed after error");
          } catch (barError) {
            console.warn("⚠️ Could not close recording bar:", barError);
          }
        }

        throw error;
      }
    },
    [currentWorkflow, mcpClient, saveWorkflowWithBackup, saveRecordedWorkflow]
  );

  // Unified recording toggle - check frontend state first, then toggle appropriately
  const handleRecordingToggle = useCallback(
    async (workflowName?: string, appendToExisting = false) => {
      // Early exit if already processing a toggle
      if (isProcessingToggleRef.current) {
        console.log("⏳ [RECORDING] Toggle already in progress, skipping duplicate call...");
        return null;
      }

      isProcessingToggleRef.current = true;

      try {
        console.log("🔄 [RECORDING] Toggle requested, current state:", workflowState);

        // Check current state FIRST to determine action
        if (workflowState === "recording") {
          // Currently recording, so stop
          console.log("⏸️ [RECORDING] Currently recording, stopping...");
          try {
            const stopResult = await stopRecording();
            return stopResult;
          } catch (error) {
            console.error("❌ [RECORDING] Failed to stop recording:", error);
            throw error;
          }
        } else if (["idle", "completed", "interrupted"].includes(workflowState)) {
          // Not recording, so start
          console.log("▶️ [RECORDING] Not recording, starting new recording...");
          await startRecording(workflowName, appendToExisting);
          return null;
        } else {
          // In some other state (executing, etc.) - don't toggle
          console.log("⚠️ [RECORDING] Cannot toggle recording in state:", workflowState);
          return null;
        }
      } finally {
        // Reset flag after operation completes with a small cooldown
        setTimeout(() => {
          isProcessingToggleRef.current = false;
        }, 300); // 300ms cooldown to handle any trailing events
      }
    },
    [workflowState, startRecording, stopRecording]
  );

  // Legacy toggle function - redirect to new unified handler
  const toggleRecording = handleRecordingToggle;

  // Save recorded workflow as TypeScript (generates @mediar-ai/workflow SDK code)
  // Creates a local TypeScript workflow folder from raw recording events
  saveRecordedWorkflow = useCallback(
    async (
      name: string,
      description: string,
      _steps: SequenceStep[], // Steps param kept for API compatibility but not used - we use raw events
      preserveCurrentWorkflow = false // Add option to keep current workflow selected
    ) => {
      try {
        console.log("[ts_gen] Saving recorded workflow as TypeScript:", name);

        // Check if current workflow has raw events to save
        // Use ref to get the latest value without causing re-renders
        const rawEvents = currentWorkflowRef.current?.rawEvents;
        const existingPath = currentWorkflowRef.current?.localPath;
        console.log(`[ts_gen] Raw events available:`, rawEvents?.length || 0, "events");
        console.log(`[ts_gen] Existing workflow path:`, existingPath || "none (will create new)");

        if (!rawEvents || rawEvents.length === 0) {
          console.warn("[ts_gen] No raw events to convert to TypeScript - creating empty workflow");
        }

        // Convert raw events to JSON string for the Rust command
        console.log(`[ts_gen] DEBUG: rawEvents type:`, typeof rawEvents);
        console.log(`[ts_gen] DEBUG: rawEvents[0] keys:`, rawEvents?.[0] ? Object.keys(rawEvents[0]) : "none");
        console.log(
          `[ts_gen] DEBUG: rawEvents[0] sample:`,
          rawEvents?.[0] ? JSON.stringify(rawEvents[0]).substring(0, 200) : "none"
        );
        const eventsJson = JSON.stringify(rawEvents || []);
        console.log(`[ts_gen] DEBUG: eventsJson length:`, eventsJson.length);
        console.log(`[ts_gen] DEBUG: eventsJson first 200:`, eventsJson.substring(0, 200));
        console.log(`[ts_gen] DEBUG: eventsJson last 200:`, eventsJson.substring(eventsJson.length - 200));

        // Call the new TypeScript generation command
        // Pass existing path to update in place instead of creating new folder
        const result = await invoke<{
          id: string;
          path: string;
          name: string;
          event_count: number;
          action_count: number;
        }>("save_recorded_typescript_workflow", {
          input: {
            name,
            description: description || "Recorded workflow",
            eventsJson,
            existingWorkflowPath: existingPath || null,
          },
        });

        console.log("[ts_gen] TypeScript workflow created:", result);
        console.log(`[ts_gen] Generated ${result.action_count} action lines from ${result.event_count} events`);
        console.log("[ts_gen] Workflow path:", result.path);

        // Update workflow state directly instead of refetching all 300+ workflows
        // This makes save instant instead of waiting 6+ seconds for cloud fetch

        // Clear recording state only if not preserving current workflow
        if (!preserveCurrentWorkflow) {
          console.log("[ts_gen] Clearing current workflow (navigating back to list)");
          setCurrentWorkflow(null);
        } else {
          console.log("[ts_gen] Preserving current workflow (staying on same page)");

          // Update currentWorkflow with save result (id, localPath, isNewRecording)
          setCurrentWorkflow(prev =>
            prev
              ? {
                  ...prev,
                  id: result.id,
                  localPath: result.path,
                  isNewRecording: false, // No longer a new recording after save
                }
              : null
          );
          console.log("[ts_gen] Workflow saved with ID:", result.id);
        }

        // Update workflows array with the saved workflow
        setWorkflows(prevWorkflows => {
          const existingIndex = prevWorkflows.findIndex(w => w.id === result.id);
          if (existingIndex >= 0) {
            // Update existing workflow
            const updated = [...prevWorkflows];
            updated[existingIndex] = {
              ...updated[existingIndex],
              localPath: result.path,
              name: result.name,
            };
            console.log("[ts_gen] Updated existing workflow in list");
            return updated;
          } else {
            // Add new workflow to list
            const newWorkflow: Workflow = {
              id: result.id,
              name: result.name,
              description: description || "Recorded workflow",
              stepCount: result.action_count,
              lastModified: new Date().toISOString(),
              isOriginal: true,
              localPath: result.path,
              content: { steps: [] },
            };
            console.log("[ts_gen] Added new workflow to list");
            return [newWorkflow, ...prevWorkflows];
          }
        });

        // Background refresh to sync with cloud (non-blocking)
        loadWorkflows().catch(err => console.warn("[ts_gen] Background refresh failed:", err));
        setWorkflowState("idle");

        return { success: true, workflowId: result.id, path: result.path };
      } catch (error) {
        console.error("[ts_gen] Error saving recorded workflow:", error);
        return { success: false, error: String(error) };
      }
    },
    [currentWorkflow, loadWorkflows]
  );

  // Update workflow name function
  const updateWorkflowName = useCallback(
    async (workflowId: string | null, newName: string) => {
      try {
        // Check if workflow has a valid ID
        if (workflowId === null) {
          console.error("❌ [WORKFLOW] Cannot rename unsaved workflow");
          return { success: false, error: "Cannot rename unsaved workflow" };
        }

        // Find the workflow by ID
        const workflow = workflows.find(w => w.id === workflowId);
        if (!workflow) {
          console.error("❌ [WORKFLOW] Workflow not found:", workflowId);
          return { success: false, error: "Workflow not found" };
        }

        console.log("📝 [WORKFLOW] Renaming workflow:", workflow.name, "→", newName);

        // Sanitize the new name
        const sanitizedNewName = newName.replace(/[/\\:*?"<>|]/g, "_");

        // OPTIMISTIC UPDATE: Immediately update in-memory state before async operation
        setWorkflows(prevWorkflows =>
          prevWorkflows.map(w =>
            w.id === workflowId
              ? {
                  ...w,
                  name: sanitizedNewName,
                  isModified: true,
                }
              : w
          )
        );

        // Also update currentWorkflow if it's the one being renamed
        if (currentWorkflow?.id === workflowId) {
          setCurrentWorkflow(prev =>
            prev
              ? {
                  ...prev,
                  name: sanitizedNewName,
                  isModified: true,
                }
              : null
          );
        }

        console.log("✅ [WORKFLOW] State updated optimistically");

        // TypeScript workflows (string IDs) - update local package.json and sync to cloud
        if (typeof workflowId === "string") {
          console.log("📁 [WORKFLOW] Renaming TypeScript workflow locally and syncing to cloud");

          // 1. Read current package.json
          const packageJsonResult = await invoke<{ content: string }>("read_workflow_file", {
            workflowId: String(workflowId),
            filePath: "package.json",
          });

          // 2. Parse and update the name
          const packageJson = JSON.parse(packageJsonResult.content);
          packageJson.name = sanitizedNewName;
          const updatedPackageJson = JSON.stringify(packageJson, null, 2);

          // 3. Write back to local file
          await invoke("write_typescript_workflow_file", {
            input: {
              workflow_id: String(workflowId),
              file_path: "package.json",
              content: updatedPackageJson,
            },
          });

          console.log("✅ [WORKFLOW] Local package.json updated");

          // 4. Sync to cloud
          try {
            await invoke("publish_typescript_workflow", {
              input: {
                workflow_id: String(workflowId),
                name: sanitizedNewName,
                description: workflow.description || "",
              },
            });
            console.log("✅ [WORKFLOW] Workflow renamed and synced to cloud");
          } catch (syncError) {
            console.warn("⚠️ [WORKFLOW] Local rename succeeded but cloud sync failed:", syncError);
            // Don't fail the whole operation - local rename succeeded
          }

          return { success: true };
        }

        // YAML workflows (numeric IDs) - use the backend API to rename
        await invoke("rename_workflow", {
          workflowId: workflowId,
          newName: sanitizedNewName,
        });

        console.log("✅ [WORKFLOW] Workflow renamed successfully in cloud");

        // Reload workflows to sync metadata changes (ensures rename persists through refresh)
        await loadWorkflows();

        return { success: true };
      } catch (error) {
        console.error("❌ Error renaming workflow:", error);

        // ROLLBACK: Reload workflows to restore correct state
        await loadWorkflows();

        return { success: false, error: String(error) };
      }
    },
    [workflows, currentWorkflow, loadWorkflows]
  );

  // Delete workflow function
  const deleteWorkflow = useCallback(
    async (workflowId: string | null) => {
      try {
        // Check if workflow has a valid ID
        if (workflowId === null) {
          console.error("❌ [WORKFLOW] Cannot delete unsaved workflow");
          return { success: false, error: "Cannot delete unsaved workflow" };
        }

        // Find the workflow by ID
        const workflow = workflows.find(w => w.id === workflowId);
        if (!workflow) {
          console.error("❌ [WORKFLOW] Workflow not found:", workflowId);
          return { success: false, error: "Workflow not found" };
        }

        console.log("🗑️ [WORKFLOW] Deleting workflow:", workflow.name, "ID:", workflowId);

        // All workflows now use string IDs (UUID folder names)
        // delete_typescript_workflow handles both local folder deletion and cloud archiving
        const result = await invoke<{
          success: boolean;
          local_deleted: boolean;
          cloud_archived: boolean;
          message: string;
        }>("delete_typescript_workflow", { folderId: workflowId });

        if (!result.success) {
          console.error("❌ [WORKFLOW] Delete failed:", result.message);
          return { success: false, error: result.message };
        }

        console.log("✅ [WORKFLOW] Successfully deleted workflow:", workflow.name, "-", result.message);

        // Update local state instead of full reload
        setWorkflows(prevWorkflows => prevWorkflows.filter(w => w.id !== workflowId));

        // If the deleted workflow was currently selected, clear selection
        if (currentWorkflow?.id === workflowId) {
          setCurrentWorkflow(null);
        }

        return { success: true };
      } catch (error) {
        console.error("❌ [WORKFLOW] Error deleting workflow:", error);
        return { success: false, error: String(error) };
      }
    },
    [workflows, currentWorkflow, setWorkflows, setCurrentWorkflow]
  );

  // Revert workflow to previous version by deleting latest version
  const revertWorkflowVersion = useCallback(
    async (workflowId: string | null) => {
      try {
        // Check if workflow has a valid ID
        if (workflowId === null) {
          console.error("❌ [WORKFLOW] Cannot revert unsaved workflow");
          return { success: false, error: "Cannot revert unsaved workflow" };
        }

        // Find the workflow by ID
        const workflow = workflows.find(w => w.id === workflowId);
        if (!workflow) {
          console.error("❌ [WORKFLOW] Workflow not found:", workflowId);
          return { success: false, error: "Workflow not found" };
        }

        console.log("⏪ [WORKFLOW] Reverting workflow to previous version:", workflow.name, "ID:", workflowId);

        // Call the backend API to delete the latest version
        await invoke("revert_workflow_version", { workflowId });

        console.log("✅ [WORKFLOW] Successfully reverted workflow:", workflow.name);

        // Reload the workflow to get the previous version
        if (currentWorkflow?.id === workflowId) {
          console.log("🔄 [WORKFLOW] Reloading current workflow to show previous version");
          await initializeWorkflow(workflowId, false);
        }

        // Reload workflows list to update metadata
        await loadWorkflows();

        return { success: true };
      } catch (error) {
        console.error("❌ [WORKFLOW] Error reverting workflow:", error);

        // Parse error message for user-friendly display
        const errorMessage = String(error);
        if (errorMessage.includes("ONLY_VERSION")) {
          return { success: false, error: "Cannot revert: This is the only version of the workflow" };
        } else if (errorMessage.includes("IS_CURRENT_VERSION")) {
          return { success: false, error: "Cannot revert: This version is currently deployed" };
        } else if (errorMessage.includes("HAS_EXECUTIONS")) {
          return { success: false, error: "Cannot revert: This version has execution history" };
        }

        return { success: false, error: errorMessage };
      }
    },
    [workflows, currentWorkflow, loadWorkflows, initializeWorkflow]
  );

  // Clone workflow function
  // TypeScript workflows (UUID string IDs) are cloned locally
  // YAML workflows (numeric IDs) are cloned via cloud API
  const cloneWorkflow = useCallback(
    async (workflowId: string | null) => {
      try {
        // Check if workflow has a valid ID
        if (workflowId === null) {
          console.error("❌ [WORKFLOW] Cannot clone unsaved workflow");
          return { success: false, error: "Cannot clone unsaved workflow" };
        }

        // Find the workflow by ID (supports both numeric and string UUIDs)
        const workflow = workflows.find(w => String(w.id) === String(workflowId));
        if (!workflow) {
          console.error("❌ [WORKFLOW] Workflow not found:", workflowId);
          return { success: false, error: "Workflow not found" };
        }

        console.log("🔄 [WORKFLOW] Cloning workflow:", workflow.name, "ID:", workflowId);

        // Check if this is a TypeScript workflow (UUID string) or YAML workflow (numeric)
        const isTypescriptWorkflow = typeof workflowId === "string" && isNaN(Number(workflowId));

        if (isTypescriptWorkflow) {
          // Local clone for TypeScript workflows
          console.log("🔄 [WORKFLOW] Using local clone for TypeScript workflow");
          const result = await invoke<{ id: string; path: string; name: string }>("clone_typescript_workflow", {
            workflowId: workflowId,
          });

          console.log("✅ [WORKFLOW] Locally cloned TypeScript workflow:", result.name, "New ID:", result.id);

          // Reload workflows to update the list
          await loadWorkflows();

          return { success: true, newWorkflowId: result.id };
        } else {
          // Cloud clone for YAML workflows (legacy)
          console.log("🔄 [WORKFLOW] Using cloud clone for YAML workflow");
          const newWorkflowId = await invoke<number>("clone_workflow", {
            workflowId: String(workflowId),
            workflowName: workflow.name,
          });

          console.log("✅ [WORKFLOW] Cloud cloned YAML workflow:", workflow.name, "New ID:", newWorkflowId);

          // Reload workflows to update the list
          await loadWorkflows();

          return { success: true, newWorkflowId };
        }
      } catch (error) {
        console.error("❌ [WORKFLOW] Error cloning workflow:", error);
        return { success: false, error: String(error) };
      }
    },
    [workflows, loadWorkflows]
  );

  // NOTE: saveYamlContent removed - YAML workflows deprecated

  // Update current workflow (for in-memory changes like name edits on unsaved recordings)
  const updateCurrentWorkflow = useCallback((updates: Partial<Workflow>) => {
    setCurrentWorkflow(prev => {
      if (!prev) return prev;
      return { ...prev, ...updates };
    });
  }, []);

  // Create refs to access latest functions without causing re-renders
  const loadWorkflowsRef = useRef<typeof loadWorkflows>(loadWorkflows);
  const setCurrentWorkflowRef = useRef<typeof setCurrentWorkflow>(setCurrentWorkflow);

  // Keep refs up to date
  useEffect(() => {
    loadWorkflowsRef.current = loadWorkflows;
  }, [loadWorkflows]);

  useEffect(() => {
    setCurrentWorkflowRef.current = setCurrentWorkflow;
  }, [setCurrentWorkflow]);

  // Setter for runtime execution options (not persisted to workflow)
  const setRuntimeExecutionOptions = useCallback((options: { skip_preflight_check?: boolean }) => {
    runtimeExecutionOptionsRef.current = { ...runtimeExecutionOptionsRef.current, ...options };
  }, []);

  // Lazy load file content - loads file on demand and caches it
  const loadFileContent = useCallback(
    async (filePath: string): Promise<TypeScriptWorkflowFile | null> => {
      if (!currentWorkflow?.id || typeof currentWorkflow.id !== "string") {
        console.warn("[WORKFLOW] Cannot load file: no TypeScript workflow loaded");
        return null;
      }

      // Normalize path for comparison
      const normalizedPath = filePath.replace(/\\/g, "/");

      // Helper to find file in tree
      const findInTree = (
        nodes: TypeScriptWorkflowFile[] | undefined,
        predicate: (f: TypeScriptWorkflowFile) => boolean
      ): TypeScriptWorkflowFile | undefined => {
        if (!nodes) return undefined;
        for (const node of nodes) {
          if (!node.isDirectory && predicate(node)) return node;
          if (node.children) {
            const found = findInTree(node.children, predicate);
            if (found) return found;
          }
        }
        return undefined;
      };

      // Check if already cached (file exists in tree with content)
      const cachedFile = findInTree(
        currentWorkflow.files,
        f => f.path.replace(/\\/g, "/") === normalizedPath && f.content !== undefined
      );
      if (cachedFile) {
        console.log(`📄 [WORKFLOW] File already cached: ${filePath}`);
        return cachedFile;
      }

      try {
        console.log(`📂 [WORKFLOW] Loading file content: ${filePath}`);
        const result = await invoke<{
          path: string;
          content: string;
          is_binary: boolean;
          mime_type: string | null;
        }>("read_workflow_file", {
          workflowId: currentWorkflow.id,
          filePath: normalizedPath,
        });

        const fileName = normalizedPath.split("/").pop() || normalizedPath;
        const newFile: TypeScriptWorkflowFile = {
          name: fileName,
          path: result.path.replace(/\\/g, "/"),
          isDirectory: false,
          content: result.content,
          isStepFile: result.path.includes("/steps/"),
          mimeType: result.mime_type ?? undefined,
        };

        // Update tree by finding and updating the node, or add to root if not found
        setCurrentWorkflow(prev => {
          if (!prev) return prev;

          // Helper to update file content in tree
          const updateTree = (nodes: TypeScriptWorkflowFile[]): TypeScriptWorkflowFile[] => {
            return nodes.map(node => {
              if (!node.isDirectory && node.path.replace(/\\/g, "/") === normalizedPath) {
                return { ...node, content: result.content, mimeType: result.mime_type ?? undefined };
              }
              if (node.children) {
                return { ...node, children: updateTree(node.children) };
              }
              return node;
            });
          };

          const updatedFiles = prev.files ? updateTree(prev.files) : [newFile];
          return { ...prev, files: updatedFiles };
        });

        console.log(`✅ [WORKFLOW] File loaded and cached: ${filePath}`);
        return newFile;
      } catch (error) {
        console.error(`❌ [WORKFLOW] Failed to load file: ${filePath}`, error);
        return null;
      }
    },
    [currentWorkflow?.id, currentWorkflow?.files]
  );

  // Load community workflows (public workflows from other organizations)
  const loadCommunityWorkflows = useCallback(async (): Promise<Workflow[]> => {
    console.log("🌐 [WORKFLOW] Loading community workflows...");
    try {
      const summaries = await invoke<
        Array<{
          id: number;
          name: string;
          description: string;
          step_count: number;
          last_modified: string;
          created_at: string;
          created_by?: string;
          organization_id?: string;
          is_public?: boolean;
          author_name?: string | null;
          current_version?: string;
          latest_version?: string;
          total_versions?: number;
          github_folder?: string;
          uuid?: string;
          tags?: string[];
          is_featured?: boolean;
        }>
      >("list_community_workflows");

      if (summaries && summaries.length > 0) {
        console.log(`✅ [WORKFLOW] Found ${summaries.length} community workflows`);

        // Convert backend summaries to frontend Workflow format
        const communityWorkflows: Workflow[] = summaries.map(summary => ({
          id: summary.github_folder || String(summary.id),
          name: summary.name,
          description: summary.description,
          stepCount: summary.step_count,
          lastModified: summary.last_modified,
          isOriginal: true,
          content: { steps: [] },
          isModified: false,
          parseError: undefined,
          createdBy: summary.created_by,
          organizationId: summary.organization_id,
          isPublic: summary.is_public,
          authorName: summary.author_name,
          currentVersion: summary.latest_version || summary.current_version,
          latestVersion: summary.latest_version,
          totalVersions: summary.total_versions,
          githubFolder: summary.github_folder,
          uuid: summary.uuid,
          tags: summary.tags,
          isFeatured: summary.is_featured,
          isCloudOnly: true, // Community workflows need to be downloaded
        }));

        return communityWorkflows;
      }

      console.log("ℹ️ [WORKFLOW] No community workflows found");
      return [];
    } catch (error) {
      console.error("❌ [WORKFLOW] Failed to load community workflows:", error);
      throw error;
    }
  }, []);

  return {
    // State
    workflows,
    currentWorkflow,
    currentStep,
    stepResult,
    stepProgress, // NEW: Progress tracking for JavaScript steps
    workflowExecutionLogs, // NEW: All execution logs for completed steps
    workflowExecutionState, // NEW: Execution state (env variables, inputs, custom set_env)
    liveStepStatus, // Real-time step status from MCP notifications
    logsRefreshKey, // Counter to trigger logs UI refresh after step execution
    workflowState,
    isLoading,
    loadingWorkflowId, // NEW: Track which workflow is currently loading
    isModifyingWorkflow, // NEW: Track when modifying workflow (AI changes, step deletion)
    isExecuting: workflowState === "executing",
    isRecording: workflowState === "recording", // Derived state
    isStopping: workflowState === "stopping_recording", // Derived state for stopping
    highlightState,
    isFullWorkflowMode, // NEW: Track when executing full workflow (all steps at once)
    executingRange, // Track range execution boundaries { start, end } or null
    isPreparingWorkflow, // Track when installing dependencies

    // Actions
    loadWorkflows,
    loadCommunityWorkflows,
    initializeWorkflow,
    startWorkflow,
    startRecordingWorkflow,
    updateRecordingSteps,
    saveRecordedWorkflow,

    // Unified recording action
    toggleRecording, // This now uses handleRecordingToggle internally
    startRecording, // Kept for backward compatibility if needed
    stopRecording, // Kept for backward compatibility if needed

    executeStep,
    executeFullWorkflow,
    executeStepRange,
    jumpToStep,
    interruptStep,
    startExecution,
    backToList,
    resetWorkflowExecutionState,
    reloadExecutionState, // Reload state.json when file changes externally
    deleteWorkflow,
    cloneWorkflow,
    revertWorkflowVersion,
    updateWorkflowName,
    updateCurrentWorkflow,
    // NOTE: saveYamlContent removed - YAML workflows deprecated
    saveWorkflowExecution,
    setRuntimeExecutionOptions,
    loadFileContent, // Lazy load file content on demand

    // Permission/Authorization
    canEditWorkflow,

    // Highlighting functions
    highlightStepTarget,
    clearHighlight,

    // New chat integration functions
    handleToolExecutionResult,
  };
}
// Trigger rebuild
