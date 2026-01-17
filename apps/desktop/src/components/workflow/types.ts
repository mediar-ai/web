import type { ConsoleLogEntry, ProgressInfo } from "@/lib/workflow-progress-parser";
import type { SequenceStep } from "@/lib/workflow-schema";

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

// File tree node for IDE-style file browsing
export interface FileTreeNode {
  name: string;
  path: string; // Relative path from workflow root
  isDirectory: boolean;
  children?: FileTreeNode[];
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
  content: {
    steps: SequenceStep[];
    variables?: Record<string, any>;
    inputs?: Record<string, unknown>; // YAML workflow input variables
    selectors?: Record<string, string> | string;
    troubleshooting?: SequenceStep[];
    output?: string;
    stop_on_error?: boolean;
    include_detailed_results?: boolean;
    skip_preflight_check?: boolean;
  };
  stepCount?: number;
  lastModified?: string;
  // NOTE: yamlContent removed - YAML workflows deprecated
  parseError?: string;
  isModified?: boolean;
  rawEvents?: any[];
  isNewRecording?: boolean;
  recordingMetadata?: {
    originalStepCount: number;
    recordingStartedAt: string;
    lowEnergyMode: boolean;
    conversionNotes: string[];
    highlightingEnabled: boolean;
  };
  // TypeScript workflow fields (top-level, not in content)
  localPath?: string; // Full path to workflow folder
  files?: TypeScriptWorkflowFile[]; // File tree with lazy-loaded content
  inputs?: ParsedInputField[]; // Parsed input schema from TypeScript
  hasOnSuccess?: boolean;
  hasOnError?: boolean;
  trigger?: import("@/lib/typescript-workflow-parser").TriggerConfig; // Parsed trigger config
  sections?: ParsedSection[]; // Parsed sections with line numbers
  // Visibility/ownership fields
  isPublic?: boolean; // True if workflow is publicly accessible
  organizationId?: string; // Owning organization ID
  userAccessLevel?: "owner" | "admin" | "write" | "read" | "public_read" | null; // User's access level for this workflow
}

export interface StepExecutionLog {
  stepName: string;
  tool: string;
  consoleLogs: ConsoleLogEntry[];
  result?: {
    success: boolean;
    output: unknown; // Raw result object (not stringified) to preserve ui_tree newlines
    error?: string;
  };
  startTime: number;
  endTime?: number;
  error?: string;
  // Detailed error data from MCP response (stderr/stdout/logs)
  stderr?: string;
  stdout?: string;
  errorLogs?: Array<{ timestamp: string; level: string; message: string }>;
  exitCode?: number;
}

export interface WorkflowExecutionLogs {
  [stepIndex: number]: StepExecutionLog;
}

export interface StepProgress {
  consoleLogs: ConsoleLogEntry[];
  progressInfo: ProgressInfo;
  lastUpdate: number;
}

export type StepStatus = "idle" | "executing" | "completed" | "failed" | "partial_failure" | "retrying";

export interface DeleteConfirmation {
  isOpen: boolean;
  stepIndex: number | null;
  stepName: string;
}

/** Workflow execution state from state.json file */
export interface WorkflowExecutionState {
  last_updated: string;
  last_step_id: string | null;
  last_step_index: number;
  workflow_id: string | null;
  workflow_file: string | null;
  env: Record<string, unknown>;
}

/** Filtered state variables (excludes step results) */
export interface FilteredStateVars {
  inputs?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  customVars: Record<string, unknown>;
}
