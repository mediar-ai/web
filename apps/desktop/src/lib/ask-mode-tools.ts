/**
 * Ask/Act/X mode tool categorization
 *
 * Defines which tools are allowed in each mode:
 * - Ask mode: read-only tools (vs blocked state-changing tools)
 * - X mode: execute-only tools (commands, files, sequences - no UI automation)
 * This is the source of truth for tool categorization.
 */

// =============================================================================
// ALLOWED TOOLS (read-only, non-destructive) - can be used in Ask mode
// =============================================================================

export const ASK_MODE_ALLOWED_TOOLS = [
  // === Terminator MCP tools (read-only) ===
  "get_window_tree",
  "get_applications_and_windows_list",
  "validate_element",
  "wait_for_element",
  "capture_screenshot",
  "highlight_element",
  "hide_inspect_overlay",
  "delay",
  "activate_element", // Just focuses window, doesn't modify state

  // === Terminator file tools (read-only) ===
  "read_file",
  "glob_files",
  "grep_files",

  // === Server-side knowledge tools (read-only) ===
  "search_similar_workflow_steps",
];

// =============================================================================
// BLOCKED TOOLS (state-changing, destructive) - require Act mode
// =============================================================================

export const ASK_MODE_BLOCKED_TOOLS = [
  // === Terminator MCP action tools ===
  "click_element",
  "type_into_element",
  "press_key",
  "press_key_global",
  "scroll_element",
  "select_option",
  "set_selected",
  "set_value",
  "invoke_element",
  "mouse_drag",

  // === Terminator navigation/app tools ===
  "navigate_browser",
  "open_application",

  // === Terminator execution tools ===
  "execute_browser_script",
  "execute_sequence",
  "run_command",
  "gemini_computer_use",

  // === Terminator file tools (write) ===
  "write_file",
  "edit_file",
  "copy_content",

  // === Terminator control tools ===
  "stop_execution",
  "stop_highlighting",
];

// =============================================================================
// X MODE ALLOWED TOOLS (execute-only - commands, files, sequences)
// =============================================================================

export const X_MODE_ALLOWED_TOOLS = [
  // === Command execution ===
  "run_command",

  // === File operations ===
  "read_file",
  "write_file",
  "edit_file",
  "glob_files",
  "grep_files",

  // === Validation tools ===
  "typecheck_workflow",

  // === User interaction ===
  "ask_user",
];

// =============================================================================
// X MODE BLOCKED TOOLS (UI automation, navigation - not allowed in X mode)
// =============================================================================

export const X_MODE_BLOCKED_TOOLS = [
  // === UI automation tools (blocked - use run_command with desktop SDK instead) ===
  "click_element",
  "type_into_element",
  "press_key",
  "press_key_global",
  "scroll_element",
  "select_option",
  "set_selected",
  "set_value",
  "invoke_element",
  "mouse_drag",

  // === Navigation/app tools (blocked - use run_command instead) ===
  "navigate_browser",
  "open_application",

  // === Browser script (blocked - use run_command with desktop.executeBrowserScript) ===
  "execute_browser_script",

  // === Workflow execution (blocked - X mode edits workflows, doesn't run them via this) ===
  "execute_sequence",

  // === Other execution tools ===
  "gemini_computer_use",

  // === Read-only inspection tools (blocked - X mode focuses on editing) ===
  "get_window_tree",
  "get_applications_and_windows_list",
  "validate_element",
  "wait_for_element",
  "capture_screenshot",
  "highlight_element",
  "hide_inspect_overlay",
  "activate_element",

  // === Control tools ===
  "stop_execution",
  "stop_highlighting",
  "delay",
  "copy_content",

  // === Knowledge tools ===
  "search_similar_workflow_steps",
];

// =============================================================================
// RECORDER MODE TOOLS (file-editing only - for converting recordings to steps)
// =============================================================================

export const RECORDER_MODE_ALLOWED_TOOLS = [
  // === File operations (read + write) ===
  "read_file",
  "write_file",
  "edit_file",
  "glob_files",
  "grep_files",
];

export const RECORDER_MODE_BLOCKED_TOOLS = [
  // === All UI automation tools ===
  "click_element",
  "type_into_element",
  "press_key",
  "press_key_global",
  "scroll_element",
  "select_option",
  "set_selected",
  "set_value",
  "invoke_element",
  "mouse_drag",
  "get_window_tree",
  "get_applications_and_windows_list",
  "validate_element",
  "wait_for_element",
  "capture_screenshot",
  "highlight_element",
  "hide_inspect_overlay",
  "activate_element",

  // === Navigation/app tools ===
  "navigate_browser",
  "open_application",

  // === Execution tools (no running, just editing) ===
  "execute_browser_script",
  "execute_sequence",
  "run_command",
  "gemini_computer_use",

  // === Control tools ===
  "stop_execution",
  "stop_highlighting",
  "delay",
  "copy_content",

  // === Server-side knowledge tools ===
  "search_similar_workflow_steps",
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a tool is allowed in Ask mode
 */
export function isToolAllowedInAskMode(toolName: string): boolean {
  return ASK_MODE_ALLOWED_TOOLS.includes(toolName);
}

/**
 * Check if a tool is blocked in Ask mode
 */
export function isToolBlockedInAskMode(toolName: string): boolean {
  return ASK_MODE_BLOCKED_TOOLS.includes(toolName);
}

/**
 * Get the mode required for a tool
 * Returns 'ask' if tool is read-only, 'act' if tool requires action mode
 * Returns 'unknown' if tool is not categorized
 */
export function getToolRequiredMode(toolName: string): "ask" | "act" | "unknown" {
  if (ASK_MODE_ALLOWED_TOOLS.includes(toolName)) return "ask";
  if (ASK_MODE_BLOCKED_TOOLS.includes(toolName)) return "act";
  return "unknown";
}

/**
 * Check if a tool is allowed in X mode (execute-only)
 */
export function isToolAllowedInXMode(toolName: string): boolean {
  return X_MODE_ALLOWED_TOOLS.includes(toolName);
}

/**
 * Filter a tools object to only include tools allowed in X mode
 * @param tools - Object with tool names as keys
 * @returns Filtered object with only X mode allowed tools
 */
export function filterToolsForXMode<T extends Record<string, unknown>>(tools: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => X_MODE_ALLOWED_TOOLS.includes(name))
  ) as Partial<T>;
}

/**
 * Filter a tools object to only include tools allowed in Ask mode
 * @param tools - Object with tool names as keys
 * @returns Filtered object with only Ask mode allowed tools
 */
export function filterToolsForAskMode<T extends Record<string, unknown>>(tools: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => ASK_MODE_ALLOWED_TOOLS.includes(name))
  ) as Partial<T>;
}
