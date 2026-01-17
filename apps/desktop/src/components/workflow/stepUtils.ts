import type { StepResult } from "@/hooks/useWorkflow";
import type { SequenceStep } from "@/lib/workflow-schema";
import type { StepStatus } from "./types";

/**
 * Check if a step uses JavaScript (either run_javascript or run_command with javascript engine)
 */
export function isJavaScriptStep(step: SequenceStep): boolean {
  const args = step.arguments as Record<string, any>;
  return (
    (step.tool_name === "run_javascript" && (args?.script || args?.script_file)) ||
    (step.tool_name === "run_command" && args?.engine === "javascript" && (args?.script || args?.script_file))
  );
}

/**
 * Get the execution status of a step
 */
export function getStepStatus(
  stepIndex: number,
  currentStep: number,
  isCompleted: boolean,
  isExecuting: boolean,
  workflowState: string,
  stepResult?: StepResult,
  workflowExecutionLogs?: { [stepIndex: number]: { result?: { success?: boolean; error?: string } } }
): StepStatus {
  if (stepIndex === currentStep) {
    if (isCompleted) return "completed";
    if (isExecuting) return "executing";
    if (stepResult) {
      if (stepResult.partialFailure) return "partial_failure";
      return stepResult.success ? "completed" : "failed";
    }
    return "idle"; // Current but not started
  }
  // Steps before current: check if they were actually executed
  if (stepIndex < currentStep) {
    // Check if this step has execution logs - if yes, it was executed
    const wasExecuted = workflowExecutionLogs && workflowExecutionLogs[stepIndex];
    if (wasExecuted) {
      // Check if it succeeded or failed based on the logs
      const stepLog = workflowExecutionLogs[stepIndex];
      if (stepLog.result?.error) return "failed";
      return stepLog.result?.success ? "completed" : "failed";
    }
    // No execution logs = step was skipped/not executed
    return "idle";
  }
  return "idle"; // Pending
}

/**
 * Get the visual symbol for a step status
 */
export function getStatusSymbol(status: StepStatus): string {
  switch (status) {
    case "completed":
      return "✓";
    case "executing":
      return "⟳";
    case "partial_failure":
      return "⚠";
    case "failed":
      return "✗";
    case "idle":
      return "◦";
    default:
      return "◦";
  }
}

/**
 * Get the CSS color class for a step status
 */
export function getStatusColor(status: StepStatus, isRetrying: boolean = false): string {
  if (isRetrying) return "text-yellow-600 animate-pulse";

  switch (status) {
    case "completed":
      return "text-black";
    case "executing":
      return "text-black";
    case "partial_failure":
      return "text-orange-600";
    case "failed":
      return "text-red-600";
    case "idle":
      return "text-gray-400";
    default:
      return "text-gray-400";
  }
}

/**
 * Format step parameters for display
 */
export function formatParameters(params: Record<string, any> | undefined | null): string {
  if (!params || typeof params !== "object") {
    return "No parameters";
  }

  const entries = Object.entries(params).filter(([key]) => key !== "delay_ms"); // Filter out delay_ms for cleaner display

  if (entries.length === 0) {
    return "No parameters";
  }

  return entries
    .map(([key, value]) => {
      // Special handling for selector parameter to show more meaningful info
      if (key === "selector" && typeof value === "string") {
        // Extract the most meaningful part of the selector
        const nameMatch = value.match(/name:([^|>]+)/);
        const roleMatch = value.match(/role:([^|>]+)/);
        if (nameMatch) {
          const name = nameMatch[1].trim();
          return `selector:${name.length > 20 ? name.substring(0, 20) + "..." : name}`;
        } else if (roleMatch) {
          return `selector:${roleMatch[1]}`;
        }
        return `selector:${value.substring(0, 20)}...`;
      }

      // Handle strings
      if (typeof value === "string" && value.length > 30) {
        return `${key}:${value.substring(0, 25)}...`;
      }

      // Handle objects, arrays, and other complex types
      if (typeof value === "object" && value !== null) {
        const jsonStr = JSON.stringify(value);
        if (jsonStr.length > 30) {
          return `${key}:${jsonStr.substring(0, 25)}...`;
        }
        return `${key}:${jsonStr}`;
      }

      // Handle primitives (numbers, booleans, null, undefined)
      return `${key}:${value}`;
    })
    .join(", ");
}

/**
 * Check if a step uses an external script file
 */
export function usesScriptFile(step: SequenceStep): boolean {
  const args = step.arguments as Record<string, any>;
  return (
    (step.tool_name === "run_javascript" && Boolean(args?.script_file)) ||
    (step.tool_name === "run_command" && args?.engine === "javascript" && Boolean(args?.script_file))
  );
}
