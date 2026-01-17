import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the invoke function
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("MCP Health Check During Tool Execution", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue(undefined);
  });

  it("should notify backend when tool execution starts and ends", async () => {
    // Import after mocking
    const { McpClient } = await import("../../lib/mcp-client");
    const client = new McpClient();

    // Mock the internal client to simulate a connected state
    (client as any).client = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"result": "test"}' }],
      }),
      fallbackNotificationHandler: null,
    };
    (client as any).serverInfo = { port: 3000, isConnected: true, url: "http://localhost:3000" };

    // Call a tool
    await client.callTool("test_tool", { arg: "value" });

    // Verify set_mcp_tool_executing was called with true (start)
    const startCall = mockInvoke.mock.calls.find(
      call => call[0] === "set_mcp_tool_executing" && call[1]?.executing === true
    );
    expect(startCall).toBeDefined();

    // Verify set_mcp_tool_executing was called with false (end)
    const endCall = mockInvoke.mock.calls.find(
      call => call[0] === "set_mcp_tool_executing" && call[1]?.executing === false
    );
    expect(endCall).toBeDefined();
  });

  it("should only notify backend once for concurrent tool executions on same client", async () => {
    // Import after mocking and resetting
    const { McpClient } = await import("../../lib/mcp-client");
    const client = new McpClient();

    // Track call order to verify behavior
    let resolveFirst: () => void;
    let resolveSecond: () => void;
    const firstPromise = new Promise<void>(r => {
      resolveFirst = r;
    });
    const secondPromise = new Promise<void>(r => {
      resolveSecond = r;
    });

    // Mock connected state with controllable responses
    let callCount = 0;
    (client as any).client = {
      callTool: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return firstPromise.then(() => ({
            content: [{ type: "text", text: '{"result": "first"}' }],
          }));
        }
        return secondPromise.then(() => ({
          content: [{ type: "text", text: '{"result": "second"}' }],
        }));
      }),
      fallbackNotificationHandler: null,
    };
    (client as any).serverInfo = { port: 3000, isConnected: true, url: "http://localhost:3000" };

    // Start two tools concurrently (using the SAME client instance)
    const tool1Promise = client.callTool("tool1", {});
    const tool2Promise = client.callTool("tool2", {});

    // At this point, both tools are "in progress"
    // Only the first one should have triggered set_mcp_tool_executing(true)
    const startCallsDuringExecution = mockInvoke.mock.calls.filter(
      call => call[0] === "set_mcp_tool_executing" && call[1]?.executing === true
    );
    expect(startCallsDuringExecution.length).toBe(1);

    // Resolve both tools
    resolveFirst!();
    resolveSecond!();
    await Promise.all([tool1Promise, tool2Promise]);

    // After both complete, should have one false call
    const endCalls = mockInvoke.mock.calls.filter(
      call => call[0] === "set_mcp_tool_executing" && call[1]?.executing === false
    );
    // Only one call to false (when last tool ends)
    expect(endCalls.length).toBe(1);
  });

  it("should track activeToolExecutions counter correctly", async () => {
    const { McpClient } = await import("../../lib/mcp-client");
    const client = new McpClient();

    expect(client.isToolExecuting()).toBe(false);

    // Simulate starting a tool (manually increment for testing)
    (client as any).activeToolExecutions = 1;
    expect(client.isToolExecuting()).toBe(true);

    // Simulate second tool starting
    (client as any).activeToolExecutions = 2;
    expect(client.isToolExecuting()).toBe(true);

    // Simulate first tool ending
    (client as any).activeToolExecutions = 1;
    expect(client.isToolExecuting()).toBe(true);

    // Simulate last tool ending
    (client as any).activeToolExecutions = 0;
    expect(client.isToolExecuting()).toBe(false);
  });
});
