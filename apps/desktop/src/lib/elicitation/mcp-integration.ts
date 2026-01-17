/**
 * MCP Integration for Elicitation
 *
 * Bridges the MCP client (non-React) with the React elicitation UI.
 * Uses a callback pattern to allow the MCP client to trigger the UI.
 */

import { ElicitationRequest, ElicitationResponse } from "./types";

// Callback type for showing elicitation UI
type ElicitationHandler = (request: ElicitationRequest) => Promise<ElicitationResponse>;

// Global handler reference - set by React component
let globalElicitationHandler: ElicitationHandler | null = null;

/**
 * Register the elicitation handler from React.
 * Called by ElicitationProvider when it mounts.
 */
export function registerElicitationHandler(handler: ElicitationHandler): () => void {
  console.log("[MCP-ELICIT] Registering elicitation handler from React");
  globalElicitationHandler = handler;

  // Return cleanup function
  return () => {
    console.log("[MCP-ELICIT] Cleaning up elicitation handler");
    if (globalElicitationHandler === handler) {
      globalElicitationHandler = null;
    }
  };
}

/**
 * Check if elicitation UI is available.
 */
export function isElicitationAvailable(): boolean {
  return globalElicitationHandler !== null;
}

/**
 * Request elicitation from the MCP client side.
 * This is called by the MCP client when it receives an elicitation request.
 */
export async function requestElicitation(request: ElicitationRequest): Promise<ElicitationResponse> {
  console.log("[MCP-ELICIT] requestElicitation called:", request.message);
  console.log("[MCP-ELICIT] Handler registered:", !!globalElicitationHandler);

  if (!globalElicitationHandler) {
    console.warn("[MCP-ELICIT] No handler registered - declining request");
    return { action: "decline" };
  }

  console.log("[MCP-ELICIT] Calling global handler...");
  const response = await globalElicitationHandler(request);
  console.log("[MCP-ELICIT] Handler response:", response);
  return response;
}

/**
 * Convert MCP SDK request params to our ElicitationRequest type.
 */
export function convertMcpRequest(params: { message: string; requestedSchema: any; _meta?: any }): ElicitationRequest {
  return {
    message: params.message,
    requestedSchema: params.requestedSchema,
    context: params._meta?.["io.modelcontextprotocol/related-task"]
      ? {
          toolName: params._meta["io.modelcontextprotocol/related-task"]?.taskId,
        }
      : undefined,
  };
}

/**
 * Convert our ElicitationResponse to MCP SDK format.
 */
export function convertMcpResponse(response: ElicitationResponse): {
  action: string;
  content?: Record<string, unknown>;
} {
  return {
    action: response.action,
    content: response.content,
  };
}
