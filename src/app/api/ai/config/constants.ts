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
  'listDevSteps',
  'getDevStepDetails',
  'getDevErrors',
  'getDevTimeline',
  'getDevPerformanceMetrics',
];

// Tools blocked in ask mode (actions that modify state)
export const ASK_MODE_BLOCKED_TOOLS = [
  // === MCP/Terminator action tools ===
  'click_element',
  'double_click_element',
  'type_into_element',
  'press_key',
  'navigate_browser',
  'scroll_element',
  'open_application',
  'run_command',
  'mouse_drag',
  'select_option',
  'set_selected',
  'invoke_element',
  'set_value',
  'execute_sequence',

  // === Server-side workflow editing tools ===
  'update_workflow_step',
  'add_workflow_step',
  'remove_workflow_step',
  'create_workflow',
  'delete_workflow',
  'rename_workflow',
  'save_workflow',
  'reorder_workflow_steps',
];
