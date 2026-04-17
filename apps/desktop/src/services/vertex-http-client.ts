/**
 * Vertex AI client - supports both web app API and Rust backend
 *
 * Two modes:
 * 1. Web App API (legacy): Calls /api/ai endpoint on web app
 * 2. Rust Backend (new): Calls Vertex AI directly via Tauri commands
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// =============================================================================
// Types
// =============================================================================

export interface VertexMessage {
  role: "user" | "model";
  parts: Array<{
    text?: string;
    functionCall?: { name: string; args: Record<string, any> };
    functionResponse?: { name: string; response: any };
    /** Gemini 3 thought signature - encrypted representation of model's thought process */
    thoughtSignature?: string;
    /** Inline image data for multimodal requests (screenshots from tool execution) */
    inlineData?: { mimeType: string; data: string };
  }>;
}

export interface VertexTool {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

export interface VertexRequest {
  model?: "gemini-2.5-flash" | "gemini-2.5-pro" | "gemini-pro-latest" | "claude-sonnet-4-6" | "claude-opus-4-7" | "claude-haiku-4-5";
  sessionId?: string; // Server-side session ID (preferred for KV-backed history)
  input?: string; // User message (omit when sending tool results)
  history?: VertexMessage[]; // Full conversation history (fallback for client-side history)
  system?: string;
  tools?: VertexTool[];
  toolResults?: Array<{ id: string; name: string; result: any }>; // For continuing conversation after tool execution
  workflowId?: number | string; // Workflow ID for server-side workflow editing tools (string for TypeScript workflows)
  thinkingLevel?: "low" | "high"; // Thinking level for Gemini 3 models
  mode?: "ask" | "act" | "x" | "recorder" | "homepage"; // Ask: read-only, Act: full tools, X: execute-only, Recorder: file-editing only, Homepage: app helper
  /** Inline images (pasted screenshots) to send with the user message */
  inlineImages?: Array<{ data: string; mimeType: string }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

export interface VertexToolCall {
  id?: string; // Tool call ID (may not be present from Rust backend)
  name: string;
  args: Record<string, any>;
}

export interface VertexResponse {
  model?: string;
  sessionId?: string;
  text: string;
  toolCalls: VertexToolCall[];
  finishReason: "stop" | "tool_calls";
  metrics?: {
    elapsedMs?: number;
    tokens?: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      totalTokenCount: number;
    };
  };
  workflowData?: {
    id: number;
    yaml_content: string;
    step_count: number;
    last_modified: string;
  };
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  /** Raw parts from Vertex response - includes thoughtSignature for Gemini 3 */
  rawParts?: any[];
}

export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "server_tool_start"; name: string; args: Record<string, any> }
  | { type: "server_tool_complete"; name: string; result: any; elapsedMs: number; error?: string }
  | {
      type: "client_tools";
      toolCalls: Array<{ id?: string; name: string; args: Record<string, any> }>;
      rawParts?: any[];
    }
  | { type: "tool_calls"; toolCalls: Array<{ name: string; args: Record<string, any> }>; rawParts?: any[] } // From Rust backend with raw parts for Gemini 3 thought_signature
  | {
      type: "done";
      finishReason: string;
      sessionId?: string;
      model?: string;
      workflowData?: any;
      metrics?: any;
      usage?: any;
    }
  | { type: "error"; error: string; details?: string };

// =============================================================================
// Rust Backend Types (matching vertex_ai.rs)
// =============================================================================

interface RustVertexRequest {
  model: string;
  input?: string;
  history: VertexMessage[];
  system?: string;
  tools: VertexTool[];
  toolResults?: Array<{ id: string; name: string; result: any }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
  thinkingLevel?: string;
  mode?: "ask" | "act" | "x" | "recorder" | "homepage"; // Ask: read-only, Act: full tools, X: execute-only, Recorder: file-editing only, Homepage: app helper
  /** Inline images (pasted screenshots) to send with the user message */
  inlineImages?: Array<{ data: string; mimeType: string }>;
}

interface RustVertexResponse {
  text: string;
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  finishReason: string;
  usage?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

// =============================================================================
// Auth Helper
// =============================================================================

/**
 * Get stored authentication token from Tauri backend
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const token = await invoke<string | null>("get_stored_auth_token");
    if (!token) {
      console.warn("[VERTEX] No auth token available");
      return null;
    }
    return token;
  } catch (error) {
    console.error("[VERTEX] Failed to get auth token:", error);
    return null;
  }
}

// =============================================================================
// Rust Backend Functions (NEW - Direct Vertex AI calls)
// =============================================================================

/**
 * Get Vertex AI OAuth access token (cached in Rust backend)
 */
export async function getVertexAccessToken(): Promise<{
  accessToken: string;
  project: string;
  location: string;
}> {
  console.log("[VERTEX-RUST] Getting Vertex AI access token");
  const result = await invoke<{ accessToken: string; project: string; location: string }>("get_vertex_access_token");
  console.log("[VERTEX-RUST] Got access token for project:", result.project);
  return result;
}

/**
 * Call Vertex AI directly via Rust backend (non-streaming)
 */
export async function callVertexAIRust(request: VertexRequest): Promise<VertexResponse> {
  console.log("[VERTEX-RUST] Calling Vertex AI:", {
    model: request.model || "gemini-2.5-flash",
    inputLength: request.input?.length || 0,
    historyLength: request.history?.length || 0,
    toolsCount: request.tools?.length || 0,
  });

  const startTime = Date.now();

  // Convert request to Rust format (snake_case for some fields)
  const rustRequest: RustVertexRequest = {
    model: request.model || "gemini-2.5-flash",
    input: request.input,
    history: request.history || [],
    system: request.system,
    tools: request.tools || [],
    toolResults: request.toolResults,
    generationConfig: request.generationConfig,
    thinkingLevel: request.thinkingLevel,
    mode: request.mode,
    inlineImages: request.inlineImages,
  };

  const result = await invoke<RustVertexResponse>("call_vertex_ai", { request: rustRequest });

  const elapsedMs = Date.now() - startTime;
  console.log("[VERTEX-RUST] Response received:", {
    textLength: result.text?.length || 0,
    toolCallsCount: result.toolCalls?.length || 0,
    finishReason: result.finishReason,
    elapsedMs,
  });

  return {
    text: result.text,
    toolCalls: result.toolCalls.map(tc => ({ name: tc.name, args: tc.args })),
    finishReason: result.finishReason as "stop" | "tool_calls",
    usage: result.usage,
    metrics: {
      elapsedMs,
      tokens: result.usage
        ? {
            promptTokenCount: result.usage.promptTokenCount || 0,
            candidatesTokenCount: result.usage.candidatesTokenCount || 0,
            totalTokenCount: result.usage.totalTokenCount || 0,
          }
        : undefined,
    },
  };
}

/**
 * Call Vertex AI via Rust backend with event-based streaming
 * Returns an async generator that yields stream events
 */
export async function* callVertexAIStreamRust(
  request: VertexRequest,
  signal?: AbortSignal
): AsyncGenerator<StreamEvent, void, unknown> {
  console.log("[VERTEX-RUST] Calling Vertex AI (streaming):", {
    model: request.model || "gemini-2.5-flash",
    inputLength: request.input?.length || 0,
    toolsCount: request.tools?.length || 0,
  });

  // Create unique event channel for this request
  const eventChannel = `vertex-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Queue to collect events
  const eventQueue: StreamEvent[] = [];
  let resolveNext: ((value: StreamEvent | null) => void) | null = null;
  let isDone = false;
  let unlisten: UnlistenFn | null = null;

  // Set up event listener
  try {
    unlisten = await listen<StreamEvent>(eventChannel, event => {
      const streamEvent = event.payload;

      if (streamEvent.type === "done" || streamEvent.type === "error") {
        isDone = true;
      }

      if (resolveNext) {
        resolveNext(streamEvent);
        resolveNext = null;
      } else {
        eventQueue.push(streamEvent);
      }
    });

    // Convert request to Rust format
    const rustRequest: RustVertexRequest = {
      model: request.model || "gemini-2.5-flash",
      input: request.input,
      history: request.history || [],
      system: request.system,
      tools: request.tools || [],
      toolResults: request.toolResults,
      generationConfig: request.generationConfig,
      thinkingLevel: request.thinkingLevel,
      mode: request.mode,
      inlineImages: request.inlineImages,
    };

    // Start the streaming call (don't await - it completes when done)
    const streamPromise = invoke("call_vertex_ai_stream", {
      request: rustRequest,
      eventChannel,
    }).catch(error => {
      // Push error event if invoke fails
      const errorEvent: StreamEvent = { type: "error", error: String(error) };
      if (resolveNext) {
        resolveNext(errorEvent);
        resolveNext = null;
      } else {
        eventQueue.push(errorEvent);
      }
      isDone = true;
    });

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        isDone = true;
        if (resolveNext) {
          resolveNext(null);
          resolveNext = null;
        }
      });
    }

    // Yield events as they arrive
    while (!isDone || eventQueue.length > 0) {
      if (signal?.aborted) {
        yield { type: "error", error: "Request aborted" };
        break;
      }

      if (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        console.log("[VERTEX-RUST] Stream event:", event.type);
        yield event;

        if (event.type === "done" || event.type === "error") {
          break;
        }
      } else if (!isDone) {
        // Wait for next event
        const event = await new Promise<StreamEvent | null>(resolve => {
          resolveNext = resolve;
          // Timeout after 180 seconds (tool calls can take a while)
          setTimeout(() => {
            if (resolveNext === resolve) {
              resolveNext = null;
              resolve(null);
            }
          }, 180000);
        });

        if (event === null) {
          if (!isDone) {
            yield { type: "error", error: "Stream timeout" };
          }
          break;
        }

        console.log("[VERTEX-RUST] Stream event:", event.type);
        yield event;

        if (event.type === "done" || event.type === "error") {
          break;
        }
      }
    }

    // Wait for the invoke to complete
    await streamPromise;
  } finally {
    // Clean up listener
    if (unlisten) {
      unlisten();
    }
  }
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Clean JSON schema for tool parameters
 * Removes fields not supported by Vertex AI/Gemini ($ref, $schema, definitions, anyOf, const, etc.)
 * Only keeps: type, properties, required, description, enum, format, items
 */
function cleanSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }

  const src = schema as Record<string, unknown>;
  const dst: Record<string, unknown> = {
    type: typeof src.type === "string" ? (src.type as string).toLowerCase() : "object",
  };

  if (src.properties && typeof src.properties === "object") {
    const cleanedProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      cleanedProps[k] = cleanSchema(v);
    }
    dst.properties = cleanedProps;
  }

  if (Array.isArray(src.required)) dst.required = src.required;
  if (typeof src.description === "string") dst.description = src.description;
  if (Array.isArray(src.enum)) dst.enum = src.enum;
  if (typeof src.format === "string") dst.format = src.format;
  if (src.type === "array" && src.items) dst.items = cleanSchema(src.items);

  return dst;
}

/**
 * Convert AI SDK format tools to Vertex format
 */
export function convertAiSdkToolsToVertexFormat(aiSdkTools: Record<string, any>): VertexTool[] {
  return Object.entries(aiSdkTools).map(([name, tool]) => ({
    name,
    description: tool.description || `Execute ${name}`,
    // MCP tools use inputSchema, AI SDK tools use parameters
    // Clean schema to remove unsupported fields ($ref, $schema, definitions, anyOf, const)
    parameters: cleanSchema(tool.inputSchema || tool.parameters || {}),
  }));
}
