/**
 * API client for chat sessions
 * Syncs chat history to backend for persistence across devices
 */

import { API_ENDPOINTS } from "@/config/api";
import { getAuthToken } from "./vertex-http-client";

export interface ChatSession {
  id: number;
  redis_session_id: string;
  title: string | null;
  message_count: number;
  messages?: any[];
  created_at: string;
  updated_at: string;
}

export interface ChatSessionListItem {
  id: number;
  redis_session_id: string;
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * List chat sessions for user (single global session model)
 */
export async function listChatSessions(): Promise<ChatSessionListItem[]> {
  const authToken = await getAuthToken();
  if (!authToken) {
    console.warn("[CHAT-SESSIONS] No auth token available");
    return [];
  }

  try {
    const response = await fetch(API_ENDPOINTS.CHAT_SESSIONS.LIST, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[CHAT-SESSIONS] Failed to list sessions:", error);
      return [];
    }

    const data = await response.json();
    console.log(`[CHAT-SESSIONS] Loaded ${data.sessions?.length || 0} sessions`);
    return data.sessions || [];
  } catch (error) {
    console.error("[CHAT-SESSIONS] Error listing sessions:", error);
    return [];
  }
}

/**
 * Save or update a chat session (single global session model)
 * @param redisSessionId - Required: the session ID
 * @param messages - Required: the messages to save
 * @param title - Optional: session title
 */
export async function saveChatSession(
  redisSessionId: string,
  messages: any[],
  title?: string
): Promise<{ id: number } | null> {
  const authToken = await getAuthToken();
  if (!authToken) {
    console.warn("[CHAT-SESSIONS] No auth token available");
    return null;
  }

  try {
    const payload = JSON.stringify({
      redisSessionId,
      messages,
      title,
    });
    const payloadSizeKB = (payload.length / 1024).toFixed(1);
    console.log(`[CHAT-SESSIONS] Saving: ${payloadSizeKB}KB, ${messages.length} messages`);

    const response = await fetch(API_ENDPOINTS.CHAT_SESSIONS.SAVE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[CHAT-SESSIONS] Failed to save session:", error);
      return null;
    }

    const data = await response.json();
    console.log(`[CHAT-SESSIONS] Saved session ${data.session?.id}`);
    return data.session;
  } catch (error) {
    console.error("[CHAT-SESSIONS] Error saving session:", error);
    return null;
  }
}

/**
 * Load a specific chat session with full messages
 */
export async function loadChatSession(sessionId: number): Promise<ChatSession | null> {
  console.log(`[CHAT-SESSIONS] Loading session ${sessionId}...`);

  const authToken = await getAuthToken();
  if (!authToken) {
    console.warn("[CHAT-SESSIONS] No auth token available");
    return null;
  }

  try {
    console.log(`[CHAT-SESSIONS] Fetching session ${sessionId} from API`);
    const response = await fetch(API_ENDPOINTS.CHAT_SESSIONS.LOAD(sessionId), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[CHAT-SESSIONS] Failed to load session:", error);
      return null;
    }

    const data = await response.json();
    console.log(
      `[CHAT-SESSIONS] Loaded session ${data.session?.id} with ${data.session?.messages?.length || 0} messages`
    );
    return data.session;
  } catch (error) {
    console.error("[CHAT-SESSIONS] Error loading session:", error);
    return null;
  }
}

/**
 * Delete a chat session
 */
export async function deleteChatSession(sessionId: number): Promise<boolean> {
  const authToken = await getAuthToken();
  if (!authToken) {
    console.warn("[CHAT-SESSIONS] No auth token available");
    return false;
  }

  try {
    const response = await fetch(API_ENDPOINTS.CHAT_SESSIONS.DELETE(sessionId), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("[CHAT-SESSIONS] Failed to delete session:", error);
      return false;
    }

    console.log(`[CHAT-SESSIONS] Deleted session ${sessionId}`);
    return true;
  } catch (error) {
    console.error("[CHAT-SESSIONS] Error deleting session:", error);
    return false;
  }
}

/**
 * Generate a title from the first user message
 */
export function generateSessionTitle(messages: any[]): string {
  const firstUserMessage = messages.find(m => m.role === "user");
  if (!firstUserMessage?.content) {
    return "New Chat";
  }

  const content =
    typeof firstUserMessage.content === "string"
      ? firstUserMessage.content
      : firstUserMessage.content[0]?.text || "New Chat";

  // Store up to 200 chars for tooltip display (truncate on UI side)
  return content.length > 200 ? content.substring(0, 197) + "..." : content;
}
