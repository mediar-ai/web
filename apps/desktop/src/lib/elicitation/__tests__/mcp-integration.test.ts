/**
 * Tests for MCP integration
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerElicitationHandler,
  isElicitationAvailable,
  requestElicitation,
  convertMcpRequest,
  convertMcpResponse,
} from "../mcp-integration";

describe("MCP Integration", () => {
  beforeEach(() => {
    const cleanup = registerElicitationHandler(async () => ({ action: "cancel" }));
    cleanup();
  });

  describe("registerElicitationHandler", () => {
    it("registers handler and makes elicitation available", () => {
      const handler = vi.fn(async () => ({ action: "accept" as const, content: {} }));

      expect(isElicitationAvailable()).toBe(false);
      const cleanup = registerElicitationHandler(handler);
      expect(isElicitationAvailable()).toBe(true);
      cleanup();
      expect(isElicitationAvailable()).toBe(false);
    });
  });

  describe("requestElicitation", () => {
    it("returns decline if no handler registered", async () => {
      const result = await requestElicitation({
        message: "Test",
        requestedSchema: { type: "object", properties: {} },
      });
      expect(result).toEqual({ action: "decline" });
    });

    it("calls registered handler", async () => {
      const handler = vi.fn(async () => ({ action: "accept" as const, content: { key: "value" } }));
      registerElicitationHandler(handler);

      await requestElicitation({ message: "Test", requestedSchema: { type: "object", properties: {} } });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("convertMcpRequest", () => {
    it("converts basic MCP request params", () => {
      const params = {
        message: "Choose an option",
        requestedSchema: { type: "object", properties: { choice: { type: "string" } } },
      };

      const result = convertMcpRequest(params);
      expect(result.message).toBe("Choose an option");
    });
  });

  describe("convertMcpResponse", () => {
    it("converts accept response", () => {
      const response = { action: "accept" as const, content: { key: "value" } };
      const result = convertMcpResponse(response);
      expect(result.action).toBe("accept");
      expect(result.content).toEqual({ key: "value" });
    });

    it("converts cancel response", () => {
      const response = { action: "cancel" as const };
      const result = convertMcpResponse(response);
      expect(result.action).toBe("cancel");
    });
  });
});
