import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackMcpDisconnected, trackMcpReconnected } from "../lib/analytics";
import { mcpLogger } from "../lib/logger";
import { mcpClient } from "../lib/mcp-client";

// Simple server info structure
interface McpServerInfo {
  port: number;
  is_running: boolean;
  is_ready: boolean; // True when /mcp endpoint is fully initialized and ready for connections
  url: string;
  uptime_seconds: number;
  version?: string;
}

// Backend health event structure
interface McpHealthEvent {
  status: string; // "checking", "restarting", "ready", "failed"
  message: string;
  port: number;
  restart_count: number;
}

interface McpToolsState {
  tools: Record<string, any>;
  serverInfo: McpServerInfo | null;
  serverInstructions: string | null;
  isHealthy: boolean;
  isDiscovering: boolean;
  isInitialSetup: boolean;
  error: string | null;
  lastUpdate: Date | null;
}

// Simple health check hook with more frequent polling
export const useMcpServer = () => {
  const [serverInfo, setServerInfo] = useState<McpServerInfo | null>(null);
  const [isRunning, setIsRunning] = useState(false); // Changed: only tracks if server process is running
  const [error, setError] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  // Simple health check function
  const checkHealth = useCallback(async () => {
    try {
      setLastCheck(new Date());

      // Check MCP server (dynamic port - terminator-mcp-agent)
      try {
        // Get full server info from backend (includes is_ready field)
        const backendInfo = await invoke<McpServerInfo>("get_mcp_server_info_command");

        console.log("🔍 [MCP] Server info:", {
          is_running: backendInfo?.is_running,
          is_ready: backendInfo?.is_ready,
          port: backendInfo?.port,
        });

        if (backendInfo && backendInfo.is_running) {
          // Backend handles readiness detection and emits mcp:ready event
          // Frontend just needs to listen for that event (handled in useMcpTools)
          setServerInfo(backendInfo);
          setIsRunning(true);
          setError(null);
          return backendInfo;
        }
      } catch (err) {
        // Backend command failed or server not started yet
        // Don't fallback to fetch - it creates noisy ERR_CONNECTION_REFUSED logs
        // Just wait for next poll cycle when server will be ready
      }

      // Server not responding yet (likely still starting up)
      setServerInfo(null);
      setIsRunning(false);
      // Don't set error during initial startup - it's expected
      // Error will be set by the timeout in useEffect if server never starts
      return null;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      setServerInfo(null);
      setIsRunning(false);
      setError(errorMsg);
      return null;
    }
  }, []);

  // Force refresh function for manual retries
  const forceRefresh = useCallback(async () => {
    return await checkHealth();
  }, [checkHealth]);

  // Initial health check on mount only - backend events will drive updates
  useEffect(() => {
    checkHealth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    serverInfo,
    isRunning, // Note: this only means server process is running, not that it's ready
    error,
    lastCheck,
    checkHealth,
    forceRefresh, // Add manual refresh capability
  };
};

// Simple tools discovery hook
export const useMcpTools = (autoDiscover: boolean = true) => {
  const [state, setState] = useState<McpToolsState>({
    tools: {},
    serverInfo: null,
    serverInstructions: null,
    isHealthy: false,
    isDiscovering: false,
    isInitialSetup: true,
    error: null,
    lastUpdate: null,
  });

  const serverHook = useMcpServer();

  // Refs for stable access in event listeners (avoid stale closures and dependency changes)
  const discoverToolsRef = useRef<() => Promise<any>>(null!);
  const checkHealthRef = useRef<() => Promise<any>>(null!);

  // Discover tools using the MCP client
  const discoverTools = useCallback(async () => {
    if (!serverHook.serverInfo || !serverHook.isRunning) {
      setState(prev => ({
        ...prev,
        error: "MCP server is not running",
        tools: {},
        serverInstructions: null,
        isHealthy: false, // Not healthy if server isn't running
      }));
      return { tools: {} };
    }

    // Prevent multiple concurrent discovery attempts
    if (state.isDiscovering) {
      // console.log('🔄 [HOOK] Tools discovery already in progress, skipping...');
      return { tools: state.tools };
    }

    try {
      setState(prev => ({ ...prev, isDiscovering: true, error: null }));
      // console.log('🔍 [HOOK] Starting tool discovery from MCP server...');

      // Connect to MCP server (dynamic port from backend)
      try {
        // Get port from backend server info
        const port = serverHook.serverInfo?.port || 8080;
        // console.log('🔌 [MCP] Attempting to connect to port:', port);
        await mcpClient.connect(port);
        // console.log('✅ [MCP] Successfully connected to port:', port);
        const tools = await mcpClient.getTools();
        const serverInstructions = mcpClient.getServerInstructions();

        // Only log from first successful discovery to avoid spam from multiple hook instances
        // if (state.isInitialSetup) {
        //   mcpLogger.info('Discovered tools from server', {
        //     port: port,
        //     toolCount: Object.keys(tools).length
        //   });
        // }

        console.log(`✅ [MCP] Discovery complete - ${Object.keys(tools).length} tools, setting isHealthy=true`);
        setState(prev => ({
          ...prev,
          tools,
          serverInfo: serverHook.serverInfo,
          serverInstructions,
          isHealthy: true,
          isDiscovering: false,
          lastUpdate: new Date(),
          isInitialSetup: false,
        }));
        return { tools };
      } catch (err) {
        // Extract error message properly
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Check for session expiration during discovery
        const is401Error =
          errorMsg.includes("401") || errorMsg.includes("Unauthorized") || errorMsg.includes("Session not found");

        if (is401Error) {
          mcpLogger.warn("MCP session expired during tool discovery, clearing state for reconnection");

          // Force cleanup to clear stale session
          try {
            await mcpClient.disconnect();
            mcpLogger.info("Disconnected stale MCP session");
          } catch (disconnectErr) {
            mcpLogger.warn("Error during disconnect", disconnectErr);
          }

          // Clear tools and set error state to trigger UI notification
          // Don't set isDiscovering to false yet - that happens in the finally block
          setState(prev => ({
            ...prev,
            tools: {},
            isHealthy: false,
            error: "Session expired - Reconnecting automatically...",
          }));

          // Don't try to reconnect immediately - let the auto-discover effect handle it
          // This prevents racing connections that cause "signal is aborted without reason"
          mcpLogger.info("Session cleared, waiting for auto-discover to reconnect");

          throw err;
        }

        // During initial setup, suppress 503 errors (Desktop still initializing - expected)
        const is503Error = errorMsg.includes("503") || errorMsg.includes("Service Unavailable");
        if (state.isInitialSetup && is503Error) {
          // Don't log - this is expected during startup
          throw err;
        }

        throw err;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Handle startup-related errors more gracefully
      if (
        errorMsg.includes("503") ||
        errorMsg.includes("busy") ||
        errorMsg.includes("MCP client not connected") ||
        errorMsg.includes("ECONNREFUSED") ||
        errorMsg.includes("Failed to fetch") ||
        errorMsg.includes("already initialized")
      ) {
        // During initial setup, don't show error messages - it's expected
        if (state.isInitialSetup) {
          setState(prev => ({
            ...prev,
            error: null, // No error during initial setup - expected behavior
            isDiscovering: false,
            isHealthy: false,
          }));
        } else {
          // After initial setup, show a gentler message
          setState(prev => ({
            ...prev,
            error: "MCP server starting up...",
            isDiscovering: false,
            isHealthy: false,
          }));
        }
      } else {
        // Real errors (not startup-related)
        setState(prev => ({
          ...prev,
          error: state.isInitialSetup ? null : errorMsg, // Don't show errors during initial setup
          isDiscovering: false,
          tools: {},
          serverInstructions: null,
          isHealthy: false,
        }));
      }
      throw err;
    }
  }, [serverHook.serverInfo, serverHook.isRunning, state.isDiscovering]); // Don't depend on state.tools - causes callback recreation loop

  // Keep refs updated with latest function references (for use in event listeners)
  discoverToolsRef.current = discoverTools;
  checkHealthRef.current = serverHook.checkHealth;

  // Call a tool using MCP client
  const callTool = useCallback(
    async (
      name: string,
      arguments_: any,
      abortSignal?: AbortSignal,
      progressCallback?: any,
      timeout?: number,
      workflow_name?: string,
      step_name?: string
    ): Promise<any> => {
      const hookCallStart = performance.now();
      console.log(`[PERF] useMcp.callTool(${name}) started`);

      try {
        // Ensure connection (singleton will handle this efficiently)
        if (!serverHook.serverInfo) {
          throw new Error("MCP server not available");
        }

        const connectStart = performance.now();
        await mcpClient.connect(serverHook.serverInfo.port);
        console.log(`[PERF] useMcp connect step: ${(performance.now() - connectStart).toFixed(1)}ms`);

        const mcpCallStart = performance.now();
        const result = await mcpClient.callTool(
          name,
          arguments_,
          abortSignal,
          progressCallback,
          timeout,
          workflow_name,
          step_name
        );
        console.log(`[PERF] useMcp mcpClient.callTool: ${(performance.now() - mcpCallStart).toFixed(1)}ms`);

        console.log(`[PERF] useMcp.callTool(${name}) total: ${(performance.now() - hookCallStart).toFixed(1)}ms`);
        // mcp-client now returns { content: [...], isError: boolean } - preserve isError flag
        if (result?.isError) {
          console.log(`[useMcp] Tool ${name} returned isError:true`);
        }
        return { isError: result?.isError || false, content: result?.content || result };
      } catch (error) {
        // Extract detailed error message if available
        let errorMessage = "";
        const errorMetadata: Record<string, any> = { toolName: name };

        if (error instanceof Error) {
          errorMessage = error.message;
          // Also log any additional error details attached to the error object
          const errorObj = error as any;
          if (errorObj.originalError) {
            errorMetadata.originalError = errorObj.originalError;
          }
          if (errorObj.code) {
            errorMetadata.code = errorObj.code;
          }
        } else {
          errorMessage = String(error);
        }

        // Only mark connection as unhealthy for ACTUAL connection failures
        // Tool execution errors (even with 401/403) don't mean the connection is down
        // The polling mechanism will detect actual connection failures via verifyConnection()
        const isRealConnectionError =
          errorMessage.includes("ECONNREFUSED") ||
          errorMessage.includes("ECONNRESET") ||
          errorMessage.includes("Cannot reach MCP server") ||
          errorMessage.includes("Network error") ||
          errorMessage.includes("ERR_CONNECTION_REFUSED") ||
          errorMessage.includes("Failed to fetch");

        if (isRealConnectionError) {
          mcpLogger.error(`Connection error detected during tool execution: ${errorMessage}`);
          trackMcpDisconnected(errorMessage, "tool_execution");
          // Mark connection as unhealthy - polling will verify and recover if needed
          setState(prev => ({
            ...prev,
            isHealthy: false,
            error: errorMessage,
          }));
        }

        // Only log errors for non-highlight tools to reduce noise
        // Highlight failures are expected and logged elsewhere
        if (name !== "highlight_element" && !name.includes("highlight")) {
          mcpLogger.error(
            `Tool execution failed in hook: ${name}`,
            error instanceof Error ? error : new Error(errorMessage),
            errorMetadata
          );
        }

        // Return error in the expected format instead of throwing
        // Include the full detailed error message which may contain nested details
        // Also include originalError so callers can access structured error data (e.g., error_type)
        return {
          isError: true,
          content: errorMessage,
          originalError: errorMetadata.originalError || null,
        };
      }
    },
    [serverHook.serverInfo]
  );

  // Initial setup is now marked complete in discoverTools on success
  // This effect is no longer needed as we handle it in the discovery success path

  // Add initial setup timeout to prevent indefinite loading
  useEffect(() => {
    if (state.isInitialSetup) {
      const timeout = setTimeout(() => {
        // console.log('⚠️ [HOOK] Initial setup timeout (30s), marking as complete');
        setState(prev => ({ ...prev, isInitialSetup: false }));
      }, 30000); // 30 second timeout

      return () => clearTimeout(timeout);
    }
  }, [state.isInitialSetup]);

  // Auto-discover tools when server is READY (not just running)
  useEffect(() => {
    if (!autoDiscover) {
      console.log("⏭️ [MCP] Auto-discover disabled, skipping");
      return;
    }

    // Use refs to check tool state without causing re-renders
    const hasTools = Object.keys(state.tools).length > 0;

    // console.log('🔍 [MCP] Auto-discover effect running:', {
    //   isRunning: serverHook.isRunning,
    //   isReady: serverHook.serverInfo?.is_ready,
    //   hasTools,
    //   isDiscovering: state.isDiscovering
    // });

    // Wait for server to be running AND ready (Desktop initialized)
    // This eliminates the 503 errors by ensuring Desktop is fully initialized before connecting
    if (serverHook.isRunning && serverHook.serverInfo?.is_ready && !hasTools && !state.isDiscovering) {
      // Small delay to ensure state is stable (reduced from 5s/1.2s since we know server is ready)
      const delay = 500;

      console.log("✅ [MCP] Conditions met, scheduling tool discovery in", delay, "ms");
      const timer = setTimeout(() => {
        console.log("✅ [MCP] Server is ready (Desktop initialized), starting tool discovery...");
        discoverTools().catch(err => {
          // Extract error message properly
          const errorMsg = err instanceof Error ? err.message : String(err);

          // Check for connection errors that indicate server is down
          const isConnectionError =
            errorMsg.includes("ECONNREFUSED") ||
            errorMsg.includes("ECONNRESET") ||
            errorMsg.includes("ERR_CONNECTION_REFUSED") ||
            errorMsg.includes("Failed to fetch");

          const is503Error =
            errorMsg.includes("503") || errorMsg.includes("busy") || errorMsg.includes("MCP client not connected");

          if (state.isInitialSetup && (is503Error || isConnectionError)) {
            // Don't log - this is expected during startup, will auto-retry
            return;
          }

          // Connection error after initial setup means server went down
          // Report to backend to trigger health check and restart
          if (isConnectionError && !state.isInitialSetup) {
            console.log("⚠️ [MCP] Connection error detected - reporting to backend");
            invoke("report_connection_failure").catch(backendErr => {
              console.error("❌ [MCP] Failed to report connection failure to backend:", backendErr);
            });
            return;
          }

          // 503 errors mean server is busy/initializing - tell backend to set is_ready=false
          // This breaks the infinite retry loop - backend will set is_ready=true when /mcp is ready
          if (is503Error) {
            console.log("⚠️ [MCP] Server busy (503) - notifying backend to update readiness");
            invoke("report_mcp_busy")
              .then(() => {
                // Force refresh frontend state to get updated is_ready=false
                console.log("🔄 [MCP] Refreshing server info after reporting busy...");
                return serverHook.forceRefresh();
              })
              .catch(backendErr => {
                console.error("❌ [MCP] Failed to report busy status to backend:", backendErr);
              });
            return;
          }

          // Log other non-503 errors
          mcpLogger.warn("Failed to discover tools", { error: errorMsg });
        });
      }, delay);

      return () => clearTimeout(timer);
    }
  }, [autoDiscover, serverHook.isRunning, serverHook.serverInfo?.is_ready, state.isDiscovering, discoverTools]);

  // Watch for frontend-detected connection failures and report to backend immediately
  // This triggers faster response than waiting for backend's 30-second health check
  useEffect(() => {
    // Only report if we've completed initial setup and server goes unhealthy
    if (!state.isInitialSetup && !state.isHealthy && state.tools && Object.keys(state.tools).length > 0) {
      console.log("⚠️ [MCP] Frontend detected unhealthy state - reporting to backend for immediate restart");
      invoke("report_connection_failure").catch(err => {
        console.error("❌ [MCP] Failed to report connection failure:", err);
      });
    }
  }, [state.isHealthy, state.isInitialSetup, state.tools]);

  // Listen to backend health status events for fast response
  // Uses refs to avoid stale closures and prevent listener stacking from dependency changes
  useEffect(() => {
    let mounted = true; // Track if component is still mounted (prevents async race condition)
    let unlistenRestarting: (() => void) | null = null;
    let unlistenReady: (() => void) | null = null;
    let unlistenFailed: (() => void) | null = null;

    // Set up event listeners with proper cleanup handling
    const setupListeners = async () => {
      // Backend emits this when restart begins
      unlistenRestarting = await listen<McpHealthEvent>("mcp:restarting", event => {
        if (!mounted) return; // Ignore if unmounted
        console.log("⚠️ [MCP] Backend restarting:", event.payload.message);
        trackMcpDisconnected(event.payload.message, "health_check");
        setState(prev => ({
          ...prev,
          isHealthy: false,
          tools: {}, // Clear tools so they'll be rediscovered when ready
          error: event.payload.message,
        }));
      });

      // Check if unmounted while awaiting - clean up and abort
      if (!mounted) {
        unlistenRestarting?.();
        return;
      }

      // Backend emits this when server is ready
      unlistenReady = await listen<McpHealthEvent>("mcp:ready", async event => {
        if (!mounted) return; // Ignore if unmounted
        console.log("✅ [MCP] Backend ready:", event.payload.message);
        // Use refs to get latest function references (avoids stale closures)
        await checkHealthRef.current();
        discoverToolsRef.current().catch(err => {
          mcpLogger.warn("Failed to discover tools after ready event", { error: String(err) });
        });
      });

      // Check if unmounted while awaiting - clean up and abort
      if (!mounted) {
        unlistenRestarting?.();
        unlistenReady?.();
        return;
      }

      // Backend emits this when restart fails
      unlistenFailed = await listen<McpHealthEvent>("mcp:failed", event => {
        if (!mounted) return; // Ignore if unmounted
        console.error("❌ [MCP] Backend failed:", event.payload.message);
        trackMcpDisconnected(event.payload.message, "health_check");
        setState(prev => ({
          ...prev,
          isHealthy: false,
          tools: {},
          error: event.payload.message,
        }));
      });

      // Final check - clean up if unmounted during last await
      if (!mounted) {
        unlistenRestarting?.();
        unlistenReady?.();
        unlistenFailed?.();
      }
    };

    setupListeners();

    return () => {
      mounted = false; // Signal to abort any pending async operations
      unlistenRestarting?.();
      unlistenReady?.();
      unlistenFailed?.();
    };
  }, []); // Empty deps - uses refs for stable access to latest functions

  // Use refs to track current status for polling interval calculation
  const isRunningRef = useRef(serverHook.isRunning);
  const isReadyRef = useRef(serverHook.serverInfo?.is_ready ?? false);
  const hasToolsRef = useRef(Object.keys(state.tools).length > 0);
  isRunningRef.current = serverHook.isRunning;
  isReadyRef.current = serverHook.serverInfo?.is_ready ?? false;
  hasToolsRef.current = Object.keys(state.tools).length > 0;

  // Polling as fallback - complements event-driven architecture
  // Events provide fast response, polling provides resilience to missed events
  useEffect(() => {
    // Skip polling during initial setup phase
    if (state.isInitialSetup) {
      return;
    }

    let timeoutId: NodeJS.Timeout;

    const pollAndRetry = async () => {
      // Adaptive polling interval:
      // - 3s when server not ready OR no tools discovered (need quick retry)
      // - 30s when fully operational (just monitoring)
      const needsQuickRetry = !isReadyRef.current || !hasToolsRef.current;
      const interval = needsQuickRetry ? 3000 : 30000;

      try {
        // Skip polling if we don't have server info yet
        if (!serverHook.serverInfo) {
          timeoutId = setTimeout(pollAndRetry, interval);
          return;
        }

        // Skip health check if a tool is currently executing (prevents false alarms during long-running tools)
        if (mcpClient.isToolExecuting()) {
          timeoutId = setTimeout(pollAndRetry, interval);
          return;
        }

        // Check if connection is actually working
        const isActuallyHealthy = await mcpClient.verifyConnection();

        if (!isActuallyHealthy && state.isHealthy) {
          // Connection just dropped
          console.log("⚠️ [MCP] Polling detected connection loss");
          trackMcpDisconnected("Connection lost - MCP server not responding", "polling");
          setState(prev => ({
            ...prev,
            isHealthy: false,
            error: "Connection lost - MCP server not responding",
          }));
        } else if (isActuallyHealthy && !state.isHealthy) {
          // Connection is actually healthy but state says it's not - fix state
          console.log("✅ [MCP] Polling detected connection is healthy - updating state");
          trackMcpReconnected();
          setState(prev => ({
            ...prev,
            isHealthy: true,
            error: null,
          }));

          // If we don't have tools, rediscover them
          if (Object.keys(state.tools).length === 0) {
            // console.log('🔄 [MCP] No tools cached, rediscovering...');
            try {
              await discoverTools();
            } catch (err) {
              // Will retry on next poll cycle
            }
          }
        }
      } catch (err) {
        // Polling error - not critical, will retry
      }

      // Schedule next poll
      timeoutId = setTimeout(pollAndRetry, interval);
    };

    // Start polling after a short delay to let events fire first
    timeoutId = setTimeout(pollAndRetry, 5000);

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [state.isInitialSetup, state.isHealthy, discoverTools]); // React to changes in initial setup, health, and discoverTools

  return {
    ...state,
    serverInfo: serverHook.serverInfo,
    isHealthy: state.isHealthy, // Use our own isHealthy (tools discovered), not server's isRunning
    isRunning: serverHook.isRunning, // Expose server running status separately
    discoverTools,
    callTool,
    refreshTools: discoverTools, // Alias for compatibility
    forceRefresh: serverHook.forceRefresh, // Manual refresh capability
  };
};
