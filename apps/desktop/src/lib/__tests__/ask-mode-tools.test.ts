/**
 * Unit tests for ask-mode-tools.ts
 * Tests tool categorization and filtering for Ask/Act/X modes
 */

import { describe, it, expect } from "vitest";
import {
  ASK_MODE_ALLOWED_TOOLS,
  ASK_MODE_BLOCKED_TOOLS,
  X_MODE_ALLOWED_TOOLS,
  isToolAllowedInAskMode,
  isToolBlockedInAskMode,
  getToolRequiredMode,
  isToolAllowedInXMode,
  filterToolsForXMode,
  filterToolsForAskMode,
} from "../ask-mode-tools";

describe("ask-mode-tools", () => {
  describe("Tool Lists", () => {
    it("should have non-empty ASK_MODE_ALLOWED_TOOLS", () => {
      expect(ASK_MODE_ALLOWED_TOOLS.length).toBeGreaterThan(0);
    });

    it("should have non-empty ASK_MODE_BLOCKED_TOOLS", () => {
      expect(ASK_MODE_BLOCKED_TOOLS.length).toBeGreaterThan(0);
    });

    it("should have non-empty X_MODE_ALLOWED_TOOLS", () => {
      expect(X_MODE_ALLOWED_TOOLS.length).toBeGreaterThan(0);
    });

    it("should not have overlap between ASK_MODE_ALLOWED_TOOLS and ASK_MODE_BLOCKED_TOOLS", () => {
      const overlap = ASK_MODE_ALLOWED_TOOLS.filter(tool => ASK_MODE_BLOCKED_TOOLS.includes(tool));
      expect(overlap).toEqual([]);
    });

    it("should include read-only file tools in ASK_MODE_ALLOWED_TOOLS", () => {
      expect(ASK_MODE_ALLOWED_TOOLS).toContain("read_file");
      expect(ASK_MODE_ALLOWED_TOOLS).toContain("glob_files");
      expect(ASK_MODE_ALLOWED_TOOLS).toContain("grep_files");
    });

    it("should include write file tools in ASK_MODE_BLOCKED_TOOLS", () => {
      expect(ASK_MODE_BLOCKED_TOOLS).toContain("write_file");
      expect(ASK_MODE_BLOCKED_TOOLS).toContain("edit_file");
    });

    it("should include all file tools in X_MODE_ALLOWED_TOOLS", () => {
      expect(X_MODE_ALLOWED_TOOLS).toContain("read_file");
      expect(X_MODE_ALLOWED_TOOLS).toContain("write_file");
      expect(X_MODE_ALLOWED_TOOLS).toContain("edit_file");
      expect(X_MODE_ALLOWED_TOOLS).toContain("glob_files");
      expect(X_MODE_ALLOWED_TOOLS).toContain("grep_files");
    });

    it("should include run_command in X_MODE_ALLOWED_TOOLS", () => {
      expect(X_MODE_ALLOWED_TOOLS).toContain("run_command");
    });

    it("should NOT include execute_sequence in X_MODE_ALLOWED_TOOLS (removed - UI automation)", () => {
      expect(X_MODE_ALLOWED_TOOLS).not.toContain("execute_sequence");
    });

    it("should NOT include UI automation tools in X_MODE_ALLOWED_TOOLS", () => {
      expect(X_MODE_ALLOWED_TOOLS).not.toContain("click_element");
      expect(X_MODE_ALLOWED_TOOLS).not.toContain("type_into_element");
      expect(X_MODE_ALLOWED_TOOLS).not.toContain("get_window_tree");
      expect(X_MODE_ALLOWED_TOOLS).not.toContain("capture_screenshot");
    });

    it("should NOT include render_action_button in X_MODE_ALLOWED_TOOLS (no mode switching in X mode)", () => {
      expect(X_MODE_ALLOWED_TOOLS).not.toContain("render_action_button");
    });

    it("should include typecheck_workflow in X_MODE_ALLOWED_TOOLS", () => {
      expect(X_MODE_ALLOWED_TOOLS).toContain("typecheck_workflow");
    });
  });

  describe("isToolAllowedInAskMode", () => {
    it("should return true for allowed tools", () => {
      expect(isToolAllowedInAskMode("read_file")).toBe(true);
      expect(isToolAllowedInAskMode("get_window_tree")).toBe(true);
      expect(isToolAllowedInAskMode("capture_screenshot")).toBe(true);
    });

    it("should return false for blocked tools", () => {
      expect(isToolAllowedInAskMode("click_element")).toBe(false);
      expect(isToolAllowedInAskMode("run_command")).toBe(false);
      expect(isToolAllowedInAskMode("write_file")).toBe(false);
    });
  });

  describe("isToolBlockedInAskMode", () => {
    it("should return true for blocked tools", () => {
      expect(isToolBlockedInAskMode("click_element")).toBe(true);
      expect(isToolBlockedInAskMode("run_command")).toBe(true);
      expect(isToolBlockedInAskMode("write_file")).toBe(true);
    });

    it("should return false for allowed tools", () => {
      expect(isToolBlockedInAskMode("read_file")).toBe(false);
      expect(isToolBlockedInAskMode("get_window_tree")).toBe(false);
    });
  });

  describe("getToolRequiredMode", () => {
    it("should return 'ask' for read-only tools", () => {
      expect(getToolRequiredMode("read_file")).toBe("ask");
      expect(getToolRequiredMode("get_window_tree")).toBe("ask");
    });

    it("should return 'act' for state-changing tools", () => {
      expect(getToolRequiredMode("click_element")).toBe("act");
      expect(getToolRequiredMode("run_command")).toBe("act");
      expect(getToolRequiredMode("write_file")).toBe("act");
    });

    it("should return 'unknown' for uncategorized tools", () => {
      expect(getToolRequiredMode("some_unknown_tool")).toBe("unknown");
    });
  });

  describe("isToolAllowedInXMode", () => {
    it("should return true for X mode tools", () => {
      expect(isToolAllowedInXMode("run_command")).toBe(true);
      expect(isToolAllowedInXMode("read_file")).toBe(true);
      expect(isToolAllowedInXMode("write_file")).toBe(true);
      expect(isToolAllowedInXMode("edit_file")).toBe(true);
    });

    it("should return false for execute_sequence (removed from X mode)", () => {
      expect(isToolAllowedInXMode("execute_sequence")).toBe(false);
    });

    it("should return false for UI automation tools", () => {
      expect(isToolAllowedInXMode("click_element")).toBe(false);
      expect(isToolAllowedInXMode("type_into_element")).toBe(false);
      expect(isToolAllowedInXMode("get_window_tree")).toBe(false);
    });
  });

  describe("filterToolsForXMode", () => {
    it("should filter tools object to only X mode allowed tools", () => {
      const mockTools = {
        run_command: { description: "Run command" },
        click_element: { description: "Click element" },
        read_file: { description: "Read file" },
        write_file: { description: "Write file" },
        get_window_tree: { description: "Get window tree" },
        execute_sequence: { description: "Execute sequence" },
      };

      const filtered = filterToolsForXMode(mockTools);

      expect(filtered).toHaveProperty("run_command");
      expect(filtered).toHaveProperty("read_file");
      expect(filtered).toHaveProperty("write_file");
      expect(filtered).not.toHaveProperty("execute_sequence"); // Removed from X mode
      expect(filtered).not.toHaveProperty("click_element");
      expect(filtered).not.toHaveProperty("get_window_tree");
    });

    it("should return empty object when no tools match", () => {
      const mockTools = {
        click_element: { description: "Click" },
        type_into_element: { description: "Type" },
      };

      const filtered = filterToolsForXMode(mockTools);
      expect(Object.keys(filtered)).toHaveLength(0);
    });

    it("should preserve tool properties", () => {
      const mockTools = {
        run_command: { description: "Run command", parameters: { type: "object" } },
      };

      const filtered = filterToolsForXMode(mockTools);
      expect(filtered.run_command).toEqual(mockTools.run_command);
    });
  });

  describe("filterToolsForAskMode", () => {
    it("should filter tools object to only Ask mode allowed tools", () => {
      const mockTools = {
        read_file: { description: "Read file" },
        write_file: { description: "Write file" },
        get_window_tree: { description: "Get window tree" },
        click_element: { description: "Click element" },
      };

      const filtered = filterToolsForAskMode(mockTools);

      expect(filtered).toHaveProperty("read_file");
      expect(filtered).toHaveProperty("get_window_tree");
      expect(filtered).not.toHaveProperty("write_file");
      expect(filtered).not.toHaveProperty("click_element");
    });
  });
});
