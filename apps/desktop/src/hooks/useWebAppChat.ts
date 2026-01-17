/**
 * Chat hook that calls web app's /api/ai endpoint (native Vertex AI on server)
 * Replaces direct Vertex AI calls with HTTP calls to web app backend
 */

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useState, useEffect, useRef } from "react";
// Knowledge tools now handled server-side via AI route (search_similar_workflow_steps)
// File tools (read_file, write_file, etc.) now handled by terminator MCP agent
import { useMcp } from "../contexts/McpContext";
import { trackChatMessageSent } from "../lib/analytics";
import {
  ASK_MODE_ALLOWED_TOOLS,
  ASK_MODE_BLOCKED_TOOLS,
  RECORDER_MODE_ALLOWED_TOOLS,
  RECORDER_MODE_BLOCKED_TOOLS,
  X_MODE_BLOCKED_TOOLS,
  filterToolsForXMode,
} from "../lib/ask-mode-tools";
import { mcpClient } from "../lib/mcp-client";
import {
  getGlobalMessages,
  setGlobalMessages,
  clearGlobalSession,
  getGlobalMode,
  setGlobalMode,
  listAllLocalSessions,
  saveSessionMetadata,
  getSessionMessages,
  saveSessionMessages,
  deleteLocalSession,
  type LocalSessionMetadata,
} from "../lib/session-storage";
import { shouldCaptureToolToWorkflow } from "../lib/workflow-auto-capture";
import {
  buildWorkflowSystemPromptWithBreakdown,
  buildClaudeCodeSystemPrompt,
  type StepLocationInfo,
  type PromptPart,
} from "../lib/workflow-context";
import { buildAppAssistantPrompt, buildSimpleAppAssistantPrompt } from "../lib/prompts";
import { getAvailableComponentsList, validateJSX } from "../lib/runtime-jsx";
import { generateStepName } from "../lib/workflow-io";
import {
  // NOTE: getWorkflowSuggestions, getCachedSuggestions removed - YAML-based generation deprecated
  getFallbackSuggestions,
  type SuggestedAction,
} from "../lib/workflow-suggestions";
import {
  listChatSessions,
  saveChatSession,
  loadChatSession,
  generateSessionTitle,
  type ChatSessionListItem,
  type ChatSession,
} from "../services/chat-sessions-api";
import {
  startClaudeCodeSession,
  sendClaudeCodePrompt,
  cancelClaudeCode,
  endClaudeCodeSession,
  hasActiveSession as hasActiveClaudeCodeSession,
  listenForStatusUpdates,
} from "../services/claude-code-service";
import { normalizeClickElementArguments } from "../services/mcp-ingestion";
import {
  callVertexAIStreamRust,
  convertAiSdkToolsToVertexFormat,
  getAuthToken,
  type VertexMessage,
  type VertexToolCall,
  type VertexRequest,
} from "../services/vertex-http-client";

const SESSION_STORAGE_KEY = "mediar_ai_global_session"; // Single global session

// Max characters for truncated tool args/results in history
const MAX_ARG_LENGTH = 500;

// Track if cloud sync has been initiated this session (prevent duplicate syncs)
let cloudSyncInitiated = false;

/**
 * Sync sessions from cloud to local IndexedDB (runs once on app startup)
 * Fetches sessions that exist in cloud but not locally
 */
async function syncSessionsFromCloud(): Promise<void> {
  if (cloudSyncInitiated) {
    console.log("[CLOUD-SYNC] Already initiated, skipping");
    return;
  }
  cloudSyncInitiated = true;

  try {
    console.log("[CLOUD-SYNC] Starting cloud-to-local sync...");

    // Get cloud session list (metadata only)
    const cloudSessions = await listChatSessions(); // no workflowId = all sessions
    if (!cloudSessions || cloudSessions.length === 0) {
      console.log("[CLOUD-SYNC] No cloud sessions found");
      return;
    }
    console.log(`[CLOUD-SYNC] Found ${cloudSessions.length} cloud sessions`);

    // Get local sessions
    const localSessions = await listAllLocalSessions();
    const localIds = new Set(localSessions.map(s => s.sessionId));
    console.log(`[CLOUD-SYNC] Found ${localSessions.length} local sessions`);

    // Find missing sessions (in cloud but not local)
    const missing = cloudSessions.filter(s => !localIds.has(s.redis_session_id));
    if (missing.length === 0) {
      console.log("[CLOUD-SYNC] All cloud sessions already synced locally");
      return;
    }
    console.log(`[CLOUD-SYNC] Syncing ${missing.length} missing sessions...`);

    // Fetch full session + messages for each missing (in parallel, max 5 at a time)
    const batchSize = 5;
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async session => {
          try {
            const full = await loadChatSession(session.id); // numeric cloud id
            if (full?.messages && full.messages.length > 0) {
              saveSessionMessages(full.redis_session_id, full.messages);
              saveSessionMetadata({
                sessionId: full.redis_session_id,
                title: full.title,
                messageCount: full.message_count,
                workflowId: null,
                createdAt: full.created_at,
                updatedAt: full.updated_at,
              });
              console.log(`[CLOUD-SYNC] Synced session: ${full.redis_session_id}`);
            }
          } catch (err) {
            console.error(`[CLOUD-SYNC] Failed to sync session ${session.id}:`, err);
          }
        })
      );
    }

    console.log(`[CLOUD-SYNC] Completed syncing ${missing.length} sessions`);
  } catch (error) {
    console.error("[CLOUD-SYNC] Sync failed:", error);
  }
}
const MAX_RESULT_LENGTH = 1000;

/**
 * Truncate tool arguments for history to save context window
 * Preserves essential info like tool name, selector, key params
 */
function truncateToolArgs(args: any): any {
  if (!args || typeof args !== "object") return args;

  const truncated: any = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > MAX_ARG_LENGTH) {
      // Keep beginning and end for context
      truncated[key] = value.slice(0, MAX_ARG_LENGTH / 2) + "...[truncated]..." + value.slice(-100);
    } else if (typeof value === "object" && value !== null) {
      // For nested objects, stringify and truncate
      const str = JSON.stringify(value);
      if (str.length > MAX_ARG_LENGTH) {
        truncated[key] = "[large object truncated]";
      } else {
        truncated[key] = value;
      }
    } else {
      truncated[key] = value;
    }
  }
  return truncated;
}

/**
 * Truncate tool results for history to save context window
 * Preserves success/error status and key info
 */
function truncateToolResult(result: any): any {
  if (!result || typeof result !== "object") return result;

  // Always preserve these key fields
  const preserved: any = {};
  if ("success" in result) preserved.success = result.success;
  if ("error" in result)
    preserved.error =
      typeof result.error === "string" && result.error.length > 200 ? result.error.slice(0, 200) + "..." : result.error;
  if ("isError" in result) preserved.isError = result.isError;

  // Remove large fields that aren't useful for context
  const skipFields = ["_images", "ui_tree", "window_tree", "screenshot", "base64", "content"];

  for (const [key, value] of Object.entries(result)) {
    if (key in preserved) continue;
    if (skipFields.includes(key)) {
      preserved[key] = `[${key} removed for context]`;
      continue;
    }

    if (typeof value === "string" && value.length > MAX_RESULT_LENGTH) {
      preserved[key] = value.slice(0, MAX_RESULT_LENGTH / 2) + "...[truncated]..." + value.slice(-200);
    } else if (typeof value === "object" && value !== null) {
      const str = JSON.stringify(value);
      if (str.length > MAX_RESULT_LENGTH) {
        preserved[key] = "[large object truncated]";
      } else {
        preserved[key] = value;
      }
    } else {
      preserved[key] = value;
    }
  }

  return preserved;
}

/**
 * Build a text summary of conversation history for Claude Code
 * Used when restoring a session to give Claude Code context of previous messages
 */
function buildClaudeCodeHistoryContext(messages: any[]): string {
  if (!messages || messages.length === 0) return "";

  const historyParts: string[] = [];

  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "user") {
      // User message
      const content = m.content?.trim();
      if (content) {
        historyParts.push(`User: ${content}`);
      }
    } else if (m.role === "assistant") {
      // Assistant message - include text and tool summaries
      const parts: string[] = [];

      if (m.content && m.content !== "Waiting for AI response...") {
        parts.push(m.content);
      }

      // Summarize tool calls (don't include full args/results - too verbose)
      const toolInvocations = m.toolInvocations || [];
      if (toolInvocations.length > 0) {
        const toolSummaries = toolInvocations
          .filter((inv: any) => inv.state === "result" || inv.state === "error")
          .map((inv: any) => {
            const status = inv.state === "error" ? "failed" : "succeeded";
            return `[Tool: ${inv.toolName} - ${status}]`;
          });
        if (toolSummaries.length > 0) {
          parts.push(toolSummaries.join(" "));
        }
      }

      if (parts.length > 0) {
        historyParts.push(`Assistant: ${parts.join("\n")}`);
      }
    }
  }

  if (historyParts.length === 0) return "";

  return historyParts.join("\n\n");
}

export function useWebAppChat(options?: {
  onError?: (error: Error) => void;
  focusedWorkflowName?: string; // Keep as string for display name
  /** Main terminator.ts content for TypeScript workflows */
  terminatorTsContent?: string;
  /** Step-to-file mapping for quick lookup */
  stepMapping?: StepLocationInfo[];
  /** List of files in the workflow folder (relative paths) */
  workflowFiles?: string[];
  workflowId?: string | null; // Folder name - used for local file operations
  cloudId?: string | null; // Cloud UUID (github_folder) - used for cloud sync operations
  localPath?: string; // Full path to workflow folder (for TypeScript workflows)
  // NOTE: workflowData type simplified - yaml_content removed, YAML workflows deprecated
  onWorkflowChanged?: () => void;
  onStreamComplete?: () => void; // Called when AI finishes responding
  onOpenFile?: (relativePath: string) => void; // Open a file in the app's file viewer
  // Autoclone support for read-only public workflows
  currentWorkflow?: {
    id?: string | null;
    name?: string;
    isPublic?: boolean;
    createdBy?: string;
    organizationId?: string;
  } | null;
  canEditWorkflow?: (workflow: any) => boolean;
  requestAutocloneConfirmation?: (workflowId: number | string, workflowName: string) => Promise<boolean>;
  // Mark a file as pending AI edit - file watcher will trigger diff when change detected
  markPendingAIEdit?: (filePath: string) => void;
  // Experimental: Allow AI to render interactive components in chat
  generativeUIEnabled?: boolean;
}) {
  const mcpState = useMcp();
  // Initialize messages from localStorage (single global session)
  const [messages, setMessages] = useState<any[]>(() => {
    try {
      const stored = getGlobalMessages();
      if (stored && stored.length > 0) {
        console.log(`[WEB-APP-CHAT] Restored ${stored.length} messages from global session`);
      }
      return stored;
    } catch (error) {
      console.error("[WEB-APP-CHAT] Failed to load messages from localStorage:", error);
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<{
    phase: "connecting" | "waiting" | "streaming" | "processing_tools" | "rate_limited";
    detail: string;
    startTime: number;
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Separate state for suggestions overlay (not part of messages)
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([]);
  const [suggestionsWorkflowName, setSuggestionsWorkflowName] = useState<string>("");
  const [isGeneratingSuggestions, setIsGeneratingSuggestions] = useState(false);
  const [selectedModel, setSelectedModel] = useState<
    "gemini-2.5-pro" | "gemini-2.5-flash" | "gemini-3-pro-preview" | "claude-code"
  >("claude-code");
  const [thinkingLevel, setThinkingLevelState] = useState<"low" | "high">(() => {
    try {
      const saved = localStorage.getItem("ai_thinking_level");
      return saved === "high" || saved === "low" ? saved : "low";
    } catch {
      return "low";
    }
  });

  // Wrapper to persist thinkingLevel to localStorage
  const setThinkingLevel = (level: "low" | "high") => {
    setThinkingLevelState(level);
    try {
      localStorage.setItem("ai_thinking_level", level);
    } catch {
      // Ignore localStorage errors
    }
  };

  // Ask/Act/X/Recorder/Homepage mode:
  // 'ask' = read-only, 'act' = full tool execution, 'x' = execute-only (no UI automation),
  // 'recorder' = file-editing only, 'homepage' = app homepage (no workflow context)
  // Initialize from localStorage if workflow has saved mode, or use 'homepage' when no workflow
  const [mode, setModeState] = useState<"ask" | "act" | "x" | "recorder" | "homepage">(() => {
    // If no workflow, always use homepage mode (ignore saved mode)
    // ask/act/x/recorder modes only make sense in workflow context
    if (!options?.workflowId) {
      return "homepage";
    }
    // In workflow context, use saved mode preference or default to "act"
    try {
      const savedMode = getGlobalMode();
      return savedMode && savedMode !== "homepage" ? savedMode : "act";
    } catch {
      return "act";
    }
  });

  // Wrapper to persist mode to localStorage (global session)
  const setMode = (newMode: "ask" | "act" | "x" | "recorder" | "homepage") => {
    setModeState(newMode);
    setGlobalMode(newMode);
  };

  // Ask mode tools lists (from local constants)
  const askModeAllowedTools = ASK_MODE_ALLOWED_TOOLS;
  const askModeBlockedTools = ASK_MODE_BLOCKED_TOOLS;

  // Track previous mode to detect mode switches during conversation
  const previousModeRef = useRef<"ask" | "act" | "x" | "recorder" | "homepage" | null>(null);

  // Track if Claude Code system prompt was sent this session (ACP is stateful - only need Turn 1)
  const claudeCodeSystemPromptSentRef = useRef<boolean>(false);

  // Context usage metrics from last AI response
  const [contextMetrics, setContextMetrics] = useState<{
    promptTokens: number;
    responseTokens: number;
    totalTokens: number;
  } | null>(null);

  // Get context limit based on model
  const getContextLimit = (model: string): number => {
    if (model.startsWith("gemini")) return 1000000; // Gemini 2.5/3 have 1M context
    if (model.startsWith("claude")) return 200000; // Claude has 200k
    return 200000; // Default fallback
  };

  // Check if Claude Code model is selected (uses ACP protocol via subprocess)
  const shouldUseClaudeCode = (model: string): boolean => {
    return model === "claude-code";
  };

  // State for workflow failure context using log data
  const [failureContext, setFailureContext] = useState<{
    workflowLog: any; // The complete log entry from workflowExecutionLogs (might be null)
    workflowName: string;
    workflowId?: string | null;
    executionType?: "single_step" | "full";
    stepIndex?: number;
    actualFailedStepName?: string; // The actual step name from failedSteps array
    fullExecutionResponse?: any; // The complete MCP execution response
    stepCode?: string | null; // The actual TypeScript step code
    failedStepId?: string; // The failed step ID
  } | null>(null);

  // State for recorder session context (for implementing recorded steps)
  const [recorderContext, setRecorderContext] = useState<{
    workflowFolder: string;
    analysisMarkdown: string;
    synthesisResult: {
      workflows: Array<{
        title: string;
        description: string;
        steps: Array<{
          step_name: string;
          substeps: Array<{
            substep_name: string;
            inputs: string[];
            outputs: string[];
            business_logic: string[];
          }>;
        }>;
      }>;
    };
    stepAnalyses: Array<{
      step_title: string;
      step_summary: string;
      events_that_happened: string;
      how_content_changed: string;
      results_if_any: string;
      what_was_clicked: string;
      what_was_typed: string;
      user_intent: string;
      label?: string;
      timestamp: string;
      window_title?: string;
    }>;
    rawEvents: Array<Record<string, unknown>>;
  } | null>(null);

  // Initialize sessionId from localStorage (single global session)
  const [pendingImages, setPendingImages] = useState<Array<{ data: string; mimeType: string }>>([]);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        console.log(`[WEB-APP-CHAT] Loaded global session: ${stored}`);
      }
      return stored;
    } catch (error) {
      console.error("[WEB-APP-CHAT] Failed to load session from localStorage:", error);
      return null;
    }
  });

  // Track previous workflowId to detect when workflow changes
  const prevWorkflowIdRef = useRef<string | null | undefined>(options?.workflowId);

  // Cancellation refs for stop functionality
  const abortControllerRef = useRef<AbortController | null>(null);
  const shouldStopRef = useRef(false);
  const isRetryingRef = useRef(false);
  // Track if tools were executed in current conversation (prevents destructive retry on 429)
  const toolsExecutedRef = useRef(false);

  // Ref to track loading state synchronously (avoids stale closure/race condition issues with React state)
  const isLoadingRef = useRef(false);

  // Track recorder workflow folder for opening README.md after completion
  const recorderWorkflowFolderRef = useRef<string | null>(null);

  // Track whether Claude Code needs history sync (set true when loading historical conversation or new ACP session)
  // This ensures we send conversation context to Claude when it doesn't know about previous messages
  const needsClaudeHistorySyncRef = useRef(false);
  // Save sessionId to localStorage (single global session)
  useEffect(() => {
    if (sessionId) {
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
        console.log(`[WEB-APP-CHAT] Saved global session: ${sessionId}`);
      } catch (error) {
        console.error("[WEB-APP-CHAT] Failed to save session to localStorage:", error);
      }
    }
    // NOTE: We don't clear on sessionId=null here because that happens during workflow switches
    // Only explicit reload() should clear the session
  }, [sessionId, options?.workflowId]);

  // Sync sessions from cloud to local on mount (non-blocking, runs once per app session)
  useEffect(() => {
    // Fire in background, don't block UI
    syncSessionsFromCloud();
  }, []);

  // Save messages to IndexedDB (debounced to avoid spam during streaming)
  // Saves both to global key (for current session) and by sessionId (for history)
  const localStorageSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!sessionId) return; // Need sessionId to save
    if (messages.length === 0) return; // Don't save empty messages

    // Debounce IndexedDB saves (500ms) to avoid spam during streaming
    if (localStorageSaveTimeoutRef.current) {
      clearTimeout(localStorageSaveTimeoutRef.current);
    }

    localStorageSaveTimeoutRef.current = setTimeout(async () => {
      try {
        // Save to global key (current active session)
        setGlobalMessages(messages);

        // Also save to session-specific key for history
        saveSessionMessages(sessionId, messages);

        // Update session metadata for history list
        const title = generateSessionTitle(messages);
        const now = new Date().toISOString();
        const existingMeta = await import("../lib/session-storage").then(m => m.getSessionMetadata(sessionId));

        const metadata: LocalSessionMetadata = {
          sessionId,
          title,
          messageCount: messages.length,
          workflowId: options?.cloudId || options?.workflowId || null,
          createdAt: existingMeta?.createdAt || now,
          updatedAt: now,
        };
        await saveSessionMetadata(metadata);
      } catch (error) {
        console.error("[WEB-APP-CHAT] Failed to save messages to IndexedDB:", error);
      }
    }, 500);

    // Cleanup timeout on unmount
    return () => {
      if (localStorageSaveTimeoutRef.current) {
        clearTimeout(localStorageSaveTimeoutRef.current);
      }
    };
  }, [messages, sessionId, options?.workflowId, options?.cloudId]);

  // Sync messages to backend (debounced) - single global session model
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!sessionId) return; // Need sessionId to sync
    if (messages.length === 0) return;

    // Debounce sync to backend (2 seconds after last message change)
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    syncTimeoutRef.current = setTimeout(async () => {
      const title = generateSessionTitle(messages);
      console.log(`[WEB-APP-CHAT] Syncing session to backend: ${sessionId}, ${messages.length} messages`);
      await saveChatSession(sessionId, messages, title);
    }, 2000);

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [messages, sessionId]);

  // Handle workflow changes (single global session - don't clear messages)
  useEffect(() => {
    // Only react if workflow actually changed
    if (prevWorkflowIdRef.current === options?.workflowId) {
      return;
    }

    const prevWorkflowId = prevWorkflowIdRef.current;
    prevWorkflowIdRef.current = options?.workflowId;

    // With single global session, messages persist across workflow changes
    // Only update mode based on context:
    // - No workflow selected → homepage mode
    // - Workflow selected → act mode (unless user changed it)
    if (!options?.workflowId && prevWorkflowId) {
      // Returning home from a workflow
      console.log(`[WEB-APP-CHAT] Returning home from workflow ${prevWorkflowId}`);
      // Keep mode as-is or switch to homepage if in workflow-specific mode
      const currentMode = getGlobalMode();
      if (
        !currentMode ||
        currentMode === "ask" ||
        currentMode === "act" ||
        currentMode === "x" ||
        currentMode === "recorder"
      ) {
        // Switch to homepage mode when returning home
        console.log("[WEB-APP-CHAT] Switching to homepage mode (returned home)");
        setModeState("homepage");
        setGlobalMode("homepage");
      }
    } else if (options?.workflowId && !prevWorkflowId) {
      // Entering a workflow from home
      console.log(`[WEB-APP-CHAT] Entering workflow ${options.workflowId}`);
      // Sync React state with localStorage mode (or default to "act")
      // BUG FIX: React state was stuck at "homepage" when localStorage had a valid workflow mode
      const currentMode = getGlobalMode();
      if (!currentMode || currentMode === "homepage") {
        console.log("[WEB-APP-CHAT] Switching to act mode (entered workflow)");
        setModeState("act");
        setGlobalMode("act");
      } else {
        // Sync React state to saved mode (ask/act/x/recorder) so toggle shows correctly
        console.log(`[WEB-APP-CHAT] Syncing to saved mode '${currentMode}' (entered workflow)`);
        setModeState(currentMode);
      }
    } else if (options?.workflowId && prevWorkflowId) {
      // Switching between workflows - keep mode as-is
      console.log(`[WEB-APP-CHAT] Switching from workflow ${prevWorkflowId} to ${options.workflowId}`);
    }
  }, [options?.workflowId]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const sendMessage = useCallback(
    async (
      messageText: string,
      overrideMode?: "ask" | "act" | "x" | "recorder" | "homepage",
      sendOptions?: { skipUserMessage?: boolean; autoRetryCount?: number }
    ) => {
      if (!messageText.trim()) return;

      // DEBUG: Log closure state at call time to detect stale closures
      console.log(`[WEB-APP-CHAT] 📨 sendMessage called`, {
        messagesInClosure: messages.length,
        messageIds: messages.map(m => m.id).slice(-3), // Last 3 message IDs
        needsClaudeHistorySync: needsClaudeHistorySyncRef.current,
        messageText: messageText.substring(0, 50) + (messageText.length > 50 ? "..." : ""),
        isCurrentlyLoading: isLoadingRef.current,
      });

      // If already streaming, interrupt first then send new message
      if (isLoadingRef.current) {
        console.log("[WEB-APP-CHAT] 🛑 Interrupting current stream to send new message");

        // Set stop flag and abort controller
        shouldStopRef.current = true;
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        // Cancel Claude Code if active
        if (hasActiveClaudeCodeSession()) {
          console.log("[WEB-APP-CHAT] Stopping MCP and Claude Code...");
          try {
            await mcpClient.stopExecution();
          } catch (e) {
            console.warn("[WEB-APP-CHAT] MCP stopExecution failed:", e);
          }
          try {
            await cancelClaudeCode();
          } catch (e) {
            console.warn("[WEB-APP-CHAT] cancelClaudeCode failed:", e);
          }
        }

        // Mark any running tool invocations as interrupted
        setMessages(prev =>
          prev.map(m => {
            if (m.toolInvocations?.some((inv: any) => inv.state === "running")) {
              return {
                ...m,
                toolInvocations: m.toolInvocations.map((inv: any) =>
                  inv.state === "running" ? { ...inv, state: "error", error: { message: "Interrupted by user" } } : inv
                ),
              };
            }
            return m;
          })
        );

        // Reset loading state
        setIsLoading(false);
        isLoadingRef.current = false;
        setLoadingStatus(null);
        abortControllerRef.current = null;
        shouldStopRef.current = false;

        // Small delay to ensure cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 50));

        console.log("[WEB-APP-CHAT] ✅ Interrupt complete, now sending new message");
      }

      isLoadingRef.current = true;
      console.log("[WEB-APP-CHAT] isLoadingRef set to TRUE - starting AI conversation");

      // Use override mode if provided (e.g., from triggerFailureAnalysis), otherwise use state
      // Using let so ask_user can update mode mid-execution for immediate effect
      let effectiveMode = overrideMode ?? mode;

      // Track chat message sent (works for both bubble and split view)
      trackChatMessageSent("user", !!options?.terminatorTsContent);

      // Capture images to include in user message (before clearing)
      const imagesToInclude = [...pendingImages];

      const userMessage: {
        id: string;
        role: string;
        content: string;
        timestamp: Date;
        images?: { data: string; mimeType: string }[];
        promptBreakdown?: PromptPart[];
        promptTotalTokens?: number;
      } = {
        id: Date.now().toString(),
        role: "user",
        content: messageText,
        timestamp: new Date(),
        // Include pasted images in the message for display in chat history
        images: imagesToInclude.length > 0 ? imagesToInclude : undefined,
      };

      // Only add user message if not skipping (regenerate keeps existing user message)
      if (!sendOptions?.skipUserMessage) {
        setMessages(prev => [...prev, userMessage]);
      }
      setInput("");
      setPendingImages([]); // Clear images immediately after sending
      setIsLoading(true);
      setLoadingStatus({
        phase: "connecting",
        detail: `Connecting to ${selectedModel.includes("claude") ? "Claude" : "Gemini"} API...`,
        startTime: Date.now(),
      });
      setError(null);

      // Create AbortController for this request
      shouldStopRef.current = false;
      toolsExecutedRef.current = false; // Reset for new conversation
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // Window stays visible - no thinking bar needed (AI responses visible in main window)

      try {
        // MCP tools + desktop execution tool (editing tools handled server-side)
        const mcpTools = mcpState.tools || {};

        // Local tools - call Tauri commands or render UI instead of MCP
        // Conditionally include render_component based on generativeUIEnabled setting
        const localTools = {
          ...(options?.generativeUIEnabled
            ? {
                render_component: {
                  description:
                    "Render an interactive React component in the app panel. Use this to display UI with buttons, forms, or data visualizations. The component can invoke Tauri commands via invoke() and report actions via onAction().",
                  parameters: {
                    type: "object",
                    properties: {
                      jsx: {
                        type: "string",
                        description:
                          "React JSX code to render. Can use: Button, Card, Input, Badge, etc. Use invoke() for Tauri commands, onAction() to report results.",
                      },
                      title: {
                        type: "string",
                        description: "Title for the component panel",
                      },
                    },
                    required: ["jsx", "title"],
                  },
                },
              }
            : {}),
          typecheck_workflow: {
            description:
              "Run TypeScript type checking on the current workflow. Returns structured errors with file, line, column, and message. ALWAYS call this after editing workflow TypeScript files to verify the code compiles before asking user to test.",
            parameters: {
              type: "object",
              properties: {},
              required: [],
            },
          },
          search_sdk_docs: {
            description:
              "Search @mediar-ai/workflow SDK documentation for function signatures, type definitions, and usage examples. Use when you need detailed SDK information beyond what's in the system prompt (e.g., exact interface fields, all overloads, advanced patterns).",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description:
                    "Search query - can be a function name (createStep, createWorkflow), type name (StepConfig, StepContext, WorkflowConfig), or pattern (error handling, flow control, retry)",
                },
              },
              required: ["query"],
            },
          },
        };

        // File tools (read_file, write_file, etc.) are now provided by terminator MCP agent
        // working_directory will be injected automatically for file tool calls

        const allTools = {
          ...mcpTools,
          ...localTools,
        };

        console.group("🔍 [WEB-APP-CHAT] Context Verification");
        console.log("📦 Client tools available:", Object.keys(allTools).length, "tools");
        console.log("  MCP tools:", Object.keys(mcpTools).length, "→", Object.keys(mcpTools));
        // Check specifically for file tools
        const fileTools = ["read_file", "write_file", "edit_file", "copy_content", "glob_files", "grep_files"];
        const availableFileTools = fileTools.filter(t => t in mcpTools);
        const missingFileTools = fileTools.filter(t => !(t in mcpTools));
        console.log("  📁 File tools available:", availableFileTools.length > 0 ? availableFileTools : "NONE");
        if (missingFileTools.length > 0) {
          console.warn("  ⚠️ Missing file tools:", missingFileTools);
        }
        console.log("📋 Workflow TS length:", options?.terminatorTsContent?.length || 0, "chars");
        console.log("📝 Workflow ID:", options?.workflowId || "none");
        console.log("📂 Workflow local path:", options?.localPath || "none");
        console.groupEnd();

        // Build messages with workflow context
        const allMessages = [...messages, userMessage];

        // Fetch workflow files via MCP glob_files (respects .gitignore, excludes node_modules)
        // This is used by both Gemini Vertex and Claude Code paths
        let workflowFilesFromMcp: string[] | undefined;
        const hasWorkflowContent = !!options?.terminatorTsContent;
        if (hasWorkflowContent && options.localPath && mcpState.serverInfo?.port) {
          try {
            console.log("[DEBUG] Calling glob_files for workflow files...");
            await mcpClient.connect(mcpState.serverInfo.port);
            const globResult = await mcpClient.callTool("glob_files", {
              pattern: "**/*",
              working_directory: options.localPath,
            });
            console.log("[DEBUG] glob_files raw result:", JSON.stringify(globResult).substring(0, 500));
            // Parse the response - format is "Found N files:\nfile1\nfile2\n..."
            // MCP response can be globResult.content or globResult directly as array
            const contentArray = Array.isArray(globResult) ? globResult : globResult?.content || [];
            const textContent = contentArray.find((c: any) => c.type === "text")?.text || "";
            const lines = textContent.split("\n").slice(1); // Skip "Found N files:" line
            workflowFilesFromMcp = lines.filter((l: string) => l.trim() && !l.startsWith("..."));
            console.log("[DEBUG] glob_files returned", workflowFilesFromMcp.length, "files:", workflowFilesFromMcp);
          } catch (e) {
            console.warn("[DEBUG] Failed to fetch workflow files via MCP:", e);
          }
        }

        // Inject workflow context as system message if workflow is focused
        let systemPrompt = "";
        let promptBreakdown: PromptPart[] = [];
        if (hasWorkflowContent && Object.keys(allTools).length > 0) {
          const workflowContextResult = buildWorkflowSystemPromptWithBreakdown({
            workflowName: options.focusedWorkflowName,
            terminatorTsContent: options.terminatorTsContent,
            stepMapping: options.stepMapping,
            workflowFiles: workflowFilesFromMcp,
            localPath: options.localPath, // For execute_sequence URL
            includeEditingInstructions: true,
            mcpTools: mcpState.tools,
            mcpServerInstructions: mcpState.serverInstructions,
            mode: effectiveMode, // Pass ask/act/x/recorder mode
            askModeAllowedTools, // Pass allowed tools list for dynamic prompt
            askModeBlockedTools, // Pass blocked tools list for dynamic prompt
            failureContext: failureContext, // Pass failure context if present
            recorderContext: recorderContext ?? undefined, // Pass recorder context if present
          });

          systemPrompt = workflowContextResult.prompt;
          promptBreakdown = workflowContextResult.parts;

          // Detect mode switch and prepend notification to system prompt
          const prevMode = previousModeRef.current;
          if (prevMode !== null && prevMode !== effectiveMode) {
            const modeLabels: Record<string, string> = {
              ask: "Ask (read-only)",
              act: "Act (full tools)",
              x: "X (execute-only)",
              recorder: "Recorder (file-editing)",
              homepage: "Homepage (app helper)",
            };
            const switchNotice = `**[MODE SWITCHED: ${modeLabels[prevMode]} → ${modeLabels[effectiveMode]}]**\n\n`;
            systemPrompt = switchNotice + systemPrompt;
            console.log(`🔄 [WEB-APP-CHAT] Mode switched: ${prevMode} → ${effectiveMode}`);
          }
          // Update previous mode ref for next message
          previousModeRef.current = effectiveMode;

          // Clear failure context after using it (one-time use)
          if (failureContext) {
            console.log("⚠️ [WEB-APP-CHAT] Using workflow failure context for analysis");
            setFailureContext(null);
          } else if (recorderContext) {
            console.log("🎬 [WEB-APP-CHAT] Using recorder context for step implementation");
            setRecorderContext(null);
          } else {
            console.log("✅ [WEB-APP-CHAT] Using workflow context as system prompt");
          }

          if (mcpState.serverInstructions) {
            console.log(
              `📋 [WEB-APP-CHAT] MCP server instructions included: ${mcpState.serverInstructions.length} characters`
            );
          } else {
            console.warn("⚠️ [WEB-APP-CHAT] MCP server instructions NOT available");
          }
        } else if (effectiveMode === "homepage") {
          // Homepage mode - use app assistant prompt (no workflow context)
          // Use full prompt with generative UI if enabled, otherwise use simple prompt
          if (options?.generativeUIEnabled) {
            const availableComponents = getAvailableComponentsList().split(", ");
            systemPrompt = buildAppAssistantPrompt(availableComponents);
            console.log(
              "[WEB-APP-CHAT-HOMEPAGE] Using app homepage prompt with generative UI:",
              systemPrompt.length,
              "chars"
            );
          } else {
            systemPrompt = buildSimpleAppAssistantPrompt();
            console.log(
              "[WEB-APP-CHAT-HOMEPAGE] Using simple app homepage prompt (no generative UI):",
              systemPrompt.length,
              "chars"
            );
          }
          promptBreakdown = [
            { name: "App Homepage Prompt", content: systemPrompt, tokens: Math.ceil(systemPrompt.length / 4) },
          ];
          previousModeRef.current = effectiveMode;
        }

        // Convert messages to Vertex format (exclude system messages from history)
        // Include tool calls and results from toolInvocations for full context
        const history: VertexMessage[] = [];
        const filteredMessages = allMessages.filter(m => m.role !== "system" && m !== userMessage);

        for (const m of filteredMessages) {
          if (m.role === "assistant") {
            // Assistant message - include text and any tool calls
            const parts: VertexMessage["parts"] = [];

            // Add text content if present (skip placeholder text)
            if (m.content && m.content !== "Waiting for AI response...") {
              parts.push({ text: m.content });
            }

            // Add tool calls from toolInvocations (completed ones only)
            const completedInvocations = (m.toolInvocations || []).filter(
              (inv: any) => inv.state === "result" || inv.state === "error"
            );

            if (completedInvocations.length > 0) {
              // Add function calls to model message
              for (const inv of completedInvocations) {
                // Truncate large args to save context (keep essential info)
                const truncatedArgs = truncateToolArgs(inv.args);
                parts.push({
                  functionCall: { name: inv.toolName, args: truncatedArgs },
                });
              }
            }

            // Only add message if it has content
            if (parts.length > 0) {
              history.push({ role: "model" as const, parts });

              // Add corresponding function responses as user message (Vertex API requirement)
              if (completedInvocations.length > 0) {
                const responseParts: VertexMessage["parts"] = [];
                for (const inv of completedInvocations) {
                  // Truncate large results to save context
                  // Ensure response is never undefined (Rust serde requires the field)
                  const truncatedResult = truncateToolResult(inv.result) ?? null;
                  responseParts.push({
                    functionResponse: { name: inv.toolName, response: truncatedResult },
                  });
                }
                history.push({ role: "user" as const, parts: responseParts });
              }
            }
          } else {
            // User message - just text
            if (m.content) {
              history.push({
                role: "user" as const,
                parts: [{ text: m.content }],
              });
            }
          }
        }

        // Count tool calls included in history for debugging
        const toolCallsInHistory = history.filter(h => h.parts.some((p: any) => p.functionCall)).length;
        const toolResultsInHistory = history.filter(h => h.parts.some((p: any) => p.functionResponse)).length;
        console.log(
          `[WEB-APP-CHAT] Built history: ${history.length} messages (${filteredMessages.length} raw), ` +
            `${toolCallsInHistory} with tool calls, ${toolResultsInHistory} with tool results`
        );

        // Filter tools based on mode (X mode only allows specific tools)
        let toolsToSend = allTools;
        if (effectiveMode === "x") {
          toolsToSend = filterToolsForXMode(allTools) as typeof allTools;
          console.log(
            `🔧 [WEB-APP-CHAT] X mode: filtered to ${Object.keys(toolsToSend).length} tools:`,
            Object.keys(toolsToSend)
          );
        }

        // Convert tools to Vertex format
        const tools = convertAiSdkToolsToVertexFormat(toolsToSend);

        // Calculate prompt breakdown for debugging UI
        const estimateTokens = (str: string) => Math.ceil(str.length / 4);

        // History tokens
        const historyStr = JSON.stringify(history);
        const historyTokens = estimateTokens(historyStr);

        // Tool definitions tokens - per-tool breakdown
        const toolsStr = JSON.stringify(tools);
        const toolParts: PromptPart[] = tools
          .map((tool: any) => {
            const singleToolStr = JSON.stringify(tool);
            return {
              name: tool.name || "unknown",
              content: tool.description || "",
              tokens: estimateTokens(singleToolStr),
            };
          })
          .sort((a: PromptPart, b: PromptPart) => b.tokens - a.tokens);
        const toolsTokens = estimateTokens(toolsStr);
        console.log("[BREAKDOWN] Tool parts:", toolParts.length, "tools, total:", toolsTokens);

        // User input tokens
        const inputTokens = estimateTokens(messageText);

        // Build full breakdown
        const fullBreakdown: PromptPart[] = [
          ...promptBreakdown,
          { name: "History", content: `${history.length} messages`, tokens: historyTokens },
          { name: "Tool Definitions", content: `${tools.length} tools`, tokens: toolsTokens, children: toolParts },
          {
            name: "User Input",
            content: messageText.substring(0, 50) + (messageText.length > 50 ? "..." : ""),
            tokens: inputTokens,
          },
        ];

        // Calculate total independently from the actual full prompt we send
        const fullPromptStr = (systemPrompt || "") + historyStr + toolsStr + messageText;
        const totalTokensIndependent = estimateTokens(fullPromptStr);

        // Update user message with breakdown (mutate in place since it's already in state)
        userMessage.promptBreakdown = fullBreakdown;
        userMessage.promptTotalTokens = totalTokensIndependent;

        // Force re-render with updated breakdown
        setMessages(prev => prev.map(m => (m.id === userMessage.id ? { ...userMessage } : m)));

        // Track all assistant messages created during this conversation turn
        const assistantMessages: any[] = [];

        // Multi-turn conversation loop with KV-backed sessions
        let currentSessionId = sessionId; // Use existing session or will get new one from server

        // Get auth token
        const authToken = await getAuthToken();
        if (!authToken) {
          throw new Error("Not authenticated. Please log in to use AI features.");
        }

        // First turn: send user message
        console.log(`[WEB-APP-CHAT] Turn 1: Sending user message, sessionId: ${currentSessionId || "new"}`);

        // Gemini/Vertex is stateless - must send system, tools, and history EVERY turn
        // isFirstTurn is only used for logging, not for conditional sending
        const isFirstTurn = !currentSessionId;

        // Create assistant message that we'll update as stream events arrive
        const currentMessage: any = {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
          toolInvocations: [],
        };
        assistantMessages.push(currentMessage);
        setMessages(prev => [...prev, currentMessage]);

        // Determine backend: Claude Code uses ACP, everything else uses Rust
        const useClaudeCode = shouldUseClaudeCode(selectedModel);
        console.log(`[WEB-APP-CHAT] Using ${useClaudeCode ? "Claude Code" : "Rust"} backend for ${selectedModel}`);

        // Claude Code uses ACP protocol - completely separate path
        if (useClaudeCode) {
          console.log("[WEB-APP-CHAT] 🤖 Using Claude Code via ACP protocol");

          // Add Claude Code specific fields to the message
          currentMessage.source = "claude-code";
          currentMessage.parts = []; // Parts array for interleaved text/tools
          // Track current text part for accumulating text chunks
          let currentTextPart: { type: "text"; content: string } | null = null;

          // Initialize Claude Code session if needed
          const mcpPort = mcpState.serverInfo?.port;
          if (!mcpPort) {
            throw new Error("MCP server not available. Please wait for MCP to connect.");
          }

          // Use workflow localPath as cwd, fallback to user home
          const cwd = options?.localPath || (await invoke<string>("get_home_dir").catch(() => "C:\\Users\\matt"));

          // Start session if not already active
          // Track if this is a fresh session start (for history restoration)
          const isNewSession = !hasActiveClaudeCodeSession();
          console.log(
            `[WEB-APP-CHAT] 🔍 Claude Code session check: isNewSession=${isNewSession}, needsHistorySync=${needsClaudeHistorySyncRef.current}, messages.length=${messages.length}`
          );

          if (isNewSession) {
            // Listen for status updates from Rust during session initialization
            console.log("[CC-STATUS] Setting up status listener for new session");
            const unlistenStatus = await listenForStatusUpdates((phase, message) => {
              console.log(`[CC-STATUS] Received: phase=${phase}, message=${message}`);
              setLoadingStatus(prev =>
                prev
                  ? {
                      ...prev,
                      phase: "connecting",
                      detail: message,
                    }
                  : null
              );
            });

            try {
              console.log(`[WEB-APP-CHAT] Starting Claude Code session with cwd=${cwd}, mcpPort=${mcpPort}`);
              const acpSessionId = await startClaudeCodeSession(cwd, mcpPort);
              // Set session ID so messages persist across workflow reloads
              // Prefix with 'acp:' to distinguish from Vertex session IDs
              setSessionId(`acp:${acpSessionId}`);
              console.log(`[WEB-APP-CHAT] Set ACP session ID: acp:${acpSessionId}`);
              // Mark that Claude needs history sync since this is a fresh session
              needsClaudeHistorySyncRef.current = true;
              // Reset system prompt sent flag - new session needs system context on Turn 1
              claudeCodeSystemPromptSentRef.current = false;
              console.log(
                `[WEB-APP-CHAT] 🔄 Set needsClaudeHistorySync=true, systemPromptSent=false (new ACP session)`
              );
            } finally {
              // Clean up status listener
              unlistenStatus();
            }
          }

          // Build conversation history context when Claude doesn't know about previous messages
          // This happens when: 1) New ACP session created, 2) Historical conversation loaded
          let historyContext = "";
          const previousMessages = messages.filter(m => m.id !== userMessage.id);
          console.log(
            `[WEB-APP-CHAT] 🔍 History check: needsHistorySync=${needsClaudeHistorySyncRef.current}, previousMessages.length=${previousMessages.length}`
          );

          if (needsClaudeHistorySyncRef.current && previousMessages.length > 0) {
            historyContext = buildClaudeCodeHistoryContext(previousMessages);
            if (historyContext) {
              console.log(
                `[WEB-APP-CHAT] 📜 Built history context: ${historyContext.length} chars from ${previousMessages.length} previous messages`
              );
              // Clear the flag after building history - Claude will know about these messages now
              needsClaudeHistorySyncRef.current = false;
              console.log(`[WEB-APP-CHAT] 🔄 Set needsClaudeHistorySync=false (history sent)`);
            } else {
              console.log(`[WEB-APP-CHAT] ⚠️ buildClaudeCodeHistoryContext returned empty string`);
            }
          } else if (needsClaudeHistorySyncRef.current) {
            console.log(`[WEB-APP-CHAT] 🔍 needsHistorySync=true but no previous messages to send`);
            needsClaudeHistorySyncRef.current = false;
          }

          // Build Claude Code system prompt (excludes MCP instructions - Claude Code gets those via MCP server)
          // This includes: mode prompt, failure context, workflow name, workflow instructions, step mapping, files
          let claudeCodePrompt = messageText;
          const hasWorkflowContent = !!options?.terminatorTsContent;
          if (hasWorkflowContent) {
            const claudeCodeSystemPrompt = buildClaudeCodeSystemPrompt({
              workflowName: options.focusedWorkflowName,
              terminatorTsContent: options.terminatorTsContent,
              stepMapping: options.stepMapping,
              workflowFiles: workflowFilesFromMcp, // Same as Gemini - fetched via MCP glob_files
              localPath: options.localPath,
              includeEditingInstructions: true,
              mode: effectiveMode,
              askModeAllowedTools,
              askModeBlockedTools,
              failureContext: failureContext || undefined,
            });

            if (claudeCodeSystemPrompt) {
              // ACP is stateful - only send full system prompt on Turn 1 of session
              // Mode switches get a short notification instead of full system prompt
              // Failure context is one-time and should be sent even on Turn 2+
              const isFirstTurn = !claudeCodeSystemPromptSentRef.current;
              const prevMode = previousModeRef.current;
              const modeChanged = prevMode !== null && prevMode !== effectiveMode;
              const hasFailureContext = !!failureContext;

              if (isFirstTurn || hasFailureContext) {
                // Turn 1 OR failure analysis: Send full system prompt (includes failure context)
                claudeCodePrompt = `${claudeCodeSystemPrompt}\n\n---\n\n**User Request:**\n${messageText}`;
                claudeCodeSystemPromptSentRef.current = true;
                console.log(
                  `[WEB-APP-CHAT] 📋 ${hasFailureContext ? "Failure analysis" : "Turn 1"}: Prepended ${claudeCodeSystemPrompt.length} char system context to Claude Code prompt`
                );
                if (hasFailureContext) {
                  console.log("⚠️ [WEB-APP-CHAT] Using workflow failure context for Claude Code analysis");
                  setFailureContext(null);
                }
              } else if (modeChanged) {
                // Turn 2+, mode switched: Send short mode change notice only
                const modeLabels: Record<string, string> = {
                  ask: "Ask (read-only)",
                  act: "Act (full tools)",
                  x: "X (execute-only)",
                  recorder: "Recorder (file-editing)",
                  homepage: "Homepage (app helper)",
                };
                const modeDescriptions: Record<string, string> = {
                  act: "full tool access",
                  ask: "read-only access (no action tools)",
                  x: "execute-only access",
                  recorder: "file-editing access only",
                  homepage: "app homepage access (generate UI, invoke app commands)",
                };
                const switchNotice = `**[MODE SWITCHED: ${modeLabels[prevMode]} → ${modeLabels[effectiveMode]}]**\n\nYou now have ${modeDescriptions[effectiveMode]}.`;
                claudeCodePrompt = `${switchNotice}\n\n---\n\n**User Request:**\n${messageText}`;
                console.log(
                  `🔄 [WEB-APP-CHAT] Claude Code mode switched: ${prevMode} → ${effectiveMode} (short notice only)`
                );
              } else {
                // Turn 2+ without mode change: just send the user message
                console.log(
                  `[WEB-APP-CHAT] 📋 Turn 2+: Sending user message only (${messageText.length} chars, no system context)`
                );
              }

              // Update previous mode ref for next message
              previousModeRef.current = effectiveMode;
            }
          }

          // Prepend conversation history if this is a new session with previous messages
          if (historyContext) {
            claudeCodePrompt = `<previous_conversation>\nThis is a continuation of a previous conversation. Here's what was discussed:\n\n${historyContext}\n</previous_conversation>\n\n${claudeCodePrompt}`;
            console.log(`[WEB-APP-CHAT] 📜 Prepended conversation history to Claude Code prompt`);
          }

          // Set terminator mode before sending prompt (blocks tools server-side in ask mode)
          try {
            await invoke("set_terminator_mode", {
              mcpPort,
              mode: effectiveMode,
              blockedTools:
                effectiveMode === "ask"
                  ? askModeBlockedTools
                  : effectiveMode === "recorder"
                    ? RECORDER_MODE_BLOCKED_TOOLS
                    : effectiveMode === "x"
                      ? X_MODE_BLOCKED_TOOLS
                      : [],
            });
            console.log(
              `[WEB-APP-CHAT] Set terminator mode to '${effectiveMode}' with ${effectiveMode === "x" ? X_MODE_BLOCKED_TOOLS.length : effectiveMode === "recorder" ? RECORDER_MODE_BLOCKED_TOOLS.length : effectiveMode === "ask" ? askModeBlockedTools.length : 0} blocked tools`
            );
          } catch (e) {
            console.warn(`[WEB-APP-CHAT] Failed to set terminator mode: ${e}`);
            // Continue anyway - mode enforcement is a safety feature, not critical
          }

          // Send prompt and stream response
          const claudeStream = sendClaudeCodePrompt(claudeCodePrompt, signal);

          // Update status to waiting for response
          setLoadingStatus(prev =>
            prev
              ? {
                  ...prev,
                  phase: "waiting",
                  detail: "Waiting for Claude response...",
                }
              : null
          );

          let hasReceivedContent = false;

          for await (const event of claudeStream) {
            if (shouldStopRef.current) {
              console.log("🛑 [WEB-APP-CHAT] Stop flag detected during Claude Code stream");
              break;
            }

            switch (event.type) {
              case "text":
                // Update loading status on first content
                if (!hasReceivedContent) {
                  hasReceivedContent = true;
                  setLoadingStatus(prev =>
                    prev ? { ...prev, phase: "streaming", detail: "Streaming response..." } : null
                  );
                }
                // Accumulate text in the current text part, or create a new one
                if (currentTextPart) {
                  currentTextPart.content += event.content;
                } else {
                  currentTextPart = { type: "text", content: event.content };
                  currentMessage.parts.push(currentTextPart);
                }
                // Also update content for backwards compatibility
                currentMessage.content += event.content;
                setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));
                break;

              case "tool_start": {
                console.log(
                  `🔧 [WEB-APP-CHAT] Claude Code tool starting: ${event.toolCallId} ${event.name} (${event.kind}) status=${event.status}`
                );

                // Update loading status to show tool being used
                setLoadingStatus(prev =>
                  prev
                    ? {
                        ...prev,
                        phase: "processing_tools",
                        detail: `Running ${event.name}...`,
                      }
                    : null
                );

                // Mark file for diff highlighting when edit tool detected
                // File watcher will trigger diff with correct before/after content when change is detected
                const isMcpEditTool = event.name?.includes("edit_file") || event.name?.includes("write_file");
                const isEditTool = event.kind === "edit" || isMcpEditTool;
                const rawEditFilePath = (event.args?.path as string) || (event.locations?.[0]?.path as string);
                if (isEditTool && rawEditFilePath) {
                  // Normalize absolute paths to relative (e.g., "C:\...\src\steps\file.ts" -> "src/steps/file.ts")
                  let editFilePath = rawEditFilePath;
                  if (rawEditFilePath.includes(":\\") || rawEditFilePath.startsWith("/")) {
                    const srcMatch = rawEditFilePath.replace(/\\/g, "/").match(/\/(src\/.+)$/);
                    if (srcMatch) {
                      editFilePath = srcMatch[1];
                    } else {
                      const parts = rawEditFilePath.replace(/\\/g, "/").split("/");
                      editFilePath = parts.slice(-2).join("/");
                    }
                  }
                  console.log(`📝 [WEB-APP-CHAT] CC edit tool: marking ${editFilePath} for diff`);
                  options?.markPendingAIEdit?.(editFilePath);
                }

                // Check if tool already exists in parts (ACP streams ToolCall events - first partial, then complete)
                const existingToolPart = currentMessage.parts.find(
                  (part: any) => part.type === "tool" && part.invocation?.toolCallId === event.toolCallId
                );

                if (existingToolPart) {
                  // Update existing tool with new data
                  existingToolPart.invocation.toolName = event.name;
                  existingToolPart.invocation.args = event.args;
                  existingToolPart.invocation.kind = event.kind;
                  existingToolPart.invocation.locations = event.locations;
                } else {
                  // End current text part (tool starts a new segment)
                  currentTextPart = null;

                  // Create tool invocation
                  const toolInvocation = {
                    toolCallId: event.toolCallId,
                    toolName: event.name,
                    args: event.args,
                    state: event.status === "pending" ? "call" : "running",
                    source: "claude-code",
                    kind: event.kind,
                    locations: event.locations,
                  };

                  // Add to parts array
                  currentMessage.parts.push({ type: "tool", invocation: toolInvocation });

                  // Also add to toolInvocations for backwards compatibility
                  currentMessage.toolInvocations.push(toolInvocation);
                }
                setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));
                break;
              }

              case "tool_update": {
                console.log(
                  `🔄 [WEB-APP-CHAT] Claude Code tool update: ${event.toolCallId} status=${event.status} hasRawOutput=${!!event.rawOutput} hasContent=${!!event.content}`
                );

                // Find tool in parts array
                const toolPart = currentMessage.parts.find(
                  (part: any) => part.type === "tool" && part.invocation?.toolCallId === event.toolCallId
                );

                // Also find in toolInvocations for backwards compatibility
                const toolInv = currentMessage.toolInvocations.find((inv: any) => inv.toolCallId === event.toolCallId);

                // Update the tool in both places
                const updateTool = (tool: any) => {
                  if (event.status === "completed") {
                    tool.state = "result";
                  } else if (event.status === "failed") {
                    tool.state = "error";
                  } else if (event.status === "in_progress") {
                    tool.state = "running";
                  }
                  if (event.title) {
                    tool.toolName = event.title;
                  }
                  if (event.content) {
                    tool.content = event.content;
                    // ACP sends tool results in content field (not rawOutput)
                    // Use content as result for ToolCallBlock display
                    if (!tool.result) {
                      tool.result = event.content;
                      console.log(
                        `📦 [WEB-APP-CHAT] Set tool result from content for ${tool.toolName}:`,
                        typeof event.content,
                        JSON.stringify(event.content).substring(0, 200)
                      );
                    }
                  }
                  if (event.rawOutput) {
                    tool.result = event.rawOutput;
                    console.log(
                      `📦 [WEB-APP-CHAT] Set tool result from rawOutput for ${tool.toolName}:`,
                      typeof event.rawOutput,
                      JSON.stringify(event.rawOutput).substring(0, 200)
                    );
                  }
                };

                if (toolPart?.invocation) {
                  updateTool(toolPart.invocation);
                }
                if (toolInv) {
                  updateTool(toolInv);
                }

                // When tool completes, end current text part so next text starts fresh
                if (event.status === "completed" || event.status === "failed") {
                  currentTextPart = null;
                }

                setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));

                // Handle ask_user response for mode switch to Act mode (Claude Code path)
                // Works for both recorder->act and ask->act transitions
                const originalToolName = toolInv?.toolName || toolPart?.invocation?.toolName || "";
                if (
                  (originalToolName === "ask_user" || originalToolName === "mcp__terminator__ask_user") &&
                  event.status === "completed" &&
                  (effectiveMode === "recorder" || effectiveMode === "ask")
                ) {
                  // Parse the tool result to check if user confirmed mode switch
                  const toolResult = event.content || event.rawOutput;
                  let parsedResult: any = null;

                  // Handle array format from MCP
                  if (Array.isArray(toolResult)) {
                    const textContent = toolResult.find((item: any) => item?.type === "text" || item?.content?.text);
                    const textStr = textContent?.text || textContent?.content?.text;
                    if (textStr) {
                      try {
                        parsedResult = JSON.parse(textStr);
                      } catch {
                        // Not JSON
                      }
                    }
                  } else if (typeof toolResult === "object") {
                    parsedResult = toolResult;
                  }

                  if (parsedResult) {
                    // Handle both response formats:
                    // - New format: { action: "accept", content: { answer: "..." } }
                    // - Server format: { action: "ask_user", status: "answered", answer: "..." }
                    const answer = (parsedResult?.content?.answer || parsedResult?.answer || "").toLowerCase();
                    const isAnswered = parsedResult?.action === "accept" || parsedResult?.status === "answered";

                    if (isAnswered && (answer.includes("yes") || answer.includes("act") || answer.includes("test"))) {
                      console.log(
                        `[WEB-APP-CHAT] User confirmed switch to Act mode via ask_user (Claude Code path, was: ${effectiveMode})`
                      );

                      // Update React state for UI
                      setMode("act");

                      // Update local variable for subsequent processing in this batch
                      effectiveMode = "act";
                    }
                  }
                }

                // STEP POOL: Capture MCP tool completions for workflow step pool
                // MCP tools from Claude Code have names like "mcp__terminator__navigate_browser"
                const isMcpTool = originalToolName.startsWith("mcp__");
                if (isMcpTool && event.status === "completed" && shouldCaptureToolToWorkflow(originalToolName)) {
                  const toolArgs = toolInv?.args || toolPart?.invocation?.args || {};
                  const stepName = generateStepName({ tool_name: originalToolName, arguments: toolArgs });
                  console.log(
                    `[STEP-POOL] Adding Claude Code MCP tool ${originalToolName} to step pool as "${stepName}"`
                  );

                  // Fire-and-forget - don't block chat flow
                  invoke("add_to_pool", {
                    toolName: originalToolName,
                    arguments: toolArgs,
                    result: event.rawOutput || null,
                    error: null,
                    durationMs: 0,
                    workflowName: options?.focusedWorkflowName || null,
                    workflowId: options?.workflowId ? Number(options.workflowId) : null,
                    stepId: crypto.randomUUID(),
                    stepName: stepName,
                    sessionId: null,
                  }).catch(err => console.warn("[STEP-POOL] Failed to add Claude Code tool to pool:", err));
                }

                // Warn if tool not found in either location
                if (!toolPart && !toolInv) {
                  console.warn(`[WEB-APP-CHAT] Tool update for unknown toolCallId: ${event.toolCallId}`);
                }
                break;
              }

              case "done":
                console.log(`✅ [WEB-APP-CHAT] Claude Code stream done: ${event.reason}`);
                currentMessage.isStreaming = false;
                setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));
                break;

              case "error":
                console.error(`❌ [WEB-APP-CHAT] Claude Code error: ${event.error}`);
                throw new Error(event.error);
            }
          }

          // Mark message as complete
          currentMessage.isStreaming = false;
          setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));

          console.log("[WEB-APP-CHAT] Claude Code conversation completed");

          return; // Exit early - Claude Code handles its own tool loop
        }

        // Set terminator mode before sending to Vertex AI (blocks tools server-side in ask/recorder mode)
        const vertexMcpPort = mcpState.serverInfo?.port;
        if (vertexMcpPort) {
          try {
            await invoke("set_terminator_mode", {
              mcpPort: vertexMcpPort,
              mode: effectiveMode,
              blockedTools:
                effectiveMode === "ask"
                  ? askModeBlockedTools
                  : effectiveMode === "recorder"
                    ? RECORDER_MODE_BLOCKED_TOOLS
                    : effectiveMode === "x"
                      ? X_MODE_BLOCKED_TOOLS
                      : [],
            });
            console.log(
              `[WEB-APP-CHAT] Set terminator mode to '${effectiveMode}' with ${effectiveMode === "x" ? X_MODE_BLOCKED_TOOLS.length : effectiveMode === "recorder" ? RECORDER_MODE_BLOCKED_TOOLS.length : effectiveMode === "ask" ? askModeBlockedTools.length : 0} blocked tools`
            );
          } catch (e) {
            console.warn(`[WEB-APP-CHAT] Failed to set terminator mode: ${e}`);
          }
        }

        // Build request for Rust backend (pass full history, system, tools every turn)
        const request: VertexRequest = {
          model: selectedModel,
          input: messageText,
          history: history,
          system: systemPrompt || undefined,
          tools: tools.length > 0 ? tools : undefined,
          thinkingLevel: selectedModel === "gemini-3-pro-preview" ? thinkingLevel : undefined,
          mode: effectiveMode,
          inlineImages: imagesToInclude.length > 0 ? imagesToInclude : undefined,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
          },
        };

        // Process the streaming response via Rust backend
        const stream = callVertexAIStreamRust(request, signal);

        // Update status to waiting for response
        setLoadingStatus(prev =>
          prev
            ? {
                ...prev,
                phase: "waiting",
                detail: `Waiting for ${selectedModel.includes("claude") ? "Claude" : "Gemini"} response...`,
              }
            : null
        );

        // Collect response data from stream
        let response: {
          text: string;
          toolCalls: VertexToolCall[];
          sessionId?: string;
          finishReason?: string;
          workflowData?: any;
          metrics?: any;
          rawParts?: any[]; // Raw parts from Vertex response - includes thought_signature for Gemini 3
        } = {
          text: "",
          toolCalls: [],
        };

        // Track accumulated conversation history for multi-turn tool loops
        // This gets updated after each turn to include model responses and tool results
        const accumulatedHistory: VertexMessage[] = [...history];

        // Track if we've started receiving content
        let hasReceivedContent = false;

        // Process stream events
        for await (const event of stream) {
          if (shouldStopRef.current) {
            console.log("🛑 [WEB-APP-CHAT] Stop flag detected during stream");
            break;
          }

          switch (event.type) {
            case "text":
              // Update status to streaming on first content
              if (!hasReceivedContent) {
                hasReceivedContent = true;
                setLoadingStatus(prev =>
                  prev ? { ...prev, phase: "streaming", detail: "Streaming response..." } : null
                );
              }
              response.text += event.content;
              currentMessage.content = response.text;
              setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));
              break;

            case "server_tool_start":
              console.log(`🔧 [WEB-APP-CHAT] Server tool starting: ${event.name}`);
              currentMessage.toolInvocations.push({
                toolCallId: `server-${Date.now()}-${event.name}`,
                toolName: event.name,
                args: event.args,
                state: "running",
                source: "server",
              });
              setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));
              break;

            case "server_tool_complete": {
              console.log(`✅ [WEB-APP-CHAT] Server tool complete: ${event.name} (${event.elapsedMs}ms)`);
              // Find and update the server tool invocation
              const serverToolInv = currentMessage.toolInvocations.find(
                (inv: any) => inv.toolName === event.name && inv.state === "running" && inv.source === "server"
              );
              if (serverToolInv) {
                serverToolInv.state = event.error ? "error" : "result";
                serverToolInv.result = event.result;
                serverToolInv.elapsedMs = event.elapsedMs;
                if (event.error) serverToolInv.error = event.error;
              }
              setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));
              break;
            }

            case "client_tools":
            case "tool_calls": // Rust backend emits tool_calls instead of client_tools
              console.log(
                `🔧 [WEB-APP-CHAT] ${event.type} received: ${event.toolCalls.length}`,
                event.toolCalls.map(tc => tc.name)
              );
              response.toolCalls = event.toolCalls.map(tc => ({
                name: tc.name,
                args: tc.args,
                id: (tc as any).id,
              }));
              // Capture raw parts for Gemini 3 thought_signature support
              if ((event as any).rawParts) {
                response.rawParts = (event as any).rawParts;
                console.log(`🔧 [WEB-APP-CHAT] Captured rawParts for thought_signature`);
              }
              // Add tools to invocations
              event.toolCalls.forEach(tc => {
                currentMessage.toolInvocations.push({
                  toolCallId: (tc as any).id || `${Date.now()}-${tc.name}`,
                  toolName: tc.name,
                  args: tc.args,
                  state: "call",
                  source: "client",
                });
              });
              setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));
              break;

            case "done":
              console.log(
                `✅ [WEB-APP-CHAT] Stream done: finishReason=${event.finishReason}, sessionId=${event.sessionId}`
              );
              response.sessionId = event.sessionId;
              response.finishReason = event.finishReason;
              response.workflowData = event.workflowData;
              response.metrics = event.metrics;
              // Update context metrics for UI display
              // Handle both web app format (metrics.tokens) and Rust format (usage)
              if (event.metrics?.tokens) {
                setContextMetrics({
                  promptTokens: event.metrics.tokens.promptTokenCount || 0,
                  responseTokens: event.metrics.tokens.candidatesTokenCount || 0,
                  totalTokens: event.metrics.tokens.totalTokenCount || 0,
                });
              } else if (event.usage) {
                // Rust backend sends usage directly (snake_case from Rust)
                setContextMetrics({
                  promptTokens: event.usage.prompt_token_count || event.usage.promptTokenCount || 0,
                  responseTokens: event.usage.candidates_token_count || event.usage.candidatesTokenCount || 0,
                  totalTokens: event.usage.total_token_count || event.usage.totalTokenCount || 0,
                });
              }
              break;

            case "error":
              console.error(`❌ [WEB-APP-CHAT] Stream error:`, event.error);
              throw new Error(event.error);
          }
        }

        if (isFirstTurn) {
          console.log(
            `✅ [WEB-APP-CHAT] Turn 1: Sent system prompt (${systemPrompt?.length || 0} chars) and ${tools.length} tools`
          );
        } else {
          console.log(
            `🔄 [WEB-APP-CHAT] Turn 2+: Sent system prompt (${systemPrompt?.length || 0} chars) - Gemini is stateless`
          );
        }

        // Store sessionId from response (or generate one if backend didn't provide it)
        if (response.sessionId) {
          currentSessionId = response.sessionId;
          if (!sessionId) {
            setSessionId(response.sessionId);
            console.log(`[WEB-APP-CHAT] Received new sessionId from backend: ${response.sessionId}`);
          }
        } else if (!sessionId && !currentSessionId) {
          // Rust backend doesn't return sessionId - generate one on frontend
          const generatedSessionId = `local-${crypto.randomUUID()}`;
          currentSessionId = generatedSessionId;
          setSessionId(generatedSessionId);
          console.log(`[WEB-APP-CHAT] Generated local sessionId: ${generatedSessionId}`);
        }

        console.log(
          `[WEB-APP-CHAT] Turn 1: text=${response.text?.length || 0} chars, toolCalls=${response.toolCalls?.length || 0}, finishReason=${response.finishReason}`
        );

        // Update message streaming state based on whether there are client tools
        currentMessage.isStreaming = response.toolCalls && response.toolCalls.length > 0;
        setMessages(prev => prev.map(m => (m.id === currentMessage.id ? { ...currentMessage } : m)));

        // Reference for compatibility with existing tool execution loop
        const turn1Message = currentMessage;

        // AI response visible in main window (no thinking bar needed)

        // Add user message to accumulated history after first turn
        accumulatedHistory.push({ role: "user" as const, parts: [{ text: messageText }] });

        // Tool execution loop
        let turnCount = 1;
        const maxTurns = 50;

        while (response.toolCalls && response.toolCalls.length > 0 && turnCount < maxTurns && !shouldStopRef.current) {
          // Check if stopped
          if (shouldStopRef.current) {
            console.log("🛑 [WEB-APP-CHAT] Stop flag detected, breaking tool execution loop");
            break;
          }

          turnCount++;
          console.log(`[WEB-APP-CHAT] Turn ${turnCount}: Executing ${response.toolCalls.length} tool(s)`);

          // Update status to processing tools
          const statusToolNames = response.toolCalls.map(tc => tc.name).join(", ");
          setLoadingStatus(prev =>
            prev
              ? {
                  ...prev,
                  phase: "processing_tools",
                  detail: `Executing ${response.toolCalls.length > 1 ? `${response.toolCalls.length} tools` : statusToolNames}...`,
                }
              : null
          );

          // Mark previous message as complete
          const previousMessage = assistantMessages[assistantMessages.length - 1];
          previousMessage.isStreaming = false;
          setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));

          // Create NEW intermediate message to show tool execution progress
          // Filter out render_component - it renders in app panel, not as tool execution
          const realToolCalls = response.toolCalls.filter(tc => tc.name !== "render_component");
          const toolNames = realToolCalls.map(tc => tc.name).join(", ");

          // Only show intermediate message if there are real tools to execute
          let intermediateMessage: any = null;
          if (realToolCalls.length > 0) {
            const executingMessage =
              realToolCalls.length === 1
                ? `Executing tool: ${toolNames}...`
                : `Executing ${realToolCalls.length} tools: ${toolNames}...`;

            intermediateMessage = {
              id: `${Date.now()}-executing-${turnCount}`,
              role: "assistant",
              content: executingMessage,
              timestamp: new Date(),
              isStreaming: true,
              toolInvocations: [],
            };

            assistantMessages.push(intermediateMessage);
            setMessages(prev => [...prev, intermediateMessage]);
          }

          // Execute tools and collect results
          const toolResults: Array<{ id: string; name: string; result: any }> = [];

          for (const toolCall of response.toolCalls) {
            // Check if stopped BEFORE starting tool
            if (shouldStopRef.current) {
              console.log("🛑 [STOP-DEBUG] Stop flag detected BEFORE tool execution, breaking loop");
              break;
            }

            const toolName = toolCall.name;
            console.log(`[STOP-DEBUG] Starting tool ${toolName}, shouldStopRef=${shouldStopRef.current}`);
            const toolArgs = toolCall.args;

            // Handle render_component tool - component is rendered inline in chat via ToolCallBlock
            if (toolName === "render_component") {
              console.log(`[WEB-APP-CHAT] render_component: ${toolArgs?.title}`);

              // Pre-validate JSX before marking as successful
              const jsxCode = toolArgs?.jsx;
              const validation = jsxCode ? validateJSX(jsxCode) : { valid: false, error: "No JSX code provided" };

              // Update tool invocation state
              const invocation = previousMessage.toolInvocations?.find(
                (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
              );

              if (validation.valid) {
                // JSX is valid - mark as success
                if (invocation) {
                  invocation.state = "result";
                  invocation.result = { success: true, message: "Component rendered successfully" };
                  setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
                }
                toolResults.push({
                  id: toolCall.id || `${Date.now()}-${toolName}`,
                  name: toolName,
                  result: { success: true, message: "Component rendered successfully" },
                });
              } else {
                // JSX validation failed - return error so AI can self-correct
                console.error(`[WEB-APP-CHAT] render_component validation failed: ${validation.error}`);
                const errorResult = {
                  success: false,
                  error: validation.error,
                  hint: "Fix the JSX code and try again. Remember: Do NOT use import statements - all components (Button, Card, etc.) and hooks (useState, useEffect) are already in scope.",
                };
                if (invocation) {
                  invocation.state = "error";
                  invocation.result = errorResult;
                  setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
                }
                toolResults.push({
                  id: toolCall.id || `${Date.now()}-${toolName}`,
                  name: toolName,
                  result: errorResult,
                });
              }
              continue;
            }

            // Handle typecheck_workflow tool - calls Tauri command instead of MCP
            if (toolName === "typecheck_workflow") {
              console.log(`[WEB-APP-CHAT] Typecheck tool: running on workflow ${options?.workflowId}`);

              if (!options?.workflowId) {
                const errorResult = { success: false, error: "No workflow focused. Please focus a workflow first." };
                toolResults.push({
                  id: toolCall.id || `${Date.now()}-${toolName}`,
                  name: toolName,
                  result: errorResult,
                });

                // Update invocation state
                const invocation = previousMessage.toolInvocations?.find(
                  (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
                );
                if (invocation) {
                  invocation.state = "result";
                  invocation.result = errorResult;
                  setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
                }
                continue;
              }

              try {
                const { invoke } = await import("@tauri-apps/api/core");
                const typecheckResult = await invoke<{
                  success: boolean;
                  error_count: number;
                  errors: Array<{
                    file: string;
                    line: number;
                    column: number;
                    code: string;
                    message: string;
                    context: string | null; // Code context ~5 lines around error
                  }>;
                  raw_output: string;
                }>("typecheck_typescript_workflow", { workflowId: options.workflowId });

                console.log(
                  `[WEB-APP-CHAT] Typecheck result: ${typecheckResult.success ? "PASS" : `FAIL (${typecheckResult.error_count} errors)`}`
                );

                // Track typecheck metrics
                const { trackTypecheckRun } = await import("../lib/analytics");
                trackTypecheckRun(
                  options.workflowId,
                  typecheckResult.error_count,
                  0, // warnings not tracked separately yet
                  "ai_tool"
                );

                // Format result for AI consumption - include code context for debugging
                const formattedResult = typecheckResult.success
                  ? { success: true, message: "TypeScript compilation successful. No errors found." }
                  : {
                      success: false,
                      error_count: typecheckResult.error_count,
                      errors: typecheckResult.errors.map(e => {
                        // Include code context if available (shows ~5 lines around error)
                        const location = `${e.file}:${e.line}:${e.column}`;
                        const errorLine = `${location} - ${e.code}: ${e.message}`;
                        if (e.context) {
                          return `${errorLine}\n\nCode context:\n${e.context}`;
                        }
                        return errorLine;
                      }),
                      message: `TypeScript compilation failed with ${typecheckResult.error_count} error(s).`,
                    };

                toolResults.push({
                  id: toolCall.id || `${Date.now()}-${toolName}`,
                  name: toolName,
                  result: formattedResult,
                });

                // Update invocation state
                const invocation = previousMessage.toolInvocations?.find(
                  (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
                );
                if (invocation) {
                  invocation.state = "result";
                  invocation.result = formattedResult;
                  setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
                }
              } catch (error) {
                console.error(`[WEB-APP-CHAT] Typecheck error:`, error);
                const errorResult = { success: false, error: `Failed to run typecheck: ${error}` };
                toolResults.push({
                  id: toolCall.id || `${Date.now()}-${toolName}`,
                  name: toolName,
                  result: errorResult,
                });

                const invocation = previousMessage.toolInvocations?.find(
                  (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
                );
                if (invocation) {
                  invocation.state = "result";
                  invocation.result = errorResult;
                  setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
                }
              }
              continue;
            }

            // Handle search_sdk_docs tool - searches workflow SDK documentation
            if (toolName === "search_sdk_docs") {
              const query = (toolArgs?.query as string) || "";
              console.log(`[WEB-APP-CHAT] search_sdk_docs: searching for "${query}"`);

              try {
                const { invoke } = await import("@tauri-apps/api/core");
                const searchResult = await invoke<{
                  found: boolean;
                  matches: Array<{
                    file: string;
                    content: string;
                    line_start: number;
                    line_end: number;
                  }>;
                  message: string;
                }>("search_sdk_docs", { query });

                console.log(
                  `[WEB-APP-CHAT] search_sdk_docs result: ${searchResult.found ? `${searchResult.matches.length} matches` : "no matches"}`
                );

                const formattedResult = searchResult.found
                  ? {
                      found: true,
                      matches: searchResult.matches.map(
                        m => `// ${m.file}:${m.line_start}-${m.line_end}\n${m.content}`
                      ),
                      message: searchResult.message,
                    }
                  : {
                      found: false,
                      message: searchResult.message,
                    };

                toolResults.push({
                  id: toolCall.id || `${Date.now()}-${toolName}`,
                  name: toolName,
                  result: formattedResult,
                });

                // Update invocation state
                const invocation = previousMessage.toolInvocations?.find(
                  (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
                );
                if (invocation) {
                  invocation.state = "result";
                  invocation.result = formattedResult;
                  setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
                }
              } catch (error) {
                console.error(`[WEB-APP-CHAT] search_sdk_docs error:`, error);
                const errorResult = { found: false, error: `Failed to search SDK docs: ${error}` };
                toolResults.push({
                  id: toolCall.id || `${Date.now()}-${toolName}`,
                  name: toolName,
                  result: errorResult,
                });

                const invocation = previousMessage.toolInvocations?.find(
                  (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
                );
                if (invocation) {
                  invocation.state = "result";
                  invocation.result = errorResult;
                  setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
                }
              }
              continue;
            }

            // Inject settings from localStorage into tool arguments (matches useWorkflow.ts logic)
            const injectedToolArgs = { ...(toolArgs || {}) };

            // Check if this is a MODIFYING workflow tool and user can't edit
            const isModifyingWorkflowTool =
              toolName?.startsWith("add_workflow") ||
              toolName?.startsWith("update_workflow") ||
              toolName?.startsWith("remove_workflow") ||
              toolName?.startsWith("reorder_workflow");

            if (isModifyingWorkflowTool && options?.currentWorkflow && options?.canEditWorkflow) {
              const canEdit = options.canEditWorkflow(options.currentWorkflow);

              if (!canEdit) {
                console.log(`[WEB-APP-CHAT] User cannot edit workflow, checking autoclone...`);

                // Check if it's a public workflow - offer to clone
                if (
                  options.currentWorkflow.isPublic &&
                  options.requestAutocloneConfirmation &&
                  options.currentWorkflow.id &&
                  options.currentWorkflow.name
                ) {
                  console.log(`[WEB-APP-CHAT] Workflow is public, showing autoclone dialog...`);

                  // Show confirmation dialog and wait for user response
                  const confirmed = await options.requestAutocloneConfirmation(
                    options.currentWorkflow.id,
                    options.currentWorkflow.name
                  );

                  if (confirmed) {
                    // User confirmed clone - the dialog handler will clone and go back to list
                    // We need to abort this tool execution since we're leaving the workflow
                    console.log(`[WEB-APP-CHAT] User confirmed autoclone, aborting tool execution`);

                    // Add error result for this tool so AI knows what happened
                    toolResults.push({
                      id: toolCall.id || `${Date.now()}-${toolName}`,
                      name: toolName,
                      result: {
                        error:
                          "Workflow cloned successfully. The user has returned to the workflow list and will need to re-select the cloned workflow to continue editing.",
                        cloned: true,
                      },
                    });

                    // Break out of tool loop - we're done
                    break;
                  } else {
                    // User cancelled - add error result and continue
                    console.log(`[WEB-APP-CHAT] User cancelled autoclone`);

                    toolResults.push({
                      id: toolCall.id || `${Date.now()}-${toolName}`,
                      name: toolName,
                      result: {
                        error:
                          "Edit cancelled - this is a read-only public workflow. The user declined to create a copy. You cannot modify this workflow.",
                        permission_denied: true,
                      },
                    });

                    // Continue to next tool (skip this one)
                    continue;
                  }
                } else {
                  // Not public or missing autoclone handler - just deny
                  console.log(
                    `[WEB-APP-CHAT] Permission denied for workflow edit (not public or no autoclone handler)`
                  );

                  toolResults.push({
                    id: toolCall.id || `${Date.now()}-${toolName}`,
                    name: toolName,
                    result: {
                      error: "Permission denied - you do not have access to edit this workflow.",
                      permission_denied: true,
                    },
                  });

                  // Continue to next tool (skip this one)
                  continue;
                }
              }
            }

            // Inject include_logs: true for run_command (always enabled for debugging)
            if (toolName === "run_command") {
              injectedToolArgs.include_logs = true;
              console.log(`[WEB-APP-CHAT] Injected include_logs=true for run_command`);
            }

            // Conditionally inject include_logs for execute_browser_script based on global localStorage setting
            if (toolName === "execute_browser_script") {
              const savedBrowserScriptLogs = localStorage.getItem("disable_browser_script_logs");
              const disableBrowserScriptLogs =
                savedBrowserScriptLogs === null ? true : savedBrowserScriptLogs === "true";
              injectedToolArgs.include_logs = !disableBrowserScriptLogs;
              console.log(
                `[WEB-APP-CHAT] execute_browser_script: disable_browser_script_logs=${disableBrowserScriptLogs}, include_logs=${!disableBrowserScriptLogs}`
              );
            }

            // Inject window management flags for tools with 'process' argument (matches server.rs logic)
            if (injectedToolArgs.process) {
              console.log(`[WEB-APP-CHAT] Process parameter detected: ${injectedToolArgs.process}`);

              // Read all localStorage values
              const disableWindowManagement = localStorage.getItem("disable_window_management");
              const disableBringToFront = localStorage.getItem("disable_bring_to_front");
              const disableMaximizeTarget = localStorage.getItem("disable_maximize_target");
              const disableMinimizeAlwaysOnTop = localStorage.getItem("disable_minimize_always_on_top");

              console.log(`[WEB-APP-CHAT] Raw localStorage values:`, {
                disable_window_management: disableWindowManagement,
                disable_bring_to_front: disableBringToFront,
                disable_maximize_target: disableMaximizeTarget,
                disable_minimize_always_on_top: disableMinimizeAlwaysOnTop,
              });

              // Convert to boolean and inject
              injectedToolArgs.enable_window_management = disableWindowManagement !== "true";
              injectedToolArgs.bring_to_front = disableBringToFront !== "true";
              // Default to false (disabled) - only enable if user explicitly set disable_maximize_target to "false"
              injectedToolArgs.maximize_target = disableMaximizeTarget === "false";
              // Default to false (disabled) - only enable if user explicitly set disable_minimize_always_on_top to "false"
              injectedToolArgs.minimize_always_on_top = disableMinimizeAlwaysOnTop === "false";

              console.log(`[WEB-APP-CHAT] Injected window management settings:`, {
                enable_window_management: injectedToolArgs.enable_window_management,
                bring_to_front: injectedToolArgs.bring_to_front,
                maximize_target: injectedToolArgs.maximize_target,
                minimize_always_on_top: injectedToolArgs.minimize_always_on_top,
              });
            }

            // Inject working_directory for file tools (terminator MCP agent)
            const fileTools = ["read_file", "write_file", "edit_file", "copy_content", "glob_files", "grep_files"];
            if (fileTools.includes(toolName) && options?.localPath) {
              injectedToolArgs.working_directory = options.localPath;
              console.log(`[WEB-APP-CHAT] Injected working_directory for ${toolName}:`, options.localPath);
            }

            // Auto-inject workflow URL for execute_sequence when not provided AND no inline steps
            const hasInlineSteps = Array.isArray(injectedToolArgs.steps) && injectedToolArgs.steps.length > 0;
            if (toolName === "execute_sequence" && options?.localPath && !injectedToolArgs.url && !hasInlineSteps) {
              // Construct proper file:// URL pointing to src/terminator.ts
              const workflowUrl = `file:///${options.localPath.replace(/\\/g, "/")}/src/terminator.ts`;
              injectedToolArgs.url = workflowUrl;
              console.log(`[WEB-APP-CHAT] Auto-injected workflow URL for execute_sequence:`, workflowUrl);
            } else if (toolName === "execute_sequence" && hasInlineSteps) {
              console.log(
                `[WEB-APP-CHAT] execute_sequence has ${injectedToolArgs.steps.length} inline steps, skipping URL injection`
              );
            }

            // Workflow tools are handled server-side, should not reach here
            // but keep for backward compatibility if needed
            const isWorkflowTool =
              toolName?.startsWith("add_workflow") ||
              toolName?.startsWith("update_workflow") ||
              toolName?.startsWith("remove_workflow") ||
              toolName?.startsWith("delete_workflow") ||
              toolName?.startsWith("get_workflow") ||
              toolName?.startsWith("reorder_workflow");

            if (isWorkflowTool) {
              console.warn(`[WEB-APP-CHAT] Workflow tool ${toolName} should be handled server-side`);
              // Skip workflow tools - they're handled on the server
              continue;
            }

            // File tools (read_file, write_file, etc.) are now handled by terminator MCP agent
            // and will flow through the MCP tool execution path below

            // Check if app minimization is disabled
            const savedAppMinimizationMcp = localStorage.getItem("disable_app_minimization");
            const disableAppMinimizationMcp =
              savedAppMinimizationMcp === null ? true : savedAppMinimizationMcp === "true";

            if (!disableAppMinimizationMcp) {
              // Minimize window and show thinking bar before executing MCP tool
              try {
                const currentWindow = getCurrentWindow();
                await currentWindow.minimize();
                console.log(`🪟 Window minimized - executing MCP tool: ${toolName}`);
              } catch (minimizeError) {
                console.warn("⚠️ Could not minimize window:", minimizeError);
              }

              // Show AI thinking bar while executing MCP tool
              try {
                await invoke("show_ai_thinking_bar");
                console.log("✅ AI thinking bar shown");

                // Emit tool execution state
                await emit("ai-thinking-update", {
                  userMessage: messageText,
                  currentTool: toolName,
                  toolIndex: response.toolCalls.indexOf(toolCall),
                  totalTools: response.toolCalls.length,
                });
              } catch (barError) {
                console.warn("⚠️ Could not show AI thinking bar:", barError);
              }
            } else {
              console.log("🔍 App minimization disabled - keeping main window visible during MCP tool execution");
            }

            // Mark file for diff highlighting when edit tool detected
            // File watcher will trigger diff with correct before/after content when change is detected
            const isFileEditTool = toolName === "edit_file" || toolName === "write_file";
            if (isFileEditTool && injectedToolArgs.path) {
              console.log(`📝 [WEB-APP-CHAT] Gemini edit tool: marking ${injectedToolArgs.path} for diff`);
              options?.markPendingAIEdit?.(injectedToolArgs.path);
            }

            // Block tools in Ask/Recorder/X mode (client-side enforcement for Vertex AI)
            const blockedTools =
              effectiveMode === "ask"
                ? askModeBlockedTools
                : effectiveMode === "recorder"
                  ? RECORDER_MODE_BLOCKED_TOOLS
                  : effectiveMode === "x"
                    ? X_MODE_BLOCKED_TOOLS
                    : [];
            if (blockedTools.includes(toolName)) {
              console.log(`[WEB-APP-CHAT] Blocked tool '${toolName}' in ${effectiveMode} mode`);

              const errorResult = {
                error: `Tool '${toolName}' is blocked in ${effectiveMode} mode. Switch to Act mode to execute this action.`,
                blocked: true,
                mode: effectiveMode,
              };

              toolResults.push({
                id: toolCall.id || `${Date.now()}-${toolName}`,
                name: toolName,
                result: errorResult,
              });

              // Update invocation state to show blocked
              const invocation = previousMessage.toolInvocations?.find(
                (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
              );
              if (invocation) {
                invocation.state = "result";
                invocation.result = errorResult;
                setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
              }
              continue;
            }

            try {
              // Execute MCP tool only (workflow tools handled server-side)
              // 5 minute timeout (300000ms) to match UI play button timeouts
              // Max timeout for ask_user - user can take as long as needed to respond
              // Note: MCP SDK defaults to 60s if undefined, so use max 32-bit value (~24.8 days)
              const toolTimeout = toolName === "ask_user" ? 2147483647 : 300000;
              const toolStartTime = Date.now();

              // Ensure MCP is connected (handles reconnection after STOP button)
              const port = mcpState.serverInfo?.port || 8080;
              await mcpClient.connect(port);

              const result = await mcpClient.callTool(toolName, injectedToolArgs, signal, undefined, toolTimeout);
              const toolElapsedMs = Date.now() - toolStartTime;
              console.log(`[WEB-APP-CHAT] Tool ${toolName} executed successfully (${toolElapsedMs}ms)`);
              // DEBUG: Log raw MCP result
              console.log(`[DEBUG-MCP-RESULT] ${toolName}:`, {
                contentTypes: result?.content?.map?.((c: any) => c?.type),
                hasImages: result?.content?.some?.((c: any) => c?.type === "image"),
              });

              // Mark that tools have been executed - prevents destructive retry on 429
              toolsExecutedRef.current = true;

              // Parse structured MCP responses to extract actual tool output
              // MCP client now returns: { content: [...], isError: boolean }
              // We need to extract and parse the inner JSON for proper backend handling
              let toolOutput = result;

              // Capture isError flag before content extraction (edit_file returns isError:true on failures)
              const mcpIsError = result?.isError === true;
              if (mcpIsError) {
                console.log(`[WEB-APP-CHAT] Tool ${toolName} returned isError:true from MCP`);
              }

              // Get the actual content array from MCP response
              const contentArray = result?.content || result;

              // Check if result is a plain array with MCP content format
              // MCP returns content as array: [{type: "text", text: "..."}, {type: "image", data: "base64...", mimeType: "image/png"}]
              if (Array.isArray(contentArray) && contentArray.length > 0) {
                // Extract text content
                const textContent = contentArray.find((item: any) => item?.type === "text");
                // Extract image content (screenshots from run_command/execute_sequence)
                const imageContents = contentArray.filter((item: any) => item?.type === "image");

                if (textContent?.text) {
                  // Try to parse text as JSON for structured data
                  try {
                    toolOutput = JSON.parse(textContent.text);
                    console.log(`[WEB-APP-CHAT] Parsed JSON tool output for ${toolName} (array format)`);
                  } catch {
                    // Not JSON - use plain text
                    toolOutput = { content: textContent.text };
                    console.log(`[WEB-APP-CHAT] Wrapped text tool output for ${toolName} (array format)`);
                  }
                } else {
                  toolOutput = { content: "" };
                }

                // Attach images to output for AI to see (will be sent as inlineData parts)
                if (imageContents.length > 0) {
                  toolOutput._images = imageContents.map((img: any) => ({
                    data: img.data,
                    mimeType: img.mimeType || "image/png",
                  }));
                  console.log(
                    `[WEB-APP-CHAT] Extracted ${imageContents.length} images from tool response for ${toolName}`
                  );
                }
              } else if (result && typeof result === "object" && result.content && Array.isArray(result.content)) {
                // Extract text from content array (object format)
                const textContent = result.content.find((item: any) => item?.type === "text");
                const imageContents = result.content.filter((item: any) => item?.type === "image");

                if (textContent?.text) {
                  // Try to parse as JSON for structured data
                  try {
                    toolOutput = JSON.parse(textContent.text);
                    console.log(`[WEB-APP-CHAT] Parsed JSON tool output for ${toolName} (object format)`);
                  } catch {
                    // Not JSON - wrap plain text in object for Vertex AI compatibility
                    // Vertex AI requires function responses to be objects, not strings
                    toolOutput = { content: textContent.text };
                    console.log(`[WEB-APP-CHAT] Wrapped text tool output for ${toolName} (object format)`);
                  }
                } else {
                  toolOutput = { content: JSON.stringify(result.content) };
                }

                // Attach images to output for AI to see
                if (imageContents.length > 0) {
                  toolOutput._images = imageContents.map((img: any) => ({
                    data: img.data,
                    mimeType: img.mimeType || "image/png",
                  }));
                  console.log(
                    `[WEB-APP-CHAT] Extracted ${imageContents.length} images from tool response for ${toolName}`
                  );
                }
              } else if (typeof toolOutput === "string") {
                // Ensure all string results are wrapped in objects
                toolOutput = { content: toolOutput };
              }

              // Update tool invocation with result in previous message (which has the tool calls)
              // Match by toolCallId to handle multiple tools with same name called in parallel
              const invocation = previousMessage.toolInvocations.find(
                (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
              );
              // Propagate isError to toolOutput so AI model knows the tool failed
              if (mcpIsError) {
                toolOutput.isError = true;
              }

              if (invocation) {
                // Use mcpIsError captured before content extraction (not toolOutput.isError which gets lost)
                invocation.state = mcpIsError ? "error" : "result";
                invocation.result = toolOutput;
                invocation.elapsedMs = toolElapsedMs;

                // Update the previous message in the UI to show tool results
                setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
              }

              toolResults.push({ id: toolCall.id, name: toolName, result: toolOutput });

              // Handle ask_user response for mode switch to Act mode
              // Works for both recorder->act and ask->act transitions
              // Tool name can be "ask_user" (direct) or "mcp__terminator__ask_user" (via MCP)
              if (
                (toolName === "ask_user" || toolName === "mcp__terminator__ask_user") &&
                (effectiveMode === "recorder" || effectiveMode === "ask")
              ) {
                // Handle both response formats:
                // - New format: { action: "accept", content: { answer: "..." } }
                // - Old format: { status: "answered", answer: "..." }
                const answer = (toolOutput?.content?.answer || toolOutput?.answer || "").toLowerCase();
                const isAnswered = toolOutput?.action === "accept" || toolOutput?.status === "answered";
                if (isAnswered && (answer.includes("yes") || answer.includes("act") || answer.includes("test"))) {
                  console.log(`[WEB-APP-CHAT] User confirmed switch to Act mode via ask_user (was: ${effectiveMode})`);

                  // Update React state for UI
                  setMode("act");

                  // IMMEDIATE EFFECT: Update local variable so subsequent tools in this batch aren't blocked
                  // (Gemini path uses client-side tool blocking at lines 2106-2138)
                  effectiveMode = "act";

                  // Note: MCP server (terminator) handles mode switch internally in ask_user handler
                  // so we don't need to call invoke("set_terminator_mode") here
                }
              }

              // STEP POOL: Add AI-initiated MCP tool executions to step pool for user review
              // Fire-and-forget - don't block chat flow on pool ingestion
              if (shouldCaptureToolToWorkflow(toolName)) {
                // Normalize arguments: extract selector from result for index-based clicks
                const normalizedArgs = normalizeClickElementArguments(toolName, injectedToolArgs, toolOutput);
                const stepName = generateStepName({ tool_name: toolName, arguments: normalizedArgs });
                console.log(`[STEP-POOL] Adding AI-executed tool ${toolName} to step pool as "${stepName}"`);

                // Add to step pool via Tauri command (fire-and-forget)
                invoke("add_to_pool", {
                  toolName: toolName,
                  arguments: normalizedArgs,
                  result: toolOutput,
                  error: null,
                  durationMs: 0, // Duration tracking can be added if needed
                  workflowName: options?.focusedWorkflowName || null,
                  workflowId: options?.workflowId ? Number(options.workflowId) : null,
                  stepId: crypto.randomUUID(),
                  stepName: stepName,
                  sessionId: currentSessionId || null, // Use AI chat session ID
                  authToken: authToken || null,
                  userId: null, // Will be inferred from auth token
                })
                  .then(() => {
                    // Emit event to notify step pool UI to refresh
                    window.dispatchEvent(
                      new CustomEvent("step-pool-updated", {
                        detail: {
                          workflowId: options?.workflowId ? Number(options.workflowId) : null,
                          toolName,
                          source: "ai-execution",
                        },
                      })
                    );
                  })
                  .catch(err => {
                    // Log but don't throw - pool ingestion failures shouldn't break chat
                    console.warn(`[STEP-POOL] Failed to add tool to pool:`, err);
                  });
              }

              // Trigger workflow reload
              if (isWorkflowTool && options?.onWorkflowChanged) {
                console.log("[WEB-APP-CHAT] Workflow editing tool executed, triggering reload");
                setTimeout(() => {
                  options.onWorkflowChanged?.();
                }, 100);
              }
            } catch (err) {
              console.error(`[WEB-APP-CHAT] Tool ${toolName} execution failed:`, err);
              const error = err as Error;

              // Update tool invocation with error state in previous message (which has the tool calls)
              // Match by toolCallId to handle multiple tools with same name called in parallel
              const invocation = previousMessage.toolInvocations.find(
                (inv: any) => inv.toolCallId === toolCall.id || (inv.toolName === toolName && inv.state === "call")
              );
              if (invocation) {
                invocation.state = "error";
                // Set result with error info - required for history building (functionResponse needs response field)
                invocation.result = {
                  error: true,
                  message: error.message,
                  type: "tool_execution_error",
                };
                invocation.error = {
                  message: error.message,
                  type: "tool_execution_error",
                };

                // Update the previous message in the UI to show tool errors
                setMessages(prev => prev.map(m => (m.id === previousMessage.id ? { ...previousMessage } : m)));
              }

              // Add structured error result for backend
              toolResults.push({
                id: toolCall.id,
                name: toolName,
                result: {
                  error: true,
                  message: error.message,
                  toolName: toolName,
                  type: "tool_execution_error",
                },
              });

              // STEP POOL: Add failed AI-initiated MCP tool to step pool for debugging
              if (shouldCaptureToolToWorkflow(toolName)) {
                const stepName = generateStepName({ tool_name: toolName, arguments: injectedToolArgs });
                console.log(`[STEP-POOL] Adding failed AI-executed tool ${toolName} to step pool as "${stepName}"`);

                invoke("add_to_pool", {
                  toolName: toolName,
                  arguments: injectedToolArgs,
                  result: null,
                  error: { message: error.message, type: "tool_execution_error" },
                  durationMs: 0,
                  workflowName: options?.focusedWorkflowName || null,
                  workflowId: options?.workflowId ? Number(options.workflowId) : null,
                  stepId: crypto.randomUUID(),
                  stepName: stepName,
                  sessionId: currentSessionId || null,
                  authToken: authToken || null,
                  userId: null,
                })
                  .then(() => {
                    // Emit event to notify step pool UI to refresh
                    window.dispatchEvent(
                      new CustomEvent("step-pool-updated", {
                        detail: {
                          workflowId: options?.workflowId ? Number(options.workflowId) : null,
                          toolName,
                          source: "ai-execution-error",
                        },
                      })
                    );
                  })
                  .catch(err => {
                    console.warn(`[STEP-POOL] Failed to add error tool to pool:`, err);
                  });
              }

              console.log(`[WEB-APP-CHAT] Tool ${toolName} error handled, continuing with other tools`);
            } finally {
              // Close AI thinking bar
              const savedAppMinimizationMcpRestore = localStorage.getItem("disable_app_minimization");
              const disableAppMinimizationMcpRestore =
                savedAppMinimizationMcpRestore === null ? true : savedAppMinimizationMcpRestore === "true";
              if (!disableAppMinimizationMcpRestore) {
                try {
                  await invoke("close_ai_thinking_bar");
                  console.log("✅ AI thinking bar closed");
                } catch (barError) {
                  console.warn("⚠️ Could not close AI thinking bar:", barError);
                }
              }

              // REMOVED: Window restoration after each tool execution
              // This was causing focus interruption during multi-tool AI execution.
              // The window will be restored once at the end via the safety net (lines 842-853)
              // which runs in the outer finally block when the entire AI stream completes.
            }
          }

          // Send tool results to server for next turn
          // Filter out SUCCESSFUL render_component results - they don't need server processing
          // But include FAILED render_component results so AI can self-correct
          console.log(
            `[WEB-APP-CHAT] Turn ${turnCount}: toolResults before filter:`,
            toolResults.map(tr => ({
              name: tr.name,
              success: tr.result?.success,
            }))
          );
          const realToolResults = toolResults.filter(
            tr => tr.name !== "render_component" || (tr.result && !tr.result.success)
          );
          console.log(`[WEB-APP-CHAT] Turn ${turnCount}: realToolResults after filter: ${realToolResults.length}`);

          // If only UI action tools, skip the tool results turn
          if (realToolResults.length === 0 || !intermediateMessage) {
            console.log(`[WEB-APP-CHAT] Turn ${turnCount}: Only UI action tools, skipping tool results turn`);
            // Clear any remaining tool calls since we're not continuing
            response.toolCalls = [];
            continue;
          }

          console.log(`[WEB-APP-CHAT] Turn ${turnCount}: Sending ${realToolResults.length} tool result(s) to server`);

          // Update intermediate message to show waiting for AI response
          intermediateMessage.content = "Waiting for AI response...";
          setMessages(prev => prev.map(m => (m.id === intermediateMessage.id ? { ...intermediateMessage } : m)));

          // Build request for Rust backend
          // Update accumulated history with this turn's tool calls and results
          // Use rawParts if available (includes thought_signature for Gemini 3)
          // Otherwise fall back to reconstructing from toolCalls
          if (response.rawParts) {
            accumulatedHistory.push({
              role: "model" as const,
              parts: response.rawParts,
            });
          } else {
            accumulatedHistory.push({
              role: "model" as const,
              parts: response.toolCalls.map(tc => ({
                functionCall: { name: tc.name, args: tc.args },
              })),
            });
          }

          // Add tool results as function responses
          // Extract _images from results and convert to inlineData parts for Gemini vision
          const toolResultParts: any[] = [];
          for (const tr of realToolResults) {
            // Add function response (without _images in the response to keep it clean)
            // Ensure result is never undefined (Rust VertexFunctionResponse requires response field)
            const result = tr.result ?? { error: true, message: "No result" };
            const resultWithoutImages = { ...result };
            delete resultWithoutImages._images;
            toolResultParts.push({
              functionResponse: { name: tr.name, response: resultWithoutImages },
            });

            // Add images as inlineData parts (Gemini multimodal format)
            if (result._images && Array.isArray(result._images)) {
              for (const img of result._images) {
                toolResultParts.push({
                  inlineData: {
                    mimeType: img.mimeType || "image/png",
                    data: img.data,
                  },
                });
              }
              console.log(`[WEB-APP-CHAT] Added ${result._images.length} screenshot(s) from ${tr.name} to AI context`);
            }
          }

          accumulatedHistory.push({
            role: "user" as const,
            parts: toolResultParts,
          });

          const toolResultRequest: VertexRequest = {
            model: selectedModel,
            history: accumulatedHistory,
            system: systemPrompt || undefined,
            tools: tools.length > 0 ? tools : undefined,
            thinkingLevel: selectedModel === "gemini-3-pro-preview" ? thinkingLevel : undefined,
            mode: effectiveMode,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 8192,
            },
          };

          // Call streaming API with toolResults - with 429 retry logic
          // This is critical: if we get rate limited here (Turn 2+), we must NOT restart
          // the entire conversation as tools have already executed
          const maxToolResultRetries = 3;
          let toolResultRetryCount = 0;
          let toolResultStreamSuccess = false;

          while (!toolResultStreamSuccess && toolResultRetryCount < maxToolResultRetries) {
            try {
              const toolResultStream = callVertexAIStreamRust(toolResultRequest, signal);

              // Reset response for this turn (only on first attempt or after rate limit)
              if (toolResultRetryCount === 0) {
                response = { text: "", toolCalls: [] };
              }

              // Process stream events for tool result turn
              for await (const event of toolResultStream) {
                if (shouldStopRef.current) {
                  console.log("🛑 [WEB-APP-CHAT] Stop flag detected during tool result stream");
                  break;
                }

                switch (event.type) {
                  case "text":
                    response.text += event.content;
                    intermediateMessage.content = response.text;
                    setMessages(prev =>
                      prev.map(m => (m.id === intermediateMessage.id ? { ...intermediateMessage } : m))
                    );
                    break;

                  case "server_tool_start":
                    console.log(`🔧 [WEB-APP-CHAT] Server tool starting: ${event.name}`);
                    intermediateMessage.toolInvocations.push({
                      toolCallId: `server-${Date.now()}-${event.name}`,
                      toolName: event.name,
                      args: event.args,
                      state: "running",
                      source: "server",
                    });
                    setMessages(prev =>
                      prev.map(m => (m.id === intermediateMessage.id ? { ...intermediateMessage } : m))
                    );
                    break;

                  case "server_tool_complete": {
                    console.log(`✅ [WEB-APP-CHAT] Server tool complete: ${event.name} (${event.elapsedMs}ms)`);
                    const serverToolInv = intermediateMessage.toolInvocations.find(
                      (inv: any) => inv.toolName === event.name && inv.state === "running" && inv.source === "server"
                    );
                    if (serverToolInv) {
                      serverToolInv.state = event.error ? "error" : "result";
                      serverToolInv.result = event.result;
                      serverToolInv.elapsedMs = event.elapsedMs;
                      if (event.error) serverToolInv.error = event.error;
                    }
                    setMessages(prev =>
                      prev.map(m => (m.id === intermediateMessage.id ? { ...intermediateMessage } : m))
                    );
                    break;
                  }

                  case "client_tools":
                  case "tool_calls": // Rust backend emits tool_calls instead of client_tools
                    console.log(
                      `🔧 [WEB-APP-CHAT] ${event.type} received: ${event.toolCalls.length}`,
                      event.toolCalls.map(tc => tc.name)
                    );
                    response.toolCalls = event.toolCalls.map(tc => ({
                      name: tc.name,
                      args: tc.args,
                      id: (tc as any).id,
                    }));
                    // Capture raw parts for Gemini 3 thought_signature support
                    if ((event as any).rawParts) {
                      response.rawParts = (event as any).rawParts;
                      console.log(`🔧 [WEB-APP-CHAT] Captured rawParts for thought_signature (turn ${turnCount})`);
                    }
                    event.toolCalls.forEach(tc => {
                      intermediateMessage.toolInvocations.push({
                        toolCallId: (tc as any).id || `${Date.now()}-${tc.name}`,
                        toolName: tc.name,
                        args: tc.args,
                        state: "call",
                        source: "client",
                      });
                    });
                    setMessages(prev =>
                      prev.map(m => (m.id === intermediateMessage.id ? { ...intermediateMessage } : m))
                    );
                    break;

                  case "done":
                    console.log(`✅ [WEB-APP-CHAT] Turn ${turnCount} stream done: finishReason=${event.finishReason}`);
                    response.sessionId = event.sessionId;
                    response.finishReason = event.finishReason;
                    response.workflowData = event.workflowData;
                    response.metrics = event.metrics;
                    // Update context metrics for UI display
                    // Handle both web app format (metrics.tokens) and Rust format (usage)
                    if (event.metrics?.tokens) {
                      setContextMetrics({
                        promptTokens: event.metrics.tokens.promptTokenCount || 0,
                        responseTokens: event.metrics.tokens.candidatesTokenCount || 0,
                        totalTokens: event.metrics.tokens.totalTokenCount || 0,
                      });
                    } else if (event.usage) {
                      // Rust backend sends usage directly (snake_case from Rust)
                      setContextMetrics({
                        promptTokens: event.usage.prompt_token_count || event.usage.promptTokenCount || 0,
                        responseTokens: event.usage.candidates_token_count || event.usage.candidatesTokenCount || 0,
                        totalTokens: event.usage.total_token_count || event.usage.totalTokenCount || 0,
                      });
                    }
                    break;

                  case "error":
                    console.error(`❌ [WEB-APP-CHAT] Turn ${turnCount} stream error:`, event.error);
                    throw new Error(event.error);
                }
              }

              // Stream completed successfully
              toolResultStreamSuccess = true;
            } catch (streamErr) {
              const streamError = streamErr as Error;

              // Check if this is a 429 rate limit error
              const isRateLimitError =
                streamError.message.includes("429") ||
                streamError.message.toLowerCase().includes("resource exhausted") ||
                streamError.message.toLowerCase().includes("too many requests");

              if (isRateLimitError && toolResultRetryCount < maxToolResultRetries - 1) {
                toolResultRetryCount++;
                const retryDelaySeconds = 5 * toolResultRetryCount; // Exponential backoff: 5s, 10s, 15s

                console.warn(
                  `⏳ [WEB-APP-CHAT] Turn ${turnCount} rate limited (429), retrying in ${retryDelaySeconds}s... (attempt ${toolResultRetryCount}/${maxToolResultRetries})`
                );

                // Update loading status to rate limited
                setLoadingStatus(prev =>
                  prev
                    ? {
                        ...prev,
                        phase: "rate_limited",
                        detail: `Rate limited - retrying in ${retryDelaySeconds}s...`,
                      }
                    : null
                );

                // Show rate limit message in UI
                const rateLimitMsgId = (Date.now() + 2).toString();
                const rateLimitMessage = {
                  id: rateLimitMsgId,
                  role: "assistant",
                  content: "",
                  error: {
                    message: `Rate limited - retrying in ${retryDelaySeconds} seconds... (attempt ${toolResultRetryCount}/${maxToolResultRetries})`,
                    type: "rate_limited",
                    canRetry: false,
                    isAutoRetrying: true,
                    retryCountdown: retryDelaySeconds,
                  },
                  timestamp: new Date(),
                  isError: true,
                };

                setMessages(prev => [...prev, rateLimitMessage]);

                // Countdown timer - update message every second
                for (let i = retryDelaySeconds - 1; i > 0; i--) {
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  if (shouldStopRef.current) {
                    console.log("🛑 [WEB-APP-CHAT] Tool result retry cancelled by user during countdown");
                    setMessages(prev => prev.filter(m => m.id !== rateLimitMsgId));
                    throw new Error("User cancelled retry");
                  }
                  setMessages(prev =>
                    prev.map(m =>
                      m.id === rateLimitMsgId
                        ? {
                            ...m,
                            error: {
                              ...m.error,
                              message: `Rate limited - retrying in ${i} seconds... (attempt ${toolResultRetryCount}/${maxToolResultRetries})`,
                              retryCountdown: i,
                            },
                          }
                        : m
                    )
                  );
                }

                // Final wait
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Remove the rate limit message before retry
                setMessages(prev => prev.filter(m => m.id !== rateLimitMsgId));

                if (shouldStopRef.current) {
                  throw new Error("User cancelled retry");
                }

                console.log(`🔄 [WEB-APP-CHAT] Turn ${turnCount}: Retrying tool result submission...`);
                // Loop continues to retry
              } else {
                // Not a rate limit error or max retries reached - re-throw
                throw streamError;
              }
            }
          }

          console.log(
            `🔄 [WEB-APP-CHAT] Turn ${turnCount}: Sent system prompt (${systemPrompt?.length || 0} chars) - Gemini is stateless`
          );
          console.log(
            `[WEB-APP-CHAT] Turn ${turnCount}: text=${response.text?.length || 0} chars, toolCalls=${response.toolCalls?.length || 0}, finishReason=${response.finishReason}`
          );

          // Update intermediate message streaming state
          intermediateMessage.isStreaming = response.toolCalls && response.toolCalls.length > 0;
          setMessages(prev => prev.map(m => (m.id === intermediateMessage.id ? { ...intermediateMessage } : m)));

          // Loop will continue if there are more tool calls
        }

        if (turnCount >= maxTurns) {
          console.warn("[WEB-APP-CHAT] Reached maximum turn count");
        }

        // Check for malformed function call - show error with retry button
        if (response.finishReason === "malformed_function_call") {
          console.warn("⚠️ [WEB-APP-CHAT] Malformed function call detected - showing retry option");

          // Mark any streaming messages as complete
          if (assistantMessages.length > 0) {
            const lastMessage = assistantMessages[assistantMessages.length - 1];
            lastMessage.isStreaming = false;
            setMessages(prev => prev.map(m => (m.id === lastMessage.id ? { ...lastMessage } : m)));
          }

          // Show error message with retry button
          const errorMessage = {
            id: `${Date.now()}-malformed-error`,
            role: "assistant",
            content: "",
            error: {
              message: "The AI generated an invalid response. This is a temporary issue with the model.",
              type: "malformed_function_call",
              canRetry: true,
              originalMessage: messageText,
            },
            timestamp: new Date(),
            isError: true,
          };
          setMessages(prev => [...prev, errorMessage]);

          // Don't throw - just end the conversation with the error shown
          return;
        }

        // Mark all messages as complete
        if (assistantMessages.length > 0) {
          const lastMessage = assistantMessages[assistantMessages.length - 1];
          lastMessage.isStreaming = false;
          setMessages(prev => prev.map(m => (m.id === lastMessage.id ? { ...lastMessage } : m)));
        }

        // Check if workflow was modified server-side (TypeScript workflows reload from disk)
        if (response.workflowData && options?.onWorkflowChanged) {
          console.log("[WEB-APP-CHAT] Workflow was updated server-side, triggering reload");
          options.onWorkflowChanged();
        }

        console.log(`[WEB-APP-CHAT] Conversation completed in ${turnCount} turns`);
      } catch (err) {
        console.error("[WEB-APP-CHAT] Error:", err);
        const error = err as Error;

        // Check if this was an abort (user clicked stop)
        if (error.name === "AbortError" || shouldStopRef.current) {
          console.log("🛑 [WEB-APP-CHAT] Request aborted by user - marking running tools as cancelled");
          // Check if user wants to see the cancelled message
          const showCancelledMessage = localStorage.getItem("show_stop_cancelled_message") !== "false";
          // Mark any running tool invocations as cancelled so UI stops showing spinner
          setMessages(prev =>
            prev.map(m => {
              if (m.toolInvocations?.some((inv: any) => inv.state === "running")) {
                return {
                  ...m,
                  toolInvocations: m.toolInvocations.map((inv: any) =>
                    inv.state === "running"
                      ? showCancelledMessage
                        ? { ...inv, state: "error", error: { message: "Cancelled by user" } }
                        : { ...inv, state: "result", result: {} }
                      : inv
                  ),
                };
              }
              return m;
            })
          );
          // Don't show error message for user-initiated stops
          return;
        }

        // Check if error is rate limiting (429)
        const isRateLimitError =
          error.message.includes("429") ||
          error.message.toLowerCase().includes("resource exhausted") ||
          error.message.toLowerCase().includes("too many requests");

        if (isRateLimitError) {
          // CRITICAL: If tools have already been executed, we cannot safely retry by restarting
          // the conversation - this would cause duplicate tool executions (e.g., opening Chrome twice)
          // The inner retry loop (around tool result submission) handles Turn 2+ rate limits safely.
          // If we reach here with tools executed, it means the inner retry also failed.
          if (toolsExecutedRef.current) {
            console.error(
              "❌ [WEB-APP-CHAT] Rate limited after tools executed - cannot safely retry (would cause duplicate actions)"
            );
            setError(
              new Error(
                "Rate limited after tools executed. The AI's previous actions completed, but we couldn't get its response. Please try sending a follow-up message."
              )
            );

            // Show error message to user
            const errorMessage = {
              id: (Date.now() + 2).toString(),
              role: "assistant",
              content: "",
              error: {
                message:
                  "Rate limited after tools executed. Your previous actions completed successfully, but we couldn't receive the AI's response. Please send a follow-up message to continue.",
                type: "rate_limit_after_tools",
                canRetry: true,
                originalMessage: messageText,
              },
              timestamp: new Date(),
              isError: true,
            };
            setMessages(prev => [...prev, errorMessage]);
            return;
          }

          const retryDelaySeconds = 5;
          console.warn(`⏳ [WEB-APP-CHAT] Rate limited (429), auto-retrying in ${retryDelaySeconds}s...`);

          // Update loading status to rate limited
          setLoadingStatus(prev =>
            prev
              ? {
                  ...prev,
                  phase: "rate_limited",
                  detail: `Rate limited - retrying in ${retryDelaySeconds}s...`,
                }
              : null
          );

          // Show rate limit message with countdown
          const rateLimitMsgId = (Date.now() + 2).toString();
          const rateLimitMessage = {
            id: rateLimitMsgId,
            role: "assistant",
            content: "",
            error: {
              message: `Rate limited - retrying in ${retryDelaySeconds} seconds...`,
              type: "rate_limited",
              canRetry: false,
              isAutoRetrying: true,
              retryCountdown: retryDelaySeconds,
            },
            timestamp: new Date(),
            isError: true,
          };

          setMessages(prev => [...prev, rateLimitMessage]);

          // Countdown timer - update message every second
          for (let i = retryDelaySeconds - 1; i > 0; i--) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Check if user aborted during countdown
            if (shouldStopRef.current) {
              console.log("🛑 [WEB-APP-CHAT] Retry cancelled by user during countdown");
              setMessages(prev => prev.filter(m => m.id !== rateLimitMsgId));
              return;
            }
            setMessages(prev =>
              prev.map(m =>
                m.id === rateLimitMsgId
                  ? {
                      ...m,
                      error: { ...m.error, message: `Rate limited - retrying in ${i} seconds...`, retryCountdown: i },
                    }
                  : m
              )
            );
          }

          // Final wait
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Remove the rate limit message before retry
          setMessages(prev => prev.filter(m => m.id !== rateLimitMsgId));

          // Check if user aborted during final wait
          if (shouldStopRef.current) {
            console.log("🛑 [WEB-APP-CHAT] Retry cancelled by user");
            return;
          }

          console.log("🔄 [WEB-APP-CHAT] Retrying after rate limit...");

          // Retry: Remove the last user message first (sendMessage will re-add it)
          setMessages(prev => {
            const filtered = prev.filter(m => !(m.role === "user" && m.content === messageText));
            return filtered;
          });

          // Small delay to let state settle
          await new Promise(resolve => setTimeout(resolve, 100));

          // Mark as retrying so finally block doesn't reset isLoading
          isRetryingRef.current = true;

          // Recursive retry
          return sendMessage(messageText, overrideMode);
        }

        setError(error);

        // Auto-retry for timeout errors (up to 2 times)
        const isTimeoutError = error.message.toLowerCase().includes("timeout");
        const currentRetryCount = sendOptions?.autoRetryCount ?? 0;
        const maxAutoRetries = 2;

        if (isTimeoutError && currentRetryCount < maxAutoRetries) {
          const retryNum = currentRetryCount + 1;
          console.warn(`⏳ [WEB-APP-CHAT] Timeout error, auto-retrying (${retryNum}/${maxAutoRetries})...`);

          // Update loading status (use "connecting" phase since we're reconnecting)
          setLoadingStatus(prev =>
            prev
              ? {
                  ...prev,
                  phase: "connecting",
                  detail: `Timed out - retrying (${retryNum}/${maxAutoRetries})...`,
                }
              : null
          );

          // Brief wait before retry
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Check if user aborted
          if (shouldStopRef.current) {
            console.log("🛑 [WEB-APP-CHAT] Auto-retry cancelled by user");
            return;
          }

          // Mark as retrying so finally block doesn't reset isLoading
          isRetryingRef.current = true;

          // Recursive retry with incremented count
          return sendMessage(messageText, overrideMode, {
            ...sendOptions,
            skipUserMessage: true, // Don't duplicate user message on retry
            autoRetryCount: retryNum,
          });
        }

        // Check if error is related to session expiration
        const isSessionError =
          error.message.toLowerCase().includes("session") ||
          error.message.toLowerCase().includes("not found") ||
          error.message.toLowerCase().includes("expired");

        if (isSessionError && sessionId) {
          console.warn("[WEB-APP-CHAT] Session error detected, clearing session:", error.message);
          setSessionId(null); // This will trigger localStorage cleanup via useEffect
        }

        // Check if there's a partial assistant message we can add the error to
        const lastMessage = messages[messages.length - 1];
        const hasPartialContent = lastMessage?.role === "assistant" && lastMessage?.content?.trim();

        // Build error message with retry info if applicable
        const retriesExhausted = isTimeoutError && currentRetryCount >= maxAutoRetries;
        const errorMessageText = retriesExhausted
          ? `${error.message} (after ${currentRetryCount} retries)`
          : error.message;

        if (hasPartialContent) {
          // Add error to existing message with partial content (preserves what was streamed)
          setMessages(prev =>
            prev.map(m =>
              m.id === lastMessage.id
                ? {
                    ...m,
                    isStreaming: false,
                    error: {
                      message: errorMessageText,
                      type: isSessionError ? "session_expired" : "unknown",
                      canRetry: true,
                      originalMessage: messageText,
                      partialContent: true, // Flag that this error has partial content above
                    },
                  }
                : m
            )
          );
        } else {
          // No partial content - create error message
          const errorMessage = {
            id: (Date.now() + 2).toString(),
            role: "assistant",
            content: "",
            error: {
              message: errorMessageText,
              type: isSessionError ? "session_expired" : "unknown",
              canRetry: true,
              originalMessage: messageText,
            },
            timestamp: new Date(),
            isError: true,
          };
          setMessages(prev => [...prev, errorMessage]);
        }
        options?.onError?.(error);
      } finally {
        // Skip cleanup if this call is being followed by a retry
        if (isRetryingRef.current) {
          isRetryingRef.current = false;
        } else {
          setIsLoading(false);
          isLoadingRef.current = false;
          console.log("[WEB-APP-CHAT] isLoadingRef set to FALSE - conversation ended");
          setLoadingStatus(null);

          // Cleanup cancellation refs
          abortControllerRef.current = null;
          shouldStopRef.current = false;

          // Ensure window is visible (safety net in case of errors)
          const savedAppMinimizationSafetyNet = localStorage.getItem("disable_app_minimization");
          const disableAppMinimizationSafetyNet =
            savedAppMinimizationSafetyNet === null ? true : savedAppMinimizationSafetyNet === "true";
          if (!disableAppMinimizationSafetyNet) {
            try {
              const currentWindow = getCurrentWindow();
              const isMinimized = await currentWindow.isMinimized();
              if (isMinimized) {
                await currentWindow.unminimize();
                await currentWindow.setFocus();
                console.log("🪟 App window restored (safety net)");
              }
            } catch (restoreError) {
              console.warn("⚠️ Could not check/restore window:", restoreError);
            }
          }

          // Call onStreamComplete to allow focusing input after AI finishes
          options?.onStreamComplete?.();

          // Open README.md after recorder mode conversation completes
          if (recorderWorkflowFolderRef.current) {
            console.log("[WEB-APP-CHAT] Opening README.md after recorder completion");
            options?.onOpenFile?.("README.md");
            recorderWorkflowFolderRef.current = null;
          }
        }
      }
    },
    [messages, mcpState.tools, options, mode]
  );

  const reload = useCallback(() => {
    console.log(`[WEB-APP-CHAT] reload() called - NEW CHAT`, {
      messagesCount: messages.length,
      sessionId,
      workflowId: options?.workflowId,
    });

    // Cancel any pending debounced sync
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    // Save to IndexedDB immediately (sync) before clearing
    if (sessionId && messages.length > 0) {
      const title = generateSessionTitle(messages);
      // Save messages to IndexedDB by sessionId
      saveSessionMessages(sessionId, messages);
      // Save/update session metadata
      saveSessionMetadata({
        sessionId,
        title,
        messageCount: messages.length,
        workflowId: options?.workflowId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[WEB-APP-CHAT] reload() saved to IndexedDB: ${sessionId}`);

      // Fire off cloud sync in background (non-blocking)
      saveChatSession(sessionId, messages, title)
        .then(() => console.log(`[WEB-APP-CHAT] reload() cloud sync done: ${sessionId}`))
        .catch(err => console.error("[WEB-APP-CHAT] reload() cloud sync failed:", err));
    }

    // End Claude Code ACP session in background (non-blocking)
    endClaudeCodeSession()
      .then(() => console.log(`[WEB-APP-CHAT] Claude Code ACP session ended`))
      .catch(err => console.warn("[WEB-APP-CHAT] Failed to end Claude Code session:", err));

    // Immediately clear state for fresh conversation
    setMessages([]);
    setInput("");
    setError(null);
    setIsLoading(false);
    setLoadingStatus(null);
    isLoadingRef.current = false;
    setSessionId(null);

    // CRITICAL: Clear Claude history sync flag - this is a fresh conversation
    needsClaudeHistorySyncRef.current = false;

    // Clear global session messages from localStorage
    clearGlobalSession();
    console.log(`[WEB-APP-CHAT] reload() completed - fresh conversation ready`);
  }, [options?.workflowId, options?.cloudId, sessionId, messages]);

  // NOTE: generationInProgress ref removed - async YAML suggestion generation deprecated

  const addWelcomeMessage = useCallback(
    async (workflowName?: string, _workflowYaml?: string, workflowId?: string | null) => {
      console.log("[WEB-APP-CHAT] addWelcomeMessage called:", {
        workflowName,
        workflowId,
      });
      // NOTE: _workflowYaml parameter kept for API compatibility but ignored

      // NOTE: Always show suggestions regardless of existing conversation
      // They float at bottom of chat between messages and input

      // Always use fallback suggestions for TypeScript workflows
      if (workflowName) {
        console.log("[WEB-APP-CHAT] Setting fallback suggestions for workflow");
        setSuggestionsWorkflowName(workflowName);
        setSuggestedActions(getFallbackSuggestions());
        setIsGeneratingSuggestions(false);
      } else {
        console.log("[WEB-APP-CHAT] ℹ️ No workflow name provided");
        setSuggestedActions([]);
        setSuggestionsWorkflowName("");
        setIsGeneratingSuggestions(false);
      }
    },
    [mcpState.tools, mcpState.serverInstructions]
  );

  const dismissSuggestions = useCallback(() => {
    setSuggestedActions([]);
  }, []);

  const stop = useCallback(async () => {
    const stopStartTime = Date.now();
    console.log("🛑 [STOP-DEBUG] Stop requested at", stopStartTime);
    shouldStopRef.current = true;
    setIsLoading(false);
    isLoadingRef.current = false;
    console.log("[STOP-DEBUG] isLoadingRef set to FALSE - user clicked STOP");
    setLoadingStatus(null);

    if (abortControllerRef.current) {
      console.log("🛑 [STOP-DEBUG] Aborting current request (abortControllerRef.abort())");
      abortControllerRef.current.abort();
    }

    // Cancel Claude Code if active
    if (hasActiveClaudeCodeSession()) {
      // IMPORTANT: Stop MCP tools FIRST and WAIT for completion
      // Claude Code may have already dispatched tool calls that are in-flight
      // We must await stopExecution() to ensure tools are actually stopped
      console.log("📡 [STOP-DEBUG] Sending stop_execution to MCP server (awaited)...");
      const mcpStopStart = Date.now();
      try {
        await mcpClient.stopExecution();
        console.log(`✅ [STOP-DEBUG] MCP stopExecution completed in ${Date.now() - mcpStopStart}ms`);
      } catch (e) {
        console.warn(`⚠️ [STOP-DEBUG] MCP stopExecution failed after ${Date.now() - mcpStopStart}ms:`, e);
      }

      console.log("📡 [STOP-DEBUG] Now calling cancelClaudeCode...");
      const claudeStopStart = Date.now();
      try {
        await cancelClaudeCode();
        console.log(`✅ [STOP-DEBUG] cancelClaudeCode completed in ${Date.now() - claudeStopStart}ms`);
      } catch (error) {
        console.warn(`⚠️ [STOP-DEBUG] cancelClaudeCode failed after ${Date.now() - claudeStopStart}ms:`, error);
      }
      console.log(`🛑 [STOP-DEBUG] Total stop() duration: ${Date.now() - stopStartTime}ms`);
    } else {
      console.log("[STOP-DEBUG] No active Claude Code session to cancel");
    }

    // Close AI thinking bar when stopping
    const savedAppMinimizationStop = localStorage.getItem("disable_app_minimization");
    const disableAppMinimizationStop = savedAppMinimizationStop === null ? true : savedAppMinimizationStop === "true";
    if (!disableAppMinimizationStop) {
      try {
        await invoke("close_ai_thinking_bar");
        console.log("✅ AI thinking bar closed after stop");
      } catch (error) {
        console.warn("⚠️ Could not close AI thinking bar:", error);
      }
    }
  }, []);

  // Edit a user message: update content, remove all messages after it, and resend
  const updateMessage = useCallback(
    async (messageId: string, newContent: string) => {
      if (isLoading) {
        console.warn("[WEB-APP-CHAT] Cannot edit message while loading");
        return;
      }

      const messageIndex = messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) {
        console.warn("[WEB-APP-CHAT] Message not found:", messageId);
        return;
      }

      const message = messages[messageIndex];
      if (message.role !== "user") {
        console.warn("[WEB-APP-CHAT] Can only edit user messages");
        return;
      }

      console.log("[WEB-APP-CHAT] Editing message:", messageId, "new content:", newContent);

      // Remove all messages from this one onwards (we'll resend the edited message)
      setMessages(prev => prev.slice(0, messageIndex));

      // Send the edited message
      await sendMessage(newContent);
    },
    [messages, isLoading, sendMessage]
  );

  // Regenerate an assistant message: find the preceding user message and resend it
  const regenerateMessage = useCallback(
    async (messageId: string) => {
      if (isLoading) {
        console.warn("[WEB-APP-CHAT] Cannot regenerate while loading");
        return;
      }

      const messageIndex = messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) {
        console.warn("[WEB-APP-CHAT] Message not found:", messageId);
        return;
      }

      const message = messages[messageIndex];

      // If it's an error message with originalMessage, use that
      if (message.error?.originalMessage) {
        console.log("[WEB-APP-CHAT] Regenerating from error message");
        // Find the preceding user message to keep it
        let userMessageIndex = -1;
        for (let i = messageIndex - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            userMessageIndex = i;
            break;
          }
        }
        // Remove only the error message (keep user message + everything before)
        const keepUntil = userMessageIndex !== -1 ? userMessageIndex + 1 : messageIndex;
        setMessages(prev => prev.slice(0, keepUntil));
        // Regenerate without duplicating user message
        await sendMessage(message.error.originalMessage, undefined, { skipUserMessage: true });
        return;
      }

      // For assistant messages, find the preceding user message
      if (message.role === "assistant") {
        // Find the user message that triggered this assistant response
        let userMessageIndex = -1;
        for (let i = messageIndex - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            userMessageIndex = i;
            break;
          }
        }

        if (userMessageIndex === -1) {
          console.warn("[WEB-APP-CHAT] No preceding user message found");
          return;
        }

        const userMessage = messages[userMessageIndex];
        console.log("[WEB-APP-CHAT] Regenerating response for user message:", userMessage.content);

        // Remove only messages AFTER the user message (keep user message in place)
        setMessages(prev => prev.slice(0, userMessageIndex + 1));

        // Regenerate without duplicating user message
        await sendMessage(userMessage.content, undefined, { skipUserMessage: true });
        return;
      }

      console.warn("[WEB-APP-CHAT] Cannot regenerate this message type:", message.role);
    },
    [messages, isLoading, sendMessage]
  );

  // Fork chat from a specific message: keep only messages up to and including this one
  // Creates a NEW session so the original chat history is preserved
  const forkFromMessage = useCallback(
    async (messageId: string) => {
      const messageIndex = messages.findIndex(m => m.id === messageId);
      if (messageIndex === -1) {
        console.warn("[WEB-APP-CHAT] Message not found for fork:", messageId, "in", messages.length, "messages");
        console.warn(
          "[WEB-APP-CHAT] Available message IDs:",
          messages.map(m => m.id)
        );
        return;
      }

      console.log(
        "[WEB-APP-CHAT] Forking chat from message:",
        messageId,
        "at index:",
        messageIndex,
        "of",
        messages.length
      );

      // Step 1: Save the current session first (to preserve original chat)
      if (sessionId && messages.length > 0) {
        try {
          const { saveSessionMessages, saveSessionMetadata } = await import("../lib/session-storage");
          saveSessionMessages(sessionId, messages);
          const firstUserMsg = messages.find(m => m.role === "user");
          const title = firstUserMsg?.content?.slice(0, 50) || "Chat session";
          const now = new Date().toISOString();
          saveSessionMetadata({
            sessionId,
            title,
            messageCount: messages.length,
            workflowId: options?.workflowId || null,
            createdAt: now,
            updatedAt: now,
          });
          console.log(`[WEB-APP-CHAT] Saved original session ${sessionId} before fork`);
        } catch (err) {
          console.error("[WEB-APP-CHAT] Failed to save original session before fork:", err);
        }
      }

      // Step 2: Create a new session ID for the forked conversation
      const newSessionId = `fork-${crypto.randomUUID()}`;
      console.log(`[WEB-APP-CHAT] Creating new forked session: ${newSessionId} (from ${sessionId})`);

      // Step 3: Prepare forked messages (truncated and cleaned up)
      const forkedMessages = messages.slice(0, messageIndex + 1).map(m => {
        let updated = m;

        // Mark streaming as false
        if (updated.isStreaming) {
          updated = { ...updated, isStreaming: false };
        }

        // Clean up running tool invocations in parts (Claude Code format)
        if (updated.parts?.length > 0) {
          const hasRunning = updated.parts.some(
            (part: any) => part.type === "tool" && part.invocation?.state === "running"
          );
          if (hasRunning) {
            const cleanedParts = updated.parts.map((part: any) => {
              if (part.type === "tool" && part.invocation?.state === "running") {
                return {
                  ...part,
                  invocation: { ...part.invocation, state: "result", result: { cancelled: true, message: "Forked" } },
                };
              }
              return part;
            });
            updated = { ...updated, parts: cleanedParts };
          }
        }

        // Clean up running tool invocations (Gemini format)
        if (updated.toolInvocations?.some((inv: any) => inv.state === "running")) {
          updated = {
            ...updated,
            toolInvocations: updated.toolInvocations.map((inv: any) =>
              inv.state === "running"
                ? { ...inv, state: "result", result: { cancelled: true, message: "Forked" } }
                : inv
            ),
          };
        }

        return updated;
      });

      // Step 4: Update session ID and messages
      setSessionId(newSessionId);
      setMessages(forkedMessages);

      console.log(
        `[WEB-APP-CHAT] Fork complete: new session ${newSessionId} with ${forkedMessages.length} messages (original had ${messages.length})`
      );
    },
    [messages, sessionId, options?.workflowId]
  );

  const addWorkflowExecutionMessage = useCallback(() => {
    console.warn("[WEB-APP-CHAT] addWorkflowExecutionMessage not implemented");
  }, []);

  const interruptTool = useCallback(() => {
    console.warn("[WEB-APP-CHAT] interruptTool not implemented");
  }, []);

  const isMcpAvailable = useCallback(() => {
    return mcpState.isHealthy && mcpState.tools && Object.keys(mcpState.tools).length > 0;
  }, [mcpState.isHealthy, mcpState.tools]);

  const getMcpStatusMessage = useCallback(() => {
    if (!mcpState.isHealthy) return "MCP server is not connected";
    if (!mcpState.tools) return "MCP tools not initialized";
    const toolCount = Object.keys(mcpState.tools).length;
    if (toolCount === 0) return "No MCP tools available";
    return `${toolCount} MCP tools available`;
  }, [mcpState.isHealthy, mcpState.tools]);

  // NOTE: regenerateSuggestions removed - YAML-based suggestion generation deprecated

  // NEW: Function to trigger failure analysis when workflow fails
  const triggerFailureAnalysis = useCallback(
    async (failureInfo: {
      workflowLog: any; // Complete log entry from workflowExecutionLogs (might be null)
      workflowName: string;
      workflowId?: string | null;
      executionType?: "single_step" | "full";
      stepIndex?: number;
      actualFailedStepName?: string; // The actual step name from failedSteps array
      fullExecutionResponse?: any; // Complete MCP execution response
    }) => {
      // Don't trigger if already loading
      if (isLoadingRef.current) {
        console.log("[WEB-APP-CHAT] Skipping failure analysis - already loading");
        return;
      }

      // Parse fullExecutionResponse - it may be a string containing JSON details
      // Format: "MCP error -32603: ...\nDetails: {JSON}"
      const parseResponseDetails = () => {
        const response = failureInfo.fullExecutionResponse;
        if (!response) return null;

        // If it's a string, try to extract JSON from "Details: {JSON}" format
        if (typeof response === "string") {
          const detailsMatch = response.match(/Details:\s*(\{[\s\S]*\})\s*$/);
          if (detailsMatch) {
            try {
              return JSON.parse(detailsMatch[1]);
            } catch {
              // Failed to parse, return null
            }
          }
          return null;
        }

        // If it's already an object, return as-is
        return response;
      };

      const parsedResponse = parseResponseDetails();

      // Find the failed step from fullExecutionResponse.results if not already identified
      // fullExecutionResponse structure: { isError: boolean, content: actualContent }
      // where actualContent may have: { status, results, error, message, failedTools }
      const findFailedStepInResults = () => {
        if (!parsedResponse) return null;

        // The response structure is { isError, content: actualContent }
        // Check response.content.results first (this is where results actually are)
        const results = parsedResponse.content?.results || parsedResponse.results;

        if (results && Array.isArray(results)) {
          // Match any step that isn't success or skipped (includes 'failed', 'error', 'unknown', undefined, etc.)
          return results.find((r: any) => r.status !== "executed_without_error" && r.status !== "skipped");
        }
        return null;
      };
      const failedResultFromResponse = findFailedStepInResults();

      // Check for build/syntax errors - these have a different structure
      // workflow_result.result.status === "executed_with_error" with workflow_result.result.error containing the error message
      const isBuildError =
        (parsedResponse?.workflow_result?.result?.status === "error" ||
          parsedResponse?.workflow_result?.result?.status === "executed_with_error") &&
        parsedResponse?.workflow_result?.metadata?.name === "Error";

      const buildErrorMessage = isBuildError ? parsedResponse?.workflow_result?.result?.error : null;

      // Use actualFailedStepName if provided, otherwise extract from results, otherwise fall back to workflowLog
      // Priority: explicit step name > log step name > result step_name > result name > step_id > tool_name > fallback
      // For build errors, use "Build/Syntax Error" as the step name
      const stepName =
        failureInfo.actualFailedStepName ||
        failureInfo.workflowLog?.stepName ||
        failedResultFromResponse?.step_name ||
        failedResultFromResponse?.name ||
        failedResultFromResponse?.step_id ||
        failedResultFromResponse?.tool_name ||
        (isBuildError ? "Build/Syntax Error" : "unknown step");

      // Try multiple sources for the error
      // Priority: workflowLog.error (most reliable) > build errors > fullExecutionResponse content > parsed response errors
      // When isError is true, content might be a string error message OR an object with nested error details
      let errorFromFullResponse: string | null = null;
      if (failureInfo.fullExecutionResponse?.isError) {
        const content = failureInfo.fullExecutionResponse.content;
        if (typeof content === "string") {
          // Check if it's a formatted error string like "MCP error -32603: ...\nDetails: {JSON}"
          const detailsMatch = content.match(/Details:\s*(\{[\s\S]*\})\s*$/);
          if (detailsMatch) {
            try {
              const details = JSON.parse(detailsMatch[1]);
              // Extract error from workflow_result.result.error if available
              errorFromFullResponse = details.workflow_result?.result?.error || content;
            } catch {
              // Not JSON, use the string as-is
              errorFromFullResponse = content;
            }
          } else {
            // Plain error string
            errorFromFullResponse = content;
          }
        } else if (content && typeof content === "object") {
          // Content is an object, try to extract error from nested structure
          errorFromFullResponse = (content as any).error || (content as any).workflow_result?.result?.error || null;
        }
      }

      const errorPreview =
        failureInfo.workflowLog?.error || // Highest priority - directly from log entry
        failureInfo.workflowLog?.result?.error || // Also check nested result.error
        buildErrorMessage ||
        errorFromFullResponse ||
        failedResultFromResponse?.error ||
        parsedResponse?.workflow_result?.result?.error ||
        "Unknown error";

      console.log("[WEB-APP-CHAT] Triggering workflow failure analysis", {
        failedStep: stepName,
        tool: failureInfo.workflowLog?.tool,
        error: errorPreview,
        errorSources: {
          workflowLogError: failureInfo.workflowLog?.error,
          workflowLogResultError: failureInfo.workflowLog?.result?.error,
          buildError: buildErrorMessage,
          fullResponseError: errorFromFullResponse,
          failedResultError: failedResultFromResponse?.error,
          parsedResponseError: parsedResponse?.workflow_result?.result?.error,
        },
      });

      // Open chat if needed (dispatch event to open chat panel)
      window.dispatchEvent(new CustomEvent("open-ai-chat"));

      // Preserve current mode for failure analysis - don't switch modes
      // If user is in x/act mode, they want to stay there for auto-execution
      // Only use ask mode if they were already in ask mode or homepage
      const effectiveModeForAnalysis = mode === "x" || mode === "act" ? mode : "ask";

      // Set failure context which will be picked up by sendMessage
      setFailureContext(failureInfo);

      // Build a user message that describes what happened (full error, no truncation)
      const userMessage =
        failureInfo.executionType === "full"
          ? `The workflow failed during full execution at step: ${stepName}\n\nError: ${errorPreview}`
          : `The workflow step "${stepName}" failed with error: ${errorPreview}`;

      // Send the message - system prompt will include failure analysis instructions
      console.log("[WEB-APP-CHAT] About to send failure analysis message:", userMessage);
      console.log("[WEB-APP-CHAT] Current messages count before send:", messages.length);
      // Pass current mode to preserve it (x/act stay as-is, others use ask)
      await sendMessage(userMessage, effectiveModeForAnalysis);
      console.log("[WEB-APP-CHAT] Message sent, isLoading should now be true");
    },
    [isLoading, sendMessage, messages.length, mode]
  );

  // Function to trigger recorder session for implementing recorded steps
  const triggerRecorderSession = useCallback(
    async (recorderData: {
      workflowFolder: string;
      analysisMarkdown: string;
      synthesisResult: {
        workflows: Array<{
          title: string;
          description: string;
          steps: Array<{
            step_name: string;
            substeps: Array<{
              substep_name: string;
              inputs: string[];
              outputs: string[];
              business_logic: string[];
            }>;
          }>;
        }>;
      };
      stepAnalyses: Array<{
        step_title: string;
        step_summary: string;
        events_that_happened: string;
        how_content_changed: string;
        results_if_any: string;
        what_was_clicked: string;
        what_was_typed: string;
        user_intent: string;
        label?: string;
        timestamp: string;
        window_title?: string;
      }>;
      rawEvents: Array<Record<string, unknown>>;
    }) => {
      // Don't trigger if already loading
      if (isLoadingRef.current) {
        console.log("[WEB-APP-CHAT] Skipping recorder session - already loading");
        return;
      }

      console.log("[WEB-APP-CHAT] Triggering recorder session", {
        workflowFolder: recorderData.workflowFolder,
        analysisLength: recorderData.analysisMarkdown.length,
        workflowCount: recorderData.synthesisResult.workflows.length,
        stepCount: recorderData.stepAnalyses.length,
        eventCount: recorderData.rawEvents.length,
      });

      // Open chat if needed
      window.dispatchEvent(new CustomEvent("open-ai-chat"));

      // Start a fresh chat session (saves current session, ends Claude Code ACP, clears state)
      console.log("[WEB-APP-CHAT] Starting fresh chat for recorder session");
      await reload();

      // Switch to recorder mode
      setMode("recorder");

      // Set recorder context which will be picked up by sendMessage
      setRecorderContext(recorderData);

      // Store workflow folder in ref for opening README.md after completion
      recorderWorkflowFolderRef.current = recorderData.workflowFolder;

      // Open README.md in app's file viewer before AI starts
      console.log("[WEB-APP-CHAT] Opening README.md before AI chat");
      options?.onOpenFile?.("README.md");

      // Build a user message to start the implementation
      const stepCount = recorderData.stepAnalyses.length;
      const workflowTitle = recorderData.synthesisResult.workflows[0]?.title || "Recorded Workflow";
      const userMessage = `I've recorded a workflow "${workflowTitle}" with ${stepCount} steps. Please implement the step files based on the recorded actions and analysis. Start by reading the skeleton step files and the raw events to understand what needs to be implemented.`;

      // Send the message - system prompt will include recorder context
      console.log("[WEB-APP-CHAT] Sending recorder session start message");
      await sendMessage(userMessage, "recorder");
    },
    [isLoading, sendMessage, reload]
  );

  // List ALL previous chat sessions for user (IndexedDB-first, global history)
  const listPreviousSessions = useCallback(async (): Promise<ChatSessionListItem[]> => {
    // Load from IndexedDB first (instant, works offline)
    const localSessions = await listAllLocalSessions();

    // Convert LocalSessionMetadata to ChatSessionListItem format
    const sessions: ChatSessionListItem[] = localSessions.map((local, index) => ({
      id: index, // Fake numeric id (not used anymore, we use redis_session_id)
      workflow_id: local.workflowId ? parseInt(local.workflowId, 10) || null : null,
      redis_session_id: local.sessionId,
      title: local.title,
      message_count: local.messageCount,
      created_at: local.createdAt,
      updated_at: local.updatedAt,
    }));

    console.log(`[WEB-APP-CHAT] Listed ${sessions.length} sessions from IndexedDB`);

    // Cloud sync happens in background via the 2s debounce effect
    // No need to fetch from cloud here - IndexedDB is source of truth for history

    return sessions;
  }, []);

  // Load a previous chat session by redis_session_id (IndexedDB-first)
  const loadPreviousSession = useCallback(
    async (sessionIdOrCloudId: number | string): Promise<boolean> => {
      // Support both old numeric id (for backwards compat) and new string sessionId
      // New approach: sessionIdOrCloudId is actually the redis_session_id from the list
      const targetSessionId = typeof sessionIdOrCloudId === "string" ? sessionIdOrCloudId : null;

      console.log(`[WEB-APP-CHAT] loadPreviousSession called`, {
        sessionIdOrCloudId,
        targetSessionId,
        currentMessagesCount: messages.length,
      });

      // Try to load from IndexedDB first
      if (targetSessionId) {
        const localMessages = await getSessionMessages(targetSessionId);
        if (localMessages && localMessages.length > 0) {
          console.log(`[WEB-APP-CHAT] Loaded ${localMessages.length} messages from IndexedDB`);

          // Update state with loaded session
          setSessionId(targetSessionId);
          setMessages(localMessages);

          // Mark that Claude Code needs history sync
          needsClaudeHistorySyncRef.current = true;
          console.log(
            `[WEB-APP-CHAT] Set needsClaudeHistorySync=true (loaded ${localMessages.length} historical messages)`
          );

          // Also update global session
          setGlobalMessages(localMessages);

          return true;
        }
      }

      // Fallback to cloud API if not found locally (for old sessions)
      if (typeof sessionIdOrCloudId === "number") {
        console.log(`[WEB-APP-CHAT] Falling back to cloud for session id ${sessionIdOrCloudId}`);
        const session = await loadChatSession(sessionIdOrCloudId);
        if (!session) {
          console.error("[WEB-APP-CHAT] Failed to load session from cloud");
          return false;
        }

        // Update state with loaded session
        setSessionId(session.redis_session_id);
        setMessages(session.messages || []);

        // Mark that Claude Code needs history sync
        if (session.messages && session.messages.length > 0) {
          needsClaudeHistorySyncRef.current = true;
          console.log(
            `[WEB-APP-CHAT] Set needsClaudeHistorySync=true (loaded ${session.messages.length} historical messages)`
          );
        } else {
          needsClaudeHistorySyncRef.current = false;
        }

        // Also update global session
        setGlobalMessages(session.messages || []);

        console.log(`[WEB-APP-CHAT] loadPreviousSession from cloud completed`, {
          sessionId: session.redis_session_id,
          messagesLoaded: session.messages?.length || 0,
        });
        return true;
      }

      console.error("[WEB-APP-CHAT] Failed to load session - not found locally or in cloud");
      return false;
    },
    [messages.length]
  );

  return {
    messages,
    input,
    setInput, // Exposed for programmatic input prefill (e.g., troubleshooting)
    handleInputChange,
    sendMessage,
    isLoading,
    loadingStatus,
    error,
    reload,
    stop,
    updateMessage,
    regenerateMessage,
    forkFromMessage,
    addWelcomeMessage,
    dismissSuggestions,
    addWorkflowExecutionMessage,
    interruptTool,
    mcpState,
    isMcpAvailable,
    getMcpStatusMessage,
    // NOTE: regenerateSuggestions removed - YAML-based suggestion generation deprecated
    selectedModel,
    setSelectedModel,
    thinkingLevel,
    setThinkingLevel,
    mode,
    setMode,
    triggerFailureAnalysis,
    triggerRecorderSession,
    sessionId,
    // Pasted images waiting to be sent
    pendingImages,
    setPendingImages,
    // Suggestions overlay state (separate from messages)
    suggestedActions,
    suggestionsWorkflowName,
    isGeneratingSuggestions,
    // Chat history functions
    listPreviousSessions,
    loadPreviousSession,
    // Context usage metrics
    contextMetrics,
    contextLimit: getContextLimit(selectedModel),
  };
}

// Re-export types for consumers
export type { ChatSessionListItem, ChatSession };
