/**
 * Centralized API configuration
 * Single source of truth for all API endpoints
 */

// Base API URL - defaults to production if not specified
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://app.mediar.ai";

// API Endpoints
export const API_ENDPOINTS = {
  // Chat sessions endpoints (single global session model - no workflow filtering)
  CHAT_SESSIONS: {
    LIST: `${API_BASE_URL}/api/ai/chat-sessions`,
    SAVE: `${API_BASE_URL}/api/ai/chat-sessions`,
    LOAD: (sessionId: number) => `${API_BASE_URL}/api/ai/chat-sessions/${sessionId}`,
    DELETE: (sessionId: number) => `${API_BASE_URL}/api/ai/chat-sessions?sessionId=${sessionId}`,
  },
} as const;

// Helper function to check if using local development
export const isLocalDevelopment = () => {
  return API_BASE_URL.includes("localhost") || API_BASE_URL.includes("127.0.0.1");
};

// Log configuration on load (only in development)
if (import.meta.env.DEV) {
  console.log("[API Config] Base URL:", API_BASE_URL);
  console.log("[API Config] Is Local Development:", isLocalDevelopment());
}
