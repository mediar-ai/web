/**
 * AI Generated Component Wrapper
 *
 * Renders AI-generated JSX code in a safe, sandboxed environment.
 * Provides state management and action callbacks for interactive components.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { compileJSX, type AppContext, type ComponentState } from "@/lib/runtime-jsx";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./button";

export interface AIGeneratedComponentProps {
  /** The JSX code to render */
  jsx: string;
  /** Initial state for the component */
  initialState?: ComponentState;
  /** App context (currentWorkflow, auth status, etc.) */
  appContext?: AppContext;
  /** Callback when an action is executed */
  onAction?: (functionName: string, result: unknown) => void;
  /** Callback when a compilation error occurs */
  onError?: (error: Error) => void;
  /** Optional class name for the wrapper */
  className?: string;
}

export function AIGeneratedComponent({
  jsx,
  initialState = {},
  appContext,
  onAction,
  onError,
  className,
}: AIGeneratedComponentProps) {
  const [state, setState] = useState<ComponentState>(initialState);
  const [error, setError] = useState<Error | null>(null);
  const [key, setKey] = useState(0); // For forcing re-render on retry

  // Default app context if not provided
  const defaultAppContext: AppContext = useMemo(
    () => ({
      isAuthenticated: false,
      mcpServerRunning: false,
      workflows: [],
      ...appContext,
    }),
    [appContext]
  );

  // Handle action callback
  const handleAction = useCallback(
    (fn: string, result: unknown) => {
      console.log(`[AIGeneratedComponent] Action executed: ${fn}`, result);
      onAction?.(fn, result);
    },
    [onAction]
  );

  // Compile and render the JSX
  const result = useMemo(() => {
    try {
      setError(null);
      return compileJSX(jsx, state, setState, handleAction, defaultAppContext);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      onError?.(err);
      return null;
    }
  }, [jsx, state, handleAction, defaultAppContext, onError, key]);

  // Log warnings in development
  useEffect(() => {
    if (result?.warnings.length) {
      console.warn("[AIGeneratedComponent] Warnings:", result.warnings);
    }
  }, [result?.warnings]);

  // Handle compilation errors
  if (error || (result?.errors && result.errors.length > 0)) {
    const errorMessages = error ? [error.message] : result?.errors || [];
    return (
      <div className={`border border-red-500 rounded-lg p-3 bg-red-50 ${className || ""}`}>
        <div className="flex items-center gap-2 text-red-600 font-medium text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>Component Render Error</span>
        </div>
        <div className="mt-2 text-xs text-red-500 space-y-1">
          {errorMessages.map((msg, i) => (
            <div key={i} className="font-mono">
              {msg}
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-7 text-xs"
          onClick={() => {
            setError(null);
            setState(initialState);
            setKey(k => k + 1);
          }}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  // Render warnings if any
  const hasWarnings = result?.warnings && result.warnings.length > 0;

  return (
    <div className={`ai-generated-component ${className || ""}`}>
      {hasWarnings && (
        <div className="mb-2 p-2 bg-yellow-50 border border-yellow-300 rounded text-xs text-yellow-700">
          <div className="font-medium flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Warnings
          </div>
          <ul className="mt-1 list-disc ml-4">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {result?.element}
    </div>
  );
}

/**
 * Parse component block from AI response
 * Looks for ```component ... ``` blocks
 */
export function parseComponentFromResponse(content: string): {
  text: string;
  component?: { jsx: string; initialState?: ComponentState };
} {
  const componentRegex = /```component\s*([\s\S]*?)```/;
  const match = content.match(componentRegex);

  if (!match) {
    return { text: content };
  }

  const jsxCode = match[1].trim();
  const textBefore = content.slice(0, match.index).trim();
  const textAfter = content.slice(match.index! + match[0].length).trim();
  const text = [textBefore, textAfter].filter(Boolean).join("\n\n");

  // Try to extract initial state if specified in a comment
  let initialState: ComponentState | undefined;
  const stateRegex = /\/\*\s*initialState:\s*([\s\S]*?)\*\//;
  const stateMatch = jsxCode.match(stateRegex);
  if (stateMatch) {
    try {
      initialState = JSON.parse(stateMatch[1].trim());
    } catch {
      // Ignore parse errors
    }
  }

  // Remove the state comment from JSX
  const cleanJsx = jsxCode.replace(stateRegex, "").trim();

  return {
    text,
    component: {
      jsx: cleanJsx,
      initialState,
    },
  };
}
