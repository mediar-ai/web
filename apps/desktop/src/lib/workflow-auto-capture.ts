/**
 * Workflow Auto-Capture Utility
 *
 * Determines which MCP tools should be captured to workflows.
 */

// Tools that should NOT be auto-captured (read-only, workflow management tools)
const EXCLUDED_TOOLS = new Set([
  // Workflow management tools
  "get_workflow",
  "get_step_info",
  "add_workflow_step",
  "update_workflow_step",
  "remove_workflow_step",
  "reorder_workflow_steps",
  "export_workflow",
  "import_workflow",

  // Read-only inspection tools
  "list_tools",
  "get_tool_info",

  // Tools that don't make sense in workflows
  "delay",
]);

/**
 * Check if a tool should be auto-captured to workflow
 */
export function shouldCaptureToolToWorkflow(toolName: string): boolean {
  return !EXCLUDED_TOOLS.has(toolName);
}
