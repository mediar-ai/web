import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/core";
import { ingestMcpToolExecution } from "../services/mcp-ingestion";
import { mcpLogger } from "./logger";
import { McpToolsResponseSchema, McpInitializeResponseSchema, validateMcpResponse } from "./schemas/mcp";
import { requestElicitation, convertMcpRequest, convertMcpResponse } from "./elicitation/mcp-integration";

export interface McpServerInfo {
  port: number;
  isConnected: boolean;
  url: string;
  instructions?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
}

// Progress callback for tool execution
export type ProgressCallback = (progress: {
  type: "console" | "progress" | "status";
  timestamp: number;
  message?: string;
  level?: "log" | "error" | "warn" | "info";
  percentage?: number;
  currentStep?: number;
  totalSteps?: number;
  state?: string;
}) => void;

// Elicitation interfaces
export interface ElicitationRequest {
  message: string;
  schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ElicitationResponse {
  data: Record<string, any>;
  cancelled?: boolean;
}

export class McpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private serverInfo: McpServerInfo | null = null;
  private isConnecting: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private serverInstructions: string | null = null;
  private requestCounter: number = 0;
  private currentRequestAbortController: AbortController | null = null;
  private currentProgressCallback: ProgressCallback | null = null;
  // Track active tool executions to skip health checks during long-running tools
  private activeToolExecutions: number = 0;
  // Connection ID to detect stale connection attempts after cleanup
  private connectionId: number = 0;

  async connect(port: number): Promise<void> {
    // If already connected to this port, reuse the connection
    // If connection is stale, subsequent operations will fail and trigger cleanup
    if (this.serverInfo && this.serverInfo.port === port && this.client !== null) {
      return;
    }

    // If currently connecting to this port, wait for that connection
    if (this.isConnecting && this.connectionPromise) {
      await this.connectionPromise;
      return;
    }

    // Start new connection
    this.isConnecting = true;
    this.connectionPromise = this._performConnection(port);

    try {
      await this.connectionPromise;
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  // Helper: Find which port actually has a working MCP server
  private async findWorkingPort(startPort: number = 8080, endPort: number = 8200): Promise<number | null> {
    console.log(`🔍 [MCP-CLIENT] Scanning ports ${startPort}-${endPort} for working MCP server...`);

    for (let port = startPort; port <= endPort; port++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          method: "GET",
          signal: AbortSignal.timeout(500), // Quick timeout
        });

        if (response.ok) {
          console.log(`✅ [MCP-CLIENT] Found working MCP server on port ${port}`);
          return port;
        }
      } catch {
        // Port not responding, continue scanning
      }
    }

    console.log("❌ [MCP-CLIENT] No working MCP server found in port range");
    return null;
  }

  private async _performConnection(port: number): Promise<void> {
    // Capture connection ID at start to detect if cleanup happened during async operations
    const myConnectionId = ++this.connectionId;

    try {
      const httpUrl = `http://127.0.0.1:${port}/mcp`;
      console.log("🚀 [MCP-CLIENT] Starting connection to:", httpUrl);

      // Clean up any existing connections first
      await this.cleanupConnection();
      console.log("🧹 [MCP-CLIENT] Cleaned up old connections");

      // Check if cleanup happened during our connection attempt
      if (this.connectionId !== myConnectionId) {
        console.warn("⚠️ [MCP-CLIENT] Connection attempt invalidated by newer cleanup - aborting");
        return;
      }

      // Skip health check - we trust backend's is_ready flag
      // Backend already verified /health and /mcp endpoints are responding
      console.log("⏭️ [MCP-CLIENT] Skipping health check (trusting backend is_ready flag)");

      // Create StreamableHTTP transport with request tracking headers
      // CRITICAL: MCP server v0.23+ requires Accept header with both json and SSE
      this.transport = new StreamableHTTPClientTransport(new URL(httpUrl), {
        headers: {
          Accept: "application/json, text/event-stream",
          "X-Request-ID": `mediar-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          "X-Request-Timeout-Ms": "30000", // 30 second timeout
        },
      } as any);

      // Set up transport close/error listeners to detect silent disconnects
      if (this.transport) {
        const transport = this.transport as any;
        if (typeof transport.onclose === "undefined") {
          transport.onclose = () => {
            console.error("🔌 [MCP-CLIENT] Transport closed unexpectedly!");
            if (this.serverInfo) {
              this.serverInfo.isConnected = false;
            }
          };
        }
        if (typeof transport.onerror === "undefined") {
          transport.onerror = (error: any) => {
            console.error("🔌 [MCP-CLIENT] Transport error:", error);
            if (this.serverInfo) {
              this.serverInfo.isConnected = false;
            }
          };
        }
        console.log("📡 [MCP-CLIENT] Transport event listeners attached");
      }

      // Create MCP client with elicitation capabilities
      this.client = new Client(
        {
          name: "mediar-app",
          version: "1.0.0",
        },
        {
          capabilities: {
            sampling: {
              tools: {},
            },
            elicitation: {}, // Enable elicitation capability
          },
        }
      );

      // Set up notification handler BEFORE connecting (important for receiving all notifications)
      this.client.fallbackNotificationHandler = async (notification: any) => {
        // Debug: log all incoming notifications to see what we're getting
        console.log(`🔔 [MCP-CLIENT] Notification received: ${notification.method}`, notification.params);

        // Handle progress notifications from terminator-mcp-agent
        // Method name is "notifications/progress" per MCP spec
        if (notification.method === "notifications/progress" || notification.method === "progress") {
          const current = notification.params?.progress;
          const total = notification.params?.total;
          const message = notification.params?.message || "";
          const level = notification.params?.level || "log";

          // Dispatch workflow-progress event for UI components (chat progress indicator)
          window.dispatchEvent(
            new CustomEvent("workflow-progress", {
              detail: {
                current,
                total,
                message,
                timestamp: Date.now(),
              },
            })
          );

          // If we have a progress callback stored, use it (for console logs)
          if (this.currentProgressCallback) {
            this.currentProgressCallback({
              type: "console",
              timestamp: Date.now(),
              message: message,
              level: level as "log" | "error" | "warn" | "info",
            });
          }
        }

        // Handle workflow.status and workflow step progress notifications
        // MCP SDK uses "notifications/logging/message" for logging messages
        if (
          notification.method === "notifications/logging/message" ||
          notification.method === "notifications/message"
        ) {
          const logger = notification.params?.logger;

          // Handle real-time workflow step progress notifications
          if (logger === "workflow") {
            const data = notification.params?.data;
            if (data?.type === "step_started") {
              console.log(`📍 [MCP-CLIENT] Step started: ${data.name} (${data.step}/${data.total})`);
              window.dispatchEvent(
                new CustomEvent("workflow-step-started", {
                  detail: {
                    stepIndex: data.step - 1, // Convert 1-based to 0-based
                    stepName: data.name,
                    totalSteps: data.total,
                  },
                })
              );
            } else if (data?.type === "step_completed") {
              console.log(`✅ [MCP-CLIENT] Step completed: ${data.name} (${data.duration_ms}ms)`);
              window.dispatchEvent(
                new CustomEvent("workflow-step-completed", {
                  detail: {
                    stepIndex: data.step - 1, // Convert 1-based to 0-based
                    stepName: data.name,
                    durationMs: data.duration_ms,
                  },
                })
              );
            } else if (data?.type === "step_failed") {
              console.log(`❌ [MCP-CLIENT] Step failed: ${data.name} - ${data.error}`);
              window.dispatchEvent(
                new CustomEvent("workflow-step-failed", {
                  detail: {
                    stepName: data.name,
                    error: data.error,
                  },
                })
              );
            }
          }
        }
      };

      // Instead of manually handling initialization, properly connect the SDK client
      // This ensures the SDK client manages its own initialization state
      await this.client.connect(this.transport);
      console.log("✅ [MCP-CLIENT] Client connected and initialized via SDK");

      // Verify notification handler is still set after connect
      console.log("🔍 [MCP-CLIENT] fallbackNotificationHandler set:", !!this.client.fallbackNotificationHandler);

      // Log session ID for debugging
      const sessionId = (this.transport as any)?._sessionId || (this.transport as any)?.sessionId;
      console.log("🔑 [MCP-CLIENT] Session ID:", sessionId || "none");

      // CRITICAL DEBUG: Intercept transport.onmessage to see ALL raw messages
      // This helps us understand if messages are arriving but not being routed correctly
      if (this.transport) {
        const transport = this.transport as any;
        const originalOnMessage = transport.onmessage;
        transport.onmessage = (message: any, extra: any) => {
          // Log every single message that arrives at the transport level
          const msgType = message?.method
            ? "notification/request"
            : message?.result !== undefined || message?.error !== undefined
              ? "response"
              : "unknown";
          console.log(`📬 [MCP-TRANSPORT] Raw message (${msgType}):`, JSON.stringify(message).substring(0, 200));

          // Call the original handler
          if (originalOnMessage) {
            originalOnMessage.call(transport, message, extra);
          }
        };
        console.log("📬 [MCP-CLIENT] Transport message interceptor installed");

        // DEBUG: Also intercept onerror to see transport errors
        const originalOnError = transport.onerror;
        transport.onerror = (error: any) => {
          console.error(`🚨 [MCP-TRANSPORT] Transport error:`, error);
          if (originalOnError) {
            originalOnError.call(transport, error);
          }
        };

        // WORKAROUND: Replace _handleSseStream with WebView2-compatible implementation
        // The original uses pipeThrough(TextDecoderStream).pipeThrough(EventSourceParserStream)
        // which doesn't work correctly in WebView2. We manually parse SSE events instead.
        transport._handleSseStream = (stream: any, options: any, isReconnectable: boolean) => {
          console.log(
            `🌊 [MCP-TRANSPORT] _handleSseStream (WebView2 workaround), stream:`,
            !!stream,
            `isReconnectable:`,
            isReconnectable
          );

          if (!stream) {
            console.log(`🌊 [MCP-TRANSPORT] No stream provided, returning`);
            return;
          }

          // Manual SSE parsing that works in WebView2
          const processStream = async () => {
            try {
              const reader = stream.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              while (true) {
                const { value, done } = await reader.read();
                if (done) {
                  console.log(`🌊 [MCP-TRANSPORT] Stream done`);
                  break;
                }

                // Decode the chunk and add to buffer
                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE events (double newline separated)
                const events = buffer.split(/\n\n/);
                // Keep the last incomplete event in buffer
                buffer = events.pop() || "";

                for (const eventText of events) {
                  if (!eventText.trim()) continue;

                  // Parse SSE event
                  let eventType = "message";
                  let eventData = "";
                  let eventId: string | undefined;

                  for (const line of eventText.split("\n")) {
                    if (line.startsWith("event:")) {
                      eventType = line.slice(6).trim();
                    } else if (line.startsWith("data:")) {
                      eventData += (eventData ? "\n" : "") + line.slice(5).trim();
                    } else if (line.startsWith("id:")) {
                      eventId = line.slice(3).trim();
                    }
                  }

                  if (!eventData) continue;

                  console.log(
                    `🌊 [MCP-TRANSPORT] SSE event: type=${eventType}, id=${eventId}, data=${eventData.substring(0, 100)}...`
                  );

                  // Parse JSON-RPC message and dispatch
                  if (eventType === "message" || !eventType) {
                    try {
                      const message = JSON.parse(eventData);

                      // Check if this is a notification (has method, no id) or response (has id)
                      if (message.method && !("id" in message)) {
                        // This is a notification - dispatch through fallbackNotificationHandler
                        console.log(`🔔 [MCP-TRANSPORT] Notification received: ${message.method}`);
                        if (this.client?.fallbackNotificationHandler) {
                          this.client.fallbackNotificationHandler({
                            method: message.method,
                            params: message.params,
                          });
                        }
                      } else {
                        // This is a response or request - use onmessage
                        if (transport.onmessage) {
                          transport.onmessage(message, undefined);
                        }
                      }
                    } catch (parseError) {
                      console.error(`🌊 [MCP-TRANSPORT] Failed to parse SSE data:`, parseError, eventData);
                    }
                  }
                }
              }
            } catch (error) {
              console.error(`🌊 [MCP-TRANSPORT] Stream processing error:`, error);
              // Don't reconnect for POST SSE streams (isReconnectable=false)
              if (isReconnectable) {
                console.log(`🌊 [MCP-TRANSPORT] Would reconnect, but disabled for WebView2`);
              }
            }
          };

          // Start processing (don't await - run in background)
          processStream();
        };
        console.log("🌊 [MCP-CLIENT] SSE stream handler replaced (WebView2 workaround)");

        // WORKAROUND: Disable GET SSE stream entirely - it doesn't work in WebView2
        // The GET SSE stream is OPTIONAL per MCP spec and is for server-initiated notifications
        // Notifications during tool calls come through the POST response SSE stream instead
        // This stops the constant retry loop that floods logs with "Transport error: {}"
        const originalStartOrAuthSse = transport._startOrAuthSse?.bind(transport);
        if (originalStartOrAuthSse) {
          transport._startOrAuthSse = async (options: any) => {
            console.log(`📡 [MCP-TRANSPORT] _startOrAuthSse DISABLED (WebView2 SSE workaround)`);
            // Return immediately without opening GET SSE stream
            // This is valid per MCP spec - servers should treat lack of GET SSE as client not supporting it
            return;
          };
          console.log("📡 [MCP-CLIENT] GET SSE stream DISABLED (WebView2 compatibility)");
        }

        // DEBUG: Also intercept the send method to trace POST requests
        const originalSend = transport.send?.bind(transport);
        if (originalSend) {
          transport.send = async (message: any, options: any) => {
            const method = message?.method || (Array.isArray(message) ? message[0]?.method : "batch");
            console.log(`📤 [MCP-TRANSPORT] send() called: method=${method}, id=${message?.id}`);
            try {
              const result = await originalSend(message, options);
              console.log(`📤 [MCP-TRANSPORT] send() completed for ${method}`);
              return result;
            } catch (error: any) {
              console.error(`📤 [MCP-TRANSPORT] send() failed for ${method}:`, error?.message || error);
              throw error;
            }
          };
          console.log("📤 [MCP-CLIENT] Transport send interceptor installed");
        }
      }

      // Set up elicitation request handler
      this.client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
        console.log("📋 [MCP-CLIENT] Received elicitation request:", request.params?.message);
        try {
          // Only handle form mode (URL mode not supported in desktop app)
          if (request.params?.mode === "url") {
            console.log("⚠️ [MCP-CLIENT] URL mode elicitation not supported");
            return { action: "decline" };
          }
          const elicitRequest = convertMcpRequest(request.params);
          const response = await requestElicitation(elicitRequest);
          return convertMcpResponse(response);
        } catch (error) {
          console.error("❌ [MCP-CLIENT] Elicitation failed:", error);
          return { action: "decline" };
        }
      });

      // Guard against race condition where cleanup() was called during connect()
      if (!this.client || this.connectionId !== myConnectionId) {
        console.warn("⚠️ [MCP-CLIENT] Client was cleaned up during connection - aborting setup");
        return; // Don't throw - just silently abort since cleanup was intentional
      }

      // Wait a moment for the connection to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get server info to capture instructions using HTTP initialize (SSE) fallback directly
      let instructions: string | undefined;

      // Final fallback: explicitly POST JSON-RPC initialize to the /mcp HTTP endpoint and parse SSE
      if (!instructions) {
        try {
          const initBody = {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "mediar-app", version: "1.0.0" },
            },
          } as const;

          const res = await fetch(httpUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
            body: JSON.stringify(initBody),
          });

          const text = await res.text();
          // Parse first SSE data line
          const dataLine = text.split(/\r?\n/).find(l => l.startsWith("data: "));
          if (dataLine) {
            const jsonStr = dataLine.replace(/^data:\s*/, "");
            try {
              const payload = JSON.parse(jsonStr);

              // Validate initialize response with Zod
              const validation = validateMcpResponse(McpInitializeResponseSchema, payload?.result);
              if (!validation.success) {
                const error = "error" in validation ? validation.error : null;
                mcpLogger.warn("Initialize response validation failed", { error });
                // Fall back to manual extraction for compatibility
              }

              const fromResult = payload?.result?.instructions || payload?.result?.serverInfo?.instructions;
              if (fromResult && typeof fromResult === "string" && fromResult.trim().length > 0) {
                instructions = String(fromResult);
                this.serverInstructions = instructions;
              }
            } catch {
              // SSE payload parse failed
            }
          }
        } catch {
          // HTTP initialize fallback failed
        }
      }

      this.serverInfo = {
        port,
        isConnected: true,
        url: httpUrl,
        instructions,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check if this is a connection error (port mismatch or server not responding)
      const isConnectionError =
        errorMsg.includes("ERR_CONNECTION_REFUSED") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("Failed to fetch") ||
        errorMsg.includes("NetworkError");

      if (isConnectionError) {
        console.warn(`⚠️ [MCP-CLIENT] Connection to port ${port} failed, attempting auto-discovery...`);

        // Try to find the actual working port
        const workingPort = await this.findWorkingPort();

        if (workingPort && workingPort !== port) {
          console.warn(
            `🔄 [MCP-CLIENT] Port mismatch detected! Backend reported ${port}, but MCP server is on ${workingPort}`
          );
          console.warn(
            `🔄 [MCP-CLIENT] This usually means multiple app instances are running. Reconnecting to correct port...`
          );

          // Cleanup failed connection attempt
          await this.cleanup();

          // Retry with the working port
          return this._performConnection(workingPort);
        }
      }

      // No auto-recovery possible, cleanup and throw
      await this.cleanup();
      throw error;
    }
  }

  // Request user input through elicitation
  async requestInput(request: ElicitationRequest): Promise<ElicitationResponse> {
    if (!this.client) {
      throw new Error("MCP client not connected");
    }

    try {
      mcpLogger.info("Requesting user input for elicitation", { message: request.message });

      // For now, we'll simulate elicitation until the MCP server supports it
      // In a real implementation, this would send the request to the server
      mcpLogger.warn("Server-side elicitation not yet implemented, using client-side fallback");

      // Return a promise that will be resolved by the UI layer
      throw new Error("Elicitation not yet supported by MCP server - will be handled by UI layer");
    } catch (error) {
      mcpLogger.error("Failed to get user input for elicitation", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.cleanup();
  }

  // Clean up connection but preserve tool cache for multi-server support
  private async cleanupConnection(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }

      // Clear connection state but preserve tool caches for multi-server
      this.serverInfo = null;
      this.serverInstructions = null;
      this.isConnecting = false;
      this.connectionPromise = null;
      this.isGettingTools = false;
      this.getToolsPromise = null;
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  // Full cleanup including tool caches
  private async cleanup(): Promise<void> {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }

      // Clear all caches and state
      this.serverInfo = null;
      this.serverInstructions = null;
      this.toolsCache = null;
      this.isConnecting = false;
      this.connectionPromise = null;
      this.isGettingTools = false;
      this.getToolsPromise = null;
    } catch (error) {}
  }

  private toolsCache: Record<string, McpTool> | null = null;
  private isGettingTools: boolean = false;
  private getToolsPromise: Promise<Record<string, McpTool>> | null = null;

  async getTools(): Promise<Record<string, McpTool>> {
    if (!this.client) {
      throw new Error("MCP client not connected");
    }

    // If currently getting tools, wait for that request then return full cache
    if (this.isGettingTools && this.getToolsPromise) {
      await this.getToolsPromise;
      return this.toolsCache || {};
    }

    // Start new tools request
    this.isGettingTools = true;
    this.getToolsPromise = this._performGetTools();

    try {
      const tools = await this.getToolsPromise;

      // Cache tools for this connection
      this.toolsCache = tools;

      return this.toolsCache;
    } finally {
      this.isGettingTools = false;
      this.getToolsPromise = null;
    }
  }

  private async _performGetTools(): Promise<Record<string, McpTool>> {
    // Simple single attempt - no retries since we have singleton pattern
    try {
      console.log("🔧 [MCP-CLIENT] getTools: starting listTools()...");

      // List tools from server with timeout
      const response = (await Promise.race([
        this.client!.listTools(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("listTools timeout after 10s")), 10000)),
      ])) as any;

      console.log("🔧 [MCP-CLIENT] getTools: listTools() returned", response?.tools?.length || 0, "tools");

      // Validate response with Zod
      const validation = validateMcpResponse(McpToolsResponseSchema, response);
      if (!validation.success) {
        const error = "error" in validation ? validation.error : null;
        mcpLogger.warn("Tools response validation failed", { error });
        // Fall back to unvalidated parsing for compatibility
      }

      const tools: Record<string, McpTool> = {};

      if (response.tools) {
        for (const tool of response.tools) {
          tools[tool.name] = {
            name: tool.name,
            description: tool.description || "",
            inputSchema: tool.inputSchema || {},
          };
        }
      }

      return tools;
    } catch (error) {
      console.error("❌ [MCP-CLIENT] getTools: failed -", error instanceof Error ? error.message : error);
      throw error;
    }
  }

  // Legacy method for backward compatibility
  async discoverTools(): Promise<McpTool[]> {
    const tools = await this.getTools();
    return Object.values(tools);
  }

  /**
   * Send stop_execution to MCP server to cancel any running tools.
   * Safe to call even if not connected - will just log a warning.
   */
  async stopExecution(): Promise<void> {
    const startTime = Date.now();
    console.log(`📡 [STOP-DEBUG] stopExecution() called at ${startTime}`);

    if (!this.client) {
      console.warn("⚠️ [STOP-DEBUG] stopExecution called but client not connected - skipping");
      return;
    }

    console.log("[STOP-DEBUG] Sending stop_execution tool call to MCP server...");

    try {
      // Use a reasonable timeout - server needs time to:
      // 1. Receive the HTTP request
      // 2. Call request_manager.cancel_all()
      // 3. Call desktop.stop_execution()
      // 4. Kill any running child processes (TypeScript workflows)
      // 5. Return the response
      await this.client.callTool(
        {
          name: "stop_execution",
          arguments: {},
        },
        undefined,
        { timeout: 2000 }
      ); // 2 second timeout

      console.log(`✅ [STOP-DEBUG] stop_execution completed in ${Date.now() - startTime}ms`);
    } catch (err) {
      // This is expected if the server is busy or connection is closing
      console.warn(`⚠️ [STOP-DEBUG] stop_execution failed after ${Date.now() - startTime}ms:`, err);
      // Don't throw - this is best-effort
    }
  }

  // Keep private alias for internal abort handler
  private async sendStopExecution(): Promise<void> {
    return this.stopExecution();
  }

  async callTool(
    name: string,
    arguments_: any,
    abortSignal?: AbortSignal,
    progressCallback?: ProgressCallback,
    timeout?: number,
    workflow_name?: string,
    step_name?: string
  ): Promise<any> {
    const callToolStart = performance.now();
    console.log(`[PERF] mcpClient.callTool(${name}) started`);

    // Debug: verify notification handler is still set
    if (this.client) {
      console.log(
        `🔍 [MCP-CLIENT] callTool(${name}) - fallbackNotificationHandler set:`,
        !!this.client.fallbackNotificationHandler
      );
    }

    // Track active tool execution to prevent false health check failures
    this.activeToolExecutions++;

    // Notify backend when first tool starts executing (so backend skips health checks)
    if (this.activeToolExecutions === 1) {
      invoke("set_mcp_tool_executing", { executing: true }).catch(() => {
        // Ignore errors - this is best-effort notification
      });
    }

    if (!this.client) {
      this.activeToolExecutions--;
      // Notify backend if we're back to zero active executions
      if (this.activeToolExecutions === 0) {
        invoke("set_mcp_tool_executing", { executing: false }).catch(() => {});
      }
      throw new Error("MCP client not connected");
    }

    // Generate unique request ID for tracking
    const requestId = `tool-${name}-${Date.now()}-${++this.requestCounter}`;

    // Store the progress callback for this tool execution
    if (progressCallback) {
      this.currentProgressCallback = progressCallback;
    }

    // Create abort controller for this request
    this.currentRequestAbortController = new AbortController();

    // Link the external abort signal to our internal controller
    if (abortSignal) {
      if (abortSignal.aborted) {
        // If already aborted, throw immediately
        throw new Error(`Tool ${name} cancelled before execution`);
      }

      abortSignal.addEventListener(
        "abort",
        async () => {
          const abortTime = Date.now();
          console.log(`🛑 [STOP-DEBUG] Abort signal received for ${name} (request ${requestId}) at ${abortTime}`);

          // IMMEDIATE ACTION: Abort the local request controller
          // This will cause the Promise.race to reject quickly
          console.log("[STOP-DEBUG] Calling currentRequestAbortController.abort()");
          this.currentRequestAbortController?.abort();

          // ATTEMPT TO SEND STOP_EXECUTION - wait for it to complete
          // This is critical: the server needs time to cancel running operations
          // and kill any child processes (e.g., TypeScript workflows)
          let stopExecutionSucceeded = false;
          if (this.client && this.transport) {
            try {
              console.log("[STOP-DEBUG] Abort handler: awaiting sendStopExecution()...");
              await this.sendStopExecution();
              stopExecutionSucceeded = true;
              console.log(`✅ [STOP-DEBUG] Abort handler: stop_execution completed in ${Date.now() - abortTime}ms`);
            } catch (err) {
              console.warn(
                `⚠️ [STOP-DEBUG] Abort handler: stop_execution failed after ${Date.now() - abortTime}ms:`,
                err
              );
            }
          } else {
            console.warn("[STOP-DEBUG] Abort handler: no client/transport, skipping stop_execution");
          }

          // If stop_execution succeeded, give a bit more time for cleanup
          // If it failed, we'll force-close immediately
          if (stopExecutionSucceeded) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          // THEN FORCE DISCONNECT: Close the transport
          // This ensures we don't hang if stop_execution fails
          if (this.transport) {
            try {
              console.log("🔌 [STOP-DEBUG] Force-closing transport after stop attempt");
              // Force close the transport
              (this.transport as any).close?.();

              // Also try to abort any pending requests on the transport
              if ((this.transport as any).abort) {
                (this.transport as any).abort();
              }
              if ((this.transport as any).destroy) {
                (this.transport as any).destroy();
              }
            } catch (e) {
              mcpLogger.warn("Error during force transport close", { error: e });
            }
          }

          // Clear the connection state
          this.transport = null;
          this.client = null;
          if (this.serverInfo) {
            this.serverInfo = { ...this.serverInfo, isConnected: false };
          }

          console.log(
            `✅ [STOP-DEBUG] Abort handler complete (total ${Date.now() - abortTime}ms) - local aborted, stop_execution attempted, transport closed`
          );
        },
        { once: true }
      );
    }

    // Track execution start time for ingestion
    const startTime = Date.now();

    try {
      // HIGHLIGHTING DISABLED - Skip auto-injection of highlight_before_action
      const effectiveArguments = arguments_ || {};
      // const shouldAutoHighlight = (
      //   tool: string,
      // ) => tool === 'click_element' || tool === 'type_into_element' || tool === 'scroll_element' || tool === 'press_key';
      // if (shouldAutoHighlight(name) && !effectiveArguments.highlight_before_action) {
      //   const textMap: Record<string, string> = {
      //     click_element: 'CLICKING',
      //     type_into_element: 'TYPING',
      //     scroll_element: 'SCROLL',
      //     press_key: 'KEY',
      //   };
      //   const highlight = {
      //     enabled: true,
      //     duration_ms: 1500,
      //     color: 0x00FF00,
      //     text: textMap[name] || 'ACTION',
      //     text_position: 'Inside'
      //   } as const;
      //   effectiveArguments = { ...effectiveArguments, highlight_before_action: highlight };
      //   // console.log(`✨ [MCP] ${name}: injecting highlight_before_action`, highlight);
      // }

      // Build promises list for race
      const sdkCallStart = performance.now();
      const promises: Promise<any>[] = [
        this.client.callTool(
          {
            name,
            arguments: effectiveArguments || {},
          },
          undefined,
          timeout ? { timeout } : undefined
        ),
      ];

      // Add abort promise for internal abort controller
      if (this.currentRequestAbortController) {
        promises.push(
          new Promise((_, reject) => {
            this.currentRequestAbortController!.signal.addEventListener(
              "abort",
              () => {
                reject(new Error(`Tool ${name} cancelled by user`));
              },
              { once: true }
            );
          })
        );
      }

      const result = (await Promise.race(promises)) as any;
      console.log(`[PERF] SDK client.callTool(${name}): ${(performance.now() - sdkCallStart).toFixed(1)}ms`);

      this.currentRequestAbortController = null;

      // Check result size - block if too large to prevent "Prompt is too long" errors
      // This lets the AI retry with more specific parameters (like Claude Code does)
      const MAX_RESULT_SIZE_BYTES = 100 * 1024; // 100KB limit
      const resultStr = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
      const resultSizeBytes = new TextEncoder().encode(resultStr).length;

      if (resultSizeBytes > MAX_RESULT_SIZE_BYTES) {
        const sizeKB = Math.round(resultSizeBytes / 1024);
        const limitKB = Math.round(MAX_RESULT_SIZE_BYTES / 1024);
        console.warn(`[MCP] Tool ${name} result too large: ${sizeKB}KB (limit: ${limitKB}KB)`);

        // Return error that helps AI retry with better parameters
        const errorHints: Record<string, string> = {
          get_window_tree:
            "Try using 'max_depth' parameter (e.g., max_depth: 3) or target a specific element with 'selector'.",
          capture_screenshot: "Try targeting a specific window with 'selector' parameter.",
          execute_browser_script: "Return less data from your script, or filter/paginate the results.",
          execute_sequence: "The workflow output is too large. Consider breaking into smaller steps.",
        };
        const hint = errorHints[name] || "Try using more specific parameters to reduce output size.";

        throw new Error(`Output too large (${sizeKB}KB, limit: ${limitKB}KB). ${hint}`);
      }

      // Extract console output if present in the result
      if (progressCallback && result.content) {
        // Check if the result contains console output or logs
        if (typeof result.content === "object") {
          // Look for console output in various possible fields
          const consoleOutput =
            result.content.console || result.content.logs || result.content.output || result.content.stdout;

          if (consoleOutput) {
            // Parse and send console output through progress callback
            if (Array.isArray(consoleOutput)) {
              for (const log of consoleOutput) {
                progressCallback({
                  type: "console",
                  timestamp: Date.now(),
                  message: typeof log === "string" ? log : log.message || JSON.stringify(log),
                  level: log.level || "log",
                });
              }
            } else if (typeof consoleOutput === "string") {
              // Split by newlines and send each line
              const lines = consoleOutput.split("\n").filter(line => line.trim());
              for (const line of lines) {
                progressCallback({
                  type: "console",
                  timestamp: Date.now(),
                  message: line,
                  level: "log",
                });
              }
            }
          }

          // Also check if the result itself is a string that looks like console output
        } else if (typeof result.content === "string" && name === "run_javascript") {
          // For JavaScript tool, the output might be in the string result
          const lines = result.content.split("\n").filter(line => line.trim());
          for (const line of lines) {
            // Parse the line to extract progress info if it contains patterns
            progressCallback({
              type: "console",
              timestamp: Date.now(),
              message: line,
              level: "log",
            });
          }
        }
      }

      // Clear the progress callback after tool execution
      this.currentProgressCallback = null;

      // Ensure we're reconnected if we had to abort
      if (!this.isConnected() && this.serverInfo?.port) {
        await this.connect(this.serverInfo.port);
      }

      // Ingest successful tool execution to RPA knowledgebase
      const duration_ms = Date.now() - startTime;
      ingestMcpToolExecution({
        tool_name: name,
        arguments: effectiveArguments,
        result: result.content,
        duration_ms,
        workflow_name,
        step_name,
      }).catch(err => {
        // Silent failure - don't break tool execution
        console.warn("[MCP] Ingestion failed:", err);
      });

      console.log(`[PERF] mcpClient.callTool(${name}) total: ${(performance.now() - callToolStart).toFixed(1)}ms`);
      // Preserve isError flag from MCP response (tools like edit_file return isError:true on failures)
      if (result.isError) {
        console.log(`[MCP-CLIENT] Tool ${name} returned isError:true`);
      }
      // DEBUG: Log content structure before returning
      console.log(
        `[DEBUG-MCP-CLIENT] ${name} result.content structure:`,
        result.content?.map?.((c: any) => ({ type: c?.type, hasData: !!c?.data, mimeType: c?.mimeType }))
      );
      return { content: result.content, isError: result.isError };
    } catch (error) {
      // DETAILED ERROR LOGGING - to diagnose empty {} errors
      console.error(`❌ [MCP-CLIENT] callTool(${name}) caught error:`, {
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
        errorMessage: (error as any)?.message,
        errorString: String(error),
        errorJSON: JSON.stringify(error, Object.getOwnPropertyNames(error || {})),
        errorKeys: error && typeof error === "object" ? Object.keys(error) : [],
        errorOwnKeys: error && typeof error === "object" ? Object.getOwnPropertyNames(error) : [],
        isError: error instanceof Error,
        transportConnected: !!this.transport,
        clientConnected: !!this.client,
        serverInfoConnected: this.serverInfo?.isConnected,
      });

      // Extract error details for structured logging
      const errorObj = error && typeof error === "object" ? (error as any) : {};
      const errorMetadata: Record<string, any> = {
        toolName: name,
        requestId,
        errorData: errorObj.data,
        errorNested: errorObj.error,
        errorCause: errorObj.cause,
        errorCode: errorObj.code,
      };

      // Check for session expiration (401 Unauthorized)
      const errorMessage = (error as Error).message || String(error);
      const isSessionExpired =
        errorMessage.includes("401") ||
        errorMessage.includes("Unauthorized") ||
        errorMessage.includes("Session not found");

      if (isSessionExpired) {
        const port = this.serverInfo?.port;
        mcpLogger.warn(`MCP session expired (401 - Session not found), forcing full reconnection`, {
          toolName: name,
          port,
          error: errorMessage,
        });

        // Force cleanup to clear stale session AND transport
        await this.cleanup();

        // If we have server info, attempt to reconnect and retry once
        if (port) {
          try {
            mcpLogger.info(`Reconnecting to MCP server on port ${port} (creating new session)...`);

            // Wait a bit before reconnecting to let server clean up
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Reconnect with full session recreation
            await this.connect(port);

            // Verify connection is working before retry
            if (!this.isConnected()) {
              throw new Error("Reconnection failed - client not connected");
            }

            // Retry the tool call once after reconnection
            mcpLogger.info(`Retrying ${name} after session recreation...`);
            const retryResult = await this.client!.callTool(
              {
                name,
                arguments: arguments_ || {},
              },
              undefined,
              timeout ? { timeout } : undefined
            );

            this.currentRequestAbortController = null;
            this.currentProgressCallback = null;

            mcpLogger.info(`Successfully recovered from session expiration for ${name}`);

            // Ingest successful retry
            const duration_ms = Date.now() - startTime;
            ingestMcpToolExecution({
              tool_name: name,
              arguments: arguments_,
              result: retryResult.content,
              duration_ms,
              workflow_name,
              step_name,
            }).catch(err => {
              console.warn("[MCP] Ingestion failed:", err);
            });

            // Preserve isError flag in retry path too
            if (retryResult.isError) {
              console.log(`[MCP-CLIENT] Tool ${name} returned isError:true (retry)`);
            }
            return { content: retryResult.content, isError: retryResult.isError };
          } catch (retryError) {
            mcpLogger.error(`Retry failed after session recreation for ${name}`, retryError);
            // Fall through to normal error handling with the retry error
            throw retryError;
          }
        }
      }

      // Log with structured logger (skip highlight failures to reduce noise)
      if (name !== "highlight_element" && !name.includes("highlight")) {
        mcpLogger.error(`Tool execution failed: ${name}`, error, errorMetadata);
      }

      this.currentRequestAbortController = null;

      // If cancelled, ensure we're ready for next request
      if ((error as Error).message?.includes("cancelled")) {
        if (!this.isConnected() && this.serverInfo?.port) {
          mcpLogger.info("Preparing for reconnection after cancellation", {
            port: this.serverInfo.port,
          });
          // Don't await here - let next request handle reconnection
        }
      }

      // Create a more detailed error message if possible
      let detailedError: Error;
      if (error && typeof error === "object") {
        const errorObj = error as any;

        // Try to extract the most detailed error message available
        let errorMessage = errorObj.message;
        let errorDetails = "";

        // Check for nested error details
        if (errorObj.data && typeof errorObj.data === "string") {
          errorDetails = errorObj.data;
        } else if (errorObj.data && typeof errorObj.data === "object") {
          errorDetails = JSON.stringify(errorObj.data);
        } else if (errorObj.error && typeof errorObj.error === "string") {
          errorDetails = errorObj.error;
        } else if (errorObj.error && typeof errorObj.error === "object" && errorObj.error.message) {
          errorDetails = errorObj.error.message;
        }

        // If no message found, this is likely a transport disconnect - create meaningful error
        if (!errorMessage) {
          const hasAnyKeys = Object.keys(errorObj).length > 0 || Object.getOwnPropertyNames(errorObj).length > 0;
          if (!hasAnyKeys) {
            // Empty object {} - likely transport disconnected
            errorMessage = "MCP transport disconnected (empty error object received)";
            console.error(`🔌 [MCP-CLIENT] Detected empty error object - transport likely disconnected`);
            // Mark as disconnected
            if (this.serverInfo) {
              this.serverInfo.isConnected = false;
            }
          } else {
            errorMessage = `Unknown MCP error: ${JSON.stringify(errorObj, Object.getOwnPropertyNames(errorObj))}`;
          }
        }

        // Create a proper Error with all available info
        const enhancedMessage = errorDetails ? `${errorMessage}\nDetails: ${errorDetails}` : errorMessage;
        detailedError = new Error(enhancedMessage);
        (detailedError as any).originalError = error;
        (detailedError as any).code = errorObj.code;
      } else {
        // Primitive error or null/undefined
        detailedError = new Error(error ? String(error) : "Unknown MCP error (null/undefined)");
      }

      // Clear the progress callback on error as well
      this.currentProgressCallback = null;

      // Ingest failed tool execution to RPA knowledgebase
      const duration_ms = Date.now() - startTime;
      ingestMcpToolExecution({
        tool_name: name,
        arguments: arguments_,
        error: detailedError,
        duration_ms,
        workflow_name,
        step_name,
      }).catch(err => {
        // Silent failure - don't break tool execution
        console.warn("[MCP] Ingestion failed:", err);
      });

      throw detailedError;
    } finally {
      // Always decrement active tool executions counter
      this.activeToolExecutions = Math.max(0, this.activeToolExecutions - 1);

      // Notify backend when all tools have finished (so backend resumes health checks)
      if (this.activeToolExecutions === 0) {
        invoke("set_mcp_tool_executing", { executing: false }).catch(() => {
          // Ignore errors - this is best-effort notification
        });
      }
    }
  }

  // Check if any tool is currently executing (used to skip health checks)
  isToolExecuting(): boolean {
    return this.activeToolExecutions > 0;
  }

  getServerInfo(): McpServerInfo | null {
    return this.serverInfo;
  }

  getServerInstructions(): string | null {
    return this.serverInstructions;
  }

  isConnected(): boolean {
    return this.client !== null && this.serverInfo !== null && this.serverInfo.isConnected;
  }

  // Verify connection is actually working (not just cached state)
  async verifyConnection(): Promise<boolean> {
    if (!this.serverInfo) {
      return false;
    }

    try {
      const healthUrl = `http://127.0.0.1:${this.serverInfo.port}/health`;
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(3000), // 3 second timeout
      });

      const isHealthy = response.ok;

      // Update connection state based on actual health
      if (!isHealthy && this.serverInfo) {
        this.serverInfo.isConnected = false;
      } else if (isHealthy && this.serverInfo) {
        this.serverInfo.isConnected = true;
      }

      return isHealthy;
    } catch (error) {
      // Connection failed - update state
      if (this.serverInfo) {
        this.serverInfo.isConnected = false;
      }
      return false;
    }
  }

  // Clear tools cache (useful for debugging or when tools change)
  clearCache(): void {
    this.toolsCache = null;
  }
}

// Global MCP client instance
export const mcpClient = new McpClient();
