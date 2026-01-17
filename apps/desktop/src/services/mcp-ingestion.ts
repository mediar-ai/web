/**
 * MCP Tool Execution Ingestion Service
 *
 * Ingests MCP tool execution data (requests + responses) to the RPA knowledgebase
 * via the backend Tauri command for building a searchable repository of workflow patterns.
 */

import { invoke } from "@tauri-apps/api/core";

interface McpToolExecution {
  tool_name: string;
  arguments: any;
  result?: any;
  error?: any;
  duration_ms: number;
  workflow_name?: string;
  step_name?: string;
}

/**
 * Extract selector from click_element result when using index mode.
 * @public Exported for use in step pool ingestion
 *
 * When AI clicks by index (e.g., index: 5, vision_type: ui_tree), the MCP tool
 * resolves this to an actual selector and returns it in the result. This function
 * extracts that selector and merges it into arguments so workflow steps use
 * portable selectors instead of ephemeral indices.
 *
 * Result format: [{ type: "text", text: "{...json with selector...}" }]
 */
export function extractSelectorFromClickResult(result: any): string | null {
  if (!result) return null;

  // Format 1: Raw MCP array format [{ type: "text", text: "{...}" }]
  if (Array.isArray(result)) {
    for (const item of result) {
      if (item?.type === "text" && typeof item.text === "string") {
        try {
          const parsed = JSON.parse(item.text);
          // Only extract from index mode clicks (mode: "index")
          if (parsed.mode === "index" && typeof parsed.selector === "string") {
            return parsed.selector;
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }
    return null;
  }

  // Format 2: Already parsed object { mode: "index", selector: "..." }
  if (typeof result === "object" && result.mode === "index" && typeof result.selector === "string") {
    return result.selector;
  }

  return null;
}

/**
 * Normalize click_element arguments by merging selector from result.
 *
 * When click_element is called with index mode (has `index` but no `selector`),
 * extract the resolved selector from the result and add it to arguments.
 * This ensures workflow steps created from index clicks use proper selectors.
 *
 * The original `index` is preserved for auditing/debugging purposes.
 */
export function normalizeClickElementArguments(toolName: string, args: any, result: any): any {
  // Only process click_element (may have mcp__ prefix)
  if (!toolName.includes("click_element")) return args;

  // Only process index mode (has index, no selector)
  if (!args || typeof args.index !== "number" || args.selector) return args;

  // Only process ui_tree vision type (default or explicit)
  const visionType = args.vision_type || "ui_tree";
  if (visionType !== "ui_tree" && visionType !== "uitree") return args;

  // Extract selector from result
  console.log("[MCP-INGEST] Attempting to extract selector from result", {
    resultIsArray: Array.isArray(result),
    resultIsObject: typeof result === "object" && !Array.isArray(result),
    resultMode: typeof result === "object" && !Array.isArray(result) ? result?.mode : "N/A",
    resultHasSelector: typeof result === "object" && !Array.isArray(result) ? !!result?.selector : "N/A",
  });
  const selector = extractSelectorFromClickResult(result);
  console.log("[MCP-INGEST] Extracted selector:", selector ? selector.substring(0, 100) + "..." : "null");
  if (!selector) return args;

  console.log("[MCP-INGEST] Normalizing click_element: extracted selector from index click", {
    index: args.index,
    selector,
  });

  // Return new args with selector merged in (keep index for auditing)
  return {
    ...args,
    selector,
  };
}

/**
 * Ingest MCP tool execution to RPA knowledgebase
 *
 * Sends tool execution data to backend via Tauri command.
 * Backend handles the API call to RPA KB endpoint.
 * Fires asynchronously (fire-and-forget) to avoid blocking tool execution.
 * Errors are logged but not thrown.
 */
export async function ingestMcpToolExecution(execution: McpToolExecution): Promise<void> {
  try {
    // Get auth token if available
    let authToken: string | undefined;
    try {
      authToken = (await invoke<string | null>("get_stored_auth_token")) || undefined;
    } catch (e) {
      // Auth token fetch failed, continue without it
      console.debug("[MCP-INGEST] Could not get auth token:", e);
    }

    // Normalize arguments: extract selector from result for index-based clicks
    const normalizedArguments = normalizeClickElementArguments(
      execution.tool_name,
      execution.arguments,
      execution.result
    );

    console.log("[MCP-INGEST] Ingesting tool execution:", {
      tool: execution.tool_name,
      workflow: execution.workflow_name,
      duration: execution.duration_ms,
    });

    // Call backend Tauri command - fire and forget
    invoke("ingest_mcp_execution", {
      toolName: execution.tool_name,
      arguments: normalizedArguments,
      result: execution.result,
      error: execution.error,
      durationMs: execution.duration_ms,
      workflowName: execution.workflow_name,
      stepName: execution.step_name,
      authToken,
    })
      .then(() => {
        console.log("[MCP-INGEST] Successfully sent to backend for ingestion");
      })
      .catch(error => {
        console.warn("[MCP-INGEST] Failed to send to backend:", error);
      });

    // Don't await - fire and forget
  } catch (error) {
    // Log but don't throw - ingestion failures should never break tool execution
    console.warn("[MCP-INGEST] Failed to ingest tool execution:", error);
  }
}
