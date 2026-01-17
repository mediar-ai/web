import { invoke } from "@tauri-apps/api/core";
import { CheckCircle, ChevronDown, ChevronRight, RefreshCw, Server, XCircle } from "lucide-react";
import { useState } from "react";
import { useMcp } from "../../contexts/McpContext";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

interface McpToolsPanelProps {
  mcpInitializing?: boolean;
}

export function McpToolsPanel({ mcpInitializing = false }: McpToolsPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isRestarting, setIsRestarting] = useState(false);
  const [restartStatus, setRestartStatus] = useState<string>("");
  const mcpState = useMcp();

  const handleRestartMcp = async () => {
    try {
      setIsRestarting(true);
      setRestartStatus("Restarting MCP server...");
      console.log("🔄 [MCP] Restarting MCP server...");

      // Use the restart command which handles stop + start
      await invoke("restart_mcp_server_command");
      console.log("✅ [MCP] Server restarted");

      setRestartStatus("Discovering tools...");
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Rediscover tools
      await mcpState.refreshTools();
      console.log("✅ [MCP] Tools discovered");

      setRestartStatus("✅ Restart complete!");
      setTimeout(() => {
        setRestartStatus("");
        setIsRestarting(false);
      }, 2000);
    } catch (error) {
      console.error("❌ [MCP] Restart failed:", error);
      setRestartStatus(`❌ Error: ${error}`);
      setTimeout(() => {
        setRestartStatus("");
        setIsRestarting(false);
      }, 3000);
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const tools = mcpState.tools || {};
  const toolCount = Object.keys(tools).length;
  const serverInfo = mcpState.serverInfo;

  return (
    <div className="space-y-2">
      {/* Server Status Card */}
      <Card>
        <CardHeader className="cursor-pointer hover:bg-gray-50" onClick={() => setIsCollapsed(!isCollapsed)}>
          <CardTitle className="text-sm font-normal flex items-center gap-2">
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <Server className="h-4 w-4" />
            MCP Server Status
            {/* Show status indicator even when collapsed */}
            <div className="ml-auto">
              {serverInfo?.is_running && !serverInfo?.is_ready ? (
                <div className="h-4 w-4 rounded-full border-2 border-yellow-500 border-t-transparent animate-spin" />
              ) : mcpState.isHealthy ? (
                <CheckCircle className="h-4 w-4 text-black" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
          </CardTitle>
        </CardHeader>
        {!isCollapsed && (
          <CardContent>
            {/* Server Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {mcpState.isDiscovering
                    ? "Connecting..."
                    : serverInfo?.is_running && !serverInfo?.is_ready
                      ? "Initializing..."
                      : mcpState.isHealthy
                        ? "Running"
                        : "Disconnected"}
                </span>
              </div>
              <Badge
                variant={
                  mcpState.isDiscovering
                    ? "secondary"
                    : serverInfo?.is_running && !serverInfo?.is_ready
                      ? "outline"
                      : mcpState.isHealthy
                        ? "default"
                        : "destructive"
                }
              >
                {mcpState.isDiscovering
                  ? "Connecting"
                  : serverInfo?.is_running && !serverInfo?.is_ready
                    ? "Loading..."
                    : mcpState.isHealthy
                      ? "Ready"
                      : "Offline"}
              </Badge>
            </div>

            {/* Server Details */}
            {serverInfo && mcpState.isHealthy && (
              <div className="space-y-2 text-xs text-gray-600">
                <div className="flex justify-between">
                  <span>Port:</span>
                  <span className="font-mono">{serverInfo.port}</span>
                </div>
                <div className="flex justify-between">
                  <span>URL:</span>
                  <span className="font-mono text-[10px]">{serverInfo.url}</span>
                </div>
                {serverInfo.uptime_seconds > 0 && (
                  <div className="flex justify-between">
                    <span>Uptime:</span>
                    <span className="font-mono">{formatUptime(serverInfo.uptime_seconds)}</span>
                  </div>
                )}
                {serverInfo.version && (
                  <div className="flex justify-between">
                    <span>Version:</span>
                    <span className="font-mono text-[10px]">{serverInfo.version}</span>
                  </div>
                )}
              </div>
            )}

            {/* Error Display */}
            {mcpState.error && (
              <div className="p-2 bg-white/5 backdrop-blur-md border-2 border-black rounded text-xs text-black">
                <div className="font-medium">Connection Error</div>
                <div className="mt-1">{mcpState.error}</div>
              </div>
            )}

            {/* Restart Button */}
            <div className="mt-3 pt-3 border-t space-y-2">
              <Button
                size="sm"
                variant="default"
                onClick={handleRestartMcp}
                disabled={
                  isRestarting ||
                  mcpState.isDiscovering ||
                  mcpInitializing ||
                  (serverInfo?.is_running && !serverInfo?.is_ready)
                }
                className="w-full disabled:cursor-not-allowed"
              >
                {isRestarting ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin mr-2" />
                    Restarting...
                  </>
                ) : mcpState.isDiscovering || mcpInitializing || (serverInfo?.is_running && !serverInfo?.is_ready) ? (
                  <>
                    <RefreshCw className="h-3 w-3 animate-spin mr-2" />
                    Initializing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3 mr-2" />
                    Restart MCP Server
                  </>
                )}
              </Button>
              {restartStatus && <div className="text-xs text-center py-1 px-2 bg-gray-50 rounded">{restartStatus}</div>}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Tools Panel */}
      {!isCollapsed && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4" />
                Available Tools
              </div>
              <Badge variant="outline">{toolCount}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Loading State - Only show if no tools are loaded yet */}
            {(mcpInitializing || mcpState.isDiscovering) && toolCount === 0 && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <RefreshCw className="h-4 w-4 animate-spin" />
                {mcpInitializing ? "Initializing MCP server..." : "Discovering tools..."}
              </div>
            )}

            {/* Tools List */}
            {toolCount > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-600 mb-2">{toolCount} tools available</div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {Object.entries(tools).map(([name, tool]) => (
                    <div key={name} className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">{name}</div>
                        {tool.description && (
                          <div className="text-gray-600 text-[10px] truncate">{tool.description}</div>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-[10px] px-1">
                        {Object.keys(tool.inputSchema?.properties || {}).length} params
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : !mcpInitializing && !mcpState.isDiscovering && mcpState.isHealthy ? (
              <div className="text-center py-4">
                <div className="text-sm text-gray-600">No tools discovered</div>
                <div className="text-xs text-gray-500 mt-1">
                  Use the &quot;Restart MCP Connection&quot; button above to reconnect
                </div>
              </div>
            ) : !mcpState.isHealthy && !mcpInitializing ? (
              <div className="text-center py-4">
                <div className="text-sm text-gray-600">Server offline</div>
                <div className="text-xs text-gray-500 mt-1">The MCP server will auto-start in the background</div>
              </div>
            ) : null}

            {/* Last Update */}
            {mcpState.lastUpdate && (
              <div className="text-[10px] text-gray-500 text-center pt-2 border-t">
                Last updated: {mcpState.lastUpdate.toLocaleTimeString()}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
