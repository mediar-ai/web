// Canonical Terminator execute_sequence schema (TypeScript types)

// JavaScript substep types for visualization
export interface JavaScriptSubStep {
  id: string;
  type: "action" | "loop" | "condition" | "data" | "wait" | "navigation" | "error-handling";
  title: string;
  description?: string;
  children?: JavaScriptSubStep[];
  metadata?: {
    iterations?: number;
    duration?: number;
    dataCount?: number;
    selector?: string;
    conditional?: boolean;
    url?: string;
    fields?: string[];
    totalAmount?: number;
  };
  lineNumbers?: {
    start: number;
    end: number;
  };
  status?: "pending" | "running" | "completed" | "error";
}

export interface ParsedJavaScript {
  title: string;
  summary: string;
  substeps: JavaScriptSubStep[];
  metadata: {
    totalLines: number;
    complexity: "simple" | "moderate" | "complex";
    estimatedDuration?: number;
    dataItemsCount?: number;
    hasErrorHandling: boolean;
    hasLoops: boolean;
    hasConditions: boolean;
  };
}

// Metadata parsed from YAML comments
export interface WorkflowMetadata {
  name?: string;
  description?: string;
  version?: string;
  tags?: string[];
  created_by?: string;
  created_date?: string;
  last_modified?: string;
  raw_events_file?: string; // Reference to raw events JSON file
  raw_events_count?: number; // Number of raw events stored
  [k: string]: unknown;
}

// Conditional jump for workflow control flow
export interface JumpCondition {
  if: string;
  to_id: string;
  reason?: string;
}

// Direct workflow structure (unwrapped)
export interface WorkflowContent {
  steps: SequenceStep[];
  variables?: Record<string, VariableDefinition>;
  inputs?: Record<string, unknown>;
  selectors?: Record<string, string> | string;
  stop_on_error?: boolean;
  include_detailed_results?: boolean;
  output_parser?: OutputParserDefinition | Record<string, unknown>;
  troubleshooting?: SequenceStep[];
  [k: string]: unknown;
}

export type SequenceStep = CommandStep | GroupStep;

// Desktop operation types for TypeScript workflows
export interface DesktopOperation {
  type: "locator" | "runCommand" | "openApplication" | "pressKey" | "delay" | "other";
  selector?: string;
  command?: string;
  application?: string;
  keys?: string;
  duration?: number;
}

// Error info extracted from TypeScript workflow steps
export interface WorkflowErrorInfo {
  code?: string;
  category?: string;
  message?: string;
  recoverable?: boolean;
}

export interface CommandStep {
  name?: string;
  tool_name?: string; // Optional for TypeScript steps
  arguments?: Record<string, unknown>;
  continue_on_error?: boolean;
  delay_ms?: number;
  retries?: number;
  timeout_ms?: number;
  id?: string;
  fallback_id?: string;
  if?: string;
  jumps?: JumpCondition[];
  // TypeScript workflow fields
  sourceFile?: string; // File path where step is defined (e.g., "src/steps/01-open-notepad.ts")
  lineStart?: number; // Line number where step starts
  lineEnd?: number; // Line number where step ends
  description?: string;
  desktopOperations?: DesktopOperation[];
  isImported?: boolean;
  importPath?: string;
  inputAccess?: string[]; // input.xxx fields accessed
  stateReads?: string[]; // context.state.xxx reads
  stateWrites?: string[]; // state keys written in return
  loggerCalls?: Array<{ level: string; message?: string }>;
  workflowErrors?: WorkflowErrorInfo[];
  hasEarlyReturn?: boolean; // Uses success() helper
  [k: string]: unknown;
}

export interface GroupStep {
  group_name: string;
  steps?: ToolCall[];
  skippable?: boolean;
  retries?: number;
  id?: string;
  fallback_id?: string;
  if?: string;
  jumps?: JumpCondition[];
  [k: string]: unknown;
}

export interface ToolCall {
  tool_name: string;
  arguments: Record<string, unknown>;
  continue_on_error?: boolean;
  delay_ms?: number;
  id?: string;
  [k: string]: unknown;
}

export type VariableType = "String" | "Number" | "Boolean" | "Enum" | "Array" | "Object";

export interface VariableDefinition {
  type: VariableType;
  label: string;
  description?: string;
  default?: unknown;
  regex?: string;
  options?: string[];
  required?: boolean;
  // For array type: schema for each item
  item_schema?: VariableDefinition;
  // For object type with known fields: schema for each property
  properties?: Record<string, VariableDefinition>;
  // For object type with uniform values: schema for all values
  value_schema?: VariableDefinition;
}

export interface OutputParserDefinition {
  ui_tree_source_step_id?: string;
  javascript_code?: string;
  javascript_file_path?: string;
}
