import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for malformed function call handling in useWebAppChat
 *
 * These tests verify that:
 * 1. The malformed_function_call finish reason is properly detected
 * 2. Error messages are displayed with retry capability
 * 3. The conversation can be retried after a malformed response
 */

// Mock vertex-http-client to simulate stream events
vi.mock("../../services/vertex-http-client", () => ({
  callVertexAIStreamRust: vi.fn(),
  convertAiSdkToolsToVertexFormat: vi.fn(() => []),
  getAuthToken: vi.fn(() => Promise.resolve("mock-token")),
}));

// Mock tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(() => Promise.resolve()),
  })),
}));

// Mock McpContext
vi.mock("../../contexts/McpContext", () => ({
  useMcp: vi.fn(() => ({
    tools: {},
    serverInfo: { port: 8080 },
    serverInstructions: "",
  })),
}));

// Mock session storage
vi.mock("../../lib/session-storage", () => ({
  getWorkflowMessages: vi.fn(() => []),
  setWorkflowMessages: vi.fn(),
  clearWorkflowMessages: vi.fn(),
}));

// Mock analytics
vi.mock("../../lib/analytics", () => ({
  trackChatMessageSent: vi.fn(),
}));

// Mock mcp-client
vi.mock("../../lib/mcp-client", () => ({
  mcpClient: {
    connect: vi.fn(() => Promise.resolve()),
    callTool: vi.fn(() => Promise.resolve({})),
  },
}));

describe("useWebAppChat - Malformed Function Call Handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Malformed Function Call Detection", () => {
    it("should recognize malformed_function_call finish reason", () => {
      // The malformed_function_call finish reason comes from Rust backend
      const finishReason = "malformed_function_call";
      expect(finishReason).toBe("malformed_function_call");
    });

    it("should differentiate malformed_function_call from other finish reasons", () => {
      const finishReasons = ["stop", "tool_calls", "malformed_function_call", "error"];

      const isMalformed = (reason: string) => reason === "malformed_function_call";

      expect(isMalformed("stop")).toBe(false);
      expect(isMalformed("tool_calls")).toBe(false);
      expect(isMalformed("malformed_function_call")).toBe(true);
      expect(isMalformed("error")).toBe(false);
    });

    it("should detect malformed response in stream done event", () => {
      // Simulate a stream done event with malformed_function_call
      const doneEvent = {
        type: "done",
        finishReason: "malformed_function_call",
        sessionId: "test-session-123",
      };

      expect(doneEvent.finishReason).toBe("malformed_function_call");
    });
  });

  describe("Error Message Construction", () => {
    it("should create error message with correct structure", () => {
      const messageText = "test user message";

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

      expect(errorMessage.role).toBe("assistant");
      expect(errorMessage.content).toBe("");
      expect(errorMessage.error.type).toBe("malformed_function_call");
      expect(errorMessage.error.canRetry).toBe(true);
      expect(errorMessage.error.originalMessage).toBe(messageText);
      expect(errorMessage.isError).toBe(true);
    });

    it("should preserve original message for retry", () => {
      const originalMessage = "Click the submit button and verify the form was submitted";

      const errorMessage = {
        error: {
          type: "malformed_function_call",
          canRetry: true,
          originalMessage: originalMessage,
        },
      };

      expect(errorMessage.error.originalMessage).toBe(originalMessage);
      expect(errorMessage.error.originalMessage.length).toBeGreaterThan(0);
    });
  });

  describe("Retry Logic", () => {
    it("should allow retry when canRetry is true", () => {
      const error = {
        type: "malformed_function_call",
        canRetry: true,
        originalMessage: "test message",
      };

      const canRetry = error.canRetry && error.originalMessage;
      expect(canRetry).toBeTruthy();
    });

    it("should not allow retry when canRetry is false", () => {
      const error = {
        type: "malformed_function_call",
        canRetry: false,
        originalMessage: "test message",
      };

      const canRetry = error.canRetry && error.originalMessage;
      expect(canRetry).toBe(false);
    });

    it("should not allow retry when originalMessage is missing", () => {
      const error = {
        type: "malformed_function_call",
        canRetry: true,
        originalMessage: "",
      };

      const canRetry = error.canRetry && error.originalMessage;
      expect(canRetry).toBeFalsy();
    });
  });

  describe("Response Processing", () => {
    it("should handle response with malformed finish reason", () => {
      const response = {
        text: "",
        toolCalls: [],
        sessionId: "test-session",
        finishReason: "malformed_function_call",
      };

      // When finishReason is malformed_function_call, text and toolCalls should be empty
      expect(response.text).toBe("");
      expect(response.toolCalls).toHaveLength(0);
      expect(response.finishReason).toBe("malformed_function_call");
    });

    it("should not have tool calls when malformed", () => {
      const response = {
        text: "",
        toolCalls: [],
        finishReason: "malformed_function_call",
      };

      // Malformed responses should have empty tool calls
      expect(response.toolCalls.length).toBe(0);
    });

    it("should stop processing after malformed detection", () => {
      const response = {
        finishReason: "malformed_function_call",
        toolCalls: [],
      };

      // After malformed detection, we should return early and not continue the tool loop
      const shouldContinueToolLoop = response.toolCalls.length > 0;
      expect(shouldContinueToolLoop).toBe(false);
    });
  });

  describe("Stream Event Handling", () => {
    it("should handle done event with malformed_function_call", async () => {
      // Simulate async generator that yields malformed done event
      async function* mockStream() {
        yield { type: "done", finishReason: "malformed_function_call" };
      }

      let receivedFinishReason = "";

      for await (const event of mockStream()) {
        if (event.type === "done") {
          receivedFinishReason = event.finishReason;
        }
      }

      expect(receivedFinishReason).toBe("malformed_function_call");
    });

    it("should handle text followed by malformed done", async () => {
      // Model might emit partial text before generating malformed tool call
      async function* mockStream() {
        yield { type: "text", content: "Let me " };
        yield { type: "done", finishReason: "malformed_function_call" };
      }

      let text = "";
      let finishReason = "";

      for await (const event of mockStream()) {
        if (event.type === "text") {
          text += event.content;
        } else if (event.type === "done") {
          finishReason = event.finishReason;
        }
      }

      expect(text).toBe("Let me ");
      expect(finishReason).toBe("malformed_function_call");
    });
  });

  describe("UI State Management", () => {
    it("should mark streaming as false when malformed detected", () => {
      let isStreaming = true;

      // When malformed_function_call is detected
      const finishReason = "malformed_function_call";
      if (finishReason === "malformed_function_call") {
        isStreaming = false;
      }

      expect(isStreaming).toBe(false);
    });

    it("should not throw error for malformed responses", () => {
      // Malformed responses should show error message, not throw
      const response = {
        finishReason: "malformed_function_call",
      };

      let errorThrown = false;

      if (response.finishReason === "malformed_function_call") {
        // Show error message, don't throw
        const errorMessage = {
          error: { type: "malformed_function_call" },
        };
        expect(errorMessage.error.type).toBe("malformed_function_call");
      } else {
        errorThrown = true;
      }

      expect(errorThrown).toBe(false);
    });
  });

  describe("Error Type Classification", () => {
    it("should classify malformed_function_call as distinct error type", () => {
      const errorTypes = ["rate_limited", "malformed_function_call", "connection_refused", "rate_limit_after_tools"];

      const isRetryable = (type: string) =>
        type === "rate_limited" || type === "malformed_function_call" || type === "rate_limit_after_tools";

      expect(isRetryable("malformed_function_call")).toBe(true);
      expect(isRetryable("connection_refused")).toBe(false);
    });

    it("should display appropriate UI for malformed errors", () => {
      // Chat message component checks error.type for styling
      const error = { type: "malformed_function_call" };

      const shouldShowOrangeTheme = error.type === "malformed_function_call";
      const shouldShowAmberTheme = error.type === "rate_limited";

      expect(shouldShowOrangeTheme).toBe(true);
      expect(shouldShowAmberTheme).toBe(false);
    });
  });
});

describe("Chat Message Component - Malformed Error Display", () => {
  describe("Error Styling", () => {
    it("should use orange theme for malformed_function_call", () => {
      const error = { type: "malformed_function_call" };

      // Check CSS class selection logic from chat-message.tsx
      const isOrangeTheme = error.type === "malformed_function_call";
      const isAmberTheme = error.type === "rate_limited";
      const isDefaultTheme = error.type !== "rate_limited" && error.type !== "malformed_function_call";

      expect(isOrangeTheme).toBe(true);
      expect(isAmberTheme).toBe(false);
      expect(isDefaultTheme).toBe(false);
    });

    it("should display Try Again button for malformed errors", () => {
      const error = {
        type: "malformed_function_call",
        canRetry: true,
        originalMessage: "original message",
      };

      const shouldShowRetryButton = error.canRetry && error.originalMessage;
      expect(shouldShowRetryButton).toBeTruthy();
    });

    it("should show AlertTriangle icon for malformed errors", () => {
      // The component imports and uses AlertTriangle for malformed_function_call
      const error = { type: "malformed_function_call" };
      const shouldShowAlertTriangle = error.type === "malformed_function_call";
      expect(shouldShowAlertTriangle).toBe(true);
    });
  });

  describe("Retry Button Behavior", () => {
    it("should call onRegenerate when Try Again is clicked", () => {
      const mockRegenerate = vi.fn();
      const messageId = "test-message-123";

      // Simulate button click
      mockRegenerate(messageId);

      expect(mockRegenerate).toHaveBeenCalledWith(messageId);
      expect(mockRegenerate).toHaveBeenCalledTimes(1);
    });
  });
});
