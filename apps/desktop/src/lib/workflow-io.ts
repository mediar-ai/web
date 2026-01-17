import { WorkflowContent, WorkflowMetadata } from "./workflow-schema";
import { stringifyWorkflow } from "./workflow-validate";

/**
 * Generate a human-readable step name from MCP tool call
 */
export function generateStepName(mcpStep: { tool_name: string; arguments?: any }): string {
  const { tool_name, arguments: args = {} } = mcpStep;

  switch (tool_name) {
    case "click_element": {
      const selector = args.selector || "";
      // Try to extract element name from selector
      // Format 1: role:Button && name:Submit → Submit
      const nameMatch = selector.match(/\|name:([^|>]+)/);
      if (nameMatch) {
        const elementName = nameMatch[1].trim();
        const truncatedName = elementName.length > 20 ? elementName.substring(0, 20) + "..." : elementName;
        return `Click ${truncatedName}`;
      }
      // Format 2: contains:Some Text → Some Text
      const containsMatch = selector.match(/contains:(.+)/);
      if (containsMatch) {
        const elementName = containsMatch[1].trim();
        const truncatedName = elementName.length > 20 ? elementName.substring(0, 20) + "..." : elementName;
        return `Click ${truncatedName}`;
      }
      // Format 3: role:Button → Button
      const roleMatch = selector.match(/role:([^|>]+)/);
      if (roleMatch) {
        return `Click ${roleMatch[1].trim()}`;
      }
      return "Click element";
    }
    case "type_into_element": {
      const textToType = args.text_to_type || args.text || "";
      if (textToType) {
        const truncatedText = textToType.length > 20 ? textToType.substring(0, 20) + "..." : textToType;
        return `Type "${truncatedText}"`;
      }
      return "Type text";
    }
    case "activate_element": {
      const activateSelector = args.selector || "";
      // Try |name: format first
      const appNameMatch = activateSelector.match(/\|name:([^|>]+)/);
      if (appNameMatch) {
        const appName = appNameMatch[1].split(" ")[0].trim();
        return `Switch to ${appName}`;
      }
      // Try contains: format
      const activateContainsMatch = activateSelector.match(/contains:(.+)/);
      if (activateContainsMatch) {
        const appName = activateContainsMatch[1].trim();
        const truncated = appName.length > 20 ? appName.substring(0, 20) + "..." : appName;
        return `Switch to ${truncated}`;
      }
      return "Switch to app";
    }
    case "navigate_browser": {
      const url = args.url || "";
      if (url) {
        // Extract domain from URL
        try {
          const domain = new URL(url).hostname.replace("www.", "");
          return `Navigate to ${domain}`;
        } catch {
          return "Navigate to URL";
        }
      }
      return "Navigate to URL";
    }
    case "press_key":
      return `Press ${args.key || "key"}`;
    default:
      // Convert tool_name to readable format (click_element → Click element)
      return tool_name
        .split("_")
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}

// Serialize UI workflow to unwrapped YAML format with metadata comments
export function serializeUiWorkflow(workflow: any): string {
  // Access content directly (no longer wrapped in arguments)
  const uiContent = workflow?.content || {};
  const uiSteps = Array.isArray(uiContent.steps) ? uiContent.steps : [];

  // Filter out null/undefined steps before mapping to prevent null entries in YAML
  const steps = uiSteps
    .filter((s: any) => s != null) // Remove null and undefined steps
    .map((s: any) => {
      const stepOut: any = {};

      // Use existing ID - IDs should already be present from recording or cloud storage
      if (s.id) {
        stepOut.id = s.id;
      }

      stepOut.name = s.name;
      stepOut.tool_name = s.tool_name ?? s.tool;
      stepOut.arguments = s.arguments ?? s.parameters ?? {};
      if (typeof s.delay_ms === "number") stepOut.delay_ms = s.delay_ms;
      if (typeof s.timeout_ms === "number") stepOut.timeout_ms = s.timeout_ms;
      if (typeof s.continue_on_error === "boolean") stepOut.continue_on_error = s.continue_on_error;
      if (typeof s.description === "string" && s.description.length > 0) stepOut.description = s.description;
      if (s.expected_ui_changes) stepOut.expected_ui_changes = s.expected_ui_changes;
      if (s.expected_dom_changes) stepOut.expected_dom_changes = s.expected_dom_changes;
      return stepOut;
    });

  // Build unwrapped content
  const content: WorkflowContent = {
    variables: uiContent.variables ?? {},
    selectors: uiContent.selectors ?? {},
    steps,
  };

  if (uiContent.output_parser) content.output_parser = uiContent.output_parser;
  if (typeof uiContent.stop_on_error !== "undefined") content.stop_on_error = uiContent.stop_on_error;
  if (typeof uiContent.include_detailed_results !== "undefined")
    content.include_detailed_results = uiContent.include_detailed_results;
  if (uiContent.raw_events && Array.isArray(uiContent.raw_events)) content.raw_events = uiContent.raw_events;

  // Extract metadata (from workflow.metadata or legacy workflow_info)
  const metadata: WorkflowMetadata = workflow?.metadata || workflow?.content?.workflow_info || {};

  // Use the new stringify function that adds metadata as comments
  return stringifyWorkflow(content, metadata);
}
