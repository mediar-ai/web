import { describe, it, expect, beforeAll } from "vitest";
import { invoke } from "@tauri-apps/api/core";

/**
 * Integration tests for Tauri commands
 *
 * These tests require the Tauri app to be running in dev mode.
 * Run with: bun test:integration
 *
 * To run the app for testing:
 * 1. Terminal 1: bun tauri dev
 * 2. Terminal 2: bun test:integration
 *
 * NOTE: These tests are skipped in CI and Node.js environments where Tauri is not available.
 */

// Check if Tauri is available
const isTauriAvailable = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
const describeWithTauri = isTauriAvailable ? describe : describe.skip;

describeWithTauri("Tauri Integration Tests", () => {
  beforeAll(() => {
    // Check if running in Tauri context
    if (typeof window === "undefined" || !(window as any).__TAURI__) {
      console.warn("⚠️  Not running in Tauri context - tests will be skipped");
    }
  });

  describe("Workflow Commands", () => {
    it("should list workflows from directory", async () => {
      const workflows = await invoke<any[]>("list_workflows");

      expect(workflows).toBeDefined();
      expect(Array.isArray(workflows)).toBe(true);

      // Each workflow should have required fields
      workflows.forEach(workflow => {
        expect(workflow).toHaveProperty("id");
        expect(workflow).toHaveProperty("name");
        expect(workflow).toHaveProperty("stepCount");
        expect(workflow).toHaveProperty("lastModified");
      });
    });

    it("should get workflow directory path", async () => {
      const path = await invoke<string>("get_workflow_directory");

      expect(path).toBeDefined();
      expect(typeof path).toBe("string");
      expect(path.length).toBeGreaterThan(0);
    });

    it("should open workflow directory", async () => {
      // This should not throw
      await expect(invoke("open_workflow_directory")).resolves.not.toThrow();
    });
  });

  describe("MCP Server Commands", () => {
    it("should get terminator MCP status", async () => {
      const status = await invoke<any>("get_terminator_mcp_status");

      expect(status).toBeDefined();
      expect(status).toHaveProperty("port");
      expect(status).toHaveProperty("is_running");
      expect(status).toHaveProperty("url");
      expect(status).toHaveProperty("uptime_seconds");

      expect(status.port).toBe(8080);
      expect(typeof status.is_running).toBe("boolean");
    });

    it("should start terminator MCP server", async () => {
      const result = await invoke<any>("start_terminator_mcp");

      expect(result).toBeDefined();
      expect(result).toHaveProperty("port");
      expect(result.port).toBe(8080);
    });

    it("should stop terminator MCP server", async () => {
      await expect(invoke("stop_terminator_mcp")).resolves.not.toThrow();
    });
  });

  describe("Window Commands", () => {
    it("should set window title", async () => {
      await expect(invoke("set_window_title", { title: "Test Title" })).resolves.not.toThrow();
    });

    it("should show/hide window", async () => {
      await expect(invoke("show_window")).resolves.not.toThrow();
      await expect(invoke("hide_window")).resolves.not.toThrow();
      await expect(invoke("show_window")).resolves.not.toThrow(); // Restore
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid command gracefully", async () => {
      await expect(invoke("nonexistent_command")).rejects.toThrow();
    });

    it("should handle invalid parameters", async () => {
      await expect(invoke("set_window_title", { invalid: "param" })).rejects.toThrow();
    });
  });
});
