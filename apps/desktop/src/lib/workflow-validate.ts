import * as YAML from "yaml";
import { WorkflowContent, WorkflowMetadata } from "./workflow-schema";

/**
 * Normalize selector fields in step arguments
 * Converts array-format alternative_selectors and fallback_selectors to comma-separated strings
 * This ensures compatibility with MCP tool schema which expects strings, not arrays
 */
function normalizeSelectorFields(step: any): any {
  if (!step || typeof step !== "object") return step;

  const normalized = { ...step };

  // Normalize arguments if present
  if (normalized.arguments && typeof normalized.arguments === "object") {
    normalized.arguments = { ...normalized.arguments };

    // Convert alternative_selectors array to comma-separated string
    if (Array.isArray(normalized.arguments.alternative_selectors)) {
      normalized.arguments.alternative_selectors = normalized.arguments.alternative_selectors
        .filter((s: any) => typeof s === "string")
        .join(", ");
    }

    // Convert fallback_selectors array to comma-separated string
    if (Array.isArray(normalized.arguments.fallback_selectors)) {
      normalized.arguments.fallback_selectors = normalized.arguments.fallback_selectors
        .filter((s: any) => typeof s === "string")
        .join(", ");
    }
  }

  return normalized;
}

/**
 * Stringify workflow to unwrapped format with metadata comments
 */
export function stringifyWorkflow(content: WorkflowContent, metadata?: WorkflowMetadata): string {
  let yamlString = "";

  // Add metadata as comments if provided
  if (metadata && Object.keys(metadata).length > 0) {
    yamlString += "# @workflow-info\n";
    const metadataYaml = YAML.stringify(metadata);
    const metadataLines = metadataYaml.split("\n");
    for (const line of metadataLines) {
      if (line.trim()) {
        yamlString += `# ${line}\n`;
      }
    }
    yamlString += "\n";
  }

  // Normalize selector fields in all steps before serialization
  const normalizedContent = {
    ...content,
    steps: content.steps?.map(normalizeSelectorFields) || [],
  };

  // Add the workflow content
  yamlString += YAML.stringify(normalizedContent);

  return yamlString;
}
