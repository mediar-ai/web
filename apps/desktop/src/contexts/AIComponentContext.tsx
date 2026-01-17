/**
 * AI Component Context
 *
 * Provides app state to AI-generated components in a controlled, read-only manner.
 * This context aggregates information from auth, MCP, and workflow state.
 */

import React, { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppContext } from "@/lib/runtime-jsx";

interface WorkflowInfo {
  id: string;
  name: string;
  localPath?: string;
  stepCount?: number;
}

interface AIComponentContextValue {
  appContext: AppContext;
}

const AIComponentContext = createContext<AIComponentContextValue | undefined>(undefined);

interface AIComponentProviderProps {
  children: ReactNode;
  // Auth state
  isAuthenticated: boolean;
  userName?: string;
  userEmail?: string;
  // MCP state
  mcpServerRunning: boolean;
  mcpServerReady?: boolean;
  // Workflow state
  currentWorkflowId?: string;
  currentWorkflowName?: string;
  workflows: WorkflowInfo[];
}

export function AIComponentProvider({
  children,
  isAuthenticated,
  userName,
  userEmail,
  mcpServerRunning,
  mcpServerReady,
  currentWorkflowId,
  currentWorkflowName,
  workflows,
}: AIComponentProviderProps) {
  const appContext = useMemo<AppContext>(
    () => ({
      isAuthenticated,
      userName,
      mcpServerRunning: mcpServerRunning && (mcpServerReady ?? false),
      currentWorkflowId,
      currentWorkflowName,
      workflows: workflows.map(w => ({ id: w.id, name: w.name })),
    }),
    [isAuthenticated, userName, mcpServerRunning, mcpServerReady, currentWorkflowId, currentWorkflowName, workflows]
  );

  const value = useMemo(() => ({ appContext }), [appContext]);

  return <AIComponentContext.Provider value={value}>{children}</AIComponentContext.Provider>;
}

export function useAIComponentContext(): AIComponentContextValue {
  const context = useContext(AIComponentContext);
  if (!context) {
    // Return default context if not in provider (for standalone usage)
    return {
      appContext: {
        isAuthenticated: false,
        mcpServerRunning: false,
        workflows: [],
      },
    };
  }
  return context;
}

/**
 * Hook to get the app context for AI components
 */
export function useAppContext(): AppContext {
  const { appContext } = useAIComponentContext();
  return appContext;
}
