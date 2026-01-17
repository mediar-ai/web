import { AlertTriangle, X, Copy, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

// Error categories for workflow-level execution errors
export type WorkflowErrorCategory =
  | "module_error" // Export not found, Cannot find module
  | "syntax_error" // SyntaxError
  | "reference_error" // ReferenceError
  | "type_error" // TypeError
  | "extension_error" // Chrome extension connection errors
  | "runtime_error" // General runtime errors
  | "unknown";

export interface WorkflowExecutionErrorDetails {
  category: WorkflowErrorCategory;
  message: string; // Main error message (extracted from stderr)
  exitCode?: number;
  stderr?: string; // Full stderr output
  stdout?: string; // Full stdout output
  workflowName?: string;
  workflowId?: string;
  filePath?: string; // File that caused the error if extractable
  suggestion?: string; // Helpful suggestion based on error type
}

interface WorkflowExecutionErrorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  error: WorkflowExecutionErrorDetails | null;
  onTroubleshoot?: () => void; // Callback to trigger AI troubleshooting
}

// Classify error based on stderr content
export function classifyWorkflowError(stderr: string, stdout?: string): WorkflowExecutionErrorDetails {
  const combined = `${stderr}\n${stdout || ""}`;

  // Extract file path from error messages
  let filePath: string | undefined;
  const filePathMatch = combined.match(/(?:in module |at |from )['"]?([^'":\s]+\.(?:ts|js|tsx|jsx))['"]?/i);
  if (filePathMatch) {
    filePath = filePathMatch[1];
  }

  // Input validation errors (Zod schema validation)
  if (/Input validation failed/i.test(combined)) {
    return {
      category: "runtime_error",
      message: "Input validation failed",
      stderr,
      stdout,
      filePath,
      suggestion:
        "The workflow expects specific input fields that weren't provided or don't match the expected types. Check that your inputs match the inputSchema defined in terminator.ts.",
    };
  }

  // Package resolution errors (Cannot find package - Bun/bundler errors)
  if (/Cannot find package/i.test(combined)) {
    const packageMatch = combined.match(/Cannot find package ['"]([^'"]+)['"]/);
    const packageName = packageMatch?.[1] || "unknown";

    return {
      category: "module_error",
      message: `Cannot find package "${packageName}"`,
      stderr,
      stdout,
      filePath,
      suggestion: `The package "${packageName}" is not installed. Run "bun add ${packageName}" in your workflow directory to install it.`,
    };
  }

  // Module/Export errors
  if (/Export named ['"][^'"]+['"] not found/i.test(combined) || /Cannot find module/i.test(combined)) {
    const exportMatch = combined.match(/Export named ['"]([^'"]+)['"]/);
    const moduleMatch = combined.match(/Cannot find module ['"]([^'"]+)['"]/);
    const errorName = exportMatch?.[1] || moduleMatch?.[1] || "unknown";

    return {
      category: "module_error",
      message: exportMatch ? `Export "${errorName}" not found in module` : `Cannot find module "${errorName}"`,
      stderr,
      stdout,
      filePath,
      suggestion: exportMatch
        ? `Check that "${errorName}" is exported from the source file. It may have been renamed or removed.`
        : `Verify the module path is correct and the file exists.`,
    };
  }

  // Syntax errors (including EVAL_ERROR from browser scripts)
  if (/SyntaxError/i.test(combined)) {
    // Check if this is a browser script EVAL_ERROR (runtime JSON.parse issue, not actual syntax error)
    const isEvalError = /EVAL_ERROR/i.test(combined) || /JavaScript execution failed/i.test(combined);
    // Use the full error line for better context
    const fullErrorMatch = combined.match(/(JavaScript execution failed[^\n]+|SyntaxError[^\n]+)/i);
    const syntaxMatch = combined.match(/SyntaxError:\s*(.+?)(?:\n|$)/);
    return {
      category: "syntax_error",
      message: fullErrorMatch?.[1] || syntaxMatch?.[1] || "Syntax error in workflow code",
      stderr,
      stdout,
      filePath,
      suggestion: isEvalError
        ? "This is a runtime error in browser script execution. Check if you're calling JSON.parse() on data that's already an object."
        : "Check for missing brackets, quotes, or invalid JavaScript/TypeScript syntax.",
    };
  }

  // Reference errors
  if (/ReferenceError/i.test(combined)) {
    const refMatch = combined.match(/ReferenceError:\s*(.+?)(?:\n|$)/);
    const varMatch = combined.match(/(\w+) is not defined/);
    return {
      category: "reference_error",
      message: refMatch?.[1] || "Reference error - undefined variable",
      stderr,
      stdout,
      filePath,
      suggestion: varMatch
        ? `The variable "${varMatch[1]}" is not defined. Check for typos or missing imports.`
        : "A variable or function is being used before it's defined.",
    };
  }

  // Type errors (including Safari/WebKit-style "is not an object" errors)
  // Safari format: "undefined is not an object (evaluating 'foo.bar')"
  // Chrome/Node format: "TypeError: Cannot read properties of undefined (reading 'bar')"
  const safariTypeErrorMatch = combined.match(/(undefined|null) is not an object \(evaluating ['"]([^'"]+)['"]\)/i);
  if (safariTypeErrorMatch) {
    const [, nullOrUndefined, property] = safariTypeErrorMatch;
    return {
      category: "type_error",
      message: `${nullOrUndefined} is not an object (evaluating '${property}')`,
      stderr,
      stdout,
      filePath,
      suggestion: `The variable before '.${property.split(".").pop()}' is ${nullOrUndefined}. Check that objects are properly initialized before accessing their properties.`,
    };
  }
  if (/TypeError/i.test(combined)) {
    const typeMatch = combined.match(/TypeError:\s*(.+?)(?:\n|$)/);
    return {
      category: "type_error",
      message: typeMatch?.[1] || "Type error in workflow code",
      stderr,
      stdout,
      filePath,
      suggestion: "Check that you're calling methods on the correct types and that objects are properly initialized.",
    };
  }

  // Rust-JS binding errors (Failed to convert JavaScript value)
  if (/Failed to convert/i.test(combined)) {
    const convertMatch = combined.match(/Failed to convert[^`]*`([^`]+)`[^`]*`([^`]+)`/);
    return {
      category: "type_error",
      message: convertMatch
        ? `Type mismatch: expected ${convertMatch[2]}, got ${convertMatch[1]}`
        : "Type conversion error between JavaScript and Rust",
      stderr,
      stdout,
      filePath,
      suggestion:
        "Check that you're passing the correct argument types to API functions. For example, waitFor() expects (condition: string, timeout: number), not an object.",
    };
  }

  // Chrome extension connection errors
  if (/Chrome extension failed to connect/i.test(combined) || /extension.*failed.*connect/i.test(combined)) {
    return {
      category: "extension_error",
      message: "Chrome extension failed to connect",
      stderr,
      stdout,
      filePath,
      suggestion:
        "Make sure the Mediar Chrome extension is installed and enabled, and Chrome browser is running. Try refreshing the extension or restarting Chrome.",
    };
  }

  // Generic runtime errors
  if (/Error:|error:/i.test(combined) || /failed/i.test(combined)) {
    const errorMatch = combined.match(/Error:\s*(.+?)(?:\n|$)/);
    return {
      category: "runtime_error",
      message: errorMatch?.[1] || "Runtime error during workflow execution",
      stderr,
      stdout,
      filePath,
      suggestion: "Review the error details below for more information.",
    };
  }

  // Unknown error - try to extract something meaningful
  // Look for common error patterns in the combined output
  const firstMeaningfulLine = combined
    .split("\n")
    .map(line => line.trim())
    .find(line => line.length > 10 && !line.startsWith("at ") && !line.startsWith("Error:"));

  return {
    category: "unknown",
    message: firstMeaningfulLine || stderr.split("\n")[0] || "Unknown workflow execution error",
    stderr,
    stdout,
    filePath,
    suggestion: "Review the full error output below for details.",
  };
}

// Parse MCP error data into WorkflowExecutionErrorDetails
export function parseWorkflowExecutionError(
  errorData: any,
  workflowName?: string,
  workflowId?: string
): WorkflowExecutionErrorDetails | null {
  if (!errorData) return null;

  const stderr = errorData.stderr || "";
  const stdout = errorData.stdout || "";
  const exitCode = errorData.exit_code;

  // Extract error from workflow_result (Bun module resolution errors come here)
  // Check both 'error' and 'message' fields since different error types use different fields
  const workflowResultError =
    errorData.workflow_result?.result?.error || errorData.workflow_result?.result?.message || "";

  // Extract error from logs (ResolveMessage errors are logged here)
  let logsError = "";
  if (Array.isArray(errorData.logs)) {
    for (const log of errorData.logs) {
      if (log.level === "ERROR" && log.message) {
        // Try to parse JSON from log message (ResolveMessage format)
        try {
          const parsed = JSON.parse(log.message.replace(/^Workflow execution error:\s*/, ""));
          if (parsed.name === "ResolveMessage" && parsed.message) {
            logsError = parsed.message;
            break;
          }
        } catch {
          // Not JSON, use as-is if it looks like an error
          if (log.message.includes("Cannot find") || log.message.includes("Error")) {
            logsError = log.message;
          }
        }
      }
    }
  }

  // Combine all error sources for classification
  const combinedErrorContent = [stderr, stdout, workflowResultError, logsError].filter(Boolean).join("\n");

  // Check if this looks like a workflow execution error
  if (!combinedErrorContent && !exitCode) {
    return null;
  }

  console.log(
    "[WORKFLOW-ERROR] parseWorkflowExecutionError - combinedErrorContent:",
    combinedErrorContent.slice(0, 300)
  );

  const classified = classifyWorkflowError(combinedErrorContent, "");

  // Show all errors including unknown - users should see error details
  if (classified.category === "unknown") {
    console.log("[WORKFLOW-ERROR] Unknown error category:", combinedErrorContent.slice(0, 200));
  }

  return {
    ...classified,
    exitCode,
    workflowName,
    workflowId,
  };
}

const categoryLabels: Record<WorkflowErrorCategory, string> = {
  module_error: "Module/Import Error",
  syntax_error: "Syntax Error",
  reference_error: "Reference Error",
  type_error: "Type Error",
  extension_error: "Extension Error",
  runtime_error: "Runtime Error",
  unknown: "Execution Error",
};

const categoryColors: Record<WorkflowErrorCategory, string> = {
  module_error: "text-red-600",
  syntax_error: "text-red-600",
  reference_error: "text-red-600",
  type_error: "text-red-600",
  extension_error: "text-red-600",
  runtime_error: "text-red-600",
  unknown: "[.theme-classic_&]:text-black [.theme-inverted_&]:text-white",
};

export function WorkflowExecutionErrorDialog({
  isOpen,
  onClose,
  error,
  onTroubleshoot,
}: WorkflowExecutionErrorDialogProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setShowDetails(false); // Reset on open
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleCopyError = async () => {
    if (!error) return;
    const parts = [
      `Error: ${error.message}`,
      error.suggestion ? `\nSuggestion: ${error.suggestion}` : "",
      error.category && error.category !== "unknown" ? `\nCategory: ${categoryLabels[error.category]}` : "",
      error.exitCode !== undefined ? `\nExit code: ${error.exitCode}` : "",
      error.workflowName ? `\nWorkflow: ${error.workflowName}` : "",
      error.workflowId ? `\nWorkflow ID: ${error.workflowId}` : "",
      error.filePath ? `\nFile: ${error.filePath}` : "",
      error.stderr ? `\n\n--- stderr ---\n${error.stderr}` : "",
      error.stdout ? `\n\n--- stdout ---\n${error.stdout}` : "",
    ];
    await navigator.clipboard.writeText(parts.filter(Boolean).join(""));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isVisible || !error) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleBackdropClick}>
      <div className="[.theme-classic_&]:bg-white [.theme-inverted_&]:bg-gray-900 backdrop-blur-md border [.theme-classic_&]:border-black [.theme-inverted_&]:border-white rounded-lg shadow-lg max-w-lg w-full mx-4 p-0 max-h-[80vh] flex flex-col">
        {/* Header - just close button */}
        <div className="flex items-center justify-end p-3 shrink-0">
          <button
            onClick={onClose}
            className="p-1 [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:hover:bg-white/10 rounded border border-transparent [.theme-classic_&]:hover:border-black [.theme-inverted_&]:hover:border-white transition-colors"
            title="Close"
          >
            <X className="w-4 h-4 [.theme-classic_&]:text-black [.theme-inverted_&]:text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6 overflow-y-auto flex-1">
          {/* Central error message */}
          <div className="text-center">
            <AlertTriangle className="w-8 h-8 text-red-600 mx-auto" />
            <h2 className="text-lg font-semibold [.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
              {error.message}
            </h2>
          </div>

          {/* File path if available */}
          {error.filePath && (
            <p className="text-xs text-gray-500 [.theme-inverted_&]:text-gray-400 font-mono text-center">
              {error.filePath}
            </p>
          )}

          {/* Collapsible details - all error fields */}
          <div>
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-gray-500 [.theme-inverted_&]:text-gray-400 hover:text-gray-700 [.theme-inverted_&]:hover:text-gray-200 flex items-center gap-1 mx-auto"
            >
              {showDetails ? "Hide" : "Show"} details
            </button>
            {showDetails && (
              <div className="mt-2 space-y-3">
                <div className="flex justify-end">
                  <button
                    onClick={handleCopyError}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 [.theme-inverted_&]:text-gray-400 [.theme-inverted_&]:hover:text-gray-200"
                    title="Copy error details"
                  >
                    {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>

                {/* Error metadata */}
                <div className="text-xs space-y-1">
                  {error.category && error.category !== "unknown" && (
                    <div className="flex gap-2">
                      <span className="text-gray-500 [.theme-inverted_&]:text-gray-400">Category:</span>
                      <span className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white font-medium">
                        {categoryLabels[error.category]}
                      </span>
                    </div>
                  )}
                  {error.exitCode !== undefined && (
                    <div className="flex gap-2">
                      <span className="text-gray-500 [.theme-inverted_&]:text-gray-400">Exit code:</span>
                      <span className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white font-mono">
                        {error.exitCode}
                      </span>
                    </div>
                  )}
                  {error.workflowName && (
                    <div className="flex gap-2">
                      <span className="text-gray-500 [.theme-inverted_&]:text-gray-400">Workflow:</span>
                      <span className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white">
                        {error.workflowName}
                      </span>
                    </div>
                  )}
                  {error.workflowId && (
                    <div className="flex gap-2">
                      <span className="text-gray-500 [.theme-inverted_&]:text-gray-400">ID:</span>
                      <span className="[.theme-classic_&]:text-black [.theme-inverted_&]:text-white font-mono text-[10px]">
                        {error.workflowId}
                      </span>
                    </div>
                  )}
                </div>

                {/* stderr */}
                {error.stderr && (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500 [.theme-inverted_&]:text-gray-400 font-medium">stderr:</div>
                    <div className="text-xs text-gray-600 [.theme-inverted_&]:text-gray-300 bg-gray-100 [.theme-inverted_&]:bg-gray-800 p-2 rounded font-mono overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                      {error.stderr}
                    </div>
                  </div>
                )}

                {/* stdout */}
                {error.stdout && (
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500 [.theme-inverted_&]:text-gray-400 font-medium">stdout:</div>
                    <div className="text-xs text-gray-600 [.theme-inverted_&]:text-gray-300 bg-gray-100 [.theme-inverted_&]:bg-gray-800 p-2 rounded font-mono overflow-x-auto max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
                      {error.stdout}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-3 p-6 shrink-0">
          {onTroubleshoot && (
            <Button
              variant="outline"
              onClick={() => {
                console.log(
                  "[ERROR_DIALOG] User clicked 'Troubleshoot with AI' button - triggering manual AI analysis"
                );
                onTroubleshoot();
                onClose();
              }}
              className="px-4"
            >
              Troubleshoot with AI
            </Button>
          )}
          <Button onClick={onClose} className="px-6">
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
