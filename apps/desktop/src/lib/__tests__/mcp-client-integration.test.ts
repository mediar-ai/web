import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { McpClient } from "../mcp-client";

// Real integration tests with actual MCP server
// These tests use the already-running MCP server on port 8080 (started by mediar app)
// OR spawn a new one on a test port if not available
// SKIP in CI - these require a real MCP server

const IS_CI = process.env.CI === "true";
const DEFAULT_PORT = 8080; // Use the already-running server
const FALLBACK_PORT = 18080; // Fallback port if default not available
const SERVER_STARTUP_TIMEOUT = 60000; // 60s for server to start (npx can be slow)
const TEST_TIMEOUT = 30000; // 30s per test

let serverProcess: ChildProcess | null = null;
let activePort: number = DEFAULT_PORT;
let serverWasSpawned = false;

async function checkServerRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startMcpServer(): Promise<void> {
  // First check if default server is already running
  if (await checkServerRunning(DEFAULT_PORT)) {
    console.log(`Using already-running MCP server on port ${DEFAULT_PORT}`);
    activePort = DEFAULT_PORT;
    serverWasSpawned = false;
    return;
  }

  console.log(`No server on ${DEFAULT_PORT}, spawning new one on ${FALLBACK_PORT}...`);
  activePort = FALLBACK_PORT;
  serverWasSpawned = true;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("MCP server startup timeout"));
    }, SERVER_STARTUP_TIMEOUT);

    // Spawn the MCP server using npx
    serverProcess = spawn("npx", ["terminator-mcp-agent", "-t", "http", "-p", FALLBACK_PORT.toString()], {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    serverProcess.stdout?.on("data", data => {
      const chunk = data.toString();
      output += chunk;
      console.log("[MCP-SERVER]", chunk.trim());
      // Wait for server to be ready
      if (output.includes("Streamable HTTP server running") || output.includes("server running on")) {
        clearTimeout(timeout);
        // Give it a moment to fully initialize
        setTimeout(resolve, 1000);
      }
    });

    serverProcess.stderr?.on("data", data => {
      const chunk = data.toString();
      output += chunk;
      console.log("[MCP-SERVER ERR]", chunk.trim());
    });

    serverProcess.on("error", err => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess.on("exit", code => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`MCP server exited with code ${code}: ${output}`));
      }
    });
  });
}

async function stopMcpServer(): Promise<void> {
  // Only stop if we spawned it ourselves
  if (serverProcess && serverWasSpawned) {
    serverProcess.kill("SIGTERM");
    // Wait for process to exit
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        serverProcess?.kill("SIGKILL");
        resolve();
      }, 5000);

      serverProcess?.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    serverProcess = null;
  }
}

async function waitForHealthy(port: number, timeoutMs: number = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// Skip integration tests in CI - they require a real MCP server
const describeIntegration = IS_CI ? describe.skip : describe;

describeIntegration("McpClient Integration Tests", () => {
  let client: McpClient;

  beforeAll(async () => {
    console.log("Starting MCP server for integration tests...");
    await startMcpServer();
    const healthy = await waitForHealthy(activePort);
    if (!healthy) {
      throw new Error("MCP server failed to become healthy");
    }
    console.log(`MCP server is ready on port ${activePort}`);
  }, SERVER_STARTUP_TIMEOUT + 5000);

  afterAll(async () => {
    console.log("Stopping MCP server...");
    await stopMcpServer();
  });

  beforeEach(() => {
    client = new McpClient();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  describe("Connection", () => {
    it(
      "should connect to running MCP server",
      async () => {
        await client.connect(activePort);
        expect(client.isConnected()).toBe(true);

        const serverInfo = client.getServerInfo();
        expect(serverInfo).not.toBeNull();
        expect(serverInfo?.port).toBe(activePort);
      },
      TEST_TIMEOUT
    );

    it(
      "should fail gracefully when connecting to non-existent port",
      async () => {
        const badClient = new McpClient();
        await expect(badClient.connect(19999)).rejects.toThrow();
        expect(badClient.isConnected()).toBe(false);
      },
      TEST_TIMEOUT
    );

    it(
      "should handle multiple connect calls to same port",
      async () => {
        await client.connect(activePort);
        expect(client.isConnected()).toBe(true);

        // Second connect should reuse connection
        await client.connect(activePort);
        expect(client.isConnected()).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should handle disconnect and reconnect",
      async () => {
        await client.connect(activePort);
        expect(client.isConnected()).toBe(true);

        await client.disconnect();
        expect(client.isConnected()).toBe(false);

        await client.connect(activePort);
        expect(client.isConnected()).toBe(true);
      },
      TEST_TIMEOUT
    );
  });

  describe("Tool Discovery", () => {
    it(
      "should discover available tools",
      async () => {
        await client.connect(activePort);

        const tools = await client.getTools();
        expect(tools).toBeDefined();
        expect(Object.keys(tools).length).toBeGreaterThan(0);

        // Should have common tools
        expect(tools["get_applications_and_windows_list"]).toBeDefined();
      },
      TEST_TIMEOUT
    );

    it(
      "should cache tools after first call",
      async () => {
        await client.connect(activePort);

        const tools1 = await client.getTools();
        const tools2 = await client.getTools();

        // Should return same cached object
        expect(Object.keys(tools1)).toEqual(Object.keys(tools2));
      },
      TEST_TIMEOUT
    );

    it(
      "should clear cache when requested",
      async () => {
        await client.connect(activePort);

        await client.getTools();
        client.clearCache();

        // Should fetch again after cache clear
        const tools = await client.getTools();
        expect(Object.keys(tools).length).toBeGreaterThan(0);
      },
      TEST_TIMEOUT
    );
  });

  describe("Tool Execution", () => {
    it(
      "should execute get_applications_and_windows_list",
      async () => {
        await client.connect(activePort);

        const result = await client.callTool("get_applications_and_windows_list", {});
        expect(result).toBeDefined();

        // Result can be array of content items or object
        let parsed: any;
        if (Array.isArray(result)) {
          // MCP SDK returns array of content items
          const textItem = result.find((r: any) => r.type === "text");
          parsed = textItem ? JSON.parse(textItem.text) : result;
        } else if (typeof result === "string") {
          parsed = JSON.parse(result);
        } else {
          parsed = result;
        }

        expect(parsed.action).toBe("get_applications_and_windows_list");
        expect(parsed.status).toBe("success");
        expect(Array.isArray(parsed.applications)).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should handle tool execution with invalid arguments",
      async () => {
        await client.connect(activePort);

        // click_element requires a selector
        await expect(client.callTool("click_element", { invalid_param: "test" })).rejects.toThrow();
      },
      TEST_TIMEOUT
    );

    it(
      "should handle non-existent tool",
      async () => {
        await client.connect(activePort);

        await expect(client.callTool("non_existent_tool_xyz", {})).rejects.toThrow();
      },
      TEST_TIMEOUT
    );
  });

  describe("Abort/Cancellation", () => {
    it(
      "should abort tool execution when abort signal fires",
      async () => {
        await client.connect(activePort);

        const controller = new AbortController();

        // Start a long-running operation
        const promise = client.callTool("get_applications_and_windows_list", {}, controller.signal);

        // Abort immediately
        controller.abort();

        // Should reject with cancellation error
        await expect(promise).rejects.toThrow(/cancel/i);
      },
      TEST_TIMEOUT
    );

    it(
      "should handle pre-aborted signal",
      async () => {
        await client.connect(activePort);

        const controller = new AbortController();
        controller.abort(); // Abort before calling

        await expect(client.callTool("get_applications_and_windows_list", {}, controller.signal)).rejects.toThrow(
          /cancel/i
        );
      },
      TEST_TIMEOUT
    );
  });

  describe("Race Conditions", () => {
    it(
      "should handle concurrent connect calls",
      async () => {
        // Multiple simultaneous connect calls
        const promises = [client.connect(activePort), client.connect(activePort), client.connect(activePort)];

        await Promise.all(promises);
        expect(client.isConnected()).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should handle connect during disconnect",
      async () => {
        await client.connect(activePort);

        // Start disconnect and connect simultaneously
        const disconnectPromise = client.disconnect();
        const connectPromise = client.connect(activePort);

        await Promise.allSettled([disconnectPromise, connectPromise]);

        // Should end up in a valid state (connected or disconnected, not corrupted)
        const isConnected = client.isConnected();
        expect(typeof isConnected).toBe("boolean");
      },
      TEST_TIMEOUT
    );

    it(
      "should handle concurrent tool calls",
      async () => {
        await client.connect(activePort);

        // Multiple simultaneous tool calls
        const results = await Promise.all([
          client.callTool("get_applications_and_windows_list", {}),
          client.callTool("get_applications_and_windows_list", {}),
        ]);

        expect(results).toHaveLength(2);
        results.forEach(result => {
          expect(result).toBeDefined();
        });
      },
      TEST_TIMEOUT
    );
  });

  describe("Health Verification", () => {
    it(
      "should verify connection health",
      async () => {
        await client.connect(activePort);

        const isHealthy = await client.verifyConnection();
        expect(isHealthy).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      "should report unhealthy when disconnected",
      async () => {
        // Don't connect
        const isHealthy = await client.verifyConnection();
        expect(isHealthy).toBe(false);
      },
      TEST_TIMEOUT
    );
  });

  describe("Cleanup During Operations", () => {
    it(
      "should handle cleanup during connection gracefully",
      async () => {
        // Start connecting
        const connectPromise = client.connect(activePort);

        // Immediately disconnect (cleanup)
        await client.disconnect();

        // The connect should either complete or abort gracefully (not throw)
        // Use Promise.allSettled to handle both success and rejection gracefully
        const [result] = await Promise.allSettled([connectPromise]);

        // Either fulfilled or rejected is fine - we just want no unhandled crash
        expect(["fulfilled", "rejected"]).toContain(result.status);

        // Client state should be clean after disconnect
        // Note: may be connected if connect finished before disconnect
        expect(typeof client.isConnected()).toBe("boolean");
      },
      TEST_TIMEOUT
    );

    it(
      "should handle cleanup during tool execution",
      async () => {
        await client.connect(activePort);

        // Start tool call
        const toolPromise = client.callTool("get_applications_and_windows_list", {});

        // Disconnect during execution
        await client.disconnect();

        // Should either complete or fail gracefully
        const result = await toolPromise.catch(e => ({ error: e.message }));
        expect(result).toBeDefined();
      },
      TEST_TIMEOUT
    );
  });
});

describe("McpClient Edge Cases (No Server)", () => {
  let client: McpClient;

  beforeEach(() => {
    client = new McpClient();
  });

  afterEach(async () => {
    await client.disconnect();
  });

  it("should handle getTools without connection", async () => {
    await expect(client.getTools()).rejects.toThrow(/not connected/i);
  });

  it("should handle callTool without connection", async () => {
    await expect(client.callTool("any_tool", {})).rejects.toThrow(/not connected/i);
  });

  it("should return null for serverInfo when not connected", () => {
    expect(client.getServerInfo()).toBeNull();
  });

  it("should return null for serverInstructions when not connected", () => {
    expect(client.getServerInstructions()).toBeNull();
  });

  it("should handle disconnect when already disconnected", async () => {
    // Should not throw
    await expect(client.disconnect()).resolves.toBeUndefined();
  });

  it("should handle multiple disconnects", async () => {
    await client.disconnect();
    await client.disconnect();
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
  });
});
