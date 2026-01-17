import { describe, it, expect } from "vitest";

// Test the size limit logic directly (extracted for testing)
const MAX_RESULT_SIZE_BYTES = 100 * 1024; // 100KB

function checkResultSize(content: any, toolName: string): { ok: boolean; error?: string } {
  const resultStr = typeof content === "string" ? content : JSON.stringify(content);
  const resultSizeBytes = new TextEncoder().encode(resultStr).length;

  if (resultSizeBytes > MAX_RESULT_SIZE_BYTES) {
    const sizeKB = Math.round(resultSizeBytes / 1024);
    const limitKB = Math.round(MAX_RESULT_SIZE_BYTES / 1024);

    const errorHints: Record<string, string> = {
      get_window_tree:
        "Try using 'max_depth' parameter (e.g., max_depth: 3) or target a specific element with 'selector'.",
      capture_screenshot: "Try targeting a specific window with 'selector' parameter.",
      execute_browser_script: "Return less data from your script, or filter/paginate the results.",
      execute_sequence: "The workflow output is too large. Consider breaking into smaller steps.",
    };
    const hint = errorHints[toolName] || "Try using more specific parameters to reduce output size.";

    return {
      ok: false,
      error: `Output too large (${sizeKB}KB, limit: ${limitKB}KB). ${hint}`,
    };
  }

  return { ok: true };
}

describe("MCP Result Size Limit", () => {
  it("should allow small results", () => {
    const smallResult = { data: "hello world" };
    const result = checkResultSize(smallResult, "some_tool");
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should block results larger than 100KB", () => {
    // Create a string larger than 100KB
    const largeString = "x".repeat(150 * 1024); // 150KB
    const result = checkResultSize(largeString, "some_tool");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Output too large");
    expect(result.error).toContain("150KB");
    expect(result.error).toContain("limit: 100KB");
  });

  it("should provide tool-specific hints for get_window_tree", () => {
    const largeResult = "x".repeat(150 * 1024);
    const result = checkResultSize(largeResult, "get_window_tree");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("max_depth");
    expect(result.error).toContain("selector");
  });

  it("should provide tool-specific hints for execute_browser_script", () => {
    const largeResult = "x".repeat(150 * 1024);
    const result = checkResultSize(largeResult, "execute_browser_script");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("filter/paginate");
  });

  it("should provide generic hint for unknown tools", () => {
    const largeResult = "x".repeat(150 * 1024);
    const result = checkResultSize(largeResult, "unknown_tool");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("more specific parameters");
  });

  it("should handle JSON objects correctly", () => {
    // Create object that serializes to > 100KB
    const largeObject = {
      items: Array(5000)
        .fill(null)
        .map((_, i) => ({ id: i, name: `Item ${i}`, description: "A".repeat(50) })),
    };
    const result = checkResultSize(largeObject, "some_tool");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Output too large");
  });

  it("should allow results just under the limit", () => {
    // 99KB should be fine
    const justUnderLimit = "x".repeat(99 * 1024);
    const result = checkResultSize(justUnderLimit, "some_tool");

    expect(result.ok).toBe(true);
  });
});
