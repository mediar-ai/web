/**
 * Workflow Step Highlighting Utilities
 *
 * Provides logic for detecting which workflow steps can be highlighted
 * and configuration for highlighting behavior during workflow execution.
 */

import type { SequenceStep } from "@/lib/workflow-schema";

// Verbose flag to reduce duplicate highlight logs in normal runs
const VERBOSE_HIGHLIGHT_LOGS = false;

// Tools that support element highlighting via selector parameter
const HIGHLIGHTABLE_TOOLS = [
  "click_element",
  "type_into_element",
  "wait_for_element",
  "select_option",
  "set_toggled",
  "set_selected",
  "validate_element",
  "invoke_element",
  "scroll_element",
  "set_range_value",
  "highlight_element",
  "activate_element",
  "close_element",
  "capture_element_screenshot",
  "mouse_drag",
  "press_key",
];

// Tools that never support highlighting (no UI element involved)
const NON_HIGHLIGHTABLE_TOOLS = [
  "open_application",
  "run_command",
  "navigate_browser",
  "delay",
  "press_key_global",
  "record_workflow",
  "stop_recording",
  "get_applications",
  "get_window_tree",
  "get_focused_window_tree",
  "execute_sequence",
  "import_workflow_sequence",
  "export_workflow_sequence",
  "open_url",
];

// Highlighting configuration
// NOTE: There's a known issue where the MCP server may not respect the duration_ms parameter
// According to docs, default is 1000ms, but we're seeing ~500ms in practice
// We're setting 30s here but the actual duration appears to be controlled by the MCP server
export const HIGHLIGHT_CONFIG = {
  color: 255, // Red (BGR format)
  duration_ms: 30000, // 30 seconds - long enough for user decision (Note: MCP server may not respect this)
  fallback_duration: 5000, // Shorter duration if element becomes unavailable
  // Visual indicator update interval
  status_update_interval: 1000,
};

/**
 * Check if a selector represents a window-level element
 * Window-level elements cannot be highlighted due to Windows API limitations
 */
function isWindowLevelSelector(selector: string): boolean {
  // Check for window role
  if (selector.includes("role:Window")) {
    return true;
  }

  // Check for application prefix (simplified format from recording)
  if (selector.startsWith("application|")) {
    return true;
  }

  // Check for window-specific patterns
  const windowPatterns = [/^Window\|/i, /role:\s*Window/i, /class:\s*Window/i];

  return windowPatterns.some(pattern => pattern.test(selector));
}

/**
 * Check if a workflow step can be highlighted
 */
export function canHighlightStep(step: SequenceStep): boolean {
  const effectiveTool = (step as any).tool_name ?? (step as any).tool;
  // Check if tool is explicitly non-highlightable
  if (NON_HIGHLIGHTABLE_TOOLS.includes(effectiveTool)) {
    if (VERBOSE_HIGHLIGHT_LOGS) {
      console.log("🚫 [HIGHLIGHT] Skipping non-highlightable tool:", effectiveTool);
    }
    return false;
  }

  // Get selector from arguments (SequenceStep doesn't have parameters)
  const args = step.arguments as Record<string, any>;
  const selector = args?.selector;

  // No selector means can't highlight
  if (!selector) {
    return false;
  }

  // For activate_element, check if it's a window operation
  if (effectiveTool === "activate_element" && isWindowLevelSelector(selector)) {
    if (VERBOSE_HIGHLIGHT_LOGS) {
      console.log("🚫 [HIGHLIGHT] Skipping window activation - cannot highlight window frames:", selector);
    }
    return false;
  }

  // For close_element, check if it's closing a window
  if (effectiveTool === "close_element" && isWindowLevelSelector(selector)) {
    if (VERBOSE_HIGHLIGHT_LOGS) {
      console.log("🚫 [HIGHLIGHT] Skipping window close operation - cannot highlight window frames:", selector);
    }
    return false;
  }

  // Standard highlightable tools check
  return HIGHLIGHTABLE_TOOLS.includes(effectiveTool);
}

/**
 * Extract selector from step parameters
 * Checks both parameters and arguments for selector (some tools store it in arguments)
 */
export function getStepSelector(step: SequenceStep): string | null {
  const args = step.arguments as Record<string, any>;
  const argSelector = args?.selector;

  // Debug logging to troubleshoot selector type issues
  if (argSelector !== undefined && typeof argSelector !== "string") {
    console.error("🔴 [SELECTOR] step.arguments.selector is not a string:", {
      type: typeof argSelector,
      value: argSelector,
      stepName: step.name,
    });
  }

  // Handle case where selector might be nested object with .selector property
  let selector = argSelector || null;

  // Defensive: If selector is an object with a .selector property, extract it
  if (selector && typeof selector === "object" && "selector" in selector) {
    console.warn("⚠️ [SELECTOR] Found nested selector object, extracting .selector property:", {
      original: selector,
      extracted: (selector as any).selector,
      stepName: step.name,
    });
    selector = (selector as any).selector;
  }

  // Final validation: ensure we return string or null
  if (selector !== null && typeof selector !== "string") {
    console.error("🔴 [SELECTOR] Selector is not a string after extraction:", {
      type: typeof selector,
      value: selector,
      stepName: step.name,
    });
    return null;
  }

  return selector;
}

/**
 * Extract alternative selectors from step parameters
 * Checks both parameters and arguments for alternative selectors
 * Handles both string and array formats (workflow files use arrays, MCP expects comma-separated strings)
 */
export function getStepAlternativeSelectors(step: SequenceStep): string | null {
  const args = step.arguments as Record<string, any>;
  const altSelector = args?.alternative_selectors || args?.fallback_selectors || null;

  // Handle null case
  if (altSelector === null) {
    return null;
  }

  // Handle array format (from workflow YAML/JSON files)
  if (Array.isArray(altSelector)) {
    if (altSelector.length === 0) {
      return null;
    }
    // Join array elements into comma-separated string (MCP format)
    const joined = altSelector.filter(s => typeof s === "string").join(", ");
    if (joined.length === 0) {
      console.warn("⚠️ [SELECTOR] Alternative selector array contains no valid strings:", {
        value: altSelector,
        stepName: step.name,
      });
      return null;
    }
    return joined;
  }

  // Handle string format (already in MCP format)
  if (typeof altSelector === "string") {
    return altSelector;
  }

  // Handle nested object case
  if (typeof altSelector === "object" && "alternative_selectors" in altSelector) {
    console.warn("⚠️ [SELECTOR] Found nested alternative_selectors object:", {
      value: altSelector,
      stepName: step.name,
    });
    const nested = (altSelector as any).alternative_selectors;
    // Recursively handle the nested value (could be array or string)
    if (Array.isArray(nested)) {
      return nested.filter(s => typeof s === "string").join(", ");
    }
    if (typeof nested === "string") {
      return nested;
    }
  }

  // Unhandled type
  console.warn("⚠️ [SELECTOR] Alternative selector has unsupported type:", {
    type: typeof altSelector,
    value: altSelector,
    stepName: step.name,
  });
  return null;
}

/**
 * Get step type for highlighting color customization (future enhancement)
 */
export function getStepType(step: SequenceStep): "click" | "input" | "wait" | "other" {
  const effectiveTool = (step as any).tool_name ?? (step as any).tool;
  if (effectiveTool === "click_element" || effectiveTool === "invoke_element") {
    return "click";
  }
  if (effectiveTool === "type_into_element") {
    return "input";
  }
  if (effectiveTool === "wait_for_element") {
    return "wait";
  }
  return "other";
}

/**
 * Substitute template variables in a string
 * Used for highlighting preview (client-side substitution)
 */
function substituteTemplateString(
  str: string,
  variables: Record<string, any>,
  selectors: Record<string, string>
): string {
  // Log what we receive at the very start
  console.log("🔍 [SUBSTITUTE] substituteTemplateString called with:", {
    strType: typeof str,
    strValue: str,
    isString: typeof str === "string",
  });

  // Defensive: handle non-string input
  if (typeof str !== "string") {
    console.error("🔴 [SUBSTITUTE] substituteTemplateString received non-string input:", {
      type: typeof str,
      value: str,
    });
    // Try to convert to string if possible
    if (str && typeof str === "object" && "selector" in str) {
      console.warn("⚠️ [SUBSTITUTE] Extracting .selector from object");
      str = (str as any).selector;
    }
    // Final fallback: convert to string
    if (typeof str !== "string") {
      console.error("🔴 [SUBSTITUTE] Cannot convert to string, returning empty string");
      return "";
    }
  }

  let result = str;

  // Substitute ${{ selectors.key }}
  result = result.replace(/\$\{\{\s*selectors\.(\w+)\s*\}\}/g, (match, key) => {
    return selectors[key] !== undefined ? String(selectors[key]) : match;
  });

  // Substitute ${{ variables.key }}
  result = result.replace(/\$\{\{\s*variables\.(\w+)\s*\}\}/g, (match, key) => {
    const varDef = variables[key];
    return varDef?.default !== undefined ? String(varDef.default) : match;
  });

  return result;
}

/**
 * Create highlight arguments for MCP tool call
 * Performs client-side template substitution for highlighting preview
 */
export function createHighlightArgs(
  step: SequenceStep,
  config = HIGHLIGHT_CONFIG,
  workflowContext?: { variables?: Record<string, any>; selectors?: Record<string, string> }
) {
  const selector = getStepSelector(step);
  const alternativeSelectors = getStepAlternativeSelectors(step);

  // Debug log the selector value before using it
  console.log("🔍 [HIGHLIGHT] createHighlightArgs - selector value:", {
    selector,
    selectorType: typeof selector,
    stepName: step.name,
    hasWorkflowContext: !!workflowContext,
  });

  if (!selector) {
    throw new Error("Step does not have a selector for highlighting");
  }

  // Additional validation before calling substituteTemplateString
  if (typeof selector !== "string") {
    console.error("🔴 [HIGHLIGHT] Selector is not a string before substitution:", {
      type: typeof selector,
      value: selector,
      stepName: step.name,
    });
    throw new Error(`Selector must be a string, got ${typeof selector}`);
  }

  // Perform client-side substitution for highlighting (not for execution)
  const substitutedSelector = workflowContext
    ? substituteTemplateString(selector, workflowContext.variables || {}, workflowContext.selectors || {})
    : selector;

  const substitutedAltSelectors =
    alternativeSelectors && workflowContext
      ? substituteTemplateString(alternativeSelectors, workflowContext.variables || {}, workflowContext.selectors || {})
      : alternativeSelectors;

  return {
    selector: substitutedSelector,
    color: config.color,
    duration_ms: config.duration_ms,
    // Performance: avoid expensive UI tree retrieval during highlight preview
    include_tree: false,
    ...(substitutedAltSelectors && { alternative_selectors: substitutedAltSelectors }),
  };
}

/**
 * Highlighting state interface
 */
export interface HighlightState {
  isActive: boolean;
  error: string | null;
  stepId: number | null;
  startTime: number | null;
  retryCount: number;
}

/**
 * Create initial highlight state
 */
export function createInitialHighlightState(): HighlightState {
  return {
    isActive: false,
    error: null,
    stepId: null,
    startTime: null,
    retryCount: 0,
  };
}
