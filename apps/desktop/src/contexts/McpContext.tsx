import React, { createContext, useContext, ReactNode } from 'react';
import { useMcpTools } from '../hooks/useMcp';

// Context type matches useMcpTools return type
interface McpContextType {
  tools: Record<string, any>;
  serverInfo: any | null;
  serverInstructions: string | null;
  isHealthy: boolean;
  isDiscovering: boolean;
  isInitialSetup: boolean;
  error: string | null;
  lastUpdate: Date | null;
  isRunning: boolean;
  discoverTools: () => Promise<any>;
  callTool: (name: string, arguments_: any, abortSignal?: AbortSignal, progressCallback?: any, timeout?: number, workflow_name?: string, step_name?: string) => Promise<any>;
  refreshTools: () => Promise<any>;
  forceRefresh: () => Promise<any>;
}

const McpContext = createContext<McpContextType | undefined>(undefined);

/**
 * Provider component that creates a SINGLE instance of useMcpTools
 * and shares it with all consumers via context.
 *
 * This prevents duplicate MCP initialization and tool discovery.
 */
export function McpProvider({ children }: { children: ReactNode }) {
  // Single instance of useMcpTools for the entire app
  const mcpState = useMcpTools();

  return (
    <McpContext.Provider value={mcpState}>
      {children}
    </McpContext.Provider>
  );
}

/**
 * Hook to access MCP tools from context.
 * Throws if used outside McpProvider.
 *
 * Use this instead of calling useMcpTools() directly to avoid duplicate instances.
 */
export function useMcp() {
  const context = useContext(McpContext);
  if (context === undefined) {
    throw new Error('useMcp must be used within McpProvider');
  }
  return context;
}
