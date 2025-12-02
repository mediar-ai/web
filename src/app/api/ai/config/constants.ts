// Tools allowed in ask mode (read-only, non-destructive)
// This is the source of truth - desktop app fetches this list
export const ASK_MODE_ALLOWED_TOOLS = [
  // === MCP/Terminator tools (client-side) - read-only ===
  'get_window_tree',
  'get_applications_and_windows_list',
  'validate_element',
  'wait_for_element',
  'capture_screenshot',
  'capture_element_screenshot',
  'highlight_element',
  'stop_highlighting',
  'stop_execution',
  'delay',

  // === UI tools ===
  'render_action_button',

  // === Server-side knowledge tools (all read-only) ===
  'search_similar_workflow_steps',
  'get_terminator_api_docs',
  'search_terminator_api',
  'get_tool_details',

  // === Server-side workflow tools (read-only only) ===
  'get_workflow',
  'search_workflow',
  'get_step',

  // === Server-side dev log tools (all read-only) ===
  'getLatestExecutionLogs',
  'searchDevLogs',
];
