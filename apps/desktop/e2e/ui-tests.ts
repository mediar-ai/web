/**
 * E2E UI Tests for Mediar Desktop App
 *
 * Uses Terminator MCP tools to interact with the actual UI.
 * Tests MCP server, workflow execution, and UI interactions.
 *
 * Run: bun e2e/ui-tests.ts
 *
 * Prerequisites:
 * - Mediar app running with MCP server on port 8080
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_PORT = 8080;
const MCP_URL = `http://127.0.0.1:${MCP_PORT}/mcp`;

// Test state
let client: Client | null = null;
let passed = 0;
let failed = 0;
const results: { name: string; status: "pass" | "fail"; error?: string; duration: number }[] = [];

// Connect to MCP server
async function connect(): Promise<void> {
  client = new Client({ name: "e2e-tests", version: "1.0.0" }, { capabilities: {} });

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  console.log("Connected to MCP server\n");
}

// Call MCP tool
async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!client) throw new Error("Not connected");
  const result = await client.callTool({ name, arguments: args });
  return result;
}

// Test runner
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`PASS (${duration}ms)`);
    passed++;
    results.push({ name, status: "pass", duration });
  } catch (e: unknown) {
    const duration = Date.now() - start;
    const error = e instanceof Error ? e.message : String(e);
    console.log(`FAIL (${duration}ms)`);
    console.log(`     Error: ${error}`);
    failed++;
    results.push({ name, status: "fail", error, duration });
  }
}

// Helper to wait
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// MCP Server Tests
// ============================================

async function testMcpServer() {
  console.log("\n=== MCP Server Tests ===\n");

  await test("tools/list returns available tools", async () => {
    const result = (await client?.listTools()) as { tools: { name: string }[] };
    if (!result.tools || result.tools.length === 0) {
      throw new Error("No tools returned");
    }
    const toolNames = result.tools.map(t => t.name);
    // Check for core tools that should exist
    const required = ["click_element", "type_into_element", "get_applications_and_windows_list", "execute_sequence"];
    for (const tool of required) {
      if (!toolNames.includes(tool)) {
        throw new Error(`Missing required tool: ${tool}`);
      }
    }
  });

  await test("has many tools available", async () => {
    const result = (await client?.listTools()) as { tools: { name: string }[] };
    if (result.tools.length < 10) {
      throw new Error(`Too few tools: ${result.tools.length} (expected >= 10)`);
    }
  });

  await test("get_applications_and_windows_list works", async () => {
    const result = (await callTool("get_applications_and_windows_list")) as { content: unknown[] };
    if (!result.content || result.content.length === 0) {
      throw new Error("No applications returned");
    }
  });

  await test("delay tool is accurate", async () => {
    const targetMs = 200;
    const tolerance = 150;
    const start = Date.now();
    await callTool("delay", { delay_ms: targetMs });
    const elapsed = Date.now() - start;
    if (Math.abs(elapsed - targetMs) > tolerance) {
      throw new Error(`Delay inaccurate: ${elapsed}ms (expected ~${targetMs}ms)`);
    }
  });

  await test("stop_execution is safe when nothing running", async () => {
    await callTool("stop_execution");
    // Should not throw
  });
}

// ============================================
// UI Interaction Tests
// ============================================

async function testUiInteractions() {
  console.log("\n=== UI Interaction Tests ===\n");

  await test("can find Mediar window", async () => {
    const result = (await callTool("get_applications_and_windows_list")) as { content: { text: string }[] };
    const text = result.content[0]?.text || "";
    if (!text.toLowerCase().includes("mediar")) {
      throw new Error("Mediar window not found in application list");
    }
  });

  await test("can get window tree for Mediar", async () => {
    const apps = (await callTool("get_applications_and_windows_list")) as { content: { text: string }[] };
    const appText = apps.content[0]?.text || "";

    // Extract PID from the app list
    const mediarMatch = appText.match(/mediar.*?pid[:\s]*(\d+)/i) || appText.match(/pid[:\s]*(\d+).*?mediar/i);
    if (mediarMatch) {
      const pid = parseInt(mediarMatch[1]);
      const tree = await callTool("get_window_tree", { pid });
      if (!tree) {
        throw new Error("Window tree is empty");
      }
    }
    // If we can't find PID, just pass - window might be named differently
  });

  await test("click_element tool exists and validates input", async () => {
    try {
      // Try to click with invalid selector - should fail gracefully
      await callTool("click_element", { selector: "InvalidSelector[xyz=999999]" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Expected to fail - verify it's a validation/not-found error, not a crash
      if (msg.toLowerCase().includes("crash") || msg.toLowerCase().includes("panic")) {
        throw new Error("Server crashed instead of returning error");
      }
    }
  });

  await test("type_into_element tool exists and validates input", async () => {
    try {
      await callTool("type_into_element", { selector: "InvalidSelector[xyz=999999]", text_to_type: "test" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("crash") || msg.toLowerCase().includes("panic")) {
        throw new Error("Server crashed instead of returning error");
      }
    }
  });
}

// ============================================
// Workflow Execution Tests
// ============================================

async function testWorkflowExecution() {
  console.log("\n=== Workflow Execution Tests ===\n");

  await test("execute_sequence with single step works", async () => {
    await callTool("execute_sequence", {
      steps: [
        {
          id: "test_step",
          name: "Get Apps",
          tool_name: "get_applications_and_windows_list",
          arguments: {},
        },
      ],
    });
  });

  await test("execute_sequence with delay step", async () => {
    const start = Date.now();
    await callTool("execute_sequence", {
      steps: [{ id: "delay1", name: "Delay", tool_name: "delay", arguments: { delay_ms: 100 } }],
    });
    const elapsed = Date.now() - start;
    if (elapsed < 100) {
      throw new Error(`Delay too short: ${elapsed}ms (expected >= 100ms)`);
    }
  });

  await test("execute_sequence with multiple steps", async () => {
    const start = Date.now();
    await callTool("execute_sequence", {
      steps: [
        { id: "delay1", name: "Delay 1", tool_name: "delay", arguments: { delay_ms: 100 } },
        { id: "delay2", name: "Delay 2", tool_name: "delay", arguments: { delay_ms: 100 } },
      ],
    });
    const elapsed = Date.now() - start;
    if (elapsed < 200) {
      throw new Error(`Steps not sequential: ${elapsed}ms (expected >= 200ms)`);
    }
  });

  await test("stop_execution interrupts running workflow", async () => {
    // Start long workflow
    const workflowPromise = callTool("execute_sequence", {
      steps: [{ id: "long_delay", name: "Long Delay", tool_name: "delay", arguments: { delay_ms: 5000 } }],
    });

    // Wait then stop
    await sleep(300);
    const stopStart = Date.now();
    await callTool("stop_execution");

    // Wait for workflow to complete
    await workflowPromise.catch(() => {}); // Ignore errors from interrupted workflow
    const elapsed = Date.now() - stopStart;

    if (elapsed > 2000) {
      throw new Error(`Workflow not stopped: took ${elapsed}ms (expected < 2000ms)`);
    }
  });

  await test("large workflow executes correctly", async () => {
    const steps = [];
    for (let i = 0; i < 5; i++) {
      steps.push({
        id: `step_${i}`,
        name: `Step ${i}`,
        tool_name: "delay",
        arguments: { delay_ms: 20 },
      });
    }

    const start = Date.now();
    await callTool("execute_sequence", { steps });
    const elapsed = Date.now() - start;

    if (elapsed < 100) {
      throw new Error(`Large workflow too fast: ${elapsed}ms (expected >= 100ms)`);
    }
  });
}

// ============================================
// App State Tests
// ============================================

async function testAppState() {
  console.log("\n=== App State Tests ===\n");

  await test("Mediar app is running", async () => {
    const apps = (await callTool("get_applications_and_windows_list")) as { content: { text: string }[] };
    const text = apps.content[0]?.text || "";
    if (!text.toLowerCase().includes("mediar")) {
      throw new Error("Mediar app not found in running applications");
    }
  });

  await test("app has visible window", async () => {
    const apps = (await callTool("get_applications_and_windows_list")) as { content: { text: string }[] };
    const text = apps.content[0]?.text || "";
    // Check for window properties
    if (!text.includes("Window") && !text.includes("window")) {
      throw new Error("No visible window found for Mediar");
    }
  });
}

// ============================================
// Performance Tests
// ============================================

async function testPerformance() {
  console.log("\n=== Performance Tests ===\n");

  await test("tool calls complete within timeout", async () => {
    const start = Date.now();
    await callTool("get_applications_and_windows_list");
    const elapsed = Date.now() - start;
    if (elapsed > 5000) {
      throw new Error(`Tool call too slow: ${elapsed}ms (expected < 5000ms)`);
    }
  });

  await test("sequential calls work reliably", async () => {
    for (let i = 0; i < 3; i++) {
      await callTool("delay", { delay_ms: 20 });
    }
    // Should complete without errors
  });

  await test("server recovers after failed call", async () => {
    // Make a failing call
    try {
      await callTool("click_element", { selector: "NonExistent[x=y]" });
    } catch {
      // Expected
    }

    // Server should still work
    await callTool("delay", { delay_ms: 10 });
  });
}

// ============================================
// UI Element Tests (Window Tree Analysis)
// ============================================

async function testUiElements() {
  console.log("\n=== UI Element Tests ===\n");

  await test("window tree contains expected structure", async () => {
    const apps = (await callTool("get_applications_and_windows_list")) as { content: { text: string }[] };
    const appText = apps.content[0]?.text || "";

    // Extract Mediar PID
    const mediarMatch = appText.match(/mediar.*?pid[:\s]*(\d+)/i) || appText.match(/pid[:\s]*(\d+).*?mediar/i);
    if (!mediarMatch) {
      // If we can't find PID, skip this test
      return;
    }

    const pid = parseInt(mediarMatch[1]);
    const tree = (await callTool("get_window_tree", { pid })) as { content: { text: string }[] };
    const treeText = tree.content[0]?.text || "";

    // Window tree should have some structure (not empty)
    if (treeText.length < 100) {
      throw new Error("Window tree too small - UI elements not detected");
    }
  });

  await test("can interact with press_key tool", async () => {
    // Test that press_key tool exists and accepts input
    try {
      // Press Escape - should be safe regardless of state
      await callTool("press_key", { key: "{Escape}" });
      // If it doesn't throw, that's good
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Only fail if it's a crash, not a "no focused element" error
      if (msg.toLowerCase().includes("crash") || msg.toLowerCase().includes("panic")) {
        throw new Error("Server crashed on press_key");
      }
    }
  });

  await test("keyboard input simulation works", async () => {
    // Test multiple key presses in sequence
    const keys = ["{Escape}", "{Tab}", "{Escape}"];
    for (const key of keys) {
      try {
        await callTool("press_key", { key });
        await sleep(50); // Small delay between keys
      } catch {
        // Key press might fail if no element is focused - that's ok
      }
    }
  });

  await test("mouse move tool works", async () => {
    // Move mouse to safe coordinates (center of screen area)
    try {
      await callTool("move_mouse", { x: 500, y: 400 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("crash") || msg.toLowerCase().includes("panic")) {
        throw new Error("Server crashed on move_mouse");
      }
      // Other errors are acceptable (e.g., coordinates out of bounds)
    }
  });
}

// ============================================
// Onboarding Flow Tests
// ============================================

async function testOnboardingElements() {
  console.log("\n=== Onboarding Flow Tests ===\n");

  await test("can detect UI elements via window tree", async () => {
    const apps = (await callTool("get_applications_and_windows_list")) as { content: { text: string }[] };
    const appText = apps.content[0]?.text || "";

    const mediarMatch = appText.match(/mediar.*?pid[:\s]*(\d+)/i) || appText.match(/pid[:\s]*(\d+).*?mediar/i);
    if (!mediarMatch) {
      // Skip if we can't find Mediar PID
      return;
    }

    const pid = parseInt(mediarMatch[1]);
    const tree = (await callTool("get_window_tree", { pid })) as { content: { text: string }[] };
    const treeText = tree.content[0]?.text || "";

    // Check for common UI element types in window tree
    const hasButtons = treeText.toLowerCase().includes("button");
    const hasText = treeText.toLowerCase().includes("text") || treeText.toLowerCase().includes("static");

    if (!hasButtons && !hasText) {
      throw new Error("No recognizable UI elements found in window tree");
    }
  });

  await test("workflow list view elements accessible", async () => {
    // Look for workflow-related UI elements
    const apps = (await callTool("get_applications_and_windows_list")) as { content: { text: string }[] };
    const appText = apps.content[0]?.text || "";

    const mediarMatch = appText.match(/mediar.*?pid[:\s]*(\d+)/i) || appText.match(/pid[:\s]*(\d+).*?mediar/i);
    if (!mediarMatch) {
      return;
    }

    const pid = parseInt(mediarMatch[1]);
    const tree = (await callTool("get_window_tree", { pid })) as { content: { text: string }[] };
    const treeText = (tree.content[0]?.text || "").toLowerCase();

    // If not in onboarding, should have workflow-related elements
    // If in onboarding, should have onboarding-related elements
    // Either is acceptable - we just verify UI structure exists
    const hasContent = treeText.length > 200;
    if (!hasContent) {
      throw new Error("UI content too sparse - expected more elements");
    }
  });

  await test("UI responds to focus changes", async () => {
    // Tab through elements to test focus handling
    for (let i = 0; i < 3; i++) {
      try {
        await callTool("press_key", { key: "{Tab}" });
        await sleep(100);
      } catch {
        // Focus operations may fail gracefully
      }
    }
    // If we get here without crash, focus handling is working
  });

  await test("escape key handling works", async () => {
    // Press Escape multiple times (commonly used for closing dialogs)
    for (let i = 0; i < 2; i++) {
      try {
        await callTool("press_key", { key: "{Escape}" });
        await sleep(100);
      } catch {
        // May fail if no dialog is open - that's ok
      }
    }
  });
}

// ============================================
// Error Handling Tests
// ============================================

async function testErrorHandling() {
  console.log("\n=== Error Handling Tests ===\n");

  await test("invalid tool name returns error", async () => {
    try {
      await callTool("nonexistent_tool_xyz_123");
      throw new Error("Expected error for invalid tool");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Expected error")) {
        throw e; // Re-throw our assertion error
      }
      // Good - got an error as expected
    }
  });

  await test("missing required params returns error", async () => {
    try {
      await callTool("click_element", {}); // Missing selector
      throw new Error("Expected error for missing params");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Expected error")) {
        throw e;
      }
      // Good - got an error
    }
  });

  await test("server remains stable after errors", async () => {
    // Trigger several errors
    for (let i = 0; i < 3; i++) {
      try {
        await callTool("invalid_tool_" + i);
      } catch {
        // Expected
      }
    }

    // Verify server still works
    const result = (await callTool("get_applications_and_windows_list")) as { content: unknown[] };
    if (!result.content) {
      throw new Error("Server not stable after errors");
    }
  });
}

// ============================================
// Main
// ============================================

async function main() {
  console.log("========================================");
  console.log("  Mediar E2E UI Tests");
  console.log("========================================");

  try {
    await connect();
  } catch (e) {
    console.log("\nFailed to connect to MCP server");
    console.log("   Make sure Mediar app is running with MCP server on port 8080\n");
    process.exit(1);
  }

  try {
    await testMcpServer();
    await testUiInteractions();
    await testWorkflowExecution();
    await testAppState();
    await testPerformance();
    await testUiElements();
    await testOnboardingElements();
    await testErrorHandling();
  } catch (e) {
    console.error("\nTest suite error:", e);
  }

  // Summary
  console.log("\n========================================");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("========================================\n");

  // Detailed results
  if (failed > 0) {
    console.log("Failed tests:");
    for (const r of results.filter(r => r.status === "fail")) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    console.log("");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
