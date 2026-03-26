/**
 * Claude Code Service - Integration with Claude Code via ACP
 *
 * Uses the Zed IDE approach: spawns @zed-industries/claude-code-acp as subprocess
 * and communicates via ACP (Agent Client Protocol) over stdio.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// =============================================================================
// Types
// =============================================================================

/**
 * File location affected by a tool call
 */
export interface ToolLocation {
  path: string;
  line?: number;
}

/**
 * Events emitted by Claude Code backend
 * Must match ClaudeCodeEvent in claude_code.rs
 */
export type ClaudeCodeEvent =
  | { type: "textChunk"; text: string; sessionId: string }
  | {
      type: "toolCallStart";
      toolCallId: string;
      toolName: string;
      kind: string; // read, edit, delete, move, search, execute, think, fetch, switch_mode, other
      status: string; // pending, in_progress, completed, failed
      toolInput: Record<string, any>;
      locations: ToolLocation[];
      sessionId: string;
    }
  | {
      type: "toolCallUpdate";
      toolCallId: string;
      status?: string;
      title?: string;
      content?: any; // May include diffs
      rawOutput?: any;
      sessionId: string;
    }
  | { type: "statusUpdate"; phase: string; message: string }
  | { type: "sessionEnd"; sessionId: string; reason: string }
  | { type: "error"; message: string; sessionId: string }
  | { type: "authRequired"; message: string }
  | { type: "creditExhausted"; cumulativeCostUsd: number; limitUsd: number }
  | { type: "usageUpdate"; cumulativeCostUsd: number; limitUsd: number; bridgeMode: string };

/**
 * Stream events for the chat interface
 */
export type ClaudeCodeStreamEvent =
  | { type: "text"; content: string }
  | {
      type: "tool_start";
      toolCallId: string;
      name: string;
      kind: string;
      status: string;
      args: Record<string, any>;
      locations: ToolLocation[];
    }
  | {
      type: "tool_update";
      toolCallId: string;
      status?: string;
      title?: string;
      content?: any;
      rawOutput?: any;
    }
  | { type: "done"; reason: string }
  | { type: "error"; error: string };

/**
 * Session state for tracking active Claude Code sessions
 */
export interface ClaudeCodeSession {
  sessionId: string;
  cwd: string;
  mcpPort: number;
  isActive: boolean;
}

// =============================================================================
// Session Management
// =============================================================================

let currentSession: ClaudeCodeSession | null = null;
const eventUnlisten: UnlistenFn | null = null;

/**
 * Status update callback type
 */
export type StatusUpdateCallback = (phase: string, message: string) => void;

/**
 * Listen for Claude Code status updates (initializing, starting session, etc.)
 * @param callback Function to call when status updates
 * @returns Promise that resolves to an unlisten function
 */
export async function listenForStatusUpdates(callback: StatusUpdateCallback): Promise<UnlistenFn> {
  return listen<ClaudeCodeEvent>("claude-code-event", event => {
    if (event.payload.type === "statusUpdate") {
      console.log("[CLAUDE-CODE] Status update:", event.payload.phase, event.payload.message);
      callback(event.payload.phase, event.payload.message);
    }
  });
}

/**
 * Start a new Claude Code session
 * @param cwd Working directory for the session
 * @param mcpPort Port where Terminator MCP server is running
 * @returns Session ID
 */
export async function startClaudeCodeSession(cwd: string, mcpPort: number): Promise<string> {
  console.log("[CLAUDE-CODE] Starting session with cwd:", cwd, "mcpPort:", mcpPort);

  // End any existing session first
  if (currentSession) {
    console.log("[CLAUDE-CODE] Ending previous session:", currentSession.sessionId);
    await endClaudeCodeSession();
  }

  try {
    const sessionId = await invoke<string>("start_claude_code_session", {
      cwd,
      mcpPort,
    });

    currentSession = {
      sessionId,
      cwd,
      mcpPort,
      isActive: true,
    };

    console.log("[CLAUDE-CODE] Session started:", sessionId);
    return sessionId;
  } catch (error) {
    console.error("[CLAUDE-CODE] Failed to start session:", error);
    throw error;
  }
}

/**
 * Send a prompt to Claude Code and stream responses
 * @param message User message to send
 * @param signal AbortSignal for cancellation
 * @yields Stream events (text, tool calls, etc.)
 */
export async function* sendClaudeCodePrompt(
  message: string,
  signal?: AbortSignal
): AsyncGenerator<ClaudeCodeStreamEvent, void, unknown> {
  if (!currentSession) {
    throw new Error("No active Claude Code session. Call startClaudeCodeSession first.");
  }

  const { sessionId } = currentSession;
  console.log("[CLAUDE-CODE] Sending prompt to session:", sessionId, "message length:", message.length);

  // Queue to collect events
  const eventQueue: ClaudeCodeStreamEvent[] = [];
  let resolveNext: ((value: ClaudeCodeStreamEvent | null) => void) | null = null;
  let isDone = false;
  // Track active ask_user tools to skip timeout during user interaction
  const activeAskUserTools = new Set<string>();

  // Set up event listener for this prompt
  const unlisten = await listen<ClaudeCodeEvent>("claude-code-event", event => {
    const payload = event.payload;

    // Only process events for our session
    if ("sessionId" in payload && payload.sessionId !== sessionId) {
      return;
    }

    let streamEvent: ClaudeCodeStreamEvent | null = null;

    switch (payload.type) {
      case "textChunk":
        streamEvent = { type: "text", content: payload.text };
        break;
      case "toolCallStart": {
        console.log("[CLAUDE-CODE] Tool start:", payload.toolCallId, payload.toolName, payload.kind);
        // Track ask_user tools - disable timeout while waiting for user input
        if (payload.toolName === "ask_user") {
          activeAskUserTools.add(payload.toolCallId);
          console.log("[CLAUDE-CODE] ask_user started, timeout disabled for:", payload.toolCallId);
        }
        streamEvent = {
          type: "tool_start",
          toolCallId: payload.toolCallId,
          name: payload.toolName,
          kind: payload.kind,
          status: payload.status,
          args: payload.toolInput,
          locations: payload.locations,
        };
        break;
      }
      case "toolCallUpdate": {
        console.log("[CLAUDE-CODE] Tool update:", payload.toolCallId, payload.status, payload.title);
        // Clear ask_user tracking when tool completes
        if (
          activeAskUserTools.has(payload.toolCallId) &&
          (payload.status === "completed" || payload.status === "failed")
        ) {
          activeAskUserTools.delete(payload.toolCallId);
          console.log("[CLAUDE-CODE] ask_user completed, timeout re-enabled");
        }
        streamEvent = {
          type: "tool_update",
          toolCallId: payload.toolCallId,
          status: payload.status,
          title: payload.title,
          content: payload.content,
          rawOutput: payload.rawOutput,
        };
        break;
      }
      case "sessionEnd":
        streamEvent = { type: "done", reason: payload.reason };
        isDone = true;
        break;
      case "error":
        streamEvent = { type: "error", error: payload.message };
        isDone = true;
        break;
      case "authRequired":
        streamEvent = { type: "error", error: `Authentication required: ${payload.message}` };
        isDone = true;
        break;
    }

    if (streamEvent) {
      if (resolveNext) {
        resolveNext(streamEvent);
        resolveNext = null;
      } else {
        eventQueue.push(streamEvent);
      }
    }
  });

  try {
    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", async () => {
        console.log("[CLAUDE-CODE] Prompt aborted");
        isDone = true;
        if (resolveNext) {
          resolveNext({ type: "error", error: "Request cancelled" });
          resolveNext = null;
        }
        // Cancel the session
        try {
          await invoke("cancel_claude_code", { sessionId });
        } catch (e) {
          console.warn("[CLAUDE-CODE] Failed to cancel:", e);
        }
      });
    }

    // Start the prompt (don't await - it completes when response is done)
    const promptPromise = invoke("send_claude_code_prompt", {
      sessionId,
      message,
    }).catch(error => {
      const errorEvent: ClaudeCodeStreamEvent = { type: "error", error: String(error) };
      if (resolveNext) {
        resolveNext(errorEvent);
        resolveNext = null;
      } else {
        eventQueue.push(errorEvent);
      }
      isDone = true;
    });

    // Yield events as they arrive
    while (!isDone || eventQueue.length > 0) {
      if (signal?.aborted) {
        yield { type: "error", error: "Request cancelled" };
        break;
      }

      if (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        // Only log non-text events to reduce noise (text events fire on every token)
        if (event.type !== "text") {
          console.log("[CLAUDE-CODE] Stream event:", event.type);
        }
        yield event;

        if (event.type === "done" || event.type === "error") {
          break;
        }
      } else if (!isDone) {
        // Wait for next event with timeout (skip timeout during ask_user)
        const event = await new Promise<ClaudeCodeStreamEvent | null>(resolve => {
          resolveNext = resolve;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          // Function to set/reset timeout - only times out when no ask_user is active
          const scheduleTimeout = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
              if (resolveNext !== resolve) return; // Already resolved

              // Skip timeout if ask_user is waiting for user input - check again in 30s
              if (activeAskUserTools.size > 0) {
                console.log("[CLAUDE-CODE] ask_user active, extending timeout...");
                scheduleTimeout(); // Reschedule
                return;
              }

              resolveNext = null;
              resolve(null);
            }, 120000); // 120 seconds
          };

          scheduleTimeout();
        });

        if (event === null) {
          if (!isDone) {
            yield { type: "error", error: "Stream timeout" };
          }
          break;
        }

        // Only log non-text events to reduce noise (text events fire on every token)
        if (event.type !== "text") {
          console.log("[CLAUDE-CODE] Stream event:", event.type);
        }
        yield event;

        if (event.type === "done" || event.type === "error") {
          break;
        }
      }
    }

    // Wait for the invoke to complete
    await promptPromise;

    // If we finished without a done event, emit one
    if (!isDone) {
      yield { type: "done", reason: "complete" };
    }
  } finally {
    unlisten();
  }
}

/**
 * Cancel the current Claude Code operation
 */
export async function cancelClaudeCode(): Promise<void> {
  if (!currentSession) {
    console.warn("[CLAUDE-CODE] No active session to cancel");
    return;
  }

  console.log("[CLAUDE-CODE] Cancelling session:", currentSession.sessionId);
  try {
    await invoke("cancel_claude_code", {
      sessionId: currentSession.sessionId,
    });
  } catch (error) {
    console.error("[CLAUDE-CODE] Failed to cancel:", error);
    throw error;
  }
}

/**
 * End the current Claude Code session
 * Uses a timeout to prevent blocking the UI if the backend is stuck
 */
export async function endClaudeCodeSession(): Promise<void> {
  if (!currentSession) {
    console.warn("[CLAUDE-CODE] No active session to end");
    return;
  }

  const sessionId = currentSession.sessionId;
  console.log("[CLAUDE-CODE] Ending session:", sessionId);

  // Clear session immediately so UI can proceed
  // The backend call may hang if a previous command is stuck
  currentSession = null;

  try {
    // Use a timeout to prevent hanging forever if backend is stuck
    const timeoutMs = 3000;
    const invokePromise = invoke("end_claude_code_session", { sessionId });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout ending session")), timeoutMs)
    );

    await Promise.race([invokePromise, timeoutPromise]);
    console.log("[CLAUDE-CODE] Session ended successfully:", sessionId);
  } catch (error) {
    // Log but don't throw - session is already cleared locally
    console.warn("[CLAUDE-CODE] Failed to end session (continuing anyway):", error);
  }
}

/**
 * Get current session info
 */
export function getCurrentSession(): ClaudeCodeSession | null {
  return currentSession;
}

/**
 * Check if there's an active Claude Code session
 */
export function hasActiveSession(): boolean {
  return currentSession !== null && currentSession.isActive;
}

/**
 * Clear the current session reference without calling backend.
 * Used after ForceRewarm which already killed the ACP process and cleared sessions on Rust side.
 * Next prompt will auto-create a new session.
 */
export function clearCurrentSession(): void {
  console.log("[CLAUDE-CODE] clearCurrentSession: clearing stale session ref after ForceRewarm");
  currentSession = null;
}

// =============================================================================
// Global Event Listener (for session-level events like auth required)
// =============================================================================

/**
 * Set up a global listener for Claude Code events
 * Use this for session-level notifications (auth required, etc.)
 * @param callback Function to handle events
 * @returns Cleanup function
 */
export async function onClaudeCodeEvent(callback: (event: ClaudeCodeEvent) => void): Promise<() => void> {
  const unlisten = await listen<ClaudeCodeEvent>("claude-code-event", event => {
    callback(event.payload);
  });
  return unlisten;
}
