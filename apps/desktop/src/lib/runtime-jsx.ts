/**
 * Runtime JSX Compiler
 *
 * Compiles AI-generated JSX strings into React components at runtime.
 * Includes security linting to prevent dangerous patterns.
 */

import { transform } from "sucrase";
import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ALLOWED_COMMANDS,
  BLOCKED_COMMANDS,
  isCommandAllowed,
  getAllowedCommands,
} from "./generated/tauri-commands-registry";

// Import all UI components the AI can use
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Icons AI can use
import {
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Cloud,
  Copy,
  Edit2,
  ExternalLink,
  File,
  Folder,
  Info,
  Loader2,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Square,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

// Dangerous patterns to block
const BLOCKED_PATTERNS = [
  /eval\s*\(/gi,
  /Function\s*\(/gi,
  /setTimeout\s*\(\s*["'`]/gi, // setTimeout with string arg
  /setInterval\s*\(\s*["'`]/gi,
  /document\.(write|writeln)/gi,
  /innerHTML\s*=/gi,
  /outerHTML\s*=/gi,
  /dangerouslySetInnerHTML/gi,
  /\bwindow\.(location|open|close)/gi,
  /\blocalStorage\b/gi,
  /\bsessionStorage\b/gi,
  /\bfetch\s*\(/gi, // Block direct fetch, use invoke instead
  /\bXMLHttpRequest\b/gi,
  /\bWebSocket\b/gi,
  /\bimport\s*\(/gi, // Dynamic imports
  /\brequire\s*\(/gi,
  /process\.(env|exit)/gi,
  /__proto__/gi,
  /constructor\s*\[/gi,
  /prototype\s*\[/gi,
];

// Use auto-generated commands registry (see scripts/generate-tauri-commands.ts)
// ALLOWED_COMMANDS and BLOCKED_COMMANDS are imported from ./generated/tauri-commands-registry

export interface LintResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Lint JSX code for security issues
 */
export function lintJSX(code: string): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(`Blocked pattern detected: ${pattern.source}`);
    }
  }

  // Check for invoke calls and validate command names
  const invokePattern = /invoke\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = invokePattern.exec(code)) !== null) {
    const command = match[1];
    if (!isCommandAllowed(command)) {
      warnings.push(`Invoke command not in allowlist: ${command}`);
    }
  }

  // Check for suspicious patterns that might bypass security
  if (code.includes("\\x") || code.includes("\\u")) {
    warnings.push("Unicode/hex escape sequences detected - review carefully");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Components available to AI-generated code
const AVAILABLE_COMPONENTS = {
  // UI Components
  Button,
  Input,
  Textarea,
  Card,
  CardHeader,
  CardContent,
  CardFooter,
  CardTitle,
  CardDescription,
  Badge,
  Label,
  Switch,
  Separator,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  // Icons
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Cloud,
  Copy,
  Edit2,
  ExternalLink,
  File,
  Folder,
  Info,
  Loader2,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Square,
  Trash2,
  X,
  XCircle,
};

export type ComponentState = Record<string, unknown>;
export type SetComponentState = React.Dispatch<React.SetStateAction<ComponentState>>;
export type ActionCallback = (functionName: string, result: unknown) => void;

// App state that AI components can access (read-only)
export interface AppContext {
  currentWorkflowId?: string;
  currentWorkflowName?: string;
  isAuthenticated: boolean;
  userName?: string;
  mcpServerRunning: boolean;
  workflows: Array<{ id: string; name: string }>;
}

/**
 * Create a safe invoke wrapper that only allows whitelisted commands
 */
function createSafeInvoke(onAction: ActionCallback) {
  return async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (!isCommandAllowed(command)) {
      console.warn(`[runtime-jsx] Blocked invoke call to: ${command}`);
      throw new Error(`Command not allowed: ${command}`);
    }

    console.log(`[runtime-jsx] Invoking: ${command}`, args);
    try {
      const result = await invoke(command, args);
      onAction(command, result);
      return result;
    } catch (error) {
      console.error(`[runtime-jsx] Invoke failed: ${command}`, error);
      throw error;
    }
  };
}

export interface CompileResult {
  element: React.ReactNode;
  errors: string[];
  warnings: string[];
}

/**
 * Compile JSX string to React element
 */
export function compileJSX(
  jsxString: string,
  state: ComponentState,
  setState: SetComponentState,
  onAction: ActionCallback,
  appContext: AppContext
): CompileResult {
  // First, lint the code
  const lintResult = lintJSX(jsxString);

  if (!lintResult.valid) {
    return {
      element: React.createElement(
        "div",
        { className: "text-red-500 text-xs p-2 border border-red-500 rounded" },
        React.createElement("div", { className: "font-bold" }, "Security Error"),
        React.createElement(
          "ul",
          { className: "list-disc ml-4 mt-1" },
          ...lintResult.errors.map((err, i) => React.createElement("li", { key: i }, err))
        )
      ),
      errors: lintResult.errors,
      warnings: lintResult.warnings,
    };
  }

  try {
    // Transpile JSX to JS using sucrase
    let transpiled = transform(jsxString, {
      transforms: ["jsx", "typescript"],
      jsxRuntime: "classic",
      production: true,
    }).code;

    // Strip import statements (AI shouldn't use them, but just in case)
    // Remove: import { x } from 'y'; and import x from 'y'; and import 'y';
    transpiled = transpiled.replace(/^import\s+.*?['"]\s*;?\s*$/gm, "");
    // Also remove any remaining import statements that might be inline
    transpiled = transpiled.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?/g, "");
    transpiled = transpiled.replace(/import\s+\w+\s+from\s*['"][^'"]*['"];?/g, "");
    transpiled = transpiled.trim();

    console.log("[runtime-jsx] Transpiled code (imports stripped):", transpiled.substring(0, 200));

    // Create the safe invoke wrapper
    const safeInvoke = createSafeInvoke(onAction);

    // Build the function with injected scope
    // Handle different code patterns:
    // 1. Simple JSX: <Card>...</Card> → return (React.createElement(...))
    // 2. Function + instantiation: function Foo() {...} <Foo /> → need IIFE wrapper
    const componentNames = Object.keys(AVAILABLE_COMPONENTS);

    // Detect if code has function definitions that need to be executed as statements
    // Pattern: starts with "function " or "const " or "let " followed by React.createElement later
    const hasFunctionDefinition = /^(function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=)/.test(transpiled);
    const endsWithCreateElement = /React\.createElement\([^)]+\)\s*;?\s*$/.test(transpiled);

    let functionBody: string;
    if (hasFunctionDefinition && endsWithCreateElement) {
      // Code has function definition(s) followed by component instantiation
      // Find the last React.createElement call and make it the return value
      const lastCreateElementMatch = transpiled.match(/^([\s\S]*)(React\.createElement\([^;]+\))\s*;?\s*$/);
      if (lastCreateElementMatch) {
        const statements = lastCreateElementMatch[1];
        const finalExpression = lastCreateElementMatch[2];
        functionBody = `
          "use strict";
          try {
            ${statements}
            return ${finalExpression};
          } catch (e) {
            console.error("[runtime-jsx] Render error:", e);
            return React.createElement("div", { className: "text-red-500 text-xs" }, "Render error: " + e.message);
          }
        `;
      } else {
        // Fallback: wrap in IIFE
        functionBody = `
          "use strict";
          try {
            return (function() { ${transpiled.replace(/;?\s*$/, "")}; })();
          } catch (e) {
            console.error("[runtime-jsx] Render error:", e);
            return React.createElement("div", { className: "text-red-500 text-xs" }, "Render error: " + e.message);
          }
        `;
      }
    } else {
      // Simple expression - just return it
      functionBody = `
        "use strict";
        try {
          return (${transpiled});
        } catch (e) {
          console.error("[runtime-jsx] Render error:", e);
          return React.createElement("div", { className: "text-red-500 text-xs" }, "Render error: " + e.message);
        }
      `;
    }

    // Create function with controlled scope
    // Include React hooks so AI can use useState, useEffect, etc. directly
    const factory = new Function(
      "React",
      "useState",
      "useEffect",
      "useMemo",
      "useCallback",
      "useRef",
      "state",
      "setState",
      "invoke",
      "onAction",
      "appContext",
      ...componentNames,
      functionBody
    );

    // Execute the factory with all dependencies
    const element = factory(
      React,
      React.useState,
      React.useEffect,
      React.useMemo,
      React.useCallback,
      React.useRef,
      state,
      setState,
      safeInvoke,
      onAction,
      appContext,
      ...Object.values(AVAILABLE_COMPONENTS)
    );

    return {
      element,
      errors: [],
      warnings: lintResult.warnings,
    };
  } catch (error) {
    console.error("[runtime-jsx] Compilation error:", error);
    return {
      element: React.createElement(
        "div",
        { className: "text-red-500 text-xs p-2 border border-red-500 rounded" },
        React.createElement("div", { className: "font-bold" }, "Compilation Error"),
        React.createElement("pre", { className: "mt-1 text-[10px] overflow-auto" }, String(error))
      ),
      errors: [String(error)],
      warnings: lintResult.warnings,
    };
  }
}

/**
 * Get list of available components for AI prompt
 */
export function getAvailableComponentsList(): string {
  const components = Object.keys(AVAILABLE_COMPONENTS);
  return components.join(", ");
}

/**
 * Validate JSX code without rendering it
 * Returns { valid: true } or { valid: false, error: string }
 * Used to pre-validate AI-generated JSX before marking the tool as successful
 */
export function validateJSX(jsxString: string): { valid: boolean; error?: string } {
  // Check for blocked patterns
  const lintResult = lintJSX(jsxString);
  if (!lintResult.valid) {
    return { valid: false, error: `Security error: ${lintResult.errors.join("; ")}` };
  }

  try {
    // Transpile JSX to JS using sucrase
    let transpiled = transform(jsxString, {
      transforms: ["jsx", "typescript"],
      jsxRuntime: "classic",
      production: true,
    }).code;

    // Strip import statements
    transpiled = transpiled.replace(/^import\s+.*?['"]\s*;?\s*$/gm, "");
    transpiled = transpiled.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]*['"];?/g, "");
    transpiled = transpiled.replace(/import\s+\w+\s+from\s*['"][^'"]*['"];?/g, "");
    transpiled = transpiled.trim();

    // Try to create the function to catch syntax errors
    const componentNames = Object.keys(AVAILABLE_COMPONENTS);

    // Detect if code has function definitions that need statement execution
    const hasFunctionDefinition = /^(function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=)/.test(transpiled);
    const endsWithCreateElement = /React\.createElement\([^)]+\)\s*;?\s*$/.test(transpiled);

    let functionBody: string;
    if (hasFunctionDefinition && endsWithCreateElement) {
      // Code has function definition(s) followed by component instantiation
      const lastCreateElementMatch = transpiled.match(/^([\s\S]*)(React\.createElement\([^;]+\))\s*;?\s*$/);
      if (lastCreateElementMatch) {
        const statements = lastCreateElementMatch[1];
        const finalExpression = lastCreateElementMatch[2];
        functionBody = `"use strict"; ${statements} return ${finalExpression};`;
      } else {
        // Fallback: wrap in IIFE
        functionBody = `"use strict"; return (function() { ${transpiled.replace(/;?\s*$/, "")}; })();`;
      }
    } else {
      // Simple expression - just return it
      functionBody = `"use strict"; return (${transpiled});`;
    }

    console.log("[runtime-jsx] validateJSX functionBody:", functionBody.substring(0, 150));

    // This will throw if there's a syntax error
    new Function(
      "React",
      "useState",
      "useEffect",
      "useMemo",
      "useCallback",
      "useRef",
      "state",
      "setState",
      "invoke",
      "onAction",
      "appContext",
      ...componentNames,
      functionBody
    );

    return { valid: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[runtime-jsx] Validation error:", errorMsg);
    return { valid: false, error: errorMsg };
  }
}

/**
 * Get list of allowed invoke commands for AI prompt
 */
export function getAllowedInvokeCommands(): string[] {
  return getAllowedCommands();
}
